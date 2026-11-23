import { describe, expect, test } from "bun:test";
import type { Case } from "../src/lib/case.ts";
import {
	isCasePageAddress,
	openAt,
	pageHosts,
} from "../src/sidepanel/page-hosts.ts";

const shot = (id: string, url: string, capturedAt: string) => ({
	id,
	image: `shots/${id}.webp`,
	scrollX: 0,
	scrollY: 0,
	viewport: { width: 1280, height: 800, dpr: 1 },
	capturedAt,
	url,
});

const SETTINGS = "https://app.sitegloss.dev/t/a/settings";
const LOCAL = "http://localhost:3500/t/a/settings";

const c = {
	id: "c_hosts",
	page: { url: SETTINGS, title: "Settings", lang: "en" },
	pages: [{ url: SETTINGS, title: "Settings · Sitegloss", lang: "en" }],
	shots: [
		shot("s1", SETTINGS, "2026-11-22T20:00:00.000Z"),
		shot("s2", LOCAL, "2026-11-22T23:00:00.000Z"),
	],
	marks: [],
} as unknown as Case;

describe("one row per page whatever the host (DEC-063)", () => {
	test("a page's hosts, the last marked first", () => {
		const hosts = pageHosts(c).get("/t/a/settings");
		expect(hosts?.origins).toEqual([
			"http://localhost:3500",
			"https://app.sitegloss.dev",
		]);
	});

	test("opened on the tab's host when it was marked there, else on its last", () => {
		const hosts = pageHosts(c).get("/t/a/settings");
		expect(openAt(SETTINGS, hosts, "https://app.sitegloss.dev/t/a")).toBe(
			SETTINGS,
		);
		expect(openAt(SETTINGS, hosts, "http://localhost:3500/")).toBe(LOCAL);
		expect(openAt(SETTINGS, hosts, "https://staging.example/")).toBe(LOCAL);
		expect(openAt(SETTINGS, hosts, undefined)).toBe(LOCAL);
	});

	test("what a row may open: a case's page on a host it was marked on, nothing else", () => {
		expect(isCasePageAddress(c, LOCAL)).toBe(true);
		expect(isCasePageAddress(c, SETTINGS)).toBe(true);
		expect(isCasePageAddress(c, "https://evil.example/t/a/settings")).toBe(
			false,
		);
		expect(isCasePageAddress(c, "http://localhost:3500/t/a/members")).toBe(
			false,
		);
	});
});
