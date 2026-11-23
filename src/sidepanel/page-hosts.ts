/**
 * One row per page of a case, whatever host it was marked on (DEC-063): a
 * page is its `pageKey` (path and hash route, DEC-038, DEC-057), so the same
 * page marked on app.sitegloss.dev and on localhost:3500 is one page. This
 * says on which hosts each was marked, the last first, and where a click on
 * its row opens it.
 */

import {
	type Case,
	casePages,
	isWebPage,
	pageKey,
	shotUrl,
} from "../lib/case.ts";

export interface PageHosts {
	/** The origins it was marked on, the most recent first. */
	origins: string[];
}

const originOf = (url: string): string | undefined => {
	try {
		return isWebPage(url) ? new URL(url).origin : undefined;
	} catch {
		return undefined;
	}
};

/** Each page's origins, by `pageKey`, the most recently marked first. */
export function pageHosts(c: Case): Map<string, PageHosts> {
	const seen = new Map<string, Map<string, number>>();
	const note = (url: string, at: number) => {
		const origin = originOf(url);
		if (origin === undefined) return;
		const key = pageKey(url);
		const of = seen.get(key) ?? new Map<string, number>();
		of.set(origin, Math.max(of.get(origin) ?? -1, at));
		seen.set(key, of);
	};
	// The screenshots say when; the list of pages names the first host.
	for (const shot of c.shots) {
		const at = Date.parse(shot.capturedAt);
		note(shotUrl(c, shot), Number.isNaN(at) ? 0 : at);
	}
	for (const page of casePages(c)) note(page.url, -1);
	const out = new Map<string, PageHosts>();
	for (const [key, of] of seen)
		out.set(key, {
			origins: [...of.entries()].sort((a, b) => b[1] - a[1]).map(([o]) => o),
		});
	return out;
}

/**
 * Where a click on a page's row opens it: on the host of the tab in front
 * when the page was marked there, else on the host it was marked on last.
 */
export function openAt(
	pageUrl: string,
	hosts: PageHosts | undefined,
	tabUrl: string | undefined,
): string {
	const origins = hosts?.origins ?? [];
	const front = tabUrl === undefined ? undefined : originOf(tabUrl);
	const origin =
		front !== undefined && origins.includes(front) ? front : origins[0];
	if (origin === undefined) return pageUrl;
	try {
		const u = new URL(pageUrl);
		return `${origin}${u.pathname}${u.search}${u.hash}`;
	} catch {
		return pageUrl;
	}
}

/** Whether `url` is one of the case's pages on a host it was marked on (what a row may open). */
export function isCasePageAddress(c: Case, url: string): boolean {
	const hosts = pageHosts(c).get(pageKey(url));
	const origin = originOf(url);
	return (
		hosts !== undefined &&
		origin !== undefined &&
		hosts.origins.includes(origin)
	);
}
