import { useEffect, useState } from "react";

export interface CryptoTick {
	price: number;
	open24h: number;
	high24h: number;
	low24h: number;
}

const FEED = "wss://ws-feed.exchange.coinbase.com";
const RECONNECT_MS = 5000;
// A busy market sends several ticks a second; the notch only needs one.
const MIN_UPDATE_MS = 1000;

/**
 * Live spot price of a Coinbase product (e.g. "BTC-USD") over its public ticker
 * feed. Connects only while `enabled` and reconnects after a drop.
 */
export function useCryptoPrice(productId: string, enabled: boolean): CryptoTick | null {
	const [tick, setTick] = useState<CryptoTick | null>(null);

	useEffect(() => {
		if (!enabled) return;
		let ws: WebSocket | null = null;
		let retry: number | undefined;
		let closed = false;
		let lastUpdate = 0;

		const connect = () => {
			ws = new WebSocket(FEED);
			ws.onopen = () =>
				ws?.send(
					JSON.stringify({ type: "subscribe", product_ids: [productId], channels: ["ticker"] })
				);
			ws.onmessage = (event) => {
				const msg = JSON.parse(event.data);
				const now = Date.now();
				if (msg.type !== "ticker" || !msg.price || now - lastUpdate < MIN_UPDATE_MS) return;
				lastUpdate = now;
				setTick({
					price: Number(msg.price),
					open24h: Number(msg.open_24h),
					high24h: Number(msg.high_24h),
					low24h: Number(msg.low_24h)
				});
			};
			ws.onclose = () => {
				if (!closed) retry = window.setTimeout(connect, RECONNECT_MS);
			};
		};
		connect();

		return () => {
			closed = true;
			window.clearTimeout(retry);
			ws?.close();
		};
	}, [productId, enabled]);

	return enabled ? tick : null;
}
