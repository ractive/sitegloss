/**
 * Where a mark was made (DEC-050): the offer on Home held to the same page of
 * the same site, a case opened by hand drawn by path whatever the host (a
 * home page too), and the screenshot's query kept beside its plain address,
 * from the toolbar's save to the file and back.
 */

import { describe, expect, test } from "bun:test";
import {
	type Case,
	exactPage,
	isOfferedOn,
	type Mark,
	markAddress,
	onPageInFront,
	pageAt,
	pageInFront,
	pageKey,
	pathKey,
	pendingImage,
	type Shot,
	samePage,
	samePath,
	shotAddress,
	validateCase,
	viewportAt,
} from "../src/lib/case.ts";
import { exportCase, readExport, storeImport } from "../src/lib/export.ts";
import { caseMarkdown } from "../src/lib/markdown.ts";
import type { MarkMatch } from "../src/lib/messages.ts";
import { type Crop, type MarkDraft, saveCase } from "../src/lib/save.ts";
import { MemoryStore } from "../src/lib/store.ts";
import { keepsLoaded } from "../src/sidepanel/ai-open.ts";
import { findsOn } from "../src/sidepanel/follow.ts";
import { newCase } from "../src/sidepanel/fresh.ts";
import {
	linkStep,
	markTargets,
	mayLoadAndShow,
	type PendingShow,
	pendingAfterDraw,
	shortAddress,
	tryShow,
	verifiesHere,
} from "../src/sidepanel/mark-link.ts";
import { pageView } from "../src/worker/tools.ts";
import caseFile from "./case-file.json" with { type: "json" };
import caseMd from "./case-md.json" with { type: "json" };
import { putCase, sampleCase, withOneMark } from "./fixtures.ts";

const HOME = "https://shop.example/";
const SEARCH = "https://shop.example/search";
const CART_ELSEWHERE = "http://localhost:3000/cart";
const NOW = "2026-11-21T10:00:00.000Z";

const shot = (id: string, url: string, query?: string, width = 1280): Shot => ({
	id,
	image: `shots/${id}.webp`,
	scrollX: 0,
	scrollY: 0,
	viewport: { width, height: 800, dpr: 2 },
	capturedAt: "2026-11-21T09:00:00.000Z",
	url,
	...(query === undefined ? {} : { query }),
});

const mark = (n: number, shotId: string): Mark => ({
	id: `m${n}`,
	number: n,
	shot: shotId,
	comment: `comment ${n}`,
	author: "user",
	shape: { kind: "box", rect: { x: 1, y: 2, width: 30, height: 40 } },
	crop: `crops/m${n}.webp`,
	element: null,
});

/** A WebP image an export takes. */
function webpImage() {
	const webp = new Uint8Array(30);
	webp.set(new TextEncoder().encode("RIFF\x00\x00\x00\x00WEBPVP8X"), 0);
	webp[16] = 10;
	webp[24] = 9;
	webp[27] = 9;
	return {
		blob: new Blob([webp], { type: "image/webp" }),
		width: 10,
		height: 10,
	};
}

/** A shop's case: mark 1 on its home page, mark 2 on a search with a query. */
function shopCase(): Case {
	return {
		...sampleCase("c_shop"),
		page: {
			url: HOME,
			title: "Shop",
			lang: "en",
			viewport: { width: 1280, height: 800, dpr: 2 },
			userAgent: "test",
		},
		pages: [
			{ url: HOME, title: "Shop", lang: "en" },
			{ url: SEARCH, title: "Search", lang: "en" },
		],
		shots: [shot("s1", HOME), shot("s2", SEARCH, "q=shoes&sort=price", 390)],
		marks: [mark(1, "s1"), mark(2, "s2")],
	};
}

