/**
 * The Highlight tool's pure parts (DEC-066): an element's text as one line
 * of words, where a quote is in it, the text around it, and the line boxes
 * of a selection. The page's side (content/text-range.ts) gives them the
 * DOM's text nodes and client rects; nothing here needs a page.
 */

import { cutText, HIGHLIGHT_LIMITS, type Rect, textLength } from "./case.ts";

/** One text node's text; `gap`: a block's edge or a line break comes before it. */
export interface TextPiece {
	text: string;
	gap?: boolean;
}

/** Where a character of the flat text comes from: its piece, and its offset there (UTF-16). */
export interface Source {
	piece: number;
	offset: number;
}

/**
 * An element's text with its whitespace collapsed: every run of white space
 * (a block's edge counts as one) is one space, none at the ends. `at[i]` is
 * where its `i`-th code unit comes from; a space put in for a block's edge
 * comes from the start of the piece after it.
 */
export interface FlatText {
	text: string;
	at: Source[];
}

const SPACE = /\s/;

export function flatten(pieces: readonly TextPiece[]): FlatText {
	let text = "";
	const at: Source[] = [];
	/** A space is owed before the next character that is none. */
	let space: Source | undefined;
	pieces.forEach((p, piece) => {
		if (p.gap && text !== "") space ??= { piece, offset: 0 };
		for (let offset = 0; offset < p.text.length; offset++) {
			const ch = p.text[offset] as string;
			if (SPACE.test(ch)) {
				if (text !== "") space ??= { piece, offset };
				continue;
			}
			if (space !== undefined) {
				text += " ";
				at.push(space);
				space = undefined;
			}
			text += ch;
			at.push({ piece, offset });
		}
	});
	return { text, at };
}

/** Whether source position `a` comes before `b`. */
const before = (a: Source, b: Source) =>
	a.piece < b.piece || (a.piece === b.piece && a.offset < b.offset);

/**
 * The flat text's part between two places in its pieces (`start` inclusive,
 * `end` exclusive), without spaces at its ends: as indexes into `flat.text`.
 * None when nothing but white space is between them.
 */
export function flatSpan(
	flat: FlatText,
	start: Source,
	end: Source,
): { start: number; end: number } | undefined {
	let s = flat.at.findIndex((p) => !before(p, start));
	if (s === -1) return undefined;
	let e = s;
	while (e < flat.at.length && before(flat.at[e] as Source, end)) e++;
	while (s < e && flat.text[s] === " ") s++;
	while (e > s && flat.text[e - 1] === " ") e--;
	return e > s ? { start: s, end: e } : undefined;
}

/** How many characters at the end of `a` and of `b` are the same. */
function commonEnd(a: string, b: string): number {
	let n = 0;
	while (
		n < a.length &&
		n < b.length &&
		a[a.length - 1 - n] === b[b.length - 1 - n]
	)
		n++;
	return n;
}

/** How many characters at the start of `a` and of `b` are the same. */
function commonStart(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[n] === b[n]) n++;
	return n;
}

/** The most places of a quote looked at in one text. */
const MAX_OCCURRENCES = 1000;

/**
 * Where `quote` is in `text` (both flat): of several places, the one whose
 * text around it is most like `before` and `after`, the first of equals.
 * None when it is not there: the text changed (often the fix itself).
 */
export function quoteIn(
	text: string,
	quote: string,
	context: { before?: string; after?: string } = {},
): { start: number; end: number } | undefined {
	if (quote === "") return undefined;
	let best: { start: number; score: number } | undefined;
	let seen = 0;
	for (
		let i = text.indexOf(quote);
		i !== -1 && seen < MAX_OCCURRENCES;
		i = text.indexOf(quote, i + 1), seen++
	) {
		const score =
			(context.before === undefined
				? 0
				: commonEnd(
						text.slice(Math.max(0, i - context.before.length), i),
						context.before,
					)) +
			(context.after === undefined
				? 0
				: commonStart(
						text.slice(
							i + quote.length,
							i + quote.length + context.after.length,
						),
						context.after,
					));
		if (best === undefined || score > best.score) best = { start: i, score };
	}
	return best === undefined
		? undefined
		: { start: best.start, end: best.start + quote.length };
}

