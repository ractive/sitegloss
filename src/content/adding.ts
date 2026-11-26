/**
 * Adding marks to a page: the tools (element, box, arrow, pen, note, highlight), a comment for
 * each mark, undo, and adding the marks to a case.
 *
 * The toolbar always adds to a case (DEC-014, DEC-026): the one "New case for
 * this page" just created, or the open case's "Add marks". Each mark goes into it
 * as soon as it is done: its comment confirmed, or the comment closed with the
 * mark kept. One queue adds them in order; Undo takes the last one out of the
 * case again. A mark that could not be added stays on the page with the
 * reason and a button to add it again: a failed write, not a draft.
 *
 * A mark's screenshot is taken when the mark is drawn (DEC-012): the page as
 * the user sees it then is the record, whatever it does afterwards. Marks drawn
 * while nothing moved or changed share one screenshot. Screenshots show the
 * page alone; saving draws the marks onto them, so undoing a mark or
 * renumbering marks never touches an image.
 *
 * On the screen a mark follows its element, wherever that scrolls or moves.
 */

import {
	type Case,
	type ElementDetails,
	type Highlight,
	imageScale,
	LANGUAGE,
	MAX_COMMENT,
	MAX_PAGE_TITLE,
	MAX_PEN_POINTS,
	type MarkEnds,
	markIdOf,
	newId,
	type PageInfo,
	type Point,
	pendingImage,
	type Rect,
	type Shape,
	type Shot,
	type SiblingBox,
	shapeBounds,
	translateShape,
} from "../lib/case.ts";
import { clipMark, union } from "../lib/clip.ts";
import { debugLog } from "../lib/debug.ts";
import {
	createContext,
	describeElement,
	documentRect,
	isEditable,
} from "../lib/element.ts";
import { boundsOfRects } from "../lib/highlight.ts";
import { atShot, siblingsOf, withLook } from "../lib/look.ts";
import {
	badgeRadius,
	isDarkGround,
	pinPosition,
	type RenderedMark,
} from "../lib/marks.ts";
import {
	askWorker,
	type CaptureResult,
	type MarkTarget,
	type OverlayState,
	type PanelMarkWhat,
	type WorkerAnswers,
	type WorkerRequest,
} from "../lib/messages.ts";
import { cropRectFor, type MarkDraft } from "../lib/save.ts";
import { parentOf, shadowTrees } from "../lib/shadow.ts";
import {
	type Afterwards,
	AI_TIMEOUT_MS,
	type Exclusive,
	type PageActivity,
	type ShowOptions,
} from "./activity.ts";
import {
	elementAt,
	elementForRect,
	elementForStroke,
	isFlatStroke,
	isOpenStroke,
	markedElementAt,
} from "./anchor.ts";
import type { PageBlur } from "./blur.ts";
import {
	type ClippedRendered,
	type IconName,
	icon,
	type Overlay,
	ring,
	withSaveKey,
} from "./overlay.ts";
import { PageField } from "./page-field.ts";
import { ELEMENT, type NoText, selectedText } from "./text-range.ts";
import { Visibility } from "./visible.ts";

export type Tool = "element" | "box" | "arrow" | "pen" | "note" | "highlight";

const TOOLS: { tool: Tool; label: string; title: string }[] = [
	{ tool: "element", label: "Element", title: "Pick an element" },
	{ tool: "box", label: "Box", title: "Draw a box" },
	{ tool: "arrow", label: "Arrow", title: "Draw an arrow" },
	{ tool: "pen", label: "Pen", title: "Draw freehand" },
	{ tool: "note", label: "Note", title: "Place a note" },
	{
		tool: "highlight",
		label: "Highlight",
		title:
			"Highlight text: select it on the page, or choose this with text selected",
	},
];

/**
 * What the Highlight tool says where it cannot take the text (DEC-066):
 * somebody's input is never recorded, and a picture's text is no text.
 */
const NO_TEXT: Record<NoText | "picture" | "frame" | "component", string> = {
	nothing: "Select some text on the page to highlight it.",
	field:
		"Text in a form field cannot be highlighted: mark the field with the Box tool.",
	typed: "Text in an editor cannot be highlighted: mark it with the Box tool.",
	large:
		"This selection reaches too far into a very long page: select within one section.",
	unseen: "That text is not visible on the page.",
	picture:
		"Text in an image or a canvas cannot be highlighted: mark it with the Box tool.",
	frame:
		"Text inside a frame cannot be highlighted: mark it with the Box tool.",
	component:
		"Text inside this component cannot be highlighted: mark it with the Box tool.",
};

/**
 * How long a double click waits for a third before it takes its word
 * (DEC-066): `click` says how many clicks it is, and a word taken at once
 * would open its dialog, which the third press would close.
 */
const CLICKS_MS =
	typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD
		? 150
		: 450;

/** Elements whose text the Highlight tool cannot select (`NO_TEXT`). */
const PICTURES = new Set([
	"img",
	"canvas",
	"svg",
	"video",
	"picture",
	"object",
	"embed",
]);

/** A place in the page's text, as a caret is (the Highlight tool's drag). */
interface Caret {
	node: Node;
	offset: number;
}

interface Draft {
	number: number;
	/** In document coordinates. */
	shape: Shape;
	comment: string;
	element: Element | null;
	/** Read when the mark was drawn: the element may be gone by saving. */
	details: ElementDetails | null;
	/** An arrow's or an open stroke's elements at its two ends (DEC-047). */
	ends?: MarkEnds;
	/**
	 * A highlight's text and its line boxes in document coordinates
	 * (DEC-066); `dark`: on a dark ground (`HIGHLIGHT_LOOK`).
	 */
	highlight?: Omit<Highlight, "rects"> & { lines: Rect[]; dark: boolean };
	/** The element's box then, in document coordinates. */
	anchor: Rect | null;
	/** The page's address then. */
	url: string;
	/** The window's scroll position then. */
	scroll: Point;
	/** Its screenshot and its place on it, once taken. */
	/**
	 * `box`: the element in the document at the shot, if it moved since
	 * `details`; `siblings`: its neighbours' boxes measured then (DEC-048).
	 */
	shot?: {
		view: View;
		shape: Shape;
		/** A highlight's line boxes on the shot (DEC-066). */
		lines?: Rect[];
		box?: Rect;
		siblings?: SiblingBox[];
	};
	/** The case it was queued for: it never goes into another one unasked. */
	queuedFor?: { caseId: string; title: string };
	/** Why its screenshot could not be taken, if it could not. */
	shotError?: string;
}

/** One screenshot, and the marks that share it. */
interface View {
	shot: Shot;
	page: PageInfo;
	marks: Draft[];
}

interface Drag {
	pointerId: number;
	start: Point;
	points: Point[];
	/** The Highlight tool's: where the selection starts (DEC-066). */
	caret?: Caret;
}

async function ask<R extends WorkerRequest>(
	request: R,
): Promise<WorkerAnswers[R["type"]]> {
	const response = await askWorker(request);
	if (response === undefined) throw new Error("Sitegloss did not answer.");
	if (!response.ok) throw new Error(response.error);
	return response;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The next frame; a tab in the background has none, and then time decides. */
const frame = () =>
	Promise.race([
		new Promise<void>((r) => requestAnimationFrame(() => r())),
		sleep(250),
	]);

// The test build's guards and delays below are short (DEC-053): its clicks
// and pages come fast, and its tests need not sit them out.
declare const SITEGLOSS_TEST_BUILD: boolean | undefined;

/** How long the page must stand still before a mark's screenshot is taken again. */
const STILL_MS =
	typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD
		? 150
		: 800;
/** How long one wait for a still page lasts at most. */
const STILL_WAIT_MS = 5000;
/** How often a mark's screenshot the page moved away from is taken again by itself. */
const AGAIN_TRIES = 3;

/** Chrome allows two screenshots a second; the overlay stays up meanwhile. */
const SHOT_GAP_MS = 620;

const errorText = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/** At most `MAX_PEN_POINTS` points of a stroke, evenly spread. */
function thin(points: Point[]): Point[] {
	if (points.length <= MAX_PEN_POINTS) return points;
	const step = points.length / MAX_PEN_POINTS;
	return Array.from(
		{ length: MAX_PEN_POINTS },
		(_, i) => points[Math.floor(i * step)] as Point,
	);
}

function normalizeRect(a: Point, b: Point): Rect {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		width: Math.abs(a.x - b.x),
		height: Math.abs(a.y - b.y),
	};
}