describe("the same page: exact for the offer, by path for drawing", () => {
	test("exactPage: the origin and pageKey", () => {
		expect(exactPage(SEARCH, `${SEARCH}/?q=boots#top`)).toBe(true);
		expect(exactPage(SEARCH, "http://localhost:3000/search")).toBe(false);
		expect(exactPage(SEARCH, "https://staging.shop.example/search")).toBe(
			false,
		);
		expect(exactPage(HOME, "https://shop.example")).toBe(true);
		expect(exactPage(HOME, "https://other.example/")).toBe(false);
		// What is no web address is no page of a site.
		expect(exactPage("somewhere", "somewhere")).toBe(false);
	});

	test("pathKey: pageKey, but a home page is / on any host", () => {
		expect(pathKey(HOME)).toBe("/");
		expect(pathKey("http://localhost:3000/")).toBe("/");
		expect(pathKey("http://localhost:3000")).toBe("/");
		expect(pathKey(SEARCH)).toBe(pageKey(SEARCH));
		expect(pathKey("https://app.example/#/cart")).toBe("#/cart");
		expect(pathKey("somewhere")).toBe("somewhere");
		expect(samePath(HOME, "http://localhost:3000/?x=1#top")).toBe(true);
		expect(samePath(HOME, "http://localhost:3000/#/cart")).toBe(false);
		expect(samePath(SEARCH, "http://localhost:3000/search/")).toBe(true);
		// The shared rule is untouched: two sites' home pages are two pages.
		expect(samePage(HOME, "http://localhost:3000/")).toBe(false);
		expect(pageKey(HOME)).toBe("https://shop.example/");
	});

	test("Home offers a case only on the same page of the same site as one of its screenshots", () => {
		const c = shopCase();
		expect(isOfferedOn(c, "https://shop.example/search?q=boots")).toBe(true);
		expect(isOfferedOn(c, "https://shop.example/")).toBe(true);
		// Another host: opened by hand, never offered.
		expect(isOfferedOn(c, "http://localhost:3000/search")).toBe(false);
		expect(isOfferedOn(c, "http://localhost:3000/")).toBe(false);
		expect(isOfferedOn(c, "https://staging.shop.example/search")).toBe(false);
		expect(isOfferedOn(c, "https://shop.example/cart")).toBe(false);
		// The case's list naming a page without a screenshot does not offer it.
		expect(
			isOfferedOn(
				{
					...c,
					pages: [
						...(c.pages ?? []),
						{ url: "https://shop.example/cart", title: "", lang: "" },
					],
				},
				"https://shop.example/cart",
			),
		).toBe(false);
		// A case with no screenshot yet: its page.
		const fresh = { ...c, shots: [], marks: [] };
		expect(isOfferedOn(fresh, HOME)).toBe(true);
		expect(isOfferedOn(fresh, "http://localhost:3000/")).toBe(false);
	});

	test("the page in front is the case's page by path, production's home page on localhost's", () => {
		const c = shopCase();
		expect(pageInFront(c, "http://localhost:3000/")?.url).toBe(HOME);
		expect(pageInFront(c, "http://localhost:3000/search?q=x")?.url).toBe(
			SEARCH,
		);
		expect(pageInFront(c, "http://localhost:3000/cart")).toBeUndefined();
		// The list's own question stays the shared rule.
		expect(pageAt(c, "http://localhost:3000/")).toBeUndefined();
		// The window the marks of the page in front were made in.
		expect(viewportAt(c, "http://localhost:3000/search").width).toBe(390);
		expect(viewportAt(c, "http://localhost:3000/").width).toBe(1280);
	});

	test("of two sites' home pages, the one of the same site is the page in front", () => {
		const pay = "https://pay.example/";
		const c: Case = {
			...shopCase(),
			pages: [
				{ url: HOME, title: "Shop", lang: "en" },
				{ url: pay, title: "Pay", lang: "en" },
			],
			shots: [shot("s1", HOME), shot("s2", pay)],
		};
		expect(pageInFront(c, pay)?.url).toBe(pay);
		expect(pageInFront(c, HOME)?.url).toBe(HOME);
		// Elsewhere both are the home page in front; the first one is named.
		expect(pageInFront(c, "http://localhost:3000/")?.url).toBe(HOME);
	});

	test("a draw on localhost's home page judges production's home page marks as the page's own", () => {
		const c = shopCase();
		const found = (n: number): MarkMatch => ({
			markId: `m${n}`,
			number: n,
			status: "lost",
			score: 0,
			current: 0,
			candidates: [],
		});
		const on = findsOn(c, [found(1), found(2)], "http://localhost:3000/");
		expect(on.own.map((m) => m.number)).toEqual([1]);
		expect(on.elsewhere).toBe(1);
		// The query takes no part: a search for boots is the search page.
		const there = findsOn(
			c,
			[found(1), found(2)],
			"http://localhost:3000/search?q=boots",
		);
		expect(there.own.map((m) => m.number)).toEqual([2]);
	});
});

