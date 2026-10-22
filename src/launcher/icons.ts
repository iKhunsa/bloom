// macOS-style icon library for the launcher: the WhiteSur icon theme (GPL-3.0) plus
// icons drawn for Bloom in its style. See public/launcher-icons/NOTICE.md.
import { BLOOM_IDS, ICON_IDS } from "./iconIndex";

const IDS = new Set<string>(ICON_IDS);

/** URL of a library icon, or undefined when the id isn't in the library. */
export const iconUrl = (id: string | undefined | null): string | undefined =>
	id && IDS.has(id) ? `/launcher-icons/${encodeURIComponent(id)}.svg` : undefined;

const LABELS: Record<string, string> = {
	"google-chrome": "Google Chrome",
	"visual-studio-code": "VS Code",
	"text-editor": "TextEdit",
	"gnome-paint": "Paint",
	calc: "Calculator",
	"accessories-camera": "Camera",
	"accessories-screenshot": "Screenshot",
	"accessories-character-map": "Character Map",
	"file-manager": "Finder",
	shotwell: "Photos",
	softwarecenter: "App Store",
	"org.gnome.Totem": "QuickTime Player",
	rhythmbox: "Music",
	"utilities-system-monitor": "Activity Monitor",
	"preferences-system": "System Settings",
	"preferences-security": "Security",
	"gnome-disks": "Disk Utility",
	"internet-mail": "Mail",
	"gnome-maps": "Maps",
	"indicator-weather": "Weather",
	sticky: "Stickies",
	"gnome-sound-recorder": "Voice Memos",
	"spotify-client": "Spotify",
	"signal-desktop": "Signal",
	"teams-for-linux": "Microsoft Teams",
	"ms-word": "Word",
	"ms-excel": "Excel",
	"ms-powerpoint": "PowerPoint",
	"ms-onenote": "OneNote",
	"ms-outlook": "Outlook",
	obs: "OBS Studio",
	"7zip": "7-Zip",
	"ea-app": "EA app",
	"github-desktop": "GitHub Desktop",
	"davinci-resolve": "DaVinci Resolve",
	unityhub: "Unity Hub",
	"dev-tools": "Developer tools",
	"event-viewer": "Console",
	"logitech-g": "Logitech G",
	"generic-app": "Generic app"
};

const prettify = (id: string) =>
	LABELS[id] ??
	id
		.replace(/^.*\./, (m) => (/^[A-Za-z]{2,4}\.$/.test(m) ? "" : m))
		.split(/[-_]+/)
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");

export interface LauncherIcon {
	id: string;
	label: string;
	url: string;
}

/** Lowercase, accents stripped, split into words: "Cámara (x64)" -> ["camara", "x64"]. */
const tokens = (text: string) =>
	text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.split(/[^a-z0-9+]+/)
		.filter(Boolean);

const squash = (text: string) => tokens(text).join("");

