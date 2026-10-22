// Spelling/grammar correction (LanguageTool) and translation (Google's public
// translate endpoint) for the notch's writer panel. Neither needs an API key.

const CORRECT_URL = "https://api.languagetool.org/v2/check";
const TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t";

/** Longest text sent in one request; the free tiers reject far less than this. */
export const MAX_TEXT_LENGTH = 5000;

// Languages Google Translate supports. Names come from Intl.DisplayNames, so
// they follow the system language.
export const TARGET_LANGUAGES = [
	"af",
	"sq",
	"am",
	"ar",
	"hy",
	"as",
	"ay",
	"az",
	"bm",
	"eu",
	"be",
	"bn",
	"bho",
	"bs",
	"bg",
	"ca",
	"ceb",
	"zh-CN",
	"zh-TW",
	"co",
	"hr",
	"cs",
	"da",
	"dv",
	"doi",
	"nl",
	"en",
	"eo",
	"et",
	"ee",
	"fil",
	"fi",
	"fr",
	"fy",
	"gl",
	"ka",
	"de",
	"el",
	"gn",
	"gu",
	"ht",
	"ha",
	"haw",
	"he",
	"hi",
	"hmn",
	"hu",
	"is",
	"ig",
	"ilo",
	"id",
	"ga",
	"it",
	"ja",
	"jv",
	"kn",
	"kk",
	"km",
	"rw",
	"gom",
	"ko",
	"kri",
	"ku",
	"ckb",
	"ky",
	"lo",
	"la",
	"lv",
	"ln",
	"lt",
	"lg",
	"lb",
	"mk",
	"mai",
	"mg",
	"ms",
	"ml",
	"mt",
	"mi",
	"mr",
	"mni-Mtei",
	"lus",
	"mn",
	"my",
	"ne",
	"no",
	"or",
	"om",
	"ps",
	"fa",
	"pl",
	"pt",
	"pa",
	"qu",
	"ro",
	"ru",
	"sm",
	"sa",
	"gd",
	"nso",
	"sr",
	"st",
	"sn",
	"sd",
	"si",
	"sk",
	"sl",
	"so",
	"es",
	"su",
	"sw",
	"sv",
	"tg",
	"ta",
	"tt",
	"te",
	"th",
	"ti",
	"ts",
	"tr",
	"tk",
	"ak",
	"uk",
	"ur",
	"ug",
	"uz",
	"vi",
	"cy",
	"xh",
	"yi",
	"yo",
	"zu"
] as const;

const displayNames = (() => {
	try {
		return new Intl.DisplayNames([navigator.language], { type: "language" });
	} catch {
		return null;
	}
})();

/** Human name of a language code in the system language, or the code itself. */
export const languageName = (code: string): string => {
	try {
		return displayNames?.of(code) ?? code;
	} catch {
		return code;
	}
};

export interface Correction {
	text: string;
	fixes: number;
	/** Language LanguageTool detected, e.g. "es". */
	language: string;
}

// LanguageTool also reports style hints; only fix what is plainly wrong.
const SKIPPED_ISSUES = new Set(["style", "register", "locale-violation", "duplication"]);

interface LanguageToolMatch {
	offset: number;
	length: number;
	replacements?: { value: string }[];
	rule?: { issueType?: string };
}

export async function correctText(text: string): Promise<Correction> {
	const response = await fetch(CORRECT_URL, {
		method: "POST",
		// "auto" needs a preferred variant for languages that have several.
		body: new URLSearchParams({
			text,
			language: "auto",
			preferredVariants: "en-US,de-DE,pt-BR,ca-ES"
		})
	});
	if (!response.ok) throw new Error(`Correction failed (${response.status})`);
	const data = await response.json();

	// Apply from the end so earlier offsets stay valid, and skip any match that
	// overlaps one already applied.
	const matches: LanguageToolMatch[] = [...(data.matches ?? [])].sort(
		(a, b) => b.offset - a.offset
	);
	let out = text;
	let fixes = 0;
	let limit = Infinity;
	for (const match of matches) {
		const replacement = match.replacements?.[0]?.value;
		if (replacement === undefined) continue;
		if (SKIPPED_ISSUES.has(match.rule?.issueType ?? "")) continue;
		if (match.offset + match.length > limit) continue;
		out = out.slice(0, match.offset) + replacement + out.slice(match.offset + match.length);
		limit = match.offset;
		fixes++;
	}
	return {
		text: out,
		fixes,
		language: data.language?.detectedLanguage?.code ?? data.language?.code ?? ""
	};
}

/** Language the text is always written in. Fixed instead of auto-detected, which guesses wrong on short phrases. */
export const SOURCE_LANGUAGE = "es";

export async function translateText(text: string, target: string): Promise<string> {
	const response = await fetch(
		`${TRANSLATE_URL}&sl=${SOURCE_LANGUAGE}&tl=${encodeURIComponent(target)}`,
		{
			method: "POST",
			body: new URLSearchParams({ q: text })
		}
	);
	if (!response.ok) throw new Error(`Translation failed (${response.status})`);
	const data = await response.json();
	return (data[0] as [string][]).map((segment) => segment[0]).join("");
}
