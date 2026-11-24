/**
 * How the overlay draws on the page (DEC-024): every stroke with a white
 * casing under it, a loaded mark's colour its status and its dash the match.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { Shape } from "../src/lib/case.ts";
import { MARK_COLOUR } from "../src/lib/marks.ts";

const window = new Window({ url: "https://www.example.com/kk" });
const globals = globalThis as unknown as Record<string, unknown>;
const before = {
	document: globals["document"],
	CSSStyleSheet: globals["CSSStyleSheet"],
};
let o: typeof import("../src/content/overlay.ts");
let overlay: InstanceType<
	typeof import("../src/content/overlay.ts")["Overlay"]
>;

beforeAll(async () => {
	globals["document"] = window.document;
	globals["CSSStyleSheet"] = window.CSSStyleSheet;
	o = await import("../src/content/overlay.ts");
	overlay = new o.Overlay(window.document as unknown as Document);
});

afterAll(() => {
	overlay.setReviewing(false);
	overlay.setAddingMarks(false);
	globals["document"] = before.document;
	globals["CSSStyleSheet"] = before.CSSStyleSheet;
});

const rect = { x: 10, y: 20, width: 100, height: 40 };
const SHAPES: Shape[] = [
	{ kind: "element", rect },
	{ kind: "box", rect },
	{ kind: "arrow", from: { x: 0, y: 0 }, to: { x: 50, y: 50 } },
	{
		kind: "pen",
		points: [
			{ x: 0, y: 0 },
			{ x: 5, y: 9 },
			{ x: 12, y: 4 },
		],
	},
];

/** A shape's parts in a group, without its pin: [tag, casing?, stroke, width, dash]. */
const parts = (group: Element) =>
	[...group.querySelectorAll("rect, line, polygon, polyline")]
		.filter((e) => !e.hasAttribute("data-element"))
		.map((e) => ({
			tag: e.tagName.toLowerCase(),
			casing: e.hasAttribute("data-casing"),
			stroke: e.getAttribute("stroke"),
			fill: e.getAttribute("fill"),
			width: Number(e.getAttribute("stroke-width")),
			dash: e.getAttribute("stroke-dasharray"),
		}));

const item = (
	number: number,
	shape: Shape,
	change: Partial<import("../src/content/overlay.ts").ReviewItem> = {},
) => ({
	number,
	shape,
	rect: null,
	found: true,
	focused: false,
	status: "open" as const,
	...change,
});

