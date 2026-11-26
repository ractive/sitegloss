/**
 * Which page an address is, and the pages of a case (DEC-038, DEC-050).
 */

import { storedQuery, withQuery } from "../query.ts";
import {
	type Case,
	type CasePage,
	MAX_PAGES,
	type Mark,
	type Shot,
	type Viewport,
} from "./format.ts";

/**
 * Which page an address is (DEC-038). A case lists each page once, and a page
 * is its path in whatever environment: a case made on production is looked at
 * on staging and fixed on localhost, and a mark added there is on the same
 * page, not on a second one. So the key leaves the origin out, except for a
 * home page, where the origin is all there is to tell two sites apart.
 *
 * The key is the path without the slashes at its end, and the hash route
 * (`#/book`, `#!/book`) written as `#/book`, also without slashes at its end.
 * A query and a plain fragment (`#section`) name no page. What is no web
 * address is its own key.
 *
 * This is the server's function (sitegloss.dev, `packages/api/src/v1/page.ts`)
 * and has to stay it: `test/page-key.json` holds the server's vectors, and
 * everything here that asks "the same page?" asks this.
 */
export function pageKey(address: string): string {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return address;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return address;
	const path = url.pathname.replace(/\/+$/, "");
	const route = (/^#!?(\/[^?#&=]*)/.exec(url.hash)?.[1] ?? "").replace(
		/\/+$/,
		"",
	);
	if (path === "" && route === "") return `${url.origin}/`;
	return route === "" ? path : `${path}#${route}`;
}

/** Whether two addresses are the same page of a case (`pageKey`). */
export const samePage = (a: string, b: string): boolean =>
	pageKey(a) === pageKey(b);

