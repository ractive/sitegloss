/**
 * The content script, injected on a click on the icon. A second injection
 * into the same page is a no-op: the first one keeps answering.
 */

import { LANGUAGE, nextNumbers } from "../lib/case.ts";
import { cssSelector, describeElement } from "../lib/element.ts";
import {
	insideInput,
	inspectElement,
	isOffLimits,
	type Relation,
	resolveSelector,
	selectorProblem,
} from "../lib/inspect.ts";
import { withLook } from "../lib/look.ts";
import type {
	BarPlaceAnswer,
	BlurResult,
	Broadcast,
	ContentRequest,
	DescribedElement,
	InspectResult,
	LoadReplacedAnswer,
	Released,
	WorkerRequest,
} from "../lib/messages.ts";
import { PageActivity } from "./activity.ts";
import { MarkAdder, pageInfo } from "./adding.ts";
import { PageBlur } from "./blur.ts";
import { HOST_ID, Overlay, storedBarPlace } from "./overlay.ts";

import { LoadReplaced, Reviewer } from "./review.ts";

declare global {
	var __sitegloss: boolean | undefined;
}

const pageBlur = new PageBlur(document);
const activity = new PageActivity();

/** Lets go of the blur an AI app's `element:mark` or `page:blur` holds. */
let releaseBlur: (() => void) | undefined;

function unblur(): void {
	releaseBlur?.();
	releaseBlur = undefined;
}

/** An AI app's screenshot is over (or abandoned): its mark and blur go. */
function endAi(overlay: Overlay): void {
	overlay.setTemporaryMark(null);
	unblur();
}

function mark(
	overlay: Overlay,
	selector: string,
	number: number,
	blurForms: boolean,
): DescribedElement {
	// The same rules as get_mark_element's: whether it matches is an answer (CR-01).
	const problem = selectorProblem(document, selector);
	if (problem !== undefined) return { ok: false, error: problem };
	const matches = [...document.querySelectorAll(selector)].filter(
		(e) => !overlay.host.contains(e) && !insideInput(e),
	);
	if (matches.length === 0)
		return { ok: false, error: `No element on this page matches ${selector}` };
	// Layouts often keep a hidden copy: a mark on it would sit in the corner.
	const el = matches.find((e) => {
		const box = e.getBoundingClientRect();
		return box.width > 0 && box.height > 0;
	});
	if (el === undefined)
		return { ok: false, error: `Nothing that matches ${selector} is visible.` };
	const started = activity.begin("ai-mark", () => endAi(overlay));
	if (!started.ok) return started;
	el.scrollIntoView({
		block: "center",
		inline: "nearest",
		behavior: "instant",
	});
	const r = el.getBoundingClientRect();
	const rect = { x: r.x, y: r.y, width: r.width, height: r.height };
	overlay.setTemporaryMark({ number, rect });
	releaseBlur = pageBlur.hold(blurForms);
	return {
		ok: true,
		// The AI app's mark: how its element looks, once, now (DEC-048).
		details: withLook(
			describeElement(el),
			el,
			{ x: scrollX, y: scrollY },
			overlay.host,
		),
		rect,
		viewport: {
			width: innerWidth,
			height: innerHeight,
			dpr: devicePixelRatio || 1,
		},
		scroll: { x: scrollX, y: scrollY },
		url: location.href,
		title: document.title,
		lang: LANGUAGE.test(document.documentElement.lang)
			? document.documentElement.lang
			: "",
	};
}

