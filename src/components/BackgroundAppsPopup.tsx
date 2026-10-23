import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { autoIconId, iconUrl } from "../launcher/icons";
import type { TrayApp } from "../dockApps";

interface Row extends TrayApp {
	icon?: string;
}

interface BackgroundAppsPopupProps {
	onClose: () => void;
	containerRef: React.RefObject<HTMLDivElement | null>;
	scale: number;
	bottom: number;
}

const exeStem = (path: string) =>
	(path.split(/[\\/]/).pop() ?? "").replace(/\.exe$/i, "").toLowerCase();

/** Apps running in the background, from the notification area: Bloom's replacement for the tray flyout. */
export function BackgroundAppsPopup({
	onClose,
	containerRef,
	scale,
	bottom
}: BackgroundAppsPopupProps) {
	const [apps, setApps] = useState<TrayApp[] | null>(null);
	const [icons, setIcons] = useState<Record<string, string>>({});

	useEffect(() => {
		let stopped = false;
		const load = () =>
			invoke<TrayApp[]>("get_tray_apps")
				.then((list) => !stopped && setApps(list))
				.catch(() => !stopped && setApps((prev) => prev ?? []));
		void load();
		const timer = window.setInterval(load, 3000);
		return () => {
			stopped = true;
			window.clearInterval(timer);
		};
	}, []);

	// Windows icons only for apps without a Mac-style one.
	useEffect(() => {
		for (const app of apps ?? []) {
			if (iconUrl(autoIconId(app.name, exeStem(app.path))) || icons[app.path]) continue;
			invoke<string | null>("get_app_icon", { path: app.path, name: app.name })
				.then((icon) => icon && setIcons((prev) => ({ ...prev, [app.path]: icon })))
				.catch(() => {});
		}
	}, [apps, icons]);

	const rows = useMemo<Row[]>(
		() =>
			[...(apps ?? [])]
				.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
				.map((app) => ({
					...app,
					icon: iconUrl(autoIconId(app.name, exeStem(app.path))) ?? icons[app.path]
				})),
		[apps, icons]
	);

	return (
		<div className="add-popup-anchor" style={{ zoom: scale, bottom }}>
			<motion.div
				ref={containerRef}
				className="add-app-popup bgapps-popup"
				style={{ transformOrigin: "bottom center" }}
				initial={{ opacity: 0, scaleY: 0 }}
				animate={{ opacity: 1, scaleY: 1 }}
				exit={{ opacity: 0, scaleY: 0, transition: { duration: 0.16, ease: "easeIn" } }}
				transition={{
					opacity: { duration: 0.15 },
					scaleY: { type: "spring", stiffness: 300, damping: 28, mass: 0.9 }
				}}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="bgapps-head">Background apps</div>
				<div className="popup-apps-scroll">
					{apps === null ? null : rows.length === 0 ? (
						<div className="bgapps-empty">Nothing is running in the background</div>
					) : (
						rows.map((app) => (
							<div
								key={app.path}
								className="popup-app-row"
								title="Click to open, right-click for its menu"
								onClick={() => {
									invoke("activate_tray_icon", { trayId: app.tray_ids[0] }).catch(console.error);
									onClose();
								}}
								onContextMenu={(e) => {
									e.preventDefault();
									invoke("show_tray_context_menu", { trayId: app.tray_ids[0] }).catch(
										console.error
									);
									onClose();
								}}
							>
								<span className="bgapps-icon">
									{app.icon ? (
										<img src={app.icon} alt="" draggable={false} />
									) : (
										<span>{app.name.charAt(0).toUpperCase()}</span>
									)}
								</span>
								<span className="bgapps-name">{app.name}</span>
							</div>
						))
					)}
				</div>
			</motion.div>
		</div>
	);
}
