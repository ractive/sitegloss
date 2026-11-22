/**
 * A case spans several pages (DEC-038): the list of its pages in the format,
 * a mark on another page adding that page, and what is judged per page (which
 * case is "this page's", what a draw found, the window a mark was made in).
 */

import { describe, expect, test } from "bun:test";
import {
	type Case,
	casePages,
	MAX_PAGES,
	type Mark,
	marksByPage,
	marksOnPage,
	markUrl,
	pageAt,
	pageInFront,
	pageKey,
	pendingImage,
	type Shot,
	samePage,
	validateCase,
	viewportAt,
	withoutMark,
	withPagesAgreed,
	withPagesOfShots,
} from "../src/lib/case.ts";
import { exportCase, readExport, storeImport } from "../src/lib/export.ts";
import { caseMarkdown } from "../src/lib/markdown.ts";
import type { MarkMatch } from "../src/lib/messages.ts";
import {
	type Crop,
	type MarkDraft,
	saveCase,
	undoAdd,
} from "../src/lib/save.ts";
import { MemoryStore } from "../src/lib/store.ts";
import { shortUrl } from "../src/sidepanel/dom.ts";
import {
	findsOn,
	foundLine,
	isUnsure,
	matchesHere,
	movedOn,
	noneHere,
} from "../src/sidepanel/follow.ts";
import { newCase } from "../src/sidepanel/fresh.ts";
import { putCase, sampleCase } from "./fixtures.ts";
import vectors from "./page-key.json" with { type: "json" };

const CART = "https://shop.example/cart";
const PAY = "https://shop.example/checkout/pay";
const NOW = "2026-11-19T10:00:00.000Z";

const shot = (id: string, url?: string, width = 1280): Shot => ({
	id,
	image: `shots/${id}.webp`,
	scrollX: 0,
	scrollY: 0,
	viewport: { width, height: 800, dpr: 2 },
	capturedAt: "2026-11-19T09:00:00.000Z",
	...(url === undefined ? {} : { url }),
});

const mark = (n: number, shotId: string, element = false): Mark => ({
	id: `m${n}`,
	number: n,
	shot: shotId,
	comment: `comment ${n}`,
	author: "user",
	shape: { kind: "box", rect: { x: 1, y: 2, width: 30, height: 40 } },
	crop: `crops/m${n}.webp`,
	element: element
		? {
				tag: "button",
				classes: [],
				attributes: {},
				ancestors: [],
				rect: { x: 1, y: 2, width: 30, height: 40 },
				page: { width: 1280, height: 2000 },
				selector: "button",
			}
		: null,
});

/** A flow through a shop: two marks on the cart, one on the payment page. */
function flow(): Case {
	return {
		...sampleCase("c_flow"),
		page: {
			url: CART,
			title: "Your cart",
			lang: "en",
			viewport: { width: 1280, height: 800, dpr: 2 },
			userAgent: "test",
		},
		pages: [
			{ url: CART, title: "Your cart", lang: "en" },
			{ url: PAY, title: "Payment", lang: "en" },
		],
		shots: [shot("s1", CART), shot("s2", PAY, 390)],
		marks: [mark(1, "s1", true), mark(2, "s1"), mark(3, "s2", true)],
	};
}

