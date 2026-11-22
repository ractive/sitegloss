/**
 * The look's contrast (DEC-024): every pair of the two tables in
 * kb/design/ux-review-2026-11.md, computed from the tokens in style.css (light
 * and dark) and from the page overlay's constants. WCAG 2.2: text 4.5:1,
 * boundaries and large text 3:1.
 */

import { describe, expect, test } from "bun:test";
import {
	HOVER_COLOUR,
	PAGE_LOOK,
	STATUS_COLOUR,
} from "../src/content/overlay.ts";
import { MARK_COLOUR } from "../src/lib/marks.ts";

const css = await Bun.file(
	new URL("../src/sidepanel/style.css", import.meta.url),
).text();

/** The custom properties with a colour of the first `:root` block from `at`. */
function tokens(at: number): Record<string, string> {
	const start = css.indexOf(":root", at);
	const block = css.slice(start, css.indexOf("}", start));
	return Object.fromEntries(
		[...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\s*;/g)].map((m) => [
			m[1] as string,
			m[2] as string,
		]),
	);
}

const light = tokens(0);
const dark = {
	...light,
	...tokens(css.indexOf("@media (prefers-color-scheme: dark)")),
};

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two colours, as the tables give it. */
function ratio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
		number,
		number,
	];
	return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

const TEXT = 4.5;
const EDGE = 3;

/** A row of the panel's table: a token on each of some others. */
type Row = [
	on: string,
	under: string[],
	light: number[],
	dark: number[],
	needs: number,
];

const SURFACES = ["--paper", "--sheet", "--wash"];

const PANEL: Row[] = [
	["--ink", SURFACES, [14.61, 16.07, 13.12], [15.89, 14.37, 12.38], TEXT],
	["--ink-2", SURFACES, [6.11, 6.72, 5.49], [8.26, 7.48, 6.44], TEXT],
	// A placeholder on a field (fields are the sheet): lighter than text (DEC-060).
	["--placeholder", ["--sheet"], [4.63], [4.62], TEXT],
	["--edge", ["--paper", "--sheet"], [3.51, 3.86], [4.39, 3.97], EDGE],
	[
		"--accent-ink",
		["--accent", "--accent-hover"],
		[8.77, 7.66],
		[8.77, 9.96],
		TEXT,
	],
	["--accent-edge", ["--paper", "--sheet"], [4.12, 4.53], [10.06, 9.1], EDGE],
	["--on-strong", ["--strong"], [16.07], [15.89], TEXT],
	// The knob of an "Allow all changes" switch that is on (DEC-037).
	["--on-strong", ["--st-verified"], [6.44], [9.85], EDGE],
	["--link", ["--paper", "--sheet"], [6.12, 6.73], [9.19, 8.32], TEXT],
	["--focus", ["--paper", "--sheet"], [6.12, 6.73], [9.19, 8.32], TEXT],
	[
		"--st-open",
		["--paper", "--sheet", "--st-open-bg"],
		[5.51, 6.06, 5.03],
		[7.53, 6.81, 6.54],
		TEXT,
	],
	[
		"--st-verify",
		["--paper", "--sheet", "--st-verify-bg"],
		[6.4, 7.04, 5.87],
		[8.88, 8.03, 7.08],
		TEXT,
	],
	[
		"--st-verified",
		["--paper", "--sheet", "--st-verified-bg"],
		[5.86, 6.44, 5.51],
		[9.85, 8.91, 7.64],
		TEXT,
	],
	[
		"--st-dismissed",
		["--paper", "--st-dismissed-bg"],
		[6.11, 5.63],
		[8.26, 6.26],
		TEXT,
	],
	[
		"--on-pin",
		["--st-open", "--st-verify", "--st-verified", "--st-dismissed"],
		[6.06, 7.04, 6.44, 6.72],
		[7.53, 8.88, 9.85, 8.26],
		TEXT,
	],
	[
		"--danger",
		["--paper", "--sheet", "--danger-bg"],
		[5.94, 6.54, 5.46],
		[8.36, 7.56, 7.25],
		TEXT,
	],
	["--on-danger", ["--danger"], [6.54], [8.36], TEXT],
	["--warn", ["--warn-bg"], [6.83], [9.53], TEXT],
	["--ink", ["--warn-bg", "--danger-bg"], [14.22, 13.41], [12.59, 13.78], TEXT],
	["--warn-edge", ["--paper"], [4.25], [6.26], EDGE],
];

/**
 * Pairs the components use beyond the review's table: status words and the
 * banner's lines on the surfaces they stand on, edges on tinted notices.
 */
