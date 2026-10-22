import { isDefaultApp } from "./icons";
import type { LauncherLayout } from "./store";

export interface LauncherApp {
	name: string;
	path: string;
	executable?: string | null;
	icon?: string | null;
}

export interface UsageEntry {
	key: string;
	count: number;
	last_run: number;
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const stemOf = (p: string) => baseName(p).replace(/\.(exe|lnk|url|bat|cmd)$/i, "");
const squash = (text: string) =>
	text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");

/** Executable name without extension, lowercased: "Discord.exe" -> "discord". */
export const exeStem = (app: LauncherApp) =>
	stemOf(
		app.executable || (app.path.includes("\\") || app.path.includes("/") ? app.path : "")
	).toLowerCase();

/** Uninstallers, manuals, licences and web links that installers leave in the Start menu aren't apps. */
export const isJunk = (app: LauncherApp) =>
	/uninstall|desinstal|readme|release notes|revision history|\bfaqs?\b|frequently asked|documentation|dokumentation|user manuals?|\bmanuals?\b|\bdocs\b|\bhelp\b|licen[cs]e|homepage|web ?site|\bon the web\b|example scripts|verbose log|^help$/i.test(
		app.name
	);

const MAX_AGE_SECONDS = (days: number) => (days > 0 ? days * 86400 : Infinity);

/** What identifies an app in Windows' launch record, in the forms it may appear. */
function appKeys(app: LauncherApp): string[] {
	const keys = new Set<string>();
	keys.add(app.path.toLowerCase());
	if (app.path.includes("\\") || app.path.includes("/")) {
		keys.add(baseName(app.path).toLowerCase());
		keys.add(stemOf(app.path).toLowerCase());
	}
	if (app.executable) {
		keys.add(app.executable.toLowerCase());
		keys.add(stemOf(app.executable).toLowerCase());
	}
	keys.add(squash(app.name));
	return [...keys].filter((k) => k.length > 2);
}

export function buildUsageIndex(usage: UsageEntry[]) {
	const index = new Map<string, UsageEntry>();
	const put = (key: string, entry: UsageEntry) => {
		if (key.length <= 2) return;
		const old = index.get(key);
		if (!old || entry.last_run > old.last_run) index.set(key, entry);
	};
	for (const entry of usage) {
		const lower = entry.key.toLowerCase();
		put(lower, entry);
		const base = baseName(lower);
		put(base, entry);
		put(stemOf(base), entry);
		put(squash(stemOf(base)), entry);
	}
	return index;
}

export type UsageIndex = ReturnType<typeof buildUsageIndex>;

/** Pinned dock apps count as used: the user chose them. */
export function buildPinnedKeys(pinned: LauncherApp[]) {
	const keys = new Set<string>();
	for (const app of pinned) appKeys(app).forEach((k) => keys.add(k));
	return keys;
}

export function isShown(
	app: LauncherApp,
	layout: LauncherLayout,
	usage: UsageIndex,
	pinnedKeys: Set<string>,
	nowSeconds: number
): boolean {
	const override = layout.visibility[app.path];
	if (override) return override === "show";
	if (!layout.onlyUsed) return true;
	const keys = appKeys(app);
	if (keys.some((k) => pinnedKeys.has(k))) return true;
	if (isDefaultApp(app.name)) return true;
	const maxAge = MAX_AGE_SECONDS(layout.usedDays);
	return keys.some((k) => {
		const entry = usage.get(k);
		return !!entry && entry.count > 0 && nowSeconds - entry.last_run <= maxAge;
	});
}

export const sortByName = <T extends { name: string }>(items: T[]) =>
	[...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

/** The installed-apps list with leftovers and duplicate names removed. */
export function cleanApps(list: LauncherApp[]): LauncherApp[] {
	const seen = new Set<string>();
	return sortByName(
		list.filter((a) => {
			if (!a.name.trim() || isJunk(a)) return false;
			const key = a.name.trim().toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
	);
}
