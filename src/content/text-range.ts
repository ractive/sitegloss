/**
 * The Highlight tool on the page (DEC-066): an element's text nodes, a
 * selection read as a highlight (its element, text, the text around it and
 * its line boxes), and a highlight's text found again in an element. The
 * decisions are lib/highlight.ts's; this gives them the page.
 */

import {
	HIGHLIGHT_LIMITS,
	type Highlight,
	type Rect,
	textLength,
} from "../lib/case.ts";
import { EDITORS, isEditable } from "../lib/element.ts";
import {
	contextOf,
	cutSpan,
	type FlatText,
	flatSpan,
	flatten,
	lineBoxes,
	quoteIn,
	type Source,
	type TextPiece,
} from "../lib/highlight.ts";

/** Elements whose text is no text on the page. */
const HIDDEN = new Set(["script", "style", "noscript", "template"]);

/** An element's text: its text nodes in order, and as one flat line. */
export interface ElementText {
	nodes: Text[];
	flat: FlatText;
}

/** The most text nodes read of one element: a selection across a whole page stops there. */
const MAX_NODES = 20_000;

/**
 * An element's text nodes, without scripts, styles and what is typed into
 * editors and form fields (that is somebody's input, never recorded); a
 * block's edge and a line break count as a space between words.
 */
export function elementText(el: Element): ElementText {
	const win = el.ownerDocument.defaultView;
	const nodes: Text[] = [];
	const pieces: TextPiece[] = [];
	let gap = false;
	const isBlock = (e: Element): boolean => {
		const display = win?.getComputedStyle(e).display ?? "inline";
		return !display.startsWith("inline") && display !== "contents";
	};
	const walk = (parent: Node): void => {
		for (const child of parent.childNodes) {
			if (nodes.length >= MAX_NODES) return;
			if (child.nodeType === Node.TEXT_NODE) {
				nodes.push(child as Text);
				pieces.push({ text: child.nodeValue ?? "", gap });
				gap = false;
			} else if (child.nodeType === Node.ELEMENT_NODE) {
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
	return { nodes, flat: flatten(pieces) };
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
	const a = text.flat.at[start] as Source;
	const b = text.flat.at[end - 1] as Source;
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
		range.commonAncestorContainer.nodeType === Node.TEXT_NODE
			? (range.commonAncestorContainer.parentNode ??
				range.commonAncestorContainer)
			: range.commonAncestorContainer;
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let n = walker.currentNode; n !== null; n = walker.nextNode() as Node) {
		if (n.nodeType !== Node.TEXT_NODE || !range.intersectsNode(n)) continue;
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
export type NoText = "nothing" | "field" | "typed";

/** The element of a range: the nearest element that holds all of it. */
function elementOfRange(range: Range): Element | null {
	const c = range.commonAncestorContainer;
	return c.nodeType === Node.ELEMENT_NODE
		? (c as Element)
		: (c.parentElement ?? null);
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
	if (span === undefined) return "nothing";
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
	if (quote === "" || lines.length === 0) return "nothing";
	return {
		element,
		highlight: { text: quote, ...contextOf(flat, span.start, e) },
		lines,
		cut,
	};
}

/**
 * Where a highlight's text is in `element` now, as a live range: by its
 * text, and by the text around it where it is there more than once. None
 * when it is not there any more (the text changed: often the fix).
 */
export function findText(
	element: Element,
	h: Pick<Highlight, "text" | "before" | "after">,
): Range | undefined {
	const text = elementText(element);
	const at = quoteIn(text.flat.text, h.text, h);
	return at === undefined ? undefined : rangeOf(text, at.start, at.end);
}

/** Whether `text` is within what a highlight may quote. */
export const quotable = (text: string): boolean =>
	text.trim() !== "" && textLength(text) <= HIGHLIGHT_LIMITS.text;