/** A web address's origin; none for anything else. */
function webOrigin(address: string): string | undefined {
	try {
		const url = new URL(address);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.origin
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * The same page on the same site (DEC-050): the origin and `pageKey`. What
 * Home offers under "This page" is held to this, and nothing more.
 */
export function exactPage(a: string, b: string): boolean {
	const origin = webOrigin(a);
	return origin !== undefined && origin === webOrigin(b) && samePage(a, b);
}

/**
 * Which page an address is for drawing a case opened by hand (DEC-050): its
 * path and hash route, whatever the host. `pageKey`, except that a home page
 * is `/` on any host: production's home page is the home page on
 * `localhost:3000/`. The extension's own; the shared `pageKey` and its
 * vectors do not change.
 */
export function pathKey(address: string): string {
	const key = pageKey(address);
	const origin = webOrigin(address);
	return origin !== undefined && key === `${origin}/` ? "/" : key;
}

/** Whether a mark of the page at `a` is drawn on the page at `b` (`pathKey`). */
export const samePath = (a: string, b: string): boolean =>
	pathKey(a) === pathKey(b);

/**
 * What tells a mark from every other mark of its case, whatever its number:
 * when its screenshot was taken, and its drawing. A mark's id (`m<number>`)
 * is another mark's after the team's sync gave it another number (DEC-039),
 * so what is opened on one mark is held to this, not to the id.
 */
export function markKey(c: Case, a: Mark): string {
	return markKeys(c).get(a.id) ?? drawnKey(c, a);
}

/** A mark's screenshot time and drawing, as a key. */
function drawnKey(c: Case, a: Mark): string {
	const shot = c.shots.find((s) => s.id === a.shot);
	return JSON.stringify([
		shot?.capturedAt ?? "",
		a.shape,
		a.element?.selector ?? null,
		a.element?.rect ?? null,
	]);
}

/**
 * Every mark's `markKey`, by id. Twins (the same drawing on the same
 * screenshot: the same element marked twice) are told apart by nothing but
 * their ids, so their key also names the ids all of them have now: once a
 * renumbering moves any of them, a key held from before names no mark, and
 * `markFor` refuses instead of taking a twin for the mark meant.
 */
function markKeys(c: Case): Map<string, string> {
	const drawn = new Map<string, string[]>();
	const of = new Map<string, string>();
	for (const a of c.marks) {
		const key = drawnKey(c, a);
		of.set(a.id, key);
		drawn.set(key, [...(drawn.get(key) ?? []), a.id]);
	}
	const keys = new Map<string, string>();
	for (const [id, key] of of) {
		const twins = drawn.get(key) ?? [];
		keys.set(
			id,
			twins.length > 1
				? JSON.stringify([...(JSON.parse(key) as unknown[]), [...twins].sort()])
				: key,
		);
	}
	return keys;
}

/**
 * The mark of `c` that something opened on the mark `id` with the key `key`
 * is about now (`markKey`): the mark under that id while it is still that
 * mark; else the one mark with that key (it has another number now). None:
 * it is not in the case any more. `"ambiguous"`: the key names no mark, or
 * more than one, and a mark with its screenshot and drawing is there (twins
 * whose ids moved, or a twin made since): nothing says which is meant,
 * whatever the ids say, and nothing may be changed.
 */
export function markFor(
	c: Case,
	id: string,
	key: string,
): Mark | "ambiguous" | undefined {
	const keys = markKeys(c);
	const under = c.marks.find((a) => a.id === id);
	if (under !== undefined && keys.get(under.id) === key) return under;
	const same = c.marks.filter((a) => keys.get(a.id) === key);
	if (same.length === 1) return same[0];
	if (same.length > 1) return "ambiguous";
	let drawn: string;
	try {
		drawn = JSON.stringify((JSON.parse(key) as unknown[]).slice(0, 4));
	} catch {
		return undefined;
	}
	return c.marks.some((a) => drawnKey(c, a) === drawn)
		? "ambiguous"
		: undefined;
}

/** What is said when a change cannot be held to its mark. */
export const MARK_CHANGED =
	"The case changed meanwhile, and this is not the mark it was: open the mark again. Nothing was saved.";

/** The address of the page a screenshot was taken on. */
export const shotUrl = (c: Case, shot: Shot | undefined): string =>
	shot?.url ?? c.page.url;

/** The address of the page a mark is on: its screenshot's. */
export function markUrl(c: Case, a: Mark): string {
	return shotUrl(
		c,
		c.shots.find((s) => s.id === a.shot),
	);
}

/**
 * The case's pages, the first one first (DEC-038): the stored list, or for a
 * case from before the list the first page; and every page a screenshot was
 * taken on that is not among them, without a title. A page is there once
 * (`pageKey`).
 */
export function casePages(c: Case): CasePage[] {
	const pages: CasePage[] = [];
	const seen = new Set<string>();
	const add = (page: CasePage) => {
		const key = pageKey(page.url);
		if (seen.has(key)) return;
		seen.add(key);
		pages.push(page);
	};
	for (const page of c.pages ?? []) add(page);
	if (c.pages === undefined || c.pages.length === 0)
		add({ url: c.page.url, title: c.page.title, lang: c.page.lang });
	for (const shot of c.shots)
		if (shot.url !== undefined) add({ url: shot.url, title: "", lang: "" });
	return pages.slice(0, MAX_PAGES);
}

/**
 * How many marks each page of the case has, by the page's key: one pass over
 * the screenshots and one over the marks, for a list of pages with counts.
 */
export function marksByPage(c: Case): Map<string, number> {
	const first = pageKey(c.page.url);
	const pageOf = new Map(
		c.shots.map((s) => [s.id, s.url === undefined ? first : pageKey(s.url)]),
	);
	const counts = new Map<string, number>();
	for (const a of c.marks) {
		const key = pageOf.get(a.shot) ?? first;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

/** How many of the case's marks are on the page `url`. */
export function marksOnPage(c: Case, url: string): number {
	return marksByPage(c).get(pageKey(url)) ?? 0;
}

/**
 * The page of the case's list that the address `url` is (`pageKey`): the
 * case's page in another environment is the same page, a home page is its
 * site's. For the list and what is sent of it; which marks are drawn on the
 * page in front is `pageInFront` (DEC-050).
 */
export function pageAt(c: Case, url: string): CasePage | undefined {
	const key = pageKey(url);
	return casePages(c).find((p) => pageKey(p.url) === key);
}

/**
 * The case with its list of pages as its screenshots have them: a page no
 * screenshot is of any more goes, and `page` follows the first one left,
 * with the window that page's first screenshot was taken in. A case without
 * screenshots keeps the pages it was started on; one stored before the list
 * (DEC-038) stays without it.
 */
export function withPagesOfShots(c: Case): Case {
	if (c.pages === undefined || c.shots.length === 0) return c;
	const taken = new Set(c.shots.map((s) => pageKey(shotUrl(c, s))));
	const pages = casePages(c).filter((p) => taken.has(pageKey(p.url)));
	const first = pages[0];
	if (first === undefined) return c;
	if (samePage(first.url, c.page.url)) return { ...c, pages };
	// A screenshot that names no page is of the page that leaves: it says so
	// before `page` becomes another one, or it would move with it.
	const shots = c.shots.map((s) =>
		s.url === undefined ? { ...s, url: c.page.url } : s,
	);
	const shot = shots.find((s) => samePage(s.url ?? "", first.url));
	return {
		...c,
		shots,
		pages,
		page: {
			...c.page,
			url: first.url,
			title: first.title,
			lang: first.lang,
			...(shot === undefined ? {} : { viewport: shot.viewport }),
		},
	};
}

/**
 * A case as it comes in from elsewhere (a file, the team), with `page`, the
 * list and the screenshots agreeing (DEC-038): every screenshot names its
 * page (one that did not is of `page`), `page` is the first of the list, and
 * a page is there once. Nothing checks this in a file, and what follows
 * (counts per page, "Open the page", a delete) relies on it.
 */
export function withPagesAgreed(c: Case): Case {
	const shots = c.shots.some((s) => s.url === undefined)
		? c.shots.map((s) => (s.url === undefined ? { ...s, url: c.page.url } : s))
		: c.shots;
	if (c.pages === undefined) return shots === c.shots ? c : { ...c, shots };
	const own = c.pages.find((p) => samePage(p.url, c.page.url)) ?? {
		url: c.page.url,
		title: c.page.title,
		lang: c.page.lang,
	};
	const pages = casePages({ ...c, shots: [], pages: [own, ...c.pages] });
	return { ...c, shots, pages };
}

/**
 * The window a mark of the page at `url` was made in: that of the first
 * screenshot of the page there (`pageInFront`), else of the case's first
 * page (DEC-038).
 */
export function viewportAt(c: Case, url: string | undefined): Viewport {
	const page = url ? pageInFront(c, url) : undefined;
	const shot =
		page === undefined
			? undefined
			: c.shots.find((s) => samePage(shotUrl(c, s), page.url));
	return shot?.viewport ?? c.page.viewport;
}

/**
 * The page of the case whose marks are drawn on the page at `url`
 * (DEC-050): by path and hash route, whatever the host (`pathKey`); of two
 * that both are (two sites' home pages), the one on the same site.
 */
export function pageInFront(c: Case, url: string): CasePage | undefined {
	const pages = casePages(c);
	return (
		pages.find((p) => exactPage(p.url, url)) ??
		pages.find((p) => samePath(p.url, url))
	);
}

/**
 * Whether the mark `a` is a mark of the page at `url`, for drawing and for
 * what a draw found (DEC-050): its page is the one `pageInFront` picks. So
 * of two sites' home pages in one case, on either site only that site's
 * marks are the page's own; on a third host, the first listed page's.
 * Everything that asks "is this mark on the page in front?" asks this.
 */
export function onPageInFront(c: Case, a: Mark, url: string): boolean {
	const page = pageInFront(c, url);
	return page !== undefined && samePage(page.url, markUrl(c, a));
}

/**
 * Home offers the case under "This page" (DEC-050): one of its screenshots
 * was taken on the same page of the same site (`exactPage`); a case with no
 * screenshot yet, on its page. Nothing else: no other host, no title.
 */
export function isOfferedOn(c: Case, url: string): boolean {
	if (c.shots.length === 0) return exactPage(c.page.url, url);
	return c.shots.some((s) => exactPage(shotUrl(c, s), url));
}

/** The address a mark was made on, with its query: what opens it again (DEC-050). */
export function markAddress(c: Case, a: Mark): string {
	const shot = c.shots.find((s) => s.id === a.shot);
	return withQuery(shotUrl(c, shot), shot?.query);
}

/** A screenshot's address with its query (DEC-050). */
export const shotAddress = (c: Case, shot: Shot): string =>
	withQuery(shotUrl(c, shot), shot.query);

/** A shot's `query` as a file or the team gives it: kept, or none (`storedQuery`). */
export function queryField(value: unknown): { query?: string } {
	const query = storedQuery(value);
	return query === undefined ? {} : { query };
}

/** A web page's address, one a click may open (an imported case's is anyone's). */
export function isWebPage(url: string): boolean {
	try {
		const { protocol } = new URL(url);
		return protocol === "https:" || protocol === "http:";
	} catch {
		return false;
	}
}