/** The last `max` characters (code points) of `text`. */
function cutStart(text: string, max: number): string {
	const chars = [...text];
	return chars.length <= max ? text : chars.slice(-max).join("");
}

/**
 * The text right before and right after `start`..`end` of a flat text, at
 * most 32 characters each (`HIGHLIGHT_LIMITS.context`); none where there is
 * none.
 */
export function contextOf(
	text: string,
	start: number,
	end: number,
): { before?: string; after?: string } {
	const max = HIGHLIGHT_LIMITS.context;
	const b = cutStart(text.slice(0, start), max);
	const a = cutText(text.slice(end), max);
	return {
		...(b === "" ? {} : { before: b }),
		...(a === "" ? {} : { after: a }),
	};
}

/**
 * The end of a span of `text` cut to at most `HIGHLIGHT_LIMITS.text`
 * characters (code points), without a space at its end; `end` itself when
 * it is not longer.
 */
export function cutSpan(text: string, start: number, end: number): number {
	const part = text.slice(start, end);
	if (textLength(part) <= HIGHLIGHT_LIMITS.text) return end;
	return start + cutText(part, HIGHLIGHT_LIMITS.text).trimEnd().length;
}

/** How much of the smaller of two boxes' heights they share. */
function sharedHeight(a: Rect, b: Rect): number {
	const top = Math.max(a.y, b.y);
	const bottom = Math.min(a.y + a.height, b.y + b.height);
	return (
		Math.max(0, bottom - top) / Math.max(1e-6, Math.min(a.height, b.height))
	);
}

/** The room between two boxes side by side; 0 when they overlap. */
function sideGap(a: Rect, b: Rect): number {
	return Math.max(
		0,
		Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width),
	);
}

function union(a: Rect, b: Rect): Rect {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {
		x,
		y,
		width: Math.max(a.x + a.width, b.x + b.width) - x,
		height: Math.max(a.y + a.height, b.y + b.height) - y,
	};
}

/**
 * A selection's line boxes from its text's client rects: the rects of one
 * line (most of their height shared, side by side with no more than a
 * line's height between them) become one box; empty ones go. Two columns
 * side by side stay two boxes. Top to bottom, then left to right.
 */
export function lineBoxes(rects: readonly Rect[]): Rect[] {
	const lines: Rect[] = [];
	const sorted = rects
		.filter((r) => r.width >= 0.5 && r.height >= 0.5)
		.sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2) || a.x - b.x);
	for (const r of sorted) {
		const i = lines.findIndex(
			(l) =>
				sharedHeight(l, r) >= 0.5 &&
				sideGap(l, r) <= Math.max(l.height, r.height),
		);
		if (i === -1) lines.push({ ...r });
		else lines[i] = union(lines[i] as Rect, r);
	}
	// A box that grew may now reach another of its line.
	for (let merged = true; merged; ) {
		merged = false;
		for (let i = 0; i < lines.length && !merged; i++)
			for (let j = i + 1; j < lines.length && !merged; j++) {
				const a = lines[i] as Rect;
				const b = lines[j] as Rect;
				if (
					sharedHeight(a, b) >= 0.5 &&
					sideGap(a, b) <= Math.max(a.height, b.height)
				) {
					lines[i] = union(a, b);
					lines.splice(j, 1);
					merged = true;
				}
			}
	}
	return lines.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** The box round some line boxes. */
export function boundsOfRects(rects: readonly Rect[]): Rect {
	const [first, ...rest] = rects;
	if (first === undefined) return { x: 0, y: 0, width: 0, height: 0 };
	return rest.reduce(union, first);
}