describe("a mark on the page", () => {
	test("each stroke is drawn twice: a white casing 3 px wider, then the colour", () => {
		overlay.renderReview(SHAPES.map((shape, i) => item(i + 1, shape)));
		for (const [i, shape] of SHAPES.entries()) {
			const group = overlay.marks.querySelector(
				`[data-review="${i + 1}"]`,
			) as Element;
			const drawn = parts(group);
			const casings = drawn.filter((p) => p.casing);
			const strokes = drawn.filter((p) => !p.casing);
			expect(casings.length).toBe(strokes.length);
			expect(casings.length).toBe(shape.kind === "arrow" ? 2 : 1);
			// The casing lies under the colour.
			expect(drawn.findLastIndex((p) => p.casing)).toBeLessThan(
				drawn.findIndex((p) => !p.casing),
			);
			for (const c of casings) {
				expect(c.stroke).toBe(o.PAGE_LOOK.casing);
				expect(c.dash).toBeNull();
			}
			const line = strokes.find((p) => p.tag !== "polygon");
			const under = casings.find((p) => p.tag === line?.tag);
			expect(line?.stroke).toBe(MARK_COLOUR);
			expect(under?.width).toBe((line?.width ?? 0) + o.CASING_EXTRA);
			// The pin keeps its white ring.
			const pin = group.querySelector("[data-number] circle");
			expect(pin?.getAttribute("stroke")).toBe(o.PAGE_LOOK.casing);
			expect(pin?.getAttribute("fill")).toBe(MARK_COLOUR);
		}
	});

	test("an arrow's head has its casing too: white, with a white edge", () => {
		overlay.renderReview([item(1, SHAPES[2] as Shape)]);
		const heads = parts(
			overlay.marks.querySelector('[data-review="1"]') as Element,
		).filter((p) => p.tag === "polygon");
		expect(heads.map((p) => [p.casing, p.fill])).toEqual([
			[true, o.PAGE_LOOK.casing],
			[false, MARK_COLOUR],
		]);
	});

	test("a note is its pin alone", () => {
		overlay.renderReview([item(1, { kind: "note", at: { x: 5, y: 5 } })]);
		const group = overlay.marks.querySelector('[data-review="1"]') as Element;
		expect(parts(group)).toEqual([]);
		expect(group.querySelector("[data-number]")).not.toBeNull();
	});

	test("the colour is the status: open as on the screenshot, to verify indigo, verified green, dismissed grey", () => {
		const want = {
			open: MARK_COLOUR,
			fixed: o.STATUS_COLOUR.toVerify,
			verified: o.STATUS_COLOUR.verified,
			wontfix: o.STATUS_COLOUR.dismissed,
			cantreproduce: o.STATUS_COLOUR.dismissed,
		} as const;
		expect(o.STATUS_COLOUR).toEqual({
			open: "#e0185c",
			toVerify: "#4f53e0",
			verified: "#1a7f37",
			dismissed: "#667085",
		});
		const statuses = Object.keys(want) as (keyof typeof want)[];
		overlay.renderReview(
			statuses.map((status, i) => item(i + 1, SHAPES[0] as Shape, { status })),
		);
		for (const [i, status] of statuses.entries()) {
			expect(o.reviewColour({ status })).toBe(want[status]);
			const group = overlay.marks.querySelector(
				`[data-review="${i + 1}"]`,
			) as Element;
			expect(group.getAttribute("data-status")).toBe(status);
			expect(
				parts(group)
					.filter((p) => !p.casing)
					.map((p) => p.stroke),
			).toEqual([want[status]]);
			// The pin is the status's colour too.
			expect(
				group.querySelector("[data-number] circle")?.getAttribute("fill"),
			).toBe(want[status]);
		}
	});

	test("the dash is the match: solid when found, dashed when unsure, whatever the status", () => {
		expect(o.reviewStroke({ found: true, focused: false })).toEqual({
			"stroke-width": 3,
		});
		expect(o.reviewStroke({ found: false, focused: true })).toEqual({
			"stroke-width": 4,
			"stroke-dasharray": "8 5",
			"stroke-linecap": "butt",
		});
		overlay.renderReview([
			item(1, SHAPES[0] as Shape),
			item(2, SHAPES[0] as Shape, { found: false }),
			item(3, SHAPES[0] as Shape, { found: false, status: "verified" }),
		]);
		const dash = (n: number) =>
			parts(overlay.marks.querySelector(`[data-review="${n}"]`) as Element).map(
				(p) => [p.casing, p.dash],
			);
		expect(dash(1)).toEqual([
			[true, null],
			[false, null],
		]);
		// The casing stays whole under the dashes.
		expect(dash(2)).toEqual([
			[true, null],
			[false, "8 5"],
		]);
		expect(dash(3)).toEqual(dash(2));
	});

	test("verified and dismissed marks are faded with their casing, the pin solid; open and to verify show fully; focused, any does", () => {
		expect(o.RESOLVED_OPACITY).toBe(0.35);
		const statuses = [
			"open",
			"fixed",
			"verified",
			"wontfix",
			"cantreproduce",
		] as const;
		overlay.renderReview([
			...statuses.map((status, i) =>
				item(i + 1, SHAPES[0] as Shape, { status }),
			),
			item(6, SHAPES[0] as Shape, { status: "verified", focused: true, rect }),
		]);
		const group = (n: number) =>
			overlay.marks.querySelector(`[data-review="${n}"]`) as Element;
		expect(
			statuses.map(
				(_, i) => group(i + 1).querySelector("[data-faded]") !== null,
			),
		).toEqual([false, false, true, true, true]);
		const faded = group(3).querySelector("[data-faded]") as Element;
		expect(faded.getAttribute("opacity")).toBe(String(o.RESOLVED_OPACITY));
		expect(faded.querySelectorAll("rect").length).toBe(2);
		expect(faded.querySelector("[data-number]")).toBeNull();
		expect(group(3).querySelector("[data-number]")).not.toBeNull();
		expect(group(6).querySelector("[data-faded]")).toBeNull();
		// Its element's outline has a casing as well.
		const outline = group(6).querySelector("[data-element]") as Element;
		expect(outline.previousElementSibling?.hasAttribute("data-casing")).toBe(
			true,
		);
	});

	test("drafts and the hover outline are cased too", () => {
		overlay.render(
			[{ number: 1, shape: SHAPES[1] as Shape }],
			SHAPES[3] as Shape,
			rect,
		);
		const drafts = overlay.marks.querySelector(".drafts") as Element;
		const hover = [...drafts.querySelectorAll("rect.hover")];
		expect(hover.map((e) => e.hasAttribute("data-casing"))).toEqual([
			true,
			false,
		]);
		expect(hover[1]?.getAttribute("stroke")).toBe(o.HOVER_COLOUR);
		const rest = parts(drafts).filter((p) => p.stroke !== o.HOVER_COLOUR);
		// The hover's casing, the box twice, the pen being drawn twice.
		expect(rest.map((p) => [p.tag, p.casing])).toEqual([
			["rect", true],
			["rect", true],
			["rect", false],
			["polyline", true],
			["polyline", false],
		]);
	});
});

