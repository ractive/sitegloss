/**
 * How a marked element looked when the mark was made (DEC-048): its computed
 * styles, the colour behind it, and its siblings' boxes. Read once per mark,
 * for the mark's own element, when it is made (by hand or by an AI app's
 * add_mark); never for a page's candidates (candidates.ts, review.ts),
 * whose scan has a time budget, and never for a stroke's ends. Matching and
 * the sync's fingerprint take no part of it.
 *
 * The properties are those get_mark_element reads from the live page
 * (`pickStyles`, the full set), so that what was recorded and what the page
 * shows now compare name for name: colour, background colour and gradients,
 * opacity, visibility; font family, size, weight, line height, letter
 * spacing, text alignment, white space, overflow of text; display, position
 * and its offsets, box sizing, width and height with their limits, margin,
 * padding, border, corners; flex and grid container and item properties,
 * gap, vertical alignment; overflow, z-index, transform, shadow. Plus font
 * style, text transform and text decoration for typography. Values at their
 * initial value are left out, as get_mark_element does; sides come together
 * (`padding: 8px 16px`).
 *
 * Never: a property whose value can name a URL (cursor, content, mask,
 * filter, clip-path, list-style-image, border-image, shape-outside; a
 * background image only as a gradient), a custom property, or any value
 * that names a URL after all (`namesUrl`).
 */

import { FIREFOX } from "./browser.ts";
import {
	type Backdrop,
	type ElementDetails,
	lookOf,
	MAX_SIBLINGS,
	MAX_STYLE_VALUE,
	type Rect,
	type SiblingBox,
} from "./case.ts";
import { over, parseColor, type Rgba, rgbText } from "./colour.ts";
import { documentRect } from "./element.ts";
import { pickStyles } from "./inspect.ts";
import { parentOf } from "./shadow.ts";

/** Kept first when there are more than 40: contrast and type, then the box, then the rest. */
const FIRST = [
	"color",
	"background-color",
	"background-image",
	"opacity",
	"visibility",
	"font-family",
	"font-size",
	"font-weight",
	"line-height",
	"display",
	"position",
	"width",
	"height",
	"padding",
	"margin",
	"border",
	"box-sizing",
	"overflow",
];

/** Typography beyond get_mark_element's set, with the value that says nothing. */
const MORE: Record<string, string> = {
	"font-style": "normal",
	"text-transform": "none",
	"text-decoration-line": "none",
};

/** The element's computed styles as recorded; none when nothing can be read. */
export function stylesOf(el: Element): Record<string, string> | undefined {
	const win = el.ownerDocument.defaultView;
	if (win === null) return undefined;
	const style = win.getComputedStyle(el);
	const parent = parentOf(el);
	const picked = pickStyles((p) => style.getPropertyValue(p), {
		set: "full",
		parentDisplay:
			parent === null
				? ""
				: win.getComputedStyle(parent).getPropertyValue("display"),
	});
	for (const [name, initial] of Object.entries(MORE)) {
		const value = style.getPropertyValue(name).trim();
		if (value !== "" && value !== initial) picked[name] = value;
	}
	const ordered: Record<string, string> = {};
	for (const name of FIRST)
		if (picked[name] !== undefined) ordered[name] = picked[name];
	for (const [name, value] of Object.entries(picked))
		if (ordered[name] === undefined) ordered[name] = value;
	// Cut as the server keeps them; one that names a URL is left out there.
	const cut: Record<string, string> = {};
	for (const [name, value] of Object.entries(ordered))
		if (value.length <= MAX_STYLE_VALUE) cut[name] = value;
	return lookOf({ styles: cut }).styles;
}

/**
 * The canvas the page is drawn on, as far as it can be known: the browser
 * reports no canvas colour, so it is the browser's default for the colour
 * scheme the page uses (the root's `color-scheme`, else its
 * `<meta name="color-scheme">`, with the reader's preference where the page
 * takes both). Chromium's dark canvas is #121212, Firefox's #1c1b22.
 */
export function canvasOf(doc: Document): Rgba {
	const win = doc.defaultView;
	let schemes =
		win === null
			? ""
			: win
					.getComputedStyle(doc.documentElement)
					.getPropertyValue("color-scheme")
					.trim();
	if (schemes === "" || schemes === "normal")
		schemes =
			doc
				.querySelector('meta[name="color-scheme"]')
				?.getAttribute("content")
				?.trim() ?? "";
	const words = schemes.toLowerCase().split(/\s+/);
	const dark =
		words.includes("dark") &&
		(!words.includes("light") ||
			win?.matchMedia?.("(prefers-color-scheme: dark)").matches === true);
	if (!dark) return { r: 255, g: 255, b: 255, a: 1 };
	return FIREFOX
		? { r: 28, g: 27, b: 34, a: 1 }
		: { r: 18, g: 18, b: 18, a: 1 };
}

/** How far up the walk for the colour behind an element goes at most. */
const MAX_DEPTH = 1000;

const said = (style: CSSStyleDeclaration, property: string): string =>
	style.getPropertyValue(property).trim();

/**
 * Something on the element or around it that changes what shows and that
 * the walk does not work out: a filter, a backdrop filter or a blend mode
 * on the element or an ancestor, or an ancestor's opacity (the element's
 * own opacity is in its styles).
 */
function notComposited(style: CSSStyleDeclaration, own: boolean): boolean {
	const filter = said(style, "filter");
	const behind = said(style, "backdrop-filter");
	const blend = said(style, "mix-blend-mode");
	const opacity = Number.parseFloat(said(style, "opacity") || "1");
	return (
		(filter !== "" && filter !== "none") ||
		(behind !== "" && behind !== "none") ||
		(blend !== "" && blend !== "normal") ||
		(!own && Number.isFinite(opacity) && opacity < 1)
	);
}

