import type { SVGProps } from "react";
import BitcoinSvg from "./bitcoin.svg?react";

// Bitcoin logo from cryptocurrency-icons (CC0). It is a colored logo, so
// strokeWidth is accepted only to fit the widget icon slots and ignored.
export function BitcoinIcon({
	size = 14,
	strokeWidth: _strokeWidth,
	...props
}: SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }) {
	return <BitcoinSvg width={size} height={size} {...props} />;
}
