/**
 * The overlay's DOM: a fixed, full-window layer in a shadow DOM on top of the
 * page with the marks (SVG), the layer that takes the pointer while a tool is
 * active, the comment field and the toolbar. Styles go in through a
 * constructed style sheet, which a page's Content Security Policy does not
 * block, and neither leak in nor out.
 */

import {
	GROUP_OF,
	type MarkStatus,
	type Point,
	type Rect,
	type Shape,
	type StatusGroup,
} from "../lib/case.ts";
import { BAR_LOOP, pathData, strokeBounds } from "../lib/logo.ts";
import {
	arrowHead,
	badgeRadius,
	HIGHLIGHT_LOOK,
	MARK_COLOUR,
	markerPath,
	pinFontSize,
	pinPosition,
	type RenderedMark,
} from "../lib/marks.ts";
import { HOVER_COLOUR, PAGE_LOOK } from "../lib/page-look.ts";
import { fieldOf } from "./page-field.ts";

declare const SITEGLOSS_TEST_BUILD: boolean | undefined;

export const HOST_ID = "sitegloss-root";
export { HOVER_COLOUR, PAGE_LOOK } from "../lib/page-look.ts";

/**
 * A loaded mark's colour is its status, by the group it counts in. Open is
 * the colour of the mark on its screenshot; each carries the pin's white number.
 */
export const STATUS_COLOUR: Record<StatusGroup, string> = {
	open: MARK_COLOUR,
	toVerify: "#4f53e0",
	verified: "#1a7f37",
	dismissed: "#667085",
};
/** A mark fixed and waiting to be verified: drawn in full, to be checked (DEC-023). */
export const TO_VERIFY_COLOUR = STATUS_COLOUR.toVerify;
/** How much of a verified or dismissed mark's shape shows; its pin stays solid to be found. */
export const RESOLVED_OPACITY = 0.35;
/** How much wider than its stroke a shape's casing is. */
export const CASING_EXTRA = 3;
/**
 * How the toolbar is laid out, from the roomiest to the tightest: one row
 * with the status beside the tools; the same with the buttons, logo and status
 * closer (the eight tools' words and a long case title need 975 to 990 px otherwise);
 * the status on a second, centred row;
 * the tools as icons; every button with an icon as an icon; the buttons
 * closer. `fitToolbar` takes the first that fits the page, measured, so no
 * font's width and no scrollbar decides it, and the tools never wrap in the
 * middle (on a page narrower than about 400 px they still do).
 */
export const TOOLBAR_FITS = [
	"",
	"snug",
	"rows",
	"rows icons",
	"rows icons all",
	"rows icons all tight",
] as const;
const SVG = "http://www.w3.org/2000/svg";
const L = PAGE_LOOK;
/** The bars' edge on a dark page, then their shadow. */
const RING = "0 0 0 1px rgba(255, 255, 255, 0.75)";
const SHADOW = `${RING}, 0 6px 24px rgba(13, 18, 30, 0.35)`;
/** A word that stays the button's name while only its icon shows. */
const NO_WORD =
	"position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;";
/** The bars' logo: the loop alone, in the logo's 128-unit tile. */
const RING_WIDTH = BAR_LOOP.width;
const RING_PATH = pathData(BAR_LOOP.points);