/**
 * The colour behind the element: its own background colour, composited over
 * its ancestors' (across shadow roots) while it is transparent or
 * translucent, up to the first opaque one, whose distance is `depth`. With
 * none up to the page, the canvas (`canvasOf`) and no `depth`. A colour this
 * cannot read (`oklch(…)`) ends the walk and is given as it is, without a
 * `depth`. `image` when a background image or gradient on the way may show
 * instead. None at all when a filter, a blend mode or an ancestor's opacity
 * changes what shows (`notComposited`): a colour known not to hold is not
 * recorded.
 */
export function backdropOf(el: Element): Backdrop | undefined {
	const win = el.ownerDocument.defaultView;
	if (win === null) return undefined;
	// What changes the colours anywhere up to the page.
	let d = 0;
	for (
		let at: Element | null = el;
		at !== null && d <= MAX_DEPTH;
		d++, at = parentOf(at)
	)
		if (notComposited(win.getComputedStyle(at), at === el)) return undefined;
	const layers: Rgba[] = [];
	let image = false;
	let depth: number | undefined;
	let at: Element | null = el;
	for (d = 0; at !== null && d <= MAX_DEPTH; d++, at = parentOf(at)) {
		const style = win.getComputedStyle(at);
		const background = said(style, "background-image");
		if (background !== "" && background !== "none") image = true;
		const value = said(style, "background-color");
		// None given reads as transparent (browsers say `rgba(0, 0, 0, 0)`).
		const colour =
			value === "" ? { r: 0, g: 0, b: 0, a: 0 } : parseColor(value);
		// Not readable: given as the browser says it, found nowhere.
		if (colour === undefined)
			return lookOf({
				backdrop: { color: value, ...(image ? { image } : {}) },
			}).backdrop;
		// Opaque and first: as the browser says it.
		if (colour.a >= 1 && layers.length === 0)
			return lookOf({
				backdrop: { color: value, depth: d, ...(image ? { image } : {}) },
			}).backdrop;
		if (colour.a === 0) continue;
		layers.push(colour);
		if (colour.a >= 1) {
			depth = d;
			break;
		}
	}
	let under =
		depth === undefined ? canvasOf(el.ownerDocument) : (layers.pop() as Rgba);
	for (let i = layers.length - 1; i >= 0; i--)
		under = over(layers[i] as Rgba, under);
	return lookOf({
		backdrop: {
			color: rgbText(under),
			...(depth === undefined ? {} : { depth }),
			...(image ? { image } : {}),
		},
	}).backdrop;
}

/** How many siblings on each side are looked at, at most, for three with a box. */
const SIBLING_STEPS = 20;

/**
 * The boxes of the element's nearest element siblings with a box, up to
 * three before and three after it, nearest first on each side, in document
 * coordinates. Its siblings are its parent node's children: an element's,
 * or a shadow root's for an element at the top of one (not the host's
 * children, which are what is slotted into it). `skip`: Sitegloss's own
 * overlay, never one of them.
 */
export function siblingsOf(
	el: Element,
	scroll: { x: number; y: number },
	skip?: Element,
): SiblingBox[] | undefined {
	const parent = el.parentNode;
	if (parent === null || !("children" in parent)) return undefined;
	if (parent === el.ownerDocument) return undefined;
	const children = [...(parent as ParentNode).children];
	const at = children.indexOf(el);
	if (at < 0) return undefined;
	const out: SiblingBox[] = [];
	for (const step of [-1, 1]) {
		let found = 0;
		for (
			let i = at + step, n = 0;
			i >= 0 &&
			i < children.length &&
			n < SIBLING_STEPS &&
			found < MAX_SIBLINGS / 2;
			i += step, n++
		) {
			const sibling = children[i] as Element;
			if (sibling === skip) continue;
			const box = sibling.getBoundingClientRect();
			if (box.width === 0 && box.height === 0) continue;
			out.push({
				offset: i - at,
				tag: sibling.localName,
				rect: documentRect(sibling, scroll),
			});
			found++;
		}
	}
	out.sort((a, b) => a.offset - b.offset);
	return lookOf({ siblings: out }).siblings;
}

/**
 * The details of a mark's own element with how it looked (DEC-048): what
 * `describeElement` records, plus its computed styles, backdrop and
 * siblings. Once per mark; a failure to read them leaves them out.
 */
export function withLook(
	details: ElementDetails,
	el: Element,
	scroll: { x: number; y: number },
	skip?: Element,
): ElementDetails {
	try {
		const styles = stylesOf(el);
		const backdrop = backdropOf(el);
		const siblings = siblingsOf(el, scroll, skip);
		return {
			...details,
			...(styles === undefined ? {} : { styles }),
			...(backdrop === undefined ? {} : { backdrop }),
			...(siblings === undefined ? {} : { siblings }),
		};
	} catch {
		return details;
	}
}

/**
 * A mark's element as the case stores it once its screenshot is taken with
 * the element at `box` (it may have moved since it was described): `rect`
 * is that box, and the siblings are those measured at that same moment
 * (`siblings`, none when none has a box), never those from before. One
 * record, one moment's positions.
 */
export function atShot(
	details: ElementDetails,
	box: Rect,
	siblings: SiblingBox[] | undefined,
): ElementDetails {
	const { siblings: _before, ...rest } = details;
	return {
		...rest,
		rect: box,
		...(siblings === undefined ? {} : { siblings }),
	};
}
