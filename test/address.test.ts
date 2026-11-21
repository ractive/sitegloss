/**
 * Where a mark was made (DEC-050): the offer on Home held to the same page of
 * the same site, a case opened by hand drawn by path whatever the host (a
 * home page too), and the screenshot's query kept beside its plain address,
 * from the toolbar's save to the file and back.
 */

import { describe, expect, test } from "bun:test";
import {
	type Annotation,
	type Case,
	exactPage,
	isOfferedOn,
	markAddress,
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
import type { AnnotationMatch } from "../src/lib/messages.ts";
import { type AnnotationDraft, type Crop, saveCase } from "../src/lib/save.ts";
import { MemoryStore } from "../src/lib/store.ts";
import { findsOn } from "../src/sidepanel/follow.ts";
import { newCase } from "../src/sidepanel/fresh.ts";
import { markTargets, shortAddress } from "../src/sidepanel/mark-link.ts";
import { validateCase as validateCase030 } from "./case-0-3-0.ts";
import caseFile from "./case-file.json" with { type: "json" };
import { putCase, sampleCase } from "./fixtures.ts";

const HOME = "https://shop.example/";
const SEARCH = "https://shop.example/search";
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

const mark = (n: number, shotId: string): Annotation => ({
	id: `a${n}`,
	number: n,
	shot: shotId,
	comment: `comment ${n}`,
	author: "user",
	shape: { kind: "box", rect: { x: 1, y: 2, width: 30, height: 40 } },
	crop: `crops/a${n}.webp`,
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
		annotations: [mark(1, "s1"), mark(2, "s2")],
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
		const fresh = { ...c, shots: [], annotations: [] };
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
		const found = (n: number): AnnotationMatch => ({
			annotationId: `a${n}`,
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
	const draft = (n: number, shotId: string): AnnotationDraft => ({
		id: `a${n}`,
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
				annotations: [draft(n, id)],
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
		expect(markAddress(c, c.annotations[0] as Annotation)).toBe(
			`${SEARCH}?q=shoes`,
		);
		expect(markAddress(c, c.annotations[2] as Annotation)).toBe(SEARCH);
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

	test("the export writes it, an import keeps it, and a build before this one reads the file without it", async () => {
		const store = new MemoryStore();
		const c = shopCase();
		await putCase(store, c);
		for (const path of [
			...c.shots.map((s) => s.image),
			...c.annotations.map((a) => a.crop),
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
		// 0.3.0's own validateCase: the field is left out, the rest is whole.
		const json = JSON.parse(JSON.stringify(c));
		const old = validateCase030(json);
		expect(old.shots.map((s) => s.url)).toEqual([HOME, SEARCH]);
		expect(old.shots[1]).not.toHaveProperty("query");
		expect(old.annotations).toHaveLength(2);
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
			...c.annotations.map((a) => a.crop),
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
			annotations: [mark(1, "s1")],
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
		const [home, search] = c.annotations as [Annotation, Annotation];
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

describe("the server's member download (its vectors/case-file.json)", () => {
	// test/case-file.json is sitegloss.dev's packages/api/vectors/case-file.json.
	const lines = (c: Case, pick: (line: string) => boolean) =>
		caseMarkdown(validateCase(c)).split("\n").filter(pick);
	const pageLine = (l: string) =>
		l.startsWith("- Page:") || l.startsWith("Screenshot ");

	test("validateCase keeps the server's case.json as it is, the query too", () => {
		expect(validateCase(caseFile.caseJson)).toEqual(caseFile.caseJson as never);
		expect(validateCase(caseFile.singlePageCaseJson)).toEqual(
			caseFile.singlePageCaseJson as never,
		);
	});

	test("case.md names an address with its query as the server's does, in a case of one page too", () => {
		expect(
			lines(caseFile.caseJson as never, (l) => pageLine(l) && l.includes("?")),
		).toEqual(caseFile.caseMdQueryLines);
		expect(
			lines(caseFile.caseJson as never, (l) => l.startsWith("- Look:")),
		).toEqual(caseFile.caseMdLookLines);
		expect(lines(caseFile.singlePageCaseJson as never, pageLine)).toEqual(
			caseFile.singlePageCaseMdPageLines,
		);
	});
});