// What identifies an app, per icon. A phrase matches when its words appear together in the
// app's name; "=name" matches the executable's name exactly. More specific apps come first.
// Families (every command prompt, every WinDbg…) share one icon on purpose.
const AUTO: [string, string[]][] = [
	// browsers
	["google-chrome", ["google chrome", "=chrome"]],
	["chromium", ["chromium"]],
	["microsoft-edge", ["microsoft edge", "=msedge"]],
	["firefox", ["firefox"]],
	["brave", ["brave"]],
	["opera", ["opera"]],
	["vivaldi", ["vivaldi"]],
	["tor-browser", ["tor browser"]],
	["zen-browser", ["zen browser", "zen", "=zen"]],
	// development
	["vscodium", ["vscodium"]],
	["kimi", ["kimi"]],
	["antigravity", ["antigravity"]],
	["cursor", ["cursor", "=cursor"]],
	["visual-studio-code", ["visual studio code", "vs code", "=code"]],
	["sublime-text", ["sublime text", "sublime"]],
	["pycharm", ["pycharm"]],
	["webstorm", ["webstorm"]],
	["android-studio", ["android studio"]],
	["docker", ["docker"]],
	["postman", ["postman"]],
	["github-desktop", ["github desktop", "=githubdesktop"]],
	["git", ["git bash", "git gui", "git cmd"]],
	["powershell", ["powershell", "windows powershell"]],
	[
		"terminal",
		["command prompt", "windows terminal", "terminal", "=wt", "=cmd", "=windowsterminal"]
	],
	["alacritty", ["alacritty"]],
	["kitty", ["kitty"]],
	["text-editor", ["notepad", "bloc de notas", "=notepad"]],
	["gnome-paint", ["paint", "=mspaint"]],
	["python", ["python", "idle"]],
	["nodejs", ["node js", "nodejs"]],
	["miktex", ["miktex"]],
	["mysql-workbench", ["mysql workbench"]],
	["mongodb-compass", ["mongodb compass"]],
	["xampp", ["xampp"]],
	["filezilla", ["filezilla"]],
	["putty", ["putty", "puttygen", "pageant", "psftp", "plink"]],
	["wireshark", ["wireshark"]],
	["godot", ["godot"]],
	["unityhub", ["unity hub", "unity"]],
	["unreal-editor", ["unreal"]],
	["wsl", ["wsl"]],
	["proxy", ["mitmproxy", "mitmweb", "mitmdump"]],
	["installer", ["inno setup", "visual studio installer"]],
	[
		"dev-tools",
		[
			"windbg",
			"global flags",
			"gpuview",
			"windows performance analyzer",
			"windows performance recorder",
			"debugging help",
			"application verifier",
			"pe viewer",
			"windows software development kit",
			"windows app cert kit",
			"tools for desktop apps",
			"tools for uwp apps",
			"sample desktop apps",
			"sample uwp apps",
			"debuggable package manager",
			"dev home"
		]
	],
	// communication
	["discord", ["discord"]],
	["telegram", ["telegram"]],
	["whatsapp", ["whatsapp"]],
	["signal-desktop", ["signal"]],
	["slack", ["slack"]],
	["Zoom", ["zoom"]],
	["teams-for-linux", ["microsoft teams", "teams"]],
	["skype", ["skype"]],
	["thunderbird", ["thunderbird"]],
	["ms-outlook", ["outlook"]],
	["twitter", ["twitter"]],
	["reddit", ["reddit"]],
	["linkedin", ["linkedin"]],
	["web-facebook", ["facebook"]],
	["youtube-music-desktop-app", ["youtube music"]],
	["youtube", ["youtube"]],
	["netflix", ["netflix"]],
	["instagram", ["instagram"]],
	["tiklivetts", ["tiklivetts", "tik live tts"]],
	["tiktok", ["tiktok", "tik tok", "tikcontrol"]],
	// media and creative
	["spotify-client", ["spotify"]],
	["vlc", ["vlc"]],
	["obs", ["obs studio", "obs", "distroav", "ndi video"]],
	["audacity", ["audacity"]],
	["kdenlive", ["kdenlive"]],
	["deezer", ["deezer"]],
	["soundcloud", ["soundcloud"]],
	["plex", ["plex"]],
	["jellyfin", ["jellyfin"]],
	["kodi", ["kodi"]],
	["qbittorrent", ["qbittorrent"]],
	["transmission", ["transmission"]],
	["davinci-resolve", ["davinci resolve", "resolve", "davinci", "blackmagic", "fairlight"]],
	["capcut", ["capcut"]],
	["blender", ["blender"]],
	["gimp", ["gimp"]],
	["inkscape", ["inkscape"]],
	["krita", ["krita"]],
	["figma", ["figma"]],
	["affinity", ["affinity"]],
	["photopea", ["photopea"]],
	["notion.calendar", ["notion calendar"]],
	["notion", ["notion"]],
	["obsidian", ["obsidian"]],
	// office and files
	["ms-word", ["word", "microsoft word"]],
	["ms-excel", ["excel"]],
	["ms-powerpoint", ["powerpoint"]],
	["ms-onenote", ["onenote"]],
	["libreoffice-writer", ["libreoffice writer"]],
	["libreoffice-calc", ["libreoffice calc"]],
	["libreoffice-impress", ["libreoffice impress"]],
	["libreoffice", ["libreoffice"]],
	["dropbox", ["dropbox"]],
	["google-drive", ["google drive"]],
	["icloud", ["icloud"]],
	["mega", ["mega"]],
	["bitwarden", ["bitwarden"]],
	["7zip", ["7-zip", "7 zip", "=7zfm"]],
	["winrar", ["winrar", "=winrar"]],
	["everything", ["everything"]],
	["copyq", ["ditto"]],
	["accessories-media-converter", ["file converter"]],
	// games
	["steam", ["steam"]],
	["epic-games", ["epic games", "epic games launcher"]],
	["battlenet", ["battle net", "battlenet"]],
	["riot-games", ["riot client", "riot games", "valorant", "league of legends"]],
	[
		"ea-app",
		[
			"ea app",
			"ea desktop",
			"electronic arts",
			"ea updater",
			"actualizador de ea",
			"ea error reporter",
			"ea"
		]
	],
	["heroic", ["heroic"]],
	["lutris", ["lutris"]],
	["minecraft", ["minecraft"]],
	["xbox", ["xbox", "game bar"]],
	// AI and tools
	["openai", ["chatgpt", "openai"]],
	["claude", ["claude"]],
	["gemini", ["gemini"]],
	["copilot", ["copilot"]],
	["perplexity", ["perplexity"]],
	["orca", ["orca"]],
	["windhawk", ["windhawk"]],
	["jdownloader", ["jdownloader"]],
	["powertoys", ["powertoys"]],
	["teamviewer", ["teamviewer"]],
	["anydesk", ["anydesk"]],
	["virtualbox", ["virtualbox"]],
	["vmware-player", ["vmware"]],
	["mullvad-vpn", ["mullvad"]],
	["bleachbit", ["bleachbit"]],
	["hwinfo", ["hwinfo", "system information"]],
	["nvidia", ["nvidia"]],
	["intel", ["intel"]],
	["logitech-g", ["logitech", "g hub"]],
	["insta360", ["insta360"]],
	// Windows' own apps and tools, as their macOS equivalents
	["preferences-security", ["windows security", "windows defender firewall"]],
	[
		"preferences-system",
		[
			"settings",
			"configuracion",
			"control panel",
			"windows tools",
			"system configuration",
			"computer management",
			"component services",
			"services",
			"local security policy",
			"odbc data sources",
			"iscsi initiator",
			"print management",
			"task scheduler"
		]
	],
	["calc", ["calculator", "calculadora"]],
	["accessories-camera", ["camera", "camara"]],
	["clock", ["clock", "reloj", "alarms"]],
	["calendar", ["calendar", "calendario"]],
	["internet-mail", ["mail", "correo"]],
	["shotwell", ["photos", "fotos"]],
	["gnome-maps", ["maps", "mapas"]],
	["indicator-weather", ["weather", "el tiempo", "clima"]],
	["sticky", ["sticky notes", "notas rapidas"]],
	[
		"gnome-sound-recorder",
		["sound recorder", "voice recorder", "grabadora de voz", "grabadora de sonidos"]
	],
	["org.gnome.Totem", ["movies", "peliculas", "movies tv"]],
	["softwarecenter", ["microsoft store"]],
	["file-manager", ["file explorer", "explorador de archivos", "=explorer"]],
	["accessories-screenshot", ["snipping tool", "herramienta recortes", "recortes"]],
	["rhythmbox", ["media player", "reproductor multimedia"]],
	[
		"utilities-system-monitor",
		[
			"task manager",
			"performance monitor",
			"resource monitor",
			"system informer",
			"memory diagnostic"
		]
	],
	["gnome-disks", ["defragment", "recovery drive", "disk management"]],
	["accessories-system-cleaner", ["disk cleanup"]],
	["deja-dup", ["windows backup"]],
	["remmina", ["remote desktop connection", "quick assist"]],
	["regedit", ["registry editor"]],
	["accessories-character-map", ["character map"]],
	["simplescreenrecorder", ["steps recorder", "recordly"]],
	["event-viewer", ["event viewer", "console"]],
	["accessibility", ["narrator", "magnifier", "voice access", "live captions"]],
	["onboard", ["on screen keyboard"]],
	// the rest of the everyday tools, each as the closest Mac equivalent
	["scanner", ["naps2"]],
	["okular", ["pdf24"]],
	["texstudio", ["texworks"]],
	["flameshot", ["sharex"]],
	["youtube-dl", ["yt dlg", "yt dlp"]],
	["synaptic", ["unigetui"]],
	["internet-news-reader", ["news"]],
	["help", ["get help", "get started"]],
	["modrinth", ["curseforge"]],
	["shotcut", ["clipchamp"]],
	["easyeffects", ["realtek audio console"]]
];

