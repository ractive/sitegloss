/**
 * The side panel: the tab in front, annotating it, the saved cases, and the
 * connection to an AI app. Actions change the panel's one state (state.ts);
 * view.ts draws it (DEC-011).
 */

import {
	BROWSER,
	FIREFOX,
	fromBackground,
	requestPermissions,
} from "../lib/browser.ts";
import {
	type Annotation,
	type Case,
	casePages,
	cleanLink,
	cleanTitle,
	exactPage,
	linkProblem,
	MARK_CHANGED,
	MAX_COMMENT,
	MAX_LINK,
	markFor,
	markKey,
	markStatus,
	newId,
	nextNumbers,
	type PageInfo,
	validateCase,
	viewportAt,
	withCaseComment,
	withCaseCommentText,
	withChoice,
	withClosed,
	withComment,
	withLink,
	withoutAnnotation,
	withoutCaseComment,
	withoutFinding,
	withReopen,
	withTitle,
	withVerified,
} from "../lib/case.ts";
import {
	type CheckedExport,
	exportAllCases,
	exportAllFileName,
	exportCase,
	exportFileName,
	MAX_IMPORT_ALL_BYTES,
	readExports,
	storeImport,
} from "../lib/export.ts";
import {
	type AnnotationMatch,
	type Broadcast,
	isMarkRequest,
	isOpenCaseRequest,
	type LoadReplacedAnswer,
	type LoadResult,
	type MarkAnswer,
	type MarkRequest,
	type OpenCaseAnswer,
	type OpenCaseRequest,
	type OverlayState,
} from "../lib/messages.ts";
import { IdbStore } from "../lib/store.ts";
import { inject, NoAccessError, sendToTab } from "../lib/tabs.ts";
import { blurFormsNow, startAi } from "./ai.ts";
import { aiOpenRefusal } from "./ai-open.ts";
import { cloudActions, startCloud } from "./cloud.ts";
import { caseSync } from "./cloud-view.ts";
import { byId, isWebPage, sitePattern } from "./dom.ts";
import {
	askForDownloads,
	DOWNLOADS,
	type SavedFile,
	saveFile,
} from "./download.ts";
import {
	type Drawn,
	followStep,
	isFound,
	movedOn,
	newsLetsIn,
} from "./follow.ts";
import { isUntouched, mayHold, newCase, type TabAnswer } from "./fresh.ts";
import { CaseHints } from "./hints.ts";
import { markTargets } from "./mark-link.ts";
import { markAsked } from "./picked.ts";
import { cssSize, onScreen, type Size, sameSize, windowFor } from "./size.ts";
import {
	type CaseHint,
	type Exported,
	editAfter,
	heldAfter,
	type ImportBatch,
	Latest,
	Panel,
	type PanelState,
} from "./state.ts";
import { startSync, syncActions } from "./sync.ts";
import { type Actions, lostMarksText, NO_ACCESS, render } from "./view.ts";
import { panelWindow } from "./window.ts";

const store = new IdbStore();

const importButton = byId<HTMLButtonElement>("import");
const importFile = byId<HTMLInputElement>("import-file");
const exportAllButton = byId<HTMLButtonElement>("export-all");
const allSites = byId<HTMLInputElement>("all-sites");

const ALL_SITES = { origins: ["<all_urls>"] };

/** After a first click on Delete: the second click of a double-click is no decision. */
const DELETE_CLICK_GAP_MS = 500;
/** After a first click on Delete: a click much later is no decision either. */
const DELETE_ARMED_MS = 4000;

/**
 * Chrome's prompt to let Sitegloss run on the site of `url` from now on. It
 * shows only during a click, so call it before anything is awaited; it
 * answers yes at once where Sitegloss may run already.
 */
function askForSite(url: string): Promise<boolean> {
	const pattern = sitePattern(url);
	if (pattern === undefined || declinedSites.has(pattern))
		return Promise.resolve(false);
	return requestPermissions({ origins: [pattern] }).then(
		(granted) => {
			if (!granted) declinedSites.add(pattern);
			return granted;
		},
		(error: unknown) => {
			// Not the user's no: a call outside a click, say.
			console.warn(`Sitegloss could not ask for ${pattern}: ${message(error)}`);
			return false;
		},
	);
}

/** Sites the user said no to: Chrome asks again only after the panel reopens. */
const declinedSites = new Set<string>();

const message = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

function describeError(error: unknown): string {
	return error instanceof NoAccessError
		? NO_ACCESS
		: `Could not reach the page: ${message(error)}`;
}

// --- the state and its work ------------------------------------------------------

const panel = new Panel((state) => render(state, actions));
const update = (change: (s: PanelState) => void) => panel.update(change);
const state = panel.state;

/** One `Latest` per thing that is read asynchronously. */
const tabWork = new Latest();
const casesWork = new Latest();
const caseWork = new Latest();
const imagesWork = new Latest();
/** Who may write under the open case's buttons (hints.ts). */
const caseHints = new CaseHints();
const sitesWork = new Latest();
const downloadsWork = new Latest();

/** Refreshes of the tab running now. */
let refreshing = 0;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
	const windowId = await panelWindow();
	if (windowId === undefined) return undefined;
	const [tab] = await chrome.tabs.query({ active: true, windowId });
	return tab;
}

