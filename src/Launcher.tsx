import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "framer-motion";
import {
	DndContext,
	DragOverlay,
	PointerSensor,
	useDraggable,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragStartEvent
} from "@dnd-kit/core";
import { ChevronRight, Search } from "lucide-react";
import {
	buildPinnedKeys,
	buildUsageIndex,
	cleanApps,
	exeStem,
	isShown,
	sortByName,
	type LauncherApp,
	type UsageEntry
} from "./launcher/apps";
import { autoIconId, iconUrl } from "./launcher/icons";
import { IconPicker } from "./launcher/IconPicker";
import {
	loadLayout,
	newFolderId,
	onLayoutChanged,
	saveLayout,
	DEFAULT_LAYOUT,
	type LauncherFolder,
	type LauncherLayout
} from "./launcher/store";

// Space kept for the notch above and the dock below, which stay on top.
const TOP_SPACE = 150;
const BOTTOM_SPACE = 190;
const CELL_WIDTH = 170;
const CELL_HEIGHT = 148;
const MAX_GRID_WIDTH = 1400;
// Ignore focus loss right after opening, while Windows hands over focus.
const BLUR_GRACE_MS = 600;

type Item =
	| { kind: "app"; key: string; name: string; app: LauncherApp }
	| { kind: "folder"; key: string; name: string; folder: LauncherFolder };

interface MenuState {
	x: number;
	y: number;
	kind: "app" | "folder" | "empty";
	app?: LauncherApp;
	folderId?: string;
	/** The folder an app was opened from, so it can be taken out again. */
	fromFolder?: string;
}

/** How a Windows icon should sit in its macOS-style tile. */
interface IconLook {
	full: boolean;
	light: boolean;
}

// Reads a small copy of the icon to tell full-bleed icons from logos on
// transparency, and light logos from dark ones.
function useIconLook(src: string | undefined): IconLook | null {
	const [look, setLook] = useState<IconLook | null>(null);
	useEffect(() => {
		setLook(null);
		if (!src) return;
		let cancelled = false;
		const img = new Image();
		img.onload = () => {
			if (cancelled) return;
			const size = 24;
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = size;
			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			if (!ctx) return;
			ctx.drawImage(img, 0, 0, size, size);
			const { data } = ctx.getImageData(0, 0, size, size);
			const alphaAt = (x: number, y: number) => data[(y * size + x) * 4 + 3];
			const corners = [
				alphaAt(0, 0),
				alphaAt(size - 1, 0),
				alphaAt(0, size - 1),
				alphaAt(size - 1, size - 1)
			];
			let lum = 0;
			let count = 0;
			for (let i = 0; i < data.length; i += 4) {
				if (data[i + 3] < 128) continue;
				lum += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
				count++;
			}
			setLook({
				full: corners.every((a) => a > 235),
				light: count > 0 && lum / count > 0.82
			});
		};
		img.src = src;
		return () => {
			cancelled = true;
		};
	}, [src]);
	return look;
}

interface Resolved {
	/** Library (macOS-style) icon, when the app has one. */
	mac?: string;
	/** The app's own Windows icon, as a fallback. */
	win?: string;
}

function TileIcon({ icon, name }: { icon: Resolved; name: string }) {
	const look = useIconLook(icon.mac ? undefined : icon.win);
	const kind = icon.mac
		? "mac"
		: !icon.win
			? "empty"
			: look?.full
				? "full"
				: look?.light
					? "dark"
					: "light";
	const src = icon.mac ?? icon.win;
	return (
		<span className={`lp-tile ${kind}`}>
			{src ? (
				<img src={src} alt="" draggable={false} />
			) : (
				<span className="lp-letter">{name.charAt(0).toUpperCase()}</span>
			)}
		</span>
	);
}

interface AppTileProps {
	app: LauncherApp;
	icon: Resolved;
	selected: boolean;
	merging: boolean;
	dnd: boolean;
	onLaunch: (app: LauncherApp) => void;
	onMenu: (e: React.MouseEvent, app: LauncherApp) => void;
}

