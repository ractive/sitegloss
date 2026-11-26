/**
 * Messages between the side panel, the service worker and the content script
 * (`chrome.runtime` and `chrome.tabs` messaging).
 */

import {
	type Case,
	type ElementDetails,
	type Highlight,
	type PageInfo,
	RESOLVE_CHOICES,
	type Rect,
	type ResolveChoice,
	type Viewport,
} from "./case.ts";
import type { Inspection, Relation } from "./inspect.ts";
import type { MatchStatus } from "./match.ts";
import type { SaveRequest } from "./save.ts";

/** The case a toolbar adds its marks to (DEC-026: there is always one). */
export interface MarkTarget {
	caseId: string;
	title: string;
	nextMark: number;
}

/** What the side panel (or the service worker) asks the content script. */
export type ContentRequest =
	| {
			type: "overlay:show";
			/** Add to this case: a toolbar never draws a case of its own. */
			target: MarkTarget;
			/** Blur form fields while capturing (password fields always). */
			blurForms?: boolean;
	  }
	/**
	 * The side panel closes the case (DEC-023): a toolbar adding to it
	 * finishes as its Done does and, once hidden, adds to no case any more
	 * (`OverlayState`). A mark that could not be added keeps the toolbar up
	 * and the case its target, unless `discard`: then such marks go. Without
	 * `retry` it is a Done again where an earlier Done left marks out; with
	 * it ("← All cases" at first) they are tried once more.
	 */
	| { type: "overlay:end"; caseId: string; discard?: boolean; retry?: boolean }
	| { type: "overlay:state" }
	/**
	 * The case was renamed (DEC-026): a toolbar adding to it says its new
	 * title (`OverlayState`).
	 */
	| { type: "overlay:title"; caseId: string; title: string }
	/** What a new case records of this page (`PageInfo`, DEC-026). */
	| { type: "page:info" }
	/** The side panel's "Blur form fields" changed (`OverlayState`). */
	| { type: "overlay:settings"; blurForms: boolean }
	/**
	 * Find the case's elements on this page and draw its marks (`LoadResult`, or
	 * `{ error }`; `{ error, busy: true }` while the page is busy). Two loads of the case close
	 * together both answer the newer one's result; one stopped by a clear or
	 * by another case's load answers `LoadReplacedAnswer`, which is no error.
	 */
	| { type: "case:load"; case: Case }
	/**
	 * Scroll to one mark's element, or to another candidate
	 * (`MarkMatch`, or `{ error }` while the page is busy).
	 */
	| {
			type: "case:show";
			/** `null` comes back when another case (or none) is loaded. */
			caseId: string;
			markId: string;
			/**
			 * Which mark is meant (`markKey`), where the asker knows: `null`
			 * comes back when the page's copy of the case has another mark
			 * under that id (it predates a renumbering), and the asker loads
			 * the case again.
			 */
			mark?: string;
			candidate?: number;
	  }
	/**
	 * The loaded case changed: draw its marks as they are now, keeping the
	 * candidates chosen (`LoadResult`, or `null` where another case is loaded).
	 */
	| { type: "case:update"; case: Case }
	/**
	 * What the loaded case's marks are at on the page as it is now
	 * (`LoadResult`, or `null` where another case is loaded): after the address
	 * changed within the page (a single-page app's next route), the marks not
	 * there before are looked for first.
	 */
	| { type: "case:matches"; caseId: string }
	/** Remove the marks (`OverlayState`): only that case's, where it is named. */
	| { type: "case:clear"; caseId?: string }
	/** Hide the case's marks and keep it: the page's bar becomes the pill that shows them again (DEC-061). */
	| { type: "case:hide"; caseId: string }

	/**
	 * Scroll to the element `selector` and mark it with `number` for a
	 * screenshot (`DescribedElement`); the overlay's own bars and the user's
	 * unsaved marks are hidden, form fields blurred as for a save. Refused
	 * while the page is busy.
	 */
	| {
			type: "element:mark";
			selector: string;
			number: number;
			blurForms: boolean;
			/** Text inside the element to highlight (DEC-066). */
			text?: string;
	  }
	/**
	 * Read the element of a loaded case's mark (or, with `selector`, one
	 * relative to it) from the page: markup, styles, matching rules
	 * (`InspectResult`; `null` when another case, or none, is loaded, or the
	 * loaded copy lacks the mark). Changes nothing on the page.
	 */
	| {
			type: "element:inspect";
			caseId: string;
			markId: string;
			/** As for `case:show`. */
			mark?: string;
			/**
			 * The mark's page, its screenshot's (DEC-038): a mark without an
			 * element is looked for only there.
			 */
			casePage: string;
			selector?: string;
	  }
	/** Remove that mark and the blur again (`Released`). */
	| { type: "element:unmark" }
	/** Blur form fields for a screenshot of the page as it is (`BlurResult`). */
	| { type: "page:blur"; blurForms: boolean }
	/** Undo `page:blur` (`Released`). */
	| { type: "page:unblur" }
	/** The screenshot a mark asked for is taken: the overlay can come back. */
	| { type: "page:captured" };

