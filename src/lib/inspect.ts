/**
 * Reading one element of the live page for an AI app (`get_mark_element`):
 * its markup, box, computed styles, the CSS rules that match it, and the
 * elements around it, so the app can explain a layout fault from the page
 * itself rather than from pixels. Nothing here is stored in a case, and
 * nothing changes the page.
 *
 * What leaves the page follows the rules of the recorded details (DEC-009,
 * DEC-013):
 * - No field value and no typed text: form fields keep only the attributes of
 *   `FIELD_ATTRIBUTES` (never `value`, `checked` or `selected`), and the
 *   content of text areas, selects and editable regions is left out.
 * - No query string, fragment, user name or password of a URL, found by the
 *   attribute's name and by its value, also inside longer values and CSS
 *   `url()`s; another scheme than http(s) keeps only the scheme, `data:` its
 *   type.
 * - Nothing of the head, and no head-only element (`NOT_CONTENT`) is read.
 *   Comments, hidden subtrees, the content of scripts, styles, `noscript`,
 *   `template` and `srcdoc`, inline event handlers' code, and the values of
 *   attributes (and meta tags) named like a secret are left out.
 * - Everything is capped: the markup (`LIMITS.html`), each text and attribute,
 *   the rules and their declarations, ancestors and children.
 */

import {
	EDITORS,
	isEditable,
	normalizeText,
	pageText,
	TEST_ID_ATTRIBUTES,
} from "./element.ts";
import { listedRule, selectorVocabularyProblem } from "./selector.ts";
import { closestAcross, hostOf, parentOf, shadowOf } from "./shadow.ts";

export const LIMITS = {
	/** Characters of markup. */
	html: 16_000,
	text: 300,
	attribute: 200,
	style: 500,
	url: 300,
	rules: 30,
	/** Characters of one rule's declarations. */
	declarations: 800,
	/** Characters of all rules' selectors and declarations together. */
	ruleChars: 16_000,
	selector: 300,
	/** Style rules looked at, at most: a page can have tens of thousands. */
	scannedRules: 30_000,
	/** The markup again, for a relay with a small message limit. */
	shortHtml: 4000,
	ancestors: 4,
	children: 12,
	classes: 10,
	className: 80,
} as const;

/** Attributes a form field keeps; none of them holds what was typed or chosen. */
export const FIELD_ATTRIBUTES = new Set([
	"id",
	"class",
	"name",
	"type",
	"placeholder",
	"disabled",
	"readonly",
	"required",
	"multiple",
	"min",
	"max",
	"step",
	"minlength",
	"maxlength",
	"pattern",
	"size",
	"rows",
	"cols",
	"wrap",
	"autocomplete",
	"inputmode",
	"enterkeyhint",
	"form",
	"list",
	"accept",
	"role",
	"style",
	"tabindex",
	"hidden",
	"title",
	"dir",
	"lang",
	"spellcheck",
	...TEST_ID_ATTRIBUTES,
]);

/** `aria-valuenow` and `aria-valuetext` can mirror a field's value. */
const fieldKeeps = (name: string) =>
	FIELD_ATTRIBUTES.has(name) ||
	(name.startsWith("aria-") && !name.startsWith("aria-value"));

const FIELDS = new Set(["input", "textarea", "select"]);

/** Attributes holding one URL. */
const URL_ATTRIBUTES = new Set([
	"href",
	"src",
	"action",
	"formaction",
	"poster",
	"cite",
	"data",
	"background",
	"manifest",
	"ping",
	"xlink:href",
	"longdesc",
	"codebase",
]);

/**
 * Their content is no page content (the head's meta tags can hold tokens);
 * the element itself stays.
 */
const EMPTIED = new Set(["head", "script", "style", "noscript", "template"]);

/** Attributes whose name says they hold a secret keep no value. */
const SECRET =
	/token|csrf|xsrf|secret|session|auth(?!or)|passw|api-?key|signature/i;

const VOID = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"source",
	"track",
	"wbr",
]);

const cut = (value: string, max: number) =>
	value.length > max ? `${value.slice(0, max)}…` : value;

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * A URL without its query string and fragment (marked `?…`, `#…`) and
 * without a user name or password. Of another scheme than http(s) only the
 * scheme stays (`mailto:…`), of `data:` its type.
 */