/** The tab's size in CSS pixels, as a case records its viewport. */
async function tabSize(tab: chrome.tabs.Tab): Promise<Size | undefined> {
	if (tab.id === undefined || !tab.width || !tab.height) return undefined;
	const zoom = await chrome.tabs.getZoom(tab.id).catch(() => 1);
	return cssSize({ width: tab.width, height: tab.height }, zoom);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sizeText = (s: Size) => `${s.width}×${s.height}`;

/** The panel shows that case. */
const showing = (caseId: string) =>
	state.view.kind === "case" && state.view.id === caseId;

/** The newest load: Hide, or another load, makes the older ones stale. */
const loadWork = new Latest();

/** What the newest load draws where, until Hide or the case closes. */
let loadTarget: Drawn | undefined;

/** A load of the case onto the tab: it makes the older ones stale. */
function startLoad(target: Drawn): ReturnType<Latest["start"]> {
	loadTarget = target;
	return loadWork.start();
}

/** No load goes on, and none that is under way draws its marks. */
function stopLoads(): void {
	loadTarget = undefined;
	loadWork.cancel();
	// A draw waiting to search again is over too: a follow may draw anew.
	setDrawing(undefined);
}

/**
 * Where the panel drew a case's marks last (DEC-022): they follow the open
 * case to the tab in front, and leave the tab they were on. Marks an AI app
 * loaded are the page's, not these.
 */
let drawn: Drawn | undefined;

/** A draw by `follow` under way. */
let drawing: Drawn | undefined;

/** Loads waiting for the page's answer: its news meanwhile may predate them. */
let loadsUnderWay = 0;

/**
 * Tabs the user took the open case's marks off ("Hide marks"): they are not
 * drawn there again by themselves until "Show marks", or the case is opened
 * again. The state's, so the case view can say so.
 */
const hiddenOn = state.hiddenOn;

/**
 * Tabs where the panel put the toolbar up for the open case ("Add marks", or
 * the case opened from the toolbar): "← All cases" ends it there too, as on
 * the tab in front (DEC-023).
 */
const toolbarOn = new Set<number>();

/** A draw by `follow` is under way (or over): the case view says so. */
function setDrawing(d: Drawn | undefined): void {
	drawing = d;
	update((s) => (s.drawing = d?.tabId));
}

/** The tab `follow` last saw in front: hints about another tab go. */
let followed: number | undefined;

const sameDrawn = (a: Drawn | undefined, b: Drawn | undefined) =>
	a !== undefined &&
	b !== undefined &&
	a.tabId === b.tabId &&
	a.caseId === b.caseId;

/** Take the panel's marks of that case off that tab; a closed or reloaded tab has none. */
function takeOff(d: Drawn): void {
	if (sameDrawn(drawn, d)) drawn = undefined;
	void chrome.tabs
		.sendMessage(d.tabId, { type: "case:clear", caseId: d.caseId })
		.catch(() => undefined);
}

/**
 * A tab Sitegloss may not run on yet, with the open case to draw there once
 * the icon's click (or "Allow on all sites") lets it in.
 */
let pendingLoad: { tabId: number; caseId: string } | undefined;

/**
 * A mark's link was clicked (DEC-050): once the tab has loaded `url` and
 * its marks are drawn there, that mark is brought into view and outlined.
 * Held for a while only: a page that never comes (a sign-in in between)
 * shows nothing later on.
 */
let pendingShow:
	| {
			tabId: number;
			caseId: string;
			annotationId: string;
			mark: string;
			url: string;
			until: number;
	  }
	| undefined;

/** How long a mark's link waits for its page and the marks on it. */
const SHOW_WAIT_MS = 120_000;

/**
 * The marks are drawn on a tab: the mark a link was clicked for, if it is
 * of that tab and case and the page is the one opened, is shown now; while
 * it is not found yet and the draw looks once more, it waits for that.
 */
async function showPending(): Promise<void> {
	const p = pendingShow;
	const loaded = state.loaded;
	if (p === undefined || loaded === undefined) return;
	if (Date.now() > p.until) {
		pendingShow = undefined;
		return;
	}
	if (
		loaded.tabId !== p.tabId ||
		loaded.caseId !== p.caseId ||
		!exactPage(loaded.url, p.url)
	)
		return;
	const m = loaded.matches.get(p.annotationId);
	if (m === undefined) return;
	if (!isFound(m) && m.status !== "no-element" && loaded.settling) return;
	pendingShow = undefined;
	const shown = (await chrome.tabs
		.sendMessage(p.tabId, {
			type: "case:show",
			caseId: p.caseId,
			annotationId: p.annotationId,
			mark: p.mark,
		})
		.catch(() => null)) as AnnotationMatch | { error: string } | null;
	if (shown === null || "error" in shown) return;
	update((s) => {
		if (s.loaded?.tabId === p.tabId && s.loaded.caseId === p.caseId)
			s.loaded.matches.set(p.annotationId, shown);
	});
}

/**
 * Loads the case onto the tab and says how it went; `undefined` when it could
 * not, the hint says why. `again`: the marks not found are looked for once
 * more in a moment.
 */
async function loadInto(
	c: Case,
	tabId: number,
	hint: (text: CaseHint | undefined) => void,
	work: { current: () => boolean },
	again = false,
	quietWhenBusy = false,
): Promise<{ found: number; total: number } | "busy" | undefined> {
	const here = { tabId, caseId: c.id };
	try {
		loadsUnderWay++;
		const result = await sendToTab<
			LoadResult | LoadReplacedAnswer | { error: string; busy?: true }
		>(tabId, {
			type: "case:load",
			case: c,
		}).finally(() => loadsUnderWay--);
		// Stopped by a clear (Hide, the case closed) or another case's load:
		// nothing to say, and no marks of this load's are on the page. Still
		// the newest: what the page shows now decides (the Hide on its bar).
		if ("replaced" in result) {
			// What an earlier search found no longer holds either.
			if (work.current() && !(await followPage(c.id, tabId))) hint(undefined);
			return undefined;
		}
		if ("error" in result) {
			// The page is busy a moment (a mark's screenshot or add): the caller
			// tries again, and the busy sentence is not left standing.
			if (result.busy && quietWhenBusy) return "busy";
			// A stale load's failure is about a tab no longer in question.
			if (work.current()) hint(result.error);
			return undefined;
		}
		// Hidden or closed meanwhile: the marks this load drew go too, unless a
		// newer load draws them there again.
		if (!work.current()) {
			if (sameDrawn(loadTarget, here)) drawn = here;
			// A newer load of the case drew them (an AI app's load_case): its,
			// unless the case is closed: "← All cases" takes its marks off
			// whoever drew them (DEC-023).
			else if (!result.adopted || !showing(c.id)) takeOff(here);
			return undefined;
		}
		drawn = here;
		// The marks follow the case to the tab in front (DEC-022), and the
		// results describe that tab (see refreshTab).
		if ((await activeTab())?.id !== tabId) {
			takeOff(here);
			return undefined;
		}
		// What the page shows now decides: a clear right behind the draw (the
		// Hide on its bar, an AI app, another window's panel) may have taken
		// the marks off before this answer came, and its news came while the
		// load was under way, when it says nothing (DEC-023).
		if (!(await followPage(c.id, tabId))) {
			hint(undefined);
			return undefined;
		}
		const found = result.matches.filter(isFound).length;
		const settling = again && found < result.matches.length;
		update((s) => {
			s.loaded = {
				caseId: c.id,
				tabId,
				matches: new Map(result.matches.map((m) => [m.annotationId, m])),
				url: result.url,
				settling,
			};
		});
		// What it found, worded from `loaded` as it is now (`foundLine`).
		hint({ kind: "found" });
		void showPending();
		return { found, total: result.matches.length };
	} catch (error) {
		if (work.current()) hint(describeError(error));
		return undefined;
	}
}

/**
 * After a draw of the case on the tab: what the page shows now decides
 * (DEC-023), as its news would, which says nothing while a load is under
 * way. Cleared (the Hide on its bar, an AI app, another window's panel): it
 * holds as the page's own Hide does (DEC-022), and the searches again stop;
 * another case there is an AI app's, left to it. Answers whether the page
 * still shows the case (or cannot say: it has navigated).
 */
async function followPage(caseId: string, tabId: number): Promise<boolean> {
	const now = await overlayState(tabId);
	if (now === undefined || now.loadedCase === caseId) return true;
	if (sameDrawn(drawn, { tabId, caseId })) drawn = undefined;
	if (now.loadedCase === undefined) {
		hiddenOn.add(tabId);
		if (loadTarget?.tabId === tabId) stopLoads();
	}
	update((s) => {
		if (s.tab?.id === tabId) s.overlay = now;
		if (s.loaded?.tabId === tabId && s.loaded.caseId === caseId)
			s.loaded = undefined;
	});
	return false;
}

/** How long after a route change the page is asked once more: its content may come late. */
const ROUTE_SETTLE_MS = 1800;

/**
 * The tab went on to another page with the case still drawn on it (a
 * single-page app's next route): the page looks again for the marks it did
 * not have, and says what it found there. Once more a moment later
 * (`again`), for content that comes after the address.
 */
async function readMatches(
	c: Case,
	tabId: number,
	hint: ReturnType<typeof followHint>,
	again: boolean,
): Promise<void> {
	const result = (await chrome.tabs
		.sendMessage(tabId, { type: "case:matches", caseId: c.id })
		.catch(() => null)) as LoadResult | null;
	// Not for what another draw put there meanwhile.
	if (
		result === null ||
		!showing(c.id) ||
		(state.loaded !== undefined &&
			(state.loaded.tabId !== tabId || state.loaded.caseId !== c.id))
	)
		return;
	update((s) => {
		s.loaded = {
			caseId: c.id,
			tabId,
			matches: new Map(result.matches.map((m) => [m.annotationId, m])),
			url: result.url,
			settling: again,
		};
	});
	hint({ kind: "found" });
	void showPending();
	if (!again) return;
	setTimeout(() => {
		// Still that page of that case on that tab: what it has now.
		if (
			state.loaded?.tabId === tabId &&
			state.loaded.caseId === c.id &&
			state.loaded.url === result.url &&
			state.current?.id === c.id
		)
			void readMatches(state.current, tabId, hint, false);
	}, ROUTE_SETTLE_MS);
}

/**
 * The page shows the case already (the panel opened it from there): what it
 * found, without a draw again, which would drop the candidates chosen.
 */
async function readLoaded(c: Case, tabId: number): Promise<void> {
	const hint = followHint();
	const result = (await chrome.tabs
		.sendMessage(tabId, { type: "case:update", case: c })
		.catch(() => null)) as LoadResult | null;
	if (result === null || !showing(c.id) || state.loaded !== undefined) return;
	update((s) => {
		s.loaded = {
			caseId: c.id,
			tabId,
			matches: new Map(result.matches.map((m) => [m.annotationId, m])),
			url: result.url,
		};
	});
	hint({ kind: "found" });
	void showPending();
}

/** A page busy with a mark is asked again this often, this many times (20 s). */
const BUSY_WAIT_MS = 500;
const BUSY_TRIES = 40;

/**
 * Loads the case onto a page that has just loaded. What a script draws after
 * the load is not there yet: marks not found are looked for twice more, while
 * the panel still shows the case and the tab is in front. A page busy with a
 * mark is asked again until it is free.
 */
async function loadOnLoaded(
	c: Case,
	tabId: number,
	hint: (text: CaseHint | undefined) => void,
): Promise<void> {
	const target = { tabId, caseId: c.id };
	const work = startLoad(target);
	setDrawing(target);
	try {
		const waits = [0, 1000, 2000];
		for (const [i, wait] of waits.entries()) {
			let now = c;
			if (wait > 0) {
				await sleep(wait);
				if (!work.current() || !showing(c.id) || hiddenOn.has(tabId)) return;
				if ((await activeTab())?.id !== tabId) return;
				// As stored now: a mark may have gone in meanwhile.
				const stored = await store.getCase(c.id);
				if (stored === undefined || !work.current()) return;
				now = stored;
			}
			let result = await loadInto(
				now,
				tabId,
				hint,
				work,
				i < waits.length - 1,
				true,
			);
			// The page is busy (the next mark's screenshot or add, review of
			// PR 57): drawn once it is free, as the searches again are.
			for (let tries = 0; result === "busy"; tries++) {
				if (tries >= BUSY_TRIES) return;
				await sleep(BUSY_WAIT_MS);
				if (!work.current() || !showing(c.id) || hiddenOn.has(tabId)) return;
				if ((await activeTab())?.id !== tabId) return;
				const stored = await store.getCase(c.id);
				if (stored === undefined || !work.current()) return;
				now = stored;
				result = await loadInto(
					now,
					tabId,
					hint,
					work,
					i < waits.length - 1,
					true,
				);
			}
			if (result === undefined || result.found === result.total) return;
		}
	} finally {
		if (drawing === target) setDrawing(undefined);
	}
}

/** The newest `follow`: one that started later knows the tab in front better. */
const followWork = new Latest();

/** The tab in front of the panel's window, as `follow` needs it. */
async function frontTab(): Promise<
	{ id: number; url: string; loading: boolean } | undefined
> {
	const tab = await activeTab();
	return tab?.id === undefined
		? undefined
		: { id: tab.id, url: tab.url ?? "", loading: tab.status === "loading" };
}

/**
 * The open case's marks follow it to the tab in front (DEC-022): drawn there,
 * taken off the tab they were on. Only the newest call acts: one that waited
 * for a slow page while another tab came to the front does nothing.
 */
async function follow(): Promise<void> {
	const work = followWork.start();
	// What the draw found goes under the case's buttons, unless the user did
	// something there meanwhile (Match size, Export): that one's outcome stays.
	const hint = followHint();
	const c = state.view.kind === "case" ? state.current : undefined;
	if (c === undefined || !showing(c.id)) {
		// Not read yet: opening it follows once it is.
		if (state.view.kind !== "case" && drawn !== undefined) takeOff(drawn);
		return;
	}
	const front = await frontTab();
	const page =
		front === undefined || front.url === ""
			? undefined
			: await overlayState(front.id);
	const pageCase = page?.loadedCase;
	// Still the tab in front, and no newer follow: else that one decides.
	if ((await frontTab())?.id !== front?.id || !work.current()) return;
	// The panel went on to another case, or back to the list, meanwhile.
	if (state.current?.id !== c.id || !showing(c.id)) return;
	const step = followStep({
		caseId: c.id,
		tab: front,
		drawn,
		pageCase,
		hidden: hiddenOn,
	});
	if (step.clear !== undefined) takeOff(step.clear);
	// A case without marks (just created, DEC-026) has nothing to draw: its
	// first mark draws it (refreshCase).
	if (front === undefined || c.annotations.length === 0) return;
	// The page went on to its next route with the case drawn on it: what was
	// found is read again, for the page it shows now (DEC-038's review).
	if (movedOn(state.loaded, c.id, front, pageCase)) {
		await readMatches(c, front.id, hint, true);
		return;
	}
	if (front.id !== followed) {
		// What the hints said was about the tab before (opening the case
		// cleared them already).
		if (followed !== undefined) hint(undefined);
		followed = front.id;
	}
	if (step.action === "wait") {
		pendingLoad = { tabId: front.id, caseId: c.id };
		return;
	}
	if (step.action !== "draw") return;
	const target = { tabId: front.id, caseId: c.id };
	// Under way already (a page that starts loading again ends that).
	if (sameDrawn(drawing, target)) return;
	if (pendingLoad?.tabId === front.id) pendingLoad = undefined;
	await loadOnLoaded(c, front.id, hint);
}

/** Waits until the window has left full screen or maximised, three seconds at most. */
async function normalWindow(windowId: number): Promise<void> {
	for (let i = 0; i < 30; i++) {
		if ((await chrome.windows.get(windowId)).state === "normal") return;
		await sleep(100);
	}
}

/** Waits until the tab's size holds still, a second at most. */
async function settledSize(tabId: number): Promise<void> {
	let last = "";
	for (let i = 0; i < 10; i++) {
		await sleep(100);
		const tab = await chrome.tabs.get(tabId);
		const now = `${tab.width}×${tab.height}`;
		if (now === last) return;
		last = now;
	}
}

/** The overlay's state on the tab, or `undefined` where it is not injected. */
async function overlayState(tabId: number): Promise<OverlayState | undefined> {
	try {
		return (await chrome.tabs.sendMessage(tabId, {
			type: "overlay:state",
		})) as OverlayState;
	} catch {
		return undefined;
	}
}

/** Firefox's "Access local files on your computer" for Sitegloss. */
const firefoxFileAccess = () =>
	chrome.extension.isAllowedFileSchemeAccess().catch(() => false);

async function refreshTab(): Promise<void> {
	const work = tabWork.start();
	refreshing++;
	try {
		const tab = await activeTab();
		const overlay =
			tab?.id === undefined ? undefined : await overlayState(tab.id);
		const size = tab === undefined ? undefined : await tabSize(tab);
		const files = FIREFOX ? await firefoxFileAccess() : undefined;
		// Firefox tells a file's address, which Chrome hides, also where
		// Sitegloss may not run on it: hidden here, as in Chrome.
		const hidden =
			files === false && (tab?.url ?? "").toLowerCase().startsWith("file:");
		if (!work.current()) return;
		update((s) => {
			if (files !== undefined) s.fileAccess = files;
			const next =
				tab?.id === undefined
					? undefined
					: {
							id: tab.id,
							url: hidden ? "" : (tab.url ?? ""),
							title: hidden ? "" : (tab.title ?? ""),
							size,
							loading: tab.status === "loading",
						};
			// A hint is about the tab in front when it was given; the first read
			// of that tab is no change of it.
			if (
				s.tab !== undefined &&
				(next?.id !== s.tab.id || next?.url !== s.tab.url)
			)
				s.hint = undefined;
			s.tab = next;
			s.overlay = overlay;
			unblock(s);
			// Results describe the tab they came from, with that case loaded.
			if (
				s.loaded !== undefined &&
				(tab?.id !== s.loaded.tabId || overlay?.loadedCase !== s.loaded.caseId)
			)
				s.loaded = undefined;
		});
		// The panel takes over what the page shows (DEC-023).
		if (firstRead && tab?.id !== undefined) {
			firstRead = false;
			void adoptLoaded(tab.id, overlay);
		}
		void adopt();
	} finally {
		refreshing--;
	}
	await refreshCases();
}

/** The panel has not read the tab in front yet. */
let firstRead = true;

/** A toolbar's case being checked by `adopt`. */
let adopting: string | undefined;

/**
 * On Home, a toolbar on the tab in front that adds to a stored case opens
 * that case (DEC-023): a panel opened again is in the case the toolbar adds
 * to; one whose case is gone ends (DEC-026). The page is asked once more, so
 * news older than "← All cases" opens nothing.
 */
async function adopt(): Promise<void> {
	const tabId = state.tab?.id;
	const caseId = state.overlay?.visible
		? state.overlay.target?.caseId
		: undefined;
	if (
		state.view.kind !== "home" ||
		state.leaving !== undefined ||
		tabId === undefined ||
		caseId === undefined ||
		adopting !== undefined
	)
		return;
	adopting = caseId;
	try {
		const [c, now] = await Promise.all([
			store.getCase(caseId),
			overlayState(tabId),
		]);
		if (!now?.visible || now.target?.caseId !== caseId) return;
		if (state.view.kind !== "home" || (await activeTab())?.id !== tabId) return;
		// Its case was deleted meanwhile (elsewhere, the tab not in front): the
		// toolbar ends, as clearDeleted ends it (DEC-026), and with the title
		// the panel last knew: whichever of the two ends it says the same.
		if (c === undefined)
			return await endDeleted(caseId, lastTitles.get(caseId));
		toolbarOn.add(tabId);
		update((s) => {
			if (s.tab?.id === tabId) s.overlay = now;
		});
		// Marks the page shows of the case are the panel's from now on, as
		// in adoptLoaded: they follow the case (DEC-022).
		if (now.loadedCase === caseId) drawn = { tabId, caseId };
		openCase(caseId);
		if (now.loadedCase === caseId) void readLoaded(c, tabId);
	} finally {
		adopting = undefined;
	}
}

/**
 * The panel's first read of the tab in front: a stored case whose marks the
 * page shows opens (DEC-023), so closing the side panel and opening it again
 * is no way to leave marks without their case. A toolbar adding to a case
 * decides instead (`adopt`).
 */
async function adoptLoaded(
	tabId: number,
	overlay: OverlayState | undefined,
): Promise<void> {
	const caseId = overlay?.loadedCase;
	if (caseId === undefined || (overlay?.visible && overlay.target)) return;
	const c = await store.getCase(caseId);
	if (c === undefined || state.view.kind !== "home") return;
	// The panel's own marks from now on: they follow the case (DEC-022).
	drawn = { tabId, caseId };
	openCase(caseId);
	void readLoaded(c, tabId);
}

/** Only the size of the tab in front: a window or the panel was resized, or zoomed. */
async function refreshSize(onlyChanged = false): Promise<void> {
	const tab = await activeTab();
	const size = tab && (await tabSize(tab));
	const now = state.tab?.size;
	if (
		onlyChanged &&
		(size === undefined
			? now === undefined
			: now !== undefined && sameSize(size, now))
	)
		return;
	update((s) => {
		if (s.tab !== undefined && s.tab.id === tab?.id) s.tab = { ...s.tab, size };
	});
}

async function refreshCases(): Promise<void> {
	const work = casesWork.start();
	const cases = await store.listCases();
	if (work.current()) update((s) => (s.cases = cases));
}

function releaseImages(s: PanelState): void {
	for (const url of s.images?.urls.values() ?? []) URL.revokeObjectURL(url);
	s.images = undefined;
}

/** Read the open case again, and its images when it changed. */
async function refreshCase(): Promise<void> {
	if (state.view.kind !== "case") return;
	const id = state.view.id;
	const work = caseWork.start();
	const c = await store.getCase(id);
	if (!work.current()) return;
	if (c === undefined) return closeCase();
	const opened = state.current?.id !== c.id;
	const first =
		!opened &&
		state.current?.annotations.length === 0 &&
		c.annotations.length > 0;
	update((s) => {
		s.current = c;
		// What can no longer be told from another mark is let go, and said.
		const lost = [s.markEdit, s.markDeleteArmed, s.findingDeleteArmed].some(
			(held) =>
				held !== undefined &&
				markFor(c, held.annotationId, held.mark) === "ambiguous",
		);
		// An open form stays on its mark, whatever the mark's id is now; so
		// does a delete asked once (its second click must not find another
		// mark under the id).
		s.markEdit = editAfter(s.markEdit, c);
		s.markDeleteArmed = heldAfter(s.markDeleteArmed, c);
		s.findingDeleteArmed = heldAfter(s.findingDeleteArmed, c);
		if (lost) s.caseHint = MARK_CHANGED;
	});
	// Just opened, or its first mark is in: its marks go to the tab in front
	// (DEC-022, DEC-026).
	if (opened || first) void follow();
	if (state.images?.caseId === c.id && state.images.version === c.updatedAt)
		return;
	const images = imagesWork.start();
	const urls = new Map<string, string>();
	for (const path of [
		...c.shots.map((x) => x.image),
		...c.annotations.map((a) => a.crop),
	]) {
		const image = await store.getImage(c.id, path);
		if (image !== undefined) urls.set(path, URL.createObjectURL(image.blob));
	}
	if (!images.current()) {
		for (const url of urls.values()) URL.revokeObjectURL(url);
		return;
	}
	update((s) => {
		releaseImages(s);
		s.images = { caseId: c.id, version: c.updatedAt, urls };
	});
}

/** Open a case, and draw its marks on the tab in front (DEC-022). */
function openCase(id: string): void {
	caseHints.cancel();
	const other = state.view.kind !== "case" || state.view.id !== id;
	// Opened again: a Hide on a tab holds no longer.
	if (other) hiddenOn.clear();
	update((s) => {
		if (other) {
			s.current = undefined;
			s.verdictStatus = undefined;
			releaseImages(s);
		}
		s.view = { kind: "case", id };
		s.caseHint = undefined;
		s.deleteArmedAt = undefined;
		s.markEdit = undefined;
		s.renaming = undefined;
		s.linking = undefined;
		s.markFilter = undefined;
		s.markDeleteArmed = undefined;
		s.findingDeleteArmed = undefined;
		s.leaving = undefined;
	});
	followed = undefined;
	void refreshCase();
}

/**
 * A tab's answer to `overlay:end` comes once its marks are in, or not: a mark
 * may wait for an AI app's screenshot (10 s) and take its own (8 s at most).
 * A tab that says nothing for longer (frozen by Chrome, a page in an
 * `alert()`) counts as ended.
 */
const END_TIMEOUT_MS = 20_000;

/**
 * End the toolbar adding to the case (`overlay:end`) on the tab in front and
 * wherever the panel put it up for the case; answers how many marks are
 * still not in the case where a toolbar stays up for it, and the state of
 * the tab in front.
 */
async function endToolbars(
	caseId: string,
	how: { discard?: boolean; retry?: boolean },
): Promise<{
	left: number;
	front: OverlayState | undefined;
	/** A tab did not answer in time: it may still hold a mark. */
	timedOut: boolean;
}> {
	const front = (await activeTab())?.id;
	const tabs = new Set(toolbarOn);
	if (front !== undefined) tabs.add(front);
	let timedOut = false;
	const answers = await Promise.all(
		[...tabs].map(async (tabId) => {
			const answer = (await Promise.race([
				chrome.tabs
					.sendMessage(tabId, { type: "overlay:end", caseId, ...how })
					.catch(() => undefined),
				sleep(END_TIMEOUT_MS).then(() => {
					timedOut = true;
					return undefined;
				}),
			])) as OverlayState | undefined;
			return { tabId, answer };
		}),
	);
	let left = 0;
	for (const { tabId, answer } of answers) {
		if (answer?.visible && answer.target?.caseId === caseId)
			left += Math.max(1, answer.drafts);
		else toolbarOn.delete(tabId);
	}
	return {
		left,
		front: answers.find((a) => a.tabId === front)?.answer,
		timedOut,
	};
}

/**
 * What every tab, in every window, says of its overlay: `none` where no
 * content script answers (nothing of Sitegloss's is there), `unsure` where
 * it does not answer in time.
 */
async function askAllTabs(): Promise<TabAnswer[]> {
	return [...(await askTabsById()).values()];
}

/** `askAllTabs`, by tab id. */
async function askTabsById(): Promise<Map<number, TabAnswer>> {
	const tabs = await chrome.tabs.query({}).catch(() => []);
	const answers = await Promise.all(
		tabs.map(async ({ id }): Promise<[number, TabAnswer]> => {
			if (id === undefined) return [-1, "none"];
			return [
				id,
				await Promise.race([
					chrome.tabs.sendMessage(id, { type: "overlay:state" }).then(
						(s) => (s as OverlayState | undefined) ?? "unsure",
						() => "none" as const,
					),
					sleep(ASK_TAB_MS).then(() => "unsure" as const),
				]),
			];
		}),
	);
	return new Map(answers);
}

/**
 * "← All cases" could not leave: it stays so only while the page in front
 * says that marks of the case are still not in it (its toolbar up, adding to
 * the case, with drafts); once they are, the line under the actions goes.
 */
function unblock(s: PanelState): void {
	if (s.leaving?.phase !== "blocked" || s.view.kind !== "case") return;
	const o = s.overlay;
	s.leaving =
		o?.visible && o.target?.caseId === s.view.id && o.drafts > 0
			? { phase: "blocked", left: o.drafts }
			: undefined;
}

/** What "← All cases" is at now (read again after an await). */
const leavingNow = (): PanelState["leaving"] => state.leaving;

/**
 * "← All cases" (DEC-023): the toolbar adding to the case finishes as its
 * Done does and adds to no case any more, then the case closes and its marks
 * leave the tab in front. A mark that could not be added keeps the toolbar
 * up and the panel in the case, which says so: the first click is no Done
 * again, so a mark an earlier Done left out is tried once more. The next
 * click ends it again, and the page decides: a mark its last Done left out
 * goes then, as with its own Done again; one drawn or tried since is tried
 * once more (DEC-014).
 */
async function leaveCase(): Promise<void> {
	if (state.view.kind !== "case" || state.leaving?.phase === "finishing")
		return;
	const caseId = state.view.id;
	// The first click tries the marks an earlier Done left out once more;
	// the second is the page's Done again.
	const retry = state.leaving?.phase !== "blocked";
	update((s) => (s.leaving = { phase: "finishing" }));
	// A refresh read before the end would show the toolbar as it was.
	tabWork.cancel();
	try {
		const { left, front, timedOut } = await endToolbars(caseId, { retry });
		// Closed meanwhile (deleted elsewhere), or opened again.
		if (!showing(caseId) || leavingNow()?.phase !== "finishing") return;
		if (left > 0) {
			update((s) => {
				s.leaving = { phase: "blocked", left };
				if (front !== undefined) s.overlay = front;
			});
			return;
		}
		// Gone before the list shows: no empty case flashes there (DEC-026);
		// never while a tab that did not answer may still hold a mark.
		if (!timedOut) await forgetUntouched(caseId);
		if (!showing(caseId) || leavingNow()?.phase !== "finishing") return;
		closeCase();
	} finally {
		// Not left for good when something above failed.
		if (leavingNow()?.phase === "finishing")
			update((s) => (s.leaving = undefined));
	}
}

/**
 * Back to the list: the marks the panel drew leave the page, and the case's
 * marks leave the tab in front whoever drew them (an AI app's load_case
 * too, DEC-023); another case's stay.
 */
function closeCase(): void {
	const caseId = state.view.kind === "case" ? state.view.id : undefined;
	caseWork.cancel();
	imagesWork.cancel();
	caseHints.cancel();
	stopLoads();
	hiddenOn.clear();
	pendingLoad = undefined;
	toolbarOn.clear();
	if (drawn !== undefined) takeOff(drawn);
	update((s) => {
		s.view = { kind: "home" };
		s.current = undefined;
		s.caseHint = undefined;
		s.deleteArmedAt = undefined;
		s.renaming = undefined;
		s.linking = undefined;
		s.loaded = undefined;
		s.leaving = undefined;
		// Where the case's export went is the case's.
		if (s.exported !== undefined && s.exported.of !== "all")
			s.exported = undefined;
		releaseImages(s);
	});
	void (async () => {
		const tab = await activeTab();
		if (caseId !== undefined && tab?.id !== undefined)
			await chrome.tabs
				.sendMessage(tab.id, { type: "case:clear", caseId })
				.catch(() => undefined);
		// Home shows the page as it is now.
		await refreshTab();
	})();
}

/**
 * For an action on the open case: writes its outcome under that case's
 * buttons, unless the panel left the case, or an action clicked after it
 * wrote there already (hints.ts).
 */
function caseHintWriter(): (text: CaseHint | undefined) => void {
	const may = caseHints.action();
	return (text) => {
		if (may()) update((s) => (s.caseHint = text));
	};
}

/**
 * For the panel's own draws: writes under the case's buttons while no action
 * of the user's has written there since, and stops no action's hint itself.
 */
function followHint(): (text: CaseHint | undefined) => void {
	const may = caseHints.draw();
	return (text) => {
		if (may()) update((s) => (s.caseHint = text));
	};
}

/** The loaded case's results no longer describe the tab: drop them (and the marks). */
async function forgetLoaded(
	options: { hint?: string; clearTab?: boolean } = {},
): Promise<void> {
	const was = state.loaded;
	update((s) => {
		s.loaded = undefined;
		if (options.hint !== undefined) s.caseHint = options.hint;
	});
	if (was !== undefined && options.clearTab) takeOff(was);
}

/**
 * A deleted case's draft goes, its marks and bar leave the page, and a
 * toolbar adding to it ends (`endDeleted`). `title`: the case's, as the
 * panel knew it.
 */
async function clearDeleted(caseId: string, title?: string): Promise<void> {
	update((s) => s.verdictDrafts.delete(caseId));
	if (state.loaded?.caseId === caseId) await forgetLoaded({ clearTab: true });
	const tabId = state.tab?.id;
	// An AI app's load_case: only the page knows.
	if (tabId !== undefined && (await overlayState(tabId))?.loadedCase === caseId)
		await chrome.tabs
			.sendMessage(tabId, { type: "case:clear", caseId })
			.catch(() => undefined);
	await endDeleted(caseId, title);
}

/** A tab that does not answer (frozen, discarded) is no toolbar's. */
const ASK_TAB_MS = 2000;

/**
 * Toolbars still adding to a deleted case end, on every tab (an AI app's
 * delete_case, another window's panel): there is no new case to fall back
 * to (DEC-026). The marks not in the case yet go with it; only such a loss
 * is said, under This page.
 */
async function endDeleted(
	caseId: string,
	title: string | undefined,
): Promise<void> {
	const tabs = await chrome.tabs.query({}).catch(() => []);
	let lost = 0;
	await Promise.all(
		tabs.map(async ({ id }) => {
			if (id === undefined) return;
			const now = await Promise.race([
				overlayState(id),
				sleep(ASK_TAB_MS).then(() => undefined),
			]);
			if (now?.target?.caseId !== caseId) return;
			lost += now.drafts;
			toolbarOn.delete(id);
			await Promise.race([
				chrome.tabs
					.sendMessage(id, { type: "overlay:end", caseId, discard: true })
					.catch(() => undefined),
				sleep(END_TIMEOUT_MS),
			]);
		}),
	);
	if (lost > 0) update((s) => (s.hint = lostMarksText(title, lost)));
	void refreshTab();
}

/**
 * A case "New case for this page" made and the user left as it was made goes
 * again, silently (DEC-026), so trying the button leaves no empty case
 * behind. Never on doubt: every tab in every window must say that it holds
 * nothing of the case (a toolbar adding to it, a mark on its way or failed),
 * and one that does not answer keeps it. Checked as the case is stored, in
 * the delete's transaction.
 */
async function forgetUntouched(caseId: string): Promise<boolean> {
	if (mayHold(await askAllTabs(), caseId)) return false;
	const typed = state.verdictDrafts.get(caseId);
	const title = typedTitle(caseId);
	const link = typedLink(caseId);
	const gone = await store
		.deleteCaseIf(caseId, (c) => isUntouched(c, typed, title, link))
		.catch(() => false);
	if (!gone) return false;
	update((s) => {
		s.verdictDrafts.delete(caseId);
		s.cases = s.cases.filter((c) => c.id !== caseId);
	});
	announce(caseId);
	void refreshCases();
	return true;
}

/** A title typed in the case's Rename field and not saved yet. */
const typedTitle = (caseId: string) =>
	state.renaming?.caseId === caseId ? state.renaming.text : undefined;
const typedLink = (caseId: string) =>
	state.linking?.caseId === caseId ? state.linking.text : undefined;

/**
 * The last tab with the open case's toolbar closed: an untouched case is
 * left as "← All cases" leaves it, and goes (DEC-026). Another tab still
 * adding to it, or anything in it, keeps it open.
 */
async function leaveIfUntouched(caseId: string): Promise<void> {
	if (!showing(caseId) || toolbarOn.size > 0 || state.leaving !== undefined)
		return;
	const c = await store.getCase(caseId);
	if (
		c === undefined ||
		!isUntouched(
			c,
			state.verdictDrafts.get(caseId),
			typedTitle(caseId),
			typedLink(caseId),
		)
	)
		return;
	if (showing(caseId) && toolbarOn.size === 0) await leaveCase();
}

/** Tell a panel in another window; a page does not hear its own message. */
function announce(caseId: string): void {
	const news: Broadcast = { type: "cases:changed", caseId };
	chrome.runtime.sendMessage(news).catch(() => undefined);
}

/**
 * Show the toolbar adding to the open case: on the tab in front ("Add
 * marks"), or on `tabId`, the tab "New case for this page" was clicked for
 * (DEC-026), whatever tab is in front by then.
 */
async function startAnnotating(target: Case, tabId?: number): Promise<boolean> {
	// Under the case's buttons, and only where there is something to say
	// (what a draw found stays).
	const say = (text: string | undefined) => {
		if (text !== undefined) caseHintWriter()(text);
	};
	const id = tabId ?? (await activeTab())?.id;
	if (id === undefined) return false;
	const tab = { id };
	tabWork.cancel(); // a refresh still running must not overwrite this
	try {
		const overlay = await sendToTab<OverlayState>(tab.id, {
			type: "overlay:show",
			blurForms: await blurFormsNow(),
			target: {
				caseId: target.id,
				title: target.title,
				nextAnnotation: nextNumbers(target).annotation,
			},
		});
		toolbarOn.add(tab.id);
		update((s) => {
			if (s.tab?.id === tab.id) s.overlay = overlay;
		});
		say(
			overlay.saving
				? "Sitegloss is still saving the last marks on this page; the toolbar switches once that is done."
				: undefined,
		);
		return true;
	} catch (error) {
		say(describeError(error));
		return false;
	}
}

/**
 * Rename (DEC-026): stored at once, as every change is. The case list, the
 * export, case.md and the AI tools read the stored title; a toolbar adding to
 * the case is told.
 */
async function renameCase(caseId: string, text: string): Promise<void> {
	// The field says why an empty title is not saved.
	if (cleanTitle(text) === "") return;
	if (
		state.current?.id === caseId &&
		state.current.title === cleanTitle(text)
	) {
		update((s) => (s.renaming = undefined));
		return;
	}
	try {
		const saved = await store.updateCase(caseId, (current) => {
			if (current === undefined) throw new Error("the case no longer exists");
			return {
				value: validateCase(withTitle(current, text, new Date().toISOString())),
			};
		});
		update((s) => {
			if (s.renaming?.caseId === caseId) s.renaming = undefined;
			if (s.current?.id === caseId) s.current = saved;
		});
		announce(caseId);
		void refreshCases();
		void retitleToolbars(saved);
	} catch (error) {
		update((s) => {
			if (s.renaming?.caseId === caseId)
				s.renaming = {
					caseId,
					text: s.renaming.text,
					error: `Not renamed: ${message(error)}`,
				};
		});
	}
}

/** Under the link's field for a text that is no link (DEC-028). */
const NOT_A_LINK = "A link starts with https:// or http://";
const LINK_TOO_LONG = `A link has at most ${MAX_LINK} characters.`;

/**
 * The case's link (DEC-028): stored at once, as every change is; an empty
 * field removes it. Text that is no http or https address keeps the form
 * open and says so.
 */
/**
 * A change to the case's thread or its closing, by hand (DEC-046), in one
 * transaction; what went wrong is said under the case's buttons.
 */
async function changeThread(
	caseId: string,
	change: (c: Case, now: string) => Case,
): Promise<void> {
	const hint = caseHintWriter();
	try {
		const saved = await store.updateCase(caseId, (current) => {
			if (current === undefined) throw new Error("The case no longer exists.");
			return {
				value: validateCase(change(current, new Date().toISOString())),
			};
		});
		update((s) => {
			if (s.current?.id === caseId) s.current = saved;
		});
		announce(caseId);
		void refreshCases();
	} catch (error) {
		hint(`Not saved: ${message(error)}`);
	}
}

async function linkCase(caseId: string, text: string): Promise<void> {
	const link = text.trim() === "" ? undefined : cleanLink(text);
	if (link === undefined && text.trim() !== "") {
		update((s) => {
			if (s.linking?.caseId === caseId)
				s.linking = {
					caseId,
					text: s.linking.text,
					error: linkProblem(text) === "long" ? LINK_TOO_LONG : NOT_A_LINK,
				};
		});
		return;
	}
	if (state.current?.id === caseId && state.current.link === link) {
		update((s) => (s.linking = undefined));
		return;
	}
	// The form this save is for: one opened or typed in meanwhile stays.
	const saving = state.linking;
	try {
		const saved = await store.updateCase(caseId, (current) => {
			if (current === undefined) throw new Error("the case no longer exists");
			return {
				value: validateCase(withLink(current, link, new Date().toISOString())),
			};
		});
		update((s) => {
			if (s.linking === saving) s.linking = undefined;
			if (s.current?.id === caseId) s.current = saved;
		});
		announce(caseId);
		void refreshCases();
	} catch (error) {
		update((s) => {
			if (s.linking?.caseId === caseId)
				s.linking = {
					caseId,
					text: s.linking.text,
					error: `Not saved: ${message(error)}`,
				};
		});
	}
}

/**
 * Toolbars adding to the case say its new title (`overlay:title`): on every
 * tab, also one this panel did not start (opened again, another window).
 * A toolbar adding to another case ignores it.
 */
async function retitleToolbars(c: Case): Promise<void> {
	const tabs = (await chrome.tabs.query({}).catch(() => [])).flatMap((t) =>
		t.id === undefined ? [] : [t.id],
	);
	// Each on its own: a tab that does not answer holds up no other.
	await Promise.all(
		tabs.map(async (tabId) => {
			const now = (await chrome.tabs
				.sendMessage(tabId, {
					type: "overlay:title",
					caseId: c.id,
					title: c.title,
				})
				.catch(() => undefined)) as OverlayState | undefined;
			if (now !== undefined)
				update((s) => {
					if (s.tab?.id === tabId) s.overlay = now;
				});
		}),
	);
}

/** "New case for this page" is creating its case: a second click waits for it. */
let creating = false;

/**
 * How long "New case for this page" waits for the page to say what it is: a tab
 * in an alert(), paused in DevTools or still loading says nothing, and the
 * button must work again.
 */
const PAGE_ANSWER_MS = 5000;

/** What the page is, from its content script (injected if need be). */
async function askPage(tabId: number): Promise<PageInfo | undefined> {
	const ask = () =>
		sendToTab<PageInfo | undefined>(tabId, { type: "page:info" });
	const page = await ask();
	if (page !== undefined) return page;
	// Something there that does not answer it (not this build's content
	// script): once more, with it injected.
	await inject(tabId);
	return ask();
}

/**
 * "New case for this page" (DEC-026): the case is stored at once, with the
 * page's title and info and no marks, and opens as if chosen from the list,
 * with the toolbar on the page adding to it. The page says what it is; the
 * panel writes the case, as it writes every change to a case but a mark's
 * add (the worker's, from the page).
 */
async function annotate(): Promise<void> {
	if (creating) return;
	creating = true;
	try {
		// The tab clicked for: the case is its page's, and its toolbar goes
		// up there, whatever tab is in front when the page answers.
		const tabId = (await activeTab())?.id;
		if (tabId === undefined) return;
		tabWork.cancel();
		let page: PageInfo | "late" | undefined;
		try {
			page = await Promise.race([
				askPage(tabId),
				sleep(PAGE_ANSWER_MS).then(() => "late" as const),
			]);
		} catch (error) {
			update((s) => (s.hint = describeError(error)));
			return;
		}
		if (page === "late" || page === undefined) {
			update(
				(s) => (s.hint = "This page did not answer. Reload it and try again."),
			);
			return;
		}
		const id = newId("c");
		const made = newCase(id, page, new Date().toISOString());
		const c = await store.updateCase(id, (current) => {
			if (current !== undefined)
				throw new Error("a case with this id exists already");
			return { value: made };
		});
		announce(c.id);
		update((s) => (s.hint = undefined));
		openCase(c.id);
		await startAnnotating(c, tabId);
	} catch (error) {
		update((s) => (s.hint = `Could not start a case: ${message(error)}`));
	} finally {
		creating = false;
	}
}

/** An import is at work, or its question is open: no other import starts. */
const importBusy = () =>
	state.importWork !== undefined || state.importing !== undefined;

/**
 * Do an import's work (on `what`, a file's name), one at a time: the import
 * buttons are off meanwhile, and a second import does not start.
 */
async function importWork(
	what: string,
	work: () => Promise<void>,
): Promise<void> {
	if (state.importWork !== undefined) return;
	update((s) => (s.importWork = what));
	try {
		await work();
	} finally {
		update((s) => (s.importWork = undefined));
	}
}

/** Store one case of a file; the drawn marks of the version it replaced go. */
async function storeOne(parsed: CheckedExport, copy: boolean): Promise<Case> {
	const c = await storeImport(store, parsed, { copy });
	// Results (and drawn marks) of the version it replaced describe other marks.
	if (state.loaded?.caseId === c.id) await forgetLoaded({ clearTab: true });
	announce(c.id);
	return c;
}

/**
 * Store the case asked about. A file's only case opens; in a file of several
 * the next one follows.
 */
async function finishImport(
	parsed: CheckedExport,
	copy: boolean,
	batch?: ImportBatch,
): Promise<void> {
	update((s) => (s.importing = undefined));
	try {
		const c = await storeOne(parsed, copy);
		if (batch !== undefined) {
			batch.stored++;
			return await importRest(batch);
		}
		// Its marks are drawn on the tab in front, as for any case opened;
		// but not over a case opened meanwhile, whose toolbar may be up
		// (DEC-023): the list shows it.
		if (state.view.kind === "home") openCase(c.id);
		else {
			update((s) => (s.importDone = `Imported “${c.title}”.`));
			void refreshCases();
		}
	} catch (error) {
		update(
			(s) =>
				(s.importError =
					batch === undefined
						? `Could not import: ${message(error)}`
						: `Could not import every case of ${batch.name}: ${message(error)} ${batchText(batch)}`),
		);
		if (batch !== undefined) void refreshCases();
	}
}

/** "Imported all 3 cases of cases.zip." */
function batchText(b: ImportBatch): string {
	const skipped = b.skipped > 0 ? `, ${b.skipped} left as they were` : "";
	return b.stored === b.total
		? `Imported all ${b.total} cases of ${b.name}.`
		: `Imported ${b.stored} of the ${b.total} cases of ${b.name}${skipped}.`;
}

/**
 * Import a file's cases one after the other: a new one at once, one that is
 * here already after the same question as a single case (DEC-020).
 */
async function importRest(batch: ImportBatch): Promise<void> {
	try {
		for (let next = batch.rest.shift(); next; next = batch.rest.shift()) {
			const parsed = next;
			const existing = await store.getCase(parsed.case.id);
			if (existing !== undefined) {
				update((s) => (s.importing = { parsed, existing, batch }));
				return;
			}
			await storeOne(parsed, false);
			batch.stored++;
		}
		update((s) => (s.importDone = batchText(batch)));
	} catch (error) {
		update(
			(s) =>
				(s.importError = `Could not import every case of ${batch.name}: ${message(error)} ${batchText(batch)}`),
		);
	} finally {
		void refreshCases();
	}
}

/** The visible note while Chrome's prompt for downloads is open. */
function asking(of: Exported["of"], allowed: Promise<boolean>): void {
	if (state.downloads) return;
	update((s) => (s.askingDownloads = of));
	void allowed.then(() =>
		update((s) => {
			if (s.askingDownloads === of) s.askingDownloads = undefined;
		}),
	);
}

/** Save an export, and show where it went when Chrome tells. */
async function saveExport(
	of: Exported["of"],
	bytes: Uint8Array | Blob,
	name: string,
	allowed: Promise<boolean>,
): Promise<void> {
	const saved: SavedFile | undefined = await saveFile(bytes, name, allowed);
	if (saved !== undefined) update((s) => (s.exported = { of, ...saved }));
}

async function refreshDownloads(): Promise<void> {
	const work = downloadsWork.start();
	const granted = await chrome.permissions.contains(DOWNLOADS);
	if (work.current()) update((s) => (s.downloads = granted));
}

const actions: Actions = {
	annotate: () => void annotate(),

	openCase,
	closeCase: () => void leaveCase(),
	closeSettings: () =>
		update((s) => {
			s.settings = false;
			// What to do after pairing is said once, in the card that paired.
			delete s.ai.justPaired;
		}),

	loadOntoTab(c) {
		// Off while Sitegloss may not run on the tab (view.ts): the notice
		// above it says what lets it.
		const hint = caseHintWriter();
		void (async () => {
			const tab = await activeTab();
			if (tab?.id === undefined) return;
			const work = startLoad({ tabId: tab.id, caseId: c.id });
			// Shown again by hand: a Hide on this tab holds no longer.
			hiddenOn.delete(tab.id);
			// This load replaces one the icon's click would start.
			if (pendingLoad?.tabId === tab.id) pendingLoad = undefined;
			await loadInto(c, tab.id, hint, work);
		})();
	},

	hideFromTab(c) {
		stopLoads();
		caseHints.cancel();
		// Where the panel loaded the case, and the tab in front where an AI app did.
		const tabs = new Set<number>();
		if (state.loaded?.caseId === c.id) tabs.add(state.loaded.tabId);
		if (drawn?.caseId === c.id) tabs.add(drawn.tabId);
		if (state.overlay?.loadedCase === c.id && state.tab !== undefined)
			tabs.add(state.tab.id);
		// Not drawn there again by itself (DEC-022).
		if (state.tab !== undefined) hiddenOn.add(state.tab.id);
		for (const tabId of tabs) hiddenOn.add(tabId);
		update((s) => {
			s.loaded = undefined;
			s.caseHint = undefined;
			// The page's news would say so too, a moment later.
			if (s.overlay?.loadedCase === c.id) {
				const { loadedCase: _, ...rest } = s.overlay;
				s.overlay = rest;
			}
		});
		for (const tabId of tabs) takeOff({ tabId, caseId: c.id });
	},

	allowAllSites() {
		// Chrome asks only during a click: nothing may be awaited before this.
		void requestPermissions(ALL_SITES).then(
			// A yes: permissions.onAdded draws the open case's marks.
			() => refreshAllSites(),
			(error: unknown) =>
				update(
					(s) => (s.hint = `Could not change the access: ${message(error)}`),
				),
		);
	},

	openDetails() {
		void chrome.tabs
			.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
			.catch((error: unknown) =>
				update(
					(s) => (s.hint = `Could not open the details: ${message(error)}`),
				),
			);
	},

	openPage(c, url = c.page.url) {
		// One of the case's own pages only (DEC-038).
		if (!isWebPage(url) || !casePages(c).some((p) => p.url === url)) return;
		const hint = caseHintWriter();
		// Now, while the click allows Chrome's prompt. The tab opens meanwhile;
		// once it has loaded, the case's marks follow it there (DEC-022), and
		// without a yes the icon's click lets Sitegloss run there.
		void askForSite(url);
		void chrome.tabs
			.create({ url })
			.catch((error: unknown) =>
				hint(`Could not open the page: ${message(error)}`),
			);
	},

	openMarkPage(c, a, where) {
		// Worked out again here, from the case and the tab as they are.
		const targets = markTargets(c, a, state.tab?.url);
		const url = where === "here" ? targets?.here : targets?.made;
		if (url === undefined) return;
		const hint = caseHintWriter();
		// Now, while the click allows Chrome's prompt; without a yes the
		// icon's click lets Sitegloss run there, as for a page of the case.
		void askForSite(url);
		void (async () => {
			const tab = await activeTab();
			if (tab?.id === undefined || !showing(c.id)) return;
			const tabId = tab.id;
			pendingShow = {
				tabId,
				caseId: c.id,
				annotationId: a.id,
				mark: markKey(c, a),
				url,
				until: Date.now() + SHOW_WAIT_MS,
			};
			// Asked for by name: a Hide on that tab holds no longer.
			if (hiddenOn.has(tabId)) update(() => hiddenOn.delete(tabId));
			// Already there, with the marks drawn: shown at once.
			if (
				tab.url === url &&
				state.loaded?.tabId === tabId &&
				state.loaded.caseId === c.id
			) {
				await showPending();
				return;
			}
			// The case stays open; its marks follow the tab once it has loaded
			// (DEC-022), and the mark is shown then (`showPending`).
			await chrome.tabs
				.update(tabId, { url })
				.catch((error: unknown) =>
					hint(`Could not open the page: ${message(error)}`),
				);
		})();
	},

	matchSize(c) {
		const hint = caseHintWriter();
		void (async () => {
			try {
				const first = await activeTab();
				// The window the marks of the page in front were made in (DEC-038).
				const made = viewportAt(c, first?.url ?? state.tab?.url);
				const want = { width: made.width, height: made.height };
				if (first?.id === undefined) return;
				// A maximised or full-screen window takes no size; leaving that
				// state takes a moment (an animation on macOS).
				if ((await chrome.windows.get(first.windowId)).state !== "normal") {
					await chrome.windows.update(first.windowId, { state: "normal" });
					await normalWindow(first.windowId);
					await settledSize(first.id);
				}
				let screenShort = false;
				let before = "";
				for (let attempt = 0; attempt < 3; attempt++) {
					const tab = await activeTab();
					if (tab?.id === undefined || !tab.width || !tab.height) return;
					const win = await chrome.windows.get(tab.windowId);
					if (
						win.state !== "normal" ||
						win.width === undefined ||
						win.height === undefined
					)
						break;
					const zoom = await chrome.tabs.getZoom(tab.id).catch(() => 1);
					const bigger = windowFor(
						want,
						{ width: tab.width, height: tab.height },
						{ width: win.width, height: win.height },
						zoom,
					);
					// The panel's screen is the window's.
					const room = screen as Screen & {
						availLeft?: number;
						availTop?: number;
					};
					const bounds = onScreen(
						bigger,
						{ left: win.left ?? 0, top: win.top ?? 0 },
						{
							left: room.availLeft ?? 0,
							top: room.availTop ?? 0,
							width: room.availWidth,
							height: room.availHeight,
						},
					);
					screenShort =
						bounds.width < bigger.width || bounds.height < bigger.height;
					await chrome.windows.update(tab.windowId, bounds);
					// Chrome sizes the tab a moment after the window.
					await settledSize(tab.id);
					const now = await activeTab();
					const size = now && (await tabSize(now));
					if (size && sameSize(size, want)) {
						await refreshTab();
						return hint(
							`This tab is now ${sizeText(size)}, as when the marks were made.`,
						);
					}
					// Another try would change nothing.
					const after = size ? sizeText(size) : "";
					if (screenShort || after === before) break;
					before = after;
				}
				await refreshTab();
				const size = state.tab?.size;
				hint(
					size === undefined
						? "Could not change the window's size."
						: screenShort
							? `The screen leaves room for ${sizeText(size)}; the marks were made at ${sizeText(want)}.`
							: `${BROWSER} would not make this tab ${sizeText(want)}; it is ${sizeText(size)}. The device toolbar in DevTools shows a page at any size.`,
				);
			} catch (error) {
				hint(`Could not change the window's size: ${message(error)}`);
			}
		})();
	},

	addMarks: (c) => {
		// The marks drawn now show, whatever the list was filtered by.
		update((s) => (s.markFilter = undefined));
		void (async () => {
			const tab = await activeTab();
			if (tab?.id === undefined) return;
			if (!(await startAnnotating(c, tab.id))) return;
			// Adding to a case shows its marks on the tab too (the owner): a Hide
			// there holds no longer, and a new mark is drawn like the others.
			if (hiddenOn.delete(tab.id)) update(() => undefined);
			void follow();
		})();
	},

	startRename: (c) =>
		update((s) => (s.renaming = { caseId: c.id, text: c.title })),

	typeRename(text) {
		update((s) => {
			if (s.renaming !== undefined)
				s.renaming = { caseId: s.renaming.caseId, text };
		});
	},

	saveRename: (c, text) => void renameCase(c.id, text),

	cancelRename: () => update((s) => (s.renaming = undefined)),

	startLink: (c) =>
		update((s) => (s.linking = { caseId: c.id, text: c.link ?? "" })),

	typeLink(text) {
		update((s) => {
			if (s.linking !== undefined)
				s.linking = { caseId: s.linking.caseId, text };
		});
	},

	saveLink: (c, text) => void linkCase(c.id, text),
	addComment: (caseId, text, markId) =>
		void changeThread(caseId, (c, now) =>
			withCaseComment(
				c,
				{ id: newId("k"), text, ...(markId ? { mark: markId } : {}) },
				now,
			),
		),
	editComment: (caseId, commentId, text) =>
		void changeThread(caseId, (c, now) =>
			withCaseCommentText(c, commentId, text, now),
		),
	deleteComment: (caseId, commentId) =>
		void changeThread(caseId, (c, now) =>
			withoutCaseComment(c, commentId, now),
		),
	setCaseClosed: (caseId, closed) =>
		void changeThread(caseId, (c, now) => withClosed(c, closed, now)),

	cancelLink: () => update((s) => (s.linking = undefined)),

	doneAdding(c) {
		const hint = caseHintWriter();
		void (async () => {
			const tab = await activeTab();
			if (tab?.id === undefined) return;
			tabWork.cancel();
			try {
				// As the toolbar's Done: a mark not in the case keeps it up.
				const overlay = await sendToTab<OverlayState>(tab.id, {
					type: "overlay:end",
					caseId: c.id,
				});
				update((s) => (s.overlay = overlay));
			} catch (error) {
				hint(describeError(error));
			}
		})();
	},

	exportCase(c) {
		// Chrome asks only during a click: nothing may be awaited before this.
		const allowed = askForDownloads();
		const of = { caseId: c.id };
		asking(of, allowed);
		const hint = caseHintWriter();
		update((s) => (s.exported = undefined));
		void (async () => {
			try {
				const zip = await exportCase(store, c);
				await saveExport(of, zip, exportFileName(c), allowed);
			} catch (error) {
				hint(`Could not export: ${message(error)}`);
			}
		})();
	},

	copyPath: (path) =>
		navigator.clipboard.writeText(path).then(
			() => true,
			() => false,
		),

	showFile(e) {
		try {
			chrome.downloads.show(e.downloadId);
		} catch (error) {
			const text = `Could not show the file: ${message(error)}`;
			if (e.of === "all") update((s) => (s.importError = text));
			else caseHintWriter()(text);
		}
	},

	deleteCase(c) {
		const armedAt = state.deleteArmedAt;
		if (armedAt === undefined) {
			const now = Date.now();
			update((s) => (s.deleteArmedAt = now));
			setTimeout(() => {
				update((s) => {
					if (s.deleteArmedAt === now) s.deleteArmedAt = undefined;
				});
			}, DELETE_ARMED_MS);
			return;
		}
		if (Date.now() - armedAt < DELETE_CLICK_GAP_MS) return;
		// The team's case, and not this user's to delete there (DEC-039).
		if (!caseSync(state.cloud, c.id).mayDelete) return;
		const hint = caseHintWriter();
		void (async () => {
			// The toolbar adding to it goes first, with the marks not in it yet.
			await endToolbars(c.id, { discard: true });
			// The store records the delete with it: the sync deletes a case
			// for the team only by that record, never because the case is
			// not there, and nothing here waits for the sync.
			await store.deleteCase(c.id);
			closeCase();
			void clearDeleted(c.id);
			announce(c.id);
		})().catch((error: unknown) => hint(`Could not delete: ${message(error)}`));
	},

	editMark(c, a, mode) {
		const status = markStatus(a);
		update((s) => {
			s.markDeleteArmed = undefined;
			s.markEdit = {
				annotationId: a.id,
				mark: markKey(c, a),
				mode,
				kind: status === "open" ? "fixed" : status,
				text:
					mode === "comment"
						? a.comment
						: mode === "resolve"
							? (a.resolution?.note ?? "")
							: "",
			};
		});
	},

	typeMark(change) {
		update((s) => {
			if (s.markEdit !== undefined) s.markEdit = { ...s.markEdit, ...change };
		});
	},

	cancelMarkEdit() {
		update((s) => (s.markEdit = undefined));
	},

	resolveMark(c, a, kind, note) {
		const now = new Date().toISOString();
		void changeMark(c, a, (current, id) => ({
			value: withChoice(current, id, kind, note, now),
		}));
	},

	verifyMark(c, a) {
		const now = new Date().toISOString();
		void changeMark(c, a, (current, id) => ({
			value: withVerified(current, id, undefined, now),
		}));
	},

	reopenMark(c, a, note) {
		// The developer reads it first: in the panel, a reopen says why.
		if (note.trim() === "") return;
		const now = new Date().toISOString();
		void changeMark(c, a, (current, id) => ({
			// Opened meanwhile: the form stays, and says why.
			value: withReopen(current, id, { note, refuseOpen: true }, now),
		}));
	},

	filterMarks(caseId, group) {
		update((s) => {
			const highest = Math.max(
				0,
				...(s.current?.annotations.map((a) => a.number) ?? []),
			);
			s.markFilter =
				group === undefined ? undefined : { caseId, group, upTo: highest };
		});
	},

	saveComment(c, a, text) {
		const now = new Date().toISOString();
		void changeMark(c, a, (current, id) => ({
			value: withComment(current, id, text, now),
		}));
	},

	deleteMark(c, a) {
		const armed = state.markDeleteArmed;
		if (armed?.annotationId !== a.id) {
			const at = Date.now();
			update((s) => {
				s.markEdit = undefined;
				s.markDeleteArmed = { annotationId: a.id, mark: markKey(c, a), at };
			});
			setTimeout(() => {
				update((s) => {
					if (s.markDeleteArmed?.at === at) s.markDeleteArmed = undefined;
				});
			}, DELETE_ARMED_MS);
			return;
		}
		// A double click is no second thought, nor a second delete.
		if (Date.now() - armed.at < DELETE_CLICK_GAP_MS) return;
		if (deleting.has(a.id)) return;
		deleting.add(a.id);
		const now = new Date().toISOString();
		void changeMark(c, a, (current, id) =>
			withoutAnnotation(current, id, now),
		).finally(() => deleting.delete(a.id));
	},

	deleteFinding(c, a, findingId) {
		const armed = state.findingDeleteArmed;
		if (armed?.annotationId !== a.id || armed.findingId !== findingId) {
			const at = Date.now();
			update(
				(s) =>
					(s.findingDeleteArmed = {
						annotationId: a.id,
						mark: markKey(c, a),
						findingId,
						at,
					}),
			);
			setTimeout(() => {
				update((s) => {
					if (s.findingDeleteArmed?.at === at) s.findingDeleteArmed = undefined;
				});
			}, DELETE_ARMED_MS);
			return;
		}
		// A double click is no second thought, nor a second delete.
		if (Date.now() - armed.at < DELETE_CLICK_GAP_MS) return;
		// A finding's id is unique on its mark only.
		const key = `${a.id} ${findingId}`;
		if (deleting.has(key)) return;
		deleting.add(key);
		const now = new Date().toISOString();
		void changeMark(
			c,
			a,
			(current, id) => ({ value: withoutFinding(current, id, findingId, now) }),
			// The mark's comment or resolve form, unsaved, stays open.
			{ keepEdit: true },
		).finally(() => {
			deleting.delete(key);
			update((s) => {
				const armed = s.findingDeleteArmed;
				if (armed?.annotationId === a.id && armed.findingId === findingId)
					s.findingDeleteArmed = undefined;
			});
		});
	},

	typeVerdict(caseId, text) {
		update((s) => {
			if (s.current?.id === caseId && text === (s.current.verdict ?? ""))
				s.verdictDrafts.delete(caseId);
			else s.verdictDrafts.set(caseId, text);
		});
	},

	saveVerdict(caseId, text) {
		const value = text.trim();
		void (async () => {
			try {
				const now = new Date().toISOString();
				// One transaction, so marks saved meanwhile are kept.
				const saved = await store.updateCase(caseId, (current) => {
					if (current === undefined)
						throw new Error("The case no longer exists.");
					return {
						value: validateCase({
							...current,
							verdict: value === "" ? null : value,
							updatedAt: now,
							// By hand: the server names the person (DEC-046).
							summaryBy: { at: now },
						}),
					};
				});
				update((s) => {
					s.verdictStatus = "Saved";
					// The stored text from now on, unless typing went on meanwhile.
					if (s.verdictDrafts.get(caseId) === text)
						s.verdictDrafts.delete(caseId);
					if (s.current?.id === caseId) s.current = saved;
				});
				announce(caseId);
				await refreshCase();
			} catch (error) {
				update((s) => (s.verdictStatus = `Not saved: ${message(error)}`));
			}
			setTimeout(() => update((s) => (s.verdictStatus = undefined)), 2500);
		})();
	},

	showMatch(caseId, a: Annotation, candidate) {
		const loaded = state.loaded;
		if (loaded === undefined || loaded.caseId !== caseId) return;
		const hint = caseHintWriter();
		void (async () => {
			try {
				const m = (await chrome.tabs.sendMessage(loaded.tabId, {
					type: "case:show",
					caseId,
					annotationId: a.id,
					candidate,
				})) as AnnotationMatch | { error: string } | null;
				if (m === null) {
					await forgetLoaded({
						hint: "The case is no longer loaded on that tab. Load it again to see its marks there.",
					});
					return;
				}
				if ("error" in m) return hint(m.error);
				update((s) => s.loaded?.matches.set(a.id, m));
			} catch (error) {
				hint(describeError(error));
			}
		})();
	},

	importReplace() {
		const importing = state.importing;
		if (importing === undefined || state.importWork !== undefined) return;
		void importWork(
			importing.batch?.name ?? importing.parsed.case.title,
			async () => {
				try {
					const now = await store.getCase(importing.parsed.case.id);
					if (state.importing !== importing) return;
					// It changed under the prompt: ask again, with the new date.
					if (
						now !== undefined &&
						now.updatedAt !== importing.existing.updatedAt
					)
						update((s) => (s.importing = { ...importing, existing: now }));
					else await finishImport(importing.parsed, false, importing.batch);
				} catch (error) {
					update(
						(s) => (s.importError = `Could not import: ${message(error)}`),
					);
				}
			},
		);
	},
	importCopy() {
		const importing = state.importing;
		if (importing === undefined || state.importWork !== undefined) return;
		void importWork(importing.batch?.name ?? importing.parsed.case.title, () =>
			finishImport(importing.parsed, true, importing.batch),
		);
	},
	importCancel() {
		if (state.importWork !== undefined) return;
		const batch = state.importing?.batch;
		update((s) => (s.importing = undefined));
		// In a file of several: this one stays as it is, the next one follows.
		if (batch !== undefined) {
			batch.skipped++;
			void importWork(batch.name, () => importRest(batch));
		}
	},

	...syncActions(() => panelSync),
	...cloudActions(() => panelCloud),
};

/** The sync to Downloads or a folder (DEC-021, DEC-025): the worker writes, the panel chooses. */
const panelSync = startSync(update);

/** The account at sitegloss.dev and the sync with a team (DEC-039): the worker syncs, the panel asks. */
const panelCloud = startCloud(update);
// Shown or focused: a team joined on the web app meanwhile shows here
// without Sync now (DEC-045).
window.addEventListener("focus", () => panelCloud.shown());
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible") panelCloud.shown();
});

