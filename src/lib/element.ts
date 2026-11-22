/**
 * Describing an element: the details a case stores for each mark, and
 * that matching (match.ts) compares in another environment.
 *
 * What is recorded is this list and nothing else (DEC-009). All of it comes
 * from the page's markup and its rendered text; nothing a user typed (field
 * values, editor text) is ever read, and links lose their query and fragment,
 * which can carry personal data or tokens.
 *
 * | Field | From | Limit |
 * |---|---|---|
 * | `tag` | the element's name | 64 |
 * | `id` | `id`, when it looks hand-written (classes.ts) | 100 |
 * | `testId` | the first of `TEST_ID_ATTRIBUTES` | 300 |
 * | `role` | `role`, else the role the tag implies | 64 |
 * | `name` | accessible name: `aria-label`, `aria-labelledby`, `alt`, a label's text, `placeholder`, `title`, or the text for buttons, links, headings | 200 |
 * | `text` | rendered text without fields, editors, scripts and styles (`pageText`) | 200 |
 * | `classes` | the readable part of each class (classes.ts) | 20 |
 * | `attributes` | `ATTRIBUTE_RULES`: name, type, href (path), src (file name), placeholder, alt, title | 300 each |
 * | `heading` | the title of the section or card it is in (DEC-047), else the nearest heading before it | 200 |
 * | `landmark` | role and name of the landmark around it | 200 |
 * | `ancestors` | up to six, also outside a shadow root: tag plus test id or first readable class | 300 each |
 * | `rect`, `page` | position and size, the page's size | |
 * | `selector` | a CSS selector built from the above; empty when none finds exactly this element (inside a shadow root, or too long) | 2000 |
 * | `styles`, `backdrop`, `siblings` | a mark's own element only, once when it is made (look.ts, DEC-048): a fixed list of computed properties, the colour behind it, up to six neighbours' boxes; never on a page's candidates | 40 styles of 300 |
 *
 * The text of an editable element itself is not recorded either, and neither
 * its name from content. `withinLimits` applies the limits that the page's
 * markup could otherwise exceed.
 */

import {
	type Backdrop,
	ELEMENT_ATTRIBUTES,
	type ElementDetails,
	hashRoute,
	type Rect,
	type SiblingBox,
} from "./case.ts";
import { isGeneratedId, readableClass, readableClasses } from "./classes.ts";
import { contrastRatio, parseColor } from "./colour.ts";
import { closestAcross, hostOf, inDocument, parentOf } from "./shadow.ts";

export const TEST_ID_ATTRIBUTES = [
	"data-testid",
	"data-test-id",
	"data-test",
	"data-qa",
	"data-cy",
] as const;

const HEADINGS = "h1, h2, h3, h4, h5, h6, [role='heading']";

const LANDMARKS =
	"nav, main, header, footer, aside, form, section[aria-label], section[aria-labelledby], [role='banner'], [role='navigation'], [role='main'], [role='contentinfo'], [role='complementary'], [role='search'], [role='form'], [role='region']";