/** The answer to `page:blur`: refused while the page is busy. */
export type BlurResult = { ok: true } | { ok: false; error: string };

/**
 * The answer to `element:unmark` and `page:unblur`. `held: false`: the page no
 * longer held that activity (it timed out, or a navigation replaced the page),
 * so a screenshot taken for it may show the page without mark or blur.
 */
export interface Released {
	held: boolean;
}

/** The answer to `element:mark`. */
export type DescribedElement =
	| {
			ok: true;
			details: ElementDetails;
			/** The element's box in window coordinates; a highlight's: its lines' box. */
			rect: Rect;
			/** The text highlighted, its lines in window coordinates (DEC-066). */
			highlight?: Highlight;
			viewport: Viewport;
			scroll: { x: number; y: number };
			url: string;
			title: string;
			/** The page's language, where it names one (DEC-038). */
			lang?: string;
	  }
	| { ok: false; error: string };

/** The answer to `element:inspect`. */
export type InspectResult =
	| {
			ok: true;
			url: string;
			title: string;
			match: MarkMatch;
			/** How `selector` found the element; `mark` without one. */
			relation: Relation;
			/** A selector that finds the inspected element (empty in a shadow root). */
			selector: string;
			inspection: Inspection;
	  }
	| {
			ok: false;
			/**
			 * `lost` and `no-element`: the mark has no element on this page;
			 * `other-page`: the tab does not show the mark's page, where alone
			 * it is looked for (DEC-057).
			 */
			reason: "busy" | "lost" | "no-element" | "other-page" | "selector";
			error: string;
			match?: MarkMatch;
	  };

/** One of the best elements for a mark on this page. */
export interface CandidateInfo {
	score: number;
	/** One line about the element (element.ts `summarize`). */
	summary: string;
	selector: string;
	/** Rendered with a size; `false` for hidden elements (e.g. another layout). */
	visible: boolean;
	/** Sure enough to be drawn as found (match.ts `isFound`). */
	found: boolean;
}

/**
 * Where a mark's element is on this page. A mark of another page than the
 * one in front is not looked for (DEC-057): `lost` without candidates, or
 * `no-element` for a mark drawn on no element.
 */
