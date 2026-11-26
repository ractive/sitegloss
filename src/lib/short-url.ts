/**
 * Addresses as the side panel and the AI app's tools word them, short: the
 * host and path, with a single-page app's hash route.
 */

import { hashRoute } from "./case.ts";

/** `www.example.com/kk` from a URL, `app.example.com/#/cart` with its hash route. */
export function shortUrl(url: string): string {
	try {
		const u = new URL(url);
		// The hash route is what tells a single-page app's pages apart.
		const route = hashRoute(u.hash);
		return `${u.host}${u.pathname === "/" && route === "" ? "" : u.pathname}${route}`;
	} catch {
		// Not an address.
		return url;
	}
}

/**
 * `/teams/t_1/cases` or `/#/cart`: a page's path with its hash route, as
 * `shortUrl` names it without the host; with it where `withHost`.
 */
export function shortPath(url: string, withHost: boolean): string {
	if (withHost) return shortUrl(url);
	try {
		const u = new URL(url);
		return `${u.pathname}${hashRoute(u.hash)}`;
	} catch {
		// Not an address.
		return url;
	}
}
