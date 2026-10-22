import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { ICONS, iconUrl } from "./icons";
import "./IconPicker.css";

interface IconPickerProps {
	appName: string;
	/** The saved choice: a library id, "windows", or nothing for automatic. */
	current: string | undefined;
	/** Library icon the app matches on its own, if it is a known app. */
	autoId: string | null;
	/** The app's own Windows icon, if loaded. */
	windowsIcon: string | undefined;
	/** A library id, "windows", or null for automatic. */
	onPick: (choice: string | null) => void;
	onClose: () => void;
}

export function IconPicker({
	appName,
	current,
	autoId,
	windowsIcon,
	onPick,
	onClose
}: IconPickerProps) {
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				onClose();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		return q ? ICONS.filter((i) => i.label.toLowerCase().includes(q) || i.id.includes(q)) : ICONS;
	}, [query]);

	const autoUrl = iconUrl(autoId) ?? windowsIcon;

	return (
		<div
			className="ip-backdrop"
			onClick={(e) => {
				e.stopPropagation();
				onClose();
			}}
			onContextMenu={(e) => e.preventDefault()}
		>
			<div className="ip" onClick={(e) => e.stopPropagation()}>
				<div className="ip-head">
					<div className="ip-title">
						<span>Icon for</span>
						<strong>{appName}</strong>
					</div>
					<button className="ip-close" onClick={onClose} aria-label="Close">
						<X size={16} />
					</button>
				</div>

				<div className="ip-special">
					<button
						className={`ip-option ${current === undefined ? "selected" : ""}`}
						onClick={() => onPick(null)}
					>
						<span className="ip-thumb">
							{autoUrl ? <img src={autoUrl} alt="" /> : <span className="ip-none">?</span>}
						</span>
						<span className="ip-option-text">
							<strong>Automatic</strong>
							<small>{autoId ? "Matched to a known app" : "Not a known app: its own icon"}</small>
						</span>
					</button>
					<button
						className={`ip-option ${current === "windows" ? "selected" : ""}`}
						onClick={() => onPick("windows")}
					>
						<span className="ip-thumb">
							{windowsIcon ? <img src={windowsIcon} alt="" /> : <span className="ip-none">W</span>}
						</span>
						<span className="ip-option-text">
							<strong>Windows icon</strong>
							<small>The app's original icon</small>
						</span>
					</button>
				</div>

				<div className="ip-search">
					<Search size={14} />
					<input
						ref={inputRef}
						value={query}
						placeholder="Search icons"
						spellCheck={false}
						onChange={(e) => setQuery(e.target.value)}
					/>
				</div>

				<div className="ip-grid">
					{shown.map((icon) => (
						<button
							key={icon.id}
							className={`ip-cell ${current === icon.id ? "selected" : ""}`}
							title={icon.label}
							onClick={() => onPick(icon.id)}
						>
							<img src={icon.url} alt="" draggable={false} loading="lazy" decoding="async" />
							<span>{icon.label}</span>
						</button>
					))}
					{shown.length === 0 && <div className="ip-empty">No icons found</div>}
				</div>
			</div>
		</div>
	);
}
