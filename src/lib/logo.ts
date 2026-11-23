/**
 * Sitegloss's logo (DEC-029): a light `</>` on a dark tile with a hand-drawn
 * amber pen loop round it. The geometry is the owner's, ported as it was
 * chosen; the icon files (`bun scripts/icons.ts`) and the bars' ring in the
 * page are all drawn from it, so they never disagree. Units: a 128 × 128 tile.
 */

export type LogoPoint = readonly [number, number];

export const LOGO_COLOURS = {
	tile: "#1d2433",
	amber: "#ffb000",
	paper: "#e8ebf2",
	/** The glyph on the white tile, for dark backgrounds. */
	ink: "#1b2130",
	lightTile: "#ffffff",
} as const;

/** The rounded tile, as the owner chose it from the drawings: the whole square, corners of 26. */
export const TILE = { inset: 0, radius: 26 } as const;

/** One drawing of the logo: polylines stroked with round caps and joins. */
export interface LogoDrawing {
	loop: readonly LogoPoint[];
	loopWidth: number;
	glyph: readonly (readonly LogoPoint[])[];
	glyphWidth: number;
}

const smoothstep = (x: number): number => {
	const t = Math.max(0, Math.min(1, x));
	return t * t * (3 - 2 * t);
};

interface LoopOptions {
	cx: number;
	cy: number;
	rx: number;
	ry: number;
	turns: number;
	/** Where it starts, in degrees (y down). */
	start: number;
	tilt: number;
	/** How far its last part moves outwards, so it ends above its own start. */
	end: number;
	/** Where (0..1 along the stroke) that move begins. */
	from: number;
	wobble: number;
	seed: number;
	n: number;
}

const LOOP: LoopOptions = {
	cx: 62,
	cy: 67,
	rx: 45,
	ry: 29,
	turns: 1.03,
	start: -78,
	tilt: -5,
	end: 10.5,
	from: 0.76,
	wobble: 0.018,
	seed: 0.9,
	n: 240,
};

/** The pen loop: from near the top, counterclockwise once round. */
export function loopPoints(options: Partial<LoopOptions> = {}): LogoPoint[] {
	const o = { ...LOOP, ...options };
	const rad = Math.PI / 180;
	const tilt = o.tilt * rad;
	const points: LogoPoint[] = [];
	for (let i = 0; i <= o.n; i++) {
		const t = i / o.n;
		const a = o.start * rad - t * o.turns * 2 * Math.PI;
		const k =
			1 +
			o.wobble * Math.sin(2 * a + o.seed) +
			0.4 * o.wobble * Math.sin(3 * a + 2 * o.seed);
		const off = o.end * smoothstep((t - o.from) / (1 - o.from));
		const x = (o.rx * k + off) * Math.cos(a);
		const y = (o.ry * k + off) * Math.sin(a);
		points.push([
			o.cx + x * Math.cos(tilt) - y * Math.sin(tilt),
			o.cy + x * Math.sin(tilt) + y * Math.cos(tilt),
		]);
	}
	return points;
}

/** The `</>` glyph as polylines; without the slash it is `< >`. */
export function glyphSegments(
	scale: number,
	slash: boolean,
	cx = 64,
	cy = 67,
): LogoPoint[][] {
	const s = scale;
	const out: LogoPoint[][] = [
		[
			[cx - 16 * s, cy - 14 * s],
			[cx - 30 * s, cy],
			[cx - 16 * s, cy + 14 * s],
		],
		[
			[cx + 16 * s, cy - 14 * s],
			[cx + 30 * s, cy],
			[cx + 16 * s, cy + 14 * s],
		],
	];
	if (slash)
		out.push([
			[cx + 6 * s, cy - 20 * s],
			[cx - 6 * s, cy + 20 * s],
		]);
	return out;
}

/** From 48 px up. */
export const FULL_LOGO: LogoDrawing = {
	loop: loopPoints(),
	loopWidth: 8,
	glyph: glyphSegments(0.78, true),
	glyphWidth: 8,
};

/** At 16 and 32 px, where `</>` is illegible: `< >` and a heavier loop. */
export const SMALL_LOGO: LogoDrawing = {
	loop: loopPoints({ end: 13, from: 0.72, rx: 44, ry: 29 }),
	loopWidth: 11,
	glyph: glyphSegments(0.7, false),
	glyphWidth: 12,
};

/**
 * On the page's bars, at 20 px: the small drawing's loop with a heavier pen.
 * Its end lifts further than in the icon, or a stroke this wide would close
 * the loop into a ring.
 */