// --- settings and import -------------------------------------------------------------

// "Blur form fields in screenshots" is the worker's (DEC-016): `ai.ts` shows
// it and sends a change over the panel's port.

async function refreshAllSites(): Promise<void> {
	const work = sitesWork.start();
	const granted = await chrome.permissions.contains(ALL_SITES);
	if (work.current()) update((s) => (s.allSites = granted));
}

allSites.addEventListener("change", () => {
	// Chrome asks only during a click: nothing may be awaited before this.
	const change = allSites.checked
		? requestPermissions(ALL_SITES)
		: chrome.permissions.remove(ALL_SITES);
	void change
		.catch((error: unknown) =>
			update(
				(s) => (s.hint = `Could not change the access: ${message(error)}`),
			),
		)
		.then(refreshAllSites);
});
chrome.permissions.onAdded.addListener(() => {
	void refreshAllSites();
	void refreshDownloads();
	void refreshTab();
	// Sitegloss may run on the tab in front now: the open case's marks go there.
	void follow();
});
chrome.permissions.onRemoved.addListener(() => {
	void refreshAllSites();
	void refreshDownloads();
	void refreshTab();
});

byId<HTMLButtonElement>("annotate").addEventListener("click", () =>
	actions.annotate(),
);

exportAllButton.addEventListener("click", () => {
	// Off while an import is at work (view.ts); it reads the cases it stores.
	if (importBusy()) return;
	// Chrome asks only during a click: nothing may be awaited before this.
	const allowed = askForDownloads();
	asking("all", allowed);
	update((s) => {
		s.exported = undefined;
		s.importError = undefined;
		s.importDone = undefined;
		s.exportingAll = true;
	});
	void (async () => {
		try {
			// The bytes go into a Blob at once, and are not kept beside it.
			const file = new Blob(
				[
					(await exportAllCases(
						store,
						await store.listCases(),
					)) as Uint8Array<ArrayBuffer>,
				],
				{ type: "application/zip" },
			);
			await saveExport("all", file, exportAllFileName(), allowed);
		} catch (error) {
			update(
				(s) =>
					(s.importError = `Could not export all cases: ${message(error)}`),
			);
		} finally {
			update((s) => (s.exportingAll = false));
		}
	})();
});