describe("a screenshot keeps its query", () => {
	const draft = (n: number, shotId: string): MarkDraft => ({
		id: `m${n}`,
		number: n,
		shot: shotId,
		comment: `comment ${n}`,
		author: "user",
		shape: { kind: "box", rect: { x: 10, y: 10, width: 100, height: 40 } },
		element: null,
		cropRect: { x: 0, y: 0, width: 140, height: 80 },
	});
	const crop: Crop = async (_blob, rects) =>
		rects.map(() => ({ blob: new Blob(["crop"]), width: 10, height: 10 }));
	const info = (url: string) => ({
		url,
		title: "Search",
		lang: "en",
		viewport: { width: 1280, height: 800, dpr: 2 },
		userAgent: "test",
	});

	async function add(
		store: MemoryStore,
		n: number,
		url: string,
		sent?: string,
	): Promise<Case> {
		const id = `p_${n}`;
		await store.putImage("c_1", pendingImage(id), {
			blob: new Blob([`shot ${id}`]),
			width: 2560,
			height: 1600,
		});
		return saveCase(
			store,
			{
				caseId: "c_1",
				isNew: false,
				title: "",
				page: info(url),
				shots: [
					{
						id,
						image: pendingImage(id),
						scrollX: 0,
						scrollY: 0,
						viewport: { width: 1280, height: 800, dpr: 2 },
						capturedAt: NOW,
						url,
						...(sent === undefined ? {} : { query: sent }),
					},
				],
				marks: [draft(n, id)],
			},
			crop,
			new Date(NOW),
		);
	}

	test("a mark from the toolbar: the plain address as before, and what may be kept of the query beside it", async () => {
		const store = new MemoryStore();
		await putCase(store, newCase("c_1", info(SEARCH), NOW));
		let c = await add(
			store,
			1,
			`${SEARCH}?q=shoes&token=abc&user=jane%40example.com#results`,
		);
		expect(c.shots[0]?.url).toBe(SEARCH);
		expect(c.shots[0]?.query).toBe("q=shoes");
		expect(c.pages?.map((p) => p.url)).toEqual([SEARCH]);
		// Another query is the same page: no second page, its own query.
		c = await add(store, 2, `${SEARCH}?q=boots`);
		expect(c.pages?.map((p) => p.url)).toEqual([SEARCH]);
		expect(c.shots.map((s) => s.query)).toEqual(["q=shoes", "q=boots"]);
		// Nothing kept: no field at all. What a sender says is never taken.
		c = await add(store, 3, `${SEARCH}?session=1`, "q=planted");
		expect(c.shots[2]).not.toHaveProperty("query");
		expect(markAddress(c, c.marks[0] as Mark)).toBe(`${SEARCH}?q=shoes`);
		expect(markAddress(c, c.marks[2] as Mark)).toBe(SEARCH);
	});

	test("a hash route's own parameters are not the query", async () => {
		const store = new MemoryStore();
		const app = "https://app.example/";
		await putCase(store, newCase("c_1", info(app), NOW));
		const c = await add(store, 1, `${app}?tab=2#/search?q=shoes`);
		expect(c.shots[0]?.url).toBe(`${app}#/search`);
		expect(c.shots[0]?.query).toBe("tab=2");
		expect(shotAddress(c, c.shots[0] as Shot)).toBe(`${app}?tab=2#/search`);
	});

	test("a file's query is read filtered again; a wrong one is left out, never a failed file", () => {
		const c = shopCase();
		const read = (query: unknown) =>
			validateCase({
				...c,
				shots: [{ ...shot("s1", HOME), query }, shot("s2", SEARCH)],
			}).shots[0];
		expect(read("q=1&token=2")?.query).toBe("q=1");
		expect(read("token=2")).not.toHaveProperty("query");
		expect(read(`q=${"x".repeat(1100)}`)).not.toHaveProperty("query");
		for (const odd of [42, null, { q: 1 }, ["q=1"], true])
			expect(read(odd)).not.toHaveProperty("query");
	});

	test("the export writes it, and an import keeps it", async () => {
		const store = new MemoryStore();
		const c = shopCase();
		await putCase(store, c);
		for (const path of [
			...c.shots.map((s) => s.image),
			...c.marks.map((a) => a.crop),
		])
			await store.putImage(c.id, path, webpImage());
		const zip = await exportCase(store, c);
		const parsed = await readExport(zip);
		expect(parsed.case.shots.map((s) => s.query)).toEqual([
			undefined,
			"q=shoes&sort=price",
		]);
		const imported = await storeImport(new MemoryStore(), parsed);
		expect(imported.shots.map((s) => [s.url, s.query])).toEqual([
			[HOME, undefined],
			[SEARCH, "q=shoes&sort=price"],
		]);
	});

	test("an import of a file whose addresses still have a query: plain addresses, the query kept as the rule keeps it", async () => {
		const store = new MemoryStore();
		const c: Case = {
			...shopCase(),
			shots: [shot("s1", HOME), shot("s2", `${SEARCH}?q=shoes&access_token=x`)],
		};
		await putCase(store, c);
		for (const path of [
			...c.shots.map((s) => s.image),
			...c.marks.map((a) => a.crop),
		])
			await store.putImage(c.id, path, webpImage());
		const imported = await storeImport(
			new MemoryStore(),
			await readExport(await exportCase(store, c)),
		);
		expect(imported.shots[1]?.url).toBe(SEARCH);
		expect(imported.shots[1]?.query).toBe("q=shoes");
	});

	test("case.md says where a mark was made, with its query", () => {
		const md = caseMarkdown(shopCase());
		expect(md).toContain(`- Page: <${SEARCH}?q=shoes&sort=price>`);
		expect(md).toContain(
			`Screenshot s2 is of <${SEARCH}?q=shoes&sort=price>, in a window of 390×800 CSS pixels.`,
		);
		// A case of one page without a query gives the same file as before.
		const one: Case = {
			...shopCase(),
			pages: [{ url: HOME, title: "Shop", lang: "en" }],
			shots: [shot("s1", HOME)],
			marks: [mark(1, "s1")],
		};
		// The case's page in the first lines, and no mark's.
		expect(caseMarkdown(one).match(/- Page: </g)).toHaveLength(1);
		// One page, with a query: the mark says where exactly.
		const queried: Case = {
			...one,
			shots: [shot("s1", HOME, "lang=de")],
		};
		expect(caseMarkdown(queried)).toContain(`- Page: <${HOME}?lang=de>`);
	});
});