const STYLE = `
/* Important: a page's own rule on the host would beat this otherwise. */
:host { all: initial !important; }
.layer {
	direction: ltr;
	position: fixed; inset: 0; z-index: 2147483647;
	pointer-events: none;
	font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
	color: ${L.popoverText};
}
svg.marks, svg.strokes { position: fixed; inset: 0; width: 100%; height: 100%; overflow: visible; }
/*
 * A highlight's marker strokes on a light ground (DEC-066): a layer of their
 * own, multiplied with the page under it, so the text keeps its colour. Not
 * inside .layer, whose stacking context would multiply them with nothing.
 * Under .layer: the pins stay on top.
 */
.ink { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; mix-blend-mode: multiply; }
.ink.marking .review-strokes, .ink.marking .draft-strokes { display: none !important; }
.capture { position: fixed; inset: 0; pointer-events: none; cursor: crosshair; }
.capture.active { pointer-events: auto; }
.capture.element { cursor: default; }
/* The Highlight tool: the press selects the page's text (DEC-066). */
.capture.text { cursor: text; }
/* Over a loaded mark's pin: a click opens its comment (DEC-027). */
.capture.pick { cursor: pointer; }
.review [data-number] { pointer-events: auto; cursor: pointer; }
.toolbar {
	position: fixed; left: 16px; right: 16px; bottom: 16px; margin-inline: auto;
	box-sizing: border-box; width: fit-content; max-width: calc(100vw - 32px);
	display: flex; gap: 2px; align-items: center; justify-content: center;
	padding: 5px; border-radius: 10px;
	background: ${L.bar}; color: ${L.barText};
	box-shadow: ${SHADOW};
	pointer-events: auto;
}
.toolbar.top { top: 16px; bottom: auto; }
/* The logo's loop is thinner in the icon; at 20 px this weighs about what the old ring did (BAR_LOOP lifts its end, so the two ends stay apart). */
.ring { flex: none; width: 20px; height: 20px; margin: 0 6px; fill: none; stroke: ${L.logo}; stroke-width: ${RING_WIDTH}; stroke-linecap: round; stroke-linejoin: round; }
/* Beside the tools it keeps its width (and wraps inside it): what does not fit shows as overflow, which fitToolbar reads. */
.toolbar .status {
	flex: none; max-width: 300px; padding: 0 8px;
	color: ${L.barMuted}; font-variant-numeric: tabular-nums; overflow-wrap: anywhere;
}
.toolbar .sep { flex: none; width: 1px; align-self: stretch; margin: 4px; background: rgba(255, 255, 255, 0.28); }
.toolbar button {
	all: unset; box-sizing: border-box; flex: none; cursor: pointer;
	position: relative; min-width: 28px; min-height: 30px; padding: 4px 9px; border-radius: 6px;
	display: inline-flex; gap: 6px; align-items: center; justify-content: center;
	color: ${L.barText}; font: inherit; white-space: nowrap;
}
.icon {
	flex: none; width: 16px; height: 16px; fill: none; stroke: currentColor;
	stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round;
}
.toolbar button:hover, .toolbar button:focus-visible { background: ${L.barHover}; }
.toolbar button[aria-pressed="true"] { background: ${L.action}; color: ${L.bar}; }
.toolbar button.primary { background: ${L.action}; color: ${L.bar}; font-weight: 600; padding-inline: 12px; }
.toolbar button.primary:hover, .toolbar button.primary:focus-visible { background: ${L.actionHover}; }
/* Not opacity alone: muted, and nothing answers the pointer. */
.toolbar button:disabled { color: ${L.barMuted}; opacity: 0.6; cursor: default; background: none; }
.toolbar button:focus-visible, .reviewbar button:focus-visible { outline: 2px solid ${L.barText}; outline-offset: 1px; }
/* Two rows on purpose: the tools on the first, what they are at under them. */
.toolbar[data-fit~="rows"] { flex-wrap: wrap; row-gap: 0; }
/* No width of its own, then all of the row: the bar is as wide as its tools. */
.toolbar[data-fit~="rows"] .status {
	order: 1; box-sizing: border-box; width: 0; min-width: 100%; max-width: none;
	padding: 3px 8px 2px; text-align: center;
}
.toolbar[data-fit~="icons"] button[aria-pressed] .word { ${NO_WORD} }
.toolbar[data-fit~="all"] button:has(.icon) .word { ${NO_WORD} }
.toolbar[data-fit~="snug"] button, .toolbar[data-fit~="tight"] button { padding-inline: 6px; }
.toolbar[data-fit~="snug"] button.primary, .toolbar[data-fit~="tight"] button.primary { padding-inline: 9px; }
.toolbar[data-fit~="snug"] .ring, .toolbar[data-fit~="tight"] .ring { margin: 0 2px; }
.toolbar[data-fit~="snug"] .status { padding-inline: 4px; }
.toolbar[data-fit~="tight"] .sep { display: none; }
.popover {
	box-sizing: border-box; position: fixed; width: 296px; padding: 10px; border-radius: 10px;
	/* A dark page does not restyle the field. */
	color-scheme: light;
	background: ${L.popover}; color: ${L.popoverText};
	box-shadow: ${SHADOW};
	pointer-events: auto;
}
.popover textarea {
	box-sizing: border-box; display: block; width: 100%; min-height: 72px; resize: vertical;
	font: inherit; padding: 6px 8px; border: 1px solid ${L.popoverEdge}; border-radius: 6px;
	color: ${L.popoverText}; background: ${L.popover};
}
.popover textarea::placeholder { color: ${L.popoverPlaceholder}; opacity: 1; }
/* A field of the extension's own (DEC-064): its frame, as tall as the field in it says; where it cannot load, a line and the way to the side panel. */
.popover .field-fallback { display: grid; gap: 6px; justify-items: start; }
.popover .field-fallback .field-problem { margin: 0; color: #a4161a; }
.popover iframe.field { display: block; box-sizing: border-box; width: calc(100% + 6px); height: 92px; margin: -3px; border: 0; background: transparent; color-scheme: light; }
.popover textarea:focus-visible, .popover button:focus-visible { outline: 2px solid ${HOVER_COLOUR}; outline-offset: 1px; }
.popover .row { display: flex; gap: 6px; justify-content: space-between; margin-top: 8px; }
.popover .row.images { justify-content: flex-start; margin-top: 6px; }
.popover .row.images:has(> [hidden]:only-child) { display: none; }
.popover button {
	box-sizing: border-box; min-height: 28px; font: inherit; font-weight: 600;
	padding: 3px 12px; border-radius: 6px; cursor: pointer;
	border: 1px solid ${L.popoverEdge}; background: ${L.popoverControl}; color: ${L.popoverText};
}
.popover button:hover { background: ${L.popoverControlHover}; }
.popover button.primary { background: ${L.popoverAction}; border-color: ${L.popoverAction}; color: ${L.popoverActionText}; }
.popover button.primary:hover { background: ${L.popoverActionHover}; border-color: ${L.popoverActionHover}; }
/* The key that presses it, quieter by weight only: the label's colour keeps its contrast. */
.popover button .keys { margin-inline-start: 6px; font-weight: 400; }
.popover .label { display: flex; gap: 8px; align-items: center; font-weight: 600; margin-bottom: 8px; }
.popover .label .state { margin-inline-start: auto; font-weight: 400; color: ${L.popoverMuted}; }
/* The mark's commands, as the panel has them (DEC-027). */
.popover .commands { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.popover .commands:empty { display: none; }
.popover .choices { display: grid; gap: 2px; }
.popover .choice { display: flex; gap: 8px; align-items: center; min-height: 24px; cursor: pointer; }
.popover .choice input { margin: 0; accent-color: ${L.popoverText}; }
.popover input.note {
	box-sizing: border-box; display: block; width: 100%; margin-top: 8px;
	font: inherit; padding: 6px 8px; border: 1px solid ${L.popoverEdge}; border-radius: 6px;
	color: ${L.popoverText}; background: ${L.popover};
}
.popover input.note::placeholder { color: ${L.popoverPlaceholder}; opacity: 1; }
.popover .note-label { display: block; margin: 8px 0 4px; font-size: 12px; color: ${L.popoverMuted}; }
.popover .help { margin: 0 0 6px; font-size: 12px; line-height: 16px; color: ${L.popoverMuted}; }
.popover input:focus-visible { outline: 2px solid ${HOVER_COLOUR}; outline-offset: 1px; }
.popover .problem { margin: 8px 0 0; color: #a4161a; }
.popover button:disabled { opacity: 0.6; cursor: default; }
.popover button[data-armed] { border-color: #a4161a; color: #a4161a; }
.popover .pin {
	display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding-inline: 4px;
	box-sizing: border-box; border-radius: 11px; background: ${MARK_COLOUR}; color: #fff;
	font: 700 12px/1 ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
}
/* Where the person left it (DEC-061): right and top come from its place, top right at first. */
.reviewbar {
	position: fixed; right: 16px; top: 16px;
	box-sizing: border-box; display: flex; gap: 8px; align-items: center;
	padding: 5px 5px 5px 2px; border-radius: 10px;
	background: ${L.bar}; color: ${L.barText};
	box-shadow: ${SHADOW};
	pointer-events: auto; max-width: min(520px, calc(100vw - 32px));
	cursor: grab; touch-action: none; user-select: none;
}
.reviewbar.dragging { cursor: grabbing; }
/* The way to move it from the keyboard: arrow keys, Home puts it back. */
.reviewbar .grip {
	all: unset; box-sizing: border-box; flex: none; cursor: grab;
	width: 18px; min-height: 28px; display: inline-grid; place-items: center;
	border-radius: 6px; color: ${L.barMuted}; font: 700 14px/1 system-ui, sans-serif;
}
.reviewbar .grip:focus-visible { outline: 2px solid ${L.barText}; outline-offset: 1px; }
/* Hidden marks: the logo alone, which brings them back, where the bar was. */
.reviewbar.pill { padding: 4px; gap: 0; }
.reviewbar.pill button.show-marks { padding: 3px 4px; border-color: transparent; }
.reviewbar.pill .ring { margin: 0 4px; }
/* The count says what the bar is for: a long title gives way. */
.reviewbar .text { display: flex; gap: 8px; min-width: 0; }
.reviewbar .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${L.barMuted}; }
.reviewbar .sep { flex: none; color: ${L.barMuted}; }
.reviewbar .count { flex: none; font-weight: 600; font-variant-numeric: tabular-nums; }
.reviewbar button {
	all: unset; box-sizing: border-box; flex: none; cursor: pointer;
	min-height: 28px; padding: 3px 11px; border-radius: 6px;
	display: inline-flex; align-items: center;
	border: 1px solid rgba(255, 255, 255, 0.5);
	color: ${L.barText}; font: inherit; font-weight: 600;
}
.reviewbar button:hover, .reviewbar button:focus-visible { background: ${L.barHover}; border-color: ${L.barText}; }
/* Add marks is the bar's main action (DEC-063): the action's green, as the toolbar's own. */
.reviewbar button[data-action="review-add"] { background: ${L.action}; border-color: ${L.action}; color: ${L.bar}; }
.reviewbar button[data-action="review-add"]:hover, .reviewbar button[data-action="review-add"]:focus-visible { background: ${L.actionHover}; border-color: ${L.actionHover}; color: ${L.bar}; }
/* The user's own colours: the system's, with every edge drawn. */
@media (forced-colors: active) {
	.toolbar, .reviewbar, .popover {
		background: Canvas; color: CanvasText; border: 1px solid CanvasText; box-shadow: none;
	}
	.toolbar .status, .reviewbar .title { color: CanvasText; }
	.toolbar .sep { background: CanvasText; }
	.toolbar button, .reviewbar button, .popover button {
		border: 1px solid CanvasText; background: Canvas; color: CanvasText;
	}
	/* Also hovered and focused: no state brings the green back under the system's text colour. */
	.toolbar button[aria-pressed="true"], .toolbar button[aria-pressed="true"]:hover, .toolbar button[aria-pressed="true"]:focus-visible,
	.toolbar button.primary, .toolbar button.primary:hover, .toolbar button.primary:focus-visible,
	.popover button.primary, .popover button.primary:hover, .popover button.primary:focus-visible,
	.reviewbar button[data-action="review-add"], .reviewbar button[data-action="review-add"]:hover, .reviewbar button[data-action="review-add"]:focus-visible {
		forced-color-adjust: none; background: Highlight; color: HighlightText; border-color: Highlight;
	}
	.toolbar button:disabled { border-color: GrayText; color: GrayText; opacity: 1; }
	.toolbar button:focus-visible, .reviewbar button:focus-visible { outline-color: Highlight; }
	.popover textarea, .popover input.note { border: 1px solid CanvasText; }
	.ring { stroke: CanvasText; }
}
/* Screenshots show the page alone. Invisible, not gone: a field keeps its focus. */
.capturing { opacity: 0 !important; }
/* An AI app's screenshot of one element: only its temporary mark shows. */
.marking .toolbar, .marking .popover, .marking .reviewbar { opacity: 0 !important; }
.marking .hover, .marking .review, .marking .drafts { display: none !important; }
[hidden] { display: none !important; }
`;