/** A mark's element read for an AI app (`get_mark_element`). */
function inspect(
	overlay: Overlay,
	reviewer: Reviewer,
	request: {
		caseId: string;
		markId: string;
		mark?: string;
		casePage: string;
		selector?: string;
	},
): InspectResult | null {
	// A save or a screenshot blurs fields with inline styles: not the page's.
	if (activity.busy !== undefined)
		return { ok: false, reason: "busy", error: activity.busy };
	if (reviewer.caseId !== request.caseId) return null;
	// The page's copy of the case has another mark under that id (it
	// predates a renumbering): the asker loads the case again.
	if (
		request.mark !== undefined &&
		!reviewer.holds(request.markId, request.mark)
	)
		return null;
	const target = reviewer.target(request.markId);
	if (target === undefined) return null;
	const { match } = target;
	const n = match.number;
	// A mark is looked for on its own page only (DEC-057).
	if (!reviewer.isOwn(request.markId))
		return {
			ok: false,
			reason: "other-page",
			error: `Mark ${n} is on another page than the one in front, and is not looked for here.`,
			match,
		};
	if (match.status === "no-element") {
		if (request.selector === undefined)
			return {
				ok: false,
				reason: "no-element",
				error: `Mark ${n} was not drawn on an element.`,
				match,
			};
	} else if (target.element === undefined)
		return {
			ok: false,
			reason: "lost",
			error: `Mark ${n}'s element was not found on this page.`,
			match,
		};
	let element = target.element;
	let relation: Relation = "mark";
	if (request.selector !== undefined) {
		const found = resolveSelector(document, element, request.selector, {
			skip: overlay.host,
			pageWide: element === undefined,
		});
		if ("error" in found)
			return { ok: false, reason: "selector", error: found.error, match };
		element = found.element;
		relation = found.relation;
	}
	if (element === undefined || isOffLimits(element))
		return {
			ok: false,
			reason: "selector",
			error: "That element is not part of the page's content.",
			match,
		};
	return {
		ok: true,
		url: location.href,
		title: document.title,
		match,
		relation,
		selector: cssSelector(element),
		inspection: inspectElement(element, overlay.host),
	};
}