describe("a mark's link", () => {
	test("where it was made, and the same path and query on the host in front", () => {
		const c = shopCase();
		const [home, search] = c.marks as [Mark, Mark];
		expect(markTargets(c, search, "https://shop.example/cart")).toEqual({
			made: `${SEARCH}?q=shoes&sort=price`,
		});
		expect(
			markTargets(c, search, "http://localhost:3000/anything?x=1"),
		).toEqual({
			made: `${SEARCH}?q=shoes&sort=price`,
			here: "http://localhost:3000/search?q=shoes&sort=price",
			host: "localhost:3000",
		});
		expect(markTargets(c, home, "http://localhost:3000/")?.here).toBe(
			"http://localhost:3000/",
		);
		// No web page in front (a new tab, chrome://): only where it was made.
		expect(markTargets(c, home, "chrome://newtab/")).toEqual({ made: HOME });
		expect(markTargets(c, home, undefined)).toEqual({ made: HOME });
		// A hash route goes with it.
		const app: Case = {
			...c,
			shots: [
				shot("s1", "https://app.example/#/list", "tab=2"),
				shot("s2", SEARCH),
			],
		};
		expect(markTargets(app, home, "http://localhost:5173/")?.here).toBe(
			"http://localhost:5173/?tab=2#/list",
		);
		// A file's address that is no web page has no link.
		const odd: Case = {
			...c,
			shots: [shot("s1", "file:///tmp/x.html"), shot("s2", SEARCH)],
		};
		expect(markTargets(odd, home, "http://localhost:3000/")).toBeUndefined();
	});

	test("its address as the panel shows it keeps the query", () => {
		expect(shortAddress(`${SEARCH}?q=shoes`)).toBe(
			"shop.example/search?q=shoes",
		);
		expect(shortAddress(HOME)).toBe("shop.example");
		expect(shortAddress(`${HOME}?lang=de`)).toBe("shop.example/?lang=de");
		expect(shortAddress("https://app.example/?tab=2#/list")).toBe(
			"app.example/?tab=2#/list",
		);
	});
});