describe("the overlay's style", () => {
	test("one fixed look: the bars' ring, a light popover, two rows on purpose, forced colours", async () => {
		const source = await Bun.file(
			new URL("../src/content/overlay.ts", import.meta.url),
		).text();
		// A white ring before the drop shadow, on the three of them.
		expect(source).toContain(
			'const RING = "0 0 0 1px rgba(255, 255, 255, 0.75)";',
		);
		expect(source.match(/box-shadow: \$\{SHADOW\};/g)?.length).toBe(3);
		expect(source).toContain("color-scheme: light;");
		expect(source).toContain("@media (forced-colors: active)");
		expect(source).toContain("background: Highlight;");
		// In forced colours no state of a green button brings the green back: its
		// hover and focus rules outside the block are more specific than a
		// plain selector inside it, so the block names them too.
		const forced = source.slice(
			source.indexOf("@media (forced-colors: active)"),
		);
		const highlight = forced.slice(0, forced.indexOf("background: Highlight;"));
		const rule = highlight.slice(highlight.lastIndexOf("}") + 1);
		for (const selector of [
			'.toolbar button[aria-pressed="true"]:hover',
			".toolbar button.primary:hover",
			".toolbar button.primary:focus-visible",
			".popover button.primary:hover",
		])
			expect(rule).toContain(selector);
		// Every rule filled with the action's green gives way to Highlight.
		const green = [
			...source.matchAll(
				/^(.*)\{[^}]*background: \$\{L\.(popoverA|a)ction(Hover)?\}/gm,
			),
		]
			.flatMap((m) => (m[1] as string).split(","))
			.map((selector) => selector.trim())
			.filter((selector) => selector !== "");
		expect(green.length).toBeGreaterThanOrEqual(5);
		for (const selector of green) expect(rule).toContain(selector);
		// No page width decides the toolbar's layout: it is measured.
		expect(source).not.toMatch(/@media \((max|min)-width/);
	});

	test("the bars' logo is the small icon's pen loop, cropped to it (DEC-029)", async () => {
		const { SMALL_LOGO } = await import("../src/lib/logo.ts");
		const el = o.ring(window.document as unknown as Document);
		expect(el.tagName.toLowerCase()).toBe("svg");
		expect(el.getAttribute("class")).toBe("ring");
		expect(el.querySelector("circle")).toBeNull();
		const d = el.querySelector("path")?.getAttribute("d") ?? "";
		expect(d.split("L").length).toBe(SMALL_LOGO.loop.length);
		// Cropped: the loop's stroke fills the box, wider than high.
		const [x, y, w, h] = (el.getAttribute("viewBox") ?? "")
			.split(" ")
			.map(Number) as [number, number, number, number];
		expect(x).toBeGreaterThan(0);
		expect(y).toBeGreaterThan(0);
		expect(w).toBeGreaterThan(h);
		expect(w).toBeLessThan(128);
		expect(el.querySelector("title")?.textContent).toBe("Sitegloss");
		// The forced-colours rule still paints it in the system's text colour.
		const source = await Bun.file(
			new URL("../src/content/overlay.ts", import.meta.url),
		).text();
		const forced = source.slice(
			source.indexOf("@media (forced-colors: active)"),
		);
		expect(forced).toContain(".ring { stroke: CanvasText; }");
	});

	test("a dialog's button says the key that presses it: ⌘↵ on macOS, Ctrl+↵ elsewhere", () => {
		for (const [nav, mac] of [
			[{ userAgentData: { platform: "macOS" }, platform: "MacIntel" }, true],
			[{ userAgentData: { platform: "Windows" }, platform: "Win32" }, false],
			// Firefox and Safari have no client hint.
			[{ platform: "MacIntel" }, true],
			[{ platform: "Linux x86_64" }, false],
			[{ userAgentData: { platform: "" }, platform: "MacIntel" }, true],
		] as const)
			expect(o.isMac(nav)).toBe(mac);
		const doc = window.document as unknown as Document;
		const at = (mac: boolean) => {
			const button = doc.createElement("button");
			button.textContent = "Done";
			return o.withSaveKey(button, mac);
		};
		expect(at(true).textContent).toBe("Done⌘↵");
		expect(at(true).getAttribute("aria-keyshortcuts")).toBe("Meta+Enter");
		expect(at(false).textContent).toBe("DoneCtrl+↵");
		expect(at(false).getAttribute("aria-keyshortcuts")).toBe("Control+Enter");
		// Out of the button's name, which stays its label.
		expect(at(false).querySelector(".keys")?.getAttribute("aria-hidden")).toBe(
			"true",
		);
	});
});

describe("the toolbar's layout is measured, not guessed from the page's width", () => {
	const button = (top: () => number) => {
		const b = window.document.createElement("button");
		Object.defineProperty(b, "offsetTop", { get: top });
		return b as unknown as HTMLElement;
	};
	/** A toolbar whose row overflows, or whose last button wraps, in these fits. */
	const withRoomFrom = (first: string) => {
		const bar = overlay.toolbar;
		const tight = () => o.TOOLBAR_FITS.indexOf(bar.dataset["fit"] as never);
		const fits = () => tight() >= o.TOOLBAR_FITS.indexOf(first as never);
		Object.defineProperty(bar, "clientWidth", {
			configurable: true,
			get: () => 600,
		});
		Object.defineProperty(bar, "scrollWidth", {
			configurable: true,
			get: () => (fits() ? 600 : 700),
		});
		bar.replaceChildren(
			button(() => 5),
			button(() => (fits() ? 5 : 35)),
		);
	};

	test("the first layout that fits: the status beside the tools (buttons closer, if need be), then under them, then icons, then closer", () => {
		overlay.setAddingMarks(true);
		for (const fit of o.TOOLBAR_FITS) {
			withRoomFrom(fit);
			overlay.fitToolbar();
			expect<string | undefined>(overlay.toolbar.dataset["fit"]).toBe(fit);
		}
		// Each step from "rows" on keeps what the one before did.
		expect(o.TOOLBAR_FITS).toEqual([
			"",
			"snug",
			"rows",
			"rows icons",
			"rows icons all",
			"rows icons all tight",
		]);
	});

	test("nothing fits: the tightest stays; hidden, it is left as it is", () => {
		const bar = overlay.toolbar;
		Object.defineProperty(bar, "scrollWidth", {
			configurable: true,
			get: () => 900,
		});
		bar.replaceChildren(
			button(() => 5),
			button(() => 35),
		);
		overlay.fitToolbar();
		expect<string | undefined>(bar.dataset["fit"]).toBe("rows icons all tight");
		overlay.setAddingMarks(false);
		bar.dataset["fit"] = "rows";
		overlay.fitToolbar();
		expect<string | undefined>(bar.dataset["fit"]).toBe("rows");
	});

	test("the review bar steps aside while marks are added, and is the pill while the marks are hidden (DEC-061)", () => {
		overlay.setReviewing(true);
		expect(overlay.reviewBar.hidden).toBe(false);
		overlay.setAddingMarks(true);
		expect(overlay.reviewBar.hidden).toBe(true);
		overlay.setAddingMarks(false);
		expect(overlay.reviewBar.hidden).toBe(false);
		// Hidden marks: nothing drawn, the bar (the pill) stays.
		overlay.setReviewing(false);
		overlay.setMarksHidden(true);
		expect(overlay.layer.hidden).toBe(false);
		expect(overlay.reviewBar.hidden).toBe(false);
		overlay.setMarksHidden(false);
		expect(overlay.reviewBar.hidden).toBe(true);
	});

	test("the bar's place: kept inside the window, read back only as two numbers, moved by keys and a double click (DEC-061)", () => {
		// 8 px from every edge, whatever was kept; a small window keeps it top right.
		expect(o.clampBar({ right: -40, top: 900 }, 300, 40, 1280, 800)).toEqual({
			right: 8,
			top: 752,
		});
		expect(o.clampBar({ right: 1200, top: 20 }, 300, 40, 1280, 800)).toEqual({
			right: 972,
			top: 20,
		});
		expect(o.clampBar({ right: 100, top: 100 }, 300, 40, 200, 30)).toEqual({
			right: 8,
			top: 8,
		});
		expect(o.storedBarPlace({ right: 40, top: 60 })).toEqual({
			right: 40,
			top: 60,
		});
		expect(o.storedBarPlace({ right: "40", top: 60 })).toBeUndefined();
		expect(o.storedBarPlace(undefined)).toBeUndefined();
		const moved: unknown[] = [];
		overlay.onBarMoved = (p) => void moved.push(p);
		overlay.setReviewing(true);
		const grip = document.createElement("button");
		grip.className = "grip";
		overlay.reviewBar.append(grip);
		overlay.setBarPlace({ right: 100, top: 100 });
		grip.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "ArrowLeft",
				bubbles: true,
			}) as unknown as Event,
		);
		grip.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "ArrowDown",
				shiftKey: true,
				bubbles: true,
			}) as unknown as Event,
		);
		expect(overlay.barPlace).toEqual({
			right: 100 + o.BAR_STEP,
			top: 100 + 4 * o.BAR_STEP,
		});
		overlay.reviewBar.dispatchEvent(
			new window.MouseEvent("dblclick", { bubbles: true }) as unknown as Event,
		);
		expect(overlay.barPlace).toEqual(o.BAR_HOME);
		expect(moved).toHaveLength(3);
		grip.remove();
		overlay.onBarMoved = undefined;
		overlay.setReviewing(false);
	});

	test("a window that shrinks moves the bar in; grown back, the bar is where the person left it (DEC-064's review)", () => {
		overlay.setReviewing(true);
		const width = window.innerWidth;
		const set = (w: number) => {
			Object.defineProperty(window, "innerWidth", {
				value: w,
				configurable: true,
			});
			window.dispatchEvent(new window.Event("resize"));
		};
		overlay.setBarPlace({ right: 600, top: 40 });
		set(400);
		expect(overlay.barPlace.right).toBeLessThan(600);
		set(1280);
		expect(overlay.barPlace).toEqual({ right: 600, top: 40 });
		set(width);
		overlay.setReviewing(false);
	});

	test("a wider page lays it out again", async () => {
		overlay.setAddingMarks(true);
		withRoomFrom("rows icons");
		overlay.fitToolbar();
		expect<string | undefined>(overlay.toolbar.dataset["fit"]).toBe(
			"rows icons",
		);
		withRoomFrom("");
		window.dispatchEvent(new window.Event("resize"));
		await new Promise((done) => window.requestAnimationFrame(() => done(0)));
		expect<string | undefined>(overlay.toolbar.dataset["fit"]).toBe("");
		overlay.setAddingMarks(false);
	});
});

