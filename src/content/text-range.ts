/**
 * The Highlight tool on the page (DEC-066): an element's text nodes, a
 * selection read as a highlight (its element, text, the text around it and
 * its line boxes), and a highlight's text found again in an element. The
 * decisions are lib/highlight.ts's; this gives them the page.
 */

import { HIGHLIGHT_LIMITS, type Highlight, type Rect } from "../lib/case.ts";
import { EDITORS, isEditable } from "../lib/element.ts";
import {
	contextOf,
	cutSpan,
	type FlatText,
	flatSpan,
	flatten,
	lineBoxes,
	type NearWay,
	nearPlaces,
	quoteIn,
	type Source,
	type Span,
	sourceAt,
	type TextPiece,
} from "../lib/highlight.ts";

/** Node types and the walker's filter as numbers: the same in every realm. */
export const ELEMENT = 1;
export const TEXT = 3;
const SHOW_TEXT = 4;

/** Elements whose text is no text on the page. */
const HIDDEN = new Set(["script", "style", "noscript", "template"]);

/** An element's text: its text nodes in order, and as one flat line. */
export interface ElementText {
	nodes: Text[];
	flat: FlatText;
	/** Not all of it was read (`MAX_NODES`): what is not found may be in the rest. */
	truncated?: true;
}

/**
 * The most text nodes with words read of one element (white space between
 * elements does not count): a long article has fewer. One look at this many
 * takes about 66 ms in Chrome (measured; 200,000 took 337 ms). Past it
 * nothing is claimed: a selection says it is too long, a quote not found is
 * not "changed".
 */
const MAX_NODES = 50_000;

/**
 * An element's text nodes, without scripts, styles and what is typed into
 * editors and form fields (that is somebody's input, never recorded); a
 * block's edge and a line break count as a space between words. At most
 * `max` text nodes with words are read (`MAX_NODES`; the area around an
 * element, `AREA_NODES`).
 */
export function elementText(el: Element, max = MAX_NODES): ElementText {
	const win = el.ownerDocument.defaultView;
	const nodes: Text[] = [];
	const pieces: TextPiece[] = [];
	let gap = false;
	let words = 0;
	let truncated = false;
	const isBlock = (e: Element): boolean => {
		const display = win?.getComputedStyle(e).display ?? "inline";
		return !display.startsWith("inline") && display !== "contents";
	};
	const walk = (parent: Node): void => {
		for (const child of parent.childNodes) {
			if (words >= max) {
				truncated = true;
				return;
			}
			if (child.nodeType === TEXT) {
				if (/\S/.test(child.nodeValue ?? "")) words++;
				nodes.push(child as Text);
				pieces.push({ text: child.nodeValue ?? "", gap });
				gap = false;
			} else if (child.nodeType === ELEMENT) {
				const e = child as Element;
				if (e.localName === "br") {
					gap = true;
					continue;
				}
				if (HIDDEN.has(e.localName) || e.matches(EDITORS) || isEditable(e)) {
					gap = true;
					continue;
				}
				const block = isBlock(e);
				if (block) gap = true;
				walk(e);
				if (block) gap = true;
			}
		}
	};
	walk(el);
	return {
		nodes,
		flat: flatten(pieces),
		...(truncated ? { truncated: true as const } : {}),
	};
}

/**
 * A boundary of a range as a place in the element's text nodes: in one of
 * them, or between nodes the start of the first text node after it (as an
 * end, which is exclusive, that is the end of the text before it).
 */
function sourceOf(text: ElementText, node: Node, offset: number): Source {
	const i = text.nodes.indexOf(node as Text);
	if (i !== -1) return { piece: i, offset };
	const point = (node.ownerDocument ?? document).createRange();
	point.setStart(node, offset);
	const k = text.nodes.findIndex((n) => point.comparePoint(n, 0) >= 0);
	return k === -1
		? { piece: text.nodes.length, offset: 0 }
		: { piece: k, offset: 0 };
}

/** The DOM range of `start`..`end` of an element's flat text. */
function rangeOf(text: ElementText, start: number, end: number): Range {
	const a = sourceAt(text.flat, start) as Source;
	const b = sourceAt(text.flat, end - 1) as Source;
	const range = (text.nodes[0]?.ownerDocument ?? document).createRange();
	range.setStart(text.nodes[a.piece] as Text, a.offset);
	range.setEnd(text.nodes[b.piece] as Text, b.offset + 1);
	return range;
}

