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
/**
 * A filled control without an edge (the default button, the web app's
 * secondary): its fill apart from what it stands on, as the web theme holds
 * it (sitegloss.dev's palette: 1.3:1 on the page and a card, 1.15:1 on the
 * quiet fill). Its words carry the 4.5:1.
 */
const FILL = 1.3;
const FILL_ON_QUIET = 1.15;

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
	[
		"--ink",
		[...SURFACES, "--field"],
		[15.81, 16.36, 14.44, 16.67],
		[15.74, 14.61, 12.42, 13.44],
		TEXT,
	],
	// A button's words on its fill, hovered and pressed.
	[
		"--ink",
		["--control", "--control-hover", "--control-press"],
		[11.67, 10.35, 9.24],
		[10.45, 9.11, 7.92],
		TEXT,
	],
	[
		"--ink-2",
		[...SURFACES, "--field"],
		[7.32, 7.57, 6.69, 7.72],
		[9.63, 8.94, 7.6, 8.22],
		TEXT,
	],
	// A placeholder on a field: lighter than text (DEC-060).
	["--placeholder", ["--field"], [4.62], [4.73], TEXT],
	[
		"--edge",
		["--paper", "--sheet", "--field"],
		[3.46, 3.58, 3.65],
		[4.28, 3.97, 3.65],
		EDGE,
	],
	["--control", ["--paper", "--sheet"], [1.35, 1.4], [1.51, 1.4], FILL],
	["--control", ["--wash"], [1.24], [1.19], FILL_ON_QUIET],
	// The main action: the green with its text, and as a control on the panel.
	[
		"--on-strong",
		["--strong", "--strong-hover"],
		[12.76, 14.39],
		[7.59, 8.48],
		TEXT,
	],
	["--strong", ["--paper", "--sheet"], [12.76, 13.2], [7.59, 7.05], EDGE],
	// The waiting dot's edge (amber on paper).
	["--accent-edge", ["--paper", "--sheet"], [4.29, 4.44], [9.8, 9.09], EDGE],
	// The knob of an "Allow all changes" switch that is on (DEC-037).
	["--on-strong", ["--st-verified"], [6.99], [9.99], EDGE],
	["--link", ["--paper", "--sheet"], [7.06, 7.31], [10.04, 9.32], TEXT],
	["--focus", ["--paper", "--sheet"], [12.76, 13.2], [7.59, 7.05], TEXT],
	[
		"--st-open",
		["--paper", "--sheet", "--st-open-bg"],
		[5.74, 5.94, 5.18],
		[9.21, 8.55, 7.43],
		TEXT,
	],
	[
		"--st-verify",
		["--paper", "--sheet", "--st-verify-bg"],
		[5.46, 5.65, 4.98],
		[9.49, 8.81, 7.52],
		TEXT,
	],
	[
		"--st-verified",
		["--paper", "--sheet", "--st-verified-bg"],
		[6.99, 7.23, 6.41],
		[9.99, 9.27, 7.71],
		TEXT,
	],
	[
		"--st-dismissed",
		["--paper", "--st-dismissed-bg"],
		[7.32, 6.69],
		[9.63, 7.6],
		TEXT,
	],
	// A pin: the page's colours in both schemes, the white number on it, and
	// the pin on the panel's paper.
	[
		"--on-pin",
		["--pin-open", "--pin-verify", "--pin-verified", "--pin-dismissed"],
		[4.71, 5.76, 5.08, 4.62],
		[4.71, 5.76, 5.08, 4.62],
		TEXT,
	],
	[
		"--paper",
		["--pin-open", "--pin-verify", "--pin-verified", "--pin-dismissed"],
		[4.47, 5.46, 4.82, 4.38],
		[3.81, 3.12, 3.53, 3.88],
		EDGE,
	],
	[
		"--danger",
		["--paper", "--sheet", "--danger-bg"],
		[8.08, 8.36, 7.32],
		[9.17, 8.52, 7.35],
		TEXT,
	],
	// A destructive button: red words on the default button's fill.
	[
		"--danger",
		["--control", "--control-hover"],
		[5.96, 5.29],
		[6.09, 5.31],
		TEXT,
	],
	["--on-danger", ["--danger"], [8.08], [9.17], TEXT],
	["--warn", ["--warn-bg"], [6.67], [7.56], TEXT],
	["--ink", ["--warn-bg", "--danger-bg"], [14.43, 14.33], [12.35, 12.6], TEXT],
	["--warn-edge", ["--paper"], [4.05], [4.21], EDGE],
];