function start(): void {
	// An instance orphaned by an extension reload or update leaves its overlay
	// behind; its script can no longer be reached, so take the page over.
	document.getElementById(HOST_ID)?.remove();
	const overlay = new Overlay(document);
	const adder = new MarkAdder(overlay, pageBlur, activity);
	const reviewer = new Reviewer(overlay);
	adder.onAddImages = (caseId, number, what) => {
		chrome.runtime
			.sendMessage({
				type: "panel:images",
				caseId,
				number,
				...(what === undefined ? {} : { what }),
			} satisfies WorkerRequest)
			.catch(() => undefined);
	};
	// A loaded mark's dialog whose field the page refused: the panel's form.
	reviewer.onPanel = (caseId, number, what) =>
		adder.onAddImages?.(caseId, number, what);
	const state = () => {
		const s = adder.state();
		const loaded = reviewer.caseId;
		if (loaded === undefined) return s;
		// Hidden marks are no marks drawn; the panel learns which case waits.
		return reviewer.hidden
			? { ...s, hiddenCase: loaded }
			: { ...s, loadedCase: loaded };
	};
	// One switch on the page and in the panel (DEC-061): adding marks shows
	// them, hiding them ends the adding.
	reviewer.onAddMarks = (c) => {
		reviewer.reveal();
		adder.show({
			target: { caseId: c.id, title: c.title, nextMark: nextNumbers(c).mark },
		});
	};
	reviewer.onHiddenChange = (hidden) => {
		const c = reviewer.loaded;
		if (hidden && c !== undefined && adder.state().target?.caseId === c.id)
			void adder.end(c.id);
	};
	// The bar is where the person left it, in every tab of this profile.
	// The worker keeps it: this profile's storage is not a page's to reach.
	overlay.onBarMoved = (place) =>
		void chrome.runtime
			.sendMessage({ type: "bar:place", place } satisfies WorkerRequest)
			.catch(() => undefined);
	void chrome.runtime
		.sendMessage({ type: "bar:place" } satisfies WorkerRequest)
		.then((answer: { ok?: boolean } & BarPlaceAnswer) => {
			const place = storedBarPlace(answer?.place);
			if (place !== undefined) overlay.setBarPlace(place);
		})
		.catch(() => undefined);
	overlay.onChange = () => {
		const message: Broadcast = { type: "overlay:changed", state: state() };
		// Nobody may be listening (side panel closed): that is fine.
		chrome.runtime.sendMessage(message).catch(() => {});
	};
	chrome.runtime.onMessage.addListener(
		(message: ContentRequest, sender, sendResponse) => {
			if (sender.id !== chrome.runtime.id) return false;
			switch (message.type) {
				case "overlay:show":
					// Adding to the case whose marks are hidden shows them.
					if (reviewer.hidden && reviewer.caseId === message.target.caseId)
						reviewer.reveal();
					adder.show({
						target: message.target,
						...(message.blurForms !== undefined
							? { blurForms: message.blurForms }
							: {}),
					});
					sendResponse(state());
					break;
				case "overlay:end":
					// Answered once the toolbar is finished: hidden, or up with a
					// mark that is not in the case yet.
					adder
						.end(message.caseId, {
							discard: message.discard ?? false,
							retry: message.retry ?? false,
						})
						.then(
							() => sendResponse(state()),
							() => sendResponse(state()),
						);
					return true; // answers asynchronously
				case "overlay:state":
					sendResponse(state());
					break;
				case "overlay:title":
					adder.setTitle(message.caseId, message.title);
					sendResponse(state());
					break;
				case "page:info":
					sendResponse(pageInfo(document));
					break;
				case "overlay:settings":
					adder.setBlurForms(message.blurForms);
					sendResponse(state());
					break;
				case "page:captured":
					adder.captured();
					break;
				case "case:load":
					if (activity.busy !== undefined) {
						// `busy`: a moment later it may well work (the side panel waits).
						sendResponse({ error: activity.busy, busy: true });
						break;
					}
					reviewer.load(message.case).then(
						(result) => {
							// A toolbar adding to the case: the loaded marks draw its own.
							if (reviewer.caseId === message.case.id)
								adder.caseLoaded(message.case.id);
							sendResponse(result);
						},
						(error: unknown) =>
							sendResponse(
								// Stopped by a clear, or another case's load: no failure.
								error instanceof LoadReplaced
									? ({ replaced: true } satisfies LoadReplacedAnswer)
									: {
											error:
												error instanceof Error ? error.message : String(error),
										},
							),
					);
					return true; // answers asynchronously
				case "case:matches":
					reviewer
						.matches(message.caseId)
						.then(sendResponse, () => sendResponse(null));
					return true; // answers asynchronously
				case "case:update":
					reviewer.update(message.case).then(
						(result) => {
							adder.caseChanged(
								message.case,
								reviewer.caseId === message.case.id,
							);
							sendResponse(result);
						},
						() => sendResponse(null),
					);
					return true; // answers asynchronously
				case "case:show":
					if (activity.busy !== undefined) {
						sendResponse({ error: activity.busy });
						break;
					}
					sendResponse(
						reviewer.caseId === message.caseId &&
							(message.mark === undefined ||
								reviewer.holds(message.markId, message.mark))
							? (reviewer.show(message.markId, message.candidate) ?? null)
							: null,
					);
					break;
				case "case:clear":
					reviewer.clearFor(message.caseId);
					sendResponse(state());
					break;
				case "case:hide":
					if (reviewer.caseId === message.caseId) {
						reviewer.hide();
						reviewer.onHiddenChange?.(true);
					}
					sendResponse(state());
					break;
				case "element:mark":
					sendResponse(
						mark(overlay, message.selector, message.number, message.blurForms),
					);
					break;
				case "element:inspect":
					sendResponse(inspect(overlay, reviewer, message));
					break;
				case "element:unmark": {
					const held = activity.now.kind === "ai-mark";
					activity.end("ai-mark");
					endAi(overlay);
					sendResponse({ held } satisfies Released);
					break;
				}
				case "page:blur": {
					const started = activity.begin("ai-capture", () => endAi(overlay));
					if (started.ok) releaseBlur = pageBlur.hold(message.blurForms);
					sendResponse(started satisfies BlurResult);
					break;
				}
				case "page:unblur": {
					const held = activity.now.kind === "ai-capture";
					activity.end("ai-capture");
					unblur();
					sendResponse({ held } satisfies Released);
					break;
				}
				default:
					return false;
			}
			return false;
		},
	);
	// The panel learns that Sitegloss runs here now: after a click on the
	// icon, a case waiting for this tab loads.
	overlay.onChange();
}

if (!globalThis.__sitegloss) {
	globalThis.__sitegloss = true;
	start();
}