export const BAR_LOOP = {
	points: loopPoints({ end: 22, from: 0.72, rx: 44, ry: 29 }),
	width: 14,
} as const;

const num = (v: number): string => String(Math.round(v * 100) / 100);

/** A polyline as an SVG path `d`, to two decimals. */
export function pathData(points: readonly LogoPoint[]): string {
	return points
		.map(([x, y], i) => `${i === 0 ? "M" : "L"}${num(x)} ${num(y)}`)
		.join(" ");
}

/** The box a polyline's stroke covers: x, y, width, height. */
export function strokeBounds(
	points: readonly LogoPoint[],
	width: number,
): [number, number, number, number] {
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	const h = width / 2;
	const x = Math.min(...xs) - h;
	const y = Math.min(...ys) - h;
	return [x, y, Math.max(...xs) + h - x, Math.max(...ys) + h - y];
}

/**
 * The wordmark's letters (DEC-030): "Sitegloss" in Inter Bold 3.019 (© The Inter
 * Project Authors, SIL Open Font License 1.1), its outlines taken once from the font
 * file as path data in the font's units, y down from the baseline. Outlines rather
 * than text, so the letters and the swipe over "gloss" stay where they are wherever
 * the file is opened, with or without any font. Inter is the nearest free font to
 * the system fonts the site draws the name in; its kerning in this name is nil.
 */
export const WORDMARK_FONT = {
	unitsPerEm: 2816,
	/** The height of a capital, and of "l"'s stem. */
	capHeight: 2048,
	glyphs: {
		S: {
			advance: 1844,
			d: "M1289 -1459L1704 -1459C1698 -1824 1398 -2076 942 -2076C493 -2076 164 -1828 166 -1456C165 -1154 378 -981 724 -898L947 -842C1170 -788 1294 -724 1295 -586C1294 -436 1152 -334 932 -334C707 -334 545 -438 531 -643L112 -643C123 -200 440 29 937 29C1437 29 1731 -210 1732 -585C1731 -926 1474 -1107 1118 -1187L934 -1231C756 -1272 607 -1338 610 -1485C610 -1617 727 -1714 939 -1714C1146 -1714 1273 -1620 1289 -1459Z",
		},
		i: {
			advance: 766,
			d: "M170 0L596 0L596 -1536L170 -1536ZM384 -1734C511 -1734 615 -1831 615 -1950C615 -2068 511 -2165 384 -2165C258 -2165 154 -2068 154 -1950C154 -1831 258 -1734 384 -1734Z",
		},
		t: {
			advance: 1094,
			d: "M987 -1536L698 -1536L698 -1904L272 -1904L272 -1536L62 -1536L62 -1216L272 -1216L272 -416C270 -115 475 34 784 21C894 17 972 -5 1015 -19L948 -336C927 -332 882 -322 842 -322C757 -322 698 -354 698 -472L698 -1216L987 -1216Z",
		},
		e: {
			advance: 1683,
			d: "M870 30C1250 30 1506 -155 1566 -440L1172 -466C1129 -349 1019 -288 877 -288C664 -288 529 -429 529 -658L529 -659L1575 -659L1575 -776C1575 -1298 1259 -1556 853 -1556C401 -1556 108 -1235 108 -761C108 -274 397 30 870 30ZM529 -923C538 -1098 671 -1238 860 -1238C1045 -1238 1173 -1106 1174 -923Z",
		},
		g: {
			advance: 1783,
			d: "M862 608C1301 608 1613 408 1613 15L1613 -1536L1190 -1536L1190 -1278L1174 -1278C1117 -1403 992 -1556 735 -1556C398 -1556 113 -1294 113 -771C113 -260 390 -22 736 -22C981 -22 1118 -145 1174 -272L1192 -272L1192 9C1192 220 1057 302 872 302C684 302 589 220 554 127L160 180C211 422 448 608 862 608ZM871 -342C662 -342 548 -508 548 -773C548 -1034 660 -1217 871 -1217C1078 -1217 1194 -1042 1194 -773C1194 -502 1076 -342 871 -342Z",
		},
		l: {
			advance: 766,
			d: "M596 -2048L170 -2048L170 0L596 0Z",
		},
		o: {
			advance: 1728,
			d: "M864 30C1330 30 1620 -289 1620 -762C1620 -1238 1330 -1556 864 -1556C398 -1556 108 -1238 108 -762C108 -289 398 30 864 30ZM866 -300C651 -300 541 -497 541 -765C541 -1033 651 -1231 866 -1231C1077 -1231 1187 -1033 1187 -765C1187 -497 1077 -300 866 -300Z",
		},
		s: {
			advance: 1582,
			d: "M1448 -1098C1410 -1381 1182 -1556 794 -1556C401 -1556 142 -1374 143 -1078C142 -848 287 -699 587 -639L853 -586C987 -559 1048 -510 1050 -433C1048 -342 949 -277 800 -277C648 -277 547 -342 521 -467L102 -445C142 -151 392 30 799 30C1197 30 1482 -173 1483 -476C1482 -698 1337 -831 1039 -892L761 -948C618 -979 565 -1028 566 -1102C565 -1194 669 -1254 801 -1254C949 -1254 1037 -1173 1058 -1074Z",
		},
	},
} as const;