/** Collapse whitespace and cut to `max` characters. */
export function normalizeText(
	text: string | null | undefined,
	max = 200,
): string {
	return (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** What describing needs from the document; build it once for many elements. */
export interface DescribeContext {
	/** All headings, in document order. */
	headings: Element[];
	page: { width: number; height: number };
	scroll: { x: number; y: number };
	/** Sections and cards around elements, found once (DEC-047). */
	containers?: ContainerCache;
}

/**
 * Regions somebody types into. Monaco, CodeMirror 5 and Ace type into a hidden
 * textarea and draw the text as plain page content.
 */
const EDIT_REGIONS =
	'[contenteditable]:not([contenteditable="false"]), [role="textbox"], .monaco-editor, .CodeMirror, .ace_editor';

/** Where somebody types: the text inside is theirs, not the page's. */
export const EDITORS = `textarea, select, input, ${EDIT_REGIONS}`;

/** Text that is no text on the page. */
const HIDDEN_TEXT = new Set(["script", "style", "noscript", "template"]);

/** An editor or inside one: its text is what somebody typed. */
export function isEditable(el: Element): boolean {
	return (
		(el as HTMLElement).isContentEditable === true ||
		el.localName === "textarea" ||
		closestAcross(el, EDIT_REGIONS) !== null
	);
}

/** What an element shows inside it: for a slot, what is slotted into it. */
function contentOf(el: Element): Iterable<Node> {
	return el.localName === "slot"
		? (el as HTMLSlotElement).assignedNodes({ flatten: true })
		: el.childNodes;
}

/**
 * The text of an element without what is typed into editors and form fields
 * inside it (and without scripts and styles), cut to about `max` characters.
 * `skip` leaves out one more subtree, e.g. a label's control.
 */
export function pageText(
	el: Element,
	options: { max?: number; skip?: Node } = {},
): string {
	const max = options.max ?? 600;
	let text = "";
	const walk = (parent: Element): void => {
		for (const child of contentOf(parent)) {
			if (text.length >= max) return;
			if (child === options.skip) continue;
			if (child.nodeType === 3) {
				text += child.nodeValue ?? "";
			} else if (child.nodeType === 1) {
				const e = child as Element;
				if (HIDDEN_TEXT.has(e.localName) || e.matches(EDITORS)) {
					text += " ";
					continue;
				}
				walk(e);
			}
		}
	};
	walk(el);
	return text;
}

export function createContext(doc: Document): DescribeContext {
	const root = doc.documentElement;
	const win = doc.defaultView;
	return {
		headings: [...doc.querySelectorAll(HEADINGS)].filter((h) => !isEditable(h)),
		page: {
			width: Math.max(root.scrollWidth, root.clientWidth),
			height: Math.max(root.scrollHeight, root.clientHeight),
		},
		scroll: { x: win?.scrollX ?? 0, y: win?.scrollY ?? 0 },
		containers: new WeakMap(),
	};
}

export function testIdOf(el: Element): string | undefined {
	for (const name of TEST_ID_ATTRIBUTES) {
		const value = el.getAttribute(name);
		if (value) return value;
	}
	return undefined;
}

function implicitRole(el: Element): string | undefined {
	const tag = el.localName;
	switch (tag) {
		case "a":
		case "area":
			return el.hasAttribute("href") ? "link" : undefined;
		case "button":
		case "summary":
			return "button";
		case "input": {
			const type = (el.getAttribute("type") ?? "text").toLowerCase();
			if (["button", "submit", "reset", "image"].includes(type))
				return "button";
			if (type === "checkbox" || type === "radio") return type;
			if (type === "range") return "slider";
			if (type === "number") return "spinbutton";
			if (type === "search") return "searchbox";
			if (type === "hidden") return undefined;
			return "textbox";
		}
		case "select":
			return el.hasAttribute("multiple") ? "listbox" : "combobox";
		case "textarea":
			return "textbox";
		case "h1":
		case "h2":
		case "h3":
		case "h4":
		case "h5":
		case "h6":
			return "heading";
		case "img":
			return el.getAttribute("alt") === "" ? "presentation" : "img";
		case "nav":
			return "navigation";
		case "main":
			return "main";
		case "aside":
			return "complementary";
		case "form":
			return "form";
		case "header":
		case "footer":
			return el.closest("article, aside, main, nav, section") === null
				? tag === "header"
					? "banner"
					: "contentinfo"
				: undefined;
		case "section":
			return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")
				? "region"
				: undefined;
		case "ul":
		case "ol":
			return "list";
		case "li":
			return "listitem";
		case "table":
			return "table";
		case "dialog":
			return "dialog";
		case "p":
			return "paragraph";
		default:
			return undefined;
	}
}

export function roleOf(el: Element): string | undefined {
	const explicit = el.getAttribute("role")?.trim().split(/\s+/)[0];
	return explicit || implicitRole(el);
}

const NAMED_BY_CONTENT = new Set([
	"a",
	"button",
	"summary",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"label",
	"option",
	"legend",
	"caption",
	"th",
	"td",
	"li",
]);

/** The accessible name; `fromContent: false` leaves out names taken from the text inside. */
export function accessibleName(
	el: Element,
	fromContent = true,
): string | undefined {
	const label = el.getAttribute("aria-label");
	if (label?.trim()) return normalizeText(label);
	const labelledBy = el.getAttribute("aria-labelledby");
	if (labelledBy) {
		const root = el.getRootNode() as Document | ShadowRoot;
		const text = labelledBy
			.split(/\s+/)
			.map((id) => {
				const target = root.getElementById(id);
				return target === null || isEditable(target) ? "" : pageText(target);
			})
			.join(" ");
		if (text.trim()) return normalizeText(text);
	}
	const tag = el.localName;
	if (tag === "img" || (tag === "input" && el.getAttribute("type") === "image"))
		return normalizeText(el.getAttribute("alt")) || undefined;
	if (tag === "input" || tag === "select" || tag === "textarea") {
		const labels = (el as HTMLInputElement).labels;
		const fromLabel = labels?.[0] ? labelText(labels[0], el) : "";
		if (fromLabel) return fromLabel;
		const type = el.getAttribute("type")?.toLowerCase();
		if (type === "submit" || type === "button" || type === "reset")
			return normalizeText(el.getAttribute("value")) || undefined;
		const placeholder = el.getAttribute("placeholder");
		if (placeholder?.trim()) return normalizeText(placeholder);
	}
	if (
		fromContent &&
		(NAMED_BY_CONTENT.has(tag) || el.getAttribute("role") === "button")
	) {
		const text = normalizeText(pageText(el));
		if (text) return text;
	}
	const title = el.getAttribute("title");
	return title?.trim() ? normalizeText(title) : undefined;
}

/** A label's text without its control or any other field inside it. */
function labelText(label: Element, control: Element): string {
	return normalizeText(pageText(label, { skip: control }));
}

/**
 * What holds a heading of its own: a section, a card. A heading inside one
 * is that part's, not the title of what follows the part (DEC-047).
 */
const CONTAINERS =
	"article, section, aside, nav, dialog, li, [role=article], [role=region], [role=dialog], [role=listitem], [role=group]";
/** A class that names a card, a tile or a panel (`pp-card`, `ProductTile_root`). */
const CARD_CLASS = /(?:^|[-_])(?:card|tile|panel)(?:$|[-_])/i;

function isContainer(el: Element): boolean {
	if (el.matches(CONTAINERS)) return true;
	for (const name of el.classList) if (CARD_CLASS.test(name)) return true;
	return false;
}

/** Sections and cards around elements, found once per page's scan. */
export type ContainerCache = WeakMap<Element, Element | null>;

/**
 * The closest section or card at `x` or around it, within the document
 * (`null`: none, below `body`). Remembered for every element on the way
 * (DEC-047): a scan of a page asks for the same ones over and over.
 */
function containerAt(x: Element | null, cache: ContainerCache): Element | null {
	const path: Element[] = [];
	let found: Element | null = null;
	for (let at = x; at !== null; at = at.parentElement) {
		if (at.localName === "body" || at.localName === "html") break;
		const known = cache.get(at);
		if (known !== undefined) {
			found = known;
			break;
		}
		if (isContainer(at)) {
			found = at;
			cache.set(at, at);
			break;
		}
		path.push(at);
	}
	for (const at of path) cache.set(at, found);
	return found;
}

/** The closest section or card around `el`, not `el`; within the document. */
const containerOf = (el: Element, cache: ContainerCache) =>
	containerAt(el.parentElement, cache) ?? undefined;

/** `h` is the title of `scope` itself, not of a part inside it that `at` is not in. */
function ownedBy(
	h: Element,
	at: Element,
	scope: Element,
	cache: ContainerCache,
): boolean {
	for (
		let x = containerAt(h.parentElement, cache);
		x !== null && x !== scope;
		x = containerAt(x.parentElement, cache)
	)
		if (!x.contains(at)) return false;
	return true;
}

/**
 * How many headings the search for a section's title looks at, before and
 * after the element: on a page of hundreds of headings in one card it gives
 * up, with the nearest heading before as before (DEC-047).
 */
const HEADING_STEPS = 64;

/** The index of the nearest heading before `at` in document order; -1: none. */
function headingBefore(at: Element, headings: readonly Element[]): number {
	let lo = 0;
	let hi = headings.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const h = headings[mid] as Element;
		const precedes =
			h !== at &&
			!h.contains(at) &&
			(h.compareDocumentPosition(at) & 4) /* FOLLOWING */ !== 0;
		if (precedes) {
			found = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return found;
}

const headingText = (h: Element | undefined) =>
	h === undefined ? undefined : normalizeText(pageText(h)) || undefined;

/**
 * The heading `el` is under (DEC-047): the title of the closest section or
 * card around it, before it or, when nothing in it comes before (a badge, a
 * picture), the first after it (not for a heading, whose sub-headings come
 * after it); up through the sections around that. In a section, a heading
 * of another card or section inside it is not one. Under none, or when the
 * search gives up, the nearest heading before `el` in document order, as
 * before. Never `el` or one around it.
 */
export function headingAbove(
	el: Element,
	headings: readonly Element[],
	cache: ContainerCache = new WeakMap(),
): string | undefined {
	return headingsOf(el, headings, cache).heading;
}

/**
 * The heading `el` is under now (`headingAbove`), and the heading by the rule
 * before DEC-047 (the nearest before it in document order), from one search.
 */
export function headingsOf(
	el: Element,
	headings: readonly Element[],
	cache: ContainerCache = new WeakMap(),
): { heading: string | undefined; before: string | undefined } {
	// Order only holds between elements of the document, not of a shadow root.
	const at = inDocument(el);
	const found = headingBefore(at, headings);
	const before = headingText(headings[found]);
	const done = (h: Element | undefined) => ({
		heading: h === headings[found] ? before : headingText(h),
		before,
	});
	const isHeading = at.matches(HEADINGS);
	let steps = 0;
	let scope = containerOf(at, cache);
	let i = found;
	for (;;) {
		// Under no section or card: the nearest heading before it, as ever.
		if (scope === undefined) return done(headings[i]);
		// Before it, within the scope.
		for (; i >= 0; i--) {
			if (++steps > HEADING_STEPS) return done(headings[found]);
			const h = headings[i] as Element;
			if (!scope.contains(h)) break;
			if (ownedBy(h, at, scope, cache)) return done(h);
		}
		// Nothing before it in the scope: the scope's own title after it.
		if (!isHeading)
			for (let j = found + 1; j < headings.length; j++) {
				if (++steps > HEADING_STEPS) return done(headings[found]);
				const h = headings[j] as Element;
				if (!scope.contains(h)) break;
				if (h === at || h.contains(at)) continue;
				if (ownedBy(h, at, scope, cache)) return done(h);
			}
		scope = containerOf(scope, cache);
	}
}

/**
 * The heading before `el` by the rule before DEC-047 (the nearest before it
 * in document order): what a mark stored then says, to compare it with.
 */
export function legacyHeading(
	el: Element,
	headings: readonly Element[],
): string | undefined {
	return headingText(headings[headingBefore(inDocument(el), headings)]);
}

export function landmarkOf(el: Element): string | undefined {
	const landmark = closestAcross(el, LANDMARKS);
	if (landmark === null) return undefined;
	const role = roleOf(landmark) ?? landmark.localName;
	const name =
		landmark.localName === "form" ? undefined : accessibleName(landmark);
	return name ? `${role}: ${name}` : role;
}

function step(el: Element): string {
	const testId = testIdOf(el);
	if (testId) return `${el.localName}[${testId}]`;
	const cls = readableClasses(el.getAttribute("class") ?? "")[0];
	return cls ? `${el.localName}.${cls}` : el.localName;
}

export function ancestorsOf(el: Element, depth = 6): string[] {
	const out: string[] = [];
	let at = parentOf(el);
	while (at !== null && out.length < depth) {
		if (at.localName === "body" || at.localName === "html") break;
		out.push(step(at));
		at = parentOf(at);
	}
	return out;
}

const ATTRIBUTE_LIMIT = 300;

/** A URL of the page: `data:` keeps its type only, others are resolved. */
function url(value: string, el: Element): URL | undefined {
	try {
		return new URL(value, el.ownerDocument.baseURI);
	} catch {
		return undefined;
	}
}

/**
 * The fragment of a link `u` that names a place of this page (DEC-047): a
 * hash route of this site, or the id of an element of the page when the
 * link goes to the page itself (`base`). Otherwise nothing.
 */
function placeOnPage(u: URL, base: URL | undefined, el: Element): string {
	// Another site's fragment names no place of this page, a route neither.
	if (u.hash.length < 2 || base === undefined || u.origin !== base.origin)
		return "";
	const route = hashRoute(u.hash);
	if (route) return route;
	if (u.pathname !== base.pathname) return "";
	if (u.search !== base.search) return "";
	let id: string;
	try {
		id = decodeURIComponent(u.hash.slice(1));
	} catch {
		return "";
	}
	return el.ownerDocument.getElementById(id) === null ? "" : u.hash;
}

const kept = (value: string) => value;

/**
 * The attributes recorded, each through its rule; an attribute without a rule
 * here is never recorded. `undefined` leaves it out.
 */
export const ATTRIBUTE_RULES: Record<
	(typeof ELEMENT_ATTRIBUTES)[number],
	(value: string, el: Element) => string | undefined
> = {
	name: kept,
	type: kept,
	placeholder: kept,
	alt: kept,
	title: kept,
	/**
	 * The path (with the host for other sites); never the query. The
	 * fragment only where it names a place of this page (DEC-047): an element
	 * of it, by its id (`#book`), on a link to the page itself; or a hash
	 * route (`#/cart`), up to its parameters. Any other can carry a token.
	 */
	href(value, el) {
		const u = url(value, el);
		if (u === undefined) return undefined;
		if (u.protocol === "data:")
			return `data:${u.pathname.split(/[;,]/)[0] ?? ""}`;
		if (u.protocol !== "http:" && u.protocol !== "https:")
			return `${u.protocol}`;
		const base = url(el.ownerDocument.baseURI, el);
		const own = base?.origin === u.origin;
		const path = own ? u.pathname : `${u.host}${u.pathname}`;
		return `${path}${placeOnPage(u, base, el)}`;
	},
	/** The file name only. */
	src(value, el) {
		const u = url(value, el);
		if (u === undefined) return undefined;
		if (u.protocol === "data:")
			return `data:${u.pathname.split(/[;,]/)[0] ?? ""}`;
		return u.pathname.split("/").pop() || undefined;
	},
};

function attributesOf(el: Element): Record<string, string> {
	const out: Record<string, string> = {};
	for (const name of ELEMENT_ATTRIBUTES) {
		const value = el.getAttribute(name);
		if (value === null || value === "") continue;
		const recorded = ATTRIBUTE_RULES[name](value, el);
		if (recorded) out[name] = recorded.slice(0, ATTRIBUTE_LIMIT);
	}
	return out;
}

export function escapeCss(value: string): string {
	return typeof CSS !== "undefined" && typeof CSS.escape === "function"
		? CSS.escape(value)
		: value.replace(/[^A-Za-z0-9_-]/g, (c) => `\\${c}`);
}

const SELECTOR_LIMIT = 2000;

/** `selector` fits a case and finds `el` and nothing else. */
function findsOnly(el: Element, selector: string): boolean {
	if (selector.length > SELECTOR_LIMIT) return false;
	try {
		const all = el.ownerDocument.querySelectorAll(selector);
		return all.length === 1 && all[0] === el;
	} catch {
		return false;
	}
}

/** A selector for one element: stable attributes first, a path as the last resort. */
function ownSelector(el: Element): string[] {
	const out: string[] = [];
	for (const name of TEST_ID_ATTRIBUTES) {
		const value = el.getAttribute(name);
		if (value) out.push(`[${name}="${value.replace(/["\\]/g, "\\$&")}"]`);
	}
	const id = el.getAttribute("id");
	if (id && !isGeneratedId(id)) out.push(`#${escapeCss(id)}`);
	const classes = (el.getAttribute("class") ?? "")
		.split(/\s+/)
		.map((name) => ({ name, readable: readableClass(name) }))
		.filter((c) => c.readable !== undefined);
	if (classes.length > 0) {
		const parts = classes
			.slice(0, 2)
			.map((c) =>
				c.readable === c.name
					? `.${escapeCss(c.name)}`
					: `[class*="${(c.readable as string).replace(/["\\]/g, "\\$&")}"]`,
			)
			.join("");
		out.push(`${el.localName}${parts}`);
	}
	return out;
}

export function cssSelector(el: Element): string {
	// No selector reaches from the document into a shadow root.
	if (hostOf(el) !== null) return "";
	for (const candidate of ownSelector(el))
		if (findsOnly(el, candidate)) return candidate;
	const path: string[] = [];
	let at: Element | null = el;
	while (at !== null && at.localName !== "html") {
		// Ten levels do, unless the subtree around the element repeats.
		if (path.length >= 10 && findsOnly(el, path.join(" > "))) break;
		const current: Element = at;
		const own = path.length === 0 ? [] : ownSelector(current);
		const anchor = own.find((s) => findsOnly(current, s));
		if (anchor !== undefined) {
			path.unshift(anchor);
			break;
		}
		const parent: Element | null = at.parentElement;
		const same = parent
			? [...parent.children].filter((c) => c.localName === at?.localName)
			: [];
		path.unshift(
			same.length > 1
				? `${at.localName}:nth-of-type(${same.indexOf(at) + 1})`
				: at.localName,
		);
		at = parent;
	}
	const selector = path.join(" > ");
	return findsOnly(el, selector) ? selector : "";
}

export function documentRect(
	el: Element,
	scroll: { x: number; y: number },
): Rect {
	const r = el.getBoundingClientRect();
	const round = (v: number) => Math.round(v * 10) / 10;
	return {
		x: round(r.x + scroll.x),
		y: round(r.y + scroll.y),
		width: round(r.width),
		height: round(r.height),
	};
}

/** The limits of the table above that the page's markup could exceed. */
export const LIMITS = {
	tag: 64,
	testId: 300,
	role: 64,
	landmark: 200,
	ancestor: 300,
} as const;

/**
 * Details cut to `LIMITS`. Every description goes through this, and so does a
 * stored element before it is compared: a case from before these limits holds
 * longer values, and a cut value only equals a value cut the same way.
 */
export function withinLimits(details: ElementDetails): ElementDetails {
	const out: ElementDetails = {
		...details,
		tag: details.tag.slice(0, LIMITS.tag),
		ancestors: details.ancestors.map((a) => a.slice(0, LIMITS.ancestor)),
	};
	if (details.testId) out.testId = details.testId.slice(0, LIMITS.testId);
	if (details.role) out.role = details.role.slice(0, LIMITS.role);
	if (details.landmark)
		out.landmark = details.landmark.slice(0, LIMITS.landmark);
	return out;
}

/** Everything Sitegloss records about an element. */
export function describeElement(
	el: Element,
	context: DescribeContext = createContext(el.ownerDocument),
	/** Leave the selector out (it is slow): for scoring many candidates. */
	options: { selector?: boolean } = {},
): ElementDetails {
	const details: ElementDetails = {
		tag: el.localName,
		classes: readableClasses(el.getAttribute("class") ?? ""),
		attributes: attributesOf(el),
		ancestors: ancestorsOf(el),
		rect: documentRect(el, context.scroll),
		page: context.page,
		selector: options.selector === false ? "" : cssSelector(el),
	};
	const id = el.getAttribute("id");
	if (id && !isGeneratedId(id)) details.id = id;
	const testId = testIdOf(el);
	if (testId) details.testId = testId;
	const role = roleOf(el);
	if (role) details.role = role;
	const editable = isEditable(el);
	const name = accessibleName(el, !editable);
	if (name) details.name = name;
	const text = editable ? "" : normalizeText(pageText(el));
	if (text) details.text = text;
	context.containers ??= new WeakMap();
	const headings = headingsOf(el, context.headings, context.containers);
	if (headings.heading) details.heading = headings.heading;
	const landmark = landmarkOf(el);
	if (landmark) details.landmark = landmark;
	const out = withinLimits(details);
	// A candidate on a page also says the heading by the rule before
	// DEC-047, for marks stored then (match.ts); never stored.
	if (
		options.selector === false &&
		headings.before !== undefined &&
		headings.before !== out.heading
	)
		out.headingBefore = headings.before;
	return out;
}

/** A one-line summary, e.g. `button "Prämien berechnen" · Button_primary · under "Krankenkassen vergleichen"`. */
export function summarize(details: ElementDetails): string {
	const parts = [
		details.role && details.role !== details.tag
			? `${details.tag} (${details.role})`
			: details.tag,
	];
	if (details.name) parts[0] += ` "${details.name.slice(0, 60)}"`;
	else if (details.text) parts[0] += ` "${details.text.slice(0, 60)}"`;
	if (details.testId) parts.push(`test id ${details.testId}`);
	if (details.classes.length > 0)
		parts.push(details.classes.slice(0, 3).join(" "));
	if (details.heading) parts.push(`under "${details.heading.slice(0, 50)}"`);
	return parts.join(" · ");
}

const cutText = (value: string, max: number): string =>
	value.length <= max ? value : `${value.slice(0, max)}…`;

/** A mark's recorded computed styles in one line (DEC-048): `color: rgb(…); font-size: 14px`. */
export function stylesLine(styles: Record<string, string>): string {
	return cutText(
		Object.entries(styles)
			.map(([name, value]) => `${name}: ${cutText(value, 120)}`)
			.join("; "),
		2000,
	);
}

/** The colour behind an element in words (DEC-048): `rgb(255, 255, 255), 2 up`. */
export function backdropLine(backdrop: Backdrop): string {
	const where =
		backdrop.depth !== undefined
			? backdrop.depth === 0
				? "the element's own"
				: `${backdrop.depth} up`
			: parseColor(backdrop.color) === undefined
				? "as the browser gives it, not composited"
				: "no opaque background up to the page: over its canvas, as its colour scheme gives it";
	return `${backdrop.color}, ${where}${backdrop.image ? "; a background image or gradient on the way may show instead" : ""}`;
}

const rounded = (v: number) => Math.round(v * 100) / 100;

/** A sibling's box in a line (DEC-048): `-1 button 96×40 at 24, 310`. */
export function siblingLine(sibling: SiblingBox): string {
	const r = sibling.rect;
	return `${sibling.offset > 0 ? "+" : ""}${sibling.offset} ${sibling.tag} ${rounded(r.width)}×${rounded(r.height)} at ${rounded(r.x)}, ${rounded(r.y)}`;
}

/**
 * The text colour on the colour behind, with their WCAG contrast where it
 * holds, else why there is none (DEC-048). Never a ratio known not to hold:
 * none at the element's own opacity below 1 (what is recorded does not
 * keep its own background apart from what lies behind it, so the blend
 * cannot be worked out), none without an opaque background found (the
 * canvas colour is the browser's, not reported), none for a colour this
 * does not read, none when the walk found a filter, a blend mode or an
 * ancestor's opacity (then no backdrop is recorded).
 */
function colours(details: ElementDetails): string | undefined {
	const s = details.styles ?? {};
	const color = s["color"];
	const backdrop = details.backdrop;
	if (color === undefined && backdrop === undefined) return undefined;
	if (backdrop === undefined)
		return `${color}; no contrast ratio: the colour behind it is not known (a filter, a blend mode or an ancestor's opacity changes what shows, which is not worked out)`;
	if (color === undefined) return `on ${backdrop.color}`;
	const pair = `${color} on ${backdrop.color}`;
	const opacity = Number.parseFloat(s["opacity"] ?? "1");
	if (Number.isFinite(opacity) && opacity < 1)
		return `${pair}; no contrast ratio: the element is drawn at opacity ${s["opacity"]}, paler than these colours, and what lies behind its own background is not recorded`;
	if (
		parseColor(color) === undefined ||
		parseColor(backdrop.color) === undefined
	)
		return `${pair}; no contrast ratio: a colour in a form this does not work out`;
	if (backdrop.depth === undefined)
		return `${pair}; no contrast ratio: no opaque background up to the page, and the canvas colour is the browser's (taken from the page's colour scheme, not reported)`;
	const ratio = contrastRatio(color, backdrop.color);
	if (ratio === undefined) return pair;
	return `${pair}, contrast ${ratio.toFixed(2)}:1${backdrop.image ? " (a background image or gradient may show instead)" : ""}`;
}

/**
 * The few values of a mark's look an AI reads first (DEC-048), in a line:
 * `rgb(170, 170, 170) on rgb(255, 255, 255), contrast 2.32:1 · 14px/20px 600 "Inter" · inline-flex`.
 * Undefined when nothing was recorded.
 */
export function lookSummary(details: ElementDetails): string | undefined {
	const s = details.styles ?? {};
	const parts: string[] = [];
	const pair = colours(details);
	if (pair !== undefined) parts.push(pair);
	const size = s["font-size"];
	const font = [
		size === undefined
			? undefined
			: `${size}${s["line-height"] === undefined ? "" : `/${s["line-height"]}`}`,
		s["font-weight"],
		s["font-family"]?.split(",")[0]?.trim(),
	].filter((v): v is string => v !== undefined && v !== "");
	if (font.length > 0) parts.push(font.join(" "));
	if (s["display"] !== undefined) parts.push(s["display"]);
	return parts.length > 0 ? cutText(parts.join(" · "), 400) : undefined;
}
