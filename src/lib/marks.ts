/**
 * How a mark looks: the overlay shows it in SVG while the user works, and
 * saving paints the same shapes onto the screenshot (images.ts).
 */

import type { Point, Shape } from "./case.ts";

export const MARK_COLOUR = "#e0185c";

export interface RenderedMark {
	number: number;
	/** In window coordinates. */
	shape: Shape;
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
	}
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
/** The pin's number: bold, two digits inside the smaller pin. */
export const PIN_FONT = "700 11px system-ui, sans-serif";

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
			return;
	}
	ctx.stroke();
}

/** Paint a mark and its number; the context is scaled to CSS pixels. */
export function paintMark(
	ctx: OffscreenCanvasRenderingContext2D,
	mark: RenderedMark,
): void {
	ctx.strokeStyle = MARK_COLOUR;
	ctx.fillStyle = MARK_COLOUR;
	ctx.lineWidth = 3;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	paintShape(ctx, mark.shape);
	const at = badgePosition(mark.shape);
	ctx.beginPath();
	ctx.arc(at.x, at.y, badgeRadius(mark.shape), 0, Math.PI * 2);
	ctx.fill();
	ctx.strokeStyle = "#fff";
	ctx.lineWidth = 2;
	ctx.stroke();
	ctx.fillStyle = "#fff";
	ctx.font = PIN_FONT;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(String(mark.number), at.x, at.y);
}