function AppTile({ app, icon, selected, merging, dnd, onLaunch, onMenu }: AppTileProps) {
	const id = `app:${app.path}`;
	const drag = useDraggable({ id, disabled: !dnd });
	return (
		<button
			ref={drag.setNodeRef}
			data-tile={id}
			{...drag.listeners}
			{...drag.attributes}
			className={`lp-app ${selected ? "selected" : ""} ${merging ? "drop-target" : ""} ${
				drag.isDragging ? "dragging" : ""
			}`}
			onClick={(e) => {
				e.stopPropagation();
				onLaunch(app);
			}}
			onContextMenu={(e) => onMenu(e, app)}
			title={app.name}
		>
			<TileIcon icon={icon} name={app.name} />
			<span className="lp-name">{app.name}</span>
		</button>
	);
}

function FolderTile({
	folder,
	previews,
	selected,
	merging,
	onOpen,
	onMenu
}: {
	folder: LauncherFolder;
	previews: Resolved[];
	selected: boolean;
	merging: boolean;
	onOpen: (folder: LauncherFolder) => void;
	onMenu: (e: React.MouseEvent, folder: LauncherFolder) => void;
}) {
	return (
		<button
			data-tile={`folder:${folder.id}`}
			className={`lp-app ${selected ? "selected" : ""} ${merging ? "drop-target" : ""}`}
			onClick={(e) => {
				e.stopPropagation();
				onOpen(folder);
			}}
			onContextMenu={(e) => onMenu(e, folder)}
			title={folder.name}
		>
			<span className="lp-tile lp-folder-tile">
				<span className="lp-folder-grid">
					{previews.slice(0, 9).map((icon, i) => (
						<span key={i} className="lp-mini">
							{(icon.mac ?? icon.win) && (
								<img src={icon.mac ?? icon.win} alt="" draggable={false} />
							)}
						</span>
					))}
				</span>
			</span>
			<span className="lp-name">{folder.name}</span>
		</button>
	);
}