function svg<K extends keyof SVGElementTagNameMap>(
	doc: Document,
	tag: K,
	attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
	const el = doc.createElementNS(SVG, tag);
	for (const [k, v] of Object.entries(attributes))
		el.setAttribute(k, String(v));
	return el;
}

/** The toolbar's icons: paths on a 16×16 grid, drawn with a stroke. */
const ICONS = {
	element: [
		"M2 5V3a1 1 0 0 1 1-1h2",
		"M11 2h2a1 1 0 0 1 1 1v2",
		"M14 11v2a1 1 0 0 1-1 1h-2",
		"M5 14H3a1 1 0 0 1-1-1v-2",
		"M6 6l4.5 1.6-1.9.9-.9 1.9z",
	],
	box: [
		"M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z",
	],
	arrow: ["M3 13L13 3", "M6.5 3H13v6.5"],
	pen: ["M2 11c2-5 3.5-7 5-6s-1.5 6 .5 6.5S11 8 12 8s1 2 2 2"],
	note: [
		"M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H7l-3 2.5V11h-.5a1 1 0 0 1-1-1z",
	],
	// A marker's tip over a line of text (DEC-066).
	highlight: ["M9.5 2.5l3 3L7 11H4V8z", "M2.5 13.5h11"],
	undo: ["M5.5 3l-3 3 3 3", "M2.5 6H9a4 4 0 0 1 0 8H6"],
	close: ["M4 4l8 8", "M12 4l-8 8"],
	up: ["M8 13V3", "M4 7l4-4 4 4"],
	down: ["M8 3v10", "M4 9l4 4 4-4"],
} as const;

export type IconName = keyof typeof ICONS;

export function icon(doc: Document, name: IconName): SVGSVGElement {
	const el = svg(doc, "svg", {
		class: "icon",
		viewBox: "0 0 16 16",
		"aria-hidden": "true",
	});
	for (const d of ICONS[name]) el.append(svg(doc, "path", { d }));
	return el;
}

/** What tells the keyboard's platform: Chrome's client hint, else the old field. */
export interface Platform {
	platform?: string;
	userAgentData?: { platform?: string };
}

/** Whether the command key is ⌘ (macOS) rather than Ctrl. */
export function isMac(nav: Platform): boolean {
	return /mac/i.test(nav.userAgentData?.platform || nav.platform || "");
}

/**
 * Show on a dialog's button that Cmd+Enter (Ctrl+Enter elsewhere) in its
 * text field presses it: the keys after its label, quieter, and outside its
 * accessible name, which stays its label.
 */
export function withSaveKey(
	button: HTMLButtonElement,
	mac = isMac(navigator as Platform),
): HTMLButtonElement {
	const keys = button.ownerDocument.createElement("span");
	keys.className = "keys";
	keys.setAttribute("aria-hidden", "true");
	keys.textContent = mac ? "⌘↵" : "Ctrl+↵";
	button.append(keys);
	button.setAttribute(
		"aria-keyshortcuts",
		mac ? "Meta+Enter" : "Control+Enter",
	);
	return button;
}

/**
 * The pen loop of Sitegloss's small icon (DEC-029), alone and cropped to it,
 * as if something on the page were circled.
 */
