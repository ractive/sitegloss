/** A tiny element builder for the side panel. */

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

export { shortPath, shortUrl } from "../lib/short-url.ts";