export class MarkAdder {
	readonly overlay: Overlay;
	/**
	 * "Add another image…" in the mark's dialog (DEC-063): the side panel's dialog
	 * adds the images, never this page (a page reads what is pasted or
	 * dropped in it). Called within the click, for its gesture.
	 */
	onAddImages:
		| ((caseId: string, number: number, what?: PanelMarkWhat) => void)
		| undefined;
	/**
	 * Marks drawn and not in the case yet: a comment being typed, one on its
	 * way, one that could not be added. The case holds every other (DEC-026).
	 */
	#drafts: Draft[] = [];
	/** The target case's marks saved from this page: shown, no longer changed. */
	#savedMarks: Draft[] = [];
	#tool: Tool | null = null;
	/** The page's selection when the Highlight tool's button was pressed: the press takes it away. */
	#selectedAtPress: Range | undefined;
	/** A double click waiting for a third (`CLICKS_MS`), and where it was. */
	#clicks:
		| { timer: ReturnType<typeof setTimeout>; x: number; y: number }
		| undefined;
	#hover: Element | null = null;
	#drag: Drag | null = null;
	#preview: Shape | null = null;
	#editing: Draft | null = null;
	/** The open dialog's comment field: a frame of the extension's own (DEC-064). */
	#field: PageField | undefined;
	#target: MarkTarget | undefined;
	#blurForms = false;
	#message = "";
	#frame = 0;
	#views: View[] = [];
	/** The screenshot the page still looks like, if any: a new mark can share it. */
	#shown: View | undefined;
	/** Screenshots run one after the other; this never rejects. */
	#shots: Promise<void> = Promise.resolve();
	#lastShot = 0;
	/** Where pending screenshots are stored until an add takes them. */
	#pendingCase: string | undefined;
	/** Since the last screenshot, something scrolled or the window changed. */
	#scrolled = true;
	/** Since the last screenshot, the page's DOM changed. */
	#mutated = true;
	#observer: MutationObserver | undefined;
	/** Lets go of the blur while a screenshot is taken. */
	#unblur: (() => void) | undefined;
	/** The last screenshot's page scrolled while it was taken. */
	#shotMoved = false;
	/** When the page last scrolled or the window changed (`Date.now()`). */
	#movedAt = 0;
	/** What changes the case (adds, undos) runs in order. */
	#ops: Promise<void> = Promise.resolve();
	/**
	 * Marks not in the case yet (`#drafts`: a comment being typed, a failed
	 * add too) waiting to be added, or being added now.
	 */
	#queued = new Set<Draft>();
	/** Drafts that could not be added, with why. */
	#failed = new Map<Draft, string>();
	/** Marks this toolbar added to the case, oldest first: Undo takes them out. */
	#added: Draft[] = [];
	/** Marks Undo is taking out of the case. */
	#undoing = new Set<Draft>();
	/** Done was clicked: the toolbar goes once the marks are in. */
	#finishing = false;
	/** Done (or the side panel's end) under way: a second one waits for it. */
	#finishRun: Promise<void> | undefined;
	/** What the side panel last heard: the marks not in the case, the case, an add. */
	#announced = "";
	/** Done found these marks not in the case: Done again discards them. */
	#leftOut: Set<Draft> | undefined;
	/** A failure, said with role="alert" next to the status. */
	#alert = "";
	/** The toolbar's status and alert: kept, and changed in place. */
	readonly #statusEl: HTMLElement;
	readonly #alertEl: HTMLElement;
	/** What each toolbar button does now (#button, #mount). */
	readonly #onClick = new WeakMap<HTMLButtonElement, () => void>();

	readonly #pageBlur: PageBlur;
	readonly #activity: PageActivity;
	/** Where the toolbar's finished marks show (DEC-075), and the page's DOM changes it counts. */
	readonly #visibility: Visibility;
	#changes = 0;
	/** `STILL_MS` and `SHOT_GAP_MS`, unless a unit test gives its own. */
	readonly #stillMs: number;
	readonly #shotGapMs: number;

	constructor(
		overlay: Overlay,
		blur: PageBlur,
		activity: PageActivity,
		timing: { stillMs?: number; shotGapMs?: number } = {},
	) {
		this.overlay = overlay;
		this.#visibility = new Visibility(overlay.doc, overlay.host);
		this.#stillMs = timing.stillMs ?? STILL_MS;
		this.#shotGapMs = timing.shotGapMs ?? SHOT_GAP_MS;
		this.#pageBlur = blur;
		this.#activity = activity;
		this.#statusEl = overlay.doc.createElement("span");
		this.#statusEl.className = "status";
		this.#statusEl.dataset["role"] = "status";
		this.#statusEl.setAttribute("role", "status");
		this.#alertEl = overlay.doc.createElement("span");
		this.#alertEl.className = "status";
		this.#alertEl.dataset["role"] = "alert";
		this.#alertEl.setAttribute("role", "alert");
		// Pressing the Highlight tool's button takes the page's selection
		// away; what it was is what the tool highlights (DEC-066).
		overlay.toolbar.addEventListener(
			"pointerdown",
			(e) => {
				const on = (e.target as Element | null)?.closest?.(
					'[data-action="tool-highlight"]',
				);
				this.#selectedAtPress =
					on && this.#tool !== "highlight" ? this.#selection() : undefined;
			},
			true,
		);
		const capture = overlay.capture;
		capture.addEventListener("pointermove", (e) => this.#move(e));
		capture.addEventListener("pointerdown", (e) => this.#down(e));
		capture.addEventListener("pointerup", (e) => this.#up(e));
		// How many clicks a press is: `click` counts them, `pointerdown` does
		// not (its `detail` is 0 in Chrome, measured).
		capture.addEventListener("click", (e) => this.#clicked(e));
		capture.addEventListener("pointercancel", () => {
			this.#drag = null;
			this.#preview = null;
			this.#render();
		});
		capture.addEventListener("wheel", (e) => this.#wheel(e), {
			passive: false,
		});
		const doc = overlay.doc;
		const win = doc.defaultView;
		const moved = () => {
			this.#scrolled = true;
			this.#movedAt = Date.now();
			this.#schedule();
		};
		// Capture phase: scrolling inside a container moves elements too.
		doc.addEventListener("scroll", moved, { capture: true, passive: true });
		win?.addEventListener("resize", moved);
		// What no mutation shows: typed values, checkboxes, a canvas redrawn.
		for (const type of ["input", "change", "click", "keydown"])
			win?.addEventListener(
				type,
				(e) => {
					if (e.target !== overlay.host) this.#mutated = true;
				},
				true,
			);
		win?.addEventListener(
			"keydown",
			(e) => {
				// The person's own key: the page's scripts can send an Escape too.
				if (!e.isTrusted || !overlay.addingMarks || e.key !== "Escape") return;
				if (this.#editing !== null) this.#escapeComment();
				else if (this.#tool !== null) this.setTool(null);
				else return;
				// It was for Sitegloss, not for a dialog the page has open.
				e.preventDefault();
				e.stopImmediatePropagation();
			},
			true,
		);
		// Marks not in the case yet (a failed add, one on its way) would go.
		win?.addEventListener("beforeunload", (e) => {
			if (this.#drafts.length > 0) e.preventDefault();
		});
		win?.addEventListener("pagehide", (e) => {
			if (!e.persisted) this.#discard(this.#views.map((v) => v.shot.id));
		});
		overlay.onTick = () => this.#render();
		if (win !== null && typeof win.MutationObserver === "function")
			this.#observer = new win.MutationObserver(() => {
				this.#mutated = true;
				this.#changes++;
			});
		this.#renderToolbar();
	}

	state(): OverlayState {
		const state: OverlayState = {
			visible: this.overlay.addingMarks,
			url: location.href,
			title: document.title,
			drafts: this.#drafts.length,
			saving: this.#activity.saving,
		};
		if (this.#target) state.target = this.#target;
		return state;
	}

	/** Show the toolbar adding to `options.target` (DEC-026: never to no case). */
	show(options: ShowOptions): void {
		// During an add its case stays; the new one applies when it is over.
		if (!this.#activity.defer({ kind: "show", options })) {
			const next = options.target;
			if (next.caseId !== this.#target?.caseId) {
				this.#savedMarks = [];
				this.#added = [];
				// Not moved into another case unasked: they wait for "Add mark N".
				for (const d of this.#failed.keys())
					this.#failed.set(d, this.#notFor(d, next));
			}
			this.#target = next;
			this.#blurForms = options.blurForms ?? false;
			this.#message = "";
			this.#alert = "";
			this.#renumber();
			// Marks done and not on their way yet go into it now.
			this.#addDone();
		}
		this.overlay.setAddingMarks(true);
		// What happened while the toolbar was away is not known.
		this.#mutated = true;
		this.#watch();
		this.#renderToolbar();
		this.#render();
	}

	hide(): void {
		// A mark being added finishes first.
		if (this.#activity.defer({ kind: "hide" })) return;
		if (this.#editing !== null) this.#commitComment();
		this.setTool(null);
		this.overlay.setAddingMarks(false);
		this.#observer?.disconnect();
		// Shown again, the page may look different: the next mark takes a new shot.
		this.#shown = undefined;
		this.#retire();
		// Undo reaches only marks added since the toolbar was last shown.
		this.#added = [];
		this.#leftOut = undefined;
	}

	/** The side panel's "Blur form fields in screenshots". */
	setBlurForms(on: boolean): void {
		this.#blurForms = on;
	}

	#watch(): void {
		if (!this.overlay.addingMarks) return;
		// Shadow roots too: a mutation inside one is not reported outside it.
		for (const root of shadowTrees(this.overlay.doc, this.overlay.host))
			this.#observer?.observe(root, {
				subtree: true,
				childList: true,
				attributes: true,
				characterData: true,
			});
	}

	setTool(tool: Tool | null): void {
		if (!this.#activity.saving) this.#message = "";
		this.#alert = "";
		this.#tool = tool;
		this.#hover = null;
		this.#drag = null;
		this.#preview = null;
		const capture = this.overlay.capture;
		capture.classList.toggle("active", tool !== null);
		capture.classList.toggle("element", tool === "element");
		capture.classList.toggle("text", tool === "highlight");
		this.#stopClicks();
		const pressed = this.#selectedAtPress;
		this.#selectedAtPress = undefined;
		this.#renderToolbar();
		this.#render();
		// Text selected before the tool was chosen is what it highlights.
		if (tool === "highlight" && this.#editing === null) {
			const range = pressed ?? this.#selection();
			if (range !== undefined && !range.collapsed) this.#highlight(range);
		}
	}

	// --- the Highlight tool (DEC-066) ----------------------------------------

	/** The page's selection, when it is of the page and not empty. */
	#selection(): Range | undefined {
		const sel = this.overlay.doc.getSelection();
		if (sel === null || sel.rangeCount === 0 || sel.isCollapsed)
			return undefined;
		const range = sel.getRangeAt(0);
		const node = range.commonAncestorContainer;
		// A copy: the live one changes with the selection.
		return node.getRootNode() === this.overlay.root ||
			this.overlay.host.contains(node)
			? undefined
			: range.cloneRange();
	}

	/**
	 * The place in the page's text under a point of the window. The layer
	 * that takes the pointer is let through for the call alone, which is
	 * synchronous: the page gets no event of it.
	 */
	#caretAt(x: number, y: number): Caret | undefined {
		const doc = this.overlay.doc as Document & {
			caretPositionFromPoint?: (
				x: number,
				y: number,
			) => { offsetNode: Node; offset: number } | null;
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		};
		const capture = this.overlay.capture;
		capture.style.pointerEvents = "none";
		let caret: Caret | undefined;
		try {
			// Over Sitegloss's own (a pin, the toolbar), the caret comes back
			// as the host's place in its parent (measured in Chrome): none.
			if (doc.elementFromPoint(x, y) === this.overlay.host) return undefined;
			if (typeof doc.caretPositionFromPoint === "function") {
				const p = doc.caretPositionFromPoint(x, y);
				if (p !== null) caret = { node: p.offsetNode, offset: p.offset };
			} else if (typeof doc.caretRangeFromPoint === "function") {
				const r = doc.caretRangeFromPoint(x, y);
				if (r !== null)
					caret = { node: r.startContainer, offset: r.startOffset };
			}
		} finally {
			capture.style.pointerEvents = "";
		}
		if (
			caret === undefined ||
			caret.node.getRootNode() === this.overlay.root ||
			caret.node === this.overlay.host
		)
			return undefined;
		// Never into an editor: setting the selection there focuses it.
		const at =
			caret.node.nodeType === ELEMENT
				? (caret.node as Element)
				: caret.node.parentElement;
		if (at !== null && isEditable(at)) return undefined;
		return caret;
	}

	/** Why the text under a point cannot be highlighted, if it cannot. */
	#noTextAt(x: number, y: number): string | undefined {
		const el = elementAt(x, y, this.overlay.host);
		if (el === null) return undefined;
		if (el.closest("input, textarea, select") !== null) return NO_TEXT.field;
		if (isEditable(el)) return NO_TEXT.typed;
		if (el.closest("iframe, frame") !== null) return NO_TEXT.frame;
		if (PICTURES.has(el.localName) || el.closest("svg") !== null)
			return NO_TEXT.picture;
		// A component's own text: the caret does not reach into its shadow root.
		if (el.getRootNode() !== this.overlay.doc) return NO_TEXT.component;
		return undefined;
	}

	/**
	 * A double click takes its word once no third click came; a triple click
	 * its paragraph at once (DEC-066).
	 */
	#clicked(e: MouseEvent): void {
		if (this.#tool !== "highlight" || e.detail < 2 || this.#editing !== null)
			return;
		const caret = this.#caretAt(e.clientX, e.clientY);
		if (caret === undefined || this.#noTextAt(e.clientX, e.clientY)) return;
		this.#stopClicks();
		const take = (clicks: number) => {
			this.#clicks = undefined;
			if (this.#tool !== "highlight" || this.#editing !== null) return;
			this.#selectAround(caret, clicks);
			const range = this.#selection();
			if (range !== undefined) this.#highlight(range);
		};
		if (e.detail >= 3) take(3);
		else
			this.#clicks = {
				timer: setTimeout(() => take(2), CLICKS_MS),
				x: e.clientX,
				y: e.clientY,
			};
	}

	/** A double click waiting for a third is given up. */
	#stopClicks(): void {
		if (this.#clicks !== undefined) clearTimeout(this.#clicks.timer);
		this.#clicks = undefined;
	}

	/** The selection from the drag's start to `to`, on the page, as the page would show it. */
	#select(from: Caret, to: Caret): void {
		const sel = this.overlay.doc.getSelection();
		try {
			sel?.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
		} catch {
			// A place the selection cannot reach: it stays as it was.
		}
	}

	/** A double click takes a word, a triple click its paragraph, as on the page. */
	#selectAround(at: Caret, clicks: number): void {
		const sel = this.overlay.doc.getSelection() as
			| (Selection & {
					modify?: (
						alter: string,
						direction: string,
						granularity: string,
					) => void;
			  })
			| null;
		if (sel === null || typeof sel.modify !== "function") return;
		const unit = clicks >= 3 ? "paragraphboundary" : "word";
		try {
			sel.collapse(at.node, at.offset);
			sel.modify("move", "backward", unit);
			sel.modify("extend", "forward", unit);
		} catch {
			// As it was.
		}
	}

	/**
	 * A selection becomes a highlight: the mark's dialog opens at it with the
	 * stroke drawn, the page's own selection goes. Where it cannot, the
	 * toolbar says why.
	 */
	#highlight(range: Range): void {
		const found = selectedText(range);
		if (typeof found === "string") {
			this.#message = NO_TEXT[found];
			this.#renderToolbar();
			return;
		}
		this.overlay.doc.getSelection()?.removeAllRanges();
		const s = this.#scroll();
		const lines = found.lines.map((r) => ({
			...r,
			x: r.x + s.x,
			y: r.y + s.y,
		}));
		const context = createContext(this.overlay.doc);
		const details = withLook(
			describeElement(found.element, context),
			found.element,
			s,
			this.overlay.host,
		);
		this.#add(
			{ kind: "box", rect: boundsOfRects(lines) },
			found.element,
			undefined,
			{
				...found.highlight,
				lines,
				dark: isDarkGround(details.backdrop?.color),
			},
			details,
		);
		if (found.cut) {
			this.#message =
				"Only the first 500 characters and 40 lines are highlighted: a highlight holds no more.";
			this.#renderToolbar();
		}
	}

