import { describe, expect, test } from "bun:test";
import {
	accessPlan,
	afterAnswer,
	asksForSite,
	browserLabel,
	cannotRunText,
	isStorePage,
	noAccessHint,
	offerText,
	oneTabWay,
	optionNote,
	readMemory,
	refusalKind,
	shortcutText,
	type TabAccess,
	tabAccess,
	type Words,
	writeMemory,
} from "../src/sidepanel/access.ts";

const tab = (
	url: string,
	more: { loading?: boolean; cannotRun?: "page" | "file" } = {},
) => ({
	id: 1,
	url,
	title: "",
	size: undefined,
	...more,
});

describe("which tab Sitegloss may run on (DEC-022, DEC-076)", () => {
	test("an address: yes; none: not yet, or never where all sites is allowed already", () => {
		expect(tabAccess(tab("https://a.example/"), false)).toBe("yes");
		expect(tabAccess(tab(""), false)).toBe("ask");
		expect(tabAccess(tab(""), true)).toBe("never");
	});

	test("no tab, or one still loading: nothing is said", () => {
		expect(tabAccess(undefined, false)).toBe("yes");
		expect(tabAccess(tab("", { loading: true }), false)).toBe("yes");
	});

	test("the stores' pages are never, whatever is allowed", () => {
		for (const url of [
			"https://chromewebstore.google.com/detail/sitegloss/abc",
			"https://chrome.google.com/webstore/detail/x",
			"https://microsoftedge.microsoft.com/addons/detail/x",
			"https://addons.mozilla.org/en-US/firefox/addon/sitegloss/",
		]) {
			expect(isStorePage(url)).toBe(true);
			expect(tabAccess(tab(url), true)).toBe("never");
		}
		// Only those: a page that merely mentions a store is a page.
		expect(
			isStorePage("https://example.com/?u=https://addons.mozilla.org/"),
		).toBe(false);
		expect(isStorePage("https://addons.mozilla.org.evil.example/")).toBe(false);
	});

	test("a page the browser's refusal named (or a file without the switch) is never, with or without all sites", () => {
		expect(tabAccess(tab("", { cannotRun: "page" }), false)).toBe("never");
		expect(tabAccess(tab("", { cannotRun: "file" }), false)).toBe("never");
		expect(
			tabAccess(tab("https://a.example/t.pdf", { cannotRun: "page" }), true),
		).toBe("never");
	});
});

describe("the browser's refusal (DEC-076)", () => {
	test("a page no extension may run on, in the browsers' own words", () => {
		for (const message of [
			"The extensions gallery cannot be scripted.",
			"Cannot access a chrome:// URL",
			"Cannot access a chrome-extension:// URL of different extension",
		])
			expect(refusalKind(message)).toBe("cannot");
	});

	test("no access yet: the ways help", () => {
		for (const message of [
			"Cannot access contents of the page. Extension manifest must request permission to access the respective host.",
			"Missing host permission for the tab",
		])
			expect(refusalKind(message)).toBe("no-access");
		expect(refusalKind("something else")).toBeUndefined();
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
			offer: undefined,
			notice: undefined,
			inCase: undefined,
			pageControls: true,
		});
		expect(plan("yes", true, true).offer).toBeUndefined();
	});

	test("a page no extension may run on: that it cannot, never a way that cannot help; the offer, if still up, is the general one", () => {
		expect(plan("never", true, false)).toEqual({
			offer: undefined,
			notice: "cannot",
			inCase: "cannot",
			pageControls: false,
		});
		// A new user's first tab, the store: the offer stays neutral.
		expect(plan("never", false, false)).toEqual({
			offer: "general",
			notice: "cannot",
			inCase: "cannot",
			pageControls: false,
		});
	});

	test("this tab only (the icon was clicked): the offer until it is answered, then nothing", () => {
		expect(plan("yes", false, false).offer).toBe("general");
		expect(plan("yes", false, true)).toEqual({
			offer: undefined,
			notice: undefined,
			inCase: undefined,
			pageControls: true,
		});
	});

	test("no access to this tab: the offer says so, with no second notice; after Not now the notice; the case says why in either", () => {
		expect(plan("ask", false, false)).toEqual({
			offer: "for-tab",
			notice: undefined,
			inCase: "no-access",
			pageControls: false,
		});
		expect(plan("ask", false, true)).toEqual({
			offer: undefined,
			notice: "no-access",
			inCase: "no-access",
			pageControls: false,
		});
	});

	test("before the browser has answered whether all sites is allowed: no offer, no flash", () => {
		expect(plan("yes", false, false, false).offer).toBeUndefined();
		expect(plan("ask", false, false, false).notice).toBe("no-access");
	});
});

