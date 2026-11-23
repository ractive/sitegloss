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

import { parse } from "tldts";
import { type Case, casePages, pageKey, shotUrl } from "./case.ts";

/**
 * The site of an address, or null: not http or https; a host whose ending is
 * on neither section of the list (`.lan`, `.corp`, `.local`, `.test`), except
 * `.example`, which demos and tests use; `localhost` and `home.arpa` and the
 * names under them; an IP address; a host without a dot or with an empty
 * label. Trailing dots are dropped. A host that is a public suffix itself
 * (`github.io`) is its own site. Lower case; an international name in its
 * ASCII form (`xn--bcher-kva.de`), as the address parser gives the host.
 */
export function siteOf(address: string): string | null {
	const kept = known.get(address);
	if (kept !== undefined) return kept;
	const site = siteRule(address);
	if (known.size >= KNOWN_KEPT) known.clear();
	known.set(address, site);
	return site;
}

/**
 * The sites of the addresses asked about lately: the rule is pure and the
 * panel draws often, so an address is parsed and looked up once.
 */
const known = new Map<string, string | null>();
const KNOWN_KEPT = 5000;

function siteRule(address: string): string | null {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	const host = url.hostname.replace(/\.+$/, "");
	// An empty label: a leading dot or two dots in a row.
	if (host === "" || host.split(".").includes("")) return null;
	// An IPv6 address is in brackets; the parser writes every IPv4 form as four numbers.
	if (host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
	if (!host.includes(".")) return null;
	if (NEVER.some((end) => host === end || host.endsWith(`.${end}`)))
		return null;
	const found = parse(host, {
		allowPrivateDomains: true,
		extractHostname: false,
	});
	// An ending the list does not know is an intranet's (`.lan`, `.corp`):
	// no site, but for `.example`, which demos and tests use.
	if (!found.isIcann && !found.isPrivate && found.publicSuffix !== "example")
		return null;
	return found.domain ?? host;
}

/**
 * Endings that are never a site, whatever the list says: `localhost` (not on
 * it either) and `home.arpa`, the home network's (RFC 8375), which the list
 * has in its ICANN section.
 */
const NEVER = ["localhost", "home.arpa"];

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

/**
 * A case's sites, most pages first, then by name; none where it was marked
 * only on local addresses. Counted over every screenshot, also one of a page
 * past the list's 200.
 */
export const caseSites = (c: Case): string[] =>
	keptFor(sitesOfCase, c, () => sitesOf(caseAddresses(c)));

const sitesOfCase = new WeakMap<Case, Kept<string[]>>();

/** A value derived from a case, with what it was derived from in short. */
export interface Kept<T> {
	print: string;
	value: T;
}

/**
 * A value derived from a case, kept per case object for as long as the case
 * looks the same (its change time, its pages and screenshots counted): the
 * panel draws many times a second, and a changed case is a new object.
 */
export function keptFor<T>(
	kept: WeakMap<Case, Kept<T>>,
	c: Case,
	make: () => T,
): T {
	const print = `${c.updatedAt}|${c.shots.length}|${c.pages?.length ?? 0}|${c.page.url}`;
	const hit = kept.get(c);
	if (hit !== undefined && hit.print === print) return hit.value;
	const value = make();
	kept.set(c, { print, value });
	return value;
}
