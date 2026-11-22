import { describe, expect, test } from "bun:test";
import type { Case } from "../src/lib/case.ts";
import type { MarkMatch } from "../src/lib/messages.ts";
import {
	canDrawOn,
	dashDrawn,
	type FollowInput,
	followStep,
	foundLine,
	foundText,
	isUnsure,
	newsLetsIn,
	noneFound,
} from "../src/sidepanel/follow.ts";
import { sampleCase } from "./fixtures.ts";

const web = { id: 1, url: "http://localhost:3000/kk", loading: false };

const input = (change: Partial<FollowInput> = {}): FollowInput => ({
	caseId: "c_1",
	tab: web,
	drawn: undefined,
	pageCase: undefined,
	hidden: new Set(),
	...change,
});

describe("the open case's marks follow it to the tab in front", () => {
	test("opening a case draws it on the tab in front, whatever page that is", () => {
		for (const url of [
			"http://localhost:3000/kk",
			"https://dev.example.ch/other",
			"file:///Users/me/page.html",
		])
			expect(followStep(input({ tab: { ...web, url } }))).toEqual({
				clear: undefined,
				action: "draw",
			});
	});

	test("another tab in front: drawn there, taken off the one before", () => {
		const drawn = { tabId: 1, caseId: "c_1" };
		expect(followStep(input({ tab: { ...web, id: 2 }, drawn }))).toEqual({
			clear: drawn,
			action: "draw",
		});
	});

	test("the page shows the case already: left as it is (candidates chosen stay)", () => {
		// The panel's draw, still on the page.
		expect(
			followStep(
				input({ drawn: { tabId: 1, caseId: "c_1" }, pageCase: "c_1" }),
			),
		).toEqual({ clear: undefined, action: "none" });
		// An AI app's load_case drew it there.
		expect(followStep(input({ pageCase: "c_1" }))).toEqual({
			clear: undefined,
			action: "none",
		});
	});

	test("a new address within the page (a hash, pushState): the page still shows the case, no draw again", () => {
		// The same step follows any address change: what the page says decides.
		expect(
			followStep(
				input({
					tab: { ...web, url: "http://localhost:3000/kk#/other" },
					drawn: { tabId: 1, caseId: "c_1" },
					pageCase: "c_1",
				}),
			).action,
		).toBe("none");
	});

	test("the tab in front loaded again: the page shows nothing, drawn again", () => {
		expect(
			followStep(
				input({ drawn: { tabId: 1, caseId: "c_1" }, pageCase: undefined }),
			),
		).toEqual({ clear: undefined, action: "draw" });
	});

	test("drawn there, then an AI app put another case on the page: left to it", () => {
		expect(
			followStep(
				input({ drawn: { tabId: 1, caseId: "c_1" }, pageCase: "c_ai" }),
			).action,
		).toBe("none");
		// A tab the panel did not draw on gets the open case.
		expect(followStep(input({ pageCase: "c_ai" })).action).toBe("draw");
	});

	test("hidden on a tab: not drawn there again by itself", () => {
		expect(followStep(input({ hidden: new Set([1]) }))).toEqual({
			clear: undefined,
			action: "none",
		});
		// Elsewhere it is.
		expect(followStep(input({ hidden: new Set([2]) })).action).toBe("draw");
		// Leaving for a hidden tab still takes the marks off the tab before.
		const drawn = { tabId: 2, caseId: "c_1" };
		expect(followStep(input({ hidden: new Set([1]), drawn }))).toEqual({
			clear: drawn,
			action: "none",
		});
	});

	test("a tab Sitegloss may not run on: wait for the icon or Allow on all sites", () => {
		expect(followStep(input({ tab: { ...web, url: "" } }))).toEqual({
			clear: undefined,
			action: "wait",
		});
	});

	test("a tab still loading: nothing yet, its load draws", () => {
		expect(
			followStep(input({ tab: { ...web, url: "", loading: true } })).action,
		).toBe("none");
		expect(followStep(input({ tab: { ...web, loading: true } })).action).toBe(
			"none",
		);
	});

	test("a page no content script runs on (an extension's own, the browser's): nothing", () => {
		for (const url of [
			"chrome-extension://abc/sidepanel/index.html",
			"chrome://settings",
			"about:blank",
		]) {
			expect(canDrawOn(url)).toBe(false);
			expect(followStep(input({ tab: { ...web, url } })).action).toBe("none");
		}
	});

	test("no case open: the panel's marks go, nothing is drawn", () => {
		const drawn = { tabId: 1, caseId: "c_1" };
		expect(followStep(input({ caseId: undefined, drawn }))).toEqual({
			clear: drawn,
			action: "none",
		});
		expect(followStep(input({ tab: undefined, drawn }))).toEqual({
			clear: drawn,
			action: "none",
		});
	});

	test("another case's marks on the tab in front: the draw replaces them", () => {
		const drawn = { tabId: 1, caseId: "c_old" };
		expect(followStep(input({ drawn }))).toEqual({
			clear: undefined,
			action: "draw",
		});
		// Not drawn here: they go all the same.
		expect(followStep(input({ drawn, hidden: new Set([1]) }))).toEqual({
			clear: drawn,
			action: "none",
		});
	});
});