describe("the pages of a case", () => {
	test("a case stored before the list reads as before: its page, and the pages of its screenshots", () => {
		const old: Case = {
			...sampleCase("c_old"),
			shots: [
				shot("s1"),
				shot("s2", "https://www.example.com/kk/step-2"),
				shot("s3", "https://www.example.com/kk/step-2"),
			],
			marks: [mark(1, "s1"), mark(2, "s2"), mark(3, "s3")],
		};
		expect(old.pages).toBeUndefined();
		expect(casePages(old)).toEqual([
			{ url: "https://www.example.com/kk", title: "KK", lang: "de" },
			{ url: "https://www.example.com/kk/step-2", title: "", lang: "" },
		]);
		// A screenshot without an address is the first page's.
		expect(markUrl(old, old.marks[0] as Mark)).toBe(
			"https://www.example.com/kk",
		);
		expect(marksOnPage(old, "https://www.example.com/kk/step-2")).toBe(2);
		// Nothing is written for it: validating it adds no list.
		expect(validateCase(old).pages).toBeUndefined();
	});

	test("the stored list is the list, each page once; a page only a screenshot names comes after", () => {
		const c = flow();
		expect(casePages(c).map((p) => p.url)).toEqual([CART, PAY]);
		const more: Case = {
			...c,
			pages: [...(c.pages ?? []), { url: `${CART}/`, title: "", lang: "" }],
			shots: [...c.shots, shot("s3", "https://shop.example/done")],
		};
		expect(casePages(more).map((p) => p.url)).toEqual([
			CART,
			PAY,
			"https://shop.example/done",
		]);
	});

	test("which page an address is: the server's rule, held to the server's own vectors", () => {
		// test/page-key.json is sitegloss.dev's packages/api/vectors/page-key.json.
		expect(vectors.vectors.length).toBeGreaterThan(25);
		for (const { url, key } of vectors.vectors) expect(pageKey(url)).toBe(key);
	});

	test("the same page: the same path, in whatever environment; two sites' home pages are two", () => {
		expect(samePage(CART, `${CART}/`)).toBe(true);
		expect(samePage(CART, "https://shop.example/cart#top")).toBe(true);
		// A mark added on localhost to a case from production: the same page.
		expect(samePage(CART, "http://localhost:3000/cart")).toBe(true);
		expect(samePage(CART, PAY)).toBe(false);
		expect(samePage("https://shop.example/", "https://pay.example/")).toBe(
			false,
		);
		expect(samePage("https://shop.example/", "https://shop.example")).toBe(
			true,
		);
		// A hash route at the root is a page of its own, in any environment,
		// and a slash at its end says nothing.
		expect(
			samePage(
				"https://app.example.com/#/cart",
				"http://localhost:5173/#/cart/",
			),
		).toBe(true);
		expect(
			samePage("https://app.example.com/#/cart", "https://app.example.com/"),
		).toBe(false);
		expect(
			samePage("https://x.example/demo/", "https://x.example/demo/#/"),
		).toBe(true);
		// Symmetric, also for an odd path.
		for (const [a, b] of [
			["https://a.example//", "https://b.example/"],
			["https://a.example/#/", "https://b.example/"],
			[CART, "http://localhost:3000/cart/"],
		] as const)
			expect(samePage(a, b)).toBe(samePage(b, a));
		// What is no address at all (a file's) is itself only.
		expect(samePage("somewhere", "somewhere")).toBe(true);
		expect(samePage("somewhere", "elsewhere")).toBe(false);
	});

	test("the list's questions keep the shared rule; the page in front is by path, a home page on any host (DEC-050)", () => {
		// A home page and a hash route at the root, made on production.
		const home = "https://app.example.com/";
		const route = "https://app.example.com/#/cart";
		const c: Case = {
			...flow(),
			page: { ...flow().page, url: home },
			pages: [
				{ url: home, title: "Home", lang: "en" },
				{ url: route, title: "Cart", lang: "en" },
			],
			shots: [shot("s1", home), shot("s2", route, 390)],
		};
		// The list: the route on localhost is that page; localhost's home
		// page is not production's (the origin is all a home page has).
		// Drawn: production's home page is the home page on localhost too.
		for (const [url, page, front] of [
			["http://localhost:5173/#/cart", route, route],
			["http://localhost:5173/#/cart/?step=2", route, route],
			[home, home, home],
			["http://localhost:5173/", undefined, home],
			["http://localhost:5173/#/pay", undefined, undefined],
		] as const) {
			expect(pageAt(c, url)?.url).toBe(page as string);
			expect(pageInFront(c, url)?.url).toBe(front as string);
			expect(marksOnPage(c, url)).toBe(
				page === route ? 1 : page === home ? 2 : 0,
			);
			expect(viewportAt(c, url).width).toBe(front === route ? 390 : 1280);
		}
		expect([...marksByPage(c)]).toEqual([
			[pageKey(home), 2],
			[pageKey(route), 1],
		]);
	});

	test("a page's short name keeps the hash route, which is what tells such pages apart", () => {
		expect(shortUrl("https://x.example/demo/#/book")).toBe(
			"x.example/demo/#/book",
		);
		expect(shortUrl("https://x.example/demo/#/pay?step=2")).toBe(
			"x.example/demo/#/pay",
		);
		expect(shortUrl("https://app.example.com/#/cart")).toBe(
			"app.example.com/#/cart",
		);
		expect(shortUrl("https://www.example.com/kk#top")).toBe(
			"www.example.com/kk",
		);
		expect(shortUrl("https://www.example.com/")).toBe("www.example.com");
	});

	test("a case is this page's for any of its pages, in whatever environment", () => {
		const c = flow();
		expect(pageAt(c, "http://localhost:3000/checkout/pay?step=2")?.url).toBe(
			PAY,
		);
		expect(pageAt(c, "http://localhost:3000/cart")?.url).toBe(CART);
		expect(pageAt(c, "http://localhost:3000/account")).toBeUndefined();
		expect(pageInFront(c, "http://localhost:3000/checkout/pay")?.url).toBe(PAY);
		expect(pageInFront(c, "http://localhost:3000/account")).toBeUndefined();
	});

	test("the window a mark was made in is that of its page's screenshot", () => {
		const c = flow();
		expect(viewportAt(c, "http://localhost:3000/cart").width).toBe(1280);
		expect(viewportAt(c, "http://localhost:3000/checkout/pay").width).toBe(390);
		// A page that is none of the case's, or no page: the first page's.
		expect(viewportAt(c, "http://localhost:3000/account").width).toBe(1280);
		expect(viewportAt(c, undefined).width).toBe(1280);
	});

	test("the format takes the list, and a list without languages; it refuses what is none", () => {
		const c = flow();
		expect(validateCase(c).pages).toEqual(c.pages as never);
		const noLang = { ...c, pages: [{ url: CART, title: "Your cart" }] };
		expect(validateCase(noLang).pages).toEqual([
			{ url: CART, title: "Your cart", lang: "" },
		]);
		expect(() => validateCase({ ...c, pages: "all" })).toThrow(
			"case.pages: must be an array",
		);
		expect(() =>
			validateCase({ ...c, pages: [{ url: 1, title: "" }] }),
		).toThrow("case.pages[0].url: must be a string");
		expect(() =>
			validateCase({
				...c,
				pages: Array.from({ length: MAX_PAGES + 1 }, (_, i) => ({
					url: `${CART}/${i}`,
					title: "",
				})),
			}),
		).toThrow(`more than ${MAX_PAGES} items`);
	});

	test("a case without the list, as 0.3.0 kept it, gets its pages from the screenshots: the first with its title, the others without", () => {
		const { pages: _pages, ...before } = JSON.parse(JSON.stringify(flow()));
		expect(casePages(validateCase(before))).toEqual([
			{ url: CART, title: "Your cart", lang: "en" },
			{ url: PAY, title: "", lang: "" },
		]);
	});

	test("deleting a page's last mark takes the page off the list; the first page follows the first one left", () => {
		const c = flow();
		const { value } = withoutMark(c, "m3", NOW);
		expect(casePages(value).map((p) => p.url)).toEqual([CART]);
		expect(value.page.url).toBe(CART);
		// The cart's marks go: the payment page is the case's first page now.
		let rest = withoutMark(c, "m1", NOW).value;
		expect(casePages(rest).map((p) => p.url)).toEqual([CART, PAY]);
		rest = withoutMark(rest, "m2", NOW).value;
		expect(rest.pages).toEqual([{ url: PAY, title: "Payment", lang: "en" }]);
		// The first page is the payment page now, window and all: it was made
		// at 390, not at the 1280 of the cart that left.
		expect(rest.page).toEqual({
			...c.page,
			url: PAY,
			title: "Payment",
			lang: "en",
			viewport: { width: 390, height: 800, dpr: 2 },
		});
		expect(() => validateCase(rest)).not.toThrow();
		// The last mark of all: the case stays its page's.
		const none = withoutMark(rest, "m3", NOW).value;
		expect(none.pages).toEqual([{ url: PAY, title: "Payment", lang: "en" }]);
		expect(none.page.url).toBe(PAY);
	});

	test("a case from before the list stays without one when a mark goes", () => {
		const old: Case = {
			...sampleCase("c_old"),
			shots: [shot("s1"), shot("s2", "https://www.example.com/other")],
			marks: [mark(1, "s1"), mark(2, "s2")],
		};
		const { value } = withoutMark(old, "m2", NOW);
		expect(value.pages).toBeUndefined();
		expect(withPagesOfShots(old)).toBe(old);
		expect(casePages(value).map((p) => p.url)).toEqual([
			"https://www.example.com/kk",
		]);
	});
});