export function cleanUrl(value: string): string {
	const v = value.trim();
	const scheme = SCHEME.exec(v)?.[1]?.toLowerCase();
	if (scheme === undefined && !v.startsWith("//")) {
		// Relative: no user name, no host; only the query and fragment go.
		const at = v.search(/[?#]/);
		return cut(at < 0 ? v : `${v.slice(0, at)}${v[at]}…`, LIMITS.url);
	}
	if (scheme === "data") return `data:${v.slice(5).split(/[;,]/)[0] ?? ""}…`;
	let u: URL;
	try {
		u = new URL(v, "https://base.invalid/");
	} catch {
		// Not an address.
		return "…";
	}
	if (u.protocol !== "http:" && u.protocol !== "https:")
		return `${u.protocol}…`;
	const marks = `${u.search === "" ? "" : "?…"}${u.hash === "" ? "" : "#…"}`;
	const prefix = scheme === undefined ? "//" : `${u.protocol}//`;
	return cut(`${prefix}${u.host}${u.pathname}${marks}`, LIMITS.url);
}

/**
 * A value that is a URL: absolute, protocol- or root-relative, of a scheme
 * such as `mailto:`, or a path with a query or fragment (`img/a.png?sig=…`).
 */
export function looksLikeUrl(value: string): boolean {
	const v = value.trim();
	if (v === "" || /\s/.test(v)) return false;
	if (
		/^(?:[a-z][a-z0-9+.-]*:\/\/|\/|(?:mailto|tel|sms|callto|javascript|vbscript|data|blob|file):)/i.test(
			v,
		)
	)
		return true;
	const at = v.search(/[?#]/);
	const path = v.slice(0, at);
	return at > 0 && /^[\w.~%@:+/-]+$/.test(path) && /[/.]/.test(path);
}

/** Absolute URLs inside a longer value (JSON, a list) cleaned. */
function cleanUrlsIn(value: string): string {
	return value.replace(/\bhttps?:\/\/[^\s"'<>()\\]+/gi, (url) => cleanUrl(url));
}

/** Every `url(…)` in CSS text cleaned like `cleanUrl`. */
export function cleanCssUrls(css: string): string {
	return css.replace(
		/url\(\s*(['"]?)(.*?)\1\s*\)/gi,
		(_all, quote: string, url: string) =>
			`url(${quote}${cleanUrl(url)}${quote})`,
	);
}

function cleanSrcset(value: string): string {
	return value
		.split(",")
		.map((candidate) => {
			const [url = "", ...descriptor] = candidate.trim().split(/\s+/);
			return [cleanUrl(url), ...descriptor].join(" ");
		})
		.join(", ");
}

/** `data-src`, `data-href`, `data-bg-url`, … */
const DATA_URL = /^data-.*(src|href|url|link|bg|background|image|img|poster)/i;

/** A meta tag's name that says its content is a secret. */
function secretMeta(el: Element): boolean {
	return ["name", "property", "http-equiv", "itemprop"].some((a) =>
		SECRET.test(el.getAttribute(a) ?? ""),
	);
}

/** An attribute's value as it may leave the page, or `undefined` to drop it. */
export function attributeValue(
	el: Element,
	name: string,
	value: string,
): string | undefined {
	if (FIELDS.has(el.localName) && !fieldKeeps(name)) return undefined;
	// What a select offers to choose, and what was chosen.
	if (el.localName === "option" && (name === "value" || name === "selected"))
		return undefined;
	if (name === "nonce") return undefined;
	const gone = value === "" ? "" : "…";
	// A whole document of its own.
	if (name === "srcdoc") return gone;
	if (SECRET.test(name)) return gone;
	// The handler's code is the page's, and may hold anything.
	if (name.startsWith("on")) return gone;
	if (el.localName === "meta" && name === "content" && secretMeta(el))
		return gone;
	if (name.endsWith("srcset")) return cut(cleanSrcset(value), LIMITS.url);
	if (URL_ATTRIBUTES.has(name) || DATA_URL.test(name)) return cleanUrl(value);
	if (name === "style") return cut(cleanCssUrls(value), LIMITS.style);
	if (name === "id" || name === "class") return cut(value, LIMITS.attribute);
	if (looksLikeUrl(value)) return cleanUrl(value);
	return cut(cleanUrlsIn(value), LIMITS.attribute);
}

const escapeText = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Where somebody types or chooses: what is inside is theirs. */
function holdsInput(el: Element): boolean {
	return (el as HTMLElement).isContentEditable === true || el.matches(EDITORS);
}

/** Inside an editor, a text area or a select: typed or chosen content. */
function inInput(el: Element): boolean {
	return isEditable(el) || closestAcross(el, "textarea, select") !== null;
}

/**
 * Inside an editor, a text area or a select, not the field itself: what is
 * there was typed or chosen, so no selector names it (CR-01).
 */
export function insideInput(el: Element): boolean {
	const parent = parentOf(el);
	return parent !== null && inInput(parent);
}

function openTag(el: Element): string {
	let out = `<${el.localName}`;
	for (const attr of el.attributes) {
		const value = attributeValue(el, attr.name, attr.value);
		if (value === undefined) continue;
		out +=
			value === ""
				? ` ${attr.name}`
				: ` ${attr.name}="${escapeAttribute(value)}"`;
	}
	return `${out}>`;
}

/** How many elements `nodes` hold, themselves included. */
function countElements(nodes: Iterable<Node>): number {
	let n = 0;
	for (const node of nodes)
		if (node.nodeType === 1)
			n += 1 + (node as Element).querySelectorAll("*").length;
	return n;
}

export const LEFT_OUT_INPUT =
	"<!-- sitegloss: content left out (form field or editable region) -->";
const leftOut = (n: number) =>
	`<!-- sitegloss: ${n} more element${n === 1 ? "" : "s"} left out (size limit) -->`;

export interface Markup {
	html: string;
	/** Elements left out at the size limit. */
	leftOut: number;
	/** Hidden elements left out (`display: none`, `visibility: hidden`), inside ones included. */
	hidden: number;
}

/** Not rendered, or rendered invisible: such content is no part of the view. */
export function isHidden(el: Element): boolean {
	const style = el.ownerDocument.defaultView?.getComputedStyle(el);
	if (style === undefined || style === null) return false;
	return (
		style.getPropertyValue("display") === "none" ||
		["hidden", "collapse"].includes(style.getPropertyValue("visibility"))
	);
}

const HIDDEN_NOTE = (tag: string) =>
	`<!-- sitegloss: hidden ${tag} left out -->`;

/** A node written whole, in part (the limit was reached inside), or not at all. */
type Written = "whole" | "part" | "none";

/**
 * The outer HTML of `el` as it may leave the page (see the top of this file),
 * at most about `max` characters, well formed also when cut. Open shadow
 * roots and, from an extension, closed ones come as `<template
 * shadowrootmode>`. `skip` leaves out an element (Sitegloss's own overlay).
 * The only comments are Sitegloss's own.
 */
export function markupOf(
	el: Element,
	options: { max?: number; skip?: Element } = {},
): Markup {
	const max = options.max ?? LIMITS.html;
	let out = "";
	let dropped = 0;
	let hidden = 0;
	// The closing tags still to come count against the limit.
	let closing = 0;
	const fits = (s: string) => out.length + s.length + closing <= max;
	const typedRoot = inInput(el);

	const note = (n: number) => {
		dropped += n;
		if (n > 0) out += leftOut(n);
	};

	/** Write `nodes`; false once the limit is reached. */
	const writeAll = (nodes: Iterable<Node>): boolean => {
		const list = [...nodes];
		for (let i = 0; i < list.length; i++) {
			const done = write(list[i] as Node);
			if (done === "whole") continue;
			note(countElements(list.slice(done === "part" ? i + 1 : i)));
			return false;
		}
		return true;
	};

	const write = (node: Node): Written => {
		if (node.nodeType === 3) {
			const text = escapeText(
				cut((node.nodeValue ?? "").replace(/\s+/g, " "), LIMITS.text),
			);
			if (fits(text)) {
				out += text;
				return "whole";
			}
			out += "…";
			return "part";
		}
		if (node.nodeType !== 1) return "whole"; // comments, processing instructions
		const e = node as Element;
		if (e === options.skip) return "whole";
		const name = e.localName;
		if (e !== el && !EMPTIED.has(name) && isHidden(e)) {
			const note = HIDDEN_NOTE(name);
			if (!fits(note)) return "none";
			out += note;
			hidden += countElements([e]);
			return "whole";
		}
		const open = openTag(e);
		const close = VOID.has(name) ? "" : `</${name}>`;
		if (!fits(open + close)) return "none";
		out += open;
		if (close === "") return "whole";
		closing += close.length;
		let whole = true;
		if (EMPTIED.has(name) || name === "iframe") {
			// Nothing inside: code, styles, another document.
		} else if (holdsInput(e) || (e === el && typedRoot)) {
			// Also when empty: an editor's emptiness is what was typed.
			out += LEFT_OUT_INPUT;
		} else if (e === el && isHidden(e)) {
			if (e.firstChild !== null) out += HIDDEN_NOTE("element's content");
			hidden += countElements(e.childNodes);
		} else {
			const root = shadowOf(e);
			if (root !== null) {
				const tag = `<template shadowrootmode="${root.mode}">`;
				if (fits(`${tag}</template>`)) {
					out += tag;
					closing += 11;
					whole = writeAll(root.childNodes);
					closing -= 11;
					out += "</template>";
				} else {
					note(countElements(root.childNodes));
					whole = false;
				}
			}
			if (whole) whole = writeAll(e.childNodes);
			else note(countElements(e.childNodes));
		}
		closing -= close.length;
		out += close;
		return whole ? "whole" : "part";
	};

	if (write(el) === "none") note(countElements([el]));
	return { html: out, leftOut: dropped, hidden };
}

/** One computed style property's value. */
export type StyleOf = (property: string) => string;

/** Which properties to report: all of them, the layout ones, or a child's. */
export type StyleSet = "full" | "layout" | "child";

/**
 * Values that say nothing: a property equal to one of these is left out.
 * The properties without an entry (display, position, box-sizing, width,
 * height, fonts, colour) are always reported in the full set.
 */
const INITIAL: Record<string, readonly string[]> = {
	top: ["auto"],
	right: ["auto"],
	bottom: ["auto"],
	left: ["auto"],
	float: ["none"],
	"min-width": ["auto", "0px"],
	"min-height": ["auto", "0px"],
	"max-width": ["none"],
	"max-height": ["none"],
	"flex-direction": ["row"],
	"flex-wrap": ["nowrap"],
	"justify-content": ["normal"],
	"align-items": ["normal"],
	"align-content": ["normal"],
	"justify-items": ["normal", "legacy"],
	"grid-template-columns": ["none"],
	"grid-template-rows": ["none"],
	"grid-template-areas": ["none"],
	"grid-auto-flow": ["row"],
	"grid-auto-columns": ["auto"],
	"grid-auto-rows": ["auto"],
	"flex-grow": ["0"],
	"flex-shrink": ["1"],
	"flex-basis": ["auto"],
	order: ["0"],
	"align-self": ["auto"],
	"justify-self": ["auto"],
	"grid-column-start": ["auto"],
	"grid-column-end": ["auto"],
	"grid-row-start": ["auto"],
	"grid-row-end": ["auto"],
	"z-index": ["auto"],
	opacity: ["1"],
	transform: ["none"],
	visibility: ["visible"],
	"pointer-events": ["auto"],
	"aspect-ratio": ["auto"],
	"background-color": ["rgba(0, 0, 0, 0)", "transparent"],
	"background-image": ["none"],
	"box-shadow": ["none"],
	"text-align": ["start"],
	"white-space": ["normal"],
	"text-overflow": ["clip"],
	"vertical-align": ["baseline"],
	"letter-spacing": ["normal"],
};

const SIDES = ["top", "right", "bottom", "left"] as const;
const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];

/** `a b c d` as CSS writes it shortest. */
function sides(values: readonly string[]): string {
	const [t, r, b, l] = values;
	if (t === r && t === b && t === l) return t ?? "";
	if (t === b && r === l) return `${t} ${r}`;
	if (r === l) return `${t} ${r} ${b}`;
	return values.join(" ");
}

const isZero = (v: string) => v === "0px" || v === "0";

const FLEX = /\bflex\b|inline-flex/;
const GRID = /\bgrid\b|inline-grid/;

/**
 * The properties that explain how an element sits and looks, read through
 * `get`, without those at their initial value. Sides and corners come
 * together (`margin: 0px 16px`). `parentDisplay` adds the flex or grid
 * item's properties.
 */
export function pickStyles(
	get: StyleOf,
	options: { set?: StyleSet; parentDisplay?: string } = {},
): Record<string, string> {
	const set = options.set ?? "full";
	const out: Record<string, string> = {};
	const value = (p: string) => cleanCssUrls(get(p).trim());
	const put = (p: string, always = false) => {
		const v = value(p);
		if (v === "") return;
		if (!always && INITIAL[p]?.includes(v)) return;
		out[p] = cut(v, LIMITS.style);
	};
	const display = value("display");
	const position = value("position");
	out["display"] = display;
	if (set !== "child" || position !== "static") out["position"] = position;
	if (set !== "child") {
		put("box-sizing", true);
		put("width", true);
		put("height", true);
	}
	if (position !== "static") for (const s of SIDES) put(s);
	put("float");
	if (set !== "child")
		for (const p of ["min-width", "min-height", "max-width", "max-height"])
			put(p);
	for (const box of ["margin", "padding"]) {
		const v = SIDES.map((s) => value(`${box}-${s}`));
		if (!v.every(isZero)) out[box] = sides(v);
	}
	const borders = SIDES.map((s) => {
		const width = value(`border-${s}-width`);
		const style = value(`border-${s}-style`);
		if (style === "none" || style === "hidden" || isZero(width)) return "";
		return set === "full"
			? `${width} ${style} ${value(`border-${s}-color`)}`
			: `${width} ${style}`;
	});
	if (borders.every((b) => b === borders[0])) {
		if (borders[0] !== "") out["border"] = borders[0] as string;
	} else
		SIDES.forEach((s, i) => {
			if (borders[i] !== "") out[`border-${s}`] = borders[i] as string;
		});
	const flex = FLEX.test(display);
	const grid = GRID.test(display);
	if (set !== "child") {
		if (flex || grid) {
			const row = value("row-gap");
			const column = value("column-gap");
			if (row !== "normal" || column !== "normal")
				out["gap"] = row === column ? row : `${row} ${column}`;
		}
		if (flex) for (const p of ["flex-direction", "flex-wrap"]) put(p);
		if (grid)
			for (const p of [
				"grid-template-columns",
				"grid-template-rows",
				"grid-template-areas",
				"grid-auto-flow",
				"grid-auto-columns",
				"grid-auto-rows",
				"justify-items",
			])
				put(p);
		if (flex || grid)
			for (const p of ["justify-content", "align-items", "align-content"])
				put(p);
	}
	const parent = options.parentDisplay ?? "";
	if (FLEX.test(parent))
		for (const p of [
			"flex-grow",
			"flex-shrink",
			"flex-basis",
			"order",
			"align-self",
		])
			put(p);
	if (GRID.test(parent))
		for (const p of [
			"grid-column-start",
			"grid-column-end",
			"grid-row-start",
			"grid-row-end",
			"order",
			"align-self",
			"justify-self",
		])
			put(p);
	const overflow = [value("overflow-x"), value("overflow-y")];
	if (overflow.some((o) => o !== "visible"))
		out["overflow"] =
			overflow[0] === overflow[1]
				? (overflow[0] as string)
				: overflow.join(" ");
	for (const p of ["z-index", "opacity", "transform", "visibility"]) put(p);
	if (set === "full") {
		const radius = CORNERS.map((c) => value(`border-${c}-radius`));
		if (!radius.every(isZero)) out["border-radius"] = sides(radius);
		for (const p of [
			"font-family",
			"font-size",
			"font-weight",
			"line-height",
			"color",
		])
			put(p, true);
		for (const p of [
			"letter-spacing",
			"text-align",
			"white-space",
			"text-overflow",
			"vertical-align",
			"background-color",
			"background-image",
			"box-shadow",
			"aspect-ratio",
			"pointer-events",
		])
			put(p);
	}
	return out;
}

/** A CSS rule that matches the element. */
export interface MatchedRule {
	selector: string;
	declarations: string;
	/** The style sheet's URL (cleaned), or `<style> 2` for the page's second `<style>`. */
	sheet: string;
	/** Conditions around the rule, outermost first: `@media (max-width: 600px)`. */
	conditions?: string[];
	/** False when a media or supports condition does not hold now. */
	active?: boolean;
	/** The rule styles this pseudo-element of the element. */
	pseudo?: string;
}

export interface MatchedRules {
	rules: MatchedRule[];
	/** Matching rules left out at the limits (inactive ones first, then the earliest). */
	leftOut: number;
	/** Sheets the page may not read (another origin without CORS). */
	unreadable: string[];
	/** Only part of the page's rules was looked at. */
	truncated?: boolean;
}

/** `a, b:is(c, d)` → `["a", "b:is(c, d)"]`. */
export function splitSelectors(list: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let quote = "";
	let start = 0;
	for (let i = 0; i < list.length; i++) {
		const c = list[i];
		if (quote !== "") {
			if (c === "\\") i++;
			else if (c === quote) quote = "";
		} else if (c === '"' || c === "'") quote = c;
		else if (c === "(" || c === "[") depth++;
		else if (c === ")" || c === "]") depth--;
		else if (c === "," && depth === 0) {
			out.push(list.slice(start, i).trim());
			start = i + 1;
		}
	}
	out.push(list.slice(start).trim());
	return out.filter((s) => s !== "");
}

const PSEUDO_ELEMENT =
	/::?(before|after|marker|placeholder|first-line|first-letter|selection|backdrop|file-selector-button)$/i;

/** Whether `selector` matches `el`, or one of its pseudo-elements (named). */
function matching(
	el: Element,
	selector: string,
): { pseudo?: string } | undefined {
	let pseudo: string | undefined;
	for (const part of splitSelectors(selector)) {
		const m = PSEUDO_ELEMENT.exec(part);
		const plain = m ? part.slice(0, m.index) || "*" : part;
		try {
			if (!el.matches(plain)) continue;
		} catch {
			continue; // A selector this browser does not know, or a relative one.
		}
		if (m === null) return {};
		pseudo ??= `::${(m[1] as string).toLowerCase()}`;
	}
	return pseudo === undefined ? undefined : { pseudo };
}

/** A nested rule's selector against its parent's: `&:hover`, `.child`. */
function nestedSelector(parent: string, own: string): string {
	return splitSelectors(own)
		.map((s) =>
			s.includes("&")
				? s.replaceAll("&", `:is(${parent})`)
				: `:is(${parent}) ${s}`,
		)
		.join(", ");
}

function sheetName(sheet: CSSStyleSheet, styles: readonly Element[]): string {
	if (sheet.href) return cleanUrl(sheet.href);
	const n = styles.findIndex(
		(s) => s === sheet.ownerNode || (s as HTMLStyleElement).sheet === sheet,
	);
	if (n >= 0) return `<style> ${n + 1}`;
	const owner = sheet.ownerNode;
	return owner?.nodeType === 1
		? `<${(owner as Element).localName}>`
		: "constructed style sheet";
}

function holds(test: () => boolean): boolean | undefined {
	try {
		return test();
	} catch {
		// A selector this browser does not know.
		return undefined;
	}
}

/**
 * The style rules of the element's document (or shadow root) that match it,
 * in the order the cascade sees them, at most `LIMITS.rules`; Sitegloss's own
 * overlay has its rules in its own shadow root, so none of them comes along.
 */
export function matchedRules(el: Element): MatchedRules {
	const root = el.getRootNode() as Document | ShadowRoot;
	const win = el.ownerDocument.defaultView;
	const styles = [...root.querySelectorAll("style")];
	const found: MatchedRule[] = [];
	const unreadable: string[] = [];
	let scanned = 0;

	interface Context {
		sheet: string;
		conditions: string[];
		active: boolean;
		parent?: string;
	}

	const walk = (rules: CSSRuleList, at: Context): void => {
		for (const rule of rules) {
			if (++scanned > LIMITS.scannedRules) return;
			const r = rule as CSSRule & {
				selectorText?: string;
				cssRules?: CSSRuleList;
				conditionText?: string;
				styleSheet?: CSSStyleSheet | null;
				style?: CSSStyleDeclaration;
				name?: string;
				media?: MediaList;
			};
			if (r.selectorText !== undefined && r.style !== undefined) {
				const selector =
					at.parent === undefined
						? r.selectorText
						: nestedSelector(at.parent, r.selectorText);
				// A rule whose presence would say a state is never looked at (CR-01).
				const hit = listedRule(selector) ? matching(el, selector) : undefined;
				if (hit !== undefined && r.style.length > 0) {
					found.push({
						selector: cut(r.selectorText, LIMITS.selector),
						declarations: cut(
							cleanCssUrls(r.style.cssText),
							LIMITS.declarations,
						),
						sheet: at.sheet,
						...(at.conditions.length > 0 ? { conditions: at.conditions } : {}),
						...(at.active ? {} : { active: false }),
						...hit,
					});
				}
				if (r.cssRules !== undefined && r.cssRules.length > 0)
					walk(r.cssRules, { ...at, parent: selector });
				continue;
			}
			if (r.styleSheet !== undefined && r.styleSheet !== null) {
				// @import
				const media = r.media?.mediaText ?? "";
				sheet(r.styleSheet, {
					...at,
					sheet: r.styleSheet.href ? cleanUrl(r.styleSheet.href) : at.sheet,
					...(media === "" || media === "all"
						? {}
						: {
								conditions: [...at.conditions, `@media ${media}`],
								active:
									at.active &&
									(holds(() => win?.matchMedia(media).matches ?? true) ?? true),
							}),
				});
				continue;
			}
			if (r.cssRules === undefined) continue; // @font-face, @keyframes' frames, …
			const kind = rule.constructor?.name ?? "";
			const condition = r.conditionText ?? r.media?.mediaText ?? "";
			let next = at;
			if (kind === "CSSMediaRule")
				next = {
					...at,
					conditions: [...at.conditions, `@media ${condition}`],
					active:
						at.active &&
						(holds(() => win?.matchMedia(condition).matches ?? true) ?? true),
				};
			else if (kind === "CSSSupportsRule")
				next = {
					...at,
					conditions: [...at.conditions, `@supports ${condition}`],
					active: at.active && (holds(() => CSS.supports(condition)) ?? true),
				};
			else if (kind === "CSSContainerRule")
				next = {
					...at,
					conditions: [...at.conditions, `@container ${condition}`],
				};
			else if (kind === "CSSLayerBlockRule")
				next = {
					...at,
					conditions: [...at.conditions, `@layer ${r.name ?? ""}`.trim()],
				};
			else if (kind === "CSSScopeRule")
				next = { ...at, conditions: [...at.conditions, "@scope"] };
			else if (
				kind === "CSSKeyframesRule" ||
				kind === "CSSFontFeatureValuesRule"
			)
				continue;
			walk(r.cssRules, next);
		}
	};

	const sheet = (s: CSSStyleSheet, at: Context): void => {
		if (s.disabled) return;
		let rules: CSSRuleList;
		try {
			rules = s.cssRules;
		} catch {
			// A sheet of another origin: listed as unreadable.
			unreadable.push(s.href ? cleanUrl(s.href) : at.sheet);
			return;
		}
		walk(rules, at);
	};

	const sheets = [
		...root.styleSheets,
		...(root.adoptedStyleSheets ?? []),
	] as CSSStyleSheet[];
	for (const s of sheets) {
		const media = s.media?.mediaText ?? "";
		sheet(s, {
			sheet: sheetName(s, styles),
			conditions: media === "" || media === "all" ? [] : [`@media ${media}`],
			active:
				media === "" || media === "all"
					? true
					: (holds(() => win?.matchMedia(media).matches ?? true) ?? true),
		});
	}

	// Inactive rules go first, then the earliest: later rules win the cascade.
	const rules = [...found];
	let chars = rules.reduce(
		(n, r) => n + r.selector.length + r.declarations.length,
		0,
	);
	const over = () => rules.length > LIMITS.rules || chars > LIMITS.ruleChars;
	while (over()) {
		const at = rules.findIndex((r) => r.active === false);
		const [gone] = rules.splice(Math.max(at, 0), 1);
		if (gone !== undefined)
			chars -= gone.selector.length + gone.declarations.length;
	}
	return {
		rules,
		leftOut: found.length - rules.length,
		unreadable,
		...(scanned > LIMITS.scannedRules ? { truncated: true } : {}),
	};
}

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** An element around or inside the inspected one. */
export interface Neighbour {
	tag: string;
	id?: string;
	classes?: string[];
	/** Its box in window coordinates. */
	rect: Box;
	styles: Record<string, string>;
	/** A child's text, without fields and editors (`pageText`). */
	text?: string;
	/** Its shadow root, if it has one. */
	shadowRoot?: "open" | "closed";
}

export interface Inspection {
	tag: string;
	/** Its box in window coordinates (CSS pixels). */
	rect: Box;
	/** Rendered with a size, and inside the window. */
	visible: boolean;
	inViewport: boolean;
	viewport: { width: number; height: number; dpr: number };
	scroll: { x: number; y: number };
	page: { width: number; height: number };
	html: string;
	/** Elements the markup left out at its size limit. */
	htmlLeftOut?: number;
	/** Hidden elements the markup left out. */
	htmlHidden?: number;
	/** The markup cut at `LIMITS.shortHtml`, when it is longer. */
	short?: { html: string; leftOut: number; hidden: number };
	styles: Record<string, string>;
	rules: MatchedRule[];
	rulesLeftOut?: number;
	unreadableSheets?: string[];
	rulesTruncated?: boolean;
	/** Nearest first, up to `LIMITS.ancestors`; across shadow roots. */
	ancestors: Neighbour[];
	children: Neighbour[];
	childrenLeftOut?: number;
	/** Hidden children, not listed. */
	childrenHidden?: number;
	/** The element is inside a shadow root, so no selector reaches it. */
	inShadowRoot?: boolean;
}

const round = (v: number) => Math.round(v * 10) / 10;

function box(el: Element): Box {
	const r = el.getBoundingClientRect();
	return {
		x: round(r.x),
		y: round(r.y),
		width: round(r.width),
		height: round(r.height),
	};
}

function classesOf(el: Element): string[] | undefined {
	const list = [...el.classList]
		.slice(0, LIMITS.classes)
		.map((c) => cut(c, LIMITS.className));
	return list.length > 0 ? list : undefined;
}

function styleOf(el: Element): StyleOf {
	const computed = el.ownerDocument.defaultView?.getComputedStyle(el);
	return (p) => computed?.getPropertyValue(p) ?? "";
}

function displayOf(el: Element | null): string {
	return el === null ? "" : styleOf(el)("display");
}

function neighbour(el: Element, set: StyleSet, withText: boolean): Neighbour {
	const out: Neighbour = {
		tag: el.localName,
		rect: box(el),
		styles: pickStyles(styleOf(el), {
			set,
			parentDisplay: displayOf(parentOf(el)),
		}),
	};
	const id = el.getAttribute("id");
	if (id) out.id = cut(id, LIMITS.attribute);
	const classes = classesOf(el);
	if (classes) out.classes = classes;
	if (withText && !holdsInput(el) && !inInput(el)) {
		const text = normalizeText(pageText(el, { max: 120 }), 80);
		if (text) out.text = text;
	}
	const root = shadowOf(el);
	if (root !== null) out.shadowRoot = root.mode;
	return out;
}

/** Everything `get_mark_element` reports about `el`; `skip` is Sitegloss's overlay. */
export function inspectElement(el: Element, skip?: Element): Inspection {
	const doc = el.ownerDocument;
	const win = doc.defaultView;
	const rect = box(el);
	const viewport = {
		width: win?.innerWidth ?? 0,
		height: win?.innerHeight ?? 0,
		dpr: win?.devicePixelRatio || 1,
	};
	const markup = markupOf(el, skip === undefined ? {} : { skip });
	const matched = matchedRules(el);
	const ancestors: Neighbour[] = [];
	for (
		let at = parentOf(el);
		at !== null && ancestors.length < LIMITS.ancestors;
		at = parentOf(at)
	) {
		// Inside an editor, the elements around are what was typed.
		if (insideInput(at)) continue;
		ancestors.push(neighbour(at, "layout", false));
		if (at.localName === "html") break;
	}
	// What an editor, a select or a text area holds is typed or chosen: not
	// its children, their number or their boxes either.
	const typed = holdsInput(el) || inInput(el);
	const all = typed
		? []
		: [...el.children].filter((c) => c !== skip && !EMPTIED.has(c.localName));
	const kids = all.filter((c) => !isHidden(c));
	const root = doc.documentElement;
	const out: Inspection = {
		tag: el.localName,
		rect,
		visible: rect.width > 0 && rect.height > 0,
		inViewport:
			rect.width > 0 &&
			rect.height > 0 &&
			rect.x < viewport.width &&
			rect.y < viewport.height &&
			rect.x + rect.width > 0 &&
			rect.y + rect.height > 0,
		viewport,
		scroll: { x: round(win?.scrollX ?? 0), y: round(win?.scrollY ?? 0) },
		page: {
			width: Math.max(root.scrollWidth, root.clientWidth),
			height: Math.max(root.scrollHeight, root.clientHeight),
		},
		html: markup.html,
		styles: pickStyles(styleOf(el), { parentDisplay: displayOf(parentOf(el)) }),
		rules: matched.rules,
		ancestors,
		children: kids
			.slice(0, LIMITS.children)
			.map((c) => neighbour(c, "child", true)),
	};
	if (markup.leftOut > 0) out.htmlLeftOut = markup.leftOut;
	if (markup.hidden > 0) out.htmlHidden = markup.hidden;
	if (markup.html.length > LIMITS.shortHtml)
		out.short = markupOf(el, {
			max: LIMITS.shortHtml,
			...(skip === undefined ? {} : { skip }),
		});
	if (all.length > kids.length) out.childrenHidden = all.length - kids.length;
	if (matched.leftOut > 0) out.rulesLeftOut = matched.leftOut;
	if (matched.unreadable.length > 0)
		out.unreadableSheets = matched.unreadable.slice(0, 10);
	if (matched.truncated) out.rulesTruncated = true;
	if (kids.length > LIMITS.children)
		out.childrenLeftOut = kids.length - LIMITS.children;
	if (hostOf(el) !== null) out.inShadowRoot = true;
	return out;
}

/** How a `selector` found the element to inspect, relative to the mark's. */
export type Relation = "mark" | "ancestor" | "descendant" | "page";

/** Elements that are no part of the page's content, or hold secrets (meta tags). */
const NOT_CONTENT = new Set([
	"head",
	"meta",
	"link",
	"script",
	"style",
	"title",
	"base",
	"noscript",
	"template",
]);

/** Inside a hidden element: the markup leaves such content out, so no selector names it. */
function inHidden(el: Element): boolean {
	for (let at = parentOf(el); at !== null; at = parentOf(at))
		if (isHidden(at)) return true;
	return false;
}

/** An element `get_mark_element` never reads: the head and what is not content. */
export function isOffLimits(el: Element): boolean {
	return NOT_CONTENT.has(el.localName) || el.closest("head") !== null;
}

/**
 * Why `selector` is not looked for, if it is not: not valid CSS, a name that
 * could ask about form state or look inside an element (`selector.ts`), or
 * nothing but `*`.
 */
export function selectorProblem(
	doc: Document,
	selector: string,
): string | undefined {
	try {
		// Checks the syntax without matching anything.
		doc.createDocumentFragment().querySelector(selector);
	} catch {
		return `Not a valid CSS selector: ${cut(selector, 200)}`;
	}
	// Names only what the markup shows: no form state, nothing inside (CR-01).
	const vocabulary = selectorVocabularyProblem(selector);
	if (vocabulary !== undefined) return vocabulary;
	if (/^[\s*>+~,()]*$/.test(selector.replace(/\|\*/g, "*")))
		return "A selector of only * names no element; use a tag, class, id or attribute.";
	return undefined;
}

const rendered = (e: Element) => {
	const r = e.getBoundingClientRect();
	return r.width > 0 && r.height > 0;
};

/** The first visible match of `selector` in `root` that `ok` allows, else the first allowed. */
function firstMatch(
	root: ParentNode,
	selector: string,
	ok: (e: Element) => boolean,
): Element | undefined {
	const first = root.querySelector(selector);
	if (first === null) return undefined;
	if (ok(first) && rendered(first)) return first;
	let fallback: Element | undefined;
	for (const e of root.querySelectorAll(selector)) {
		if (!ok(e)) continue;
		if (rendered(e)) return e;
		fallback ??= e;
	}
	return fallback;
}

/**
 * The element `selector` names. With the mark's element `base`, only around
 * it: the nearest ancestor (or `base` itself) that matches, else the first
 * match inside it, visible ones first. Without one, on the whole page, but
 * only when `pageWide` (the tab shows the case's page). Never `skip`, the
 * head, scripts, styles or templates, nor what is inside a select, a text
 * area or an editor: such a match counts as none, so the answer is the same
 * whatever was typed or chosen there.
 */
export function resolveSelector(
	doc: Document,
	base: Element | undefined,
	selector: string,
	options: { skip?: Element; pageWide?: boolean } = {},
): { element: Element; relation: Relation } | { error: string } {
	const problem = selectorProblem(doc, selector);
	if (problem !== undefined) return { error: problem };
	const { skip } = options;
	const ok = (e: Element) =>
		!isOffLimits(e) &&
		!insideInput(e) &&
		!inHidden(e) &&
		(skip === undefined || !skip.contains(e));
	const shown = cut(selector, 200);
	if (base !== undefined) {
		// Past an ancestor that may not be named, on to the next that matches.
		for (let up: Element | null = base; up !== null; up = parentOf(up))
			if (up.matches(selector) && ok(up))
				return { element: up, relation: up === base ? "mark" : "ancestor" };
		const down = firstMatch(base, selector, ok);
		if (down !== undefined) return { element: down, relation: "descendant" };
		return {
			error: `Nothing around the mark's element matches ${shown}: a selector is looked for among its ancestors and inside it.`,
		};
	}
	if (options.pageWide !== true)
		return {
			error: `A selector for a mark without an element is looked for only on the case's page.`,
		};
	const element = firstMatch(doc, selector, ok);
	if (element === undefined)
		return {
			error: `No element of this page's content matches ${shown}.`,
		};
	return { element, relation: "page" };
}