describe("news from a tab's overlay after the icon's click", () => {
	const hidden = { id: 4, url: "" };
	test("the tab the case waits for lets the case follow", () => {
		expect(newsLetsIn(4, 4, hidden)).toBe(true);
		expect(newsLetsIn(4, 4, { id: 4, url: "https://example.com/" })).toBe(true);
	});

	test("so does the tab in front with its address hidden, before follow found out it waits", () => {
		// The case opened, and the click came before follow had read the
		// tab twice and noted the wait: the news must not be lost.
		expect(newsLetsIn(4, undefined, hidden)).toBe(true);
	});

	test("not news from another tab, nor from one Sitegloss ran on already", () => {
		expect(newsLetsIn(5, undefined, hidden)).toBe(false);
		expect(
			newsLetsIn(4, undefined, { id: 4, url: "https://example.com/" }),
		).toBe(false);
		expect(newsLetsIn(undefined, 4, hidden)).toBe(false);
		expect(newsLetsIn(4, undefined, undefined)).toBe(false);
	});
});

describe("none of the case's marks found", () => {
	const match = (n: number, status: MarkMatch["status"]): MarkMatch => ({
		markId: `a${n}`,
		number: n,
		status,
		score: status === "lost" ? 0 : 0.9,
		current: 0,
		candidates: [],
	});

	test("every mark lost: none found", () => {
		expect(noneFound([match(1, "lost"), match(2, "lost")])).toBe(true);
	});

	test("lost and marks without an element: none found", () => {
		expect(noneFound([match(1, "lost"), match(2, "no-element")])).toBe(true);
	});

	test("one found, probable or unsure: some found", () => {
		for (const status of ["found", "probable", "ambiguous"] as const)
			expect(noneFound([match(1, "lost"), match(2, status)])).toBe(false);
	});

	test("only marks without an element, or none at all: nothing to tell by", () => {
		expect(noneFound([match(1, "no-element")])).toBe(false);
		expect(noneFound([])).toBe(false);
	});
});