// --- saving marks ----------------------------------------------------------------

const crop: Crop = async (_image, rects) =>
	rects.map(() => ({ blob: new Blob(["crop"]), width: 280, height: 160 }));

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

const pageInfo = (url: string, title: string) => ({
	url,
	title,
	lang: "en",
	viewport: { width: 1280, height: 800, dpr: 2 },
	userAgent: "test",
});

/** Add mark `n` to `caseId` from the page at `url`, as the toolbar does. */
async function add(
	store: MemoryStore,
	caseId: string,
	n: number,
	url: string,
	title: string,
	at = "2026-11-19T10:00:00.000Z",
): Promise<Case> {
	const id = `p_${n}`;
	await store.putImage(caseId, pendingImage(id), {
		blob: new Blob([`shot ${id}`]),
		width: 2560,
		height: 1600,
	});
	return saveCase(
		store,
		{
			caseId,
			isNew: false,
			title: "",
			page: pageInfo(url, title),
			shots: [
				{
					id,
					image: pendingImage(id),
					scrollX: 0,
					scrollY: 0,
					viewport: { width: 1280, height: 800, dpr: 2 },
					capturedAt: at,
					url,
				},
			],
			marks: [draft(n, id)],
		},
		crop,
		new Date(at),
	);
}

describe("marks on another page go into the open case", () => {
	test("the first mark's page is the case's; a mark on another page adds that page", async () => {
		const store = new MemoryStore();
		// Started on the product page, first marked on the cart.
		await putCase(
			store,
			newCase(
				"c_1",
				pageInfo("https://shop.example/product/7?ref=x", "A bike"),
				NOW,
			),
		);
		expect((await store.getCase("c_1"))?.pages).toEqual([
			{ url: "https://shop.example/product/7", title: "A bike", lang: "en" },
		]);
		let c = await add(store, "c_1", 1, `${CART}?session=1#top`, "Your cart");
		expect(c.page.url).toBe(CART);
		expect(c.pages).toEqual([{ url: CART, title: "Your cart", lang: "en" }]);
		expect(c.shots.map((s) => s.url)).toEqual([CART]);
		// The next page of the flow: the same case, one more page.
		c = await add(store, "c_1", 2, `${PAY}?token=secret`, "Payment");
		expect(c.page.url).toBe(CART);
		expect(c.pages).toEqual([
			{ url: CART, title: "Your cart", lang: "en" },
			{ url: PAY, title: "Payment", lang: "en" },
		]);
		expect(c.shots.map((s) => s.url)).toEqual([CART, PAY]);
		// Back on the cart: no page twice.
		c = await add(store, "c_1", 3, `${CART}/`, "Your cart");
		expect(c.pages?.map((p) => p.url)).toEqual([CART, PAY]);
		expect(marksOnPage(c, CART)).toBe(2);
		expect(marksOnPage(c, PAY)).toBe(1);
	});

	test("a page of another site is a page of the case like any other (DEC-038)", async () => {
		const store = new MemoryStore();
		await putCase(store, newCase("c_1", pageInfo(CART, "Your cart"), NOW));
		await add(store, "c_1", 1, CART, "Your cart");
		const c = await add(
			store,
			"c_1",
			2,
			"https://pay.example/session/abc",
			"Pay",
		);
		expect(c.pages?.map((p) => p.url)).toEqual([
			CART,
			"https://pay.example/session/abc",
		]);
	});

	test("a screenshot sent without an address is the sending page's", async () => {
		const store = new MemoryStore();
		await putCase(store, newCase("c_1", pageInfo(CART, "Your cart"), NOW));
		await store.putImage("c_1", pendingImage("p_1"), {
			blob: new Blob(["shot"]),
			width: 10,
			height: 10,
		});
		const c = await saveCase(
			store,
			{
				caseId: "c_1",
				isNew: false,
				title: "",
				page: pageInfo(`${CART}?x=1`, "Your cart"),
				shots: [
					{
						id: "p_1",
						image: pendingImage("p_1"),
						scrollX: 0,
						scrollY: 0,
						viewport: { width: 1280, height: 800, dpr: 2 },
						capturedAt: NOW,
					},
				],
				marks: [draft(1, "p_1")],
			},
			crop,
		);
		expect(c.shots[0]?.url).toBe(CART);
	});

	test("a case from before the list gets it with its next mark", async () => {
		const store = new MemoryStore();
		await putCase(store, {
			...sampleCase("c_old"),
			shots: [shot("s1")],
			marks: [mark(1, "s1")],
		});
		const c = await add(
			store,
			"c_old",
			2,
			"https://www.example.com/kk/step-2",
			"Step 2",
		);
		expect(c.pages).toEqual([
			{ url: "https://www.example.com/kk", title: "KK", lang: "de" },
			{ url: "https://www.example.com/kk/step-2", title: "Step 2", lang: "en" },
		]);
	});

	test("Undo of the only mark of a page takes the page off again", async () => {
		const store = new MemoryStore();
		await putCase(store, newCase("c_1", pageInfo(CART, "Your cart"), NOW));
		await add(store, "c_1", 1, CART, "Your cart");
		const at = new Date().toISOString();
		const c = await add(store, "c_1", 2, PAY, "Payment", at);
		const added = c.marks.find((a) => a.number === 2) as Mark;
		await undoAdd(store, "c_1", "m2", {
			shot: added.shot,
			comment: added.comment,
		});
		expect((await store.getCase("c_1"))?.pages).toEqual([
			{ url: CART, title: "Your cart", lang: "en" },
		]);
	});
});