export interface MarkMatch {
	markId: string;
	number: number;
	/** `no-element`: the mark recorded no element. */
	status: MatchStatus | "no-element";
	/** The shown candidate's score (0 for lost). */
	score: number;
	/** Which candidate the mark is drawn on. */
	current: number;
	candidates: CandidateInfo[];
	/** Only part of the page was searched (very many elements, or out of time). */
	truncated?: boolean;
	/**
	 * A highlight whose text is not in the element shown any more (DEC-066):
	 * the text changed, often the fix itself. A found element is then only
	 * probable.
	 */
	textChanged?: true;
	/**
	 * A highlight whose text is not in the element shown, found around it
	 * instead (DEC-083), and drawn there as probable: `nearby`, the same
	 * text in another element near it; `reworded`, other text between the
	 * same text before and after it (`textNow`). `textChanged` stays: it is
	 * not where it was.
	 */
	textNear?: "nearby" | "reworded";
	/** The text found instead (`textNear`), whitespace collapsed, cut: page text. */
	textNow?: string;
	/** The element it was found in (`textNear`), as a CSS selector. */
	textAt?: string;
	/**
	 * No element was found for the mark; its text was found near where the
	 * element was (`textNear`), and the element that holds it is its one
	 * candidate (DEC-083).
	 */
	textPlaced?: true;
	/**
	 * A highlight whose element is too long to read whole (DEC-066): its
	 * text was not looked for, and nothing is said of whether it changed.
	 */
	textUnread?: true;
}

/** A load stopped by a clear or by another case's load: nothing to say. */
export interface LoadReplacedAnswer {
	replaced: true;
}

export interface LoadResult {
	caseId: string;
	url: string;
	matches: MarkMatch[];
	/**
	 * A newer load of the case overtook this one (an AI app's load_case, the
	 * panel's own draw) and this is its result: the marks are that load's.
	 */
	adopted?: true;
}

/** The content script's answer to the `overlay:*` and `case:clear` requests. */
export interface OverlayState {
	visible: boolean;
	url: string;
	title: string;
	/**
	 * Marks drawn and not in the case yet: a comment being typed, one on its
	 * way, or one that could not be added (DEC-014).
	 */
	drafts: number;
	saving: boolean;
	target?: MarkTarget;
	/** The case whose marks are drawn. */
	loadedCase?: string;
	/** The case whose marks are hidden on the page, its pill showing (DEC-061). */
	hiddenCase?: string;
}

/** What the content script asks the service worker. */
export type WorkerRequest =
	/** Capture the visible tab as the pending screenshot `shotId` (save.ts). */
	| { type: "capture"; caseId: string; shotId: string }
	| { type: "case:save"; request: SaveRequest }
	/** Whether a mark can take `number` in the case (`NumberCheck`). */
	| { type: "case:number"; caseId: string; number: number }
	/** The toolbar's Undo: take out the mark it just added (`UndoResult`, save.ts `undoAdd`). */
	| { type: "case:undo-add"; caseId: string; markId: string }
	/** Remove the pending screenshots of a save that was given up. */
	| { type: "images:discard"; caseId: string; shotIds: string[] }
	/**
	 * The page's bar's place (DEC-061), kept by the worker in this profile's
	 * storage (a content script may not reach it): with `place` it is kept,
	 * without it the kept one is answered (`BarPlaceAnswer`).
	 */
	| { type: "bar:place"; place?: { right: number; top: number } }
	/**
	 * "Add another image…" in the page's mark dialog (DEC-063): the side panel opens
	 * (the click's gesture) and its own dialog adds images to mark `number`
	 * of the case once the mark is in it. A page can read an image pasted or
	 * dropped in the page, so the panel takes them.
	 */
	| {
			type: "panel:images";
			caseId: string;
			number: number;
			/**
			 * What the panel opens for the mark: its image dialog (the
			 * default), or its comment, resolve or reopen form, where the
			 * page's own field could not load (DEC-064).
			 */
			what?: PanelMarkWhat;
	  }
	/**
	 * From the side panel: the mark the page's "Add another image…" left, taken
	 * (answered as `ImagesForAnswer`, then forgotten). The panel touches no
	 * storage itself; the worker keeps it in session storage, which
	 * outlives the worker's restarts.
	 */
	| { type: "panel:images-take"; tabId: number }
	/**
	 * From the side panel: a mark's picture large, in the viewer's window
	 * over the browser window `windowId` (DEC-064). One per browser window:
	 * open, it shows this picture. Answered with `viewerWindowId`.
	 */
	| {
			type: "viewer:open";
			caseId: string;
			markId: string;
			pictureId: string;
			windowId: number;
			/** The picture's size, the browser window's bounds and the screen's free area (`viewerBounds`). */
			layout?: {
				picture?: { width: number; height: number };
				over: { left: number; top: number; width: number; height: number };
				screen: { left: number; top: number; width: number; height: number };
			};
	  }
	/** From the viewer in its window: the frame above its page, for the next window's size. */
	| { type: "viewer:frame"; height: number };

