import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronLeft, LoaderCircle, Mic, Volume2 } from "lucide-react";
import "./QuickPanel.css";

interface AudioDevice {
	id: string;
	name: string;
	is_default: boolean;
}

interface AudioDevicePanelProps {
	kind: "output" | "input";
	onBack: () => void;
	/** Runs after the default device changed, so the controls can re-read their state. */
	onChanged: () => void;
}

export function AudioDevicePanel({ kind, onBack, onChanged }: AudioDevicePanelProps) {
	const [devices, setDevices] = useState<AudioDevice[] | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const Icon = kind === "output" ? Volume2 : Mic;

	const refresh = useCallback(async () => {
		try {
			setDevices(await invoke<AudioDevice[]>("audio_list_devices", { kind }));
		} catch (e) {
			console.error("[audio] list failed:", e);
			setDevices([]);
		}
	}, [kind]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const choose = async (device: AudioDevice) => {
		if (device.is_default || busy) return;
		setBusy(device.id);
		try {
			await invoke("audio_set_default_device", { id: device.id });
			onChanged();
		} catch (e) {
			console.error("[audio] set default failed:", e);
		} finally {
			setBusy(null);
			void refresh();
		}
	};

	return (
		<div className="qp" onClick={(e) => e.stopPropagation()}>
			<div className="qp-header">
				<button className="qp-icon-btn" onClick={onBack} aria-label="Back to controls">
					<ChevronLeft />
				</button>
				<span className="qp-title">{kind === "output" ? "Sound output" : "Microphone"}</span>
			</div>
			<div className="qp-body">
				{devices === null ? (
					<div className="qp-empty">
						<LoaderCircle className="qp-spin" />
					</div>
				) : devices.length === 0 ? (
					<div className="qp-empty">
						<span>No {kind === "output" ? "output" : "input"} devices found</span>
					</div>
				) : (
					<ul className="qp-list">
						{devices.map((d) => (
							<li key={d.id} className={`qp-row ${d.is_default ? "active" : ""}`}>
								<button
									className="qp-row-main"
									disabled={busy !== null}
									onClick={() => void choose(d)}
								>
									<span className="qp-row-icon">
										<Icon />
									</span>
									<span className="qp-row-text">
										<span className="qp-row-name">{d.name}</span>
										<span className="qp-row-sub">{d.is_default ? "Default" : "Click to use"}</span>
									</span>
									{busy === d.id ? (
										<LoaderCircle className="qp-row-badge qp-spin" />
									) : (
										d.is_default && <Check className="qp-row-badge" />
									)}
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