describe("the words (DEC-076)", () => {
	const chrome: Words = { firefox: false, browser: "Chrome", shortcut: "⌥⇧O" };
	const firefox: Words = {
		firefox: true,
		browser: "Firefox",
		shortcut: "Alt+Shift+O",
	};

	test("Firefox lets a click in only until the tab goes to another page; Chrome keeps it on the site", () => {
		expect(oneTabWay(firefox)).toContain("until the tab goes to another page");
		expect(optionNote(firefox)).toContain("until the tab goes to another page");
		expect(oneTabWay(chrome)).not.toContain("another page");
	});

	test("the shortcut as the browser has it, and none where none is set", () => {
		expect(oneTabWay(chrome)).toContain("press ⌥⇧O");
		expect(oneTabWay({ ...chrome, shortcut: undefined })).not.toContain(
			"press",
		);
	});

	test("the option names the browser's prompt, and what an AI app may then read on any site", () => {
		expect(optionNote(chrome)).toContain(
			"“Read and change all your data on all websites”",
		);
		expect(optionNote(firefox)).toContain(
			"“Access your data for all websites”",
		);
		const note = optionNote(chrome);
		expect(note).toContain("while AI access is on");
		expect(note).toContain("on any site");
		expect(note).not.toContain("tab in front only");
	});

	test("the browser by its name, or none it cannot tell", () => {
		expect(offerText(false, { ...chrome, browser: "Edge" }).text).toContain(
			"Edge asks",
		);
		expect(offerText(false, { ...chrome, browser: undefined }).text).toContain(
			"Your browser asks",
		);
		expect(offerText(true, chrome).head).toContain("no access to this tab");
		expect(offerText(false, chrome).head).not.toContain("no access");
	});

	test("a page no extension may run on offers no way; no access offers both", () => {
		for (const w of [chrome, firefox]) {
			expect(cannotRunText(w)).not.toContain("Allow");
			expect(cannotRunText(w)).not.toContain("click");
			expect(noAccessHint(w)).toContain("all sites");
			expect(noAccessHint(w)).toContain("click");
		}
	});

	test("browserLabel: the build says Firefox, the brands say Chrome or Edge, else none", () => {
		expect(browserLabel(true, undefined)).toBe("Firefox");
		expect(
			browserLabel(false, [{ brand: "Google Chrome" }, { brand: "Chromium" }]),
		).toBe("Chrome");
		expect(
			browserLabel(false, [{ brand: "Microsoft Edge" }, { brand: "Chromium" }]),
		).toBe("Edge");
		expect(browserLabel(false, [{ brand: "Chromium" }])).toBeUndefined();
		expect(browserLabel(false, undefined)).toBeUndefined();
	});

	test("shortcutText: unset is none; on a Mac the symbols, elsewhere as given", () => {
		const mac = { platform: "MacIntel" };
		const win = { userAgentData: { platform: "Windows" } };
		expect(shortcutText("", mac)).toBeUndefined();
		expect(shortcutText(undefined, win)).toBeUndefined();
		expect(shortcutText("Alt+Shift+O", mac)).toBe("⌥⇧O");
		expect(shortcutText("⇧⌥O", mac)).toBe("⇧⌥O");
		expect(shortcutText("Alt+Shift+O", win)).toBe("Alt+Shift+O");
	});
});

