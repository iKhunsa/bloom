import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderPlus, Folders, Grid2x2, LayoutGrid, Trash2 } from "lucide-react";
import { SettingRow } from "./SettingRow";
import {
	buildPinnedKeys,
	buildUsageIndex,
	cleanApps,
	exeStem,
	isShown,
	type LauncherApp,
	type UsageEntry
} from "../launcher/apps";
import { autoIconId, iconUrl } from "../launcher/icons";
import { IconPicker } from "../launcher/IconPicker";
import {
	DEFAULT_LAYOUT,
	loadLayout,
	newFolderId,
	onLayoutChanged,
	saveLayout,
	type LauncherLayout
} from "../launcher/store";
import "./LaunchpadTab.css";

interface LaunchpadTabProps {
	launcherEnabled: boolean;
	toggleLauncher: () => void;
}

const PAGE = 40;

const USED_OPTIONS = [
	{ days: 30, label: "the last 30 days" },
	{ days: 90, label: "the last 3 months" },
	{ days: 180, label: "the last 6 months" },
	{ days: 365, label: "the last year" },
	{ days: 0, label: "any time" }
];

export function LaunchpadTab({ launcherEnabled, toggleLauncher }: LaunchpadTabProps) {
	const [layout, setLayout] = useState<LauncherLayout>(DEFAULT_LAYOUT);
	const [apps, setApps] = useState<LauncherApp[]>([]);
	const [usage, setUsage] = useState<UsageEntry[]>([]);
	const [pinned, setPinned] = useState<LauncherApp[]>([]);
	const [icons, setIcons] = useState<Record<string, string>>({});
	const [search, setSearch] = useState("");
	const [limit, setLimit] = useState(PAGE);
	const [picker, setPicker] = useState<LauncherApp | null>(null);
	const requested = useRef(new Set<string>());

	useEffect(() => {
		void loadLayout().then(setLayout);
		invoke<LauncherApp[]>("get_installed_apps")
			.then((list) => setApps(cleanApps(list)))
			.catch(() => {});
		invoke<UsageEntry[]>("get_launcher_usage")
			.then(setUsage)
			.catch(() => {});
		invoke<LauncherApp[]>("load_pinned_apps")
			.then(setPinned)
			.catch(() => {});
		return onLayoutChanged(() => void loadLayout().then(setLayout));
	}, []);

	const update = useCallback((change: (l: LauncherLayout) => LauncherLayout) => {
		setLayout((old) => {
			const next = change(old);
			saveLayout(next);
			return next;
		});
	}, []);

	const usageIndex = useMemo(() => buildUsageIndex(usage), [usage]);
	const pinnedKeys = useMemo(() => buildPinnedKeys(pinned), [pinned]);
	const now = Math.floor(Date.now() / 1000);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return q ? apps.filter((a) => a.name.toLowerCase().includes(q)) : apps;
	}, [apps, search]);
	const rows = filtered.slice(0, limit);

	const folderOf = useMemo(() => {
		const map = new Map<string, string>();
		for (const f of layout.folders) for (const p of f.apps) map.set(p, f.id);
		return map;
	}, [layout.folders]);

	const macFor = (app: LauncherApp) => {
		const choice = layout.icons[app.path];
		return choice === "windows" ? undefined : iconUrl(choice ?? autoIconId(app.name, exeStem(app)));
	};

	// Windows icons only for the rows on screen that have no library icon.
	useEffect(() => {
		const wanted = [...rows, ...(picker ? [picker] : [])].filter(
			(a) => !a.icon && !requested.current.has(a.path) && (!macFor(a) || picker === a)
		);
		wanted.forEach((a) => requested.current.add(a.path));
		let next = 0;
		const worker = async () => {
			while (next < wanted.length) {
				const app = wanted[next++];
				const icon = await invoke<string | null>("get_app_icon", {
					path: app.path,
					name: app.name
				}).catch(() => null);
				if (icon) setIcons((prev) => ({ ...prev, [app.path]: icon }));
			}
		};
		void Promise.all([worker(), worker(), worker()]);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rows.length, search, picker]);

	const setFolder = (app: LauncherApp, folderId: string) =>
		update((l) => ({
			...l,
			folders: l.folders.map((f) => {
				const rest = f.apps.filter((p) => p !== app.path);
				return f.id === folderId ? { ...f, apps: [...rest, app.path] } : { ...f, apps: rest };
			})
		}));

	return (
		<>
			<div className="setting-group-label">Launchpad</div>
			<div className="setting-group">
				<SettingRow
					icon={LayoutGrid}
					label="App Launcher"
					desc="The Win key and the Start button open this app grid instead of the Start menu"
				>
					<label className="toggle-switch">
						<input type="checkbox" checked={launcherEnabled} onChange={toggleLauncher} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={Grid2x2}
					label="Show Only Apps I Use"
					desc="Search always finds every installed app"
					divider={layout.onlyUsed}
				>
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={layout.onlyUsed}
							onChange={() => update((l) => ({ ...l, onlyUsed: !l.onlyUsed }))}
						/>
						<span className="slider"></span>
					</label>
				</SettingRow>

				{layout.onlyUsed && (
					<SettingRow
						icon={Grid2x2}
						label="Counts as Used"
						desc="Apps opened within this time, plus the ones pinned to the dock"
						divider={false}
					>
						<select
							className="settings-select"
							value={layout.usedDays}
							onChange={(e) => update((l) => ({ ...l, usedDays: parseInt(e.target.value) }))}
						>
							{USED_OPTIONS.map((o) => (
								<option key={o.days} value={o.days}>
									{o.label}
								</option>
							))}
						</select>
					</SettingRow>
				)}
			</div>

			<div className="setting-group-label">Folders</div>
			<div className="setting-group">
				{layout.folders.map((folder) => (
					<SettingRow
						key={folder.id}
						icon={Folders}
						label={`${folder.apps.length} ${folder.apps.length === 1 ? "app" : "apps"}`}
					>
						<input
							className="lpt-input"
							defaultValue={folder.name}
							onBlur={(e) => {
								const name = e.currentTarget.value.trim() || "Folder";
								update((l) => ({
									...l,
									folders: l.folders.map((f) => (f.id === folder.id ? { ...f, name } : f))
								}));
							}}
						/>
						<button
							className="lpt-icon-btn"
							title="Delete folder"
							onClick={() =>
								update((l) => ({ ...l, folders: l.folders.filter((f) => f.id !== folder.id) }))
							}
						>
							<Trash2 size={14} />
						</button>
					</SettingRow>
				))}
				<SettingRow
					icon={FolderPlus}
					label="New Folder"
					desc="Then give it apps from the list below, or drag them in the launcher"
					divider={false}
					action
					onClick={() =>
						update((l) => ({
							...l,
							folders: [...l.folders, { id: newFolderId(), name: "Folder", apps: [] }]
						}))
					}
				/>
			</div>

			<div className="setting-group-label">Apps</div>
			<div className="setting-group lpt-apps">
				<div className="lpt-search">
					<input
						value={search}
						placeholder="Search installed apps"
						spellCheck={false}
						onChange={(e) => {
							setSearch(e.target.value);
							setLimit(PAGE);
						}}
					/>
				</div>
				{rows.map((app) => {
					const shown = isShown(app, layout, usageIndex, pinnedKeys, now);
					const override = layout.visibility[app.path] ?? "auto";
					const src = macFor(app) ?? app.icon ?? icons[app.path];
					return (
						<div className="lpt-app" key={app.path}>
							<button className="lpt-icon" title="Change icon" onClick={() => setPicker(app)}>
								{src ? <img src={src} alt="" /> : <span>{app.name.charAt(0).toUpperCase()}</span>}
							</button>
							<div className="lpt-app-info">
								<span className="lpt-app-name">{app.name}</span>
								<span className={`lpt-app-state ${shown ? "on" : ""}`}>
									{shown ? "In Launchpad" : "Search only"}
								</span>
							</div>
							<select
								className="settings-select lpt-select"
								value={override}
								title="Visibility"
								onChange={(e) => {
									const value = e.target.value;
									update((l) => {
										const next = { ...l.visibility };
										if (value === "auto") delete next[app.path];
										else next[app.path] = value as "show" | "hide";
										return { ...l, visibility: next };
									});
								}}
							>
								<option value="auto">Automatic</option>
								<option value="show">Always show</option>
								<option value="hide">Hide</option>
							</select>
							<select
								className="settings-select lpt-select"
								value={folderOf.get(app.path) ?? ""}
								title="Folder"
								onChange={(e) => {
									const id = e.target.value;
									if (id) setFolder(app, id);
									else
										update((l) => ({
											...l,
											folders: l.folders.map((f) => ({
												...f,
												apps: f.apps.filter((p) => p !== app.path)
											}))
										}));
								}}
							>
								<option value="">No folder</option>
								{layout.folders.map((f) => (
									<option key={f.id} value={f.id}>
										{f.name}
									</option>
								))}
							</select>
						</div>
					);
				})}
				{filtered.length > rows.length && (
					<button className="lpt-more" onClick={() => setLimit((n) => n + PAGE)}>
						Show more ({filtered.length - rows.length})
					</button>
				)}
				{filtered.length === 0 && <div className="lpt-empty">No apps found</div>}
			</div>

			{picker && (
				<IconPicker
					appName={picker.name}
					current={layout.icons[picker.path]}
					autoId={autoIconId(picker.name, exeStem(picker))}
					windowsIcon={picker.icon ?? icons[picker.path]}
					onClose={() => setPicker(null)}
					onPick={(choice) => {
						const app = picker;
						update((l) => {
							const next = { ...l.icons };
							if (choice === null) delete next[app.path];
							else next[app.path] = choice;
							return { ...l, icons: next };
						});
						setPicker(null);
					}}
				/>
			)}
		</>
	);
}
