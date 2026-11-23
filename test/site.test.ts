import { describe, expect, test } from "bun:test";
import type { Case, Shot } from "../src/lib/case.ts";
import { caseSites, siteOf, sitesOf } from "../src/lib/site.ts";
import {
	LOCAL_GROUP,
	openAtFirst,
	siteGroups,
	sitesText,
	whereText,
} from "../src/sidepanel/site-groups.ts";
import { sampleCase } from "./fixtures.ts";
import vectors from "./site.json" with { type: "json" };

const shot = (id: string, url: string): Shot => ({
	id,
	image: `shots/${id}.webp`,
	scrollX: 0,
	scrollY: 0,
	viewport: { width: 1280, height: 800, dpr: 2 },
	capturedAt: "2026-11-21T09:00:00.000Z",
	url,
});

/** A case with a page and a screenshot for each address, and more screenshots of its pages elsewhere. */
const caseOn = (urls: string[], elsewhere: string[] = []): Case => {
	const base = sampleCase("c_sites");
	return {
		...base,
		page: { ...base.page, url: urls[0] ?? base.page.url },
		pages: urls.map((url, i) => ({ url, title: `Page ${i + 1}`, lang: "en" })),
		shots: [...urls, ...elsewhere].map((url, i) => shot(`s${i + 1}`, url)),
	};
};

describe("what a site is: the server's rule, held to the server's own vectors", () => {
	test("siteOf gives the site of every address in test/site.json", () => {
		// test/site.json is sitegloss.dev's packages/api/vectors/site.json.
		expect(vectors.vectors.length).toBeGreaterThan(30);
		for (const { url, site } of vectors.vectors)
			expect([url, siteOf(url)]).toEqual([url, site]);
	});

	test("sitesOf orders a case's sites as the vectors say: most pages first, then by name", () => {
		for (const { urls, sites } of vectors.cases)
			expect([urls, sitesOf(urls)]).toEqual([urls, sites]);
	});

	test("a case's sites come from its pages and its screenshots", () => {
		const c = caseOn(
			["https://www.ractive.ch/a"],
			["https://staging.comparis.ch/a", "http://localhost:3000/a"],
		);
		expect(caseSites(c)).toEqual(["comparis.ch", "ractive.ch"]);
	});
});

describe("a case's pages by site", () => {
	test("one site: every page under it, one marked only on localhost too, open however many", () => {
		const c = caseOn([
			"https://app.sitegloss.dev/a",
			"https://sitegloss.dev/b",
			"http://localhost:3000/c",
		]);
		const groups = siteGroups(c);
		expect(groups.map((g) => [g.name, g.pages.length])).toEqual([
			["sitegloss.dev", 3],
		]);
		expect(openAtFirst(groups, groups[0]?.pages[1])).toEqual([true]);
		expect(openAtFirst(groups, undefined)).toEqual([true]);
	});

	test("no site at all: one group, named by the first page's host", () => {
		const c = caseOn(["http://localhost:3000/a", "http://127.0.0.1:3000/b"]);
		expect(siteGroups(c).map((g) => [g.name, g.pages.length])).toEqual([
			["localhost:3000", 2],
		]);
	});

	test("several: a page under each site it was marked on, local pages last; the page in front's sites open", () => {
		const c = caseOn(
			[
				"https://www.ractive.ch/x",
				"https://www.comparis.ch/a",
				"https://www.comparis.ch/b",
				"http://localhost:3000/local",
			],
			["https://comparis.ch/x"],
		);
		const groups = siteGroups(c);
		expect(
			groups.map((g) => [g.name, g.pages.map((p) => new URL(p.url).pathname)]),
		).toEqual([
			["comparis.ch", ["/x", "/a", "/b"]],
			["ractive.ch", ["/x"]],
			[LOCAL_GROUP, ["/local"]],
		]);
		const page = (path: string) =>
			groups.flatMap((g) => g.pages).find((p) => p.url.endsWith(path));
		expect(openAtFirst(groups, page("/a"))).toEqual([true, false, false]);
		expect(openAtFirst(groups, page("/x"))).toEqual([true, true, false]);
		// The tab shows none of the case's pages: all open.
		expect(openAtFirst(groups, undefined)).toEqual([true, true, true]);
	});
});

describe("past the list's 200 pages", () => {
	test("a site only screenshots past the cut are on gets no heading, though the case counts it", () => {
		const many = Array.from(
			{ length: 200 },
			(_, i) => `https://a.example.com/${i}`,
		);
		const c = caseOn(many, ["https://b.example.org/later"]);
		expect(caseSites(c)).toEqual(["example.com", "example.org"]);
		expect(siteGroups(c).map((g) => [g.name, g.pages.length])).toEqual([
			["example.com", 200],
		]);
	});
});

describe("a case's card says its sites and its number of pages", () => {
	test("one site, several pages", () => {
		expect(
			whereText(
				caseOn(["https://app.sitegloss.dev/a", "https://sitegloss.dev/b"]),
			),
		).toEqual({ where: "Site: sitegloss.dev", pages: "2 pages" });
	});

	test("two or three sites are named, more counted", () => {
		expect(
			whereText(caseOn(["https://comparis.ch/a", "https://ractive.ch/b"])),
		).toEqual({ where: "Sites: comparis.ch, ractive.ch", pages: "2 pages" });
		expect(sitesText(["a.ch", "b.ch", "c.ch", "d.ch"])).toBe(
			"a.ch, b.ch and 2 more sites",
		);
	});

	test("one page on a site says the site and the page's address; local addresses only say the address or the host", () => {
		expect(whereText(caseOn(["https://app.sitegloss.dev/pricing"]))).toEqual({
			where: "Site: sitegloss.dev",
			pages: "app.sitegloss.dev/pricing",
		});
		expect(whereText(caseOn(["http://localhost:3000/a"]))).toEqual({
			where: "localhost:3000/a",
		});
		expect(
			whereText(caseOn(["http://localhost:3000/a", "http://localhost:3000/b"])),
		).toEqual({ where: "localhost:3000", pages: "2 pages" });
	});
});