export type WordmarkLetter = keyof typeof WORDMARK_FONT.glyphs;

/**
 * The wordmark as the owner chose it, its lengths in em: the plain name in bold,
 * an amber marker swipe behind "gloss", whose letters are always ink on amber.
 * The same proportions as the site's CSS (`.sg-word`, `.sg-swipe`).
 */
export const WORDMARK = {
	/** After every letter, like CSS letter-spacing. */
	tracking: -0.02,
	/** From the end of "Site" to the start of "gloss". */
	gap: 0.16,
	swipe: {
		/** Round the ink of "gloss" (its "l" and its "g"), before the swipe is turned. */
		pad: { top: 0.1, right: 0.12, bottom: 0.1, left: 0.12 },
		/** Corner radii, horizontal then vertical: uneven, like a marker's. */
		corners: {
			topLeft: [0.5, 0.12],
			topRight: [0.12, 0.5],
			bottomRight: [0.45, 0.1],
			bottomLeft: [0.1, 0.45],
		},
		/** Degrees: turned anticlockwise, then leaning forward. */
		rotate: -1.6,
		skew: -8,
	},
	/** The lockup: the tile, then the name, its cap height centred on the tile. */
	lockup: { tile: 1.6, gap: 0.375 },
} as const;

type Pair = (x: number, y: number) => LogoPoint;

/** A path of absolute M, L, C and Z, every point moved by `f`. */
function mapPath(d: string, f: Pair): string {
	const tokens = d.match(/[MLCZ]|-?\d+(?:\.\d+)?/g) ?? [];
	const out: string[] = [];
	let x: number | undefined;
	for (const t of tokens) {
		if (/[MLCZ]/.test(t)) out.push(t);
		else if (x === undefined) x = Number(t);
		else {
			const [px, py] = f(x, Number(t));
			out.push(`${num(px)} ${num(py)}`);
			x = undefined;
		}
	}
	return out.join(" ").replace(/ ?([MLCZ]) ?/g, "$1");
}

/** Every point of a path, control points too: their hull holds the outline. */
export function pathPoints(d: string): LogoPoint[] {
	const values = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
	const points: LogoPoint[] = [];
	for (let i = 0; i + 1 < values.length; i += 2)
		points.push([values[i] as number, values[i + 1] as number]);
	return points;
}

/** A word set from `x` on the baseline `y`, `em` units to the em; and where it ends. */
function setWord(
	word: string,
	x: number,
	y: number,
	em: number,
): { d: string; end: number } {
	const k = em / WORDMARK_FONT.unitsPerEm;
	const parts: string[] = [];
	let at = x;
	for (const letter of word) {
		const glyph = WORDMARK_FONT.glyphs[letter as WordmarkLetter];
		const from = at;
		parts.push(mapPath(glyph.d, (gx, gy) => [from + gx * k, y + gy * k]));
		at += glyph.advance * k + WORDMARK.tracking * em;
	}
	return { d: parts.join(""), end: at };
}

/** The box of some points: x, y, width, height. */
export function pointBounds(
	points: readonly LogoPoint[],
): [number, number, number, number] {
	return strokeBounds(points, 0);
}

/** A cubic Bézier: its start, two control points and its end. */
type Cubic = readonly [LogoPoint, LogoPoint, LogoPoint, LogoPoint];

/** The quarter of an ellipse round (cx, cy) from angle `a` on (degrees, y down), as a Bézier. */
function quarter(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	a: number,
): Cubic {
	const k = 0.5523; // 4/3 (√2 − 1): a quarter circle within 0.03 %
	const t0 = (a * Math.PI) / 180;
	const t1 = ((a + 90) * Math.PI) / 180;
	const p0: LogoPoint = [cx + rx * Math.cos(t0), cy + ry * Math.sin(t0)];
	const p3: LogoPoint = [cx + rx * Math.cos(t1), cy + ry * Math.sin(t1)];
	return [
		p0,
		[p0[0] - k * rx * Math.sin(t0), p0[1] + k * ry * Math.cos(t0)],
		[p3[0] + k * rx * Math.sin(t1), p3[1] - k * ry * Math.cos(t1)],
		p3,
	];
}

