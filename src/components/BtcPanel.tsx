import { useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import "./BtcPanel.css";

// Coinbase candles: one request returns at most 300 of them.
const FRAMES = [
	{ id: "1H", label: "1H", granularity: 60, count: 60 },
	{ id: "1D", label: "1D", granularity: 300, count: 288 },
	{ id: "1W", label: "1W", granularity: 3600, count: 168 },
	{ id: "1M", label: "1M", granularity: 21600, count: 120 },
	{ id: "3M", label: "3M", granularity: 86400, count: 90 },
	{ id: "1Y", label: "1Y", granularity: 86400, count: 300 }
] as const;

type Frame = (typeof FRAMES)[number];

interface Candle {
	time: number;
	low: number;
	high: number;
	open: number;
	close: number;
}

const W = 100;
const H = 40;
const usd = (n: number) =>
	`$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : 2 })}`;

function axisLabel(time: number, frame: Frame) {
	const d = new Date(time * 1000);
	if (frame.granularity < 3600)
		return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	if (frame.id === "1W") return d.toLocaleDateString([], { weekday: "short" });
	return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

interface BtcPanelProps {
	/** Live price from the ticker feed, which keeps the last point moving. */
	live: number | null;
}

export function BtcPanel({ live }: BtcPanelProps) {
	const [frame, setFrame] = useState<Frame>(FRAMES[1]);
	const [candles, setCandles] = useState<Candle[] | null>(null);
	const [error, setError] = useState(false);
	const [hover, setHover] = useState<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		setCandles(null);
		setError(false);
		const end = Math.floor(Date.now() / 1000);
		const start = end - frame.granularity * frame.count;
		const iso = (s: number) => new Date(s * 1000).toISOString();
		fetch(
			`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${frame.granularity}&start=${iso(start)}&end=${iso(end)}`
		)
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((rows: number[][]) => {
				if (cancelled) return;
				// [time, low, high, open, close, volume], newest first.
				setCandles(
					rows
						.map(([time, low, high, open, close]) => ({ time, low, high, open, close }))
						.sort((a, b) => a.time - b.time)
				);
			})
			.catch(() => !cancelled && setError(true));
		return () => {
			cancelled = true;
		};
	}, [frame]);

	const series = useMemo(() => {
		if (!candles?.length) return [];
		const closes = candles.map((c) => c.close);
		if (live !== null) closes[closes.length - 1] = live;
		return closes;
	}, [candles, live]);

	const stats = useMemo(() => {
		if (!candles?.length || !series.length) return null;
		const first = candles[0].open;
		const last = series[series.length - 1];
		return {
			last,
			change: ((last - first) / first) * 100,
			high: Math.max(...candles.map((c) => c.high)),
			low: Math.min(...candles.map((c) => c.low))
		};
	}, [candles, series]);

	const { line, area, points } = useMemo(() => {
		if (series.length < 2) return { line: "", area: "", points: [] as [number, number][] };
		const min = Math.min(...series);
		const max = Math.max(...series);
		const span = max - min || 1;
		const pts = series.map((v, i) => [
			(i / (series.length - 1)) * W,
			H - 3 - ((v - min) / span) * (H - 6)
		]) as [number, number][];
		const l = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
		return { line: l, area: `M0,${H} L${l.split(" ").join(" L")} L${W},${H} Z`, points: pts };
	}, [series]);

	const up = (stats?.change ?? 0) >= 0;
	const color = up ? "#4ade80" : "#f87171";
	const shown = hover !== null && candles ? candles[hover] : null;
	const shownPrice = shown ? series[hover!] : stats?.last;

	return (
		<div className="btcp" onClick={(e) => e.stopPropagation()}>
			<div className="btcp-head">
				<div className="btcp-price">
					<span className="btcp-value">{shownPrice !== undefined ? usd(shownPrice) : "…"}</span>
					{stats && !shown && (
						<span className="btcp-change" style={{ color }}>
							{up ? "+" : ""}
							{stats.change.toFixed(2)}%
						</span>
					)}
					{shown && (
						<span className="btcp-when">{new Date(shown.time * 1000).toLocaleString()}</span>
					)}
				</div>
				<div className="btcp-tabs">
					{FRAMES.map((f) => (
						<button
							key={f.id}
							className={f.id === frame.id ? "active" : ""}
							onClick={() => setFrame(f)}
						>
							{f.label}
						</button>
					))}
				</div>
			</div>

			<div className="btcp-chart" onMouseLeave={() => setHover(null)}>
				{error ? (
					<div className="btcp-note">Couldn't load the chart</div>
				) : !candles ? (
					<div className="btcp-note">
						<LoaderCircle className="btcp-spin" size={16} />
					</div>
				) : (
					<>
						<svg
							viewBox={`0 0 ${W} ${H}`}
							preserveAspectRatio="none"
							style={{ color }}
							onMouseMove={(e) => {
								const r = e.currentTarget.getBoundingClientRect();
								const i = Math.round(((e.clientX - r.left) / r.width) * (candles.length - 1));
								setHover(Math.min(candles.length - 1, Math.max(0, i)));
							}}
						>
							<defs>
								<linearGradient id="btcp-fill" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0" stopColor="currentColor" stopOpacity="0.32" />
									<stop offset="1" stopColor="currentColor" stopOpacity="0" />
								</linearGradient>
							</defs>
							<path d={area} fill="url(#btcp-fill)" />
							<polyline className="btcp-line" points={line} />
							{hover !== null && points[hover] && (
								<line
									className="btcp-cursor"
									x1={points[hover][0]}
									x2={points[hover][0]}
									y1="0"
									y2={H}
								/>
							)}
						</svg>
						{hover !== null && points[hover] && (
							<span
								className="btcp-dot"
								style={{
									left: `${points[hover][0]}%`,
									top: `${(points[hover][1] / H) * 100}%`,
									background: color
								}}
							/>
						)}
					</>
				)}
			</div>

			<div className="btcp-foot">
				<span>{candles?.length ? axisLabel(candles[0].time, frame) : ""}</span>
				{stats && (
					<span>
						Low {usd(stats.low)} · High {usd(stats.high)}
					</span>
				)}
				<span>{candles?.length ? axisLabel(candles[candles.length - 1].time, frame) : ""}</span>
			</div>
		</div>
	);
}