describe("a case of several pages in a file", () => {
	async function stored(): Promise<{ store: MemoryStore; c: Case }> {
		const store = new MemoryStore();
		const c = flow();
		await putCase(store, c);
		const webp = new Uint8Array(30);
		webp.set(new TextEncoder().encode("RIFF\x00\x00\x00\x00WEBPVP8X"), 0);
		webp[16] = 10;
		webp[24] = 9;
		webp[27] = 9;
		for (const path of [
			...c.shots.map((s) => s.image),
			...c.marks.map((a) => a.crop),
		])
			await store.putImage(c.id, path, {
				blob: new Blob([webp], { type: "image/webp" }),
				width: 10,
				height: 10,
			});
		return { store, c };
	}

	test("an export and its import keep the pages and every screenshot's address", async () => {
		const { store, c } = await stored();
		const parsed = await readExport(await exportCase(store, c));
		expect(parsed.case.pages).toEqual(c.pages as never);
		const other = new MemoryStore();
		const imported = await storeImport(other, parsed);
		expect(imported.pages).toEqual(c.pages as never);
		expect(imported.shots.map((s) => s.url)).toEqual([CART, PAY]);
	});

	test("an import keeps no more of any page's address than a saved case does", async () => {
		const { store, c } = await stored();
		const leaky: Case = {
			...c,
			pages: [
				{ url: `${CART}?session=1`, title: "Your cart", lang: "en" },
				{ url: `${PAY}?token=secret#frag`, title: "Payment", lang: "en" },
			],
			shots: [
				shot("s1", `https://user:pw@shop.example/cart?session=1`),
				shot("s2", `${PAY}?token=secret`, 390),
			],
		};
		await putCase(store, leaky);
		const parsed = await readExport(await exportCase(store, leaky));
		const imported = await storeImport(new MemoryStore(), parsed);
		expect(imported.pages?.map((p) => p.url)).toEqual([CART, PAY]);
		expect(imported.shots.map((s) => s.url)).toEqual([CART, PAY]);
	});

	test("case.md lists the pages, says each mark's page and each screenshot's", () => {
		const md = caseMarkdown(flow());
		expect(md).toContain(
			[
				"- Pages (2):",
				`  - <${CART}>, Your cart (2 marks)`,
				`  - <${PAY}>, Payment (1 mark)`,
			].join("\n"),
		);
		expect(md).not.toContain("- Page title:");
		expect(md.match(new RegExp(`- Page: <${PAY}>`, "g"))).toHaveLength(1);
		expect(md.match(new RegExp(`- Page: <${CART}>`, "g"))).toHaveLength(2);
		expect(md).toContain(
			`Screenshot s2 is of <${PAY}>, in a window of 390×800 CSS pixels.`,
		);
	});

	test("case.md of a case of one page is as it was", () => {
		const one: Case = {
			...flow(),
			pages: [{ url: CART, title: "Your cart", lang: "en" }],
			shots: [shot("s1", CART)],
			marks: [mark(1, "s1")],
		};
		const md = caseMarkdown(one);
		expect(md).toContain(`- Page: <${CART}>\n- Page title: Your cart`);
		expect(md).not.toContain("- Pages");
		expect(md).not.toContain("is of");
		// No page under a mark: the first lines say it.
		expect(md.match(/- Page: /g)).toHaveLength(1);
	});
});

