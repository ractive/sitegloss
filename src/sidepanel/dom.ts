/** A tiny element builder for the side panel. */

import { hashRoute } from "../lib/case.ts";

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<Record<string, string | boolean | ((e: Event) => void)>> = {},
	...children: Child[]
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) {
		if (value === undefined || value === false) continue;
		if (typeof value === "function") {
			el.addEventListener(key.replace(/^on/, ""), value as EventListener);
		} else if (key === "class") {
			el.className = String(value);
		} else if (value === true) {
			el.setAttribute(key, "");
		} else {
			el.setAttribute(key, value);
		}
	}
	for (const child of children) {
		if (child === null || child === undefined || child === false) continue;
		el.append(child);
	}
	return el;
}

export function byId<T extends HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (found === null) throw new Error(`#${id} missing`);
	return found as T;
}

/** "4 Nov 2026, 17:05" in the browser's language. */
export function formatDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? iso
		: date.toLocaleString(undefined, {
				day: "numeric",
				month: "short",
				year: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
}

import { isWebPage } from "../lib/case.ts";

export { isWebPage };

/**
 * The match pattern for the site of a web page's `url`, as Chrome's
 * permissions take it (`https://www.example.com/*`; patterns have no port).
 */
export function sitePattern(url: string): string | undefined {
	if (!isWebPage(url)) return undefined;
	const { protocol, hostname } = new URL(url);
	return `${protocol}//${hostname}/*`;
}

/** `www.example.com/kk` from a URL, `app.example.com/#/cart` with its hash route. */
export function shortUrl(url: string): string {
	try {
		const u = new URL(url);
		// The hash route is what tells a single-page app's pages apart.
		const route = hashRoute(u.hash);
		return `${u.host}${u.pathname === "/" && route === "" ? "" : u.pathname}${route}`;
	} catch {
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
		return url;
	}
}
