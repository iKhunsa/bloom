import { useEffect, useMemo, useRef, useState } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
	ArrowUp,
	Check,
	ChevronDown,
	ClipboardPaste,
	Copy,
	Languages,
	LoaderCircle,
	SpellCheck
} from "lucide-react";
import {
	correctText,
	languageName,
	MAX_TEXT_LENGTH,
	TARGET_LANGUAGES,
	translateText
} from "../writer";
import "./QuickPanel.css";
import "./WriterPanel.css";

// Kept outside the component so a half-written text survives the notch
// collapsing and reopening.
const draft = { text: "", result: "", note: "" };

const defaultTarget = () => {
	const stored = localStorage.getItem("bloom-writer-target");
	if (stored) return stored;
	const system = navigator.language.split("-")[0];
	return TARGET_LANGUAGES.some((c) => c === system) ? system : "en";
};

interface WriterPanelProps {
	/** Keeps the notch open while typing or waiting for a result. */
	onPinChange: (pinned: boolean) => void;
}

export function WriterPanel({ onPinChange }: WriterPanelProps) {
	const [text, setText] = useState(draft.text);
	const [result, setResult] = useState(draft.result);
	const [note, setNote] = useState(draft.note);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"fix" | "translate" | null>(null);
	const [copied, setCopied] = useState(false);
	const [target, setTarget] = useState(defaultTarget);
	const [picking, setPicking] = useState(false);
	const [filter, setFilter] = useState("");
	const textRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		draft.text = text;
		draft.result = result;
		draft.note = note;
	}, [text, result, note]);

	// Let go of the notch when the panel goes away.
	useEffect(() => () => onPinChange(false), [onPinChange]);

	const languages = useMemo(
		() =>
			TARGET_LANGUAGES.map((code) => ({ code, name: languageName(code) })).sort((a, b) =>
				a.name.localeCompare(b.name)
			),
		[]
	);
	const shown = languages.filter(
		(l) =>
			l.name.toLowerCase().includes(filter.toLowerCase()) ||
			l.code.toLowerCase().includes(filter.toLowerCase())
	);

	const run = async (kind: "fix" | "translate") => {
		const input = text.trim();
		if (!input || busy) return;
		setBusy(kind);
		setError(null);
		onPinChange(true);
		try {
			if (kind === "fix") {
				const fixed = await correctText(input);
				setResult(fixed.text);
				setNote(
					fixed.fixes === 0
						? "No mistakes found"
						: `${fixed.fixes} ${fixed.fixes === 1 ? "fix" : "fixes"}${
								fixed.language ? ` · ${languageName(fixed.language)}` : ""
							}`
				);
			} else {
				const translated = await translateText(input, target);
				setResult(translated.text);
				setNote(
					`${translated.source ? languageName(translated.source) : "Auto"} → ${languageName(target)}`
				);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
			onPinChange(document.activeElement === textRef.current);
		}
	};

	const paste = async () => {
		try {
			const clip = await readText();
			if (clip) setText(clip.slice(0, MAX_TEXT_LENGTH));
		} catch (e) {
			console.error("[writer] paste failed:", e);
		}
	};

	const copy = async () => {
		await writeText(result).catch(console.error);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1200);
	};

	const pickTarget = (code: string) => {
		setTarget(code);
		localStorage.setItem("bloom-writer-target", code);
		setPicking(false);
		setFilter("");
	};

	if (picking) {
		return (
			<div className="qp" onClick={(e) => e.stopPropagation()}>
				<input
					className="qp-input"
					placeholder="Search languages"
					autoFocus
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Escape") setPicking(false);
						if (e.key === "Enter" && shown[0]) pickTarget(shown[0].code);
					}}
				/>
				<ul className="qp-list wp-languages">
					{shown.map((l) => (
						<li key={l.code} className={`qp-row ${l.code === target ? "active" : ""}`}>
							<button className="qp-row-main" onClick={() => pickTarget(l.code)}>
								<span className="qp-row-text">
									<span className="qp-row-name">{l.name}</span>
								</span>
								{l.code === target && <Check className="qp-row-badge" />}
							</button>
						</li>
					))}
				</ul>
			</div>
		);
	}

	return (
		<div className="qp wp" onClick={(e) => e.stopPropagation()}>
			<textarea
				ref={textRef}
				className="qp-input wp-text"
				placeholder="Type or paste text…"
				maxLength={MAX_TEXT_LENGTH}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onFocus={() => onPinChange(true)}
				onBlur={() => onPinChange(busy !== null)}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void run("fix");
				}}
			/>
			<div className="wp-actions">
				<button className="qp-btn" onClick={() => void paste()} title="Paste from clipboard">
					<ClipboardPaste />
				</button>
				<button
					className="qp-btn primary"
					disabled={!text.trim() || busy !== null}
					onClick={() => void run("fix")}
					title="Fix spelling and grammar (Ctrl+Enter)"
				>
					{busy === "fix" ? <LoaderCircle className="qp-spin" /> : <SpellCheck />}
					Fix
				</button>
				<span className="wp-spacer" />
				<button className="qp-btn wp-lang" onClick={() => setPicking(true)} title="Translate to…">
					{languageName(target)}
					<ChevronDown />
				</button>
				<button
					className="qp-btn primary"
					disabled={!text.trim() || busy !== null}
					onClick={() => void run("translate")}
				>
					{busy === "translate" ? <LoaderCircle className="qp-spin" /> : <Languages />}
					Translate
				</button>
			</div>
			<div className="wp-result">
				{result ? (
					<>
						<p className="wp-result-text">{result}</p>
						<div className="wp-result-actions">
							<button
								className="qp-icon-btn"
								onClick={() => setText(result)}
								aria-label="Use result as input"
								title="Use result as input"
							>
								<ArrowUp />
							</button>
							<button
								className="qp-icon-btn"
								onClick={() => void copy()}
								aria-label="Copy result"
								title="Copy result"
							>
								{copied ? <Check /> : <Copy />}
							</button>
						</div>
					</>
				) : (
					<span className="qp-note">The result shows up here</span>
				)}
			</div>
			{error ? (
				<div className="qp-error wp-note">{error}</div>
			) : (
				<div className="qp-note wp-note">{note}</div>
			)}
		</div>
	);
}