importButton.addEventListener("click", () => {
	if (!importBusy()) importFile.click();
});
importFile.addEventListener("change", () => {
	const file = importFile.files?.[0];
	importFile.value = "";
	if (file === undefined) return;
	// One import at a time: its question is answered before another file is read.
	if (importBusy()) return;
	update((s) => {
		s.importError = undefined;
		s.importDone = undefined;
	});
	void importWork(file.name, () => importOne(file));
});

/** Read a chosen file, and store its cases (or ask about the first one here already). */
async function importOne(file: File): Promise<void> {
	try {
		if (file.size > MAX_IMPORT_ALL_BYTES)
			throw new Error(
				`it is larger than ${MAX_IMPORT_ALL_BYTES / 1024 / 1024} MB`,
			);
		const cases = await readExports(new Uint8Array(await file.arrayBuffer()));
		const [parsed] = cases;
		if (cases.length > 1 || parsed === undefined)
			return await importRest({
				name: file.name,
				rest: cases,
				total: cases.length,
				stored: 0,
				skipped: 0,
			});
		const existing = await store.getCase(parsed.case.id);
		// Ask only when it would replace a case that is here already.
		if (existing === undefined) await finishImport(parsed, false);
		else update((s) => (s.importing = { parsed, existing }));
	} catch (error) {
		update(
			(s) =>
				(s.importError = `Could not import ${file.name}: ${message(error)}`),
		);
	}
}
byId<HTMLButtonElement>("import-dismiss").addEventListener("click", () =>
	update((s) => (s.importError = undefined)),
);