export interface ImagesForAnswer {
	images?: ImagesFor;
}

/** Where the worker leaves the panel's next "Add images" (DEC-063), in session storage. */
export const IMAGES_FOR_KEY = "sitegloss.imagesFor";

/** What the side panel is asked to open for a mark of the page. */
export type PanelMarkWhat = "images" | "comment" | "resolve" | "reopen";
export const PANEL_MARK_WHAT: readonly PanelMarkWhat[] = [
	"images",
	"comment",
	"resolve",
	"reopen",
];

/** What `IMAGES_FOR_KEY` holds: the mark of which case, from which tab, when. */
export interface ImagesFor {
	what?: PanelMarkWhat;
	caseId: string;
	number: number;
	tabId: number;
	at: number;
}

/**
 * The one-off messages the service worker answers. Nothing about the AI
 * connection is among them: that goes over the side panel's port (DEC-015).
 */
export const WORKER_REQUESTS: ReadonlySet<string> = new Set<
	WorkerRequest["type"]
>([
	"capture",
	"case:save",
	"case:number",
	"case:undo-add",
	"images:discard",
	"bar:place",
	"panel:images",
	"panel:images-take",
	"viewer:open",
	"viewer:frame",
]);

export interface BarPlaceAnswer {
	place?: { right: number; top: number };
}

export function isWorkerRequest(message: unknown): message is WorkerRequest {
	return (
		typeof message === "object" &&
		message !== null &&
		WORKER_REQUESTS.has((message as { type?: unknown }).type as string)
	);
}

export type WorkerResponse<T = object> =
	| ({ ok: true } & T)
	| { ok: false; error: string };

/**
 * A map from each request's `type` to its answer: every type of `R` must
 * have one.
 */
type AnswerMap<
	R extends { type: string },
	M extends { [K in R["type"]]: unknown },
> = M;

/**
 * What the content script answers to each request (`index.ts`). A content
 * script of another build (an old one left in a tab) may not answer at all;
 * where that matters the answer says `undefined`.
 */
export type ContentAnswers = AnswerMap<
	ContentRequest,
	{
		"overlay:show": OverlayState;
		"overlay:end": OverlayState;
		"overlay:state": OverlayState;
		"overlay:title": OverlayState;
		"page:info": PageInfo | undefined;
		"overlay:settings": OverlayState;
		"case:load":
			| LoadResult
			| LoadReplacedAnswer
			| { error: string; busy?: true };
		"case:show": MarkMatch | { error: string } | null;
		"case:update": LoadResult | null;
		"case:matches": LoadResult | null;
		"case:clear": OverlayState;
		"case:hide": OverlayState;
		"element:mark": DescribedElement;
		"element:inspect": InspectResult | null;
		"element:unmark": Released | undefined;
		"page:blur": BlurResult;
		"page:unblur": Released | undefined;
		"page:captured": undefined;
	}
>;

/** The content script's answer to `R`. */
export type ContentAnswer<R extends ContentRequest> = ContentAnswers[R["type"]];

/** What the service worker answers to each request, once it went well (`background.ts`). */
export type WorkerAnswers = AnswerMap<
	WorkerRequest,
	{
		capture: CaptureResult;
		"case:save": SaveResult;
		"case:number": NumberCheck;
		"case:undo-add": UndoResult;
		"images:discard": object;
		"bar:place": BarPlaceAnswer;
		"panel:images": object;
		"panel:images-take": ImagesForAnswer;
		"viewer:open": { viewerWindowId: number };
		"viewer:frame": object;
	}
>;