/** The swipe as a path and as the polyline its outline follows. */
export interface Swipe {
	d: string;
	points: LogoPoint[];
}

/**
 * The swipe: a box with uneven round corners, leaning and turned about its
 * middle like the CSS `rotate() skewX()`. Both are affine, so the corners stay
 * exact Béziers.
 */
export function swipe(
	box: readonly [number, number, number, number],
	em: number,
	/** Degrees, instead of the wordmark's: a long line turned as much would climb. */
	rotate: number = WORDMARK.swipe.rotate,
): Swipe {
	const [x, y, w, h] = box;
	const { corners: c, skew } = WORDMARK.swipe;
	const [tlx, tly] = [c.topLeft[0] * em, c.topLeft[1] * em];
	const [trx, try_] = [c.topRight[0] * em, c.topRight[1] * em];
	const [brx, bry] = [c.bottomRight[0] * em, c.bottomRight[1] * em];
	const [blx, bly] = [c.bottomLeft[0] * em, c.bottomLeft[1] * em];
	const cx = x + w / 2;
	const cy = y + h / 2;
	const k = Math.tan((skew * Math.PI) / 180);
	const a = (rotate * Math.PI) / 180;
	const move = ([px, py]: LogoPoint): LogoPoint => {
		const sx = px - cx + k * (py - cy);
		const sy = py - cy;
		return [
			cx + sx * Math.cos(a) - sy * Math.sin(a),
			cy + sx * Math.sin(a) + sy * Math.cos(a),
		];
	};
	const corners = [
		quarter(x + tlx, y + tly, tlx, tly, 180),
		quarter(x + w - trx, y + try_, trx, try_, 270),
		quarter(x + w - brx, y + h - bry, brx, bry, 0),
		quarter(x + blx, y + h - bly, blx, bly, 90),
	].map((q) => q.map(move) as unknown as Cubic);
	const pt = ([px, py]: LogoPoint) => `${num(px)} ${num(py)}`;
	const first = corners[0] as Cubic;
	const d = `M${pt(first[0])}${corners
		.map(
			(q, i) =>
				`${i === 0 ? "" : `L${pt(q[0])}`}C${pt(q[1])} ${pt(q[2])} ${pt(q[3])}`,
		)
		.join("")}Z`;
	const points: LogoPoint[] = [];
	for (const [p0, p1, p2, p3] of corners)
		for (let i = 0; i <= 16; i++) {
			const t = i / 16;
			const u = 1 - t;
			const f = (j: 0 | 1) =>
				u * u * u * p0[j] +
				3 * u * u * t * p1[j] +
				3 * u * t * t * p2[j] +
				t * t * t * p3[j];
			points.push([f(0), f(1)]);
		}
	return { d, points };
}

/** The wordmark laid out: the two words' outlines and the swipe. */
export interface WordmarkLayout {
	site: string;
	gloss: string;
	swipe: Swipe;
}

/** The wordmark with "Site" starting at `x` on the baseline `y`, `em` units to the em. */
export function wordmark(x: number, y: number, em: number): WordmarkLayout {
	const site = setWord("Site", x, y, em);
	const gloss = setWord("gloss", site.end + WORDMARK.gap * em, y, em);
	const [gx, gy, gw, gh] = pointBounds(pathPoints(gloss.d));
	const p = WORDMARK.swipe.pad;
	const box = [
		gx - p.left * em,
		gy - p.top * em,
		gw + (p.left + p.right) * em,
		gh + (p.top + p.bottom) * em,
	] as const;
	return { site: site.d, gloss: gloss.d, swipe: swipe(box, em) };
}

/**
 * The wordmark in the lockup, in the tile's 128 units: its em is 128 / 1.6 = 80,
 * "Site" starts after the tile and the gap, its cap height centred on the tile.
 */
export function lockupWordmark(): WordmarkLayout {
	const em = 128 / WORDMARK.lockup.tile;
	const cap = (WORDMARK_FONT.capHeight / WORDMARK_FONT.unitsPerEm) * em;
	return wordmark(128 + WORDMARK.lockup.gap * em, 64 + cap / 2, em);
}