// --- AI app ------------------------------------------------------------------

/** A tool, or another panel, changed or deleted a case: show it. */
function caseChanged(caseId: string): void {
	// Its title, as the panel knew it, in case it is gone. Kept: the panel is
	// on Home before the read below is back, and a toolbar adding to the case
	// is then ended by `adopt`, which has no case to read a title from.
	const title =
		(state.current?.id === caseId
			? state.current.title
			: state.cases.find((c) => c.id === caseId)?.title) ??
		lastTitles.get(caseId);
	if (title !== undefined) lastTitles.set(caseId, title);
	if (state.view.kind === "case" && state.view.id === caseId)
		void refreshCase();
	void refreshCases();
	void store
		.getCase(caseId)
		.then((c) =>
			c === undefined
				? clearDeleted(caseId, title)
				: // A mark settled or deleted elsewhere (an AI app, another window).
					redrawLoaded(c),
		)
		.finally(() => lastTitles.delete(caseId));
}

/**
 * The titles of cases that just changed, until it is known whether they are
 * gone: what a deleted case was called, for the sentence about its loss.
 */
const lastTitles = new Map<string, string>();

/**
 * The case changed while its marks are on a page: they follow, and the
 * candidates chosen there stay.
 */
async function redrawLoaded(c: Case): Promise<void> {
	const tabs = new Set<number>();
	if (state.loaded?.caseId === c.id) tabs.add(state.loaded.tabId);
	if (state.overlay?.loadedCase === c.id && state.tab !== undefined)
		tabs.add(state.tab.id);
	for (const tabId of tabs) {
		const result = (await chrome.tabs
			.sendMessage(tabId, { type: "case:update", case: c })
			.catch(() => null)) as LoadResult | null;
		if (result === null) continue;
		update((s) => {
			if (s.loaded?.caseId === c.id && s.loaded.tabId === tabId)
				s.loaded = {
					...s.loaded,
					matches: new Map(result.matches.map((m) => [m.annotationId, m])),
					url: result.url,
				};
		});
	}
}

