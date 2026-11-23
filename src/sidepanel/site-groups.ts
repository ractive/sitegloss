/**
 * A case's pages by site, for the case's head (DEC-067): under the heading
 * "Site" or "Sites", each site a heading that opens and closes its own list
 * of pages. The rows are the pages of `casePages`, one per page whatever the
 * host (DEC-063); a page's sites are those of its own address and of every
 * screenshot of it, so a page marked on two sites is in both lists.
 */

import { type Case, type CasePage, casePages, pageKey } from "../lib/case.ts";
import {
	caseAddresses,
	caseSites,
	type Kept,
	keptFor,
	siteOf,
} from "../lib/site.ts";
import { shortUrl } from "./dom.ts";

/** The group of the pages marked only on local addresses, in a case of several sites. */
export const LOCAL_GROUP = "Local addresses";

export interface SiteGroup {
	/** The heading: the site; the host where the case has no site; or `LOCAL_GROUP`. */
	name: string;
	/** In the order of the case's pages. */
	pages: CasePage[];
}

const hostOf = (url: string): string => {
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
};

/**
 * The case's pages under its sites, most pages first, then by name. One site:
 * every page under it, also one marked only on local addresses. No site at
 * all: one group, named by the first page's host (`localhost:3000`). Several:
 * a page under each site it was marked on, and the pages marked only on
 * local addresses in a group of their own at the end.
 */
export const siteGroups = (c: Case): SiteGroup[] =>
	keptFor(groupsOf, c, () => groupsNow(c));

const groupsOf = new WeakMap<Case, Kept<SiteGroup[]>>();

function groupsNow(c: Case): SiteGroup[] {
	const pages = casePages(c);
	if (pages.length === 0) return [];
	const addresses = caseAddresses(c);
	const sites = caseSites(c);
	if (sites.length <= 1)
		return [
			{
				name: sites[0] ?? (hostOf(pages[0]?.url ?? "") || LOCAL_GROUP),
				pages,
			},
		];
	const sitesOfPage = new Map<string, Set<string>>();
	for (const address of addresses) {
		const site = siteOf(address);
		if (site === null) continue;
		const key = pageKey(address);
		const of = sitesOfPage.get(key) ?? new Set<string>();
		of.add(site);
		sitesOfPage.set(key, of);
	}
	const on = (p: CasePage) => sitesOfPage.get(pageKey(p.url));
	// A site none of the listed pages is on (a screenshot past the 200) has no group.
	const groups = sites
		.map((site) => ({
			name: site,
			pages: pages.filter((p) => on(p)?.has(site)),
		}))
		.filter((g) => g.pages.length > 0);
	const local = pages.filter((p) => on(p) === undefined);
	if (local.length > 0) groups.push({ name: LOCAL_GROUP, pages: local });
	return groups;
}

/**
 * Whether each group's list starts open, before the person chose: the only
 * one always, however many pages it has (the owner's wish); of several, the
 * ones with the page in front, or all of them where the tab shows none of
 * the case's pages.
 */
export function openAtFirst(
	groups: readonly SiteGroup[],
	front: CasePage | undefined,
): boolean[] {
	const has = (g: SiteGroup) =>
		front !== undefined && g.pages.some((p) => p.url === front.url);
	const any = groups.some(has);
	return groups.map((g) => groups.length === 1 || !any || has(g));
}

/** "sitegloss.dev", "comparis.ch, ractive.ch", "comparis.ch, ractive.ch and 2 more sites". */
export function sitesText(sites: readonly string[]): string {
	if (sites.length <= 3) return sites.join(", ");
	return `${sites.slice(0, 2).join(", ")} and ${sites.length - 2} more sites`;
}

/**
 * Where a case is, for its card (DEC-067), as sitegloss.dev's case list says
 * it: its sites and its number of pages ("sitegloss.dev", "8 pages"). A case
 * of one page on one site says the page's address, which names the site and
 * says more than "1 page"; a case on local addresses only says its first
 * page's host in the site's place.
 */
export function whereText(c: Case): { where: string; pages?: string } {
	const pages = casePages(c);
	const first = pages[0]?.url ?? c.page.url;
	const sites = caseSites(c);
	// A case on local addresses only has no site: its one page's address, or its host.
	if (pages.length <= 1 && sites.length === 0)
		return { where: shortUrl(first) };
	// The site is named as one (the owner wanted the word on the card).
	return {
		where:
			sites.length === 0
				? hostOf(first) || first
				: `${sites.length === 1 ? "Site" : "Sites"}: ${sitesText(sites)}`,
		// One page: its address says more than "1 page".
		pages:
			pages.length <= 1 && sites.length > 0
				? shortUrl(first)
				: `${Math.max(1, pages.length)} page${pages.length > 1 ? "s" : ""}`,
	};
}