/**
 * A range's line boxes in window coordinates: the client rects of its text
 * alone (an element wholly inside a range reports its own box too), merged
 * per line (`lineBoxes`).
 */
export function rangeLines(range: Range): Rect[] {
	const doc = range.startContainer.ownerDocument ?? document;
	const rects: Rect[] = [];
	const root =
		range.commonAncestorContainer.nodeType === TEXT
			? (range.commonAncestorContainer.parentNode ??
				range.commonAncestorContainer)
			: range.commonAncestorContainer;
	// From the range's first node to its end, not over the whole ancestor.
	const walker = doc.createTreeWalker(root, SHOW_TEXT);
	const start = range.startContainer;
	walker.currentNode =
		start.nodeType === TEXT
			? start
			: (start.childNodes[range.startOffset] ?? start);
	for (let n = walker.currentNode; n !== null; n = walker.nextNode() as Node) {
		if (n.nodeType !== TEXT) continue;
		if (range.comparePoint(n, 0) > 0) break;
		if (!range.intersectsNode(n)) continue;
		const t = n as Text;
		const part = doc.createRange();
		part.setStart(t, t === range.startContainer ? range.startOffset : 0);
		part.setEnd(t, t === range.endContainer ? range.endOffset : t.length);
		for (const r of part.getClientRects())
			rects.push({ x: r.x, y: r.y, width: r.width, height: r.height });
	}
	return lineBoxes(rects);
}

/** What the Highlight tool made of a selection. */
export interface SelectedText {
	element: Element;
	highlight: Omit<Highlight, "rects">;
	/** Its line boxes in window coordinates. */
	lines: Rect[];
	/** It was cut to the limits: at most 500 characters, at most 40 lines. */
	cut: boolean;
}

/** Why a selection makes no highlight, said to the person. */
export type NoText = "nothing" | "field" | "typed" | "large" | "unseen";

/** The element of a range: the nearest element that holds all of it. */
function elementOfRange(range: Range): Element | null {
	const c = range.commonAncestorContainer;
	return c.nodeType === ELEMENT ? (c as Element) : (c.parentElement ?? null);
}

/**
 * A selection as a highlight: its element (the nearest one that holds all
 * of it), its text (whitespace collapsed), the text around it there, its
 * line boxes; cut to 500 characters and 40 lines where it is longer. None,
 * and why, for text somebody typed (a form field, an editor) or nothing
 * but white space.
 */
export function selectedText(range: Range): SelectedText | NoText {
	const element = elementOfRange(range);
	if (element === null) return "nothing";
	if (element.matches("input, textarea, select")) return "field";
	if (isEditable(element)) return "typed";
	const text = elementText(element);
	const start = sourceOf(text, range.startContainer, range.startOffset);
	const end = sourceOf(text, range.endContainer, range.endOffset);
	const span = flatSpan(text.flat, start, end);
	if (span === undefined) return text.truncated ? "large" : "nothing";
	const flat = text.flat.text;
	let e = cutSpan(flat, span.start, span.end);
	let cut = e < span.end;
	let lines = rangeLines(rangeOf(text, span.start, e));
	if (lines.length > HIGHLIGHT_LIMITS.rects) {
		// The longest start of it that stands on 40 lines.
		let lo = span.start + 1;
		let hi = e;
		while (lo < hi) {
			const mid = Math.ceil((lo + hi) / 2);
			if (
				rangeLines(rangeOf(text, span.start, mid)).length <=
				HIGHLIGHT_LIMITS.rects
			)
				lo = mid;
			else hi = mid - 1;
		}
		e = lo;
		while (e > span.start + 1 && flat[e - 1] === " ") e--;
		lines = rangeLines(rangeOf(text, span.start, e));
		cut = true;
	}
	const quote = flat.slice(span.start, e);
	if (quote === "") return "nothing";
	// Text that is there and shows nowhere (display: none, a closed part).
	if (lines.length === 0) return "unseen";
	return {
		element,
		highlight: { text: quote, ...contextOf(flat, span.start, e) },
		lines,
		cut,
	};
}

/**
 * Where a highlight's text is in `element` now, as a live range: by its
 * text, and by the text around it where it is there more than once.
 * `"gone"`: not there any more (the text changed: often the fix);
 * `"unread"`: not in the part of a very long element that was read
 * (`MAX_NODES`), which says nothing about whether it changed.
 */