/**
 * Marks (their id) and findings (mark id, space, finding id) being deleted
 * now: a second click waits for the first.
 */
const deleting = new Set<string>();

/**
 * Change a mark of a case in one transaction, then show and draw the result.
 * The mark's form closes, unless `keepEdit`: a change the form is not about.
 */
/** Answers why it was not saved, if it was not (the hint says so too). */
async function changeMark(
	c: Case,
	a: Annotation,
	/** `id`: the mark's id in the case as it is stored now. */
	change: (current: Case, id: string) => { value: Case; images?: string[] },
	{ keepEdit = false } = {},
): Promise<string | undefined> {
	const hint = caseHintWriter();
	const caseId = c.id;
	let annotationId = a.id;
	// Which mark it is about, whatever its id is by now: the team's sync can
	// give a mark another number while its form is open, and the id it had
	// is then a teammate's mark (DEC-039).
	const key = markKey(c, a);
	try {
		// The images go in the same transaction: a save may take a freed path.
		const saved = await store.updateCase(caseId, (current) => {
			if (current === undefined) throw new Error("The case no longer exists.");
			const now = markFor(current, a.id, key);
			if (now === undefined)
				throw new Error(
					"This mark is no longer in the case as it was: it was changed or removed meanwhile. Nothing was saved.",
				);
			// Not to be told from another mark: not applied to the first found.
			if (now === "ambiguous") throw new Error(MARK_CHANGED);
			annotationId = now.id;
			const next = change(current, now.id);
			return {
				value: validateCase(next.value),
				deleteImages: next.images ?? [],
			};
		});
		update((s) => {
			// Another mark's form, opened meanwhile, stays.
			if (!keepEdit && s.markEdit?.annotationId === annotationId)
				s.markEdit = undefined;
			if (s.markDeleteArmed?.annotationId === annotationId)
				s.markDeleteArmed = undefined;
			if (s.current?.id === caseId) s.current = saved;
		});
		announce(caseId);
		await refreshCase();
		await redrawLoaded(saved);
		return undefined;
	} catch (error) {
		const why = `Not saved: ${message(error)}`;
		hint(why);
		return why;
	}
}

