import { describe, expect, test } from "bun:test";
import { MAX_TITLE, type PageInfo, withTitle } from "../src/lib/case.ts";
import type { OverlayState } from "../src/lib/messages.ts";
import {
	firstTitle,
	isUntouched,
	mayHold,
	newCase,
} from "../src/sidepanel/fresh.ts";
import { withOneMark } from "./fixtures.ts";

const NOW = "2026-11-13T10:00:00.000Z";

const page = (change: Partial<PageInfo> = {}): PageInfo => ({
	url: "https://shop.example/cart?session=abc#top",
	title: "Your cart",
	lang: "en",
	viewport: { width: 1280, height: 800, dpr: 2 },
	userAgent: "test",
	...change,
});

describe("a case created by New case for this page (DEC-026)", () => {
	test("has the page's title, the page's info, and nothing else yet", () => {
		const c = newCase("c_new", page(), NOW);
		expect(c).toEqual({
			format: "sitegloss/2",
			id: "c_new",
			title: "Your cart",
			createdAt: NOW,
			updatedAt: NOW,
			// Kept as a mark's page is: no query, no fragment (DEC-009).
			page: { ...page(), url: "https://shop.example/cart" },
			// Its first page, in the list a case's pages are in (DEC-038).
			pages: [
				{ url: "https://shop.example/cart", title: "Your cart", lang: "en" },
			],
			shots: [],
			marks: [],
			verdict: null,
		});
	});

	test("a page without a title gives its short address", () => {
		expect(firstTitle(page({ title: "   " }))).toBe("shop.example/cart");
		expect(newCase("c_new", page({ title: "" }), NOW).title).toBe(
			"shop.example/cart",
		);
		expect(firstTitle({ url: "https://shop.example/", title: "" })).toBe(
			"shop.example",
		);
		expect(firstTitle({ url: "", title: "" })).toBe("Untitled case");
	});

	test("a page title of invisible characters gives the short address", () => {
		expect(firstTitle(page({ title: "\u200b\u2060" }))).toBe(
			"shop.example/cart",
		);
		expect(firstTitle(page({ title: "\u202eCart" }))).toBe("Cart");
	});

	test("a long page title is cut to a case title's length", () => {
		const long = "x".repeat(MAX_TITLE + 20);
		expect(newCase("c_new", page({ title: long }), NOW).title).toBe(
			"x".repeat(MAX_TITLE),
		);
	});
});

describe("an untouched case goes when it is left (DEC-026)", () => {
	const fresh = () => newCase("c_new", page(), NOW);

	test("as it was made: untouched, a long title cut too", () => {
		expect(isUntouched(fresh())).toBe(true);
		const long = newCase("c_long", page({ title: "y".repeat(600) }), NOW);
		expect(isUntouched(long)).toBe(true);
		const untitled = newCase("c_bare", page({ title: "" }), NOW);
		expect(isUntouched(untitled)).toBe(true);
	});

	test("a mark in it: the user's", () => {
		expect(isUntouched(withOneMark(fresh()))).toBe(false);
		// A link being typed in its form keeps the case, as a typed title does.
		expect(
			isUntouched(fresh(), undefined, undefined, " https://t.example.com/1"),
		).toBe(false);
		expect(isUntouched(fresh(), undefined, undefined, "  ")).toBe(true);
	});

	test("a link attached: the user's (DEC-028)", () => {
		const linked = {
			...fresh(),
			link: "https://tickets.example.com/browse/ABC-123",
		};
		expect(isUntouched(linked)).toBe(false);
	});

	test("its only mark taken out by the toolbar's Undo: the user's, it stays", () => {
		// Undo frees the number and records that a mark was stored.
		const undone = {
			...withOneMark(fresh()),
			marks: [],
			shots: [],
			lastNumber: 0,
		};
		expect(isUntouched(undone)).toBe(false);
	});

	test("its marks deleted in the side panel: the user's, it stays", () => {
		expect(
			isUntouched({ ...fresh(), lastNumber: 2, marks: [], shots: [] }),
		).toBe(false);
	});

	test("renamed, given a summary, or one typed and not saved: the user's", () => {
		expect(isUntouched(withTitle(fresh(), "Login", NOW))).toBe(false);
		expect(isUntouched({ ...fresh(), verdict: "Make it darker" })).toBe(false);
		expect(isUntouched(fresh(), "Make it")).toBe(false);
		// Blank text is nothing typed.
		expect(isUntouched({ ...fresh(), verdict: "  " }, " ")).toBe(true);
	});

	test("a title typed in Rename and not saved: the user's, as a typed summary", () => {
		expect(isUntouched(fresh(), undefined, "Checkout bugs")).toBe(false);
		// The field opened and left as it was, or emptied: nothing typed.
		expect(isUntouched(fresh(), undefined, "  Your cart ")).toBe(true);
		expect(isUntouched(fresh(), undefined, "   ")).toBe(true);
	});

	test("screenshots without marks: not as it was made, it stays", () => {
		const shots = withOneMark(fresh()).shots;
		expect(isUntouched({ ...fresh(), shots })).toBe(false);
	});

	test("imported from a file: someone's case, it stays", () => {
		expect(isUntouched({ ...fresh(), importedAt: NOW })).toBe(false);
	});
});

describe("never on doubt: a page that may hold a mark keeps the case", () => {
	const state = (change: Partial<OverlayState> = {}): OverlayState => ({
		visible: false,
		url: "https://shop.example/cart",
		title: "Cart",
		drafts: 0,
		saving: false,
		...change,
	});
	const target = { caseId: "c_new", title: "Cart", nextMark: 1 };

	test("no content script anywhere, or toolbars of other cases: nothing holds it", () => {
		expect(mayHold([], "c_new")).toBe(false);
		expect(mayHold(["none", "none"], "c_new")).toBe(false);
		expect(
			mayHold(
				[
					state({
						visible: true,
						drafts: 2,
						target: { ...target, caseId: "c_other" },
					}),
				],
				"c_new",
			),
		).toBe(false);
		// A page that shows the case's marks holds no mark of it.
		expect(mayHold([state({ loadedCase: "c_new" })], "c_new")).toBe(false);
	});

	test("a toolbar adding to it on any tab, up or hidden with a failed mark, holds it", () => {
		expect(mayHold(["none", state({ visible: true, target })], "c_new")).toBe(
			true,
		);
		expect(mayHold([state({ drafts: 1, target })], "c_new")).toBe(true);
		expect(mayHold([state({ saving: true, target })], "c_new")).toBe(true);
	});

	test("a tab that did not answer in time may hold one: the case stays", () => {
		expect(mayHold(["none", "unsure"], "c_new")).toBe(true);
	});
});
