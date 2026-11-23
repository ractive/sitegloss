/**
 * How a mark looks: the overlay shows it in SVG while the user works, and
 * saving paints the same shapes onto the screenshot (images.ts).
 */

import type { Point, Rect, Shape } from "./case.ts";
import { luminance, parseColor } from "./colour.ts";
import { LOGO_COLOURS, swipe, WORDMARK } from "./logo.ts";

export const MARK_COLOUR = "#e0185c";

export interface RenderedMark {
	number: number;
	/** In window coordinates. */
	shape: Shape;
	/**
	 * A highlight's line boxes (DEC-066), in the same coordinates: drawn as
	 * marker strokes, and its pin at the start of the first.
	 */
	lines?: readonly Rect[];
	/** The text is on a dark ground: the stroke is laid over it, not multiplied (`HIGHLIGHT_LOOK`). */
	dark?: boolean;
}

/**
 * The marker stroke over a highlighted line (DEC-066): the logo's amber, the
 * yellow of the swipe behind "gloss". The page's text has to stay readable
 * under it, and the overlay sits above the page: on a light ground it is
 * multiplied with what is under it (the text keeps its colour, the ground
 * turns amber); on a dark ground multiplying would leave nothing to see, so
 * it is laid over it translucent. Which one is the colour behind the text
 * (`isDarkGround`). The contrast of text under it is held by a unit test.
 */
export const HIGHLIGHT_LOOK = {
	colour: LOGO_COLOURS.amber,
	/** On a dark ground: how much of the amber covers it. */
	darkOpacity: 0.3,
} as const;

/**
 * Whether text on this ground colour (`rgb(…)` as computed) is on a dark
 * one: below the luminance where black and white text have equal contrast.
 * A colour this does not read counts as light.
 */
export function isDarkGround(colour: string | undefined): boolean {
	const c = colour === undefined ? undefined : parseColor(colour);
	return c !== undefined && c.a > 0 && luminance(c) < 0.179;
}

/**
 * One line's marker stroke as an SVG path: the logo's swipe (its uneven
 * round corners, its lean) round the line, a little wider than the text.
 * It turns as the swipe does only as far as its ends move no more than the
 * logo's do: a long line turned 1.6° would climb over the next one.
 */
export function markerPath(line: Rect): string {
	const { width: w, height: h } = line;
	// The corners are lengths in em: on a short word they must still fit.
	const em = Math.max(1, Math.min(h / 1.15, (w + 0.2 * h) / 0.62));
	const pad = 0.1 * em;
	const box = [line.x - pad, line.y, w + 2 * pad, h] as const;
	const climb = (0.08 * em) / Math.max(1, box[2]);
	const rotate = -Math.min(
		Math.abs(WORDMARK.swipe.rotate),
		(Math.asin(Math.min(1, climb)) * 180) / Math.PI,
	);
	return swipe(box, em, rotate).d;
}

export function badgePosition(shape: Shape): Point {
	switch (shape.kind) {
		case "element":
		case "box":
			return { x: shape.rect.x, y: shape.rect.y };
		case "arrow":
			return shape.from;
		case "pen":
			return shape.points[0] ?? { x: 0, y: 0 };
		case "note":
			return shape.at;
		case "unknown":
			return { x: 0, y: 0 };
	}
}

/**
 * Where a mark's pin is: a highlight's just left of its first line, centred
 * on it, so it covers neither the highlighted text nor the line above;
 * every other mark's where its shape starts (`badgePosition`).
 */
export function pinPosition(
	mark: Pick<RenderedMark, "shape" | "lines">,
): Point {
	const first = mark.lines?.[0];
	if (first !== undefined)
		return { x: first.x - 11, y: first.y + first.height / 2 };
	return badgePosition(mark.shape);
}

/** The two back corners of an arrow's head. */
export function arrowHead(from: Point, to: Point): [Point, Point] {
	const angle = Math.atan2(to.y - from.y, to.x - from.x);
	const corner = (a: number): Point => ({
		x: to.x - 14 * Math.cos(angle + a),
		y: to.y - 14 * Math.sin(angle + a),
	});
	return [corner(0.45), corner(-0.45)];
}

/**
 * A pin's radius: 20 px across, a note's 24 (it is all there is of the
 * mark). One step smaller than before DEC-064 (22 and 26), as the web app's
 * pins went to 24; two digits still fit. Pictures taken before keep theirs.
 */
export const badgeRadius = (shape: Shape) => (shape.kind === "note" ? 12 : 10);
/**
 * The pin's number, bold: 11 px holds two digits in the 20 px pin; mark 100
 * and on get 9 px, so three still sit inside its casing (DEC-064's review).
 */
export const pinFontSize = (n: number) => (String(n).length > 2 ? 9 : 11);
export const pinFont = (n: number) =>
	`700 ${pinFontSize(n)}px system-ui, sans-serif`;

function paintShape(
	ctx: OffscreenCanvasRenderingContext2D,
	shape: Shape,
): void {
	ctx.beginPath();
	switch (shape.kind) {
		case "element":
		case "box": {
			const { x, y, width, height } = shape.rect;
			ctx.roundRect(x, y, width, height, 4);
			break;
		}
		case "arrow": {
			const { from, to } = shape;
			const [l, r] = arrowHead(from, to);
			ctx.moveTo(from.x, from.y);
			ctx.lineTo(to.x, to.y);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(to.x, to.y);
			ctx.lineTo(l.x, l.y);
			ctx.lineTo(r.x, r.y);
			ctx.closePath();
			ctx.fill();
			return;
		}
		case "pen":
			shape.points.forEach((p, i) => {
				if (i === 0) ctx.moveTo(p.x, p.y);
				else ctx.lineTo(p.x, p.y);
			});
			break;
		case "note":
		case "unknown":
			return;
	}
	ctx.stroke();
}

/** A highlight's strokes, as the overlay draws them on the page. */
function paintLines(
	ctx: OffscreenCanvasRenderingContext2D,
	lines: readonly Rect[],
	dark: boolean,
): void {
	ctx.save();
	ctx.fillStyle = HIGHLIGHT_LOOK.colour;
	if (dark) ctx.globalAlpha = HIGHLIGHT_LOOK.darkOpacity;
	else ctx.globalCompositeOperation = "multiply";
	for (const line of lines) ctx.fill(new Path2D(markerPath(line)));
	ctx.restore();
}

/** Paint a mark and its number; the context is scaled to CSS pixels. */
export function paintMark(
	ctx: OffscreenCanvasRenderingContext2D,
	mark: RenderedMark,
): void {
	if (mark.shape.kind === "unknown") return;
	ctx.strokeStyle = MARK_COLOUR;
	ctx.fillStyle = MARK_COLOUR;
	ctx.lineWidth = 3;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	if (mark.lines !== undefined && mark.lines.length > 0) {
		paintLines(ctx, mark.lines, mark.dark === true);
		ctx.fillStyle = MARK_COLOUR;
	} else paintShape(ctx, mark.shape);
	const at = pinPosition(mark);
	ctx.beginPath();
	ctx.arc(at.x, at.y, badgeRadius(mark.shape), 0, Math.PI * 2);
	ctx.fill();
	ctx.strokeStyle = "#fff";
	ctx.lineWidth = 2;
	ctx.stroke();
	ctx.fillStyle = "#fff";
	ctx.font = pinFont(mark.number);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(String(mark.number), at.x, at.y);
}