describe("the server's member download (its vectors/case-file.json, case-md.json)", () => {
	// test/case-file.json and test/case-md.json are sitegloss.dev's packages/api/vectors/ files.
	const lines = (c: Case, pick: (line: string) => boolean) =>
		caseMarkdown(validateCase(c)).split("\n").filter(pick);
	const pageLine = (l: string) =>
		l.startsWith("- Page:") || l.startsWith("Screenshot ");

	test("validateCase keeps the server's case.json as it is, the query too", () => {
		// Since its DEC-053 the server's marks have no findings; a file's findings becoming comments
		// is findings-to-comments.test.ts.
		expect(validateCase(caseFile.caseJson)).toEqual(caseFile.caseJson as never);
		expect(validateCase(caseFile.singlePageCaseJson)).toEqual(
			caseFile.singlePageCaseJson as never,
		);
	});

	test("case.md is the server's, byte for byte, a highlight included (its vectors/case-md.json)", () => {
		expect(caseMarkdown(validateCase(caseMd.caseJson))).toBe(caseMd.caseMd);
	});

	test("case.md names an address with its query, and a mark's added images, as the server's does", () => {
		expect(
			lines(caseFile.caseJson as never, (l) => pageLine(l) && l.includes("?")),
		).toEqual(caseFile.caseMdQueryLines);
		expect(
			lines(caseFile.caseJson as never, (l) => l.startsWith("- Look:")),
		).toEqual(caseFile.caseMdLookLines);
		expect(lines(caseFile.singlePageCaseJson as never, pageLine)).toEqual(
			caseFile.singlePageCaseMdPageLines,
		);
		// The images added to a mark (DEC-058).
		expect(
			lines(
				caseFile.caseJson as never,
				(l) =>
					l.startsWith("- Images added:") ||
					l.startsWith("![Mark 3, added image"),
			),
		).toEqual(caseFile.caseMdImageLines);
	});
});

