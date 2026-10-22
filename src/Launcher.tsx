import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "framer-motion";
import { Search } from "lucide-react";

interface LauncherApp {
	name: string;
	path: string;
	icon?: string | null;
}

// Space kept for the notch above and the dock below, which stay on top.
const TOP_SPACE = 150;
const BOTTOM_SPACE = 190;
const CELL_WIDTH = 170;
const CELL_HEIGHT = 148;
const MAX_GRID_WIDTH = 1400;
// Ignore focus loss right after opening, while Windows hands over focus.
const BLUR_GRACE_MS = 600;

/** How an icon should sit in its macOS-style tile. */
interface IconLook {
	/** The icon already fills its square, so it is clipped to the tile as is. */
	full: boolean;
	/** A light logo, which gets a dark tile to stay visible. */
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

function AppTile({
	app,
	icon,
	selected,
	onLaunch
}: {
	app: LauncherApp;
	icon: string | undefined;
	selected: boolean;
	onLaunch: (app: LauncherApp) => void;
}) {
	const look = useIconLook(icon);
	const kind = !icon ? "empty" : look?.full ? "full" : look?.light ? "dark" : "light";
	return (
		<button
			className={`lp-app ${selected ? "selected" : ""}`}
			onClick={(e) => {
				e.stopPropagation();
				onLaunch(app);
			}}
			title={app.name}
		>
			<span className={`lp-tile ${kind}`}>
				{icon ? (
					<img src={icon} alt="" draggable={false} />
				) : (
					<span className="lp-letter">{app.name.charAt(0).toUpperCase()}</span>
				)}
			</span>
			<span className="lp-name">{app.name}</span>
		</button>
	);
}

export default function Launcher() {
	const [apps, setApps] = useState<LauncherApp[]>([]);
	const [icons, setIcons] = useState<Record<string, string>>({});
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(0);
	const [selected, setSelected] = useState(0);
	const [grid, setGrid] = useState({ cols: 8, rows: 5 });
	const inputRef = useRef<HTMLInputElement>(null);
	const requested = useRef(new Set<string>());
	const openedAt = useRef(0);
	const wheelAt = useRef(0);

	const perPage = grid.cols * grid.rows;

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return q ? apps.filter((a) => a.name.toLowerCase().includes(q)) : apps;
	}, [apps, query]);
	const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));

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

	const loadApps = useCallback(async () => {
		try {
			const list = await invoke<LauncherApp[]>("get_installed_apps");
			const seen = new Set<string>();
			const clean = list
				.filter((a) => a.name.trim() && !/uninstall/i.test(a.name))
				.filter((a) => {
					const key = a.name.trim().toLowerCase();
					if (seen.has(key)) return false;
					seen.add(key);
					return true;
				})
				.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
			setApps(clean);
		} catch (e) {
			console.error("[launcher] could not list apps:", e);
		}
	}, []);

	const close = useCallback(() => setOpen(false), []);

	// Opened or closed from the backend (Win tap, dock Start button).
	useEffect(() => {
		const unlistenOpen = listen("launcher-open", () => {
			openedAt.current = Date.now();
			setQuery("");
			setPage(0);
			setSelected(0);
			setOpen(true);
			void loadApps();
		});
		const unlistenClose = listen("launcher-close", () => setOpen(false));
		return () => {
			unlistenOpen.then((f) => f());
			unlistenClose.then((f) => f());
		};
	}, [loadApps]);

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
		if (open) inputRef.current?.focus();
	}, [open]);

	// Icons load on demand for the current page and the next one.
	useEffect(() => {
		if (!open) return;
		const wanted = filtered
			.slice(page * perPage, (page + 2) * perPage)
			.filter((a) => !a.icon && !requested.current.has(a.path));
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
	}, [open, filtered, page, perPage]);

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

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			const first = page * perPage;
			const last = Math.min(filtered.length, first + perPage) - 1;
			const index = first + selected;
			if (e.key === "Escape") {
				if (query) setQuery("");
				else close();
			} else if (e.key === "Enter") {
				const app = filtered[index];
				if (app) launch(app);
			} else if (e.key === "ArrowRight") {
				e.preventDefault();
				if (index < last) setSelected(selected + 1);
				else if (page < pageCount - 1) goToPage(page + 1);
			} else if (e.key === "ArrowLeft") {
				e.preventDefault();
				if (selected > 0) setSelected(selected - 1);
				else if (page > 0) goToPage(page - 1);
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelected(Math.min(selected + grid.cols, last - first));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelected(Math.max(selected - grid.cols, 0));
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [
		open,
		query,
		page,
		perPage,
		selected,
		filtered,
		grid.cols,
		pageCount,
		close,
		launch,
		goToPage
	]);

	// Wheel or two-finger swipe flips pages.
	const onWheel = (e: React.WheelEvent) => {
		const now = Date.now();
		if (now - wheelAt.current < 400) return;
		const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
		if (Math.abs(delta) < 8) return;
		wheelAt.current = now;
		goToPage(page + (delta > 0 ? 1 : -1));
	};

	const pages = Array.from({ length: pageCount }, (_, p) =>
		filtered.slice(p * perPage, (p + 1) * perPage)
	);

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
					onClick={close}
					onWheel={onWheel}
				>
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

					<div className="lp-pages" style={{ top: TOP_SPACE, bottom: BOTTOM_SPACE }}>
						<div className="lp-strip" style={{ transform: `translateX(-${page * 100}%)` }}>
							{pages.map((items, p) => (
								<div
									key={p}
									className="lp-page"
									style={{
										gridTemplateColumns: `repeat(${grid.cols}, ${CELL_WIDTH}px)`,
										gridAutoRows: `${CELL_HEIGHT}px`
									}}
								>
									{Math.abs(p - page) <= 1 &&
										items.map((app, i) => (
											<AppTile
												key={app.path}
												app={app}
												icon={app.icon ?? icons[app.path]}
												selected={p === page && i === selected}
												onLaunch={launch}
											/>
										))}
								</div>
							))}
						</div>
						{filtered.length === 0 && <div className="lp-empty">No apps found</div>}
					</div>

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
				</motion.div>
			)}
		</AnimatePresence>
	);
}