export function findText(
	element: Element,
	h: Pick<Highlight, "text" | "before" | "after">,
): Range | "gone" | "unread" {
	const text = elementText(element);
	const at = quoteIn(text.flat.text, h.text, h);
	if (at === undefined) return text.truncated ? "unread" : "gone";
	return rangeOf(text, at.start, at.end);
}

/**
 * Where the search for a highlight's text around its element stops
 * (DEC-083): the nearest of these above it, or the element itself when it
 * is one.
 */
const AREA_EDGE = "section, article, main, aside, form, dialog, body";

/**
 * How many levels above its element a highlight's text is looked for at
 * most (DEC-083). On a page of divs that may be most of it; the areas are
 * tried nearest first, and only one place that shows counts.
 */
export const AREA_LEVELS = 4;

/**
 * The most text nodes with words read of an area around an element
 * (DEC-083): a larger area, and every one above it, is not read. This runs
 * for every highlight whose text is not in its element, at every look.
 */
export const AREA_NODES = 2_000;

/**
 * The elements a highlight's text is looked for in when it is not in its
 * element (DEC-083), nearest first: the element itself (new text in the
 * old place is often in it), then up to `levels` ancestors, not past the
 * nearest section, article, main, aside, form, dialog or body.
 */
export function nearbyAreas(
	element: Element,
	levels: number = AREA_LEVELS,
): Element[] {
	const areas = [element];
	let at = element;
	for (let level = 0; level < levels && !at.matches(AREA_EDGE); level++) {
		const up = at.parentElement;
		if (up === null) break;
		areas.push(up);
		at = up;
	}
	return areas;
}

/**
 * Whether a range's text shows (DEC-083): its element is rendered, visible
 * and not transparent (`checkVisibility` where there is one); its text has
 * a line box larger than 2 px each way that is not wholly left of or above
 * the page (text put off the page for screen readers); and no box between
 * it and `root`, the area's top, of at most 2 px each way cuts what
 * overflows (text for screen readers only, a collapsed part). Only for a
 * few candidates: it lays the page out.
 */
export function showsOnPage(range: Range, root: Element): boolean {
	const el = elementOfRange(range);
	if (el === null) return false;
	if (
		typeof el.checkVisibility === "function" &&
		!el.checkVisibility({
			opacityProperty: true,
			visibilityProperty: true,
			checkOpacity: true,
			checkVisibilityCSS: true,
		})
	)
		return false;
	const win = el.ownerDocument.defaultView;
	const sx = win?.scrollX ?? 0;
	const sy = win?.scrollY ?? 0;
	if (
		!rangeLines(range).some(
			(r) =>
				r.width > 2 &&
				r.height > 2 &&
				r.x + r.width + sx > 0 &&
				r.y + r.height + sy > 0,
		)
	)
		return false;
	for (let at: Element | null = el; at !== null; at = at.parentElement) {
		const box = at.getBoundingClientRect();
		if (
			(box.width <= 2 || box.height <= 2) &&
			win?.getComputedStyle(at).overflow !== "visible"
		)
			return false;
		if (at === root) break;
	}
	return true;
}

/** A highlight's text found around its element (DEC-083). */
export interface NearText {
	range: Range;
	/** The element that holds all of it. */
	holder: Element;
	/** `nearby`: the same text elsewhere; `reworded`: new text in its place. */
	how: "nearby" | "reworded";
	/** The text found, whitespace collapsed (page text). */
	now: string;
}

/** The one place of `spans` whose text shows; none when none or more than one shows. */
function onlyShown(
	text: ElementText,
	spans: readonly Span[],
	shows: (range: Range) => boolean,
): { span: Span; range: Range } | undefined {
	let one: { span: Span; range: Range } | undefined;
	for (const span of spans) {
		const range = rangeOf(text, span.start, span.end);
		if (!shows(range)) continue;
		if (one !== undefined) return undefined;
		one = { span, range };
	}
	return one;
}

/**
 * A highlight's text around `element`, where it is not in it any more
 * (DEC-083): in the nearest area of `nearbyAreas` where one of `ways`
 * (`nearWays`) has exactly one place that shows, in the ways' order. None
 * (the element's box, "Text changed", as before): no way has that before
 * the areas end or grow over `AREA_NODES`. `shows` is the page's
 * `showsOnPage`; a test without layout gives its own.
 */