/**
 * Pairs the components use beyond the review's table: status words and the
 * banner's lines on the surfaces they stand on, edges on tinted notices.
 */
const USED: Row[] = [
	// A history's verb on the open mark's sheet.
	["--st-dismissed", ["--sheet"], [7.57], [8.94], TEXT],
	// "Paused: …" in the sync section, on paper.
	["--warn", ["--paper"], [7.3], [9.63], TEXT],
	// The banner's problem line, and quiet text and links on a notice.
	["--danger", ["--warn-bg"], [7.38], [7.2], TEXT],
	["--ink-2", ["--warn-bg", "--danger-bg"], [6.68, 6.63], [7.56, 7.71], TEXT],
	["--link", ["--warn-bg", "--wash"], [6.45, 6.45], [7.88, 7.92], TEXT],
	// A reopened mark's line while its row is hovered.
	["--st-open", ["--wash"], [5.25], [7.27], TEXT],
	// A field's or a chip's edge on a wash, a notice and a failed banner.
	[
		"--edge",
		["--wash", "--warn-bg", "--danger-bg"],
		[3.16, 3.16, 3.14],
		[3.38, 3.36, 3.43],
		EDGE,
	],
	// The banner's and a notice's own edge against their fill.
	["--warn-edge", ["--warn-bg"], [3.7], [3.3], EDGE],
	["--danger", ["--danger-bg"], [7.32], [7.35], EDGE],
];

describe("the panel's tokens", () => {
	test("both schemes define every colour, and dark changes the ones it must", () => {
		expect(Object.keys(light).length).toBeGreaterThanOrEqual(29);
		// The web app's page, cream 1 in both schemes (sitegloss.dev's DEC-034).
		expect(light["--paper"]).toBe("#fcf9ed");
		expect(dark["--paper"]).toBe("#181712");
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
		["toolbar text on the bar", L.barText, L.bar, 15.81, TEXT],
		["muted text on the bar", L.barMuted, L.bar, 8.94, TEXT],
		["toolbar text on hover", L.barText, L.barHover, 9.85, TEXT],
		["muted text on hover", L.barMuted, L.barHover, 5.57, TEXT],
		[
			"the bar's ink on the green (pressed tool, Add mark N)",
			L.bar,
			L.action,
			7.05,
			TEXT,
		],
		["the bar's ink on the green, hovered", L.bar, L.actionHover, 7.87, TEXT],
		["the bar on a white page", L.bar, WHITE, 16.67, EDGE],
		["its white ring on a black page", L.casing, BLACK, 21, EDGE],
		["popover text", L.popoverText, L.popover, 16.67, TEXT],
		["popover muted text", L.popoverMuted, L.popover, 7.72, TEXT],
		["popover placeholder", L.popoverPlaceholder, L.popover, 4.62, TEXT],
		["popover field edge", L.popoverEdge, L.popover, 3.65, EDGE],
		[
			"popover main button on the popover",
			L.popoverAction,
			L.popover,
			13.45,
			EDGE,
		],
		[
			"popover main button's text",
			L.popoverActionText,
			L.popoverAction,
			12.76,
			TEXT,
		],
		[
			"popover main button's text, hovered",
			L.popoverActionText,
			L.popoverActionHover,
			14.39,
			TEXT,
		],
		["popover button's text", L.popoverText, L.popoverControl, 11.67, TEXT],
		[
			"popover button's text, hovered",
			L.popoverText,
			L.popoverControlHover,
			10.35,
			TEXT,
		],
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
		// The bars are the panel's dark scheme, the popover its light one.
		expect<string>(L.action).toBe(dark["--strong"] as string);
		expect<string>(L.actionHover).toBe(dark["--strong-hover"] as string);
		expect<string>(L.barMuted).toBe(dark["--ink-2"] as string);
		expect<string>(L.popoverAction).toBe(light["--strong"] as string);
		expect<string>(L.popoverActionText).toBe(light["--on-strong"] as string);
		expect<string>(L.popoverControl).toBe(light["--control"] as string);
		expect<string>(L.logo).toBe(light["--accent"] as string);
		expect<string>(L.popoverEdge).toBe(light["--edge"] as string);
		expect<string>(L.popoverMuted).toBe(light["--ink-2"] as string);
		expect<string>(L.popoverPlaceholder).toBe(light["--placeholder"] as string);
	});

	test("an open mark on the page is the colour of the mark on its screenshot", () => {
		expect<string>(STATUS_COLOUR.open).toBe(MARK_COLOUR);
	});
});