	// --- pointer -------------------------------------------------------------

	/** The layer that takes the pointer covers the page: pass the wheel on. */
	#wheel(e: WheelEvent): void {
		const win = this.overlay.doc.defaultView;
		const root = this.overlay.doc.scrollingElement;
		let at = elementAt(e.clientX, e.clientY, this.overlay.host);
		for (; at !== null && at !== root; at = parentOf(at)) {
			const { overflowY, overflowX } = win?.getComputedStyle(at) ?? {};
			const scrolls = (overflow: string | undefined) =>
				overflow === "auto" || overflow === "scroll";
			if (
				(scrolls(overflowY) && at.scrollHeight > at.clientHeight) ||
				(scrolls(overflowX) && at.scrollWidth > at.clientWidth)
			) {
				e.preventDefault();
				const unit = e.deltaMode === 1 ? 16 : 1;
				at.scrollBy(e.deltaX * unit, e.deltaY * unit);
				return;
			}
		}
	}

	#scroll(): Point {
		const win = this.overlay.doc.defaultView;
		return { x: win?.scrollX ?? 0, y: win?.scrollY ?? 0 };
	}

	#toDocument(e: PointerEvent): Point {
		const s = this.#scroll();
		return { x: e.clientX + s.x, y: e.clientY + s.y };
	}

	#move(e: PointerEvent): void {
		if (this.#drag === null)
			this.overlay.capture.classList.toggle(
				"pick",
				this.overlay.reviewAt(e.clientX, e.clientY) !== undefined,
			);
		if (this.#tool === "element" && this.#drag === null) {
			this.#hover = elementAt(e.clientX, e.clientY, this.overlay.host);
			this.#schedule();
			return;
		}
		const drag = this.#drag;
		if (drag === null || e.pointerId !== drag.pointerId) return;
		const p = this.#toDocument(e);
		if (this.#tool === "highlight") {
			// Over Sitegloss's own or an editor there is no caret: the
			// selection stays where it last was.
			const to = this.#caretAt(e.clientX, e.clientY);
			if (
				to !== undefined &&
				drag.caret !== undefined &&
				Math.hypot(p.x - drag.start.x, p.y - drag.start.y) >= 3
			)
				this.#select(drag.caret, to);
			return;
		}
		if (this.#tool === "pen") {
			const last = drag.points.at(-1);
			if (last === undefined || Math.hypot(p.x - last.x, p.y - last.y) >= 3)
				drag.points.push(p);
			this.#preview = { kind: "pen", points: [...drag.points] };
		} else if (this.#tool === "box") {
			this.#preview = { kind: "box", rect: normalizeRect(drag.start, p) };
		} else if (this.#tool === "arrow") {
			this.#preview = { kind: "arrow", from: drag.start, to: p };
		}
		this.#schedule();
	}

	#down(e: PointerEvent): void {
		if (e.button !== 0 || this.#tool === null) return;
		e.preventDefault();
		// A double click's word waits for a third click only: any other press
		// (a pin, beside a popover, elsewhere) gives it up (DEC-066).
		const waiting = this.#clicks;
		if (
			waiting !== undefined &&
			!(
				this.#tool === "highlight" &&
				Math.hypot(e.clientX - waiting.x, e.clientY - waiting.y) <= 4 &&
				this.#editing === null &&
				this.overlay.reviewAt(e.clientX, e.clientY) === undefined
			)
		)
			this.#stopClicks();
		if (this.#editing !== null) {
			this.#commitComment();
			return;
		}
		// A loaded mark's pin under the layer that takes the pointer: its
		// comment opens (DEC-027). A click beside an open one closes it.
		const picked = this.overlay.reviewAt(e.clientX, e.clientY);
		if (picked !== undefined) {
			this.overlay.onPick?.(picked);
			return;
		}
		if (this.overlay.dismissPopover()) return;
		const p = this.#toDocument(e);
		if (this.#tool === "highlight") {
			const why = this.#noTextAt(e.clientX, e.clientY);
			const caret =
				why === undefined ? this.#caretAt(e.clientX, e.clientY) : undefined;
			if (caret === undefined) {
				this.#message = why ?? NO_TEXT.nothing;
				this.#renderToolbar();
				this.overlay.doc.getSelection()?.removeAllRanges();
				return;
			}
			if (this.#message !== "") {
				this.#message = "";
				this.#renderToolbar();
			}
			this.#select(caret, caret);
			this.#drag = { pointerId: e.pointerId, start: p, points: [p], caret };
			this.overlay.capture.setPointerCapture?.(e.pointerId);
			return;
		}
		this.#drag = { pointerId: e.pointerId, start: p, points: [p] };
		this.overlay.capture.setPointerCapture?.(e.pointerId);
	}

	#up(e: PointerEvent): void {
		const drag = this.#drag;
		if (drag === null || e.pointerId !== drag.pointerId) return;
		this.#drag = null;
		this.#preview = null;
		const p = this.#toDocument(e);
		const s = this.#scroll();
		const host = this.overlay.host;
		const toWindow = (r: Rect): Rect => ({ ...r, x: r.x - s.x, y: r.y - s.y });
		switch (this.#tool) {
			case "element": {
				const el = elementAt(e.clientX, e.clientY, host);
				if (el !== null)
					this.#add({ kind: "element", rect: documentRect(el, s) }, el);
				break;
			}
			case "box": {
				const rect = normalizeRect(drag.start, p);
				if (rect.width >= 6 && rect.height >= 6)
					this.#add(
						{ kind: "box", rect },
						elementForRect(toWindow(rect), host),
					);
				break;
			}
			case "arrow":
				if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) >= 12) {
					// What it points at, and what it points from (DEC-047).
					const end = markedElementAt(e.clientX, e.clientY, host);
					const start = markedElementAt(
						drag.start.x - s.x,
						drag.start.y - s.y,
						host,
					);
					this.#add({ kind: "arrow", from: drag.start, to: p }, end, {
						start,
						end,
					});
				}
				break;
			case "pen": {
				const points = thin([...drag.points, p]);
				const shape: Shape = { kind: "pen", points };
				const bounds = shapeBounds(shape);
				if (points.length >= 2 && bounds.width + bounds.height >= 8) {
					const first = points[0] as Point;
					const last = points.at(-1) as Point;
					// A line from one thing to another says both (DEC-047).
					// (An underline is open too, but says one thing: no ends.)
					const ends =
						isOpenStroke(points) && !isFlatStroke(bounds)
							? {
									start: markedElementAt(first.x - s.x, first.y - s.y, host),
									end: markedElementAt(last.x - s.x, last.y - s.y, host),
								}
							: undefined;
					this.#add(shape, elementForStroke(toWindow(bounds), host), ends);
				}
				break;
			}
			case "note":
				this.#add(
					{ kind: "note", at: p },
					markedElementAt(e.clientX, e.clientY, host),
				);
				break;
			case "highlight": {
				const range = this.#selection();
				if (range !== undefined) this.#highlight(range);
				break;
			}
			case null:
				break;
		}
		this.#render();
	}

	// --- marks and comments --------------------------------------------------

	/** Number the marks not in the case on from the case's next number. */
	#renumber(): void {
		let next = this.#target?.nextMark ?? 1;
		for (const draft of this.#drafts) draft.number = next++;
		if (this.#editing === null) return;
		const { number } = this.#editing;
		const { popover } = this.overlay;
		const pin = popover.querySelector(".pin");
		if (pin !== null) pin.textContent = String(number);
		if (this.#field !== undefined)
			this.#field.label = `Comment for mark ${number}`;
	}

	#nextNumber(): number {
		const first = this.#target?.nextMark ?? 1;
		return Math.max(first - 1, ...this.#drafts.map((d) => d.number)) + 1;
	}

	#add(
		shape: Shape,
		element: Element | null,
		ends?: { start: Element | null; end: Element | null },
		highlight?: Draft["highlight"],
		described?: ElementDetails,
	): void {
		const context = createContext(this.overlay.doc);
		const details = (el: Element | null) =>
			el === null ? null : describeElement(el, context);
		const draft: Draft = {
			number: this.#nextNumber(),
			shape,
			comment: "",
			element,
			// How the mark's own element looks, once, now (DEC-048); not its ends'.
			details:
				element === null
					? null
					: (described ??
						withLook(
							describeElement(element, context),
							element,
							this.#scroll(),
							this.overlay.host,
						)),
			...(ends === undefined
				? {}
				: { ends: { start: details(ends.start), end: details(ends.end) } }),
			...(highlight === undefined ? {} : { highlight }),
			anchor: element === null ? null : documentRect(element, this.#scroll()),
			url: location.href,
			scroll: this.#scroll(),
		};
		this.#message = "";
		this.#alert = "";
		this.#leftOut = undefined;
		this.#drafts.push(draft);
		this.#openComment(draft);
		this.#shootLater(draft);
		this.#renderToolbar();
	}

	/** Take a draft out, with its screenshot if no other mark shares it. */
	#forget(draft: Draft): void {
		this.#drafts = this.#drafts.filter((d) => d !== draft);
		const view = draft.shot?.view;
		if (view === undefined) return;
		view.marks = view.marks.filter((d) => d !== draft);
		if (view.marks.length > 0) {
			this.#retire();
			return;
		}
		this.#views = this.#views.filter((v) => v !== view);
		if (this.#shown === view) this.#shown = undefined;
		this.#discard([view.shot.id]);
	}

	#openComment(draft: Draft): void {
		this.#editing = draft;
		const doc = this.overlay.doc;
		const pin = doc.createElement("span");
		pin.className = "pin";
		pin.textContent = String(draft.number);
		const label = doc.createElement("div");
		label.className = "label";
		label.append(pin, "Comment");
		const caseId = this.#target?.caseId;
		const field = new PageField(doc, {
			label: `Comment for mark ${draft.number}`,
			value: draft.comment,
			maxLength: MAX_COMMENT,
		});
		field.onSubmit = () => this.#commitComment();
		// The page refused the field's frame: the mark goes in, and its
		// comment is written in the side panel (DEC-064).
		field.onPanel = () => {
			if (caseId === undefined) return;
			this.onAddImages?.(caseId, draft.number, "comment");
			this.#commitComment();
		};
		// Escape in the field, as on the page.
		field.onEscape = () => {
			if (this.#editing === draft) this.#escapeComment();
		};
		this.#field = field;
		const done = doc.createElement("button");
		done.type = "button";
		done.className = "primary";
		done.dataset["action"] = "comment-done";
		done.textContent = "Done";
		withSaveKey(done);
		done.addEventListener("click", () => this.#commitComment());
		const remove = doc.createElement("button");
		remove.type = "button";
		remove.dataset["action"] = "comment-remove";
		// This dialog opens once, as the mark is drawn: taking it back is a
		// Cancel, not the deleting of a mark that was kept (the owner).
		remove.textContent = "Cancel";
		remove.title = "Take this mark back";
		remove.addEventListener("click", () => this.#cancelDraft(draft));
		const row = doc.createElement("div");
		row.className = "row";
		row.append(remove, done);
		const image = doc.createElement("button");
		image.type = "button";
		image.dataset["action"] = "comment-image";
		// The words of a loaded mark's popover: its screenshot is its first picture.
		image.textContent = "Add another image…";
		image.title =
			"Done with this mark, and add images to it in the side panel: pasted or dropped here, the page could read them";
		image.hidden = caseId === undefined || this.onAddImages === undefined;
		image.addEventListener("click", () => {
			if (caseId === undefined) return;
			this.onAddImages?.(caseId, draft.number);
			this.#commitComment();
		});
		const more = doc.createElement("div");
		more.className = "row images";
		more.append(image);
		// A loaded mark's popover opened over this one (DEC-027): the comment
		// typed so far is the mark's, as after a click beside it.
		this.overlay.openPopover([label, field.element, more, row], () => {
			if (this.#editing === draft) this.#commitComment();
		});
		this.#placePopover(draft);
		field.focus();
	}

	#placePopover(draft: Draft): void {
		this.overlay.placePopover(shapeBounds(this.#onWindow(draft)));
	}

	/**
	 * Escape in the dialog of a mark just drawn: with nothing written, the
	 * mark is taken back, as Cancel does (the owner: the button says Cancel,
	 * and Escape did the opposite); with something written, the mark is kept
	 * with it, so that Escape never throws words away.
	 */
	#escapeComment(): void {
		const draft = this.#editing;
		if (draft !== null && (this.#field?.value.trim() ?? "") === "") {
			this.#cancelDraft(draft);
			return;
		}
		this.#commitComment();
	}

	/** Cancel, or Escape with nothing written: the mark just drawn goes, and the toolbar says so. */
	#cancelDraft(draft: Draft): void {
		this.#forget(draft);
		this.#message = `Mark ${draft.number} taken back`;
		this.#closeComment();
	}

	#commitComment(): void {
		const draft = this.#editing;
		const field = this.#field;
		if (draft !== null && field !== undefined)
			draft.comment = field.value.trim();
		this.#closeComment();
		this.#addDone();
	}

	#closeComment(): void {
		this.#editing = null;
		this.#field = undefined;
		this.overlay.closePopover();
		this.#renderToolbar();
		this.#render();
	}

	/**
	 * Take back the last mark: a draft goes from the page; a mark added to the
	 * case (or on its way there) is taken out of the case too, in turn.
	 */
	undo(): void {
		this.#message = "";
		this.#alert = "";
		const last = lastMark(
			[...this.#drafts, ...this.#added].filter((d) => !this.#undoing.has(d)),
		);
		if (last === undefined) {
			// Nothing to take back.
		} else if (this.#drafts.includes(last) && !this.#queued.has(last)) {
			this.#failed.delete(last);
			this.#forget(last);
			if (last === this.#editing) this.#closeComment();
		} else {
			this.#undoing.add(last);
			this.#queue(() => this.#undoAdded(last));
		}
		this.#renderToolbar();
		this.#render();
	}

	// --- rendering -----------------------------------------------------------

	#schedule(): void {
		if (this.#frame !== 0) return;
		this.#frame = requestAnimationFrame(() => {
			this.#frame = 0;
			this.#render();
		});
	}

	/**
	 * How far a mark's document coordinates are from the window's now: with
	 * its element, if that is still there; `box`: the element's box then.
	 */
	#delta(draft: Draft): { x: number; y: number; box?: DOMRect } {
		const s = this.#scroll();
		const box = draft.element?.isConnected
			? draft.element.getBoundingClientRect()
			: undefined;
		if (
			box === undefined ||
			draft.anchor === null ||
			(box.width === 0 && box.height === 0)
		)
			return { x: -s.x, y: -s.y };
		return { x: box.x - draft.anchor.x, y: box.y - draft.anchor.y, box };
	}

	/** A mark in window coordinates: with its element, if that is still there. */
	#onWindow(draft: Draft): Shape {
		const d = this.#delta(draft);
		if (draft.shape.kind === "element" && d.box !== undefined) {
			const { x, y, width, height } = d.box;
			return { kind: "element", rect: { x, y, width, height } };
		}
		return translateShape(draft.shape, d.x, d.y);
	}

	/** A highlight's line boxes in window coordinates, as `#onWindow` moves its box. */
	#linesOnWindow(draft: Draft): Rect[] | undefined {
		if (draft.highlight === undefined) return undefined;
		const d = this.#delta(draft);
		return draft.highlight.lines.map((r) => ({
			...r,
			x: r.x + d.x,
			y: r.y + d.y,
		}));
	}

	/** A mark as the overlay draws it now. */
	#drawnNow(draft: Draft): RenderedMark {
		const lines = this.#linesOnWindow(draft);
		return {
			number: draft.number,
			shape: this.#onWindow(draft),
			...(lines === undefined
				? {}
				: { lines, dark: draft.highlight?.dark === true }),
		};
	}

	/** Marks whose element left (another route, a menu that closed) stay off the page. */
	#onPage(draft: Draft): boolean {
		return draft.element === null
			? draft.url === location.href
			: draft.element.isConnected;
	}

	#render(): void {
		if (!this.overlay.addingMarks) return;
		const s = this.#scroll();
		const toWindow = (shape: Shape) => translateShape(shape, -s.x, -s.y);
		const hover =
			this.#tool === "element" && this.#hover !== null
				? this.#hover.getBoundingClientRect()
				: null;
		this.#visibility.begin();
		const rendered = (marks: Draft[]) =>
			marks
				.filter((d) => this.#onPage(d))
				.flatMap((d) => {
					const shown = this.#inView(d);
					return shown === null ? [] : [shown];
				});
		this.overlay.render(
			rendered(this.#drafts),
			this.#preview === null ? null : toWindow(this.#preview),
			hover === null
				? null
				: { x: hover.x, y: hover.y, width: hover.width, height: hover.height },
			rendered(this.#savedMarks),
		);
		if (this.#editing !== null) this.#placePopover(this.#editing);
		if (this.#visibility.pending) this.#schedule();
	}

	/**
	 * A mark as drawn now, cut to where its element shows (DEC-075), `null`
	 * when nothing of it does: a finished mark of the toolbar's is drawn as
	 * the loaded case's would be. The one whose comment is open stays whole
	 * under the pointer, and so does a mark without an element.
	 */
	#inView(draft: Draft): ClippedRendered | null {
		const drawn = this.#drawnNow(draft);
		const el = draft.element;
		if (draft === this.#editing || el === null || !el.isConnected) return drawn;
		const r = el.getBoundingClientRect();
		if (r.width === 0 && r.height === 0) return drawn;
		const rect = { x: r.x, y: r.y, width: r.width, height: r.height };
		const bounds = shapeBounds(drawn.shape);
		const pin = pinPosition(drawn);
		const radius = badgeRadius(drawn.shape);
		const reach = union(union(rect, bounds), {
			x: pin.x - radius,
			y: pin.y - radius,
			width: 2 * radius,
			height: 2 * radius,
		});
		const view = this.#visibility.viewOf(el, rect, reach, this.#changes);
		const clipped = clipMark({ element: rect, bounds, pin, radius, view });
		return clipped === null ? null : { ...drawn, ...clipped };
	}

	#button(
		label: string,
		action: string,
		onClick: () => void,
		image?: IconName,
	): HTMLButtonElement {
		const doc = this.overlay.doc;
		const b = doc.createElement("button");
		b.type = "button";
		if (image !== undefined) b.append(icon(doc, image));
		// Its own element: on a narrow page only the icon shows (overlay.ts).
		if (label !== "") {
			const word = doc.createElement("span");
			word.className = "word";
			word.textContent = label;
			b.append(word);
		}
		b.dataset["action"] = action;
		this.#onClick.set(b, onClick);
		// What a click does is looked up then: a button kept through a
		// re-render (#mount) does what the newest render says.
		b.addEventListener("click", () => this.#onClick.get(b)?.());
		return b;
	}

	/**
	 * The case the toolbar adds to was loaded onto the page: its loaded marks
	 * draw the toolbar's own. Undo keeps what it may take back: the copy
	 * loaded may be older than a mark just added.
	 */
	caseLoaded(caseId: string): void {
		if (this.#target?.caseId !== caseId) return;
		this.#savedMarks = [];
		this.#render();
	}

	/**
	 * The case the toolbar adds to changed: deleted marks leave the saved ones
	 * drawn faintly, and where its marks are loaded those draw them instead.
	 */
	caseChanged(c: Case, loaded: boolean): void {
		if (this.#target?.caseId !== c.id) return;
		const numbers = new Set(c.marks.map((x) => x.number));
		this.#savedMarks = loaded
			? []
			: this.#savedMarks.filter((d) => numbers.has(d.number));
		this.#added = this.#added.filter((d) => numbers.has(d.number));
		this.#render();
	}

	/**
	 * The case the toolbar adds to was renamed (DEC-026): "Adding to “<title>”"
	 * and the marks still on their way say its new title.
	 */
	setTitle(caseId: string, title: string): void {
		if (this.#target?.caseId !== caseId) return;
		this.#target = { ...this.#target, title };
		for (const d of this.#drafts)
			if (d.queuedFor?.caseId === caseId) d.queuedFor = { caseId, title };
		// "Mark 2 added to “<old title>”" says no more than the status now.
		if (!this.#activity.saving) this.#message = "";
		this.#renderToolbar();
	}

	/**
	 * The side panel closes the case (DEC-023): finish as Done does and, once
	 * the toolbar is hidden, add to no case any more, until it is shown for
	 * one again. A mark that could not be added keeps the toolbar up, adding
	 * to the case, unless `discard` (the second "← All cases", the case
	 * deleted): then the marks not in the case go.
	 * Without `retry` it is Done's own second click where an earlier Done left
	 * marks out (they go); with it they are tried once more.
	 */
	async end(
		caseId: string,
		{
			discard = false,
			retry = false,
		}: { discard?: boolean; retry?: boolean } = {},
	): Promise<void> {
		// "Add marks" for it waits for another case's add: it is not shown then.
		const deferred = this.#activity.deferred;
		if (deferred?.kind === "show" && deferred.options.target.caseId === caseId)
			this.#activity.defer({ kind: "hide" });
		if (this.#target?.caseId !== caseId) return;
		// Not a Done again: what an earlier Done left out is tried once more.
		if (retry) this.#leftOut = undefined;
		if (discard) await this.#discardLeft();
		else await this.#finish();
		// Shown for another case meanwhile, or a mark is still not in this one.
		if (this.#target?.caseId !== caseId || this.overlay.addingMarks) return;
		this.#forgetTarget();
	}

	/** Add to no case any more: the toolbar is shown again only for one. */
	#forgetTarget(): void {
		this.#target = undefined;
		this.#savedMarks = [];
		this.#added = [];
		this.#failed.clear();
		for (const d of this.#drafts) delete d.queuedFor;
		this.#leftOut = undefined;
		this.#alert = "";
		this.#message = "";
		this.#renumber();
		this.#renderToolbar();
		this.#render();
	}

	/**
	 * Leave without the marks that are not in the case: the toolbar goes at
	 * once its queue is empty (a mark being added goes in), a comment being
	 * typed goes with its mark.
	 */
	async #discardLeft(): Promise<void> {
		await this.#finishRun;
		const editing = this.#editing;
		if (editing !== null) {
			this.#forget(editing);
			this.#closeComment();
		}
		this.setTool(null);
		this.#finishing = true;
		this.#renderToolbar();
		try {
			await this.#settled();
		} finally {
			this.#finishing = false;
		}
		for (const d of [...this.#drafts]) {
			this.#failed.delete(d);
			this.#forget(d);
		}
		this.#leftOut = undefined;
		this.#alert = "";
		this.#message = "";
		this.hide();
		this.#renderToolbar();
	}

	/** Until the queue is empty, with what was queued meanwhile. */
	async #settled(): Promise<void> {
		for (let ops = this.#ops; ; ops = this.#ops) {
			await ops;
			if (ops === this.#ops) return;
		}
	}

	/**
	 * Tell the side panel when what it shows of the page changed (how many
	 * marks are not in the case, the case added to, an add under way): it
	 * opens the case a toolbar adds to (DEC-023) and says when a mark keeps
	 * "← All cases" waiting.
	 */
	#announce(): void {
		const now = JSON.stringify([
			this.#drafts.length,
			this.#target?.caseId,
			this.#activity.saving,
		]);
		if (now === this.#announced) return;
		this.#announced = now;
		this.overlay.onChange?.();
	}

	#renderToolbar(): void {
		this.#announce();
		const doc = this.overlay.doc;
		const bar = this.overlay.toolbar;
		const brand = ring(doc);
		const sep = () => {
			const s = doc.createElement("span");
			s.className = "sep";
			return s;
		};
		const target = this.#target;
		const tools = TOOLS.map(({ tool, label, title }) => {
			const b = this.#button(
				label,
				`tool-${tool}`,
				() => this.setTool(this.#tool === tool ? null : tool),
				tool,
			);
			b.title = title;
			b.setAttribute("aria-pressed", String(this.#tool === tool));
			return b;
		});
		const undo = this.#button("Undo", "undo", () => this.undo(), "undo");
		const last = lastMark(
			[...this.#drafts, ...this.#added].filter((d) => !this.#undoing.has(d)),
		);
		undo.disabled = last === undefined;
		if (last !== undefined)
			undo.title =
				target !== undefined && !this.#drafts.includes(last)
					? `Delete mark ${last.number} from “${target.title}”`
					: `Delete mark ${last.number}`;
		const middle: Element[] = [undo];
		const failed = [...this.#failed.keys()];
		if (target !== undefined && failed.length > 0) {
			const again = this.#button(
				failed.length === 1
					? `Add mark ${(failed[0] as Draft).number}`
					: `Add ${failed.length} marks`,
				"retry",
				() => this.#retry(),
			);
			again.className = "primary";
			again.title = `Try again to add to “${target.title}”`;
			middle.push(again);
		}
		const top = bar.classList.contains("top");
		const move = this.#button(
			"",
			"move-toolbar",
			() => {
				bar.classList.toggle("top");
				this.#renderToolbar();
			},
			top ? "down" : "up",
		);
		move.title = top ? "Move the toolbar down" : "Move the toolbar up";
		move.setAttribute("aria-label", move.title);
		const close = this.#button(
			"Done",
			"close",
			() => void this.#finish(),
			"close",
		);
		// As an icon on a narrow page it needs its tooltip, as every other one.
		close.title =
			this.#leftOut === undefined
				? "Stop adding marks"
				: "Delete the marks that are not in the case, and stop";
		close.disabled = this.#finishing;
		this.#mount(
			[brand, ...tools, sep(), ...middle, sep()],
			this.#message || this.#statusText(),
			[close, move],
		);
	}

	/**
	 * Put the toolbar's parts around its status and alert, which stay where
	 * they are (live regions are announced when changed in place), and give
	 * the focus back to the button that had it.
	 */
	#mount(before: Element[], status: string, after: Element[]): void {
		const bar = this.overlay.toolbar;
		const root = bar.getRootNode() as Document | ShadowRoot;
		const focused = root.activeElement;
		const action =
			focused instanceof HTMLElement && bar.contains(focused)
				? focused.dataset["action"]
				: undefined;
		const statusEl = this.#statusEl;
		const alertEl = this.#alertEl;
		if (statusEl.textContent !== status) statusEl.textContent = status;
		statusEl.hidden = status === "";
		const alert = this.#alert || this.#failureText();
		if (alertEl.textContent !== alert) alertEl.textContent = alert;
		alertEl.hidden = alert === "";
		// A button already there stays the same element (a click pressed on it
		// before this render still lands: Chrome sends it to the element both
		// mousedown and mouseup were on) and takes the new one's state.
		const kept = new Map<string, HTMLButtonElement>();
		// By tag name, not instanceof: the page's realm is not the script's.
		const isButton = (el: Element): el is HTMLButtonElement =>
			el.tagName === "BUTTON";
		for (const child of bar.children) {
			const action = isButton(child) ? child.dataset["action"] : undefined;
			if (action !== undefined && isButton(child)) kept.set(action, child);
		}
		const reuse = (el: Element): Element => {
			if (!isButton(el)) return el;
			const action = el.dataset["action"];
			const old = action === undefined ? undefined : kept.get(action);
			if (old === undefined || action === undefined) return el;
			kept.delete(action);
			this.#takeOver(old, el);
			return old;
		};
		const wanted = [
			...before.map(reuse),
			statusEl,
			alertEl,
			...after.map(reuse),
		];
		for (const child of [...bar.children])
			if (!wanted.includes(child)) child.remove();
		// In order, moving only what is out of place.
		let at: ChildNode | null = bar.firstChild;
		for (const node of wanted) {
			if (node === at) at = at.nextSibling;
			else bar.insertBefore(node, at);
		}
		// Other parts, other widths: laid out for the room there is.
		this.overlay.fitToolbar();
		if (action !== undefined)
			bar
				.querySelector<HTMLElement>(`[data-action="${CSS.escape(action)}"]`)
				?.focus();
	}

	/** `old`, kept in the toolbar, takes `fresh`'s attributes, content and action. */
	#takeOver(old: HTMLButtonElement, fresh: HTMLButtonElement): void {
		for (const { name } of [...old.attributes])
			if (!fresh.hasAttribute(name)) old.removeAttribute(name);
		for (const { name, value } of [...fresh.attributes])
			if (old.getAttribute(name) !== value) old.setAttribute(name, value);
		old.disabled = fresh.disabled;
		if (old.innerHTML !== fresh.innerHTML)
			old.replaceChildren(...fresh.childNodes);
		const run = this.#onClick.get(fresh);
		if (run !== undefined) this.#onClick.set(old, run);
	}

	/** Why the last mark that could not be added is not in the case. */
	#failureText(): string {
		if (this.#target === undefined) return "";
		const last = [...this.#failed].at(-1);
		return last === undefined
			? ""
			: `Mark ${last[0].number} was not added: ${last[1]}`;
	}

	/** What the toolbar says when nothing just happened. */
	#statusText(): string {
		const target = this.#target;
		// Shown only for a case; between its end and its hiding, nothing.
		if (target === undefined) return "";
		const failed = [...this.#failed.keys()];
		if (failed.length === 1)
			return `Mark ${(failed[0] as Draft).number} is not in “${target.title}” yet`;
		if (failed.length > 1)
			return `${failed.length} marks are not in “${target.title}” yet`;
		return `Adding to “${target.title}”`;
	}

	// --- screenshots ---------------------------------------------------------

	#pendingId(): string {
		this.#pendingCase ??= newId("c");
		return this.#pendingCase;
	}

	/**
	 * Views no mark waits for and the page no longer looks like: their pending
	 * screenshots go (marks added one by one leave them for the next mark).
	 */
	#retire(): void {
		const gone = this.#views.filter(
			(v) =>
				v !== this.#shown && !v.marks.some((d) => this.#drafts.includes(d)),
		);
		if (gone.length === 0) return;
		this.#views = this.#views.filter((v) => !gone.includes(v));
		this.#discard(gone.map((v) => v.shot.id));
	}

	#discard(shotIds: string[]): void {
		if (shotIds.length === 0) return;
		const caseId = this.#pendingId();
		ask({ type: "images:discard", caseId, shotIds }).catch((error: unknown) =>
			debugLog("discard images", error),
		);
	}

	/**
	 * Give a mark a screenshot, after the ones already on their way. Whether it
	 * shares the last one is decided now: by its turn the page may have moved on.
	 */
	#shootLater(draft: Draft): void {
		const same = !this.#scrolled && !this.#mutated;
		const shape = this.#onWindow(draft);
		const lines = this.#linesOnWindow(draft);
		this.#shots = this.#shots
			.then(() => this.#shoot(draft, same, shape, lines))
			.catch((error: unknown) => {
				draft.shotError = errorText(error);
				this.#message = `No screenshot of mark ${draft.number} yet: ${draft.shotError}`;
				this.#renderToolbar();
			});
	}

	async #shoot(
		draft: Draft,
		same: boolean,
		drawn: Shape,
		lines: Rect[] | undefined,
	): Promise<void> {
		if (draft.shot !== undefined || !this.#drafts.includes(draft)) return;
		const shown = this.#shown;
		if (same && shown !== undefined && shown.shot.url === draft.url) {
			shown.marks.push(draft);
			draft.shot = {
				view: shown,
				shape: drawn,
				...(lines === undefined ? {} : { lines }),
			};
			return;
		}
		await this.#take(draft, drawn);
	}

	/** Wait for the page: an AI app's screenshot is over soon, or times out. */
	async #hold(kind: Extract<Exclusive, "shot" | "saving">): Promise<void> {
		for (let waited = 0; ; waited += 200) {
			const started = this.#activity.begin(kind);
			if (started.ok) return;
			if (waited > AI_TIMEOUT_MS) throw new Error(started.error);
			await sleep(200);
		}
	}

	#scrollTo(to: Point): void {
		const now = this.#scroll();
		if (now.x !== to.x || now.y !== to.y)
			this.overlay.doc.defaultView?.scrollTo({
				left: to.x,
				top: to.y,
				behavior: "instant",
			});
	}

	/** The screenshot is taken: the page and the overlay are back. */
	captured(): void {
		if (this.#unblur === undefined) return;
		this.#unblur();
		this.#unblur = undefined;
		this.#shotMoved = this.#scrolled;
		this.overlay.setCapturing(false);
		this.#watch();
	}

	/**
	 * A new screenshot of the page as it is, for `draft`. With `drawn`, where the
	 * mark was drawn, it is given up when the page moved on: the image would not
	 * show the mark, and the page is not moved while the user works. Adding it
	 * again ("Add mark N", Done) then takes it, without `drawn`.
	 */
	async #take(draft: Draft, drawn?: Shape): Promise<void> {
		await this.#hold("shot");
		try {
			const gap = this.#lastShot + this.#shotGapMs - Date.now();
			if (gap > 0) await sleep(gap);
			if (drawn !== undefined) {
				const now = shapeBounds(this.#onWindow(draft));
				const then = shapeBounds(drawn);
				if (now.x !== then.x || now.y !== then.y || location.href !== draft.url)
					return;
			}
			const win = this.overlay.doc.defaultView as Window;
			const shotId = newId("p");
			this.#shown = undefined;
			// The blur changes the page's DOM, which is no change of the page.
			this.#observer?.disconnect();
			this.overlay.setCapturing(true);
			this.#unblur = this.#pageBlur.hold(this.#blurForms);
			let image: CaptureResult;
			let shape: Shape;
			let lines: Rect[] | undefined;
			let box: Rect | undefined;
			let siblings: SiblingBox[] | undefined;
			let scroll: Point;
			let viewport: PageInfo["viewport"];
			try {
				// Two frames: the first paints what was just changed.
				await frame();
				await frame();
				shape = this.#onWindow(draft);
				lines = this.#linesOnWindow(draft);
				scroll = this.#scroll();
				box = this.#boxOn(draft, scroll);
				// The neighbours at the same moment as the box (DEC-048).
				if (box !== undefined && draft.element !== null)
					siblings = siblingsOf(draft.element, scroll, this.overlay.host);
				viewport = {
					width: win.innerWidth,
					height: win.innerHeight,
					dpr: win.devicePixelRatio || 1,
				};
				this.#scrolled = false;
				this.#mutated = false;
				image = await ask({
					type: "capture",
					caseId: this.#pendingId(),
					shotId,
				});
			} finally {
				this.captured();
				this.#lastShot = Date.now();
			}
			// The coordinates are from before: the image may be from after.
			if (this.#shotMoved && drawn !== undefined) {
				this.#discard([shotId]);
				return;
			}
			const view = this.#view(shotId, scroll, viewport, image);
			view.marks.push(draft);
			this.#views.push(view);
			this.#shown = view;
			// The one shown before may be needed no longer.
			this.#retire();
			draft.shot = {
				view,
				shape,
				...(lines === undefined ? {} : { lines }),
				...(box ? { box } : {}),
				...(siblings ? { siblings } : {}),
			};
			// Undone while it was being taken.
			if (!this.#drafts.includes(draft)) this.#forget(draft);
		} finally {
			this.#activity.end("shot");
		}
	}

	/** Adding a mark again, nobody is using the page: back to where it was drawn. */
	async #takeBack(draft: Draft, strict = false): Promise<void> {
		const win = this.overlay.doc.defaultView as Window;
		const here = this.#scroll();
		this.#scrollTo(draft.scroll);
		const at = shapeBounds(this.#onWindow(draft));
		if (
			at.x + at.width < 0 ||
			at.y + at.height < 0 ||
			at.x > win.innerWidth ||
			at.y > win.innerHeight
		)
			draft.element?.scrollIntoView({
				block: "center",
				inline: "nearest",
				behavior: "instant",
			});
		try {
			// `strict`: given up again if the page moves meanwhile, as a shot
			// taken when the mark is drawn is (#take, #shotMoved).
			await this.#take(draft, strict ? this.#onWindow(draft) : undefined);
		} finally {
			this.#scrollTo(here);
		}
	}

	/**
	 * Until the page has stood still for a moment (no scroll, no resize) and
	 * nobody is drawing or typing a comment, `STILL_WAIT_MS` at most; whether
	 * it did.
	 */
	async #still(): Promise<boolean> {
		const end = Date.now() + STILL_WAIT_MS;
		for (;;) {
			if (
				Date.now() - this.#movedAt >= this.#stillMs &&
				this.#drag === null &&
				this.#editing === null
			)
				return true;
			if (Date.now() > end) return false;
			await sleep(100);
		}
	}

	/** Where a mark's element is now, in the document, if it has a box. */
	#boxOn(draft: Draft, scroll: Point): Rect | undefined {
		if (!draft.element?.isConnected) return undefined;
		const box = documentRect(draft.element, scroll);
		return box.width === 0 && box.height === 0 ? undefined : box;
	}

	#view(
		shotId: string,
		scroll: Point,
		viewport: PageInfo["viewport"],
		image: CaptureResult,
	): View {
		const doc = this.overlay.doc;
		return {
			shot: {
				id: shotId,
				image: pendingImage(shotId),
				scrollX: scroll.x,
				scrollY: scroll.y,
				viewport: {
					...viewport,
					dpr: imageScale(image.width, viewport.width, viewport.dpr),
				},
				capturedAt: new Date().toISOString(),
				url: location.href,
			},
			page: pageInfo(doc, viewport),
			marks: [],
		};
	}

	// --- what an add stores ---------------------------------------------------

	/** What the case stores for a draft that has its screenshot. */
	#markOf(d: Draft): MarkDraft {
		const { view, shape, lines, box, siblings } = d.shot as NonNullable<
			Draft["shot"]
		>;
		return {
			id: markIdOf(d.number),
			number: d.number,
			shot: view.shot.id,
			comment: d.comment,
			author: "user",
			shape,
			// Where the shot shows it: loading places the mark relative to it;
			// its neighbours as they were then, not when it was drawn (DEC-048).
			element: d.details && box ? atShot(d.details, box, siblings) : d.details,
			...(d.ends === undefined ? {} : { ends: d.ends }),
			// The text and its lines where the shot shows them (DEC-066).
			...(d.highlight === undefined || lines === undefined
				? {}
				: {
						highlight: {
							text: d.highlight.text,
							...(d.highlight.before === undefined
								? {}
								: { before: d.highlight.before }),
							...(d.highlight.after === undefined
								? {}
								: { after: d.highlight.after }),
							rects: lines,
						},
					}),
			cropRect: cropRectFor(shapeBounds(shape), view.shot.viewport),
		};
	}

	/** What to do once an add is over and the page free again: hide only after a success. */
	#afterwards(afterwards: Afterwards | undefined, ok: boolean): void {
		if (afterwards?.kind === "hide") {
			// A failure stays up with its error, or its marks would be lost.
			if (ok) this.hide();
		} else if (afterwards?.kind === "show") {
			const message = this.#message;
			this.show(afterwards.options);
			this.#message = message;
		}
	}

	// --- adding to a case, mark by mark ---------------------------------------

	/** Run `op` after everything that changes the case before it. */
	#queue(op: () => Promise<void>): void {
		this.#ops = this.#ops.then(op).catch((error: unknown) => {
			this.#message = errorText(error);
			this.#renderToolbar();
		});
	}

	/** Queue every mark that is done and not on its way yet. */
	#addDone(): void {
		const target = this.#target;
		if (target === undefined) return;
		for (const d of this.#drafts) {
			if (d === this.#editing || this.#queued.has(d) || this.#failed.has(d))
				continue;
			if (d.queuedFor !== undefined && d.queuedFor.caseId !== target.caseId)
				this.#failed.set(d, this.#notFor(d, target));
			else this.#enqueueAdd(d, false);
		}
	}

	/**
	 * Queue the draft for the case the toolbar adds to now; it goes into no
	 * other. `takeBack`: a mark without a screenshot scrolls back to take one.
	 */
	#enqueueAdd(draft: Draft, takeBack: boolean): void {
		const target = this.#target;
		if (target === undefined) return;
		draft.queuedFor = { caseId: target.caseId, title: target.title };
		this.#queued.add(draft);
		this.#queue(() => this.#addOne(draft, takeBack));
		this.#renderToolbar();
	}

	/** Why a draft queued for one case is not added to `target`, another one. */
	#notFor(draft: Draft, target: MarkTarget): string {
		const was = draft.queuedFor;
		if (was === undefined || was.caseId === target.caseId)
			return this.#failed.get(draft) ?? "";
		return `it was for “${was.title}”, and the toolbar adds to “${target.title}” now. “Add mark ${draft.number}” puts it there; Undo deletes it.`;
	}

	/** "Add mark N": the marks that could not be added try again, for this case. */
	#retry(): void {
		// Taking a screenshot may scroll: not while a tool is in use.
		this.setTool(null);
		const failed = [...this.#failed.keys()];
		this.#failed.clear();
		this.#message = "";
		this.#alert = "";
		this.#leftOut = undefined;
		for (const d of failed)
			if (this.#drafts.includes(d)) this.#enqueueAdd(d, true);
	}

	/** A failure shows, also where the toolbar was closed meanwhile. */
	#fail(draft: Draft, why: string): void {
		this.#failed.set(draft, why);
		this.#message = "";
		if (!this.overlay.addingMarks) {
			this.overlay.setAddingMarks(true);
			this.#mutated = true;
			this.#watch();
		}
	}

	async #addOne(draft: Draft, takeBack: boolean): Promise<void> {
		try {
			if (await this.#readyToAdd(draft, takeBack)) await this.#store(draft);
		} finally {
			this.#queued.delete(draft);
			this.#renderToolbar();
			this.#render();
		}
	}

	/** It was queued for another case than the toolbar's now: it waits, and says so. */
	#elsewhere(draft: Draft): boolean {
		const target = this.#target;
		if (target === undefined || draft.queuedFor?.caseId === target.caseId)
			return false;
		this.#fail(draft, this.#notFor(draft, target));
		return true;
	}

	/** Give the draft its screenshot if needed, then hold the page for the add. */
	async #readyToAdd(draft: Draft, takeBack: boolean): Promise<boolean> {
		try {
			await this.#shots;
			const gone = () =>
				!this.#drafts.includes(draft) ||
				draft === this.#editing ||
				this.#target === undefined;
			if (gone() || this.#elsewhere(draft)) return false;
			if (draft.shot === undefined) {
				if (draft.url !== location.href) {
					this.#fail(
						draft,
						"it has no screenshot and was drawn on another page. Go back there, or undo it.",
					);
					return false;
				}
				if (!takeBack && draft.shotError !== undefined) {
					this.#fail(
						draft,
						`its screenshot could not be taken (${draft.shotError}). Adding it again takes one.`,
					);
					return false;
				}
				if (takeBack) await this.#takeBack(draft);
				else {
					// The page moved as it was drawn (DEC-026, every action saves
					// at once): its screenshot is taken again by itself once the
					// page stands still, a few times, before it waits for "Add
					// mark N".
					for (
						let tries = 0;
						tries < AGAIN_TRIES && draft.shot === undefined;
						tries++
					) {
						if (!(await this.#still())) continue;
						if (gone() || this.#elsewhere(draft)) return false;
						await this.#takeBack(draft, true);
					}
					if (draft.shot === undefined) {
						this.#fail(
							draft,
							"the page kept moving before its screenshot was taken. Adding it again scrolls back to take one.",
						);
						return false;
					}
				}
				// Undone, or its case left, meanwhile.
				if (gone() || this.#elsewhere(draft)) return false;
			}
			await this.#hold("saving");
			return true;
		} catch (error) {
			this.#fail(draft, errorText(error));
			return false;
		}
	}

	/** Add one draft to the case; the page is held for it ("saving"). */
	async #store(draft: Draft): Promise<void> {
		let added = false;
		try {
			// Nothing else changes the case from here meanwhile: a show waits for
			// the save to end, Undo waits in the queue.
			let target = this.#target;
			if (target === undefined || this.#elsewhere(draft)) return;
			this.#message = `Adding mark ${draft.number} to “${target.title}”…`;
			this.#alert = "";
			this.#renderToolbar();
			const { view } = draft.shot as NonNullable<Draft["shot"]>;
			const isFree = async () => {
				const check = await ask({
					type: "case:number",
					caseId: (target as MarkTarget).caseId,
					number: draft.number,
				});
				return check;
			};
			for (let attempt = 0; ; attempt++) {
				const check = await isFree();
				if (!check.free) {
					// An AI app took the number: the marks not added yet move on.
					target = { ...target, nextMark: check.next };
					this.#advance(target.caseId, check.next);
					this.#renumber();
				}
				// Only marks before it: Undo of a later one leaves no pin behind.
				const alsoDrawn = view.marks.flatMap((d) =>
					d !== draft &&
					d.shot !== undefined &&
					d.number < draft.number &&
					this.#added.includes(d)
						? [
								{
									shot: view.shot.id,
									number: d.number,
									shape: d.shot.shape,
									...(d.shot.lines === undefined
										? {}
										: {
												lines: d.shot.lines,
												dark: d.highlight?.dark === true,
											}),
								},
							]
						: [],
				);
				try {
					await ask({
						type: "case:save",
						request: {
							caseId: target.caseId,
							imagesFrom: this.#pendingId(),
							isNew: false,
							title: target.title,
							page: view.page,
							shots: [view.shot],
							marks: [this.#markOf(draft)],
							keepPending: true,
							alsoDrawn,
						},
					});
					break;
				} catch (error) {
					// The number was taken between the check and the save: once more.
					if (attempt > 0 || (await isFree()).free) throw error;
				}
			}
			this.#drafts = this.#drafts.filter((d) => d !== draft);
			this.#savedMarks.push(draft);
			// Undo reaches only what was added while the toolbar is up.
			if (this.overlay.addingMarks) this.#added.push(draft);
			this.#advance(target.caseId, Math.max(target.nextMark, draft.number + 1));
			this.#message = `Mark ${draft.number} added to “${this.#titleOf(target)}”`;
			this.#retire();
			added = true;
		} catch (error) {
			// It stays on the page with its screenshot: adding it again can work.
			this.#fail(draft, errorText(error));
		} finally {
			this.#afterwards(this.#activity.end("saving"), added);
		}
	}

	/**
	 * The case's next number after an add or an undo, written onto the
	 * target as it is now: a rename meanwhile (`setTitle`) stays (review of
	 * PR 57), and a target switched to another case is left alone.
	 */
	#advance(caseId: string, nextMark: number): void {
		if (this.#target?.caseId !== caseId) return;
		this.#target = { ...this.#target, nextMark };
	}

	/** The case's title as the toolbar knows it now: renamed meanwhile, perhaps. */
	#titleOf(target: MarkTarget): string {
		return this.#target?.caseId === target.caseId
			? this.#target.title
			: target.title;
	}

	/** Undo for a mark that was added, or on its way: out of the case again. */
	async #undoAdded(draft: Draft): Promise<void> {
		try {
			// Its add failed, or it never ran: it is a draft still.
			if (this.#drafts.includes(draft)) {
				this.#failed.delete(draft);
				this.#forget(draft);
				if (draft === this.#editing) this.#closeComment();
				return;
			}
			const target = this.#target;
			if (target === undefined || !this.#added.includes(draft)) return;
			this.#message = `Deleting mark ${draft.number} from “${target.title}”…`;
			this.#renderToolbar();
			const result = await ask({
				type: "case:undo-add",
				caseId: target.caseId,
				markId: markIdOf(draft.number),
			});
			this.#added = this.#added.filter((d) => d !== draft);
			this.#savedMarks = this.#savedMarks.filter((d) => d !== draft);
			const view = draft.shot?.view;
			if (view !== undefined)
				view.marks = view.marks.filter((d) => d !== draft);
			this.#retire();
			// Its number is free again (or another mark took the next one).
			this.#advance(target.caseId, result.next);
			const title = this.#titleOf(target);
			this.#message = result.removed
				? `Mark ${draft.number} deleted from “${title}”`
				: `Mark ${draft.number} was deleted from “${title}” already`;
		} catch (error) {
			// It stays in the case, and Undo no longer offers it.
			this.#added = this.#added.filter((d) => d !== draft);
			this.#message = "";
			this.#alert = `Mark ${draft.number} is still in the case: ${errorText(error)}`;
		} finally {
			this.#undoing.delete(draft);
			this.#renderToolbar();
			this.#render();
		}
	}

	/**
	 * Done: the marks not in the case yet try again (nobody is using the page,
	 * so one without a screenshot can scroll back to take it), then the toolbar
	 * goes. While a mark is still not in the case it stays up and says so; Done
	 * again then discards those marks.
	 */
	#finish(): Promise<void> {
		this.#finishRun ??= this.#finishNow().finally(() => {
			this.#finishRun = undefined;
		});
		return this.#finishRun;
	}

	async #finishNow(): Promise<void> {
		if (this.#editing !== null) this.#commitComment();
		this.setTool(null);
		const left = this.#leftOut;
		this.#leftOut = undefined;
		if (
			left !== undefined &&
			this.#drafts.length > 0 &&
			this.#drafts.every((d) => left.has(d))
		) {
			for (const d of [...this.#drafts]) {
				this.#failed.delete(d);
				this.#forget(d);
			}
			this.#alert = "";
			this.hide();
			this.#renderToolbar();
			return;
		}
		const target = this.#target;
		for (const d of [...this.#failed.keys()])
			if (
				target !== undefined &&
				this.#drafts.includes(d) &&
				d.queuedFor?.caseId === target.caseId
			) {
				this.#failed.delete(d);
				this.#enqueueAdd(d, true);
			}
		this.#addDone();
		this.#finishing = true;
		this.#renderToolbar();
		try {
			await this.#settled();
		} finally {
			this.#finishing = false;
		}
		const remaining = [...this.#drafts];
		if (remaining.length === 0 || this.#target === undefined) {
			this.hide();
			this.#renderToolbar();
			return;
		}
		this.#leftOut = new Set(remaining);
		const first = remaining[0] as Draft;
		this.#message = "";
		this.#alert =
			remaining.length === 1
				? `Mark ${first.number} is not in the case yet: Add mark ${first.number}, or Done again to discard it.`
				: `${remaining.length} marks are not in the case yet: Add ${remaining.length} marks, or Done again to discard them.`;
		this.#renderToolbar();
	}
}

/**
 * What a case records of the page (`viewport`: the window's now when not
 * given): a new case has it from the start (DEC-026), a mark's screenshot
 * from when it was taken.
 */
export function pageInfo(
	doc: Document,
	viewport?: PageInfo["viewport"],
): PageInfo {
	const win = doc.defaultView;
	return {
		url: location.href,
		title: doc.title.slice(0, MAX_PAGE_TITLE),
		lang: LANGUAGE.test(doc.documentElement.lang)
			? doc.documentElement.lang
			: "",
		viewport: viewport ?? {
			width: win?.innerWidth ?? 0,
			height: win?.innerHeight ?? 0,
			dpr: win?.devicePixelRatio || 1,
		},
		userAgent: navigator.userAgent,
	};
}

/** The mark Undo takes: the one with the highest number. */
export function lastMark<T extends { number: number }>(
	marks: readonly T[],
): T | undefined {
	let last: T | undefined;
	for (const m of marks)
		if (last === undefined || m.number > last.number) last = m;
	return last;
}