describe("what a draw found, in a line (DEC-024)", () => {
	const candidate = (found: boolean) => ({
		score: found ? 0.9 : 0.6,
		summary: "button",
		selector: "button",
		visible: true,
		found,
	});
	const match = (
		n: number,
		status: MarkMatch["status"],
		sure = status === "found",
	): MarkMatch => ({
		markId: `a${n}`,
		number: n,
		status,
		score: status === "lost" ? 0 : 0.9,
		current: 0,
		candidates:
			status === "lost" || status === "no-element" ? [] : [candidate(sure)],
	});

	test("a mark is dashed on the page when its element is not sure, or it has none", () => {
		expect(isUnsure(match(1, "found"))).toBe(false);
		expect(isUnsure(match(1, "probable"))).toBe(true);
		// One of several, however good the shown one is.
		expect(isUnsure(match(1, "ambiguous", true))).toBe(true);
		expect(isUnsure(match(1, "no-element"))).toBe(true);
		// Not drawn at all.
		expect(isUnsure(match(1, "lost"))).toBe(false);
		// Another candidate chosen: that one decides.
		expect(
			isUnsure({
				...match(1, "found"),
				current: 1,
				candidates: [candidate(true), candidate(false)],
			}),
		).toBe(true);
	});

	const rect = { x: 0, y: 0, width: 10, height: 10 };
	const SHAPES = {
		element: { kind: "element", rect },
		box: { kind: "box", rect },
		note: { kind: "note", at: { x: 5, y: 5 } },
	} as const;
	/** A case on https://x.ch/kk with one mark per match, of these shapes. */
	const caseOf = (shapes: (keyof typeof SHAPES)[], shotUrl?: string): Case => ({
		...sampleCase("c_dash"),
		page: { ...sampleCase("c_dash").page, url: "https://x.ch/kk" },
		shots: [
			{
				id: "s1",
				image: "shots/s1.webp",
				scrollX: 0,
				scrollY: 0,
				...(shotUrl ? { url: shotUrl } : {}),
			} as Case["shots"][number],
		],
		marks: shapes.map(
			(shape, i) =>
				({
					id: `a${i + 1}`,
					number: i + 1,
					shot: "s1",
					comment: "",
					author: "user",
					shape: SHAPES[shape],
					crop: `crops/a${i + 1}.webp`,
					element: null,
				}) as Case["marks"][number],
		),
	});
	const HERE = "https://x.ch/kk?tab=2";

	test("all found and sure: the count and the page, no word on colours", () => {
		const matches = [match(1, "found"), match(2, "found")];
		expect(dashDrawn(caseOf(["element", "element"]), matches, HERE)).toBe(
			false,
		);
		expect(foundText(matches, "127.0.0.1/v2", false)).toBe(
			"2 of 2 marks found on 127.0.0.1/v2.",
		);
	});

	test("an unsure mark with a stroke is dashed: the line says so", () => {
		const matches = [match(1, "found"), match(2, "probable"), match(3, "lost")];
		const c = caseOf(["element", "element", "element"]);
		expect(dashDrawn(c, matches, HERE)).toBe(true);
		expect(
			foundText(matches, "127.0.0.1/v2", dashDrawn(c, matches, HERE)),
		).toBe("2 of 3 marks found on 127.0.0.1/v2. Dashed: unsure.");
	});

	test("a lost mark is not drawn: no dash, no word", () => {
		const matches = [match(1, "found"), match(2, "lost")];
		const c = caseOf(["element", "element"]);
		expect(foundText(matches, "x.ch", dashDrawn(c, matches, HERE))).toBe(
			"1 of 2 marks found on x.ch.",
		);
	});

	test("a note is its pin alone: unsure or without an element, it draws no dash", () => {
		const c = caseOf(["note", "note"]);
		const matches = [match(1, "probable"), match(2, "no-element")];
		expect(dashDrawn(c, matches, HERE)).toBe(false);
		expect(foundText(matches, "x.ch", dashDrawn(c, matches, HERE))).toBe(
			"1 of 2 marks found on x.ch.",
		);
	});

	test("a mark without an element is drawn, dashed, only on the route of its screenshot", () => {
		const matches = [match(1, "no-element")];
		// The case's page, and the page in front is that route.
		expect(dashDrawn(caseOf(["box"]), matches, HERE)).toBe(true);
		expect(foundText(matches, "x.ch", true)).toBe(
			"0 of 1 marks found on x.ch. Dashed: unsure.",
		);
		// Another route in front: review.ts draws nothing there.
		expect(dashDrawn(caseOf(["box"]), matches, "https://x.ch/other")).toBe(
			false,
		);
		// The mark's own screenshot was taken on another route of the app.
		expect(
			dashDrawn(caseOf(["box"], "https://x.ch/kk/step-2"), matches, HERE),
		).toBe(false);
		expect(
			dashDrawn(
				caseOf(["box"], "https://x.ch/kk/step-2"),
				matches,
				"https://x.ch/kk/step-2",
			),
		).toBe(true);
	});

	test("the line is worded from the matches as they are now: none where none was found or there is none yet", () => {
		const c = caseOf(["element", "element"]);
		const loaded = (matches: MarkMatch[], settling = false) => ({
			matches: new Map(matches.map((m) => [m.markId, m])),
			url: HERE,
			settling,
		});
		expect(foundLine(c, loaded([match(1, "found")]))).toBe(
			"1 of 1 marks found on x.ch/kk.",
		);
		expect(
			foundLine(c, loaded([match(1, "found"), match(2, "probable")])),
		).toBe("2 of 2 marks found on x.ch/kk. Dashed: unsure.");
		expect(foundLine(c, loaded([]))).toBeUndefined();
		expect(foundLine(c, loaded([match(1, "lost")]))).toBeUndefined();
		// Still looking: the count so far.
		expect(foundLine(c, loaded([match(1, "lost")], true))).toBe(
			"0 of 1 marks found on x.ch/kk.",
		);
	});

	test("it names no colour: a mark's colour is its status", () => {
		const said = foundText([match(1, "probable")], "x.ch", true);
		expect(said).not.toMatch(/green|amber/i);
	});
});