const USED: Row[] = [
	// A history's verb on the open mark's sheet.
	["--st-dismissed", ["--sheet"], [6.72], [7.48], TEXT],
	// "Paused: …" in the sync section, on paper.
	["--warn", ["--paper"], [7.01], [12.02], TEXT],
	// The banner's problem line, and quiet text and links on a notice.
	["--danger", ["--warn-bg"], [5.79], [6.63], TEXT],
	["--ink-2", ["--warn-bg", "--danger-bg"], [5.95, 5.61], [6.55, 7.17], TEXT],
	["--link", ["--warn-bg", "--wash"], [5.95, 5.49], [7.29, 7.16], TEXT],
	// A reopened mark's line while its row is hovered.
	["--st-open", ["--wash"], [4.95], [5.87], TEXT],
	// A default button's edge on a wash, a notice and a failed banner.
	[
		"--edge",
		["--wash", "--warn-bg", "--danger-bg"],
		[3.15, 3.41, 3.22],
		[3.42, 3.48, 3.81],
		EDGE,
	],
	// The banner's and a notice's own edge against their fill.
	["--warn-edge", ["--warn-bg"], [4.14], [4.97], EDGE],
	["--danger", ["--danger-bg"], [5.46], [7.25], EDGE],
];

describe("the panel's tokens", () => {
	test("both schemes define every colour, and dark changes the ones it must", () => {
		expect(Object.keys(light).length).toBeGreaterThanOrEqual(29);
		expect(light["--paper"]).toBe("#f6f4ee");
		expect(dark["--paper"]).toBe("#11141a");
		// The ink band and its colours are gone (DEC-024).
		expect(css).not.toMatch(/--band|--on-ink|--mark\b|--amber/);
	});

	for (const [on, under, inLight, inDark, needs] of [...PANEL, ...USED])
		for (const [i, below] of under.entries())
			for (const [scheme, t, want] of [
				["light", light, inLight[i]],
				["dark", dark, inDark[i]],
			] as const)
				test(`${on} on ${below}, ${scheme}: ${want}:1 (needs ${needs})`, () => {
					const got = ratio(t[on] as string, t[below] as string);
					expect(got).toBe(want as number);
					expect(got).toBeGreaterThanOrEqual(needs);
				});
});

describe("the page's fixed colours", () => {
	const L = PAGE_LOOK;
	const WHITE = "#ffffff";
	const BLACK = "#000000";
	const strokes = [
		STATUS_COLOUR.open,
		STATUS_COLOUR.toVerify,
		STATUS_COLOUR.verified,
		STATUS_COLOUR.dismissed,
	];
	const STROKES = [4.71, 5.76, 5.08, 4.97];

	const rows: [string, string, string, number, number][] = [
		["toolbar text on the bar", L.barText, L.bar, 16.07, TEXT],
		["muted text on the bar", L.barMuted, L.bar, 9.88, TEXT],
		["toolbar text on hover", L.barText, L.barHover, 11.73, TEXT],
		["muted text on hover", L.barMuted, L.barHover, 7.21, TEXT],
		["ink on amber (pressed tool, Add mark N)", L.bar, L.amber, 8.77, TEXT],
		["ink on amber, hovered", L.bar, L.amberHover, 7.66, TEXT],
		["the bar on a white page", L.bar, WHITE, 16.07, EDGE],
		["its white ring on a black page", L.casing, BLACK, 21, EDGE],
		["popover text", L.popoverText, L.popover, 16.07, TEXT],
		["popover muted text", L.popoverMuted, L.popover, 6.72, TEXT],
		["popover placeholder", L.popoverPlaceholder, L.popover, 4.63, TEXT],
		["popover field edge", L.popoverEdge, L.popover, 3.86, EDGE],
		["popover amber button's edge", L.amberEdge, L.popover, 4.53, EDGE],
		["the hover outline on white", HOVER_COLOUR, WHITE, 4.63, EDGE],
	];
	for (const [name, a, b, want, needs] of rows)
		test(`${name}: ${want}:1 (needs ${needs})`, () => {
			expect(ratio(a, b)).toBe(want);
			expect(ratio(a, b)).toBeGreaterThanOrEqual(needs);
		});

	for (const [i, status] of (
		["open", "verify", "verified", "dismissed"] as const
	).entries()) {
		const stroke = strokes[i] as string;
		const want = STROKES[i] as number;
		test(`a ${status} mark's stroke on white, its casing against it, and the white numeral on its pin: ${want}:1`, () => {
			// On a white page the stroke is the edge (3:1); on a dark one its
			// white casing is, against the stroke; the pin's numeral is text.
			expect(ratio(stroke, WHITE)).toBe(want);
			expect(ratio(L.casing, stroke)).toBe(want);
			expect(want).toBeGreaterThanOrEqual(TEXT);
		});
	}

	test("the bars and the popover are one look in both schemes: the page's is not asked", () => {
		expect<string>(L.bar).toBe(light["--ink"] as string);
		expect<string>(L.amber).toBe(light["--accent"] as string);
		expect<string>(L.popoverEdge).toBe(light["--edge"] as string);
		expect<string>(L.popoverMuted).toBe(light["--ink-2"] as string);
		expect<string>(L.popoverPlaceholder).toBe(light["--placeholder"] as string);
	});

	test("an open mark on the page is the colour of the mark on its screenshot", () => {
		expect<string>(STATUS_COLOUR.open).toBe(MARK_COLOUR);
	});
});