describe("who did something, in a case synced with a team (DEC-039)", () => {
	const app = {
		id: "https://claude.ai/oauth",
		name: "Claude",
		host: "claude.ai",
	};
	const dana = { id: "u_dana", name: "Dana *Developer*" };
	const tess = { id: "u_tess", name: "Tess Tester" };
	const c: Case = {
		...flow(),
		marks: [
			{
				...mark(1, "s1"),
				createdBy: tess,
				resolution: {
					kind: "fixed",
					at: "2026-11-19T10:00:00.000Z",
					app,
					user: dana,
					verified: { at: "2026-11-19T11:00:00.000Z", user: tess },
				},
				reopens: [
					{
						at: "2026-11-19T09:30:00.000Z",
						user: tess,
						note: "Still cut off",
						was: { kind: "fixed", at: "2026-11-19T09:00:00.000Z", user: dana },
					},
				],
				findings: [
					{
						id: "f_1",
						text: "The total wraps",
						app,
						at: "2026-11-19T09:10:00.000Z",
						user: dana,
					},
				],
			},
		],
	};

	test("the format keeps it through a file, and a build before it leaves it out without refusing", () => {
		const read = validateCase(JSON.parse(JSON.stringify(c)));
		expect(read.marks[0]).toEqual(c.marks[0] as Mark);
		expect(() =>
			validateCase({
				...c,
				marks: [{ ...c.marks[0], createdBy: { id: 1 } }],
			}),
		).toThrow("case.marks[0].createdBy.id: must be a string");
	});

	test("case.md says it, as text", () => {
		const md = caseMarkdown(c);
		expect(md).toContain("- Added by: Tess Tester");
		expect(md).toContain(
			"- Fixed: 2026-11-19T10:00:00.000Z, by Dana \\*Developer\\* via Claude (claude.ai)",
		);
		expect(md).toContain(
			"- Verified: 2026-11-19T11:00:00.000Z, by Tess Tester",
		);
		expect(md).toContain(
			"- Reopened 2026-11-19T09:30:00.000Z by Tess Tester, was Fixed:",
		);
		expect(md).toContain("By Dana \\*Developer\\* via Claude (claude.ai), ");
	});
});