describe("a loaded mark's pin and the one popover (DEC-027)", () => {
	const pinAt = { kind: "box" as const, rect };

	test("reviewAt answers the mark whose pin is at the point, the one drawn last first", () => {
		overlay.setReviewing(true);
		overlay.renderReview([
			item(1, pinAt),
			item(2, { kind: "note", at: { x: 300, y: 300 } }),
			item(3, { kind: "box", rect: { ...rect, x: 14 } }),
		]);
		// A box's pin is at its corner, 11 px each way and 2 px to spare.
		expect(overlay.reviewAt(-2, 20)).toBe(1);
		// Under two pins: the one on top.
		expect(overlay.reviewAt(12, 22)).toBe(3);
		expect(overlay.reviewAt(300, 312)).toBe(2);
		expect(overlay.reviewAt(60, 40)).toBeUndefined();
		// No marks shown: nothing to pick.
		overlay.setReviewing(false);
		expect(overlay.reviewAt(-2, 20)).toBeUndefined();
	});

	test("a pin moved into what shows of its element (DEC-075) is picked where it is drawn", () => {
		overlay.setReviewing(true);
		overlay.renderReview([
			item(1, pinAt, {
				clip: { x: 0, y: 100, width: 800, height: 500 },
				pin: { x: rect.x, y: 111 },
			}),
		]);
		expect(overlay.reviewAt(rect.x, 111)).toBe(1);
		expect(overlay.reviewAt(rect.x, rect.y)).toBeUndefined();
		overlay.setReviewing(false);
	});

	test("a press on a pin picks its mark; a press on its shape does not", () => {
		overlay.setReviewing(true);
		overlay.renderReview([item(7, pinAt)]);
		const picked: number[] = [];
		overlay.onPick = (number) => picked.push(number);
		const group = overlay.marks.querySelector('[data-review="7"]') as Element;
		const press = (target: Element, button = 0) =>
			target.dispatchEvent(
				new window.MouseEvent("pointerdown", {
					bubbles: true,
					button,
				}) as never,
			);
		press(group.querySelector("[data-number] circle") as Element);
		expect(picked).toEqual([7]);
		press(group.querySelector("[data-number] text") as Element, 2);
		expect(picked).toEqual([7]);
		overlay.onPick = undefined;
		overlay.setReviewing(false);
	});

	test("one popover: whoever opens it closes the other's, which is told once", () => {
		const told: string[] = [];
		const text = (value: string) => window.document.createTextNode(value);
		overlay.openPopover([text("first") as never], () => told.push("first"));
		expect(overlay.popover.hidden).toBe(false);
		expect(overlay.popover.textContent).toBe("first");
		overlay.openPopover([text("second") as never], () => told.push("second"));
		expect(told).toEqual(["first"]);
		expect(overlay.popover.textContent).toBe("second");
		// Its owner closes it itself: nobody is told.
		overlay.closePopover();
		expect(overlay.popover.hidden).toBe(true);
		expect(overlay.popover.childNodes.length).toBe(0);
		expect(overlay.dismissPopover()).toBe(false);
		expect(told).toEqual(["first"]);
		overlay.openPopover([text("third") as never], () => told.push("third"));
		expect(overlay.dismissPopover()).toBe(true);
		expect(told).toEqual(["first", "third"]);
		expect(overlay.popover.hidden).toBe(true);
	});
});

test("three digits get the smaller number, on the page and in the screenshot (DEC-064's second review)", async () => {
	const { paintMark } = await import("../src/lib/marks.ts");
	const note = { kind: "note" as const, at: { x: 40, y: 40 } };
	// On the page: the pin's number as the overlay draws it.
	overlay.renderReview([item(99, note), item(100, note)]);
	const size = (n: number) =>
		overlay.marks
			.querySelector(`[data-review="${n}"] [data-number] text`)
			?.getAttribute("font-size");
	expect([size(99), size(100)]).toEqual(["11", "9"]);
	// In the screenshot: the font the canvas is given for each number.
	const fonts: string[] = [];
	const ctx = new Proxy(
		{},
		{
			get: (_t, key) => (key === "font" ? undefined : () => undefined),
			set: (_t, key, value) => {
				if (key === "font") fonts.push(String(value));
				return true;
			},
		},
	) as unknown as OffscreenCanvasRenderingContext2D;
	paintMark(ctx, { number: 99, shape: note });
	paintMark(ctx, { number: 100, shape: note });
	expect(fonts.map((f) => f.split(" ")[1])).toEqual(["11px", "9px"]);
});