describe("two sites' home pages in one case (DEC-050)", () => {
	const PAY = "https://pay.example/";
	const lost = (n: number): MarkMatch => ({
		markId: `m${n}`,
		number: n,
		status: "lost",
		score: 0,
		current: 0,
		candidates: [],
	});
	const twoHomes = (): Case => ({
		...shopCase(),
		pages: [
			{ url: HOME, title: "Shop", lang: "en" },
			{ url: PAY, title: "Pay", lang: "en" },
		],
		shots: [shot("s1", HOME), shot("s2", PAY)],
		marks: [mark(1, "s1"), mark(2, "s2")],
	});

	test("a mark is the page's own only when its page is the one pageInFront picks: on each site its own, on a third host the first", () => {
		const c = twoHomes();
		const [shop, pay] = c.marks as [Mark, Mark];
		for (const [url, own] of [
			[HOME, [1]],
			[PAY, [2]],
			["http://localhost:3000/", [1]],
		] as const) {
			const found = findsOn(c, [lost(1), lost(2)], url);
			expect(found.own.map((m) => m.number)).toEqual([...own]);
			expect(found.elsewhere).toBe(1);
			expect(onPageInFront(c, shop, url)).toBe(own[0] === 1);
			expect(onPageInFront(c, pay, url)).toBe(own[0] === 2);
		}
	});

	test("the AI tools' onThisPage says the same", () => {
		const c = twoHomes();
		const [shop, pay] = c.marks as [Mark, Mark];
		expect(pageView(c, shop, PAY).onThisPage).toBe(false);
		expect(pageView(c, pay, PAY).onThisPage).toBe(true);
		expect(pageView(c, shop, HOME).onThisPage).toBe(true);
		expect(pageView(c, pay, HOME).onThisPage).toBe(false);
		expect(pageView(c, shop, "http://localhost:3000/").onThisPage).toBe(true);
		expect(pageView(c, pay, "http://localhost:3000/").onThisPage).toBe(false);
	});
});

describe("a mark's link waits for its page (DEC-050)", () => {
	const p: PendingShow = {
		tabId: 4,
		caseId: "c_shop",
		markId: "m2",
		mark: "key",
		url: `${SEARCH}?q=shoes`,
		until: 1000,
	};
	const match = (status: MarkMatch["status"]): MarkMatch => ({
		markId: "m2",
		number: 2,
		status,
		score: 0.9,
		current: 0,
		candidates: [],
	});
	const drawn = (status: MarkMatch["status"], settling = false) => ({
		tabId: 4,
		caseId: "c_shop",
		url: `${SEARCH}?q=shoes`,
		matches: new Map([["m2", match(status)]]),
		settling,
	});

	test("a page busy with a mark, or one that does not answer, keeps the wait; the next draw shows it", async () => {
		const asked: string[] = [];
		const busy = await tryShow(p, drawn("found"), 10, async () => {
			asked.push("busy");
			return { error: "Sitegloss is saving on this page; try again." };
		});
		expect(busy).toEqual({ keep: true });
		const silent = await tryShow(p, drawn("found"), 20, async () => {
			asked.push("silent");
			throw new Error("Could not establish connection");
		});
		expect(silent).toEqual({ keep: true });
		const gone = await tryShow(p, drawn("found"), 30, async () => {
			asked.push("not held");
			return null;
		});
		expect(gone).toEqual({ keep: true });
		const shown = await tryShow(p, drawn("found"), 40, async () =>
			match("found"),
		);
		expect(shown).toEqual({ keep: false, shown: match("found") });
		expect(asked).toEqual(["busy", "silent", "not held"]);
	});

	test("it waits for its tab, page and mark; gives up after its time", async () => {
		const never = async () => {
			throw new Error("not asked");
		};
		expect(await tryShow(p, undefined, 10, never)).toEqual({ keep: true });
		expect(
			await tryShow(p, { ...drawn("found"), tabId: 9 }, 10, never),
		).toEqual({ keep: true });
		expect(
			await tryShow(p, { ...drawn("found"), url: CART_ELSEWHERE }, 10, never),
		).toEqual({ keep: true });
		// Not found yet while the draw looks again.
		expect(await tryShow(p, drawn("lost", true), 10, never)).toEqual({
			keep: true,
		});
		expect(await tryShow(p, drawn("found"), 1001, never)).toEqual({
			keep: false,
		});
		expect(await tryShow(undefined, drawn("found"), 10, never)).toEqual({
			keep: false,
		});
	});

	test("at the very address the page is never loaded again: shown where the page holds the case, drawn where not", () => {
		const url = `${SEARCH}?q=shoes`;
		// An AI app's load_case drew the case: the panel's own draw knows nothing.
		expect(linkStep(url, url, "c_shop", "c_shop")).toBe("show");
		expect(linkStep(url, url, "c_shop", undefined)).toBe("draw");
		expect(linkStep(url, url, "c_shop", "c_other")).toBe("draw");
		expect(linkStep(`${SEARCH}?q=boots`, url, "c_shop", "c_shop")).toBe(
			"navigate",
		);
		expect(linkStep(undefined, url, "c_shop", undefined)).toBe("navigate");
	});
});