/** The service worker's answer to `R`. */
export type WorkerAnswer<R extends WorkerRequest> = WorkerResponse<
	WorkerAnswers[R["type"]]
>;

/**
 * Ask the service worker: its answer as `WorkerAnswers` has it, `undefined`
 * where nothing answered.
 */
export function askWorker<R extends WorkerRequest>(
	request: R,
): Promise<WorkerAnswer<R> | undefined> {
	return chrome.runtime.sendMessage(request);
}

export interface CaptureResult {
	/** Pixels of the stored screenshot. */
	width: number;
	height: number;
}

export interface NumberCheck {
	free: boolean;
	/** The case's next mark number. */
	next: number;
}

export interface UndoResult {
	/** `false`: the mark was gone already. */
	removed: boolean;
	next: number;
}

export interface SaveResult {
	caseId: string;
	title: string;
	marks: number;
}

/**
 * What extension pages hear without asking: the service worker saved a case,
 * or a content script's overlay was shown or hidden (also from its own
 * toolbar).
 */
/**
 * From the worker, for an AI app's `open_case` (DEC-050): the side panel in
 * `windowId` opens the case whose marks the tab `tabId` shows now.
 */
export interface OpenCaseRequest {
	type: "panel:open-case";
	caseId: string;
	tabId: number;
	windowId: number;
}

/** A panel's answer to `OpenCaseRequest`. */
export type OpenCaseAnswer =
	| {
			opened: true;
			/** What the panel's draw on that tab found; none: it has not drawn yet. */
			result?: LoadResult;
	  }
	| {
			opened: false;
			/**
			 * `no-panel`: none answered; `adding`: the toolbar there adds to
			 * another case (`title`); `busy`: the case open in the panel
			 * (`title`) is in the middle of something a person does (`why`).
			 */
			reason: "no-panel" | "adding" | "busy";
			title?: string;
			why?: string;
	  };

export type Broadcast =
	| { type: "cases:changed"; caseId: string }
	| { type: "overlay:changed"; state: OverlayState }
	/** The worker's sync status changed (DEC-021). */
	| { type: "sync:changed" }
	/**
	 * From the side panel: bring the sync up to date now; `force` (Try again,
	 * a new choice) also after a failure only the user can end.
	 */
	| { type: "sync:run"; force?: boolean }
	/** The worker's account or team sync changed (DEC-039): read it again. */
	| { type: "cloud:changed" }
	/** The page's "Add image…" left a mark for the panel (DEC-063): take it. */
	| { type: "panel:images" };

/**
 * What the side panel asks of the worker about the account and the sync
 * with a team (DEC-039); from an extension page only. The worker holds the
 * tokens and is the one that syncs.
 */
export type CloudRequest =
	/** Start a sign-in: the answer's `url` is what the browser's window opens. */
	| { type: "cloud:begin" }
	/** The browser's window ended on `redirect`: finish the sign-in. */
	| { type: "cloud:finish"; redirect: string }
	/** The window of the sign-in begun with `url` closed without an answer: forget it. */
	| { type: "cloud:abandon"; url: string }
	| { type: "cloud:sign-out" }
	| { type: "cloud:team"; teamId: string }
	/** The cases that were here before the team: share them, or keep them here. */
	| { type: "cloud:decide"; share: boolean }
	/** Share one case kept on this device with the team. */
	| { type: "cloud:share"; caseId: string }
	/**
	 * Sync now. `cursor`: the team is at this revision (the events stream
	 * said so), nothing to do when this device is too. `retry`: also what the
	 * server refused before.
	 */
	| { type: "cloud:run"; cursor?: number; retry?: boolean }
	/**
	 * The panel came into view: the account's teams are asked for again when
	 * that was more than a minute ago (DEC-045), and a change is said.
	 */
	| { type: "cloud:check" }
	/**
	 * An access token for the events stream of that team at that server;
	 * `fresh`: the last was refused. Refused when they are not the account's
	 * (a stream that outlived its account must not get another server's token).
	 */
	| { type: "cloud:token"; server: string; teamId: string; fresh?: boolean }
	/** The server's address; empty: sitegloss.dev's. Only while signed out. */
	| { type: "cloud:server"; server: string };

