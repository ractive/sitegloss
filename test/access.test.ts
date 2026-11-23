import { describe, expect, test } from "bun:test";
import {
	accessPlan,
	declinedBefore,
	NO_ACCESS_CASE,
	noAccessHint,
	offerText,
	oneTabWay,
	optionNote,
	rememberDeclined,
	type TabAccess,
	tabAccess,
	tookBack,
} from "../src/sidepanel/access.ts";

describe("which tab Sitegloss may run on (DEC-022, DEC-076)", () => {
	const tab = (url: string, loading = false) => ({
		id: 1,
		url,
		title: "",
		size: undefined,
		loading,
	});

	test("an address: yes; none: not yet, or never where all sites is allowed already", () => {
		expect(tabAccess(tab("https://a.example/"), false)).toBe("yes");
		expect(tabAccess(tab(""), false)).toBe("ask");
		expect(tabAccess(tab(""), true)).toBe("never");
	});

	test("no tab, or one still loading: nothing is said", () => {
		expect(tabAccess(undefined, false)).toBe("yes");
		expect(tabAccess(tab("", true), false)).toBe("yes");
	});
});

describe("what the panel offers and says (DEC-076)", () => {
	const plan = (
		tab: TabAccess,
		allSites: boolean,
		declined: boolean,
		known = true,
	) => accessPlan({ tab, allSites, declined, known });

	test("all sites allowed: no offer, nothing missing", () => {
		expect(plan("yes", true, false)).toEqual({
			home: undefined,
			offerForTab: false,
			inCase: undefined,
			pageControls: true,
		});
		// Declined before and allowed since: the same.
		expect(plan("yes", true, true).home).toBeUndefined();
	});

	test("all sites allowed and still no address: a page no extension may run on", () => {
		expect(plan("never", true, false)).toEqual({
			home: "cannot",
			offerForTab: false,
			inCase: "cannot",
			pageControls: false,
		});
	});

	test("this tab only (the icon was clicked): the offer until it is answered, then nothing", () => {
		expect(plan("yes", false, false)).toEqual({
			home: "offer",
			offerForTab: false,
			inCase: undefined,
			pageControls: true,
		});
		expect(plan("yes", false, true)).toEqual({
			home: undefined,
			offerForTab: false,
			inCase: undefined,
			pageControls: true,
		});
	});

	test("no access to this tab: the offer says so too; after Not now the notice; the case says why in either", () => {
		expect(plan("ask", false, false)).toEqual({
			home: "offer",
			offerForTab: true,
			inCase: "no-access",
			pageControls: false,
		});
		expect(plan("ask", false, true)).toEqual({
			home: "no-access",
			offerForTab: false,
			inCase: "no-access",
			pageControls: false,
		});
	});

	test("before the browser has answered whether all sites is allowed: no offer, no flash", () => {
		expect(plan("yes", false, false, false).home).toBeUndefined();
		expect(plan("ask", false, false, false).home).toBe("no-access");
	});
});

describe("the words, in Chrome and in Firefox (DEC-076)", () => {
	test("the one-tab way: the icon, under the puzzle piece until pinned, and the shortcut", () => {
		for (const firefox of [false, true]) {
			const way = oneTabWay(firefox);
			expect(way.startsWith("For this tab only: click ")).toBe(true);
			expect(way).toContain("puzzle piece");
			expect(way).toContain("Alt+Shift+O");
		}
		// Firefox lets it in only until the tab goes to another page.
		expect(oneTabWay(true)).toContain("until the tab goes to another page");
		expect(oneTabWay(false)).not.toContain("another page");
	});

	test("the offer and the option name the browser, and its prompt's own words", () => {
		expect(offerText(false, false).text).toContain("Chrome asks you first");
		expect(offerText(false, true).text).toContain("Firefox asks you first");
		expect(offerText(true, false).head).toBe(
			"Sitegloss has no access to this tab yet",
		);
		expect(offerText(false, false).head).toContain("(recommended)");
		expect(offerText(true, false).text).toContain("(recommended)");
		expect(JSON.stringify(offerText(false, false))).not.toContain("no access");
		expect(optionNote(false)).toContain(
			"“Read and change all your data on all websites”",
		);
		expect(optionNote(true)).toContain("“Access your data for all websites”");
		for (const firefox of [false, true]) {
			const note = optionNote(firefox);
			expect(note).toContain("your marks are not drawn and cannot be shown");
			expect(note).toContain(
				"on the tab in front only and sends nothing anywhere by itself.",
			);
		}
	});

	test("the hint after an action found no access names both ways", () => {
		for (const firefox of [false, true]) {
			const hint = noAccessHint(firefox);
			expect(hint).toContain("Allow it on all sites (under Options)");
			expect(hint).toContain("Alt+Shift+O");
		}
		expect(NO_ACCESS_CASE).toContain("marks are not drawn here");
	});
});

describe("Not now is kept in this browser (DEC-076)", () => {
	const storage = () => {
		const kept = new Map<string, string>();
		return {
			getItem: (k: string) => kept.get(k) ?? null,
			setItem: (k: string, v: string) => void kept.set(k, v),
		};
	};

	test("remembered, and read back", () => {
		const s = storage();
		expect(declinedBefore(s)).toBe(false);
		rememberDeclined(s);
		expect(declinedBefore(s)).toBe(true);
	});

	test("a storage that refuses: offered again, no error", () => {
		const refusing = {
			getItem: () => {
				throw new Error("no");
			},
			setItem: () => {
				throw new Error("no");
			},
		};
		expect(declinedBefore(refusing)).toBe(false);
		expect(() => rememberDeclined(refusing)).not.toThrow();
	});

	test("all sites taken back counts as a no; the first answer and a grant do not", () => {
		expect(tookBack(true, false)).toBe(true);
		expect(tookBack(undefined, false)).toBe(false);
		expect(tookBack(false, false)).toBe(false);
		expect(tookBack(false, true)).toBe(false);
	});
});