describe("what a draw found, judged for the page in front", () => {
	const match = (n: number, status: MarkMatch["status"]): MarkMatch => ({
		markId: `m${n}`,
		number: n,
		status,
		score: status === "found" ? 0.9 : 0,
		current: 0,
		candidates:
			status === "found"
				? [
						{
							score: 0.9,
							summary: "button",
							selector: "button",
							visible: true,
							found: true,
						},
					]
				: [],
	});
	const loaded = (url: string, matches: MarkMatch[]) => ({
		url,
		matches: new Map(matches.map((m) => [m.markId, m])),
	});

	test("on one of the case's pages, the marks of its other pages are not expected", () => {
		const c = flow();
		const all = [match(1, "found"), match(2, "no-element"), match(3, "lost")];
		const here = matchesHere(c, all, "http://localhost:3000/cart");
		expect(here.map((m) => m.number)).toEqual([1, 2]);
		expect(foundLine(c, loaded("http://localhost:3000/cart", all))).toBe(
			"1 of 2 marks found on localhost:3000/cart. Dashed: unsure. 1 more is on other pages of the case.",
		);
	});

	test("a mark of another page found here all the same (a shared header, or a look-alike) is never sure and never counted", () => {
		const c = flow();
		const other: MarkMatch = { ...match(3, "found"), otherPage: true };
		const all = [match(1, "found"), match(2, "no-element"), other];
		const url = "http://localhost:3000/cart";
		expect(matchesHere(c, all, url).map((m) => m.number)).toEqual([1, 2]);
		expect(findsOn(c, all, url)).toMatchObject({ also: 1, elsewhere: 0 });
		expect(isUnsure(other)).toBe(true);
		expect(foundLine(c, loaded(url, all))).toBe(
			"1 of 2 marks found on localhost:3000/cart. Dashed: unsure. 1 of the case's other pages may be here too (dashed).",
		);
		// The page's own mark lost, only the other page's look-alike there:
		// none of this page's marks was found, whatever else is drawn.
		const only = [match(1, "lost"), match(2, "no-element"), other];
		expect(noneHere(c, only, url)).toBe(true);
	});

	test("none found is said of the page's own marks", () => {
		const c = flow();
		// On the payment page its mark is lost: none found there.
		const pay = [match(1, "lost"), match(2, "no-element"), match(3, "lost")];
		expect(noneHere(c, pay, "http://localhost:3000/checkout/pay")).toBe(true);
		// Its mark is found: the cart's lost marks say nothing against the page.
		const found = [match(1, "lost"), match(2, "no-element"), match(3, "found")];
		expect(noneHere(c, found, "http://localhost:3000/checkout/pay")).toBe(
			false,
		);
		expect(
			foundLine(c, loaded("http://localhost:3000/checkout/pay", found)),
		).toBe(
			"1 of 1 marks found on localhost:3000/checkout/pay. 2 more are on other pages of the case.",
		);
	});

	test("on a page that is none of the case's, every mark is looked for and counted, as in a case of one page", () => {
		const c = flow();
		const url = "http://localhost:3000/account";
		const all = [match(1, "lost"), match(2, "no-element"), match(3, "lost")];
		expect(matchesHere(c, all, url)).toHaveLength(3);
		expect(noneHere(c, all, url)).toBe(true);
		// The case loaded on another version of its page: what is found counts.
		const found = [match(1, "found"), match(2, "no-element"), match(3, "lost")];
		expect(noneHere(c, found, url)).toBe(false);
		expect(foundLine(c, loaded(url, found))).toBe(
			"1 of 3 marks found on localhost:3000/account.",
		);
	});

	test("the tab went on to another page with the case drawn on it: what was found is read again", () => {
		const drawn = { caseId: "c_flow", tabId: 7, url: CART };
		const tab = (url: string) => ({ id: 7, url });
		// The next route of a single-page app: another page, the case still there.
		expect(movedOn(drawn, "c_flow", tab(PAY), "c_flow")).toBe(true);
		// The same page (a query, a plain fragment, another environment's slash).
		expect(movedOn(drawn, "c_flow", tab(`${CART}/?step=2#top`), "c_flow")).toBe(
			false,
		);
		// Another tab, another case on the page, nothing drawn, no address yet.
		expect(movedOn(drawn, "c_flow", { id: 8, url: PAY }, "c_flow")).toBe(false);
		expect(movedOn(drawn, "c_flow", tab(PAY), "c_other")).toBe(false);
		expect(movedOn(drawn, "c_flow", tab(PAY), undefined)).toBe(false);
		// What was found was forgotten (Chrome says "loading" for a pushState):
		// the page still shows the case, so it is read again.
		expect(movedOn(undefined, "c_flow", tab(PAY), "c_flow")).toBe(true);
		expect(movedOn(undefined, "c_flow", tab(PAY), undefined)).toBe(false);
		expect(movedOn(drawn, "c_flow", tab(""), "c_flow")).toBe(false);
	});
});