export function findNearby(
	element: Element,
	h: Pick<Highlight, "text" | "before" | "after">,
	options: {
		ways: readonly NearWay[];
		levels?: number;
		shows?: (range: Range, root: Element) => boolean;
	},
): NearText | undefined {
	const { ways, levels = AREA_LEVELS, shows = showsOnPage } = options;
	if (ways.length === 0) return undefined;
	for (const area of nearbyAreas(element, levels)) {
		const text = elementText(area, AREA_NODES);
		// The areas above are larger still.
		if (text.truncated) return undefined;
		const places = nearPlaces(text.flat.text, h);
		for (const way of ways) {
			const one = onlyShown(text, places[way], (r) => shows(r, area));
			if (one === undefined) continue;
			return {
				range: one.range,
				holder: elementOfRange(one.range) ?? area,
				how: way === "reworded" ? "reworded" : "nearby",
				now: text.flat.text.slice(one.span.start, one.span.end),
			};
		}
	}
	return undefined;
}

/**
 * Where to look for a highlight's text when no element was found for it
 * (DEC-083): the element its recorded selector names, else the nearest of
 * the selector's own ancestors, up to `AREA_LEVELS` of them, that is on the
 * page once; with how many levels of the area are left above it. Never a
 * section, article, main, aside, form, dialog or body, nor a child of the
 * body (an app's root): what is left of the path there is so wide that the
 * place says nothing, and there is none.
 */
export function placeOf(
	doc: Document,
	selector: string,
): { element: Element; levels: number } | undefined {
	const parts = selector.split(" > ");
	for (let drop = 0; drop <= AREA_LEVELS && drop < parts.length; drop++) {
		let found: Element[];
		try {
			found = [
				...doc.querySelectorAll(
					parts.slice(0, parts.length - drop).join(" > "),
				),
			];
		} catch {
			continue;
		}
		if (
			found.some(
				(e) =>
					e.matches(AREA_EDGE) ||
					e.parentElement === null ||
					e.parentElement === doc.body ||
					e === doc.documentElement,
			)
		)
			return undefined;
		if (found.length === 1)
			return { element: found[0] as Element, levels: AREA_LEVELS - drop };
	}
	return undefined;
}

/** A range's text without its white space: what tells that the text under it changed. */
export const bareText = (text: string): string => text.replace(/\s+/g, "");

/** Whether an element scrolls its content up and down (a pane of its own). */
function scrollsY(el: Element): boolean {
	const overflow =
		el.ownerDocument.defaultView?.getComputedStyle(el).overflowY ?? "";
	return (
		(overflow === "auto" || overflow === "scroll" || overflow === "overlay") &&
		el.scrollHeight > el.clientHeight
	);
}

/**
 * Scroll so that the start of `target` (an element, or a highlight's text)
 * is in the middle of what shows it: every pane it is inside (a chat, a
 * docs layout) from the innermost out, then the window. In a tall element,
 * its text, not the element's middle. Text that shows nowhere: its element.
 */
export function scrollToMiddle(target: Element | Range): void {
	const element = (r: Range): Element | null =>
		r.startContainer.nodeType === TEXT
			? r.startContainer.parentElement
			: (r.startContainer as Element);
	const whole = (el: Element) =>
		el.scrollIntoView({
			block: "center",
			inline: "nearest",
			behavior: "instant",
		});
	if (!("setStart" in target)) {
		whole(target);
		return;
	}
	const at = element(target);
	const line = () => rangeLines(target)[0];
	if (line() === undefined) {
		if (at !== null) whole(at);
		return;
	}
	const doc = target.startContainer.ownerDocument ?? document;
	for (let el = at?.parentElement ?? null; el !== null; el = el.parentElement) {
		if (el === doc.documentElement || el === doc.body || !scrollsY(el))
			continue;
		const first = line();
		if (first === undefined) return;
		const box = el.getBoundingClientRect();
		// Instant, whatever the page's `scroll-behavior`: the next pane measures after it.
		el.scrollBy({
			top: first.y + first.height / 2 - (box.y + el.clientHeight / 2),
			behavior: "instant",
		});
	}
	const win = doc.defaultView;
	const first = line();
	if (win == null || first === undefined) return;
	win.scrollBy({
		left: 0,
		top: first.y + first.height / 2 - win.innerHeight / 2,
		behavior: "instant",
	});
}