/**
 * A page asks about a mark of the case drawn on it (DEC-027). Answered only
 * by the panel that has the case open, for the tab it drew it on or the tab
 * in front that shows it (`markAsked`): a page reaches no other case. What it asks
 * is done as the panel's own buttons do it. `false`: not this panel's.
 */
function answerMark(
	request: MarkRequest,
	tabId: number | undefined,
	answer: (result: MarkAnswer) => void,
): boolean {
	const c = state.view.kind === "case" ? state.current : undefined;
	const a = markAsked(
		{
			open: c,
			loaded: state.loaded,
			front:
				state.tab === undefined
					? undefined
					: { tabId: state.tab.id, loadedCase: state.overlay?.loadedCase },
		},
		request,
		tabId,
	);
	if (c === undefined || a === undefined) return false;
	if (a === "gone") {
		answer({ ok: false, error: "That mark is no longer in the case." });
		return false;
	}
	if (a === "changed") {
		answer({ ok: false, error: MARK_CHANGED });
		return false;
	}
	const done = (why: string | undefined) =>
		answer(why === undefined ? { ok: true } : { ok: false, error: why });
	const now = new Date().toISOString();
	switch (request.type) {
		case "mark:picked":
			update((s) => {
				// Its row shows, whatever the list was filtered by.
				s.markFilter = undefined;
				s.picked = { caseId: c.id, annotationId: a.id, at: Date.now() };
			});
			answer({ ok: true });
			return false;
		case "mark:comment":
			if (request.text.length > MAX_COMMENT) {
				answer({ ok: false, error: "That comment is too long." });
				return false;
			}
			void changeMark(c, a, (current, id) => ({
				value: withComment(current, id, request.text, now),
			})).then(done);
			return true;
		case "mark:resolve":
			void changeMark(c, a, (current, id) => ({
				value: withChoice(current, id, request.kind, request.note, now),
			})).then(done);
			return true;
		case "mark:verify":
			void changeMark(c, a, (current, id) => ({
				value: withVerified(current, id, undefined, now),
			})).then(done);
			return true;
		case "mark:reopen":
			// The developer reads it first: a reopen says why, here as in the panel.
			if (request.note.trim() === "") {
				answer({ ok: false, error: "Say what is still wrong." });
				return false;
			}
			void changeMark(c, a, (current, id) => ({
				// Opened meanwhile: the form stays, and says why.
				value: withReopen(
					current,
					id,
					{ note: request.note, refuseOpen: true },
					now,
				),
			})).then(done);
			return true;
		case "mark:delete":
			if (deleting.has(a.id)) {
				answer({ ok: false, error: "That mark is being deleted." });
				return false;
			}
			deleting.add(a.id);
			void changeMark(c, a, (current, id) =>
				withoutAnnotation(current, id, now),
			)
				.then(done)
				.finally(() => deleting.delete(a.id));
			return true;
	}
}