describe("page, the list and the screenshots agree (DEC-038)", () => {
	const HOME = "https://shop.example/home";

	test("a file whose page is not in its list: made to agree on import, so no mark is hidden and none moves", async () => {
		// A foreign or hand-made file: `page` is on no list, and one
		// screenshot names no page (0.3.0 wrote those for an AI app's marks).
		const odd: Case = {
			...flow(),
			page: { ...flow().page, url: HOME, title: "Home" },
			pages: [
				{ url: CART, title: "Your cart", lang: "en" },
				{ url: `${CART}/`, title: "again", lang: "en" },
				{ url: PAY, title: "Payment", lang: "en" },
			],
			shots: [shot("s1"), shot("s2", CART), shot("s3", PAY)],
			marks: [mark(1, "s1"), mark(2, "s2"), mark(3, "s3")],
		};
		expect(() => validateCase(odd)).not.toThrow();
		const agreed = withPagesAgreed(odd);
		expect(agreed.pages).toEqual([
			{ url: HOME, title: "Home", lang: "en" },
			{ url: CART, title: "Your cart", lang: "en" },
			{ url: PAY, title: "Payment", lang: "en" },
		]);
		expect(agreed.shots.map((s) => s.url)).toEqual([HOME, CART, PAY]);
		// Every mark is on a listed page.
		expect(casePages(agreed).map((p) => marksOnPage(agreed, p.url))).toEqual([
			1, 1, 1,
		]);
		// The cart's mark goes: mark 1 stays where it was.
		const rest = withoutMark(agreed, "m2", NOW).value;
		expect(markUrl(rest, rest.marks[0] as Mark)).toBe(HOME);
		expect(rest.page.url).toBe(HOME);

		// `page` listed, but not first: it is the first.
		const second = withPagesAgreed({
			...flow(),
			page: { ...flow().page, url: PAY },
		});
		expect(second.pages?.map((p) => p.url)).toEqual([PAY, CART]);
		expect(second.pages?.[0]?.title).toBe("Payment");
		// A case from before the list stays without one.
		const old = withPagesAgreed({
			...sampleCase("c_old"),
			shots: [shot("s1")],
		});
		expect(old.pages).toBeUndefined();
		expect(old.shots[0]?.url).toBe(old.page.url);

		// Through the import itself.
		const store = new MemoryStore();
		const webp = new Uint8Array(30);
		webp.set(new TextEncoder().encode("RIFF\x00\x00\x00\x00WEBPVP8X"), 0);
		webp[16] = 10;
		webp[24] = 9;
		webp[27] = 9;
		const source = new MemoryStore();
		await putCase(source, odd);
		for (const path of [
			...odd.shots.map((x) => x.image),
			...odd.marks.map((x) => x.crop),
		])
			await source.putImage(odd.id, path, {
				blob: new Blob([webp], { type: "image/webp" }),
				width: 10,
				height: 10,
			});
		const zip = await exportCase(source, odd);
		const imported = await storeImport(store, await readExport(zip));
		expect(imported.pages?.map((p) => p.url)).toEqual([HOME, CART, PAY]);
		expect(imported.shots.every((s) => s.url !== undefined)).toBe(true);
	});

	test("without that, a screenshot that names no page does not move when the first page leaves", () => {
		const c: Case = {
			...flow(),
			shots: [shot("s1"), shot("s2", PAY, 390), shot("s3", CART)],
			marks: [mark(1, "s1"), mark(2, "s2"), mark(3, "s3")],
			pages: [
				{ url: PAY, title: "Payment", lang: "en" },
				{ url: CART, title: "Your cart", lang: "en" },
			],
		};
		// `page` (the cart) is not first in the list; a delete rewrites it.
		const rest = withoutMark(c, "m3", NOW).value;
		expect(rest.page.url).toBe(PAY);
		// Mark 1's screenshot was the cart's and says so now.
		expect(markUrl(rest, rest.marks[0] as Mark)).toBe(CART);
	});

	test("a hash route at the root and the home page, made on production and marked on localhost: one page each", async () => {
		for (const [made, local] of [
			["https://app.example.com/#/cart", "http://localhost:5173/#/cart"],
			["https://x.example/demo/#/book", "http://localhost:5173/demo/#/book/"],
			[CART, "http://localhost:3000/cart/"],
		] as const) {
			const store = new MemoryStore();
			await putCase(store, newCase("c_1", pageInfo(made, "Made here"), NOW));
			await add(store, "c_1", 1, made, "Made here");
			const c = await add(store, "c_1", 2, local, "Local");
			expect(c.pages).toEqual([{ url: made, title: "Made here", lang: "en" }]);
			expect(marksOnPage(c, local)).toBe(2);
			expect(pageAt(c, local)?.url).toBe(made);
		}
		// Two sites' home pages are two pages, and each tab finds its own.
		const store = new MemoryStore();
		await putCase(
			store,
			newCase("c_1", pageInfo("https://www.example.com/", "Home"), NOW),
		);
		await add(store, "c_1", 1, "https://www.example.com/", "Home");
		const c = await add(
			store,
			"c_1",
			2,
			"http://localhost:3000/",
			"Local home",
		);
		expect(c.pages?.map((p) => p.url)).toEqual([
			"https://www.example.com/",
			"http://localhost:3000/",
		]);
		expect(pageAt(c, "http://localhost:3000/")?.url).toBe(
			"http://localhost:3000/",
		);
	});

	test("the page after the most a case holds is refused in the words of the other limits, before anything is stored", async () => {
		const store = new MemoryStore();
		const full: Case = {
			...flow(),
			id: "c_full",
			title: "A long flow",
			pages: Array.from({ length: MAX_PAGES }, (_, i) => ({
				url: `https://shop.example/step/${i}`,
				title: "",
				lang: "",
			})),
			page: { ...flow().page, url: "https://shop.example/step/0" },
			shots: Array.from({ length: MAX_PAGES }, (_, i) =>
				shot(`s${i + 1}`, `https://shop.example/step/${i}`),
			),
			marks: Array.from({ length: MAX_PAGES }, (_, i) =>
				mark(i + 1, `s${i + 1}`),
			),
		};
		await putCase(store, full);
		await expect(
			add(
				store,
				"c_full",
				MAX_PAGES + 1,
				"https://shop.example/one-more",
				"More",
			),
		).rejects.toThrow(
			`“A long flow” holds marks on ${MAX_PAGES} pages, the most a case can; start a new case for marks on further pages.`,
		);
		// A further mark on a page it has is taken.
		const c = await add(
			store,
			"c_full",
			MAX_PAGES + 1,
			"http://localhost:3000/step/7/",
			"Step 7",
		);
		expect(c.pages).toHaveLength(MAX_PAGES);
		expect(c.marks).toHaveLength(MAX_PAGES + 1);
	});

	test("a case from before the list whose first page kept no mark: the next mark's list has no page without a screenshot", async () => {
		const store = new MemoryStore();
		// As 0.3.0 left it: the first page stays when its last mark goes.
		const old: Case = {
			...sampleCase("c_old"),
			page: { ...flow().page, url: CART },
			shots: [shot("s1", PAY, 390)],
			marks: [mark(1, "s1")],
			lastNumber: 2,
		};
		expect(old.pages).toBeUndefined();
		await putCase(store, old);
		const c = await add(store, "c_old", 3, "https://shop.example/done", "Done");
		expect(c.pages).toEqual([
			{ url: PAY, title: "", lang: "" },
			{ url: "https://shop.example/done", title: "Done", lang: "en" },
		]);
		// `page` is the first page left, with its window.
		expect(c.page.url).toBe(PAY);
		expect(c.page.viewport.width).toBe(390);
		expect(casePages(c).every((p) => marksOnPage(c, p.url) > 0)).toBe(true);
	});

	test("counting the marks of every page is one pass, also at the format's limits", () => {
		const big: Case = {
			...flow(),
			pages: undefined as never,
			shots: Array.from({ length: 1000 }, (_, i) =>
				shot(`s${i + 1}`, `https://shop.example/p/${i % 200}`),
			),
			marks: Array.from({ length: 1000 }, (_, i) => mark(i + 1, `s${i + 1}`)),
		};
		delete (big as { pages?: unknown }).pages;
		const started = performance.now();
		for (let i = 0; i < 20; i++) {
			const counts = marksByPage(big);
			expect(casePages(big).map((p) => counts.get(pageKey(p.url)))).toContain(
				5,
			);
		}
		// 20 sweeps took 10 s before (516 ms each); a generous bound.
		expect(performance.now() - started).toBeLessThan(2000);
	});
});