export default function Launcher() {
	const [apps, setApps] = useState<LauncherApp[]>([]);
	const [usage, setUsage] = useState<UsageEntry[]>([]);
	const [pinned, setPinned] = useState<LauncherApp[]>([]);
	const [layout, setLayout] = useState<LauncherLayout>(DEFAULT_LAYOUT);
	const [wallpaper, setWallpaper] = useState<string | null>(null);
	const [icons, setIcons] = useState<Record<string, string>>({});
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(0);
	const [selected, setSelected] = useState(0);
	const [grid, setGrid] = useState({ cols: 8, rows: 5 });
	const [menu, setMenu] = useState<MenuState | null>(null);
	const [menuFolders, setMenuFolders] = useState(false);
	const [picker, setPicker] = useState<LauncherApp | null>(null);
	const [openFolderId, setOpenFolderId] = useState<string | null>(null);
	const [renameFolder, setRenameFolder] = useState(false);
	const [dragging, setDragging] = useState<LauncherApp | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const requested = useRef(new Set<string>());
	const openedAt = useRef(0);
	const wheelAt = useRef(0);

	const perPage = grid.cols * grid.rows;
	const searching = query.trim() !== "";
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

	const updateLayout = useCallback((change: (l: LauncherLayout) => LauncherLayout) => {
		setLayout((old) => {
			const next = change(old);
			saveLayout(next);
			return next;
		});
	}, []);

	const byPath = useMemo(() => new Map(apps.map((a) => [a.path, a])), [apps]);
	const folderOf = useMemo(() => {
		const map = new Map<string, string>();
		for (const f of layout.folders) for (const p of f.apps) map.set(p, f.id);
		return map;
	}, [layout.folders]);

	const usageIndex = useMemo(() => buildUsageIndex(usage), [usage]);
	const pinnedKeys = useMemo(() => buildPinnedKeys(pinned), [pinned]);

	const shownByRules = useCallback(
		(app: LauncherApp) =>
			isShown(app, layout, usageIndex, pinnedKeys, Math.floor(Date.now() / 1000)),
		[layout, usageIndex, pinnedKeys]
	);

	// What the grid lists: the apps in use and the folders, or every app when searching.
	const items = useMemo<Item[]>(() => {
		if (searching) {
			const q = query.trim().toLowerCase();
			return apps
				.filter((a) => a.name.toLowerCase().includes(q))
				.map((app) => ({ kind: "app", key: `app:${app.path}`, name: app.name, app }));
		}
		const folders: Item[] = layout.folders.map((folder) => ({
			kind: "folder",
			key: `folder:${folder.id}`,
			name: folder.name,
			folder
		}));
		const loose: Item[] = apps
			.filter((a) => !folderOf.has(a.path) && shownByRules(a))
			.map((app) => ({ kind: "app", key: `app:${app.path}`, name: app.name, app }));
		return sortByName([...folders, ...loose]);
	}, [searching, query, apps, layout.folders, folderOf, shownByRules]);

	// The pages: the user's own arrangement first; apps it doesn't mention fill in by name.
	const pageList = useMemo<Item[][]>(() => {
		const pages: Item[][] = [];
		if (searching) {
			for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
			return pages.length ? pages : [[]];
		}
		const byKey = new Map(items.map((i) => [i.key, i]));
		const placed = new Set<string>();
		for (const keys of layout.pages) {
			const row = keys.map((k) => byKey.get(k)).filter((i): i is Item => !!i);
			row.forEach((i) => placed.add(i.key));
			for (let i = 0; i < row.length; i += perPage) pages.push(row.slice(i, i + perPage));
		}
		for (const item of items.filter((i) => !placed.has(i.key))) {
			let last = pages[pages.length - 1];
			if (!last || last.length >= perPage) {
				last = [];
				pages.push(last);
			}
			last.push(item);
		}
		const filled = pages.filter((p) => p.length > 0);
		return filled.length ? filled : [[]];
	}, [searching, items, layout.pages, perPage]);

	// While dragging, one more page waits at the end for an app to be dropped on it.
	const offerNewPage = dragging !== null && pageList[pageList.length - 1].length > 0;
	const pages = offerNewPage ? [...pageList, []] : pageList;
	const pageCount = pages.length;

	const resolve = useCallback(
		(app: LauncherApp): Resolved => {
			const win = app.icon ?? icons[app.path];
			const choice = layout.icons[app.path];
			if (choice === "windows") return { win };
			const mac = iconUrl(choice ?? autoIconId(app.name, exeStem(app)));
			return mac ? { mac, win } : { win };
		},
		[icons, layout.icons]
	);

	// Fit the grid to the screen: as many columns and rows as there is room for.
	useEffect(() => {
		const measure = () => {
			const width = Math.min(window.innerWidth - 160, MAX_GRID_WIDTH);
			setGrid({
				cols: Math.max(4, Math.floor(width / CELL_WIDTH)),
				rows: Math.max(2, Math.floor((window.innerHeight - TOP_SPACE - BOTTOM_SPACE) / CELL_HEIGHT))
			});
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, []);

	const loadData = useCallback(async () => {
		try {
			const list = await invoke<LauncherApp[]>("get_installed_apps");
			setApps(cleanApps(list));
		} catch (e) {
			console.error("[launcher] could not list apps:", e);
		}
		invoke<UsageEntry[]>("get_launcher_usage")
			.then(setUsage)
			.catch(() => setUsage([]));
		invoke<LauncherApp[]>("load_pinned_apps")
			.then(setPinned)
			.catch(() => setPinned([]));
		loadLayout().then(setLayout);
	}, []);

	const close = useCallback(() => setOpen(false), []);

	// The wallpaper is read and decoded ahead of time, so the first opening already
	// shows the blur instead of a placeholder while it loads.
	const loadWallpaper = useCallback(() => {
		invoke<string | null>("get_launcher_wallpaper")
			.then((w) => {
				if (!w) return;
				const img = new Image();
				img.src = w;
				return img.decode().then(() => setWallpaper(w));
			})
			.catch(() => {});
	}, []);
	useEffect(() => loadWallpaper(), [loadWallpaper]);

	// Opened or closed from the backend (Win tap, dock Start button).
	useEffect(() => {
		const unlistenOpen = listen("launcher-open", () => {
			openedAt.current = Date.now();
			setQuery("");
			setPage(0);
			setSelected(0);
			setMenu(null);
			setPicker(null);
			setOpenFolderId(null);
			setOpen(true);
			void loadData();
			loadWallpaper();
		});
		const unlistenClose = listen("launcher-close", () => setOpen(false));
		return () => {
			unlistenOpen.then((f) => f());
			unlistenClose.then((f) => f());
		};
	}, [loadData, loadWallpaper]);

	// Settings may change the layout while the launcher is open.
	useEffect(() => onLayoutChanged(() => void loadLayout().then(setLayout)), []);

	// Clicking away (another window gets focus) closes it, like Launchpad.
	useEffect(() => {
		const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
			if (!focused && Date.now() - openedAt.current > BLUR_GRACE_MS) setOpen(false);
		});
		return () => {
			unlisten.then((f) => f());
		};
	}, []);

	useEffect(() => {
		if (open && !openFolderId && !picker) inputRef.current?.focus();
	}, [open, openFolderId, picker]);

	// Windows icons load on demand, only for apps that have no library icon.
	const visibleApps = useMemo(() => {
		const list: LauncherApp[] = [];
		for (const item of pageList.slice(page, page + 2).flat()) {
			if (item.kind === "app") list.push(item.app);
			else
				for (const p of item.folder.apps.slice(0, 9)) {
					const app = byPath.get(p);
					if (app) list.push(app);
				}
		}
		const folder = layout.folders.find((f) => f.id === openFolderId);
		if (folder)
			for (const p of folder.apps) {
				const app = byPath.get(p);
				if (app) list.push(app);
			}
		if (picker) list.push(picker);
		return list;
	}, [pageList, page, layout.folders, openFolderId, byPath, picker]);

	useEffect(() => {
		if (!open) return;
		const wanted = visibleApps.filter(
			(a) => !a.icon && (!resolve(a).mac || picker === a) && !requested.current.has(a.path)
		);
		wanted.forEach((a) => requested.current.add(a.path));
		let next = 0;
		const worker = async () => {
			while (next < wanted.length) {
				const app = wanted[next++];
				try {
					const icon = await invoke<string | null>("get_app_icon", {
						path: app.path,
						name: app.name
					});
					if (icon) setIcons((prev) => ({ ...prev, [app.path]: icon }));
				} catch {
					// The tile keeps its letter.
				}
			}
		};
		void Promise.all([worker(), worker(), worker(), worker()]);
	}, [open, visibleApps, resolve, picker]);

	useEffect(() => {
		setPage((p) => Math.min(p, pageCount - 1));
	}, [pageCount]);

	const launch = useCallback(
		(app: LauncherApp) => {
			invoke("open_app", { appName: app.path }).catch(console.error);
			close();
		},
		[close]
	);

	const goToPage = useCallback(
		(p: number) => {
			setPage(Math.max(0, Math.min(pageCount - 1, p)));
			setSelected(0);
		},
		[pageCount]
	);

	// A lone Win tap closes the launcher. The Win key lands here when the
	// launcher has focus, where the global hook doesn't see it, so Windows would
	// open Start on release unless another key joins the press first.
	const winAlone = useRef(false);
	const maskUntil = useRef(0);
	useEffect(() => {
		if (!open) return;
		const down = (e: KeyboardEvent) => {
			if (e.key === "Meta") {
				if (!e.repeat) {
					winAlone.current = true;
					maskUntil.current = Date.now() + 250;
					invoke("mask_win_key").catch(console.error);
				}
			} else if (Date.now() > maskUntil.current) {
				// Win+something is a shortcut, not a tap.
				winAlone.current = false;
			}
		};
		const up = (e: KeyboardEvent) => {
			if (e.key !== "Meta") return;
			if (winAlone.current) close();
			winAlone.current = false;
		};
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
		};
	}, [open, close]);

	const openFolder = openFolderId ? layout.folders.find((f) => f.id === openFolderId) : undefined;

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (picker) return; // the picker handles its own keys
			if (e.key === "Escape") {
				if (menu) setMenu(null);
				else if (openFolderId) setOpenFolderId(null);
				else if (query) setQuery("");
				else close();
				return;
			}
			if (openFolderId || menu) return;
			const current = pageList[page] ?? [];
			const last = current.length - 1;
			if (e.key === "Enter") {
				const item = current[selected];
				if (item?.kind === "app") launch(item.app);
				else if (item?.kind === "folder") setOpenFolderId(item.folder.id);
			} else if (e.key === "ArrowRight") {
				e.preventDefault();
				if (selected < last) setSelected(selected + 1);
				else if (page < pageCount - 1) goToPage(page + 1);
			} else if (e.key === "ArrowLeft") {
				e.preventDefault();
				if (selected > 0) setSelected(selected - 1);
				else if (page > 0) goToPage(page - 1);
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelected(Math.min(selected + grid.cols, Math.max(0, last)));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelected(Math.max(selected - grid.cols, 0));
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [
		open,
		picker,
		menu,
		openFolderId,
		query,
		page,
		perPage,
		selected,
		pageList,
		grid.cols,
		pageCount,
		close,
		launch,
		goToPage
	]);

	// Wheel or two-finger swipe flips pages.
	const onWheel = (e: React.WheelEvent) => {
		if (openFolderId) return;
		const now = Date.now();
		if (now - wheelAt.current < 400) return;
		const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
		if (Math.abs(delta) < 8) return;
		wheelAt.current = now;
		goToPage(page + (delta > 0 ? 1 : -1));
	};

	// ── folders ──
	const createFolder = (inside: string[] = []) => {
		const folder: LauncherFolder = { id: newFolderId(), name: "Folder", apps: inside };
		updateLayout((l) => ({ ...l, folders: [...l.folders, folder] }));
		setOpenFolderId(folder.id);
		setRenameFolder(true);
	};

	const addToFolder = (path: string, folderId: string) =>
		updateLayout((l) => ({
			...l,
			folders: l.folders.map((f) => {
				const rest = f.apps.filter((p) => p !== path);
				return f.id === folderId ? { ...f, apps: [...rest, path] } : { ...f, apps: rest };
			})
		}));

	const removeFromFolder = (path: string) =>
		updateLayout((l) => ({
			...l,
			folders: l.folders.map((f) => ({ ...f, apps: f.apps.filter((p) => p !== path) }))
		}));

	const renameFolderTo = (id: string, name: string) =>
		updateLayout((l) => ({
			...l,
			folders: l.folders.map((f) => (f.id === id ? { ...f, name: name.trim() || "Folder" } : f))
		}));

	const deleteFolder = (id: string) => {
		updateLayout((l) => ({ ...l, folders: l.folders.filter((f) => f.id !== id) }));
		setOpenFolderId((cur) => (cur === id ? null : cur));
	};

	// ── drag and drop ──
	const onDragStart = (e: DragStartEvent) => {
		const path = String(e.active.id).replace(/^app:/, "");
		setDragging(byPath.get(path) ?? null);
	};

	// Puts an item on a page at a position; a page that overflows pushes its last one on.
	const place = (key: string, target: number, index: number) => {
		const rows = pageList.map((p) => p.map((i) => i.key).filter((k) => k !== key));
		while (rows.length <= target) rows.push([]);
		rows[target].splice(Math.min(index, rows[target].length), 0, key);
		for (let i = 0; i < rows.length; i++) {
			while (rows[i].length > perPage) {
				if (i + 1 === rows.length) rows.push([]);
				rows[i + 1].unshift(rows[i].pop()!);
			}
		}
		updateLayout((l) => ({ ...l, pages: rows.filter((r) => r.length > 0) }));
	};

	// Where a drop would land, from the pointer: on an icon's middle it joins it in a
	// folder, beside an icon it goes before or after it, in empty space it goes last.
	const pointer = useRef({ x: 0, y: 0 });
	const pagesRef = useRef<HTMLDivElement>(null);
	const [hint, setHint] = useState<
		| { mode: "merge"; key: string }
		| { mode: "insert"; index: number; x: number; y: number; h: number }
		| null
	>(null);
	const hintRef = useRef(hint);
	hintRef.current = hint;

	const measureDrop = (dragKey: string) => {
		const frame = pagesRef.current?.querySelector(".lp-strip")?.children[page] as
			| HTMLElement
			| undefined;
		const tiles = [...(frame?.querySelectorAll<HTMLElement>("[data-tile]") ?? [])].filter(
			(t) => t.dataset.tile !== dragKey
		);
		const { x, y } = pointer.current;
		const rects = tiles.map((t) => t.getBoundingClientRect());
		for (let i = 0; i < tiles.length; i++) {
			const r = rects[i];
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			if (Math.abs(x - cx) < r.width * 0.22 && Math.abs(y - cy) < r.height * 0.3) {
				return { mode: "merge" as const, key: tiles[i].dataset.tile! };
			}
		}
		const order = (pageList[page] ?? []).map((i) => i.key).filter((k) => k !== dragKey);
		if (tiles.length === 0)
			return { mode: "insert" as const, index: 0, x: window.innerWidth / 2, y: TOP_SPACE, h: 90 };
		let best = 0;
		let bestDist = Infinity;
		rects.forEach((r, i) => {
			const d = Math.hypot(x - (r.left + r.width / 2), (y - (r.top + r.height / 2)) * 1.6);
			if (d < bestDist) {
				bestDist = d;
				best = i;
			}
		});
		const r = rects[best];
		const after = x > r.left + r.width / 2;
		const at = order.indexOf(tiles[best].dataset.tile!);
		return {
			mode: "insert" as const,
			index: at + (after ? 1 : 0),
			x: after ? r.right : r.left,
			y: r.top + 4,
			h: r.height * 0.62
		};
	};

	useEffect(() => {
		if (!dragging) {
			setHint(null);
			return;
		}
		const dragKey = `app:${dragging.path}`;
		const onMove = (e: PointerEvent) => {
			pointer.current = { x: e.clientX, y: e.clientY };
		};
		window.addEventListener("pointermove", onMove);
		let edgeFor = 0;
		const timer = window.setInterval(() => {
			const { x } = pointer.current;
			const edge = x > window.innerWidth - 90 ? 1 : x < 90 ? -1 : 0;
			if (edge === 0) edgeFor = 0;
			else {
				edgeFor += 80;
				if (edgeFor >= 600) {
					edgeFor = -300;
					setPage((p) => Math.max(0, Math.min(pageCount - 1, p + edge)));
				}
			}
			const next = measureDrop(dragKey);
			if (JSON.stringify(next) !== JSON.stringify(hintRef.current)) setHint(next);
		}, 80);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.clearInterval(timer);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dragging, page, pageCount, pageList]);

	const onDragEnd = (e: DragEndEvent) => {
		const path = String(e.active.id).replace(/^app:/, "");
		const key = `app:${path}`;
		const where = dragging ? measureDrop(key) : null;
		setDragging(null);
		if (!where) return;
		if (where.mode === "insert") {
			place(key, page, where.index);
		} else if (where.key.startsWith("folder:")) {
			addToFolder(path, where.key.slice("folder:".length));
		} else {
			const other = where.key.slice("app:".length);
			// Dropping an app on another one makes a folder of the two.
			if (!folderOf.has(other) && !folderOf.has(path)) createFolder([other, path]);
		}
	};

	// ── menus ──
	const openMenu = (e: React.MouseEvent, state: Omit<MenuState, "x" | "y">) => {
		e.preventDefault();
		e.stopPropagation();
		setMenuFolders(false);
		setMenu({ ...state, x: e.clientX, y: e.clientY });
	};

	const appMenu = (e: React.MouseEvent, app: LauncherApp, fromFolder?: string) =>
		openMenu(e, { kind: "app", app, fromFolder });

	const menuStyle = menu
		? {
				left: Math.min(menu.x, window.innerWidth - 230),
				top: Math.min(menu.y, window.innerHeight - 260)
			}
		: undefined;

	return (
		<AnimatePresence onExitComplete={() => invoke("hide_launcher").catch(console.error)}>
			{open && (
				<motion.div
					key="launcher"
					className="lp"
					initial={{ opacity: 0, scale: 1.08 }}
					animate={{ opacity: 1, scale: 1 }}
					exit={{ opacity: 0, scale: 1.05, transition: { duration: 0.18 } }}
					transition={{ type: "spring", stiffness: 260, damping: 30 }}
					onClick={() => {
						if (menu) setMenu(null);
						else close();
					}}
					onContextMenu={(e) => openMenu(e, { kind: "empty" })}
					onWheel={onWheel}
				>
					<div
						className={`lp-bg ${wallpaper ? "ready" : ""}`}
						style={wallpaper ? { backgroundImage: `url(${wallpaper})` } : undefined}
					/>

					<div className="lp-search" onClick={(e) => e.stopPropagation()}>
						<Search size={16} />
						<input
							ref={inputRef}
							value={query}
							placeholder="Search apps"
							spellCheck={false}
							onChange={(e) => {
								setQuery(e.target.value);
								setPage(0);
								setSelected(0);
							}}
						/>
					</div>

					<DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
						<div
							ref={pagesRef}
							className="lp-pages"
							style={{ top: TOP_SPACE, bottom: BOTTOM_SPACE }}
						>
							<div className="lp-strip" style={{ transform: `translateX(-${page * 100}%)` }}>
								{pages.map((pageItems, p) => (
									<div
										key={p}
										className="lp-page"
										style={{
											gridTemplateColumns: `repeat(${grid.cols}, ${CELL_WIDTH}px)`,
											gridAutoRows: `${CELL_HEIGHT}px`
										}}
									>
										{Math.abs(p - page) <= 1 &&
											pageItems.map((item, i) =>
												item.kind === "app" ? (
													<AppTile
														key={item.key}
														app={item.app}
														icon={resolve(item.app)}
														selected={p === page && i === selected}
														merging={hint?.mode === "merge" && hint.key === item.key}
														dnd={!searching}
														onLaunch={launch}
														onMenu={(e, a) => appMenu(e, a)}
													/>
												) : (
													<FolderTile
														key={item.key}
														folder={item.folder}
														previews={item.folder.apps
															.map((path) => byPath.get(path))
															.filter((a): a is LauncherApp => !!a)
															.map(resolve)}
														selected={p === page && i === selected}
														merging={hint?.mode === "merge" && hint.key === item.key}
														onOpen={(f) => setOpenFolderId(f.id)}
														onMenu={(e, f) => openMenu(e, { kind: "folder", folderId: f.id })}
													/>
												)
											)}
									</div>
								))}
							</div>
							{items.length === 0 && (
								<div className="lp-empty">
									{searching ? "No apps found" : "No apps yet. Search to find any app."}
								</div>
							)}
						</div>
						{hint?.mode === "insert" && (
							<div className="lp-hint" style={{ left: hint.x - 2, top: hint.y, height: hint.h }} />
						)}
						<DragOverlay dropAnimation={null}>
							{dragging && (
								<div className="lp-app lp-ghost">
									<TileIcon icon={resolve(dragging)} name={dragging.name} />
								</div>
							)}
						</DragOverlay>
					</DndContext>

					{pageCount > 1 && (
						<div className="lp-dots" onClick={(e) => e.stopPropagation()}>
							{pages.map((_, p) => (
								<button
									key={p}
									className={p === page ? "active" : ""}
									aria-label={`Page ${p + 1}`}
									onClick={() => goToPage(p)}
								/>
							))}
						</div>
					)}

					{openFolder && (
						<div
							className="lp-folder-backdrop"
							onClick={(e) => {
								e.stopPropagation();
								setOpenFolderId(null);
							}}
						>
							<div className="lp-folder-pop" onClick={(e) => e.stopPropagation()}>
								<input
									className="lp-folder-title"
									defaultValue={openFolder.name}
									key={openFolder.id}
									autoFocus={renameFolder}
									onFocus={(e) => e.currentTarget.select()}
									onBlur={(e) => {
										renameFolderTo(openFolder.id, e.currentTarget.value);
										setRenameFolder(false);
									}}
									onKeyDown={(e) => {
										e.stopPropagation();
										if (e.key === "Enter") e.currentTarget.blur();
									}}
								/>
								<div className="lp-folder-apps">
									{openFolder.apps
										.map((p) => byPath.get(p))
										.filter((a): a is LauncherApp => !!a)
										.map((app) => (
											<AppTile
												key={app.path}
												app={app}
												icon={resolve(app)}
												selected={false}

												merging={false}
												dnd={false}
												onLaunch={launch}
												onMenu={(e, a) => appMenu(e, a, openFolder.id)}
											/>
										))}
									{openFolder.apps.length === 0 && (
										<div className="lp-folder-empty">
											Right-click an app and choose "Add to folder", or drag it onto the folder.
										</div>
									)}
								</div>
							</div>
						</div>
					)}

					{menu && (
						<div
							className="lp-menu"
							style={menuStyle}
							onClick={(e) => e.stopPropagation()}
							onContextMenu={(e) => e.preventDefault()}
						>
							{menu.kind === "app" && menu.app && (
								<>
									<button onClick={() => launch(menu.app!)}>Open</button>
									<button
										onClick={() => {
											setPicker(menu.app!);
											setMenu(null);
										}}
									>
										Change icon…
									</button>
									<div className="lp-menu-sep" />
									{menu.fromFolder || folderOf.has(menu.app.path) ? (
										<button
											onClick={() => {
												removeFromFolder(menu.app!.path);
												setMenu(null);
											}}
										>
											Remove from folder
										</button>
									) : (
										<>
											<button onClick={() => setMenuFolders((v) => !v)}>
												Add to folder
												<ChevronRight size={13} className={menuFolders ? "turned" : ""} />
											</button>
											{menuFolders && (
												<div className="lp-menu-sub">
													{layout.folders.map((f) => (
														<button
															key={f.id}
															onClick={() => {
																addToFolder(menu.app!.path, f.id);
																setMenu(null);
															}}
														>
															{f.name}
														</button>
													))}
													<button
														onClick={() => {
															createFolder([menu.app!.path]);
															setMenu(null);
														}}
													>
														New folder…
													</button>
												</div>
											)}
										</>
									)}
									<div className="lp-menu-sep" />
									<button
										onClick={() => {
											const app = menu.app!;
											const shown = shownByRules(app);
											updateLayout((l) => ({
												...l,
												visibility: { ...l.visibility, [app.path]: shown ? "hide" : "show" }
											}));
											setMenu(null);
										}}
									>
										{shownByRules(menu.app) ? "Hide from Launchpad" : "Show in Launchpad"}
									</button>
								</>
							)}
							{menu.kind === "folder" && menu.folderId && (
								<>
									<button
										onClick={() => {
											setOpenFolderId(menu.folderId!);
											setMenu(null);
										}}
									>
										Open
									</button>
									<button
										onClick={() => {
											setOpenFolderId(menu.folderId!);
											setRenameFolder(true);
											setMenu(null);
										}}
									>
										Rename
									</button>
									<div className="lp-menu-sep" />
									<button
										className="danger"
										onClick={() => {
											deleteFolder(menu.folderId!);
											setMenu(null);
										}}
									>
										Delete folder
									</button>
								</>
							)}
							{menu.kind === "empty" && (
								<>
									<button
										onClick={() => {
											createFolder();
											setMenu(null);
										}}
									>
										New folder
									</button>
									<button
										onClick={() => {
											invoke("open_settings_window").catch(console.error);
											setMenu(null);
										}}
									>
										Launchpad settings…
									</button>
								</>
							)}
						</div>
					)}

					{picker && (
						<IconPicker
							appName={picker.name}
							current={layout.icons[picker.path]}
							autoId={autoIconId(picker.name, exeStem(picker))}
							windowsIcon={picker.icon ?? icons[picker.path]}
							onClose={() => setPicker(null)}
							onPick={(choice) => {
								const app = picker;
								updateLayout((l) => {
									const next = { ...l.icons };
									if (choice === null) delete next[app.path];
									else next[app.path] = choice;
									return { ...l, icons: next };
								});
								setPicker(null);
							}}
						/>
					)}
				</motion.div>
			)}
		</AnimatePresence>
	);
}