export function ring(doc: Document): SVGSVGElement {
	const el = svg(doc, "svg", {
		class: "ring",
		viewBox: strokeBounds(BAR_LOOP.points, RING_WIDTH)
			.map((v) => Math.round(v * 100) / 100)
			.join(" "),
		role: "img",
	});
	const title = svg(doc, "title", {});
	title.textContent = "Sitegloss";
	el.append(title, svg(doc, "path", { d: RING_PATH }));
	return el;
}

/** A loaded case's mark, drawn where its element was found. */
export interface ReviewItem {
	number: number;
	/** The mark in window coordinates. */
	shape: Shape;
	/** Its element's box in window coordinates; a mark may have no element. */
	rect: Rect | null;
	/** The shown candidate is a confident, unambiguous match. */
	found: boolean;
	focused: boolean;
	/** Its status: a verified or dismissed mark is drawn faded, so the others stand out. */
	status: MarkStatus;
	/** A highlight's line boxes as found now, in window coordinates (DEC-066). */
	lines?: Rect[];
	/** Its text is on a dark ground (`HIGHLIGHT_LOOK`). */
	dark?: boolean;
	/**
	 * Where its element shows (DEC-075): the mark's drawing, strokes and pin
	 * are cut to this box of the window. None: drawn whole.
	 */
	clip?: Rect;
	/** Where its pin goes, when not where its shape puts it (DEC-075). */
	pin?: Point;
}

/** A mark the toolbar draws, cut to where its element shows (DEC-075), when `clip` is set. */
export type ClippedRendered = RenderedMark & { clip?: Rect; pin?: Point };

/** Drawn faded: nothing more to do about it. */
export const isSettled = (status: MarkStatus): boolean =>
	status === "verified" || status === "wontfix" || status === "cantreproduce";

/** A loaded mark's colour: its status (open, to verify, verified, dismissed). */
export function reviewColour(item: Pick<ReviewItem, "status">): string {
	return STATUS_COLOUR[GROUP_OF[item.status]];
}

/** A loaded mark's stroke: solid when its element is found, dashed when unsure. */
export function reviewStroke(
	item: Pick<ReviewItem, "found" | "focused">,
): Record<string, string | number> {
	return {
		"stroke-width": item.focused ? 4 : 3,
		// Round caps would close the gaps.
		...(item.found
			? {}
			: { "stroke-dasharray": "8 5", "stroke-linecap": "butt" }),
	};
}

/** What the page must not see: a click on the overlay is no click outside its menu. */
const OWN_EVENTS = [
	"pointerdown",
	"pointerup",
	"mousedown",
	"mouseup",
	"click",
	"dblclick",
	"auxclick",
	"contextmenu",
	"touchstart",
	"touchend",
	"keydown",
	"keyup",
	"keypress",
];

/** A page's focus trap takes focus back from anything outside its modal. */
const FOCUS_EVENTS = ["focus", "blur", "focusin", "focusout"];

/** The page's open modal dialog: everything outside it is inert. */
function modalDialog(doc: Document): Element | null {
	try {
		return doc.querySelector("dialog:modal");
	} catch {
		return null; // The selector is not known here.
	}
}

import {
	BAR_HOME,
	BAR_STEP,
	type BarPlace,
	clampBar,
} from "../lib/bar-place.ts";

export {
	BAR_HOME,
	BAR_STEP,
	type BarPlace,
	clampBar,
	storedBarPlace,
} from "../lib/bar-place.ts";

export class Overlay {
	readonly doc: Document;
	readonly host: HTMLElement;
	readonly root: ShadowRoot;
	readonly layer: HTMLDivElement;
	readonly marks: SVGSVGElement;
	readonly capture: HTMLDivElement;
	readonly toolbar: HTMLDivElement;
	readonly popover: HTMLDivElement;
	readonly reviewBar: HTMLDivElement;
	/** The highlights' strokes on a light ground, multiplied with the page (DEC-066). */
	readonly ink: HTMLDivElement;
	readonly #drafts: SVGGElement;
	readonly #review: SVGGElement;
	readonly #temporary: SVGGElement;
	readonly #inkDrafts: SVGGElement;
	readonly #inkReview: SVGGElement;
	readonly #inkTemporary: SVGGElement;
	#addingMarks = false;
	#reviewing = false;
	/** The case's marks are hidden: the bar is the pill that brings them back (DEC-061). */
	#marksHidden = false;
	#barPlace: BarPlace = BAR_HOME;
	/** Where the person left the bar; `#barPlace` is that, kept inside this window. */
	#wanted: BarPlace = BAR_HOME;
	/** The bar was moved by the person (dragged, a key, reset): its place to keep. */
	onBarMoved: ((place: BarPlace) => void) | undefined;
	#marking = false;
	/** The loaded marks' pins as drawn last, in window coordinates. */
	#pins: { number: number; x: number; y: number; r: number }[] = [];
	/** Tells whoever has the popover open that it is closed for another. */
	#popoverDismiss: (() => void) | undefined;
	/** A loaded mark's pin was clicked (DEC-027). */
	onPick: ((number: number) => void) | undefined;
	#timer: ReturnType<typeof setInterval> | undefined;
	/**
	 * Called after the toolbar or the outlines are shown or hidden, including
	 * by the overlay's own Close and Hide buttons.
	 */
	onChange: (() => void) | undefined;
	/** Called twice a second while something shows: layouts change without a scroll. */
	onTick: (() => void) | undefined;