describe("open_case and what the panel knew of a draw (DEC-050)", () => {
	test("only a draw of that case on that tab stays; the same case on another tab is dropped", () => {
		expect(keepsLoaded({ caseId: "c_a", tabId: 2 }, "c_a", 2)).toBe(true);
		expect(keepsLoaded({ caseId: "c_a", tabId: 1 }, "c_a", 2)).toBe(false);
		expect(keepsLoaded({ caseId: "c_b", tabId: 2 }, "c_a", 2)).toBe(false);
		expect(keepsLoaded(undefined, "c_a", 2)).toBe(false);
	});
});

describe("a mark's Show while the marks are not drawn", () => {
	const c = withOneMark(sampleCase("c_show"));
	const a = c.marks[0] as Mark;
	const page = markAddress(c, a);

	test("starts only on the mark's own page, in a web tab, of the case shown", () => {
		expect(mayLoadAndShow(c, a, page, true)).toBe(true);
		// The tab went to a page that is not the mark's, to a browser page, or away.
		expect(mayLoadAndShow(c, a, "https://other.example.org/x", true)).toBe(
			false,
		);
		expect(mayLoadAndShow(c, a, "chrome://extensions", true)).toBe(false);
		expect(mayLoadAndShow(c, a, undefined, true)).toBe(false);
		// The case was closed meanwhile.
		expect(mayLoadAndShow(c, a, page, false)).toBe(false);
	});

	test("Verify is offered only where the tab in front shows the mark's page (DEC-079)", () => {
		// The mark's page on its own host, or on another (localhost): yes.
		expect(verifiesHere(c, a, page)).toBe(true);
		expect(
			verifiesHere(
				c,
				a,
				page.replace("https://www.example.com", "http://localhost:3000"),
			),
		).toBe(true);
		// Another page, a browser page, a tab whose address is hidden, none.
		expect(verifiesHere(c, a, "https://www.example.com/other")).toBe(false);
		expect(verifiesHere(c, a, "chrome://newtab/")).toBe(false);
		expect(verifiesHere(c, a, "")).toBe(false);
		expect(verifiesHere(c, a, undefined)).toBe(false);
		// A mark of no web page has no page to open: it keeps Verify.
		const file: Case = { ...c, page: { ...c.page, url: "file:///tmp/a.html" } };
		expect(verifiesHere(file, a, undefined)).toBe(true);
	});

	test("a draw that drew nothing leaves nothing pending; a newer wait stays", () => {
		const mine: PendingShow = {
			tabId: 1,
			caseId: c.id,
			markId: a.id,
			mark: "k",
			url: page,
			until: 10,
			fromShow: true,
		};
		const newer = { ...mine, markId: "other" };
		expect(pendingAfterDraw(mine, mine, false)).toBeUndefined();
		expect(pendingAfterDraw(mine, mine, true) === mine).toBe(true);
		expect(pendingAfterDraw(mine, newer, false) === newer).toBe(true);
	});
});
