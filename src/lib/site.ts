/**
 * Which site an address is on (DEC-067): the registrable domain of its host,
 * every subdomain counted in, by the public suffix list with its private
 * section (`tldts`). It is sitegloss.dev's rule (`packages/api/src/v1/site.ts`,
 * its DEC-041), and `test/site.json` is a copy of the server's
 * `packages/api/vectors/site.json` that this has to pass, held as
 * `page-key.json` is.
 *
 * Only the side panel and the worker load this module: the list is about
 * 130 kB, and the content script that runs in every web page never needs it.
 * A site is never stored: it is derived where it is shown.
 */

import { getDomain } from "tldts";
import { type Case, casePages, pageKey, shotUrl } from "./case.ts";

/** The suffixes whose names are never a site: kept for local networks and tests. */
const LOCAL_SUFFIXES = [
	"localhost",
	"local",
	"test",
	"internal",
	"invalid",
	"home.arpa",
];

/**
 * The site of an address, or null: not http or https, `localhost` and the
 * names under it, an IP address, a host without a dot, a name under a local
 * or test suffix. `.example` is a site. A host that is a public suffix itself
 * (`github.io`) is its own site. Lower case; an international name in its
 * ASCII form (`xn--bcher-kva.de`), as the address parser gives the host.
 */
export function siteOf(address: string): string | null {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	const host = url.hostname.replace(/\.$/, "");
	// An IPv6 address is in brackets; the parser writes every IPv4 form as four numbers.
	if (host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
	if (!host.includes(".")) return null;
	if (LOCAL_SUFFIXES.some((end) => host === end || host.endsWith(`.${end}`)))
		return null;
	return (
		getDomain(host, { allowPrivateDomains: true, extractHostname: false }) ??
		host
	);
}

/**
 * The sites of a set of addresses: the site with the most pages first (a
 * page counted once per site, by `pageKey`), then by name. Addresses on no
 * site are left out.
 */
export function sitesOf(addresses: Iterable<string>): string[] {
	const pages = new Map<string, Set<string>>();
	for (const address of addresses) {
		const site = siteOf(address);
		if (site === null) continue;
		const keys = pages.get(site) ?? new Set<string>();
		keys.add(pageKey(address));
		pages.set(site, keys);
	}
	return [...pages.entries()]
		.sort(([a, x], [b, y]) => y.size - x.size || (a < b ? -1 : a > b ? 1 : 0))
		.map(([site]) => site);
}

/** Every address a case's pages and screenshots were taken on, its pages first. */
export function caseAddresses(c: Case): string[] {
	return [
		...casePages(c).map((p) => p.url),
		...c.shots.map((s) => shotUrl(c, s)),
	];
}

/** A case's sites, most pages first, then by name; none where it was marked only on local addresses. */
export const caseSites = (c: Case): string[] => sitesOf(caseAddresses(c));
