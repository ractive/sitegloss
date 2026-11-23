/**
 * The Highlight tool's pure parts and its format (DEC-066): an element's
 * text as one line, where a quote is in it, the line boxes of a selection,
 * the stroke, and what a case keeps of a highlight. The browser's side (a
 * selection, its rects) is test/e2e/highlight.test.ts's.
 */

import { describe, expect, test } from "bun:test";
import {
	type Case,
	type Highlight,
	type Mark,
	validateCase,
} from "../src/lib/case.ts";
import { luminance } from "../src/lib/colour.ts";
import {
	contextOf,
	cutSpan,
	flatSpan,
	flatten,
	lineBoxes,
	quoteIn,
} from "../src/lib/highlight.ts";
import { caseMarkdown } from "../src/lib/markdown.ts";
import {
	HIGHLIGHT_LOOK,
	isDarkGround,
	markerPath,
	pinPosition,
} from "../src/lib/marks.ts";
import { sampleCase, withOneMark } from "./fixtures.ts";

describe("an element's text as one line", () => {
	test("white space collapses to one space, a block's edge is one, none at the ends", () => {
		const flat = flatten([
			{ text: "  Ride the\n  forest " },
			{ text: "trails", gap: false },
			{ text: "this wekend", gap: true },
			{ text: "   " },
		]);
		expect(flat.text).toBe("Ride the forest trails this wekend");
		// Each character says where it is in its text node.
		expect(flat.at[0]).toEqual({ piece: 0, offset: 2 });
		const t = flat.text.indexOf("trails");
		expect(flat.at[t]).toEqual({ piece: 1, offset: 0 });
		// The space for the block's edge is at the start of the next node.
		expect(flat.at[t + 6]).toEqual({ piece: 2, offset: 0 });
	});

	test("a span between two places, without spaces at its ends", () => {
		const flat = flatten([{ text: "one two  three" }]);
		expect(
			flatSpan(flat, { piece: 0, offset: 3 }, { piece: 0, offset: 9 }),
		).toEqual({ start: 4, end: 7 });
		expect(
			flatSpan(flat, { piece: 0, offset: 7 }, { piece: 0, offset: 9 }),
		).toBeUndefined();
	});
});

describe("where a quote is in an element's text", () => {
	const text =
		"Price: CHF 25 per day. Gravel: CHF 25 per day, helmet included.";

	test("the one place it is", () => {
		expect(quoteIn(text, "helmet")).toEqual({
			start: text.indexOf("helmet"),
			end: text.indexOf("helmet") + 6,
		});
	});

	test("of two places, the one with the same text around it; the first of equals", () => {
		const second = text.lastIndexOf("CHF 25");
		expect(quoteIn(text, "CHF 25", { before: "Gravel: " })?.start).toBe(second);
		expect(quoteIn(text, "CHF 25", { after: " per day," })?.start).toBe(second);
		expect(quoteIn(text, "CHF 25")?.start).toBe(text.indexOf("CHF 25"));
	});

	test("none when the text changed", () => {
		expect(quoteIn("this weekend", "wekend")).toBeUndefined();
		expect(quoteIn(text, "")).toBeUndefined();
	});

	test("the text around it: at most 32 characters each side, none where there is none", () => {
		const long = `${"a".repeat(40)}QUOTE${"b".repeat(40)}`;
		const at = long.indexOf("QUOTE");
		expect(contextOf(long, at, at + 5)).toEqual({
			before: "a".repeat(32),
			after: "b".repeat(32),
		});
		expect(contextOf("QUOTE", 0, 5)).toEqual({});
		// Characters, not UTF-16 units: an emoji is one.
		const emoji = `${"😀".repeat(40)}Q`;
		expect([
			...(contextOf(emoji, emoji.length - 1, emoji.length).before ?? ""),
		]).toHaveLength(32);
	});

	test("a span longer than 500 characters is cut to 500, without a space at its end", () => {
		const words = "word ".repeat(200);
		const end = cutSpan(words, 0, words.length);
		expect(end).toBeLessThanOrEqual(500);
		expect(words.slice(0, end).endsWith(" ")).toBe(false);
		expect(cutSpan("short", 0, 5)).toBe(5);
	});
});

describe("the line boxes of a selection", () => {
	const r = (x: number, y: number, width: number, height = 20) => ({
		x,
		y,
		width,
		height,
	});

	test("the rects of one line are one box; two lines two; empty ones go", () => {
		expect(
			lineBoxes([
				r(10, 100, 50),
				// A link inside the line: its own rect, a little taller.
				r(60, 98, 40, 24),
				r(100, 100, 80),
				r(10, 124, 120),
				r(300, 124, 0),
			]),
		).toEqual([r(10, 98, 170, 24), r(10, 124, 120)]);
	});

	test("two columns side by side stay two boxes, top to bottom then left to right", () => {
		expect(lineBoxes([r(400, 50, 100), r(10, 50, 100), r(10, 10, 60)])).toEqual(
			[r(10, 10, 60), r(10, 50, 100), r(400, 50, 100)],
		);
	});
});

