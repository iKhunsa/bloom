import "./MetricsPanel.css";

/** Samples kept per chart: one a second, so the chart spans the last minute. */
export const METRIC_HISTORY = 60;

const W = 100;
const H = 40;

interface MetricChartProps {
	label: string;
	color: string;
	/** Usage samples in percent, oldest first. */
	history: number[];
	/** Highlighted chart: the widget that was clicked to open the panel. */
	focused: boolean;
}

function MetricChart({ label, color, history, focused }: MetricChartProps) {
	const step = W / (METRIC_HISTORY - 1);
	// Newest sample sits at the right edge and older ones scroll left.
	const points = history.map((v, i) => {
		const x = W - (history.length - 1 - i) * step;
		const y = H - (Math.min(100, Math.max(0, v)) / 100) * H;
		return [x, y] as const;
	});
	const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
	// The filled area under the line: along the line, then back along the bottom.
	const area = points.length
		? `M${points[0][0]},${H} ${points.map(([x, y]) => `L${x},${y}`).join(" ")} L${points[points.length - 1][0]},${H} Z`
		: "";
	const current = history.length ? Math.round(history[history.length - 1]) : null;

	return (
		<div className={`mp-chart ${focused ? "focused" : ""}`} style={{ color }}>
			<div className="mp-head">
				<span className="mp-label">{label}</span>
				<span className="mp-value">{current === null ? "…" : `${current}%`}</span>
			</div>
			<svg className="mp-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
				<defs>
					<linearGradient id={`mp-fill-${label}`} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
						<stop offset="100%" stopColor="currentColor" stopOpacity="0" />
					</linearGradient>
				</defs>
				<line className="mp-grid" x1="0" y1={H / 2} x2={W} y2={H / 2} />
				{area && <path d={area} fill={`url(#mp-fill-${label})`} />}
				{points.length > 1 && <polyline className="mp-line" points={line} />}
			</svg>
		</div>
	);
}

interface MetricsPanelProps {
	ram: number[];
	/** Null when this PC has no GPU counters, which hides that chart. */
	gpu: number[] | null;
	focus: "ram" | "gpu";
}

export function MetricsPanel({ ram, gpu, focus }: MetricsPanelProps) {
	return (
		<div className="mp" onClick={(e) => e.stopPropagation()}>
			<MetricChart label="RAM" color="#a78bfa" history={ram} focused={focus === "ram"} />
			{gpu && <MetricChart label="GPU" color="#34d399" history={gpu} focused={focus === "gpu"} />}
		</div>
	);
}