export type CloudAnswer =
	| { ok: true; url?: string; token?: string }
	| { ok: false; error: string };

const CLOUD_REQUESTS: ReadonlySet<string> = new Set<CloudRequest["type"]>([
	"cloud:begin",
	"cloud:finish",
	"cloud:abandon",
	"cloud:sign-out",
	"cloud:team",
	"cloud:decide",
	"cloud:share",
	"cloud:run",
	"cloud:check",
	"cloud:token",
	"cloud:server",
]);

export function isCloudRequest(message: unknown): message is CloudRequest {
	return (
		typeof message === "object" &&
		message !== null &&
		CLOUD_REQUESTS.has((message as { type?: unknown }).type as string)
	);
}

/**
 * What a page asks of the side panel about a mark of the case drawn on it
 * (DEC-027): its pin was clicked, or its comment or status was changed, or
 * it was deleted, in the page's popover. A panel answers only for the case it has
 * open and drew on that tab, and does it as its own buttons would; nobody
 * answers when no panel shows the case.
 */
export type MarkRequest = (
	| { type: "mark:picked"; caseId: string; markId: string }
	| { type: "mark:comment"; caseId: string; markId: string; text: string }
	| { type: "mark:delete"; caseId: string; markId: string }
	/** Resolve… and Change…: how it is settled, with a note or "". */
	| {
			type: "mark:resolve";
			caseId: string;
			markId: string;
			kind: ResolveChoice;
			note: string;
	  }
	| { type: "mark:verify"; caseId: string; markId: string }
	/** Reopen…: with what is still wrong, which the panel requires. */
	| { type: "mark:reopen"; caseId: string; markId: string; note: string }
	/**
	 * "Add another image…" (DEC-058): the panel opens its dialog for the
	 * mark. The page asks only; no picture ever passes through it.
	 */
	| { type: "mark:add-image"; caseId: string; markId: string }
) & {
	/**
	 * Which mark the popover was opened on (`markKey`): its id is another
	 * mark's after the team's sync gave marks other numbers, and what was
	 * typed for one mark must not be saved onto another.
	 */
	mark?: string;
};

export type MarkAnswer = { ok: true } | { ok: false; error: string };

const MARK_REQUESTS: ReadonlySet<string> = new Set<MarkRequest["type"]>([
	"mark:picked",
	"mark:comment",
	"mark:delete",
	"mark:resolve",
	"mark:verify",
	"mark:reopen",
	"mark:add-image",
]);

/** An `OpenCaseRequest`, checked before the panel takes it. */
export function isOpenCaseRequest(
	message: unknown,
): message is OpenCaseRequest {
	if (typeof message !== "object" || message === null) return false;
	const m = message as Record<string, unknown>;
	return (
		m["type"] === "panel:open-case" &&
		typeof m["caseId"] === "string" &&
		Number.isInteger(m["tabId"]) &&
		Number.isInteger(m["windowId"])
	);
}

export function isMarkRequest(message: unknown): message is MarkRequest {
	if (typeof message !== "object" || message === null) return false;
	const m = message as Record<string, unknown>;
	return (
		MARK_REQUESTS.has(m["type"] as string) &&
		typeof m["caseId"] === "string" &&
		typeof m["markId"] === "string" &&
		(m["type"] !== "mark:comment" || typeof m["text"] === "string") &&
		(m["type"] !== "mark:reopen" || typeof m["note"] === "string") &&
		(m["type"] !== "mark:resolve" ||
			(typeof m["note"] === "string" &&
				RESOLVE_CHOICES.includes(m["kind"] as ResolveChoice)))
	);
}

/** The content script's file, as the build writes it. */
export const CONTENT_SCRIPT = "content.js";

/** The relay pairing page's script (DEC-044), as the build writes it. */
export const PAIRING_SCRIPT = "pairing.js";