describe("the stroke", () => {
	test("is the logo's swipe round each line: curved corners, a little wider than the text", () => {
		const d = markerPath({ x: 100, y: 200, width: 300, height: 20 });
		expect(d.startsWith("M")).toBe(true);
		expect(d.match(/C/g)).toHaveLength(4);
		const xs = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map(
			(m) => Number(m[1]),
		);
		expect(Math.min(...xs)).toBeLessThan(100);
		expect(Math.max(...xs)).toBeGreaterThan(400);
		// A long line climbs no more than the logo's swipe does over its word.
		const ys = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map(
			(m) => Number(m[2]),
		);
		expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(20 + 4);
	});

	test("its pin is just left of the first line, centred on it", () => {
		expect(
			pinPosition({
				shape: { kind: "box", rect: { x: 0, y: 0, width: 500, height: 60 } },
				lines: [
					{ x: 120, y: 10, width: 300, height: 20 },
					{ x: 0, y: 34, width: 500, height: 20 },
				],
			}),
		).toEqual({ x: 109, y: 20 });
		// At the window's left edge it moves in, whole.
		expect(
			pinPosition({
				shape: { kind: "box", rect: { x: 4, y: 10, width: 300, height: 20 } },
				lines: [{ x: 4, y: 10, width: 300, height: 20 }],
			}).x,
		).toBe(11);
	});

	const lum = ([r, g, b]: number[]) =>
		luminance({ r: r as number, g: g as number, b: b as number, a: 1 });
	const ratio = (x: number[], y: number[]) => {
		const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p) as [number, number];
		return (hi + 0.05) / (lo + 0.05);
	};
	const hex = (h: string) =>
		[1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
	const amber = hex(HIGHLIGHT_LOOK.colour);

	test("text under it stays readable on a light page: the stroke is multiplied with it", () => {
		const multiplied = (c: number[]) =>
			c.map((v, i) => (v * (amber[i] as number)) / 255);
		const white = hex("#ffffff");
		// Ink on white (16.1:1) and the grey of secondary text (6.7:1).
		expect(
			ratio(multiplied(hex("#1b2130")), multiplied(white)),
		).toBeGreaterThan(9.8);
		expect(
			ratio(multiplied(hex("#535c6e")), multiplied(white)),
		).toBeGreaterThan(5.4);
	});

	test("text under it stays readable on a dark page: the stroke is laid over it, translucent", () => {
		const a = HIGHLIGHT_LOOK.darkOpacity;
		const laid = (c: number[]) =>
			c.map((v, i) => (amber[i] as number) * a + v * (1 - a));
		// Light text on Chromium's dark canvas (16.1:1) and on the panel's ink.
		expect(ratio(laid(hex("#eceef3")), laid(hex("#121212")))).toBeGreaterThan(
			7,
		);
		expect(ratio(laid(hex("#eceef3")), laid(hex("#1b2130")))).toBeGreaterThan(
			6,
		);
	});

	test("the ground decides: dark below the luminance where black and white text are equal", () => {
		expect(isDarkGround("rgb(18, 18, 18)")).toBe(true);
		expect(isDarkGround("rgb(27, 33, 48)")).toBe(true);
		expect(isDarkGround("rgb(255, 255, 255)")).toBe(false);
		expect(isDarkGround("rgb(242, 194, 48)")).toBe(false);
		expect(isDarkGround("oklch(0.2 0 0)")).toBe(false);
		expect(isDarkGround(undefined)).toBe(false);
	});
});

describe("what a case keeps of a highlight", () => {
	const highlight: Highlight = {
		text: "wekend",
		before: "Ride the forest trails this ",
		after: ": pick up a bike",
		rects: [{ x: 210, y: 140, width: 58, height: 22 }],
	};
	const marked = (
		h: unknown,
		shape: Mark["shape"] = {
			kind: "box",
			rect: { x: 210, y: 140, width: 58, height: 22 },
		},
	): Case => {
		const c = withOneMark(sampleCase());
		return {
			...c,
			marks: c.marks.map((a) => ({ ...a, shape, highlight: h as Highlight })),
		};
	};

	test("kept as it is, within the limits", () => {
		expect(validateCase(marked(highlight)).marks[0]?.highlight).toEqual(
			highlight,
		);
	});

	test("outside the limits or on another shape it goes, and the mark stays", () => {
		const outside = [
			{ ...highlight, text: "x".repeat(501) },
			{ ...highlight, text: "  " },
			{ ...highlight, before: "b".repeat(33) },
			{ ...highlight, rects: [] },
			{
				...highlight,
				rects: Array.from({ length: 41 }, () => highlight.rects[0]),
			},
			{ ...highlight, rects: [{ x: 1, y: 2 }] },
			// An empty box, and one outside the shape's.
			{ ...highlight, rects: [{ x: 210, y: 140, width: 0, height: 22 }] },
			{ ...highlight, rects: [{ x: 210, y: 300, width: 58, height: 22 }] },
			"wekend",
		];
		// On a box drawn right to left (a negative size), as the server reads it.
		expect(
			validateCase(
				marked(highlight, {
					kind: "box",
					rect: { x: 268, y: 162, width: -58, height: -22 },
				}),
			).marks[0]?.highlight,
		).toEqual(highlight);
		for (const h of outside) {
			const [a] = validateCase(marked(h)).marks;
			expect(a?.highlight).toBeUndefined();
			expect(a?.comment).toBe("Too pale");
		}
		expect(
			validateCase(marked(highlight, { kind: "note", at: { x: 1, y: 2 } }))
				.marks[0]?.highlight,
		).toBeUndefined();
		// 500 characters, emoji counted as one.
		expect(
			validateCase(marked({ ...highlight, text: "😀".repeat(500) })).marks[0]
				?.highlight?.text,
		).toHaveLength(1000);
	});

	test("case.md names it a highlight and quotes its text, as the server's does", () => {
		const md = caseMarkdown(
			validateCase(
				marked({
					...highlight,
					text: "a *wekend* [x](y) https://evil.example www.evil.example a@b.example",
				}),
			),
		);
		expect(md).toContain("### 1. highlight");
		// No live link in page text: a previewer links no bare address.
		expect(md).toContain(
			"- Highlighted text: a \\*wekend\\* \\[x\\](y) https\\://evil.example www\\.evil.example a\\@b.example",
		);
	});
});
