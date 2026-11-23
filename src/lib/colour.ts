/**
 * Colours as the browser computes them (`rgb(…)`, `rgba(…)`), for the colour
 * behind a marked element and its contrast (DEC-048). Pure: no page needed.
 */

export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

/** `rgb(1, 2, 3)`, `rgba(1, 2, 3, 0.5)`, `rgb(1 2 3 / 50%)`, `transparent`; anything else: undefined. */
export function parseColor(value: string): Rgba | undefined {
	const v = value.trim().toLowerCase();
	if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
	const m =
		/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/.exec(
			v,
		);
	if (m === null) return undefined;
	const alpha =
		m[4] === undefined ? 1 : Number(m[4]) / (m[5] === "%" ? 100 : 1);
	const out = {
		r: Number(m[1]),
		g: Number(m[2]),
		b: Number(m[3]),
		a: Math.min(1, Math.max(0, alpha)),
	};
	return [out.r, out.g, out.b, out.a].every(Number.isFinite) ? out : undefined;
}

/** `top` laid over the opaque `under`. */
export function over(top: Rgba, under: Rgba): Rgba {
	return {
		r: top.r * top.a + under.r * (1 - top.a),
		g: top.g * top.a + under.g * (1 - top.a),
		b: top.b * top.a + under.b * (1 - top.a),
		a: 1,
	};
}

export const rgbText = (c: Rgba): string =>
	`rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;

/** WCAG 2.2 relative luminance of an opaque colour. */
export function luminance(c: Rgba): number {
	const channel = (v: number) => {
		const s = v / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/**
 * The WCAG contrast ratio of a text colour on a background, the text laid
 * over the background where it is translucent; undefined where either is a
 * colour this does not read.
 */
export function contrastRatio(
	text: string,
	background: string,
): number | undefined {
	const t = parseColor(text);
	const b = parseColor(background);
	if (t === undefined || b === undefined || b.a < 1) return undefined;
	const fg = t.a < 1 ? over(t, b) : t;
	const [hi, lo] = [luminance(fg), luminance(b)].sort((x, y) => y - x) as [
		number,
		number,
	];
	return (hi + 0.05) / (lo + 0.05);
}