// The top bar's AI pill opens the Settings view, where the AI app card is;
// an open case stays open underneath (DEC-023).
void startAi(update, () => {
	update((s) => (s.settings = true));
	window.scrollTo(0, 0);
});

// --- news from the pages and the browser -----------------------------------------

chrome.runtime.onMessage.addListener(
	(news: Broadcast | MarkRequest, sender, sendResponse) => {
		if (sender.id !== chrome.runtime.id) return false;
		// From a page's content script only: an extension page has no tab.
		if (isMarkRequest(news))
			return answerMark(news, sender.tab?.id, sendResponse);
		// From the background only (an AI app's open_case): not a page's
		// content script, not another extension page (DEC-050).
		if (isOpenCaseRequest(news))
			return fromBackground(sender) && openForAi(news, sendResponse);
		return hear(news, sender);
	},
);

/**
 * An AI app's `open_case` (DEC-050), which the user allowed: the panel of
 * that window opens the case exactly as a person's clicks would: "← All
 * cases" on the case it shows (`leaveCase`: its toolbars end, an untouched
 * new case goes, DEC-026), then a click on the case, whose marks follow the
 * tab in front (DEC-022). Never at the cost of anything typed or a decision
 * a person has to make (`aiOpenRefusal`): then it says why and stays.
 * Answers once the draw on that tab has found the marks. Another window's
 * panel says nothing.
 */
function openForAi(
	request: OpenCaseRequest,
	sendResponse: (answer: OpenCaseAnswer) => void,
): boolean {
	if (panelWindowId === undefined || request.windowId !== panelWindowId)
		return false;
	void (async () => {
		const { caseId, tabId } = request;
		const c = await store.getCase(caseId);
		if (c === undefined) {
			sendResponse({ opened: false, reason: "no-panel" });
			return;
		}
		const refused = aiOpenRefusal(state, caseId, tabId, await askTabsById());
		if (refused !== undefined) {
			const title = (await store.getCase(refused.caseId))?.title;
			sendResponse({
				opened: false,
				reason: refused.reason,
				...(title === undefined ? {} : { title }),
				...(refused.reason === "busy" ? { why: refused.why } : {}),
			});
			return;
		}
		const before = state.view.kind === "case" ? state.view.id : undefined;
		if (before !== undefined && before !== caseId) {
			await leaveCase();
			// Something came up while leaving (a mark not in the case yet):
			// the person decides, not the AI app.
			if (state.view.kind !== "home") {
				sendResponse({
					opened: false,
					reason: "busy",
					...(state.current ? { title: state.current.title } : {}),
					why: "closing it needs the user's decision",
				});
				return;
			}
		}
		// Asked for by name: a Hide on that tab holds no longer.
		if (hiddenOn.has(tabId)) update(() => hiddenOn.delete(tabId));
		if (showing(caseId)) void follow();
		else openCase(caseId);
		sendResponse({
			opened: true,
			...((await drawnFor(caseId, tabId)) ?? {}),
		});
	})();
	return true;
}

/** How long `open_case` waits for the panel's draw of the case to find its marks. */
const AI_DRAW_WAIT_MS = 20_000;

/** What the panel's draw of the case on the tab found, once it has; none in time. */
async function drawnFor(
	caseId: string,
	tabId: number,
): Promise<{ result: LoadResult } | undefined> {
	const end = Date.now() + AI_DRAW_WAIT_MS;
	while (Date.now() < end) {
		const loaded = state.loaded;
		if (loaded?.caseId === caseId && loaded.tabId === tabId)
			return {
				result: {
					caseId,
					url: loaded.url,
					matches: [...loaded.matches.values()],
				},
			};
		if (!showing(caseId)) return undefined;
		await sleep(100);
	}
	return undefined;
}

/** News from the pages and the worker: nothing is answered. */
function hear(news: Broadcast, sender: chrome.runtime.MessageSender): false {
	if (news?.type === "overlay:changed") {
		const from = sender.tab?.id;
		// Sitegloss runs on the tab the open case waits for: the icon was clicked.
		if (newsLetsIn(from, pendingLoad?.tabId, state.tab)) {
			pendingLoad = undefined;
			void follow();
		}
		// The page's own Hide (on its bar) took the panel's marks off: it
		// holds as the panel's Hide does.
		if (
			from !== undefined &&
			from === drawn?.tabId &&
			news.state.loadedCase === undefined &&
			loadsUnderWay === 0 &&
			// Its results: a page loaded again (no results then) starts empty.
			state.loaded?.tabId === from &&
			state.loaded.caseId === drawn.caseId
		) {
			hiddenOn.add(from);
			drawn = undefined;
			// The searches again must not draw them back.
			if (loadTarget?.tabId === from) stopLoads();
		}
		// The page's own Hide removed the loaded case's marks.
		if (
			state.loaded !== undefined &&
			from === state.loaded.tabId &&
			news.state.loadedCase !== state.loaded.caseId
		)
			void forgetLoaded();
		// Only the tab the panel shows matters.
		if (from !== undefined && from === state.tab?.id) {
			update((s) => {
				s.overlay = news.state;
				unblock(s);
			});
			// A toolbar adding to a case: the panel opens it (DEC-023).
			void adopt();
			// A refresh may have read the page before this news, or be finding
			// out that another tab is in front now: it starts over. A tab whose
			// address Chrome hid lets Sitegloss in now: the icon was clicked.
			if (refreshing > 0 || state.tab.url === "") void refreshTab();
		}
	} else if (news?.type === "cases:changed") {
		caseChanged(news.caseId);
		void refreshTab();
	} else if (news?.type === "sync:changed") void panelSync.refresh();
	else if (news?.type === "cloud:changed") void panelCloud.refresh();
	return false;
}

/** The window this panel is in. */
let panelWindowId: number | undefined;
void panelWindow().then((id) => (panelWindowId = id));
chrome.tabs.onActivated.addListener(({ windowId }) => {
	void refreshTab();
	// The open case's marks follow it to the tab in front of this window.
	if (panelWindowId === undefined || windowId === panelWindowId) void follow();
});
// The tab's size: the window's, the panel's own width, or the zoom changed.
let resized: ReturnType<typeof setTimeout> | undefined;
const sizeChanged = () => {
	clearTimeout(resized);
	resized = setTimeout(() => void refreshSize(), 150);
};
// Firefox has no `windows.onBoundsChanged`: the sidebar's own resize, below,
// tells of a change in the window's height, and a look every few seconds
// while the panel shows catches one in its width.
if (FIREFOX)
	setInterval(() => {
		if (document.visibilityState === "visible") void refreshSize(true);
	}, 3000);
else
	chrome.windows.onBoundsChanged.addListener((w) => {
		if (w.id === panelWindowId) sizeChanged();
	});
chrome.tabs.onZoomChange.addListener(({ tabId }) => {
	if (tabId === state.tab?.id) sizeChanged();
});
window.addEventListener("resize", sizeChanged);
chrome.tabs.onUpdated.addListener((id, info) => {
	if (id === state.loaded?.tabId && info.status === "loading")
		void forgetLoaded();
	// A new page: a draw under way was for the old one.
	if (id === drawing?.tabId && info.status === "loading") setDrawing(undefined);
	if (info.status === "complete" || info.url !== undefined) {
		void refreshTab();
		// Loaded, reloaded or navigated: the open case's marks are drawn there
		// again when it is the tab in front and the page no longer shows them;
		// a new address within the page (a hash, pushState) keeps them (DEC-022).
		void follow();
	}
});
chrome.tabs.onRemoved.addListener((id) => {
	if (id === state.loaded?.tabId) void forgetLoaded();
	if (id === pendingLoad?.tabId) pendingLoad = undefined;
	if (id === drawn?.tabId) drawn = undefined;
	hiddenOn.delete(id);
	// The open case's toolbar went with its tab: an untouched case goes (DEC-026).
	if (toolbarOn.delete(id) && state.view.kind === "case")
		void leaveIfUntouched(state.view.id);
});

void refreshTab();
void refreshAllSites();
void refreshDownloads();
// Turning "Allow access to file URLs" on or off reloads Sitegloss: once is
// enough. Firefox's "Access local files on your computer" reloads nothing:
// it is read again with each look at the tab (`refreshTab`).
if (!FIREFOX)
	void chrome.extension.isAllowedFileSchemeAccess().then(
		(allowed) => update((s) => (s.fileAccess = allowed)),
		() => undefined,
	);