const hasPhrase = (words: string[], phrase: string[]) => {
	for (let i = 0; i + phrase.length <= words.length; i++) {
		if (phrase.every((w, j) => words[i + j] === w)) return true;
	}
	return false;
};

// Library icons that aren't an app: leave them out of name matching and the picker's main list.
const NOISE =
	/^(preferences-|distributor-logo|gnome-|kde|plasma|yast|xfce|budgie|application-|emblem-|applets-|cs-|indicator-|utilities-|system-|start-here|folder|mimetype|gtk-|ibus|fcitx|nm-|network-|audio-|video-|input-|drive-|media-|multimedia-|security-|dialog-|status-|user-)|-symbolic$|^(org|com|io|net|de|me|dev|fr|eu|uk|nl|ch|cc|xyz|space|page|ru|cn|info|biz|hu|pl|se|dk|fi|it|es|pt|br|jp|kr|us|ca|au|nz|at|be|cz|gr|il|in|no|ro|sk|tr|ua)\./i;

// Words too common to say which app a name is about.
const GENERIC_WORD = new Set([
	"microsoft",
	"windows",
	"google",
	"visual",
	"adobe",
	"mozilla",
	"apple",
	"open",
	"free",
	"the",
	"my",
	"app",
	"desktop",
	"pro",
	"install",
	"setup",
	"update",
	"launcher",
	"client",
	"developer",
	"debug",
	"tools",
	"tool",
	"sample",
	"windows",
	"manager",
	"viewer",
	"editor",
	"service",
	"services"
]);