describe("Firefox asks for no single site when a page opens (DEC-076)", () => {
	test("Chrome asks in the click; Firefox, whose prompt the new tab would take away, does not", () => {
		const none = new Set<string>();
		expect(asksForSite("https://a.example/*", none, false)).toBe(true);
		expect(asksForSite("https://a.example/*", none, true)).toBe(false);
		expect(
			asksForSite(
				"https://a.example/*",
				new Set(["https://a.example/*"]),
				false,
			),
		).toBe(false);
		expect(asksForSite(undefined, none, false)).toBe(false);
	});
});

describe("what this browser remembers (DEC-076)", () => {
	const storage = () => {
		const kept = new Map<string, string>();
		return {
			getItem: (k: string) => kept.get(k) ?? null,
			setItem: (k: string, v: string) => void kept.set(k, v),
			removeItem: (k: string) => void kept.delete(k),
		};
	};

	test("Not now and allowed-once, written and read back", () => {
		const s = storage();
		expect(readMemory(s)).toEqual({ declined: false, wasAllowed: false });
		writeMemory(s, { declined: true, wasAllowed: true });
		expect(readMemory(s)).toEqual({ declined: true, wasAllowed: true });
	});

	test("a storage that refuses: offered again, no error", () => {
		const refusing = {
			getItem: () => {
				throw new Error("no");
			},
			setItem: () => {
				throw new Error("no");
			},
			removeItem: () => {
				throw new Error("no");
			},
		};
		expect(readMemory(refusing)).toEqual({
			declined: false,
			wasAllowed: false,
		});
		expect(() =>
			writeMemory(refusing, { declined: true, wasAllowed: false }),
		).not.toThrow();
	});

	test("taken back counts as a no, also when it happened with no panel open; the first answer and a grant do not", () => {
		const s = storage();
		// A panel sees all sites allowed, and remembers it.
		writeMemory(s, afterAnswer(readMemory(s), true));
		// The next panel, after the browser's settings took it back.
		const next = afterAnswer(readMemory(s), false);
		expect(next.declined).toBe(true);
		expect(
			afterAnswer({ declined: false, wasAllowed: false }, false).declined,
		).toBe(false);
		expect(afterAnswer({ declined: false, wasAllowed: false }, true)).toEqual({
			declined: false,
			wasAllowed: true,
		});
		// A no stays a no, also when allowed again later.
		expect(
			afterAnswer({ declined: true, wasAllowed: false }, true).declined,
		).toBe(true);
	});
});

describe("the browser's prompt is asked for in the click (DEC-076)", () => {
	// The browsers show `permissions.request` only during the person's click:
	// an `await` before it makes it fail (Firefox) or do nothing. Automation
	// cannot click a real prompt in Chrome, so the source is checked: each
	// handler that asks calls it before any `await`.
	const main = Bun.file(new URL("../src/sidepanel/main.ts", import.meta.url));

	const beforeAsk = (source: string, start: string, ask: string) => {
		const from = source.indexOf(start);
		expect(from).toBeGreaterThan(-1);
		const at = source.indexOf(ask, from);
		expect(at).toBeGreaterThan(from);
		return source.slice(from, at);
	};

	test("Allow on all sites, the option's box and a page's site", async () => {
		const source = await main.text();
		for (const [start, ask] of [
			["allowAllSites() {", "requestPermissions(ALL_SITES)"],
			['allSites.addEventListener("change"', "requestPermissions(ALL_SITES)"],
			["function askForSite(", "requestPermissions("],
			["openPage(c, url", "askForSite(url)"],
			["openMarkPage(c, a, where)", "askForSite(url)"],
		] as const)
			expect(beforeAsk(source, start, ask)).not.toMatch(/\bawait\b/);
	});
});
