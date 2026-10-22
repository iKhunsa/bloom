import { invoke } from "@tauri-apps/api/core";

export interface LauncherFolder {
	id: string;
	name: string;
	/** Paths of the apps inside, as the installed-apps list reports them. */
	apps: string[];
}

export interface LauncherLayout {
	folders: LauncherFolder[];
	/** Chosen icon per app path: a library id, or "windows" for the app's own icon. */
	icons: Record<string, string>;
	/** Per-app override of what the usage rules decide. */
	visibility: Record<string, "show" | "hide">;
	/** Show only the apps in use (and Windows' own) until the user searches. */
	onlyUsed: boolean;
	/** How recent a launch counts as "in use"; 0 means any time. */
	usedDays: number;
	/** The pages as the user arranged them (item keys); what isn't listed fills in by name. */
	pages: string[][];
}

export const DEFAULT_LAYOUT: LauncherLayout = {
	folders: [],
	icons: {},
	visibility: {},
	onlyUsed: true,
	usedDays: 180,
	pages: []
};

const KEY = "bloom-launcher-layout";

const parse = (raw: string | null | undefined): LauncherLayout => {
	if (!raw) return DEFAULT_LAYOUT;
	try {
		return { ...DEFAULT_LAYOUT, ...JSON.parse(raw) };
	} catch {
		return DEFAULT_LAYOUT;
	}
};

export async function loadLayout(): Promise<LauncherLayout> {
	try {
		const settings = await invoke<Record<string, unknown>>("load_settings");
		const stored = settings[KEY];
		return parse(typeof stored === "string" ? stored : localStorage.getItem(KEY));
	} catch {
		return parse(localStorage.getItem(KEY));
	}
}

export function saveLayout(layout: LauncherLayout) {
	const json = JSON.stringify(layout);
	localStorage.setItem(KEY, json);
	invoke("save_setting", { key: KEY, value: json }).catch(console.error);
}

/** Runs when another window (Settings or the launcher) saved a new layout. */
export function onLayoutChanged(callback: () => void): () => void {
	const handler = (e: StorageEvent) => {
		if (e.key === KEY) callback();
	};
	window.addEventListener("storage", handler);
	return () => window.removeEventListener("storage", handler);
}

export const newFolderId = () => `f${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