// The library's own names, for apps the table above doesn't know: "AnyDesk" finds anydesk.svg.
const LIBRARY = (() => {
	const map = new Map<string, string>();
	for (const id of ICON_IDS) {
		if (NOISE.test(id)) continue;
		for (const key of [squash(id), squash(id.split(".").pop() ?? id)]) {
			if (key.length >= 4 && !map.has(key)) map.set(key, id);
		}
	}
	return map;
})();

function libraryMatch(name: string): string | null {
	const clean = name
		.replace(/\(.*?\)|\[.*?\]/g, " ")
		.replace(
			/\b(desktop|app|launcher|client|for windows|x64|x86|beta|stable|portable|setup|installer)\b/gi,
			" "
		)
		.replace(/[\d.]+$/g, " ");
	const words = tokens(clean);
	const tries = [squash(name), squash(clean)];
	if (words.length >= 2) tries.push(words.slice(0, 2).join(""));
	if (words[0] && words[0].length >= 5 && !GENERIC_WORD.has(words[0])) tries.push(words[0]);
	for (const key of tries) {
		const id = LIBRARY.get(key);
		if (id) return id;
	}
	return null;
}

/** The library icon that belongs to an app, or null when none fits. */
export function autoIconId(name: string, stem: string): string | null {
	const words = tokens(name);
	const exe = stem.toLowerCase();
	for (const [id, keys] of AUTO) {
		for (const key of keys) {
			if (key.startsWith("=") ? exe === key.slice(1) : hasPhrase(words, tokens(key))) return id;
		}
	}
	return libraryMatch(name);
}

// Windows' own apps the launcher lists from the start (full names, so "Settings"
// doesn't also pull in "WSL Settings").
const DEFAULT_APPS = [
	"settings",
	"configuracion",
	"calculator",
	"calculadora",
	"camera",
	"camara",
	"clock",
	"reloj",
	"calendar",
	"calendario",
	"mail",
	"correo",
	"photos",
	"fotos",
	"maps",
	"mapas",
	"weather",
	"el tiempo",
	"sticky notes",
	"notas rapidas",
	"sound recorder",
	"voice recorder",
	"grabadora de voz",
	"movies tv",
	"peliculas y tv",
	"microsoft store",
	"file explorer",
	"explorador de archivos",
	"snipping tool",
	"herramienta recortes",
	"media player",
	"notepad",
	"bloc de notas",
	"paint",
	"terminal",
	"windows terminal"
].map((n) => tokens(n).join(" "));

export const isDefaultApp = (name: string) => DEFAULT_APPS.includes(tokens(name).join(" "));

/** Every icon for the picker: the ones that match real apps first, then the rest of the library. */
export const ICONS: LauncherIcon[] = (() => {
	const featured = new Set<string>(BLOOM_IDS);
	for (const [id] of AUTO) featured.add(id);
	const make = (id: string): LauncherIcon => ({ id, label: prettify(id), url: iconUrl(id)! });
	const first = [...featured].filter((id) => IDS.has(id)).map(make);
	const rest = ICON_IDS.filter((id) => !featured.has(id) && !NOISE.test(id)).map(make);
	const byLabel = (a: LauncherIcon, b: LauncherIcon) => a.label.localeCompare(b.label);
	return [...first.sort(byLabel), ...rest.sort(byLabel)];
})();