	constructor(doc: Document = document) {
		this.doc = doc;
		this.host = doc.createElement("div");
		this.host.id = HOST_ID;
		// Closed, so a page's scripts cannot read or drive the overlay. The
		// end-to-end tests reach in through a test build's open root.
		this.root = this.host.attachShadow({
			mode:
				typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD
					? "open"
					: "closed",
		});
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(STYLE);
		this.root.adoptedStyleSheets = [sheet];
		this.layer = doc.createElement("div");
		this.layer.className = "layer";
		this.layer.hidden = true;
		this.marks = svg(doc, "svg", { class: "marks" });
		this.#review = svg(doc, "g", { class: "review" });
		this.#drafts = svg(doc, "g", { class: "drafts" });
		this.#temporary = svg(doc, "g", { class: "temporary" });
		this.marks.append(this.#review, this.#drafts, this.#temporary);
		this.ink = doc.createElement("div");
		this.ink.className = "ink";
		this.ink.hidden = true;
		// Names of their own: a query for the overlay's groups finds those.
		this.#inkReview = svg(doc, "g", { class: "review-strokes" });
		this.#inkDrafts = svg(doc, "g", { class: "draft-strokes" });
		this.#inkTemporary = svg(doc, "g", { class: "temporary-strokes" });
		const inkSvg = svg(doc, "svg", { class: "strokes" });
		inkSvg.append(this.#inkReview, this.#inkDrafts, this.#inkTemporary);
		this.ink.append(inkSvg);
		this.capture = doc.createElement("div");
		this.capture.className = "capture";
		this.popover = doc.createElement("div");
		this.popover.className = "popover";
		this.popover.hidden = true;
		this.toolbar = doc.createElement("div");
		this.toolbar.className = "toolbar";
		this.toolbar.setAttribute("role", "toolbar");
		this.toolbar.setAttribute("aria-label", "Sitegloss");
		this.reviewBar = doc.createElement("div");
		this.reviewBar.className = "reviewbar";
		this.layer.append(
			this.marks,
			this.capture,
			this.popover,
			this.toolbar,
			this.reviewBar,
		);
		this.root.append(this.ink, this.layer);
		this.#movable();
		for (const type of OWN_EVENTS)
			this.layer.addEventListener(type, (e) => e.stopPropagation());
		// On the press, not the click: the marks are drawn anew at every scroll
		// and twice a second, and a click needs the same element twice.
		this.#review.addEventListener("pointerdown", (e) => {
			if (e.button !== 0) return;
			const pin = (e.target as Element | null)?.closest?.("[data-review]");
			const number = Number(pin?.getAttribute("data-review"));
			if (pin === null || pin === undefined || !Number.isFinite(number)) return;
			e.preventDefault();
			this.onPick?.(number);
		});
		for (const type of FOCUS_EVENTS)
			doc.defaultView?.addEventListener(
				type,
				(e) => {
					if (e.target === this.host) e.stopImmediatePropagation();
				},
				true,
			);
		doc.addEventListener("fullscreenchange", () => this.#place());
		// The page's width changed (a resize, the side panel, zoom).
		// One fit per frame, however many resize events come.
		let fitting = 0;
		doc.defaultView?.addEventListener("resize", () => {
			const win = doc.defaultView;
			if (!win || fitting) return;
			fitting = win.requestAnimationFrame(() => {
				fitting = 0;
				this.fitToolbar();
			});
		});
		doc.documentElement.append(this.host);
		this.#update();
	}

	/** The toolbar is up: the user is drawing marks. */
	get addingMarks(): boolean {
		return this.#addingMarks;
	}

	/** An AI app's temporary mark is up for its screenshot. */
	get marking(): boolean {
		return this.#marking;
	}

	/** A loaded case's marks are drawn. */
	get reviewing(): boolean {
		return this.#reviewing;
	}

	setAddingMarks(on: boolean): void {
		this.#addingMarks = on;
		this.#update();
		this.onChange?.();
	}

	setReviewing(on: boolean): void {
		this.#reviewing = on;
		this.#update();
		this.onChange?.();
	}

	/** The case's marks are hidden (the pill shows), or not. */
	get marksHidden(): boolean {
		return this.#marksHidden;
	}

	setMarksHidden(on: boolean): void {
		if (this.#marksHidden === on) return;
		this.#marksHidden = on;
		this.#update();
		this.onChange?.();
	}

	/** Put the bar at `place` (kept inside the window); `moved`: the person did, keep it. */
	setBarPlace(place: BarPlace, moved = false): void {
		this.#wanted = place;
		this.#drawBar();
		if (moved) this.onBarMoved?.(this.#barPlace);
	}

	/**
	 * The bar where the person left it, inside this window: a window that
	 * shrinks moves it in, one that grows back puts it where it was.
	 */
	#drawBar(): void {
		const bar = this.reviewBar;
		const win = this.doc.defaultView;
		this.#barPlace = clampBar(
			this.#wanted,
			bar.offsetWidth,
			bar.offsetHeight,
			win?.innerWidth ?? 1024,
			win?.innerHeight ?? 768,
		);
		bar.style.right = `${this.#barPlace.right}px`;
		bar.style.top = `${this.#barPlace.top}px`;
	}

	get barPlace(): BarPlace {
		return this.#barPlace;
	}

	/**
	 * The bar moves (DEC-061): dragged by its body (the pill by any part,
	 * once the pointer has moved a little: a press without a move is its
	 * click), with the arrow keys on its handle, back to the top right with
	 * a double click on its body or Home on the handle. It stays inside the
	 * window, also when the window gets smaller.
	 */
	#movable(): void {
		const bar = this.reviewBar;
		let drag:
			| { id: number; x: number; y: number; from: BarPlace; moved: boolean }
			| undefined;
		let swallow = false;
		const win = this.doc.defaultView;
		// The pointer is followed on the window, not by capturing it at the
		// press: a captured pointer's click goes to the bar and not to the
		// button pressed, so a press on the pill did nothing. It is captured
		// only once it has moved, which is a drag and no press.
		let following: AbortController | undefined;
		/** The press is over, however it ended: nothing is left on the window. */
		const stop = () => {
			following?.abort();
			following = undefined;
			bar.classList.remove("dragging");
			drag = undefined;
		};
		const move = (e: PointerEvent) => {
			// Only the person's own pointer: the page's scripts can send events too.
			if (!e.isTrusted || drag === undefined || e.pointerId !== drag.id) return;
			// No button is down: the release never arrived (a menu, another
			// window). A hover is no drag.
			if (e.buttons === 0) return stop();
			const dx = e.clientX - drag.x;
			const dy = e.clientY - drag.y;
			if (!drag.moved && Math.hypot(dx, dy) < 4) return;
			if (!drag.moved) {
				try {
					bar.setPointerCapture?.(e.pointerId);
				} catch {
					// The pointer ended meanwhile: the drag goes on without it.
				}
			}
			drag.moved = true;
			bar.classList.add("dragging");
			this.setBarPlace({
				right: drag.from.right - dx,
				top: drag.from.top + dy,
			});
		};
		const end = (e: PointerEvent) => {
			if (!e.isTrusted || drag === undefined || e.pointerId !== drag.id) return;
			const moved = drag.moved;
			stop();
			if (!moved) return;
			// The click that ends a drag is no press of what is under it.
			swallow = true;
			setTimeout(() => {
				swallow = false;
			}, 0);
			this.onBarMoved?.(this.#barPlace);
		};
		bar.addEventListener("pointerdown", (e) => {
			// One pointer at a time: a second finger is no second drag.
			if (e.button !== 0 || !e.isPrimary) return;
			const target = e.target as Element | null;
			const button = target?.closest("button");
			// The bar's buttons are pressed, not dragged; the pill and the
			// handle are both.
			if (
				button &&
				!bar.classList.contains("pill") &&
				!button.classList.contains("grip")
			)
				return;
			// A press whose release was lost is over now.
			stop();
			drag = {
				id: e.pointerId,
				x: e.clientX,
				y: e.clientY,
				from: this.#barPlace,
				moved: false,
			};
			following = new AbortController();
			const options = { capture: true, signal: following.signal };
			win?.addEventListener("pointermove", move, options);
			win?.addEventListener("pointerup", end, options);
			win?.addEventListener("pointercancel", end, options);
			// The window lost the focus or a menu opened: the release may never come.
			// (Of the window itself: an element's blur passes here too.)
			win?.addEventListener(
				"blur",
				(event) => {
					if (event.target === win) stop();
				},
				options,
			);
			win?.addEventListener("contextmenu", stop, options);
		});
		bar.addEventListener(
			"click",
			(e) => {
				if (!swallow) return;
				swallow = false;
				e.stopPropagation();
				e.preventDefault();
			},
			true,
		);
		bar.addEventListener("dblclick", (e) => {
			const button = (e.target as Element | null)?.closest("button");
			if (button && !button.classList.contains("grip")) return;
			this.setBarPlace(BAR_HOME, true);
		});
		bar.addEventListener("keydown", (e) => {
			if (!(e.target as Element | null)?.closest?.(".grip")) return;
			const step = e.shiftKey ? BAR_STEP * 4 : BAR_STEP;
			const at = this.#barPlace;
			const next: Record<string, BarPlace> = {
				ArrowLeft: { right: at.right + step, top: at.top },
				ArrowRight: { right: at.right - step, top: at.top },
				ArrowUp: { right: at.right, top: at.top - step },
				ArrowDown: { right: at.right, top: at.top + step },
				Home: BAR_HOME,
			};
			const place = next[e.key];
			if (place === undefined) return;
			e.preventDefault();
			this.setBarPlace(place, true);
		});
		// A smaller window: it stays in it (where it was kept is not changed).
		this.doc.defaultView?.addEventListener("resize", () => {
			if (!bar.hidden) this.#drawBar();
		});
	}

	/**
	 * The loaded mark whose pin is at this point of the window, the one drawn
	 * last first: for the layer that takes the pointer while a tool is on.
	 */
	reviewAt(x: number, y: number): number | undefined {
		if (!this.#reviewing) return undefined;
		return this.#pins.findLast((p) => Math.hypot(x - p.x, y - p.y) <= p.r + 2)
			?.number;
	}

	/**
	 * Show the one popover with `content`. Whoever had it open is told
	 * (`dismissed`) before its content goes: a comment being typed is kept.
	 */
	openPopover(content: Node[], dismissed: () => void): void {
		this.dismissPopover();
		this.#popoverDismiss = dismissed;
		this.popover.replaceChildren(...content);
		this.popover.hidden = false;
	}

	/** Its owner is done with the popover. */
	closePopover(): void {
		this.#popoverDismiss = undefined;
		this.popover.hidden = true;
		this.popover.replaceChildren();
	}

	/** Close the popover for its owner, which is told; `false` when none is open. */
	dismissPopover(): boolean {
		const dismissed = this.#popoverDismiss;
		if (dismissed === undefined) return false;
		this.#popoverDismiss = undefined;
		dismissed();
		this.closePopover();
		return true;
	}

	/** Put the popover under (or above) a mark whose bounds in the window are `b`. */
	placePopover(b: Rect): void {
		const win = this.doc.defaultView;
		const vw = win?.innerWidth ?? 1024;
		const vh = win?.innerHeight ?? 768;
		const width = 296;
		const height = Math.max(160, this.popover.offsetHeight || 0);
		let x = b.x;
		let y = b.y + b.height + 12;
		if (y + height > vh) y = b.y - height - 12;
		x = Math.min(Math.max(8, x), vw - width - 8);
		y = Math.min(Math.max(8, y), vh - height - 70);
		this.popover.style.left = `${x}px`;
		this.popover.style.top = `${y}px`;
	}

	/**
	 * Mark one element for a screenshot an AI app takes, with everything else
	 * of Sitegloss's hidden; `null` removes it.
	 */
	setTemporaryMark(
		mark: {
			number: number;
			rect: Rect;
			/** A highlight's line boxes (DEC-066), with the ground's darkness. */
			lines?: Rect[];
			dark?: boolean;
		} | null,
	): void {
		this.#marking = mark !== null;
		const drawn: RenderedMark | null =
			mark === null
				? null
				: {
						number: mark.number,
						shape: {
							kind: mark.lines === undefined ? "element" : "box",
							rect: mark.rect,
						},
						...(mark.lines === undefined
							? {}
							: { lines: mark.lines, dark: mark.dark === true }),
					};
		const ink: SVGElement[] = [];
		const plain: SVGElement[] = [];
		if (drawn !== null) {
			this.#drawn(drawn, MARK_COLOUR, {}, ink, plain);
			plain.push(this.#badge(drawn));
		}
		this.#temporary.replaceChildren(...plain);
		this.#inkTemporary.replaceChildren(...ink);
		// Its own class: a save's capturing state must survive an unmark.
		this.layer.classList.toggle("marking", this.#marking);
		this.ink.classList.toggle("marking", this.#marking);
		this.#update();
	}

	#update(): void {
		const shown =
			this.#addingMarks ||
			this.#reviewing ||
			this.#marking ||
			this.#marksHidden;
		this.layer.hidden = !shown;
		this.ink.hidden = !shown;
		this.toolbar.hidden = !this.#addingMarks;
		this.capture.hidden = !this.#addingMarks;
		this.#drafts.style.display = this.#addingMarks ? "" : "none";
		this.#inkDrafts.style.display = this.#addingMarks ? "" : "none";
		// While marks are added the bar steps aside: the toolbar is up, with
		// Done, and nothing of Sitegloss covers what is marked (DEC-061).
		const barWas = this.reviewBar.hidden;
		this.reviewBar.hidden =
			!(this.#reviewing || this.#marksHidden) || this.#addingMarks;
		// Shown again, it is measured where it is kept: inside this window.
		if (barWas && !this.reviewBar.hidden && !this.layer.hidden) this.#drawBar();
		this.#review.style.display = this.#reviewing ? "" : "none";
		this.#inkReview.style.display = this.#reviewing ? "" : "none";
		// Stay on top of elements the page appended later.
		if (shown && this.host.nextElementSibling !== null) this.#place(true);
		if (shown && this.#timer === undefined) {
			this.#timer = setInterval(() => {
				this.#place();
				this.onTick?.();
			}, 500);
		} else if (!shown) {
			clearInterval(this.#timer);
			this.#timer = undefined;
		}
		// Hidden, it has no size to measure: laid out again once it shows.
		this.fitToolbar();
	}

	/**
	 * Lay the toolbar out for the room it has: the first of `TOOLBAR_FITS`
	 * whose buttons stand in one row within the page (with the status beside
	 * them, in the first). Called when the toolbar's parts change, when it
	 * shows and when the page's width changes.
	 */
	fitToolbar(): void {
		const bar = this.toolbar;
		if (this.layer.hidden || bar.hidden) return;
		for (const fit of TOOLBAR_FITS) {
			bar.dataset["fit"] = fit;
			if (this.#toolbarFits(!fit.includes("rows"))) break;
		}
	}

	/** One row that does not overflow (`beside`), or no button on a second row. */
	#toolbarFits(beside: boolean): boolean {
		const bar = this.toolbar;
		if (beside) return bar.scrollWidth <= bar.clientWidth;
		const tops = [...bar.querySelectorAll<HTMLElement>("button")].map(
			(b) => b.offsetTop,
		);
		return Math.max(...tops) - Math.min(...tops) < 8;
	}

	/**
	 * The top layer covers even this overlay: go inside a modal dialog or a
	 * fullscreen element while there is one. `last` also moves the host to the
	 * end of its parent; that costs a field its focus, so not on every tick.
	 */
	#place(last = false): void {
		const doc = this.doc;
		const parent =
			doc.fullscreenElement ?? modalDialog(doc) ?? doc.documentElement;
		const moving = this.host.parentElement !== parent;
		if (!last && !moving) return;
		// Moved for nothing but the order: not while a comment field is open,
		// whose frame a move would load again (DEC-064).
		if (
			!moving &&
			!this.popover.hidden &&
			this.popover.querySelector("iframe.field")
		)
			return;
		// The field that has the focus gets it back after the move.
		const focused = this.root.activeElement;
		if (focused?.tagName === "IFRAME") fieldOf(focused)?.keepFocus();
		// Where the browser can, a move that keeps the frames as they are
		// (`moveBefore`); else the field's frame loads again and gets back its
		// text, label and focus (`PageField`).
		const move = (
			parent as { moveBefore?: (node: Node, child: Node | null) => void }
		).moveBefore;
		try {
			if (typeof move === "function") {
				move.call(parent, this.host, null);
				return;
			}
		} catch {
			// Not movable so: appended as before.
		}
		parent.append(this.host);
	}

	/** Hide all of Sitegloss while a screenshot is taken. */
	setCapturing(on: boolean): void {
		this.layer.classList.toggle("capturing", on);
		this.ink.classList.toggle("capturing", on);
	}

	/**
	 * Draw the marks (saved ones fainter), the one being drawn and the hovered
	 * element's outline. A mark with a clip is cut to it, its pin where `pin`
	 * says (DEC-075): the toolbar's finished marks show only where their
	 * element does, as the loaded case's.
	 */
	render(
		marks: readonly ClippedRendered[],
		preview: Shape | null,
		hover: Rect | null,
		saved: readonly ClippedRendered[] = [],
	): void {
		const doc = this.doc;
		const children: SVGElement[] = [];
		if (hover !== null) {
			const box = {
				class: "hover",
				x: hover.x - 2,
				y: hover.y - 2,
				width: hover.width + 4,
				height: hover.height + 4,
			};
			children.push(
				svg(doc, "rect", {
					...box,
					"data-casing": "",
					fill: "none",
					stroke: L.casing,
					"stroke-width": 2 + CASING_EXTRA,
				}),
				svg(doc, "rect", {
					...box,
					fill: "rgba(31, 111, 235, 0.08)",
					stroke: HOVER_COLOUR,
					"stroke-width": 2,
					"stroke-dasharray": "6 4",
				}),
			);
		}
		const ink: SVGElement[] = [];
		/** One mark's parts into `plain` and `strokes`, cut to its clip. */
		const draw = (
			mark: ClippedRendered,
			strokes: SVGElement[],
			plain: SVGElement[],
		) => {
			const s: SVGElement[] = [];
			const p: SVGElement[] = [];
			this.#drawn(mark, MARK_COLOUR, {}, s, p);
			p.push(this.#badge(mark, MARK_COLOUR, mark.pin));
			if (mark.clip === undefined) {
				strokes.push(...s);
				plain.push(...p);
				return;
			}
			if (s.length > 0) strokes.push(this.#clipped(mark.clip, s));
			plain.push(this.#clipped(mark.clip, p));
		};
		if (saved.length > 0) {
			const group = svg(doc, "g", { class: "saved", opacity: 0.5 });
			const inkGroup = svg(doc, "g", { class: "saved-strokes", opacity: 0.5 });
			const strokes: SVGElement[] = [];
			const parts: SVGElement[] = [];
			for (const mark of saved) draw(mark, strokes, parts);
			group.append(...parts);
			inkGroup.append(...strokes);
			children.push(group);
			ink.push(inkGroup);
		}
		for (const mark of marks) draw(mark, ink, children);
		if (preview !== null) children.push(...this.#shape(preview));
		this.#drafts.replaceChildren(...children);
		this.#inkDrafts.replaceChildren(...ink);
	}

	/**
	 * A mark's drawing: a highlight's strokes (into `ink` on a light ground,
	 * multiplied; into `plain` on a dark one), any other mark's shape into
	 * `plain`. The pin is not part of it.
	 */
	#drawn(
		mark: RenderedMark,
		colour: string,
		look: Record<string, string | number>,
		ink: SVGElement[],
		plain: SVGElement[],
		focused = false,
	): void {
		if (mark.lines === undefined || mark.lines.length === 0) {
			plain.push(...this.#shape(mark.shape, colour, look));
			return;
		}
		const dark = mark.dark === true;
		for (const line of mark.lines)
			(dark ? plain : ink).push(
				svg(this.doc, "path", {
					"data-stroke": "",
					d: markerPath(line),
					fill: HIGHLIGHT_LOOK.colour,
					...(dark ? { opacity: HIGHLIGHT_LOOK.darkOpacity } : {}),
				}),
			);
		// Unsure where it is (dashed), or looked for (focused): an edge in the
		// mark's colour round each line, as the other marks have one.
		const unsure = look["stroke-dasharray"] !== undefined;
		if (unsure || focused)
			for (const line of mark.lines)
				plain.push(
					svg(this.doc, "path", {
						"data-edge": "",
						d: markerPath(line),
						fill: "none",
						stroke: colour,
						"stroke-width": 1.5,
						...(unsure ? { "stroke-dasharray": "6 4" } : {}),
					}),
				);
	}

	/**
	 * Draw a loaded case's marks (window coordinates): the colour is the
	 * mark's status, the dash its match (DEC-024). The focused one also shows
	 * the element it belongs to; an element's mark is that outline.
	 */
	renderReview(items: readonly ReviewItem[]): void {
		const doc = this.doc;
		// A mark of a kind this version does not know has no drawing and no
		// pin: only its element's outline while it is looked for (DEC-066).
		this.#pins = items
			.filter((item) => item.shape.kind !== "unknown")
			.map((item) => ({
				number: item.number,
				// Where it is drawn: moved into what shows of its element (DEC-075).
				...(item.pin ?? pinPosition(item)),
				r: badgeRadius(item.shape),
			}));
		const inkGroups: SVGElement[] = [];
		const groups = items.map((item) => {
			const settled = isSettled(item.status);
			const colour = reviewColour(item);
			const look = reviewStroke(item);
			const group = svg(doc, "g", {
				"data-review": item.number,
				"data-status": item.status,
				...(settled ? { "data-resolved": "" } : {}),
			});
			if (item.focused && item.rect !== null) {
				const box = {
					x: item.rect.x - 3,
					y: item.rect.y - 3,
					width: item.rect.width + 6,
					height: item.rect.height + 6,
					rx: 4,
				};
				group.append(
					svg(doc, "rect", {
						...box,
						"data-casing": "",
						fill: "none",
						stroke: L.casing,
						"stroke-width": 1 + CASING_EXTRA,
					}),
					svg(doc, "rect", {
						...box,
						"data-element": "",
						fill: "rgba(224, 24, 92, 0.08)",
						stroke: colour,
						"stroke-width": 1,
					}),
				);
			}
			const shape: SVGElement[] = [];
			const strokes: SVGElement[] = [];
			this.#drawn(item, colour, look, strokes, shape, item.focused);
			// A focused one is looked for: it shows fully.
			const fade = settled && !item.focused;
			if (fade) {
				const faded = svg(doc, "g", {
					"data-faded": "",
					opacity: RESOLVED_OPACITY,
				});
				faded.append(...shape);
				group.append(faded);
			} else group.append(...shape);
			if (strokes.length > 0) {
				const inkGroup = svg(doc, "g", {
					"data-review": item.number,
					...(fade ? { "data-faded": "", opacity: RESOLVED_OPACITY } : {}),
				});
				inkGroup.append(
					...(item.clip === undefined
						? strokes
						: [this.#clipped(item.clip, strokes)]),
				);
				inkGroups.push(inkGroup);
			}
			if (item.shape.kind !== "unknown")
				group.append(this.#badge(item, colour, item.pin));
			if (item.clip !== undefined)
				group.replaceChildren(this.#clipped(item.clip, [...group.childNodes]));
			return group;
		});
		this.#review.replaceChildren(...groups);
		this.#inkReview.replaceChildren(...inkGroups);
	}

	/**
	 * A mark's shape, each part drawn twice: a white casing (`data-casing`),
	 * wider and never dashed, then the coloured stroke, so the mark has an
	 * edge on a page of its own colour and on a dark one.
	 */
	#shape(
		shape: Shape,
		colour: string = MARK_COLOUR,
		look: Record<string, string | number> = {},
	): SVGElement[] {
		const doc = this.doc;
		const stroke = {
			fill: "none",
			stroke: colour,
			"stroke-width": 3,
			"stroke-linecap": "round",
			"stroke-linejoin": "round",
			...look,
		};
		const casing = {
			"data-casing": "",
			fill: "none",
			stroke: L.casing,
			"stroke-width": Number(stroke["stroke-width"]) + CASING_EXTRA,
			"stroke-linecap": "round",
			"stroke-linejoin": "round",
		};
		const twice = <K extends keyof SVGElementTagNameMap>(
			tag: K,
			geometry: Record<string, string | number>,
		): SVGElement[] => [
			svg(doc, tag, { ...geometry, ...casing }),
			svg(doc, tag, { ...geometry, ...stroke }),
		];
		switch (shape.kind) {
			case "element":
			case "box":
				return twice("rect", {
					x: shape.rect.x,
					y: shape.rect.y,
					width: shape.rect.width,
					height: shape.rect.height,
					rx: 4,
				});
			case "arrow": {
				const { from, to } = shape;
				const [l, r] = arrowHead(from, to);
				const line = { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
				const points = `${to.x},${to.y} ${l.x},${l.y} ${r.x},${r.y}`;
				return [
					svg(doc, "line", { ...line, ...casing }),
					svg(doc, "polygon", {
						points,
						...casing,
						fill: L.casing,
						"stroke-width": CASING_EXTRA,
					}),
					svg(doc, "line", { ...line, ...stroke }),
					svg(doc, "polygon", { points, fill: colour }),
				];
			}
			case "pen":
				return twice("polyline", {
					points: shape.points.map((p) => `${p.x},${p.y}`).join(" "),
				});
			case "note":
			case "unknown":
				return [];
		}
	}

	/**
	 * `parts` cut to `clip` (DEC-075): a nested SVG viewport, whose view box
	 * keeps the window's coordinates. A viewport rather than a `clipPath`,
	 * which an `url(#…)` would have to find in the shadow root.
	 */
	#clipped(clip: Rect, parts: readonly Node[]): SVGElement {
		const box = svg(this.doc, "svg", {
			"data-clip": "",
			x: clip.x,
			y: clip.y,
			width: clip.width,
			height: clip.height,
			viewBox: `${clip.x} ${clip.y} ${clip.width} ${clip.height}`,
			preserveAspectRatio: "none",
			overflow: "hidden",
		});
		box.append(...parts);
		return box;
	}

	#badge(
		mark: RenderedMark,
		colour: string = MARK_COLOUR,
		at: Point = pinPosition(mark),
	): SVGElement {
		const doc = this.doc;
		const g = svg(doc, "g", { "data-number": mark.number });
		g.append(
			svg(doc, "circle", {
				cx: at.x,
				cy: at.y,
				r: badgeRadius(mark.shape),
				fill: colour,
				stroke: L.casing,
				"stroke-width": 2,
			}),
		);
		const text = svg(doc, "text", {
			x: at.x,
			y: at.y,
			fill: "#fff",
			"font-size": pinFontSize(mark.number),
			"font-weight": 700,
			"font-family": "system-ui, sans-serif",
			"text-anchor": "middle",
			"dominant-baseline": "central",
		});
		text.textContent = String(mark.number);
		g.append(text);
		return g;
	}
}
