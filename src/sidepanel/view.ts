/**
 * Drawing the side panel from its state (DEC-011). `render` is the only code
 * that touches the panel's DOM. The open case's summary and buttons stay the
 * same elements while it is open, so typing, focus and clicks survive every
 * render; the other parts are redrawn when what they show changed.
 */

import {
	BROWSER,
	CANNOT_RUN_FILES_TEXT,
	FIREFOX,
	PANEL,
} from "../lib/browser.ts";
import {
	appLabel,
	assigneeOf,
	byline,
	type Case,
	type CasePage,
	caseCounts,
	casePages,
	cleanTitle,
	cutText,
	type FindingApp,
	GROUP_LABEL,
	GROUP_OF,
	MAX_COMMENT,
	MAX_MARK_IMAGES,
	MAX_REOPEN_NOTE,
	MAX_TITLE,
	MAX_VERDICT,
	type Mark,
	type MarkStatus,
	markStatus,
	marksByPage,
	markUrl,
	onPageInFront,
	pageInFront,
	pageKey,
	RESOLUTION_LABEL,
	RESOLVE_CHOICES,
	type Resolution,
	type ResolveChoice,
	STATUS_GROUPS,
	type StatusGroup,
	textLength,
	type UserRef,
	viewportAt,
} from "../lib/case.ts";
import { reporterHere } from "../lib/case-state.ts";
import { summarize } from "../lib/element.ts";
import type { CandidateInfo, MarkMatch } from "../lib/messages.ts";
import { caseSites, siteOf } from "../lib/site.ts";
import {
	ALLOW_ALL_SITES,
	ALLOW_ALL_SITES_RECOMMENDED,
	accessPlan,
	type BrowserKind,
	browserLabel,
	cannotRunText,
	NO_ACCESS_CASE,
	NO_ACCESS_HOME,
	offerText,
	oneTabWay,
	optionNote,
	shortcutText,
	type TabAccess,
	tabAccess,
	verifyHereWay,
	type Words,
} from "./access.ts";
import { renderAccount } from "./account-menu.ts";
import { pageCases } from "./closed.ts";
import {
	type CloudActions,
	caseSync,
	HAND_OVER_NOTE,
	hostOf,
	renderCloudBanner,
	renderCloudSection,
	teamOf,
} from "./cloud-view.ts";
import { byId, formatDate, h, isWebPage, shortPath, shortUrl } from "./dom.ts";
import { findsOn, foundLine, noneHere } from "./follow.ts";
import {
	type IconName,
	icon,
	setCopyLabel,
	setLabel,
	withIcon,
} from "./icons.ts";
import {
	markTargets,
	mayLoadAndShow,
	shortAddress,
	verifiesHere,
} from "./mark-link.ts";
import {
	type CardHandOver,
	cardHandOver,
	mineTest,
	NO_OTHER_MINE,
	NONE_MINE,
	teamAssigns,
	waitsText,
	waitsToVerify,
} from "./my-cases.ts";
import {
	mayCopyMark,
	nextStep,
	type StepAction,
	whereIs,
} from "./next-step.ts";
import {
	nextStepParts,
	renderNextStep,
	type StepParts,
} from "./next-step-view.ts";
import { type PageChoice, type PageFilter, pageFilter } from "./page-filter.ts";
import { openAt, pageHosts } from "./page-hosts.ts";
import { holdClickedInPlace } from "./scroll-anchor.ts";
import {
	openAtFirst,
	type SiteGroup,
	siteGroups,
	whereText,
} from "./site-groups.ts";
import { type Size, sameSize } from "./size.ts";
import type { AiCall, AiProblem, Exported, PanelState } from "./state.ts";
import {
	renderSyncBanner,
	renderSyncSection,
	type SyncActions,
} from "./sync-view.ts";
import {
	commentCount,
	markThreadView,
	onThreadChange,
	renderThread,
	type ThreadActions,
	type ThreadContext,
	threadStateKey,
} from "./thread-view.ts";

/** What the user can do; main.ts carries it out and updates the state. */
export interface Actions extends SyncActions, CloudActions, ThreadActions {
	/** Close the case (filed away, not frozen) or open it again (DEC-046). */
	setCaseClosed(caseId: string, closed: boolean): void;
	/** The next step's "Copy link": the case's address in the web app (DEC-069). */
	copyCaseLink(c: Case): void;
	/** The next step's "Copy for your AI app": the instructions for the case. */
	copyForAiApp(c: Case): void;
	/** A mark's "Copy for your AI app": the instructions for that one mark. */
	copyMarkForAiApp(c: Case, a: Mark): void;
	/** The next step's "Start verifying": the marks to verify, the first one open. */
	startVerifying(c: Case): void;
	/** "This page"'s Start verifying (DEC-079): the case opens, then Start verifying. */
	verifyCase(id: string): void;
	/** The next step's Assign menu: the case to a member, or to nobody (DEC-071). */
	assignCase(caseId: string, to: UserRef | null): void;
	/** "My cases" in the list of cases, on or off (DEC-071). */
	showMine(on: boolean): void;
	/** "New case for this page": a new case, stored at once and opened (DEC-026). */
	startNewCase(): void;
	openCase(id: string): void;
	/** "← All cases": end the toolbar adding to the case, then close it (DEC-023). */
	closeCase(): void;
	/** "← Back" from Settings, to the view underneath. */
	closeSettings(): void;
	loadOntoTab(c: Case): void;
	hideFromTab(c: Case): void;
	/** Open a mark's form: settle it, edit its comment, or reopen it. */
	editMark(c: Case, a: Mark, mode: "resolve" | "comment" | "reopen"): void;
	typeMark(change: { kind?: ResolveChoice; text?: string }): void;
	cancelMarkEdit(): void;
	resolveMark(c: Case, a: Mark, kind: ResolveChoice, note: string): void;
	/**
	 * "Verify" on a fixed mark: the fix holds (DEC-023). May answer why it was
	 * not saved, so that the row can come back as it was.
	 */
	verifyMark(c: Case, a: Mark): void | Promise<string | undefined>;
	/** "Reopen" in its form: the note says what is still wrong. */
	reopenMark(c: Case, a: Mark, note: string): void;
	/** A status chip: show only those marks; `undefined`: all of them. */
	filterMarks(caseId: string, group: StatusGroup | undefined): void;
	/** The page filter: this page, one page of the case; `undefined`: all pages. */
	filterPage(caseId: string, choice: PageChoice | undefined): void;
	saveComment(c: Case, a: Mark, text: string): void;
	deleteMark(c: Case, a: Mark): void;
	/** "Add another image…": the dialog for the mark's added images (DEC-058). */
	addImages(c: Case, a: Mark): void;
	/** An added image's Remove: the first click asks, the second removes. */
	deleteImage(c: Case, a: Mark, imageId: string): void;
	/** Open one of the case's pages in a new tab (DEC-038); none named: the first. */
	openPage(c: Case, url?: string): void;
	/** A mark's picture in the viewer, a tab of the extension's own (DEC-060). */
	openPicture(c: Case, a: Mark, pictureId: string): void;
	/**
	 * A mark's link (DEC-050): open where it was made (`made`), or the same
	 * path and query on the host in front (`here`), in the tab in front, and
	 * show the mark there once the page has its marks.
	 */
	openMarkPage(c: Case, a: Mark, where: "made" | "here"): void;
	/** Chrome's prompt for "Allow on all sites"; call it in the click. */
	allowAllSites(): void;
	/** "Not now" on the offer of all sites: it does not come again (DEC-076). */
	declineAllSites(): void;
	/** Sitegloss's page in chrome://extensions ("Allow access to file URLs"). */
	openDetails(): void;
	matchSize(c: Case): void;
	addMarks(c: Case): void;
	/** "Done adding": the toolbar adding to the case finishes, as its Done. */
	doneAdding(c: Case): void;
	/** "Rename": the title becomes a field (DEC-026). */
	startRename(c: Case): void;
	typeRename(text: string): void;
	/** Enter or Save: stored at once; an empty title is refused. */
	saveRename(c: Case, text: string): void;
	/** Escape or Cancel. */
	cancelRename(): void;
	/** "Add a link" or "Edit": the case's link becomes a field (DEC-028). */
	startLink(c: Case): void;
	typeLink(text: string): void;
	/** Enter or Save: stored at once; an empty field removes the link. */
	saveLink(c: Case, text: string): void;
	/** Escape or Cancel. */
	cancelLink(): void;
	exportCase(c: Case): void;
	/** Copy an exported file's path; whether it worked. */
	copyPath(path: string): Promise<boolean>;
	/** Show an exported file in the system's file manager. */
	showFile(e: Exported): void;
	deleteCase(c: Case): void;
	typeVerdict(caseId: string, text: string): void;
	saveVerdict(caseId: string, text: string): void;
	showMatch(caseId: string, a: Mark, candidate: number): void;
	/**
	 * A mark's Show while the case's marks are not drawn on the tab in front:
	 * what "Show marks" does, and then this mark is shown, in one press.
	 */
	loadAndShow(c: Case, a: Mark): void;
	importReplace(): void;
	importCopy(): void;
	importCancel(): void;
}

const bar = byId<HTMLElement>("bar");
const back = byId<HTMLButtonElement>("back");
const home = byId<HTMLElement>("home");
const caseView = byId<HTMLElement>("case-view");
// What a click acts on stays where it was on screen (DEC-060).
const releaseHeld = holdClickedInPlace(caseView);
const settingsView = byId<HTMLElement>("settings");
const pageText = byId<HTMLParagraphElement>("page");
const hint = byId<HTMLParagraphElement>("hint");
const newCaseButton = byId<HTMLButtonElement>("new-case");
/** Its title in index.html, for when Sitegloss may run on the tab. */
const newCaseTitle = newCaseButton.title;
const casesList = byId<HTMLDivElement>("cases");
const casesHeading = byId<HTMLHeadingElement>("cases-heading");
/** The cases of the page in front, under "This page", with the offer to open one. */
const here = byId<HTMLDivElement>("here");
const hereText = byId<HTMLParagraphElement>("here-text");
const hereCases = byId<HTMLDivElement>("here-cases");
const hereClosed = byId<HTMLDivElement>("here-closed");
const openHere = byId<HTMLButtonElement>("open-here");
const allSites = byId<HTMLInputElement>("all-sites");
const aiStatus = byId<HTMLSpanElement>("ai-status");
const aiLabel = byId<HTMLSpanElement>("ai-label");
const backLabel = byId<HTMLSpanElement>("back-label");
const copyId = byId<HTMLButtonElement>("copy-case-id");
const copyIdSaid = byId<HTMLElement>("copy-case-said");

const copyIdFailed = byId<HTMLDivElement>("copy-case-failed");
const copyIdShown = byId<HTMLElement>("copy-case-shown");

/** How long the copy button says that it copied. */
const COPIED_ID_MS = 1600;
let copiedIdUntil: ReturnType<typeof setTimeout> | undefined;

/** The copy button as before a press: no tick, no refusal, nothing said. */
function forgetCopiedId(): void {
	clearTimeout(copiedIdUntil);
	copyId.removeAttribute("data-copied");
	copyIdSaid.textContent = "";
	copyIdFailed.hidden = true;
}

/**
 * The open case's id on the clipboard, from the bar (the owner: to tell an
 * AI app "check Sitegloss case …"). Its id alone: a title can be anything.
 * A refusal shows the id under the bar, selected, to copy by hand; that
 * stays until the next press or another case.
 */
function renderCopyId(id: string | undefined): void {
	copyId.hidden = id === undefined;
	if (copyId.dataset["copies"] === (id ?? "")) return;
	copyId.dataset["copies"] = id ?? "";
	// What was said was said of the case before.
	forgetCopiedId();
	if (id === undefined) return;
	const name = "Copy this case's id";
	copyId.setAttribute("aria-label", name);
	copyId.title = `${name}, to name the case to your AI app: ${id}`;
	copyId.onclick = () => {
		const say = (ok: boolean) => {
			// Another case since the press: its answer is not this one's.
			if (copyId.dataset["copies"] !== id) return;
			forgetCopiedId();
			// Asked a moment later, so that the same words are said again.
			queueMicrotask(() => {
				copyIdSaid.textContent = ok
					? "Case id copied"
					: `Copying did not work. The case's id is ${id}`;
			});
			if (!ok) {
				copyIdShown.textContent = id;
				copyIdFailed.hidden = false;
				document.getSelection()?.selectAllChildren(copyIdShown);
				return;
			}
			copyId.setAttribute("data-copied", "");
			copiedIdUntil = setTimeout(forgetCopiedId, COPIED_ID_MS);
		};
		const clipboard = globalThis.navigator?.clipboard;
		if (clipboard === undefined) return say(false);
		clipboard.writeText(id).then(
			() => say(true),
			() => say(false),
		);
	};
}
const aiButton = byId<HTMLButtonElement>("ai-button");
const aiAction = byId<HTMLSpanElement>("ai-action");
const aiCall = byId<HTMLParagraphElement>("ai-call");
const aiProblem = byId<HTMLDivElement>("ai-problem");
const aiProblemText = byId<HTMLParagraphElement>("ai-problem-text");
const keepOn = byId<HTMLInputElement>("keep-on");
const importError = byId<HTMLDivElement>("import-error");
const importDone = byId<HTMLParagraphElement>("import-done");
const exportAll = byId<HTMLButtonElement>("export-all");
const importButton = byId<HTMLButtonElement>("import");
// The main view's buttons in index.html, each with its icon (DEC-078).
newCaseButton.prepend(icon("add"));
importButton.prepend(icon("import"));
exportAll.prepend(icon("export"));
/** Their titles in index.html, for when no import is at work. */
const importTitle = importButton.title;
const exportAllTitle = exportAll.title;
const exportAllSaved = byId<HTMLDivElement>("export-all-saved");
const importErrorText = byId<HTMLParagraphElement>("import-error-text");
const importPrompt = h("div", {
	class: "hint",
	id: "import-prompt",
	hidden: true,
});
importButton.parentElement?.after(importPrompt);

/** The titles of Import a case… and Export all cases while an import is at work. */
export const IMPORT_BUSY =
	"An import is at work: wait for it, or answer its question below, before choosing another file.";
export const EXPORT_ALL_BUSY =
	"An import is at work: wait for it, or answer its question below, before exporting all cases.";

/** Where Sitegloss may not read files: that is the toggle for them. */
export const CANNOT_RUN_FILES = CANNOT_RUN_FILES_TEXT;

/** The browser's name, as its brands say (display only; DEC-076). */
const BROWSER_LABEL = browserLabel(
	FIREFOX,
	(navigator as { userAgentData?: { brands?: { brand: string }[] } })
		.userAgentData?.brands,
);

/**
 * Whose restricted hosts apply: Firefox by the build; Edge, whose add-ons
 * site only Edge restricts, by its brands (the one choice a brand makes,
 * DEC-076: an ordinary site taken for an impossible one would be worse).
 */
const BROWSER_KIND: BrowserKind = FIREFOX
	? "firefox"
	: BROWSER_LABEL === "Edge"
		? "edge"
		: "chrome";

/** How the access texts name the browser and its shortcut now (DEC-076). */
export function wordsOf(state: PanelState): Words {
	return {
		firefox: FIREFOX,
		browser: BROWSER_LABEL,
		shortcut: shortcutText(state.shortcut, navigator),
	};
}

/** Whether Sitegloss may run on the tab in front (`access.ts`). */
export function access(state: PanelState): TabAccess {
	return tabAccess(state.tab, state.allSites, BROWSER_KIND);
}

/** What the panel shows about access now (DEC-076). */
const planOf = (state: PanelState) =>
	accessPlan({
		tab: access(state),
		allSites: state.allSites,
		declined: state.allSitesDeclined,
		known: state.allSitesKnown,
	});

/**
 * The one quiet line where the marks start (DEC-063), or nothing. A case of
 * many pages has marks on some only, so a page without any is normal: the
 * pages list and the page filter say where they are. Said is only that the
 * tab shows none of the case's pages, or that this page's marks were all
 * looked for and none was found (`allLost`). A case of one page gets no
 * button here: its address in the facts above opens it.
 */
export function noneFoundText(
	c: Case,
	url: string | undefined,
	allLost: boolean,
): string | undefined {
	if (url === undefined || !isWebPage(url)) return undefined;
	if (pageInFront(c, url) === undefined)
		return casePages(c).length > 1
			? "None of this case's pages is in this tab."
			: "This case's page is not in this tab.";
	return allLost ? "None of this page's marks were found here." : undefined;
}

/**
 * A page of the case as the list and the filter name it (DEC-063): its path,
 * whatever the host, as a page is the same on every host; but a home page is
 * its host's own (`pageKey`), so two hosts' home pages are named with their
 * hosts, not both "/" (DEC-064's review).
 */
export function pagePath(url: string): string {
	return shortPath(url, /^https?:\/\//.test(pageKey(url)));
}

/** `the site sitegloss.dev, 8 pages`: where a case is, in its card's name (DEC-067). */
export function pagesLine(c: Case): string {
	const { sites, label, pages } = whereText(c);
	// Spoken after "on".
	const where =
		sites === undefined
			? undefined
			: label === "On: "
				? sites
				: `${label === "Site: " ? "the site " : "the sites "}${sites.replaceAll(" · ", ", ")}`;
	return where === undefined ? pages : `${where}, ${pages}`;
}

const SVG = "http://www.w3.org/2000/svg";

/** A warning sign in the text's colour, for the panel's light and dark styles alike. */
function warningIcon(): SVGSVGElement {
	const svg = document.createElementNS(SVG, "svg");
	svg.setAttribute("viewBox", "0 0 16 16");
	svg.setAttribute("width", "16");
	svg.setAttribute("height", "16");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("class", "notice-icon");
	for (const [tag, attrs] of [
		[
			"path",
			{
				d: "M8 1.5 15 14H1z",
				fill: "none",
				stroke: "currentColor",
				"stroke-width": "1.5",
				"stroke-linejoin": "round",
			},
		],
		[
			"path",
			{
				d: "M8 6v3.5",
				stroke: "currentColor",
				"stroke-width": "1.6",
				"stroke-linecap": "round",
			},
		],
		["circle", { cx: "8", cy: "11.75", r: "0.95", fill: "currentColor" }],
	] as const) {
		const part = document.createElementNS(SVG, tag);
		for (const [key, value] of Object.entries(attrs))
			part.setAttribute(key, value);
		svg.append(part);
	}
	return svg;
}

/**
 * A notice with the warning sign: its text, a button where there is one, and
 * a line under the button (the one-tab way) where there is one.
 */
interface Notice {
	el: HTMLElement;
	text: HTMLParagraphElement;
	button: HTMLButtonElement;
	way: HTMLParagraphElement;
}

function notice(id: string, button: HTMLButtonElement): Notice {
	const text = h("p", {});
	const way = h("p", { class: "meta notice-way", hidden: true });
	const el = h(
		"div",
		{ class: "notice", id, role: "status", hidden: true },
		warningIcon(),
		h("div", { class: "notice-body" }, text, button, way),
	);
	return { el, text, button, way };
}

/**
 * The notice where the tab in front has no access (DEC-076): why, "Allow on
 * all sites (recommended)", and the one-tab way; or that no extension may run
 * there.
 */
function accessNotice(id: string, actions: () => Actions): Notice {
	return notice(
		id,
		h("button", {
			type: "button",
			onclick: (e) => {
				const button = e.currentTarget as HTMLButtonElement;
				if (button.dataset["action"] === "file-access") actions().openDetails();
				else actions().allowAllSites();
			},
		}),
	);
}

const ALLOW_ALL_SITES_TITLE = `Let Sitegloss run on every site, without a click on its icon on each tab. ${BROWSER_LABEL ?? "Your browser"} asks first; Options on the panel's main view takes it back.`;
const DETAILS_TITLE =
	"Open Sitegloss's page in chrome://extensions, where “Allow access to file URLs” is";

/**
 * The tab in front has no access (`no-access`): why, in `sentence`, with
 * both ways on. Or no extension may run there (`cannot`): where Sitegloss may
 * run on all sites already, the browser keeps the tab off limits; for a file
 * that is the "Allow access to file URLs" toggle, which the panel cannot tell
 * apart (Chrome hides the address), so it says both.
 */
function renderAccess(
	n: Notice,
	state: PanelState,
	kind: "no-access" | "cannot" | undefined,
	sentence: string,
): void {
	n.el.hidden = kind === undefined;
	// Which tab it is about: the address and title are hidden too.
	n.el.dataset["tab"] = state.tab === undefined ? "" : String(state.tab.id);
	// A file only where the address is hidden and files are not allowed: a
	// page whose address shows (a store) or the probe named is no file.
	const cannotRun = state.tab?.cannotRun;
	const files =
		kind === "cannot" &&
		(cannotRun === "file" ||
			(cannotRun === undefined &&
				state.tab?.url === "" &&
				state.fileAccess === false));
	const w = wordsOf(state);
	// Written only when they change: the notice is a live region, and a
	// render for something else must not make it speak again.
	setText(
		n.text,
		kind !== "cannot" ? sentence : files ? CANNOT_RUN_FILES : cannotRunText(w),
	);
	// Firefox lets no extension open its add-ons page: the text says the way.
	n.button.hidden = kind === "cannot" && (!files || FIREFOX);
	n.button.dataset["action"] = files ? "file-access" : "allow-all-sites";
	setLabel(
		n.button,
		files ? undefined : "all-sites",
		files ? "Open Sitegloss's details" : ALLOW_ALL_SITES_RECOMMENDED,
	);
	const title = files ? DETAILS_TITLE : ALLOW_ALL_SITES_TITLE;
	if (n.button.title !== title) n.button.title = title;
	setHint(n.way, kind === "no-access" ? oneTabWay(w) : undefined);
}

/** Text written only when it changed (a live region speaks each write). */
function setText(el: HTMLElement, text: string): void {
	if (el.textContent !== text) el.textContent = text;
}

/** The actions of the last render, for the home view's parts made once. */
let lastActions: Actions | undefined;
const homeAccess = accessNotice("access-notice", () => lastActions as Actions);

/**
 * The first-use offer (DEC-076): at the top of Home while Sitegloss may not
 * run on all sites and the person has not said "Not now". A note, not a
 * dialog; neither button is the amber one.
 */
const offerHead = h("h3", { class: "group-title", id: "all-sites-offer-head" });
const offerLine = h("p", { id: "all-sites-offer-text" });
const offerWay = h("p", { class: "meta", hidden: true });
const homeOffer = h(
	"section",
	{
		class: "all-sites-offer",
		id: "all-sites-offer",
		"aria-labelledby": "all-sites-offer-head",
		hidden: true,
	},
	offerHead,
	offerLine,
	h(
		"div",
		{ class: "row" },
		h(
			"button",
			{
				type: "button",
				class: "strong",
				"data-action": "allow-all-sites",
				title: ALLOW_ALL_SITES_TITLE,
				onclick: () => lastActions?.allowAllSites(),
			},
			...withIcon("all-sites", ALLOW_ALL_SITES),
		),
		h(
			"button",
			{
				type: "button",
				"data-action": "not-now",
				title:
					"Keep clicking the Sitegloss icon on each tab. This offer does not come again; Options below has the setting.",
				onclick: () => lastActions?.declineAllSites(),
			},
			"Not now",
		),
	),
	offerWay,
);
pageText.after(homeOffer, homeAccess.el);

/** Under the option: the same words in every state, the browser's own (DEC-076). */
byId<HTMLParagraphElement>("all-sites-note").textContent = optionNote({
	firefox: FIREFOX,
	browser: BROWSER_LABEL,
	shortcut: undefined,
});

const sizeOf = (s: Size) => `${s.width}×${s.height}`;

const percent = (score: number) => `${Math.round(score * 100)}%`;

function setHint(
	el: HTMLElement,
	text: string | undefined,
	again = false,
): void {
	el.hidden = text === undefined;
	// Written only when it changed: a status line repeats what it is given,
	// and a render for something else must not make it speak again; `again`:
	// an action wrote it anew, the same words too, to be said again.
	if (again && text !== undefined) {
		el.textContent = "";
		el.textContent = text;
	} else if (el.textContent !== (text ?? "")) el.textContent = text ?? "";
}

/** Under Export while Chrome's prompt is open: what the answer does. */
export const ASKING_DOWNLOADS = `${BROWSER} asks whether Sitegloss may manage your downloads. With a yes, Sitegloss shows here where the file went; with a no, it saves the file as before.`;

/**
 * Under an Export button: where the file went, with Copy and Show in folder
 * (DEC-020); or, while Chrome asks for downloads, what that is for. `el`
 * keeps what it shows, so Copy's "Copied" survives a render.
 */
function renderSaved(
	el: HTMLElement,
	exported: Exported | undefined,
	asking: boolean,
	actions: Actions,
): void {
	const key = asking ? "asking" : exported ? String(exported.downloadId) : "";
	if (el.dataset["key"] === key) return;
	el.dataset["key"] = key;
	el.hidden = key === "";
	el.className = key === "" ? "" : "hint saved";
	if (asking) {
		el.replaceChildren(h("p", {}, ASKING_DOWNLOADS));
		return;
	}
	if (exported === undefined) {
		el.replaceChildren();
		return;
	}
	const copy: HTMLButtonElement = h("button", {
		type: "button",
		"data-action": "copy-path",
		title: "Copy the file's full path",
		onclick: () =>
			void actions.copyPath(exported.path).then((ok) => {
				if (!ok) return;
				setCopyLabel(copy, "Copied");
				setTimeout(() => {
					setCopyLabel(copy, "Copy");
				}, 1500);
			}),
	});
	setCopyLabel(copy, "Copy");
	el.replaceChildren(
		h("p", {}, "Saved as"),
		h("code", { class: "path" }, exported.path),
		h(
			"div",
			{ class: "row" },
			copy,
			h(
				"button",
				{
					type: "button",
					"data-action": "show-file",
					title: "Open the folder with the file in your system's file manager",
					onclick: () => actions.showFile(exported),
				},
				"Show in folder",
			),
		),
	);
}

// --- home ----------------------------------------------------------------------

/**
 * The case's sites, a line right under its title (DEC-067): the names alone,
 * "comparis.ch · ractive.ch"; the word before them is for a screen reader.
 * No line for a case without a page.
 */
function sitesLine(c: Case): HTMLElement | null {
	const { sites, label } = whereText(c);
	return sites === undefined
		? null
		: h(
				"span",
				{ class: "card-sites" },
				h("span", { class: "visually-hidden" }, label),
				sites,
			);
}

/** "15 pages", or the only page's address: the card's line of pages. */
function whereLine(c: Case): HTMLElement {
	return h(
		"span",
		{ class: "card-where" },
		h("span", { class: "where-url" }, whereText(c).pages),
	);
}

/** The case's bar as the card's top edge; an empty track while it has no marks. */
function caseBand(c: Case): HTMLElement {
	const band =
		statusBar(c) ??
		h("span", { class: "progress empty", "aria-hidden": "true" });
	band.classList.add("band");
	return band;
}

/**
 * "25 open", "6 to verify", …: a chip per status with marks, each with its
 * sign; before them the case's state as one quiet badge (DEC-071).
 */
function caseChips(c: Case, state: string | undefined): HTMLElement {
	const n = caseCounts(c);
	const groups = STATUS_GROUPS.filter((g) => n[g] > 0);
	return h(
		"span",
		{ class: "card-chips" },
		state === undefined ? null : h("span", { class: "card-state" }, state),
		...(groups.length === 0
			? [h("span", { class: "none" }, "No marks yet")]
			: groups.map((g) =>
					h(
						"span",
						{ "data-kind": g },
						h("span", { class: "sign", "aria-hidden": "true" }, CHIP_SIGN[g]),
						` ${n[g]} ${GROUP_LABEL[g].toLowerCase()}`,
					),
				)),
	);
}

/**
 * The start of the summary for the developer, for one line: the style sheet
 * cuts it; more than a wide panel shows is not drawn.
 */
function summaryStart(c: Case): string | undefined {
	const text = c.verdict?.replace(/\s+/g, " ").trim();
	return text ? text.slice(0, 200) : undefined;
}

/**
 * The card's name, in one sentence: title, state, counts, where, when. Of the
 * summary only that there is one: the whole would be read on every card.
 */
function cardName(
	c: Case,
	deviceOnly: boolean,
	team: boolean,
	hand: CardHandOver,
): string {
	const count = c.marks.length;
	const counts = marksText(c);
	const state = [
		c.closed !== undefined ? "closed" : hand.state?.toLowerCase(),
		hand.assignee
			?.replace(/^Assigned/, "assigned")
			.replace(/^Nobody/, "nobody"),
		team ? "shared with the team" : undefined,
		deviceOnly ? "on this device only" : undefined,
	].filter(Boolean);
	return `${c.title}${state.length > 0 ? `, ${state.join(", ")}` : ""}: ${count === 0 ? "no marks" : `${count} mark${count === 1 ? "" : "s"}, ${counts}`}, on ${pagesLine(c)}, changed ${formatDate(c.updatedAt)}${summaryStart(c) ? ", with a summary for the developer" : ""}`;
}

/**
 * A case, as one object wherever the panel lists it: a card, the whole of
 * it the control, its bar along its top edge and its counts as chips;
 * opening it draws its marks on the tab in front (DEC-022).
 */
function caseItem(
	c: Case,
	actions: Actions,
	deviceOnly: boolean,
	team: boolean,
	hand: CardHandOver,
): HTMLLIElement {
	const summary = summaryStart(c);
	return h(
		"li",
		{},
		h(
			"button",
			{
				type: "button",
				class: "case-card",
				"data-case": c.id,
				...(c.closed !== undefined ? { "data-closed": true } : {}),
				"aria-label": cardName(c, deviceOnly, team, hand),
				title: `Open “${c.title}” and show its marks on the page in this tab`,
				onclick: () => actions.openCase(c.id),
			},
			// No band without marks: an empty one read as a progress bar (DEC-064).
			c.marks.length > 0 ? caseBand(c) : null,
			h(
				"span",
				{ class: "card-head" },
				h("span", { class: "title" }, c.title),
				c.closed !== undefined
					? h("span", { class: "tag closed-tag" }, "Closed")
					: null,
				// Signed in: shared with the team, or not (DEC-039).
				team ? h("span", { class: "tag team-tag" }, "Team") : null,
				deviceOnly
					? h("span", { class: "tag device-only" }, "This device only")
					: null,
			),
			sitesLine(c),
			// The summary is the case's own words: under the sites, in the
			// text's colour, apart from the facts (DEC-064).
			summary ? h("span", { class: "card-summary" }, summary) : null,
			whereLine(c),
			h(
				"span",
				{ class: "card-date" },
				formatDate(c.updatedAt),
				// Who has its open marks (DEC-071), where the team's case says.
				hand.assignee === undefined
					? null
					: h("span", { class: "card-assignee" }, ` · ${hand.assignee}`),
			),
			caseChips(c, hand.state),
		),
	);
}

/** What the case list and the import prompt show now. */
let casesKey: string | undefined;
let importKey: string | undefined;

function renderCases(state: PanelState, actions: Actions): void {
	const url = state.tab?.url ?? "";
	const local = (c: Case) => caseSync(state.cloud, c.id).kind === "local";
	const team = (c: Case) => caseSync(state.cloud, c.id).kind === "synced";
	const mine = mineTest(state.cloud);
	const card = (c: Case) =>
		caseItem(c, actions, local(c), team(c), cardHandOver(c, state.cloud));
	const key = JSON.stringify([
		url,
		// The filter, and who it is for (DEC-071).
		mine === undefined ? null : [state.mine, state.cloud.account?.userId],
		state.cases.map((c) => [
			c.id,
			c.updatedAt,
			c.importedAt,
			c.verdict,
			caseSync(state.cloud, c.id).kind,
			c.closed !== undefined,
			cardHandOver(c, state.cloud),
			mine?.(c) ?? null,
		]),
	]);
	if (key === casesKey) return;
	casesKey = key;
	// What has the focus in the lists, by what it is: the same control after
	// they are drawn again (a press of My cases, a teammate's change).
	// A card (or the Closed group's heading) that leaves the list hands it to
	// My cases, else to the list's heading: never to the page's body.
	const active = document.activeElement as HTMLElement | null;
	const inLists =
		active !== null &&
		(casesList.contains(active) ||
			hereCases.contains(active) ||
			hereClosed.contains(active));
	const focused: string[] | undefined = !inLists
		? undefined
		: active.id === "my-cases"
			? ["#my-cases"]
			: active.dataset["case"] !== undefined
				? // A case's id is a safe id (letters, digits, _ and -): no quoting.
					[`[data-case="${active.dataset["case"]}"]`, "#my-cases"]
				: active.closest("#closed-cases > summary") !== null
					? ["#closed-cases > summary", "#my-cases"]
					: active.closest("#closed-here > summary") !== null
						? ["#closed-here > summary", "#my-cases"]
						: undefined;
	// The page's own open cases stand under "This page" (the owner): going on
	// with the case a page has is what is done most, a second case for it
	// rarely. Only on the same page of the same site as one of its screenshots
	// (DEC-050): elsewhere (localhost, staging) a case is opened by hand. A
	// closed case is not promoted there: the page's closed cases are folded
	// under the main action, and not in the list's Closed group again.
	const { open: own, closed: ownClosed } = pageCases(state.cases, url);
	const open = state.cases.filter((c) => c.closed === undefined);
	const closed = state.cases.filter(
		(c) => c.closed !== undefined && !ownClosed.includes(c),
	);
	const others = open.filter((c) => !own.includes(c));
	// "My cases" (DEC-071): the list narrowed to them, while it is on. Its
	// count is all of them, the one under "This page" too.
	const mineOnly = mine !== undefined && state.mine;
	const other = mineOnly ? others.filter(mine) : others;
	const mineCount = mine === undefined ? 0 : open.filter(mine).length;
	const one = own.length === 1 ? own[0] : undefined;
	here.hidden = own.length === 0;
	hereClosed.replaceChildren(
		...(ownClosed.length > 0 ? [closedGroup(ownClosed, card, "here")] : []),
	);
	// The one case here waits for this person to verify it: said so, and
	// Start verifying is the action (DEC-079).
	const waits = one ? waitsToVerify(one, url, state.cloud) : undefined;
	hereText.textContent =
		own.length === 0
			? ""
			: waits
				? waitsText(waits)
				: one
					? "This page already has a case. Open it to go on with its marks, or start a new one."
					: `This page already has ${own.length} cases. Open one to go on with its marks, or start a new one.`;
	hereCases.replaceChildren(
		...(own.length > 0
			? [h("ul", { class: "cases", "data-group": "here" }, ...own.map(card))]
			: []),
	);
	// One case: opening it is the view's one primary button, a new case steps
	// back. Several: each row opens its case, and none is the one.
	openHere.hidden = one === undefined;
	// One case: its Open button is part of its card; several: none.
	const unit = hereCases.querySelector("li");
	if (one && unit) {
		unit.classList.add("with-action");
		unit.append(openHere);
	} else hereCases.after(openHere);
	// Start verifying has the Verify tick wherever it is; Open this case none (DEC-078).
	setLabel(
		openHere,
		waits ? "check" : undefined,
		waits ? "Start verifying" : "Open this case",
	);
	openHere.onclick = !one
		? null
		: waits
			? () => actions.verifyCase(one.id)
			: () => actions.openCase(one.id);
	openHere.title = !one
		? ""
		: waits
			? `Open “${one.title}”, show its marks on the page in this tab, and open the first mark to verify`
			: `Open “${one.title}” and show its marks on the page in this tab`;
	newCaseButton.classList.toggle("primary", own.length === 0);
	casesHeading.textContent = own.length > 0 ? "Other cases" : "Cases";
	casesList.replaceChildren(
		...(mine === undefined || state.cases.length === 0
			? []
			: [mineFilter(state.mine, mineCount, actions)]),
		state.cases.length === 0
			? h(
					"div",
					{ class: "empty" },
					...emptyList(state.cloud).map((t) => h("p", {}, t)),
				)
			: other.length === 0
				? h(
						"p",
						{ class: "empty" },
						mineOnly
							? mineCount > 0
								? NO_OTHER_MINE
								: NONE_MINE
							: open.length === 0
								? "No open cases."
								: "No cases for other pages.",
					)
				: h(
						"ul",
						{ class: "cases", "data-group": "other" },
						...other.map(card),
					),
		// Closed cases are nobody's turn: not under My cases.
		...(closed.length === 0 || mineOnly ? [] : [closedGroup(closed, card)]),
	);
	if (focused !== undefined) {
		const next = focused
			.map(
				(selector) =>
					casesList.querySelector<HTMLElement>(selector) ??
					hereCases.querySelector<HTMLElement>(selector) ??
					hereClosed.querySelector<HTMLElement>(selector),
			)
			.find((el) => el !== null);
		if (next) next.focus();
		else {
			casesHeading.tabIndex = -1;
			casesHeading.focus();
		}
	}
}

/**
 * What the empty list says (DEC-071): how to begin, and how a case goes
 * from whoever finds what is wrong to whoever fixes it and back.
 */
export const EMPTY_LIST = [
	"No cases yet. Start one with “New case for this page”, or import a case someone sent you.",
	HAND_OVER_NOTE,
];

/**
 * The empty list's words: the hand-over only where it can happen. Before
 * signing in the Team section says it, under Sign in: once on the page.
 */
const emptyList = (cloud: PanelState["cloud"]): string[] =>
	teamAssigns(cloud) ? EMPTY_LIST : EMPTY_LIST.slice(0, 1);

/** "My cases" and how many (DEC-071): a chip to press, as the open case's status chips are. */
function mineFilter(on: boolean, count: number, actions: Actions): HTMLElement {
	return h(
		"div",
		{
			class: "chips cases-filter",
			role: "group",
			"aria-label": "Filter the cases",
		},
		h(
			"button",
			{
				type: "button",
				class: "chip",
				id: "my-cases",
				"aria-pressed": String(on),
				title: on
					? "Show every case again"
					: "Show only the cases where it is your turn: assigned to you with open marks, or started by you and waiting for you to hand them over, check them or close them",
				onclick: () => actions.showMine(!on),
			},
			"My cases",
			h("span", { class: "n" }, String(count)),
		),
	);
}

/**
 * Whether each Closed group (the list's, and the page's under "This page")
 * was unfolded: it stays so across redraws, each on its own.
 */
const closedOpen = { list: false, here: false };

/** The closed cases, folded by default (DEC-046). */
function closedGroup(
	closed: Case[],
	card: (c: Case) => HTMLLIElement,
	where: "list" | "here" = "list",
): HTMLElement {
	const group = h(
		"details",
		{
			class: "closed-cases",
			id: where === "list" ? "closed-cases" : "closed-here",
			...(closedOpen[where] ? { open: true } : {}),
			ontoggle: (e: Event) => {
				closedOpen[where] = (e.target as HTMLDetailsElement).open;
			},
		},
		h(
			"summary",
			{},
			"Closed ",
			h("span", { class: "count" }, String(closed.length)),
		),
		h("ul", { class: "cases", "data-group": "closed" }, ...closed.map(card)),
	);
	return group;
}

function renderImportPrompt(state: PanelState, actions: Actions): void {
	const importing = state.importing;
	const batch = importing?.batch;
	const key = JSON.stringify([
		importing?.existing.id,
		importing?.existing.updatedAt,
		importing?.parsed.case.updatedAt,
		batch ? [batch.name, batch.rest.length] : null,
	]);
	if (key === importKey) return;
	importKey = key;
	if (importing === undefined) {
		importPrompt.hidden = true;
		importPrompt.replaceChildren();
		return;
	}
	importPrompt.replaceChildren(
		h(
			"p",
			{},
			`“${importing.existing.title}” is here already (changed ${formatDate(importing.existing.updatedAt)}); the file's copy was changed ${formatDate(importing.parsed.case.updatedAt)}.`,
		),
		// What differs on a hand-back: the marks' statuses.
		h(
			"p",
			{ class: "meta", "data-role": "import-counts" },
			`Here: ${marksText(importing.existing)}. In the file: ${marksText(importing.parsed.case)}.`,
		),
		...(batch
			? [
					h(
						"p",
						{ class: "meta" },
						`Case ${batch.total - batch.rest.length} of ${batch.total} in ${batch.name}.`,
					),
				]
			: []),
		h(
			"div",
			{ class: "row" },
			h(
				"button",
				{
					type: "button",
					"data-action": "import-replace",
					title:
						"Put the file's copy in place of the case here, with its marks and screenshots; what only the case here has is lost, except its comments, which stay as they are here",
					onclick: () => actions.importReplace(),
				},
				"Replace it",
			),
			h(
				"button",
				{
					type: "button",
					"data-action": "import-copy",
					title:
						"Import the file's copy as a new case beside this one, its title ending in (copy)",
					onclick: () => actions.importCopy(),
				},
				"Keep both",
			),
			h(
				"button",
				{
					type: "button",
					"data-action": "import-cancel",
					title: batch
						? "Leave the case here as it is, and go on with the next case in the file"
						: "Import nothing; the case here stays as it is",
					onclick: () => actions.importCancel(),
				},
				batch ? "Skip" : "Cancel",
			),
		),
	);
	importPrompt.hidden = false;
}

/** The last `homeFocus` the list has answered. */
let homeFocusSeq = 0;

/**
 * After the person's own Close case the list takes the focus, once: on the
 * closed case's card where it is on screen (the page's own case), else on
 * the list's heading, never on the body.
 */
function applyHomeFocus(state: PanelState): void {
	const { seq, caseId } = state.homeFocus;
	// Home out of sight (Settings, a case open): it waits for it.
	if (seq === homeFocusSeq || state.settings || state.view.kind !== "home")
		return;
	homeFocusSeq = seq;
	const card =
		caseId === undefined
			? null
			: document.querySelector<HTMLElement>(
					`#here-cases [data-case="${caseId}"], #here-closed [data-case="${caseId}"], #cases [data-case="${caseId}"]`,
				);
	const folded = card?.closest("details:not([open])") != null;
	if (card && !folded) card.focus();
	else {
		casesHeading.tabIndex = -1;
		casesHeading.focus();
	}
}

function renderHome(state: PanelState, actions: Actions): void {
	const tab = state.tab;
	// Under "This page": its address, else its title (Chrome tells the
	// address only of a tab Sitegloss may run on).
	pageText.textContent = tab?.url ? shortUrl(tab.url) : (tab?.title ?? "");
	pageText.hidden = pageText.textContent === "";
	// Access (DEC-076): the offer of all sites until it is taken or declined;
	// on a tab without access, why, with both ways on, in place of New case.
	const plan = planOf(state);
	const forTab = plan.offer === "for-tab";
	homeOffer.hidden = plan.offer === undefined;
	homeOffer.toggleAttribute("data-no-access", forTab);
	const offer = offerText(forTab, wordsOf(state));
	setHint(offerHead, offer.head);
	setHint(offerLine, offer.text);
	setHint(offerWay, forTab ? oneTabWay(wordsOf(state)) : undefined);
	renderAccess(homeAccess, state, plan.notice, NO_ACCESS_HOME);
	setHint(hint, state.hint);
	// Always a new case, stored and opened at once (DEC-023, DEC-026); not
	// there where it could not work.
	newCaseButton.hidden = !plan.pageControls;
	newCaseButton.title = newCaseTitle;
	importError.hidden = state.importError === undefined;
	importErrorText.textContent = state.importError ?? "";
	// One import at a time, and no export of all cases while it stores them.
	const busy = state.importWork !== undefined || state.importing !== undefined;
	setHint(
		importDone,
		state.importWork !== undefined && state.importing === undefined
			? `Importing ${state.importWork}…`
			: state.importDone,
	);
	importButton.disabled = busy;
	importButton.title = busy ? IMPORT_BUSY : importTitle;
	exportAll.disabled = busy || state.exportingAll || state.cases.length === 0;
	exportAll.title = busy ? EXPORT_ALL_BUSY : exportAllTitle;
	renderSaved(
		exportAllSaved,
		state.exported?.of === "all" ? state.exported : undefined,
		state.askingDownloads === "all",
		actions,
	);
	renderCases(state, actions);
	applyHomeFocus(state);
	renderImportPrompt(state, actions);
	renderCloudSection(state, actions);
	renderSyncSection(state, actions);
}

// --- one case ------------------------------------------------------------------

/** The colour of the mark on the page: the shown candidate decides (review.ts). */
function colourOf(m: MarkMatch): "found" | "unsure" | "lost" {
	if (m.status === "lost") return "lost";
	const sure = m.status !== "ambiguous" && m.candidates[m.current]?.found;
	return sure ? "found" : "unsure";
}

/** Where the mark is on the tab in front, in words: the number's colour says it too, but not to everyone. */
function matchWord(m: MarkMatch | undefined): string | undefined {
	if (m === undefined || m.status === "no-element") return undefined;
	// A highlight whose text is not there any more (DEC-066), found nearby (DEC-083).
	if (m.textNear === "nearby" && m.status !== "lost") return "Text moved";
	if (m.textChanged && m.status !== "lost") return "Text changed";
	if (m.textUnread && m.status !== "lost") return "Text not looked for";
	return colourOf(m) === "unsure" ? "Unsure" : matchText(m);
}

/** A mark's status in its head; an open mark has none. */
const PILL: Record<MarkStatus, string | undefined> = {
	open: undefined,
	fixed: "To verify",
	verified: "Verified",
	wontfix: RESOLUTION_LABEL.wontfix,
	cantreproduce: RESOLUTION_LABEL.cantreproduce,
};

function matchText(m: MarkMatch): string {
	// Found around its element instead (DEC-083): page text, shown as text.
	if (m.textNear === "nearby" && m.status !== "lost")
		return m.textPlaced
			? `The highlighted text was found on the page near where the mark was, and drawn there (${percent(m.score)}).`
			: `The highlighted text is now in another element nearby, and drawn there (${percent(m.score)}).`;
	if (m.textNear === "reworded" && m.status !== "lost") {
		const now = m.textNow ?? "";
		return `The highlighted text has changed in place; it now reads “${textLength(now) > NOW_SHOWN ? `${cutText(now, NOW_SHOWN - 1)}…` : now}” (${percent(m.score)}).`;
	}
	if (m.textChanged && m.status !== "lost")
		return `The highlighted text is no longer in the element: it changed, or the fix changed it. Its element is outlined (${percent(m.score)}).`;
	if (m.textUnread && m.status !== "lost")
		return `The element is too long to look for the highlighted text in it. Its element is outlined (${percent(m.score)}).`;
	if (m.current > 0)
		return `Candidate ${m.current + 1} of ${m.candidates.length} (${percent(m.score)})`;
	switch (m.status) {
		case "found":
			return `Found here (${percent(m.score)})`;
		case "probable":
			return `Probably here (${percent(m.score)})`;
		case "ambiguous":
			return `Unsure: candidate ${m.current + 1} of ${m.candidates.length}`;
		case "lost":
			return m.truncated
				? "Not found in the part of the page searched"
				: "Not found on this page";
		case "no-element":
			return "No element recorded";
	}
}

/** What is news about the element shown: the mark names the one it expected. */
function shownText(
	a: Mark,
	shown: CandidateInfo | undefined,
): string | undefined {
	if (shown === undefined) return undefined;
	const expected = a.element !== null && shown.summary === summarize(a.element);
	if (shown.visible) return expected ? undefined : shown.summary;
	return expected
		? "Hidden at this width"
		: `${shown.summary}, hidden at this width`;
}

/** Whether the page can scroll to the mark: then its head offers Show. */
const canShow = (m: MarkMatch | undefined): m is MarkMatch =>
	m !== undefined && (m.candidates.length > 0 || m.status === "no-element");

/** A highlight's text, cut to the most a row's line shows (DEC-066). */
const QUOTE_SHOWN = 160;

/** The text found in a highlight's place, cut to the most its sentence quotes (DEC-083). */
const NOW_SHOWN = 80;

/**
 * A mark of a kind this version does not know (DEC-066): its kind's name,
 * as the newer Sitegloss that made it calls it, and what to do.
 */
export function newerKindText(kind: string): string {
	return `A mark of a kind made with a newer Sitegloss (“${cutText(kind, 40)}”). Its comment, status and thread work here; to see it on the page, update Sitegloss. A team that does not have it yet gets it only from a newer version.`;
}

/**
 * A picture of a mark as a tile: a click opens it at its size in the viewer,
 * the viewer, with the mark's other pictures (DEC-060; in one step since
 * DEC-061): over the page in a frame of the extension's own, or in a window
 * of its own (DEC-064). It never goes through the web page being marked.
 */
function pictureTile(
	src: string,
	label: string,
	title: string,
	open: () => void,
): HTMLElement {
	return h(
		"button",
		{
			type: "button",
			class: "tile",
			"data-action": "open-larger",
			"aria-label": `${label}: shows it large`,
			title: `${title} Click to see it large; Escape closes it.`,
			onclick: open,
		},
		h("img", { src, alt: "" }),
	);
}

/** "22 Nov" in the browser's language. */
const shortDate = (iso: string) => {
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? iso
		: date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/**
 * A mark's pictures as a grid of equal tiles (DEC-058, the owner's rule): its
 * own screenshot first, always, so nobody thinks a mark needs one added; then
 * the images a person added, oldest first, each with a Remove at its corner;
 * last a tile to add another, gone once the mark holds the most. Numbers
 * count the added images only. `ready`: the images were read for this
 * version of the case, so one without a URL is missing, not on its way.
 */
function picturesView(c: Case, a: Mark, x: MarkContext): HTMLElement {
	const added = a.images ?? [];
	// Added here, and no place for them on the team's mark (DEC-058).
	const held = a.heldImages ?? [];
	const missing = (text: string) =>
		h("div", { class: "tile tile-missing" }, x.ready ? text : "");
	const shot = x.urls?.get(a.crop);
	const grid = h(
		"div",
		{ class: "pictures" },
		h(
			"figure",
			{ class: "picture", "data-picture": "screenshot" },
			shot
				? pictureTile(
						shot,
						`Screenshot of mark ${a.number}, taken by Sitegloss`,
						"Taken by Sitegloss when the mark was made. It stays with the mark.",
						() => x.actions.openPicture(c, a, "screenshot"),
					)
				: missing("The screenshot is missing."),
			h("figcaption", {}, "Screenshot"),
		),
		...[...added, ...held].map((image, i) => {
			const n = i + 1;
			const waiting = i >= added.length;
			// From a file, nobody is named: who added it is only what the file says.
			const who = image.added.imported
				? undefined
				: byline(image.added.user, image.added.app);
			const whence = image.added.imported
				? ", from an imported file"
				: who
					? `, added by ${who}`
					: "";
			const url = x.urls?.get(image.image);
			const armed = x.imageArmed === image.id;
			return h(
				"figure",
				{ class: "picture", "data-picture": image.id },
				url
					? pictureTile(
							url,
							waiting
								? `Image ${n} on mark ${a.number}, not sent: the mark already holds ${MAX_MARK_IMAGES} images`
								: `Image ${n} of ${added.length} on mark ${a.number}${whence}`,
							image.added.imported
								? `Added ${shortDate(image.added.at)}, from an imported file.`
								: `Added${who ? ` by ${who}` : ""}, ${shortDate(image.added.at)}.`,
							() => x.actions.openPicture(c, a, image.id),
						)
					: missing("The image is missing."),
				h(
					"button",
					{
						type: "button",
						class: "tile-remove",
						"data-action": "remove-image",
						"aria-label": armed
							? `Really remove image ${n} from mark ${a.number}?`
							: `Remove image ${n} from mark ${a.number}`,
						title: armed
							? "Click again to remove it"
							: "Remove this image from the mark (click twice)",
						...(armed ? { "data-armed": true } : {}),
						onclick: () => x.actions.deleteImage(c, a, image.id),
					},
					armed ? "Really remove?" : h("span", { "aria-hidden": "true" }, "×"),
				),
				h("figcaption", {}, `Image ${n}`),
				waiting
					? h(
							"p",
							{ class: "tile-note" },
							"Not sent: the mark already holds six images. It goes when a place is free.",
						)
					: x.notSent?.[image.id] === undefined
						? null
						: h(
								"p",
								{ class: "tile-note" },
								`Not sent: ${x.notSent[image.id]?.replace(/[.\s]+$/, "")}. `,
								// Its refusal may have gone (room in storage, a role).
								h(
									"button",
									{
										type: "button",
										class: "link",
										"data-action": "retry-image",
										onclick: () => x.actions.cloudSyncNow(),
									},
									"Try again",
								),
							),
			);
		}),
		added.length < MAX_MARK_IMAGES
			? h(
					"button",
					{
						type: "button",
						class: "tile tile-add",
						"data-action": "add-image",
						title:
							"Add a picture of what the screenshot does not show, for example a menu that closes",
						onclick: () => x.actions.addImages(c, a),
					},
					...withIcon("add", "Add another image…"),
				)
			: null,
	);
	return h(
		"div",
		{
			class: "pictures-box",
			role: "group",
			"aria-label": `Pictures of mark ${a.number}`,
		},
		grid,
		added.length >= MAX_MARK_IMAGES
			? h(
					"p",
					{ class: "meta pictures-full" },
					held.length > 0
						? `${MAX_MARK_IMAGES} of ${MAX_MARK_IMAGES} images; ${held.length === 1 ? "1 more waits" : `${held.length} more wait`} for a place`
						: `${MAX_MARK_IMAGES} of ${MAX_MARK_IMAGES} images`,
				)
			: null,
	);
}

function matchView(
	caseId: string,
	a: Mark,
	m: MarkMatch,
	actions: Actions,
): HTMLElement {
	const shown = m.candidates[m.current];
	const buttons = h("div", { class: "row" });
	// A sure match needs no other: offered where unsure, or to step back.
	if (m.candidates.length > 1 && (colourOf(m) !== "found" || m.current > 0))
		buttons.append(
			h(
				"button",
				{
					type: "button",
					"data-action": "next",
					title: "Show the next element on the page that could be this mark's",
					onclick: () => actions.showMatch(caseId, a, m.current + 1),
				},
				"Next candidate",
			),
		);
	const said = shownText(a, shown);
	return h(
		"div",
		{
			class: `match ${colourOf(m)}`,
			id: `match-${a.id}`,
			"data-status": m.status,
		},
		h(
			"div",
			{ class: "line" },
			h("span", { class: "status" }, matchText(m)),
			buttons.childElementCount > 0 ? buttons : null,
		),
		said ? h("p", { class: "meta" }, said) : null,
	);
}

/** The parts of the open case's view, kept between renders. */
interface CaseParts {
	/** The case as last drawn, for the buttons. */
	current: Case;
	title: HTMLElement;
	/** The title and its Rename button; the rename form instead while renaming. */
	titleRow: HTMLElement;
	renameButton: HTMLButtonElement;
	/** "…": Rename, the link, Export, Delete case (DEC-061). */
	more: HTMLButtonElement;
	menu: HTMLElement;
	linkMenu: HTMLButtonElement;
	/** The facts' rows that come and go with what they hold. */
	teamRow: HTMLElement;
	linkFact: HTMLElement;
	/**
	 * The pages of a case that has several, under the heading "Site" or
	 * "Sites", each site a heading that opens and closes its own list
	 * (DEC-065, DEC-067).
	 */
	pagesSection: HTMLElement;
	sitesHeading: HTMLElement;
	/** The sites' headings and lists, in `groupsBox`; the groups they were drawn for. */
	groups: GroupParts[];
	groupsBox: HTMLElement;
	/** Numbers a site's heading and list in their ids, once each. */
	groupSeq: number;
	siteGroups: SiteGroup[];
	/** The case's page in the tab in front, as last drawn: which site starts open. */
	front: CasePage | undefined;
	/** The one page of a case that has one, among the facts, and its site beside it. */
	pageRow: HTMLElement;
	siteRow: HTMLElement;
	siteLabel: HTMLElement;
	siteText: HTMLElement;
	rename: HTMLElement;
	renameField: HTMLInputElement;
	renameSave: HTMLButtonElement;
	renameHint: HTMLElement;
	/** The rename form was shown at the last render. */
	renameOpen: boolean;
	meta: HTMLElement;
	/** The case's link and its Edit (or Add a link); its form while editing. */
	linkRow: HTMLElement;
	linkOpen: HTMLAnchorElement;
	linkEdit: HTMLButtonElement;
	linkForm: HTMLElement;
	linkField: HTMLInputElement;
	linkHint: HTMLElement;
	/** The link form was shown at the last render. */
	linkFormOpen: boolean;
	/** The case's address, a link where it is a web page. */
	page: HTMLButtonElement;
	pagesKey: string;
	/** The action hint last written (`caseHintSeq`). */
	hintSeq: number;
	/** Whether the case syncs with the team, and "Share with team" (DEC-039). */
	team: HTMLElement;
	teamText: HTMLElement;
	share: HTMLButtonElement;
	/** The address where it is not a web page (only text, never a link). */
	about: HTMLSpanElement;
	madeAt: HTMLSpanElement;
	madeOn: HTMLSpanElement;
	/** Holds the status block: the bar and the chips that filter the marks. */
	status: HTMLElement;
	statusKey: string;
	/** The tab in front, where its size is not the case's. */
	size: HTMLElement;
	sizeText: HTMLSpanElement;
	origin: HTMLElement;
	/** Sitegloss may not run on the tab in front: in the tool bar (DEC-076). */
	access: Notice;
	/** The tool bar at the bottom: Add marks, Show/Hide marks, or `access`. */
	dock: HTMLElement;
	/**
	 * For a reader going down the case: under its head, that the tool bar at
	 * the end says why nothing is drawn (the bar is last in the page, as it
	 * is on screen).
	 */
	accessPointer: HTMLElement;
	/** None of the case's marks were found on the tab in front (DEC-022). */
	/** The quiet line where the marks start (DEC-063). */
	noneFound: HTMLElement;
	/** What the tab in front shows of the case, in one line. */
	tabLine: HTMLElement;
	/** Show, or Hide where the case is loaded on the tab in front. */
	loadButton: HTMLButtonElement;
	loadedHere: boolean;
	/** "Add marks", or "Adding marks: Done" while the toolbar adds to the case. */
	addMarks: HTMLButtonElement;
	/** The same under the last mark of the list, where it has marks. */
	adding: boolean;
	/** "← All cases" is finishing the marks, or could not (DEC-023). */
	leaving: HTMLElement;
	deleteButton: HTMLButtonElement;
	/** Close case / Reopen case (DEC-046). */
	closeButton: HTMLButtonElement;
	/** Who closed it and when, while it is closed. */
	closedLine: HTMLElement;
	/** What comes next, under the counts (DEC-069). */
	next: StepParts;
	/** The case's thread (`thread-view.ts`). */
	thread: HTMLElement;
	/** Who last changed the summary, in a team (DEC-046). */
	summaryBy: HTMLElement;
	/** Where Export saved the file. */
	saved: HTMLElement;
	hint: HTMLElement;
	verdict: HTMLTextAreaElement;
	verdictStatus: HTMLSpanElement;
	saveVerdict: HTMLButtonElement;
	/**
	 * The summary's one line while the case has none: it opens the field.
	 * `summaryOpen`: the field shows, and stays for as long as the case is
	 * open (nothing folds away under the keyboard, DEC-060).
	 */
	summaryAdd: HTMLButtonElement;
	summaryBody: HTMLElement;
	summaryOpen: boolean;
	marks: HTMLElement;
	marksKey: string;
	/** The click on a mark's pin on the page that was last shown in the list. */
	pickedAt: number | undefined;
	shots: HTMLElement;
	shotsKey: string;
}

let parts: CaseParts | undefined;

/** The armed Delete held in its place (`holdDelete`), and how to let it go. */
let held: { button: HTMLElement; release: () => void } | undefined;

/**
 * While a Delete waits for its confirming click, it stays where it was
 * clicked: what grows above it meanwhile (the marks found on the tab, their
 * lines) is scrolled away, so a second click in the same place confirms.
 * Room below is lent while it waits, so a short case can be scrolled too.
 * `undefined`: none is armed.
 */
function holdDelete(button: HTMLElement | undefined): void {
	if (held?.button === button) return;
	held?.release();
	held = undefined;
	// (A document without layout, as in the unit tests, has nothing to hold.)
	if (button === undefined || typeof ResizeObserver === "undefined") return;
	const at = button.getBoundingClientRect().top;
	const room = caseView.style.paddingBottom;
	caseView.style.paddingBottom = `${document.documentElement.clientHeight}px`;
	const watch = new ResizeObserver(() => {
		const moved = button.getBoundingClientRect().top - at;
		if (Math.abs(moved) >= 1) document.scrollingElement?.scrollBy(0, moved);
	});
	watch.observe(caseView);
	held = {
		button,
		release: () => {
			watch.disconnect();
			caseView.style.paddingBottom = room;
		},
	};
}

/** A site's heading, which opens and closes its list of pages (DEC-067). */
interface GroupParts {
	name: string;
	head: HTMLElement;
	toggle: HTMLButtonElement;
	count: HTMLElement;
	/** "This tab: Help": the page in front, said on the heading while its list is closed. */
	here: HTMLElement;
	list: HTMLUListElement;
}

/**
 * The sites' lists opened or closed by the person, per case and site, this
 * session (DEC-063, DEC-067). Not chosen: `openAtFirst`. A choice wins over
 * that, so a list does not open again by itself at the next render (DEC-064's
 * review).
 */
const openSites = new Map<string, boolean>();

const siteChoice = (caseId: string, name: string): string =>
	`${caseId}\n${name}`;

/**
 * Each site's list under its heading, open or closed as "Comments" and
 * "Screenshots" are (DEC-065, DEC-067). Closed at first while the tab shows
 * one of the case's pages: the heading names that page, and the marks start
 * right under the head. Open at first (`openAtFirst`) while the tab shows
 * none of them: the list is then the way to one.
 */
function foldPages(p: CaseParts): void {
	const several = p.groups.length > 0;
	p.pagesSection.hidden = !several;
	p.pageRow.hidden = several;
	const first = openAtFirst(p.siteGroups, p.front);
	p.groups.forEach((g, i) => {
		const open =
			openSites.get(siteChoice(p.current.id, g.name)) ??
			(p.front === undefined ? (first[i] ?? true) : false);
		// Closed by itself with the focus in it: the focus goes to its heading.
		if (!open && g.list.contains(document.activeElement)) g.toggle.focus();
		g.list.hidden = !open;
		g.toggle.setAttribute("aria-expanded", String(open));
	});
}

/**
 * A site's heading and its list: "› sitegloss.dev 12 pages", the same
 * control as "Comments 4"; and, while the tab shows one of its pages, which.
 */
function groupParts(p: CaseParts, name: string, index: number): GroupParts {
	const list: HTMLUListElement = h("ul", {
		class: "case-pages",
		id: `case-site-pages-${index}`,
		hidden: true,
	});
	const count = h("span", { class: "count" });
	const here = h("span", { class: "site-here", hidden: true });
	const toggle: HTMLButtonElement = h(
		"button",
		{
			type: "button",
			class: "thread-toggle pages-toggle",
			id: `case-site-toggle-${index}`,
			"aria-controls": list.id,
			"aria-expanded": "false",
			onclick: () => {
				const open = toggle.getAttribute("aria-expanded") === "true";
				openSites.set(siteChoice(p.current.id, name), !open);
				foldPages(p);
			},
		},
		h("span", { class: "chevron", "aria-hidden": "true" }),
		h("bdi", { class: "site-name" }, name),
		" ",
		count,
		" ",
		here,
	);
	return {
		name,
		head: h("h3", { class: "site-head" }, toggle),
		toggle,
		count,
		here,
		list,
	};
}

// The case's menu closes on a press outside it.
document.addEventListener(
	"pointerdown",
	(e) => {
		const p = parts;
		if (p === undefined || p.menu.hidden) return;
		const t = e.target as Node;
		if (p.menu.contains(t) || p.more.contains(t)) return;
		p.menu.hidden = true;
		p.more.setAttribute("aria-expanded", "false");
	},
	true,
);

/**
 * Whether the tab's size differs from the marks' enough to offer "Match
 * size" (DEC-061): 24 px of width (a layout's breakpoint can sit that
 * close; a classic scrollbar is 15 px) or 100 px of height.
 */
export function sizeMatters(tab: Size, made: Size): boolean {
	return (
		Math.abs(tab.width - made.width) >= 24 ||
		Math.abs(tab.height - made.height) >= 100
	);
}

/** The summary's field, or its one line while the case has none and nobody asked for the field. */
function showSummary(p: CaseParts): void {
	p.summaryAdd.hidden = p.summaryOpen;
	p.summaryAdd.setAttribute("aria-expanded", String(p.summaryOpen));
	p.summaryBody.hidden = !p.summaryOpen;
}

function createParts(c: Case, actions: Actions): CaseParts {
	const verdict: HTMLTextAreaElement = h("textarea", {
		id: "verdict",
		rows: "2",
		// Help under the label, not a placeholder that looks like text (DEC-060).
		"aria-describedby": "verdict-help",
		maxlength: String(MAX_VERDICT),
		"data-case": c.id,
		oninput: () => actions.typeVerdict(c.id, verdict.value),
	});
	const verdictStatus = h("span", { class: "meta", id: "verdict-status" });
	const page = h("button", {
		type: "button",
		class: "link page-link",
		id: "open-page",
		title: "Open this page in a new tab and load the case there",
		onclick: () => actions.openPage(created.current),
	});
	const about = h("span");
	const madeAt = h("span");
	const madeOn = h("span");
	const sizeText = h("span");
	const title = h("h2", { class: "case-title" });
	// The case's rare actions, in one menu (DEC-061, the web's case page).
	const closeMenu = (back = false) => {
		menu.hidden = true;
		more.setAttribute("aria-expanded", "false");
		if (back) more.focus();
	};
	const item = (
		id: string,
		label: string,
		title: string,
		onclick: () => void,
		keepOpen = false,
		glyph?: IconName,
	) =>
		h(
			"button",
			{
				type: "button",
				role: "menuitem",
				id,
				title,
				onclick: () => {
					onclick();
					if (!keepOpen) closeMenu();
				},
			},
			glyph === undefined ? null : icon(glyph),
			label,
		);
	const renameButton = item(
		"rename-case",
		"Rename…",
		"Change this case's title; it is saved at once",
		() => actions.startRename(created.current),
		false,
		"edit",
	);
	const linkMenu = item(
		"case-link-menu",
		"Add a link…",
		"A ticket, a design or a pull request this case is about; it is saved at once",
		() => actions.startLink(created.current),
	);
	const exportItem = item(
		"export-case",
		"Export…",
		"Save this case as one .zip file: its marks, comments, summary, thread and screenshots, and case.md to read them without Sitegloss. Someone imports it with Import a case…",
		() => actions.exportCase(created.current),
		false,
		"export",
	);
	const more: HTMLButtonElement = h(
		"button",
		{
			type: "button",
			class: "quiet more",
			id: "case-more",
			"aria-haspopup": "menu",
			"aria-expanded": "false",
			"aria-controls": "case-menu",
			"aria-label": "More actions on this case",
			title: "Rename, add a link, export or delete this case",
			onclick: () => {
				const open = menu.hidden;
				menu.hidden = !open;
				more.setAttribute("aria-expanded", String(open));
				if (open)
					menu.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
			},
		},
		"…",
	);
	const menu: HTMLElement = h("div", {
		class: "case-menu",
		id: "case-menu",
		role: "menu",
		"aria-label": "More actions on this case",
		hidden: true,
		onkeydown: (e: Event) => {
			const k = e as KeyboardEvent;
			const items = [
				...menu.querySelectorAll<HTMLElement>("button:not(:disabled)"),
			];
			const at = items.indexOf(document.activeElement as HTMLElement);
			if (k.key === "Escape") {
				k.preventDefault();
				closeMenu(true);
			} else if (k.key === "ArrowDown" || k.key === "ArrowUp") {
				k.preventDefault();
				const step = k.key === "ArrowDown" ? 1 : -1;
				items[(at + step + items.length) % items.length]?.focus();
			} else if (k.key === "Tab") closeMenu();
		},
	});

	const renameField: HTMLInputElement = h("input", {
		type: "text",
		id: "rename-field",
		"aria-label": "Case title",
		"aria-describedby": "rename-hint",
		maxlength: String(MAX_TITLE),
		autocomplete: "off",
		oninput: () => actions.typeRename(renameField.value),
		onkeydown: (e) => {
			const k = e as KeyboardEvent;
			// The Enter (or Escape) that ends an IME composition is the
			// composition's, not a save.
			if (k.isComposing || k.keyCode === 229) return;
			if (k.key === "Enter") {
				k.preventDefault();
				actions.saveRename(created.current, renameField.value);
			} else if (k.key === "Escape") {
				k.preventDefault();
				actions.cancelRename();
			}
		},
	});
	const renameSave = h(
		"button",
		{
			type: "button",
			class: "strong small",
			id: "rename-save",
			onclick: () => actions.saveRename(created.current, renameField.value),
		},
		"Save",
	);
	const renameHint = h("p", {
		class: "hint",
		id: "rename-hint",
		role: "status",
		hidden: true,
	});
	const linkOpen = h("a", {
		id: "case-link-open",
		target: "_blank",
		rel: "noopener noreferrer",
	});
	const linkEdit = h("button", {
		type: "button",
		class: "link",
		id: "case-link-edit",
		title:
			"A ticket, a design or a pull request this case is about; it is saved at once",
		onclick: () => actions.startLink(created.current),
	});
	const linkField: HTMLInputElement = h("input", {
		type: "url",
		id: "case-link-field",
		"aria-label": "Link of this case",
		"aria-describedby": "case-link-hint",
		// Only the address's form: what a link is for is the button's title.
		placeholder: "https://…",
		autocomplete: "off",
		spellcheck: "false",
		oninput: () => actions.typeLink(linkField.value),
		onkeydown: (e) => {
			const k = e as KeyboardEvent;
			// The Enter (or Escape) that ends an IME composition is the
			// composition's, not a save.
			if (k.isComposing || k.keyCode === 229) return;
			if (k.key === "Enter") {
				k.preventDefault();
				actions.saveLink(created.current, linkField.value);
			} else if (k.key === "Escape") {
				k.preventDefault();
				actions.cancelLink();
			}
		},
	});
	const linkHint = h("p", {
		class: "hint",
		id: "case-link-hint",
		role: "status",
		hidden: true,
	});
	const linkForm = h(
		"div",
		{ class: "case-link-form", id: "case-link-form", hidden: true },
		linkField,
		h(
			"div",
			{ class: "row" },
			h(
				"button",
				{
					type: "button",
					class: "strong small",
					id: "case-link-save",
					onclick: () => actions.saveLink(created.current, linkField.value),
				},
				"Save",
			),
			h(
				"button",
				{
					type: "button",
					class: "small",
					id: "case-link-cancel",
					onclick: () => actions.cancelLink(),
				},
				"Cancel",
			),
		),
		linkHint,
	);
	const teamText = h("span");
	const share: HTMLButtonElement = h(
		"button",
		{
			type: "button",
			class: "link",
			id: "share-case",
			title:
				"Send this case to your team: its members see it, with its screenshots, and what anyone changes syncs",
			onclick: () => actions.cloudShare(created.current.id),
		},
		"Share with team",
	);
	const created: CaseParts = {
		current: c,
		title,
		titleRow: h(
			"div",
			{ class: "case-title-row" },
			title,
			h("div", { class: "case-more" }, more, menu),
		),
		renameButton,
		more,
		menu,
		linkMenu,
		teamRow: h("div", { class: "fact", hidden: true }),
		linkFact: h("div", { class: "fact", hidden: true }),
		pagesSection: h("section", {
			class: "pages-section",
			id: "case-pages-section",
			"aria-labelledby": "case-sites-heading",
			hidden: true,
		}),
		// "Site" or "Sites": the section's name, not a control (DEC-067). Out
		// of sight: a site's own heading says what it is ("sitegloss.dev 3 pages").
		sitesHeading: h(
			"h2",
			{ id: "case-sites-heading", class: "visually-hidden" },
			"Site",
		),
		groups: [],
		groupsBox: h("div", { class: "site-groups", id: "case-pages" }),
		groupSeq: 0,
		siteGroups: [],
		front: undefined,
		pageRow: h("div", { class: "fact" }),
		siteRow: h("div", { class: "fact", id: "case-site", hidden: true }),
		siteLabel: h("dt", {}, "Site"),
		siteText: h("dd", {}),
		rename: h(
			"div",
			{ class: "rename", id: "rename", hidden: true },
			renameField,
			h(
				"div",
				{ class: "row" },
				renameSave,
				h(
					"button",
					{
						type: "button",
						class: "small",
						id: "rename-cancel",
						onclick: () => actions.cancelRename(),
					},
					"Cancel",
				),
			),
			renameHint,
		),
		renameField,
		renameSave,
		renameHint,
		renameOpen: false,
		meta: h("p", { class: "case-meta" }, page, about),
		pagesKey: "",
		hintSeq: 0,
		team: h(
			"p",
			{ class: "meta case-team", id: "case-team", hidden: true },
			teamText,
			share,
		),
		teamText,
		share,
		linkRow: h(
			"div",
			{ class: "case-link", id: "case-link" },
			linkOpen,
			linkEdit,
			linkForm,
		),
		linkOpen,
		linkEdit,
		linkForm,
		linkField,
		linkHint,
		linkFormOpen: false,
		page,
		about,
		madeAt,
		madeOn,
		// Holds the status block (#case-status), drawn in renderCase. It sits
		// in the marks' section, under its heading: the chips filter that list.
		status: h("div", { class: "case-status" }),
		statusKey: "",
		size: h(
			"p",
			{ class: "meta size", id: "case-size", hidden: true },
			sizeText,
			h(
				"button",
				{
					type: "button",
					class: "small",
					id: "match-size",
					title:
						"Resize the browser window so this tab is as large as it was when the marks were made",
					onclick: () => actions.matchSize(created.current),
				},
				"Match size",
			),
		),
		sizeText,
		origin: h("p", { class: "hint", id: "case-origin", hidden: true }),
		access: accessNotice("case-access", () => actions),
		noneFound: h("p", {
			class: "hint none-here",
			id: "none-found",
			role: "status",
			hidden: true,
		}),
		tabLine: h("p", { class: "tab-line", id: "tab-line", hidden: true }),
		// A button with an edge, not a link: it was overlooked (the owner). It
		// sits in the marks' bar: the marks are what it shows.
		loadButton: h("button", {
			type: "button",
			class: "small",
			id: "load-case",
			onclick: () =>
				created.loadedHere
					? actions.hideFromTab(created.current)
					: actions.loadOntoTab(created.current),
		}),
		loadedHere: false,
		addMarks: h(
			"button",
			{
				type: "button",
				id: "add-marks",
				class: "primary",
				onclick: () =>
					created.adding
						? actions.doneAdding(created.current)
						: actions.addMarks(created.current),
			},
			...withIcon("add", "Add marks"),
		),
		adding: false,
		leaving: h("p", {
			class: "hint",
			id: "leave-hint",
			role: "status",
			hidden: true,
		}),
		deleteButton: h("button", {
			type: "button",
			class: "danger",
			id: "delete-case",
			onclick: () => actions.deleteCase(created.current),
		}),
		closeButton: h("button", {
			type: "button",
			id: "close-case",
			onclick: () =>
				actions.setCaseClosed(
					created.current.id,
					created.current.closed === undefined,
				),
		}),
		closedLine: h("p", {
			class: "meta closed-line",
			id: "case-closed",
			hidden: true,
		}),
		next: nextStepParts(),
		thread: h("section"),
		summaryBy: h("p", { class: "meta", id: "summary-by", hidden: true }),
		saved: h("div", { id: "export-saved", hidden: true }),
		hint: h("p", {
			class: "hint",
			id: "case-hint",
			role: "status",
			hidden: true,
		}),
		verdict,
		verdictStatus,
		saveVerdict: h(
			"button",
			{
				type: "button",
				class: "small strong",
				id: "save-verdict",
				hidden: true,
				onclick: () => actions.saveVerdict(c.id, verdict.value),
			},
			"Save summary",
		),
		summaryAdd: h(
			"button",
			{
				type: "button",
				class: "link summary-add",
				id: "summary-add",
				"aria-expanded": "false",
				"aria-controls": "summary-body",
				title:
					"What should change, as agreed. Whoever loads this case sees it first.",
				onclick: () => {
					created.summaryOpen = true;
					showSummary(created);
					verdict.focus();
				},
			},
			...withIcon("add", "Summary for the developer"),
		),
		summaryBody: h("div", { class: "verdict-body", id: "summary-body" }),
		summaryOpen: false,
		marks: h("section"),
		marksKey: "",
		pickedAt: undefined,
		shots: h("section"),
		shotsKey: "",
		accessPointer: h("p", {
			class: "visually-hidden",
			id: "case-access-pointer",
			hidden: true,
		}),
		dock: h("div", {
			class: "case-dock",
			id: "case-dock",
			// The scroll hold lends its room above the bar (DEC-063).
			"data-room-before": "",
			role: "toolbar",
			"aria-label": "Marks on this tab",
		}),
	};
	created.dock.append(created.addMarks, created.loadButton, created.access.el);
	// The menu holds Rename, the link, Export and Delete case (DEC-061).
	menu.append(renameButton, linkMenu, exportItem, created.deleteButton);
	created.deleteButton.setAttribute("role", "menuitem");
	created.teamRow.append(h("dt", {}, "Team"), h("dd", {}, created.team));
	created.pageRow.append(h("dt", {}, "Page"), h("dd", {}, created.meta));
	created.siteRow.append(created.siteLabel, created.siteText);
	created.linkFact.append(h("dt", {}, "Link"), h("dd", {}, created.linkRow));
	created.pagesSection.append(created.sitesHeading, created.groupsBox);
	const fact = (label: string, ...value: (Node | string)[]) =>
		h("div", { class: "fact" }, h("dt", {}, label), h("dd", {}, ...value));
	// The case's own bar: its title and its menu stay in view under the top
	// bar while the case scrolls, as the marks' heading does under it (the
	// owner). Not while it is renamed: the form is as high as it needs.
	const caseBar = h(
		"div",
		{ class: "case-bar", id: "case-bar" },
		created.titleRow,
		created.rename,
	);
	created.summaryBody.append(
		h(
			"div",
			{ class: "verdict-head" },
			h("label", { for: "verdict" }, "Summary for the developer"),
			verdictStatus,
			created.saveVerdict,
		),
		h(
			"p",
			{ class: "meta field-help", id: "verdict-help" },
			"What should change, as agreed. Whoever loads this case sees it first.",
		),
		verdict,
		created.summaryBy,
	);
	// The head under the title: what comes next, then only what the case
	// has (the owner: "a lot of things before the actual marks start").
	const header = h(
		"section",
		{ class: "case-header" },
		created.closedLine,
		created.next.el,
		created.leaving,
		created.saved,
		// A case's several pages (DEC-065, DEC-067): each site a heading
		// that opens and closes its list, at the panel's full width.
		created.pagesSection,
		// What the case has of these, a label and its value per row: the
		// one page of a case that has one; its link, once it has one ("Add
		// a link…" is in the menu); "On this device only" beside a team.
		h(
			"dl",
			{ class: "case-facts", id: "case-facts" },
			created.pageRow,
			created.linkFact,
			created.teamRow,
		),
		created.origin,
		// What the whole case comes to: the case's, not a mark's. Stored as
		// verdict, its name before (DEC-019). One line while there is none.
		h("div", { class: "verdict" }, created.summaryAdd, created.summaryBody),
	);
	// What the tab in front shows of the case (DEC-022, DEC-023): under the
	// head, where the marks start, so the head does not move with the tab.
	const thisTab = h(
		"section",
		{ class: "this-tab", id: "this-tab" },
		created.noneFound,
		created.tabLine,
		created.hint,
		created.size,
	);
	caseView.replaceChildren(
		caseBar,
		header,
		created.accessPointer,
		thisTab,
		created.marks,
		created.thread,
		created.shots,
		// What is true of the case from its start, last: where and when it
		// was made (the size shows again above the marks while the tab's
		// differs). Closing files the case away: at the end; Delete case is
		// in the menu.
		h(
			"section",
			{ class: "case-footer", "aria-label": "About this case" },
			h(
				"dl",
				{ class: "case-facts case-about", id: "case-about" },
				created.siteRow,
				fact("Made at", h("span", {}, created.madeAt, ", ", created.madeOn)),
			),
			created.closeButton,
		),
		// Always in reach while a case is open (DEC-063): adding marks, and
		// the marks shown or not on the tab. Sticky at the panel's bottom, it
		// rests after the content, so it never covers the last row. On a tab
		// without access, why, in their place (DEC-076).
		created.dock,
	);
	return created;
}

/**
 * What comes next on the case (DEC-069). Its buttons are the actions of the
 * tool bar's Add marks, the Team row's Share, the menu's Export and the
 * footer's Close case, and are off when those are, for the same reason.
 */
function renderStep(
	state: PanelState,
	p: CaseParts,
	c: Case,
	mayClose: boolean,
	actions: Actions,
): void {
	const me = state.cloud.account?.userId;
	const members = state.cloud.members;
	// Who may change the case may assign it, when the team's members are known.
	const mayAssign =
		members !== undefined &&
		members.length > 0 &&
		(teamOf(state.cloud)?.permissions.includes("case:update") ?? false);
	const next = nextStep(c, whereIs(state.cloud, c), {
		adding: p.adding,
		mayClose,
		...(me === undefined ? {} : { me }),
		mayAssign,
		mayVerify: teamOf(state.cloud)?.permissions.includes("mark:update") ?? true,
		reporterHere: reporterHere(c, members),
	});
	// Not there where the tool bar's is not: a tab without access (DEC-076).
	const step =
		next && p.addMarks.hidden
			? { ...next, actions: next.actions.filter((a) => a !== "add-marks") }
			: next;
	const off: Partial<Record<StepAction, string>> = {};
	if (p.addMarks.disabled) off["add-marks"] = p.addMarks.title;
	// What a copy did, while the step still offers that copy.
	const copied =
		state.copied?.caseId === c.id && step?.actions.includes(state.copied.what)
			? state.copied.text
			: undefined;
	renderNextStep(
		p.next,
		step,
		copied,
		(action) => {
			const now = p.current;
			switch (action) {
				case "add-marks":
					return actions.addMarks(now);
				case "share":
					return actions.cloudShare(now.id);
				case "export":
					return actions.exportCase(now);
				case "copy-link":
					return actions.copyCaseLink(now);
				case "copy-ai":
					return actions.copyForAiApp(now);
				case "verify":
					return actions.startVerifying(now);
				case "close":
					return actions.setCaseClosed(now.id, true);
				case "assign":
					return;
			}
		},
		off,
		mayAssign && me !== undefined
			? {
					members,
					current: assigneeOf(c) ?? null,
					me,
					pick: (to) => actions.assignCase(p.current.id, to),
				}
			: undefined,
	);
}

/** One line on what the tab in front shows of the case, where there is one. */
function tabLineText(
	state: PanelState,
	c: Case,
	adding: boolean,
): string | undefined {
	if (adding)
		return "Adding marks: draw on the page. Each mark is saved into this case when its comment is done.";
	const tabId = state.tab?.id;
	if (tabId === undefined) return undefined;
	if (state.hiddenOn.has(tabId)) return "Marks are hidden on this tab.";
	if (
		state.drawing === tabId &&
		!(state.loaded?.caseId === c.id && state.loaded.tabId === tabId)
	)
		return "Looking for the marks on this tab…";
	return undefined;
}

/** Under the action row while "← All cases" waits for the toolbar (DEC-023). */
export function leavingText(
	leaving: PanelState["leaving"],
): string | undefined {
	if (leaving === undefined) return undefined;
	if (leaving.phase === "finishing") return "Finishing the marks…";
	const one = leaving.left === 1;
	return `${leaving.left} mark${one ? " is" : "s are"} not in the case yet; the toolbar on the page says why. Click All cases again to leave without ${one ? "it" : "them"}.`;
}

/**
 * Under This page when a case was deleted elsewhere while its toolbar was
 * still adding to it, and marks not in it yet went with it (DEC-026).
 */
export function lostMarksText(title: string | undefined, lost: number): string {
	const one = lost === 1;
	const what = title === undefined ? "The case" : `“${title}”`;
	return `${what} was deleted, and ${lost} mark${one ? "" : "s"} not in it yet ${one ? "is" : "are"} gone with it.`;
}

/** Draw the title, or the rename form in its place (DEC-026). */
function renderTitle(state: PanelState, p: CaseParts, c: Case): void {
	p.title.textContent = c.title;
	// One line in the case's bar: the whole of a long title is its tooltip.
	p.title.title = c.title;
	const renaming = state.renaming?.caseId === c.id ? state.renaming : undefined;
	p.titleRow.hidden = renaming !== undefined;
	p.rename.hidden = renaming === undefined;
	if (renaming === undefined) {
		if (!p.renameOpen) return;
		p.renameOpen = false;
		// The keyboard is back where the rename started.
		const at = document.activeElement;
		if (at === null || at === document.body || p.rename.contains(at))
			queueMicrotask(() => p.more.focus());
		return;
	}
	if (p.renameField.value !== renaming.text)
		p.renameField.value = renaming.text;
	// Nothing that shows is no title (cleanTitle, as the save has it).
	const empty = cleanTitle(renaming.text) === "";
	p.renameSave.disabled = empty;
	p.renameField.setAttribute("aria-invalid", String(empty));
	setHint(p.renameHint, empty ? "A case needs a title." : renaming.error);
	if (p.renameOpen) return;
	p.renameOpen = true;
	queueMicrotask(() => {
		p.renameField.focus();
		p.renameField.select();
	});
}

/**
 * Draw the case's link and its Edit, or Add a link where it has none; the
 * link's form in their place while it is edited (DEC-028).
 */
function renderLink(state: PanelState, p: CaseParts, c: Case): void {
	const editing = state.linking?.caseId === c.id ? state.linking : undefined;
	const link = c.link;
	// The row is there once the case has a link, and while one is typed:
	// "Add a link…" is in the case's menu.
	p.linkFact.hidden = editing === undefined && link === undefined;
	p.linkOpen.hidden = editing !== undefined || link === undefined;
	if (link === undefined) {
		p.linkOpen.removeAttribute("href");
		p.linkOpen.removeAttribute("title");
		p.linkOpen.textContent = "";
	} else {
		if (p.linkOpen.getAttribute("href") !== link)
			p.linkOpen.setAttribute("href", link);
		p.linkOpen.title = link;
		p.linkOpen.textContent = shortUrl(link);
	}
	p.linkEdit.hidden = editing !== undefined || link === undefined;
	p.linkEdit.textContent = "Edit";
	p.linkEdit.setAttribute("aria-label", "Edit this case's link");
	p.linkForm.hidden = editing === undefined;
	if (editing === undefined) {
		if (!p.linkFormOpen) return;
		p.linkFormOpen = false;
		// The keyboard is back where the edit started: the link's Edit, or
		// the menu that has "Add a link…".
		const at = document.activeElement;
		if (at === null || at === document.body || p.linkForm.contains(at))
			queueMicrotask(() => (p.linkEdit.hidden ? p.more : p.linkEdit).focus());
		return;
	}
	if (p.linkField.value !== editing.text) p.linkField.value = editing.text;
	p.linkField.setAttribute("aria-invalid", String(editing.error !== undefined));
	setHint(p.linkHint, editing.error);
	if (p.linkFormOpen) return;
	p.linkFormOpen = true;
	queueMicrotask(() => {
		p.linkField.focus();
		p.linkField.select();
	});
}

// --- a mark's status and its actions ---------------------------------------

/** "3 open", "1 open, 2 to verify", "no marks": for the import prompt. */
function marksText(c: Case): string {
	const n = caseCounts(c);
	const parts = STATUS_GROUPS.filter((g) => n[g] > 0).map(
		(g) => `${n[g]} ${GROUP_LABEL[g].toLowerCase()}`,
	);
	return parts.length > 0 ? parts.join(", ") : "no marks";
}

/**
 * How far the case has come, as a bar: open, to verify, verified, dismissed
 * (DEC-023). The chips or the counts beside it say it in words: the bar is
 * only a picture. A span: it also sits inside a case's button in the list.
 */
function statusBar(c: Case): HTMLElement | null {
	if (c.marks.length === 0) return null;
	const n = caseCounts(c);
	return h(
		"span",
		{ class: "progress", "aria-hidden": "true" },
		...STATUS_GROUPS.filter((g) => n[g] > 0).map((g) =>
			h("span", { "data-kind": g, style: `flex-grow: ${n[g]}` }),
		),
	);
}

/** A chip's sign, beside its word: told apart without colour. */
const CHIP_SIGN: Record<StatusGroup, string> = {
	open: "●",
	toVerify: "◐",
	verified: "✓",
	dismissed: "–",
};

/**
 * The case's summary (DEC-023): the bar, and under it a chip per status with
 * marks, the legend and the filter in one. A click shows only those marks,
 * another all again.
 */
function statusBlock(
	c: Case,
	filter: StatusGroup | undefined,
	actions: Actions,
	/** The page the list is filtered by: the counts are its marks'. */
	page?: CasePage,
): HTMLElement | null {
	if (c.marks.length === 0) return null;
	const n = caseCounts(c);
	return h(
		"div",
		{ class: "status-block", id: "case-status" },
		statusBar(c),
		h(
			"div",
			{ class: "chips", role: "group", "aria-label": "Show marks by status" },
			...STATUS_GROUPS.filter((g) => n[g] > 0).map((g) =>
				h(
					"button",
					{
						type: "button",
						class: "chip",
						"data-group": g,
						"aria-pressed": String(filter === g),
						title:
							filter === g
								? "Show all marks again"
								: `Show only the marks that are ${GROUP_LABEL[g].toLowerCase()}`,
						onclick: () =>
							actions.filterMarks(c.id, filter === g ? undefined : g),
					},
					h("span", { class: "sign", "aria-hidden": "true" }, CHIP_SIGN[g]),
					` ${GROUP_LABEL[g]} `,
					h("span", { class: "count" }, String(n[g])),
				),
			),
		),
		n.open + n.toVerify === 0
			? h(
					"p",
					{ class: "meta all-done" },
					h("span", { class: "sign", "aria-hidden": "true" }, "✓"),
					page === undefined
						? " All marks are verified or dismissed."
						: ` All marks on ${pageLabel(page)} are verified or dismissed.`,
				)
			: null,
	);
}

/** "13 Nov, 11:00": a mark's history is read within days. */
function historyTime(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? iso
		: date.toLocaleString(undefined, {
				day: "numeric",
				month: "short",
				hour: "2-digit",
				minute: "2-digit",
			});
}

interface HistoryLine {
	kind: MarkStatus | "reopened";
	label: string;
	at: string;
	app: FindingApp | undefined;
	/** Who did it, in a case synced with a team (DEC-039). */
	user: UserRef | undefined;
	note: string | undefined;
	/** Came in from a file: who and when is what the file says. */
	imported: boolean;
}

/** A resolution as history: how it was settled, then its verification. */
function resolutionHistory(r: Resolution): HistoryLine[] {
	return [
		{
			kind: r.kind,
			label: RESOLUTION_LABEL[r.kind],
			at: r.at,
			app: r.app,
			user: r.user,
			note: r.note,
			imported: r.imported === true,
		},
		...(r.verified
			? [
					{
						kind: "verified" as const,
						label: "Verified",
						at: r.verified.at,
						app: r.verified.app,
						user: r.verified.user,
						note: undefined,
						imported: r.verified.imported === true,
					},
				]
			: []),
	];
}

/**
 * ` by Dana`, ` by Dana via Claude`, ` by Claude (claude.ai)`:
 * who did something, the person as the team's server wrote it down (DEC-039).
 */
export function byWhom(
	app: FindingApp | undefined,
	user: UserRef | undefined,
): string {
	// The person, through the app (DEC-046): "by Dana via Claude".
	if (app && user) return ` by ${byline(user, app)}`;
	if (app) return ` by ${appLabel(app)}`;
	return user ? ` by ${user.name}` : "";
}

/** What became of the mark, oldest first: each reopen, then how it is settled now. */
function historyList(a: Mark): HTMLElement | null {
	const lines: HistoryLine[] = [];
	for (const r of a.reopens ?? [])
		lines.push(...resolutionHistory(r.was), {
			kind: "reopened",
			label: "Reopened",
			at: r.at,
			app: r.app,
			user: r.user,
			note: r.note,
			imported: r.imported === true,
		});
	if (a.resolution) lines.push(...resolutionHistory(a.resolution));
	if (lines.length === 0) return null;
	return h(
		"ol",
		{ class: "history", "aria-label": `History of mark ${a.number}` },
		...lines.map((l) =>
			h(
				"li",
				{ "data-kind": l.kind },
				h("span", { class: "kind" }, l.label),
				` ${historyTime(l.at)}${byWhom(l.app, l.user)}${l.imported ? ", as the file says" : ""}`,
				l.note ? h("span", { class: "note" }, ` · ${l.note}`) : null,
			),
		),
	);
}

/** A small button of a mark; `strong`: the one its status calls for. */
function markButton(
	label: string,
	action: string,
	title: string | undefined,
	onclick: () => void,
	strong = false,
	glyph?: IconName,
): HTMLButtonElement {
	return h(
		"button",
		{
			type: "button",
			class: strong ? "small strong" : "small",
			"data-mark-action": action,
			title,
			onclick,
		},
		glyph === undefined ? null : icon(glyph),
		label,
	);
}

const VERIFIED_TITLE = "The fix holds on the page you checked";
const REOPEN_TITLE =
	"Open the mark again, with a note on what is still wrong; how it was settled stays in its history";

/**
 * A mark just verified (DEC-061): its row closes, and once it is drawn as
 * verified the focus goes to the next mark waiting to be verified, else to
 * the closed row's head. Only for a while, and only where the focus still
 * is in the list: a Verify that was not saved, and a change of that mark
 * minutes later, take no focus from a field (DEC-064's review).
 */
let verifiedNow:
	| {
			caseId: string;
			markId: string;
			at: number;
			/** The next mark to verify as the list stood at the click: the verified one may leave a filtered list. */
			next: string | undefined;
	  }
	| undefined;
/** How long a Verify waits for its row to be drawn as verified. */
export const VERIFIED_WAIT_MS = 5000;

/**
 * Verify, and the same press as "Verify anyway" on a mark of another page
 * (DEC-079): quiet, for a mark checked somewhere the panel cannot tell.
 */
const verifyButton = (c: Case, a: Mark, actions: Actions, anyway = false) =>
	markButton(
		anyway ? "Verify anyway" : "Verify",
		anyway ? "verify-anyway" : "verify",
		anyway
			? `You checked it somewhere else: set mark ${a.number} verified`
			: VERIFIED_TITLE,
		() => {
			const undo = verifying(c.id, a.id);
			const order = rowOrder(document, "section.marks li.mark");
			const next = afterVerify(order, a.id)?.markId;
			verifiedNow = {
				caseId: c.id,
				markId: a.id,
				at: Date.now(),
				next: next === a.id ? undefined : next,
			};
			// Not saved: the row comes back as it was; the hint says why (the
			// store's own error path). No success is faked.
			void Promise.resolve(actions.verifyMark(c, a)).then(
				(why) => {
					if (why !== undefined) undo();
					else undo.done();
				},
				() => undo(),
			);
		},
		!anyway,
		"check",
	);

/** What a mark to verify of another page offers, said in its open row (DEC-079). */
export const AWAY_HINT =
	"Open its page to verify it there, or verify anyway if you checked it elsewhere.";

/**
 * In place of Verify on a mark of another page (DEC-079): its page, opened
 * in this tab with the mark shown there; Verify comes once the tab is there.
 * No icon (DEC-078): with Show's viewfinder its row took a line more at 340 px.
 */
function verifyThere(
	c: Case,
	a: Mark,
	tabUrl: string | undefined,
	actions: Actions,
): HTMLElement | null {
	const to = elsewhereTarget(c, a, tabUrl);
	if (to === undefined) return null;
	return h(
		"button",
		{
			type: "button",
			class: "small strong",
			"data-mark-action": "open-page",
			"aria-label": `Open ${to.name} to verify mark ${a.number} there`,
			title: `Open ${to.address} in this tab and show mark ${a.number} there\n${AWAY_HINT}`,
			onclick: () => actions.openMarkPage(c, a, to.where),
		},
		"Open its page to verify",
	);
}

/** The motion of a Verify, in order: the row collapses, then the next opens (expands), its highlight holds, then fades. */
export const COLLAPSE_MS = 300;
const EXPAND_MS = 300;
const RESTORE_MS = 200;
const HOLD_MS = 700;
const FADE_MS = 1200;
/** How long the cue on the row a Verify opened stays on it. */
export const ARRIVED_MS = HOLD_MS + FADE_MS + 50;

/** The row a Verify closes, while it collapses; carried across a redraw. */
let closing:
	| { caseId: string; markId: string; at: number; h: number }
	| undefined;
let closingTimer: ReturnType<typeof setTimeout> | undefined;
/** What the answer decided, held until the collapse is done: the next row to open, or the line for "none". */
let pending:
	| {
			caseId: string;
			verified: string;
			/** The row whose head the redraw gave the focus when the verified row left the list. */
			movedTo: string | undefined;
			to: string | undefined;
			number: number | undefined;
			say: boolean;
			opensAt: number;
	  }
	| undefined;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
/** The row the last Verify opened, while its cue runs. */
let arrived:
	| { caseId: string; markId: string; at: number; h: number }
	| undefined;
let arrivedTimer: ReturnType<typeof setTimeout> | undefined;
/** The scroll after the expansion, and the end of the expansion's clipping. */
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
let expandTimer: ReturnType<typeof setTimeout> | undefined;

const stillMotion = () =>
	globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** The cue and the line after a Verify end with the case view (no replay on coming back). */
function clearCue(): void {
	if (closing) openMarks.delete(`${closing.caseId}:${closing.markId}`);
	arrived = undefined;
	clearTimeout(scrollTimer);
	clearTimeout(expandTimer);
	verifyLine = undefined;
	pending = undefined;
	closing = undefined;
	clearTimeout(arrivedTimer);
	clearTimeout(pendingTimer);
	clearTimeout(closingTimer);
}

/** The cue's end: the marker off the row that has it. */
function endCue(): void {
	clearTimeout(arrivedTimer);
	clearTimeout(scrollTimer);
	clearTimeout(expandTimer);
	const k = arrived;
	arrived = undefined;
	const row = k && parts?.current.id === k.caseId ? rowOf(k.markId) : undefined;
	row?.removeAttribute("data-arrived");
	row?.removeAttribute("data-expanding");
	row?.style.removeProperty("--cue-elapsed");
}

/** The cue on a row: `data-arrived` for what is left of `ARRIVED_MS`; the style sheet starts its animations `elapsed` in. */
function cueRow(row: HTMLElement, elapsed: number, h: number): void {
	row.setAttribute("data-arrived", "");
	row.style.setProperty("--cue-elapsed", `-${Math.round(elapsed)}ms`);
	row.style.setProperty("--open-h", `${h}px`);
	// Clipped only while the body grows: focus rings must show after.
	clearTimeout(expandTimer);
	if (!stillMotion() && elapsed < EXPAND_MS) {
		row.setAttribute("data-expanding", "");
		expandTimer = setTimeout(
			() => row.removeAttribute("data-expanding"),
			EXPAND_MS - elapsed,
		);
	}
	clearTimeout(arrivedTimer);
	arrivedTimer = setTimeout(() => {
		row.removeAttribute("data-arrived");
		row.style.removeProperty("--cue-elapsed");
	}, ARRIVED_MS - elapsed);
}

/** A row's collapse, `elapsed` ms in (a row drawn anew continues from there). */
function collapseRow(
	caseId: string,
	row: HTMLElement,
	h: number,
	elapsed: number,
): void {
	if (row.dataset["mark"] === undefined) return;
	showOpen(row);
	// A row drawn anew is measured again: its body may differ from the press.
	if (elapsed > 0) {
		const now = row.querySelector<HTMLElement>(".body")?.offsetHeight;
		if (now) {
			h = now;
			if (closing?.caseId === caseId && closing.markId === row.dataset["mark"])
				closing.h = now;
		}
	}
	row.setAttribute("data-collapsing", "");
	row.style.setProperty("--collapse-h", `${h}px`);
	row.style.setProperty("--cue-elapsed", `-${Math.round(elapsed)}ms`);
}

/** The collapse is done: the row closes for good. */
function finishClosing(): void {
	clearTimeout(closingTimer);
	const k = closing;
	closing = undefined;
	if (!k) return;
	// Closed for good, whether or not its row is on screen (a filter, another case).
	openMarks.delete(`${k.caseId}:${k.markId}`);
	const row = parts?.current.id === k.caseId ? rowOf(k.markId) : undefined;
	if (!row) return;
	row.removeAttribute("data-collapsing");
	row.style.removeProperty("--collapse-h");
	row.style.removeProperty("--cue-elapsed");
	setOpen(k.caseId, row, false);
}

/**
 * The answer's decision, once the collapse is done (at once when it is):
 * open the next row, with its cue, scroll and focus; or, with none left, the
 * focus and the line. Rows are found as the list is drawn now.
 */
function runPending(): void {
	const k = pending;
	if (!k) return;
	clearTimeout(pendingTimer);
	const wait = k.opensAt - Date.now();
	if (wait > 0) {
		pendingTimer = setTimeout(runPending, wait);
		return;
	}
	pending = undefined;
	const p = parts;
	if (!p || p.current.id !== k.caseId) return;
	const marks = p.marks;
	// Only a focus the Verify left behind is moved: nowhere, in its row, or
	// on the head the redraw gave it when the row left a filtered list.
	const mine =
		focusLeftBy(marks, k.verified) === true ||
		(k.movedTo !== undefined &&
			document.activeElement?.classList.contains("mark-toggle") === true &&
			focusLeftBy(marks, undefined) === k.movedTo);
	if (!mine) return;
	const head = (id: string) =>
		marks.querySelector<HTMLElement>(
			`li.mark[data-mark="${quoted(id)}"] .mark-toggle`,
		);
	const found = k.to === undefined ? undefined : rowOf(k.to);
	// Not a row that is gone, or was verified meanwhile: then nothing opens.
	const row =
		found?.dataset["status"] === "fixed" &&
		!found.hasAttribute("data-verifying")
			? found
			: undefined;
	if (row && k.to !== undefined) {
		setOpen(k.caseId, row, true);
		// "This one", as for a pin clicked on the page.
		row.setAttribute("data-picked", "");
		releaseHeld();
		const h = row.querySelector<HTMLElement>(".body")?.offsetHeight ?? 0;
		arrived = { caseId: k.caseId, markId: k.to, at: Date.now(), h };
		cueRow(row, 0, h);
		scrollToOpened(row);
		// The row has grown by then: the scroll follows.
		if (!stillMotion()) {
			const to = k.to;
			clearTimeout(scrollTimer);
			scrollTimer = setTimeout(() => {
				const r = parts?.current.id === k.caseId ? rowOf(to) : undefined;
				if (r?.hasAttribute("data-arrived")) scrollToOpened(r);
			}, EXPAND_MS + 20);
		}
		// Its head, not its Verify: a second Enter must not verify it unseen.
		head(k.to)?.focus({ preventScroll: true });
		// And on the page, as its Show would (owner, 25 November): only where
		// the marks are drawn here. Never another page, nor drawing marks a
		// Hide took off ("they stay off on this tab until you show them").
		// A row away by now (the tab went on since it was drawn) is not.
		if (!row.hasAttribute("data-away")) showsHere.get(row)?.();
		sayAfterVerify(
			p.hint,
			k.caseId,
			row.hasAttribute("data-away")
				? `Mark ${k.number ?? ""} opened: it is on another page; open its page to verify it.`
				: `Mark ${k.number ?? ""} opened, to verify.`,
		);
	} else {
		// Nothing waits: the verified row's head; where a filter has taken that
		// row away, the list's first control, not nowhere.
		(
			head(k.verified) ??
			marks.querySelector<HTMLElement>("button:not([disabled])")
		)?.focus({ preventScroll: true });
		if (k.say)
			sayAfterVerify(p.hint, k.caseId, "That was the last mark to verify.");
	}
}

/**
 * Where the focus is, for a Verify of `markId` in `list`: `true` when it is
 * nowhere or in that mark's row (left there by the Verify); else the mark id
 * of the row of `list` it is in; else `false` (a field or button elsewhere).
 */
function focusLeftBy(
	list: HTMLElement,
	markId: string | undefined,
): true | string | false {
	const at = document.activeElement;
	if (at === null || at === document.body) return true;
	const row = at.closest<HTMLElement>("li.mark");
	const id =
		row !== null && list.contains(row) ? row.dataset["mark"] : undefined;
	if (id === undefined) return false;
	return id === markId ? true : id;
}

/** A line for the status region after a Verify, said once (see the render of the hint). */
let verifyLine: { caseId: string; text: string; at: number } | undefined;
/** How long that line stays when nothing else is said. */
const VERIFY_LINE_MS = 8000;

/** Said once, now, through the status line; later renders keep it while nothing else is said. */
function sayAfterVerify(hint: HTMLElement, caseId: string, text: string): void {
	verifyLine = { caseId, text, at: Date.now() };
	setHint(hint, text, true);
	hint.classList.remove("visually-hidden");
}

const rowOf = (markId: string) =>
	document.querySelector<HTMLElement>(
		`section.marks li.mark[data-mark="${quoted(markId)}"]`,
	) ?? undefined;

/**
 * The press of a Verify, at once and before anything answers: the row shows
 * the mark as verified and closes. The returned function
 * puts the row back as it was (a Verify that was not saved).
 */
function verifying(
	caseId: string,
	markId: string,
): (() => void) & { done: () => void } {
	const key = `${caseId}:${markId}`;
	const wasOpen = openMarks.has(key);
	openMarks.delete(key);
	/** The row, only while the case on screen is the one pressed in (mark ids are per case). */
	const rowHere = () =>
		parts?.current.id === caseId ? rowOf(markId) : undefined;
	// One thing moves at a time: what the last Verify was doing is finished.
	finishClosing();
	endCue();
	const li = rowHere();
	// `data-status` stays the stored truth; the row says "verified" by its own marker.
	const pill = li?.querySelector<HTMLElement>(".pill");
	const pillText = pill?.textContent ?? "";
	li?.setAttribute("data-verifying", "");
	if (pill) pill.textContent = PILL.verified ?? "";
	const h = li?.querySelector<HTMLElement>(".body")?.offsetHeight ?? 0;
	if (li && wasOpen) {
		if (stillMotion()) setOpen(caseId, li, false);
		else {
			closing = { caseId, markId, at: Date.now(), h };
			collapseRow(caseId, li, h, 0);
			closingTimer = setTimeout(finishClosing, COLLAPSE_MS);
		}
	}
	let settled = false;
	let giveUp: ReturnType<typeof setTimeout> | undefined;
	const undo = (said?: string) => {
		if (settled) return;
		settled = true;
		clearTimeout(giveUp);
		if (closing?.markId === markId && closing.caseId === caseId) {
			clearTimeout(closingTimer);
			closing = undefined;
		}
		if (verifiedNow?.markId === markId && verifiedNow.caseId === caseId)
			verifiedNow = undefined;
		const now = rowHere();
		// Put back only a row still marked as verifying, or one the stored case
		// still has to verify: a redraw that shows it truly verified stays.
		if (
			now &&
			(now.hasAttribute("data-verifying") || now.dataset["status"] === "fixed")
		) {
			now.removeAttribute("data-verifying");
			now.removeAttribute("data-collapsing");
			now.style.removeProperty("--collapse-h");
			const pillNow = now.querySelector<HTMLElement>(".pill");
			if (pillNow) pillNow.textContent = pillText;
			if (wasOpen) {
				openMarks.add(key);
				setOpen(caseId, now, true);
				// Its own short expand, back to where it was.
				if (!stillMotion()) {
					now.setAttribute("data-restoring", "");
					now.style.setProperty("--open-h", `${h}px`);
					now.style.removeProperty("--cue-elapsed");
					setTimeout(() => now.removeAttribute("data-restoring"), RESTORE_MS);
				}
			}
			if (said !== undefined && parts) sayAfterVerify(parts.hint, caseId, said);
		}
	};
	// No answer at all: the row does not stay "verified" for good.
	giveUp = setTimeout(
		() => undo("Not saved: the Verify got no answer."),
		VERIFIED_WAIT_MS,
	);
	return Object.assign(() => undo(), {
		done: () => {
			settled = true;
			clearTimeout(giveUp);
		},
	});
}

/** A smooth scroll within about a panel's height, a jump beyond (sixty marks are not scrolled through). */
function scrollToOpened(row: HTMLElement): void {
	const r = row.getBoundingClientRect();
	const h = globalThis.innerHeight || 0;
	const away = r.top < 0 ? -r.top : r.bottom > h ? r.bottom - h : 0;
	const still =
		globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ===
		true;
	row.scrollIntoView?.({
		block: "nearest",
		behavior: !still && h > 0 && away <= h ? "smooth" : "instant",
	});
}

/**
 * Where the focus goes after a Verify: the next mark to verify, else the
 * row's head. One that can be verified on the page in front comes first (the
 * page being checked is done before another is opened, DEC-079); then one
 * of another page (`away`), whose row offers to open its page.
 */
export function afterVerify(
	order: readonly { id: string; status: string; away?: boolean }[],
	verified: string,
): { markId: string } | undefined {
	const at = order.findIndex((m) => m.id === verified);
	if (at < 0) return undefined;
	const round = [...order.slice(at + 1), ...order.slice(0, at)];
	const next =
		round.find((m) => m.status === "fixed" && m.away !== true) ??
		round.find((m) => m.status === "fixed");
	return { markId: next?.id ?? verified };
}

/** A drawn list's rows as `afterVerify` reads them. */
const rowOrder = (list: ParentNode, rows = "li.mark") =>
	[...list.querySelectorAll<HTMLElement>(rows)].map((li) => ({
		id: li.dataset["mark"] ?? "",
		status: li.dataset["status"] ?? "",
		away: li.hasAttribute("data-away"),
	}));

/**
 * The row a Verify opens next, in the list as it is drawn now: the one known at
 * the click while it still waits there (a filtered list has dropped the verified
 * mark, and nothing can be counted from it), else the next by the list. None
 * when nothing waits: the rows after the verified one first, then round to the
 * ones before it, since going through them all is what a Verify after a Verify is.
 */
export function opensAfterVerify(
	order: readonly { id: string; status: string; away?: boolean }[],
	verified: string,
	known: string | undefined,
): string | undefined {
	const kept = order.find((m) => m.id === known && m.status === "fixed")?.id;
	const to = kept ?? afterVerify(order, verified)?.markId;
	return to === verified ? undefined : to;
}

const reopenButton = (c: Case, a: Mark, actions: Actions) =>
	markButton(
		"Reopen…",
		"reopen",
		REOPEN_TITLE,
		() => actions.editMark(c, a, "reopen"),
		false,
		"reopen",
	);

/** `, and its 2 added images`; nothing for none. */
const imagesNote = (a: Mark) => {
	const n = a.images?.length ?? 0;
	return n === 0 ? "" : ` and its ${n} added image${n === 1 ? "" : "s"}`;
};

/** The buttons a mark's status calls for, the strong one first (DEC-023). */
function markActions(
	c: Case,
	a: Mark,
	armed: boolean,
	actions: Actions,
	/**
	 * A mark to verify not on the page in front (DEC-079): the address its
	 * page link goes to, and the way onto a tab whose address is not known.
	 */
	away: {
		linkTab: string | undefined;
		unread: string | undefined;
	} | null = null,
	/**
	 * The copy for an AI app: offered (`may`), and what the last one did
	 * (`said`), while that is said.
	 */
	copy: { may: boolean; said?: { ok: boolean; text: string } | undefined } = {
		may: false,
	},
): HTMLElement {
	const status = markStatus(a);
	const copied = copy.said?.ok === true;
	const row = h(
		"div",
		{ class: "mark-actions" },
		status === "open"
			? markButton(
					"Resolve…",
					"resolve",
					"Mark it fixed, verified, won't fix or can't reproduce, with a note if you like",
					() => actions.editMark(c, a, "resolve"),
					true,
				)
			: null,
		status !== "fixed"
			? null
			: away === null
				? verifyButton(c, a, actions)
				: away.unread === undefined
					? verifyThere(c, a, away.linkTab, actions)
					: null,
		status === "fixed" && away !== null
			? verifyButton(c, a, actions, true)
			: null,
		status === "open" ? null : reopenButton(c, a, actions),
		status === "open"
			? null
			: markButton(
					"Change…",
					"change",
					"Change how it was settled, or its note",
					() => actions.editMark(c, a, "resolve"),
				),
		markButton(
			"Edit comment",
			"comment",
			undefined,
			() => actions.editMark(c, a, "comment"),
			false,
			"edit",
		),
		h(
			"button",
			{
				type: "button",
				class: "small danger",
				"data-mark-action": "delete",
				title: armed
					? "Click again to delete this mark"
					: `Delete this mark and its screenshot${imagesNote(a)} (click twice); its number is not given again`,
				...(armed ? { "data-armed": true } : {}),
				onclick: () => actions.deleteMark(c, a),
			},
			...withIcon("delete", armed ? "Really delete?" : "Delete mark"),
		),
	);
	if (!copy.may) return row;
	// The web app's "Copy mark N for your AI app": after the status change,
	// before the comment's edit and Delete. Its words stay, so the row does
	// not move: the icon turns to a tick and the line under the row says it.
	row.querySelector('[data-mark-action="comment"]')?.before(
		h(
			"button",
			{
				type: "button",
				class: "small",
				"data-mark-action": "copy-ai",
				"aria-label": `Copy mark ${a.number} for your AI app`,
				title:
					"Instructions for your AI app to fix this mark: the tools it needs and what to do",
				...(copied ? { "data-copied": true } : {}),
				onclick: () => actions.copyMarkForAiApp(c, a),
			},
			...withIcon(copied ? "check" : "copy", "Copy for your AI app"),
		),
	);
	// Always there while the copy is: a status line that is filled is said.
	return h(
		"div",
		{ class: "mark-actions-box" },
		row,
		h(
			"p",
			{
				class: `meta mark-copied${copy.said ? "" : " visually-hidden"}`,
				role: "status",
				"data-mark-copied": "",
			},
			copy.said?.text ?? "",
		),
	);
}

/** The form that has had its focus: a redraw does not take it again. */
let focusedForm: string | undefined;

/** Focus a mark's form when it opens, not each time the list is drawn again. */
function focusOnOpen(form: string, field: HTMLElement): void {
	field.dataset["form"] = form;
	// Drawn again while typing in it: the new field takes over, caret and all.
	const typing = document.activeElement as HTMLInputElement | null;
	if (focusedForm === form) {
		if (typing?.dataset["form"] !== form) return;
		const at = typing.selectionStart;
		queueMicrotask(() => {
			field.focus();
			if (at !== null && "setSelectionRange" in field)
				(field as HTMLInputElement).setSelectionRange(at, at);
		});
		return;
	}
	focusedForm = form;
	queueMicrotask(() => {
		// A field out of sight is scrolled into view by its focus: the row
		// held after the click that opened the form lets go, or the two pull
		// against each other and a press on Save lands on what moved (DEC-061).
		const r = field.getBoundingClientRect();
		if (r.top < 0 || r.bottom > document.documentElement.clientHeight)
			releaseHeld();
		field.focus();
	});
}

/** The four ways Resolve… and Change… settle a mark. */
const CHOICE_LABEL: Record<ResolveChoice, string> = {
	fixed: "Fixed, to verify",
	verified: "Fixed and verified",
	wontfix: RESOLUTION_LABEL.wontfix,
	cantreproduce: RESOLUTION_LABEL.cantreproduce,
};

function resolveForm(
	c: Case,
	a: Mark,
	kind: ResolveChoice,
	note: string,
	actions: Actions,
): HTMLElement {
	const name = `resolution-${a.id}`;
	const noteId = `resolution-note-${a.id}`;
	const noteField: HTMLInputElement = h("input", {
		type: "text",
		class: "note",
		id: noteId,
		maxlength: String(MAX_COMMENT),
		value: note,
		oninput: () => actions.typeMark({ text: noteField.value }),
		onkeydown: (e) => {
			const key = (e as KeyboardEvent).key;
			if (key === "Enter") submit();
			if (key === "Escape") actions.cancelMarkEdit();
		},
	});
	const chosen = () =>
		(form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)
			?.value ?? kind) as ResolveChoice;
	const submit = () => actions.resolveMark(c, a, chosen(), noteField.value);
	const form = h(
		"div",
		{ class: "mark-form", "data-form": "resolve" },
		h(
			"fieldset",
			{},
			h("legend", {}, `Mark ${a.number} is`),
			...RESOLVE_CHOICES.map((k) =>
				h(
					"label",
					{ class: "choice" },
					h("input", {
						type: "radio",
						name,
						value: k,
						checked: k === kind,
						onchange: () => actions.typeMark({ kind: k }),
					}),
					CHOICE_LABEL[k],
				),
			),
		),
		// A label that shows, not a placeholder in its place (DEC-060).
		h(
			"label",
			{ class: "note-label", for: noteId },
			"Note (optional): what was done, or why",
		),
		noteField,
		h(
			"div",
			{ class: "row" },
			h(
				"button",
				{
					type: "button",
					class: "strong small",
					"data-mark-action": "resolve-done",
					onclick: submit,
				},
				"Save",
			),
			h(
				"button",
				{
					type: "button",
					class: "small",
					onclick: () => actions.cancelMarkEdit(),
				},
				"Cancel",
			),
		),
	);
	focusOnOpen(`${a.id}:resolve`, noteField);
	return form;
}

function commentForm(
	c: Case,
	a: Mark,
	text: string,
	actions: Actions,
): HTMLElement {
	const field: HTMLTextAreaElement = h(
		"textarea",
		{
			maxlength: String(MAX_COMMENT),
			"aria-label": `Comment of mark ${a.number}`,
			oninput: () => actions.typeMark({ text: field.value }),
			onkeydown: (e) => {
				const k = e as KeyboardEvent;
				if (k.key === "Enter" && (k.metaKey || k.ctrlKey)) save();
				if (k.key === "Escape") actions.cancelMarkEdit();
			},
		},
		text,
	);
	const save = () => actions.saveComment(c, a, field.value);
	focusOnOpen(`${a.id}:comment`, field);
	return h(
		"div",
		{ class: "mark-form", "data-form": "comment" },
		field,
		h(
			"div",
			{ class: "row" },
			h(
				"button",
				{
					type: "button",
					class: "strong small",
					"data-mark-action": "comment-done",
					onclick: save,
				},
				"Save",
			),
			h(
				"button",
				{
					type: "button",
					class: "small",
					onclick: () => actions.cancelMarkEdit(),
				},
				"Cancel",
			),
		),
	);
}

/** Reopen…: what is still wrong, which the developer reads first (DEC-023). */
function reopenForm(
	c: Case,
	a: Mark,
	text: string,
	actions: Actions,
): HTMLElement {
	const empty = (value: string) => value.trim() === "";
	const done: HTMLButtonElement = h(
		"button",
		{
			type: "button",
			class: "strong small",
			"data-mark-action": "reopen-done",
			title: "Open the mark again with this note",
			disabled: empty(text),
			onclick: () => submit(),
		},
		"Reopen",
	);
	const field: HTMLTextAreaElement = h(
		"textarea",
		{
			maxlength: String(MAX_REOPEN_NOTE),
			"aria-label": `What is still wrong with mark ${a.number}`,
			"aria-describedby": `reopen-help-${a.id}`,
			oninput: () => {
				// No redraw while typing: the button follows the text itself.
				done.disabled = empty(field.value);
				actions.typeMark({ text: field.value });
			},
			onkeydown: (e) => {
				const k = e as KeyboardEvent;
				if (k.key === "Enter" && (k.metaKey || k.ctrlKey)) submit();
				if (k.key === "Escape") actions.cancelMarkEdit();
			},
		},
		text,
	);
	const submit = () => {
		if (!empty(field.value)) actions.reopenMark(c, a, field.value);
	};
	focusOnOpen(`${a.id}:reopen`, field);
	return h(
		"div",
		{ class: "mark-form", "data-form": "reopen" },
		h(
			"fieldset",
			{},
			h("legend", {}, `Reopen mark ${a.number}`),
			h(
				"p",
				{ class: "meta field-help", id: `reopen-help-${a.id}` },
				"What is still wrong? The developer reads this first.",
			),
			field,
		),
		h(
			"div",
			{ class: "row" },
			done,
			h(
				"button",
				{
					type: "button",
					class: "small",
					onclick: () => actions.cancelMarkEdit(),
				},
				"Cancel",
			),
		),
	);
}

/** A page as the page filter names it: its title, else its address. */
const pageLabel = (page: CasePage) => page.title.trim() || shortUrl(page.url);

/**
 * A page's mark count in the case's list of pages: it sets the list's page
 * filter to that page, and another click sets it back to all pages. Its name
 * starts with what it shows and stays; `aria-pressed` says whether it is on.
 * A page without marks has its count as plain text: nothing to show.
 */
function pageCount(
	c: Case,
	page: CasePage,
	marks: number,
	byPage: PageFilter,
	actions: Actions,
): HTMLElement {
	const count = [
		h("span", { class: "page-count" }, String(marks)),
		h("span", { class: "page-unit" }, ` mark${marks === 1 ? "" : "s"}`),
	];
	if (marks === 0) return h("span", { class: "page-count-box" }, ...count);
	const on = byPage.page?.url === page.url;
	return h(
		"button",
		{
			type: "button",
			class: "page-count-box page-count-button",
			"aria-pressed": String(on),
			"aria-label": `${marks} mark${marks === 1 ? "" : "s"} on ${pageLabel(page)}: show only these`,
			onclick: () =>
				actions.filterPage(c.id, on ? undefined : { page: pageKey(page.url) }),
		},
		...count,
	);
}

/**
 * The list's page filter, beside the status chips, for a case of several
 * pages: "All pages" and "This page" as chips (this page while the tab shows
 * one of the case's), and any page of the case from a menu, in the order of
 * the case's pages, each with its mark count.
 */
function pageChooser(
	c: Case,
	byPage: PageFilter,
	tabUrl: string | undefined,
	actions: Actions,
): HTMLElement | null {
	const pages = casePages(c);
	if (pages.length < 2 || c.marks.length === 0) return null;
	const counts = marksByPage(c);
	const marksOn = (url: string) => counts.get(pageKey(url)) ?? 0;
	const front = tabUrl ? pageInFront(c, tabUrl) : undefined;
	const here = byPage.choice === "here";
	const picked = byPage.choice !== undefined && !here ? byPage.page : undefined;
	const chip = (
		label: string,
		count: number | undefined,
		pressed: boolean,
		choice: PageChoice | undefined,
		extra: Record<string, string>,
	) =>
		h(
			"button",
			{
				type: "button",
				class: "chip",
				"aria-pressed": String(pressed),
				onclick: () => actions.filterPage(c.id, choice),
				...extra,
			},
			label,
			count === undefined ? null : h("span", { class: "count" }, ` ${count}`),
		);
	const select = h(
		"select",
		{
			id: "marks-page",
			"aria-label": "Show the marks of one page",
			onchange: (e: Event) => {
				const value = (e.target as HTMLSelectElement).value;
				actions.filterPage(c.id, value === "" ? undefined : { page: value });
			},
		},
		h("option", { value: "" }, picked ? "All pages" : "Other page…"),
		...pages.map((pg) => {
			const n = marksOn(pg.url);
			// A page is its path whatever the host (DEC-063).
			const path = isWebPage(pg.url) ? pagePath(pg.url) : pg.url;
			const title = pg.title.trim();
			// A page without marks would show nothing.
			return h(
				"option",
				{ value: pageKey(pg.url), ...(n === 0 ? { disabled: true } : {}) },
				`${title ? `${title} (${path})` : path}: ${n} mark${n === 1 ? "" : "s"}`,
			);
		}),
	);
	select.value = picked ? pageKey(picked.url) : "";
	if (picked) select.setAttribute("data-on", "");
	return h(
		"div",
		{
			class: "chips page-filter",
			role: "group",
			"aria-label": "Show marks by page",
		},
		chip("All pages", undefined, byPage.choice === undefined, undefined, {
			"data-page-filter": "all",
		}),
		front !== undefined || here
			? chip(
					"This page",
					// Counted as the list of pages counts it, once.
					front === undefined ? 0 : marksOn(front.url),
					here,
					here ? undefined : "here",
					{
						"data-page-filter": "here",
						title: front
							? `Only the marks of ${pageLabel(front)}, the page in front; it follows the tab`
							: byPage.unread
								? "Sitegloss cannot read which page the tab in front shows"
								: "The tab in front shows none of this case's pages",
					},
				)
			: null,
		select,
	);
}

/**
 * The pages of a case that has several (DEC-038): each with its marks
 * counted, and a link that opens it; the one the tab in front shows says so.
 * A row is the page's title (its address where it has none), its marks and,
 * under the title, its path: titles of one app repeat. Every row is two lines
 * whatever it holds and whichever page is in front, so the list never moves;
 * what does not fit is cut by the style sheet, and the tooltip has it whole.
 * The rows stand under their sites (DEC-067), a page marked on two in both.
 */
function renderPages(
	p: CaseParts,
	c: Case,
	groups: SiteGroup[],
	tabUrl: string | undefined,
	byPage: PageFilter,
	actions: Actions,
): void {
	// The page whose marks are drawn on the tab in front, whatever its host (DEC-050).
	const here = tabUrl ? pageInFront(c, tabUrl) : undefined;
	const pages = groups.flatMap((g) => g.pages);
	// Counted once for all the pages, not once per page.
	const counts = marksByPage(c);
	const marksOn = (url: string) => counts.get(pageKey(url)) ?? 0;
	// One row per page whatever the host (DEC-063): its hosts under it.
	const hostsOf = pageHosts(c);
	// The host most pages were marked on: said only of a page marked on
	// another, or on more than one (the list stays two lines a page).
	const usual = (() => {
		const count = new Map<string, number>();
		for (const { origins } of hostsOf.values())
			for (const o of origins) count.set(o, (count.get(o) ?? 0) + 1);
		return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
	})();
	const key = JSON.stringify([
		groups.map((g) => [
			g.name,
			g.pages.map((page) => [page.url, page.title, marksOn(page.url)]),
		]),
		here?.url ?? null,
		byPage.page?.url ?? null,
		[...hostsOf.entries()],
		tabOrigin(tabUrl),
	]);
	if (key === p.pagesKey) return;
	p.pagesKey = key;
	// A count pressed is drawn anew: the keyboard's focus stays on it (or on
	// the title it was on), in the same row.
	const at = document.activeElement as HTMLElement | null;
	const list = p.groups
		.map((g) => g.list)
		.find((ul) => at !== null && ul.contains(at));
	const focused =
		at !== null && list !== undefined
			? {
					list,
					page: at.closest<HTMLElement>("li")?.dataset["page"],
					control: at.classList.contains("page-count-button")
						? ".page-count-button"
						: ".page-name",
				}
			: undefined;
	// The page in front is said once, in the first list it is in.
	let said = false;
	/**
	 * On which hosts a page was marked, the last first: said where it was
	 * marked on more than one or not on the usual one. Under a site's
	 * heading (`group`), only what the heading does not say: another host of
	 * that site, or a local one; never the site's own name again.
	 */
	const hostLine = (
		hosts: { origins: string[] } | undefined,
		group: string | undefined,
	): string | undefined => {
		if (!hosts || !(hosts.origins.length > 1 || hosts.origins[0] !== usual))
			return undefined;
		const shown =
			group === undefined
				? hosts.origins
				: hosts.origins.filter((o) => {
						if (hostOf(o) === group) return false;
						const site = siteOf(o);
						return site === null || site === group;
					});
		if (shown.length === 0 || (shown.length === 1 && shown[0] === usual))
			return undefined;
		return shown.map((o) => hostOf(o)).join(", ");
	};
	// `group`: the heading a row is under.
	const row = (page: (typeof pages)[number], group?: string) => {
		const marks = marksOn(page.url);
		const front = here !== undefined && here.url === page.url;
		const title = page.title.trim();
		const web = isWebPage(page.url);
		const path = web ? pagePath(page.url) : page.url;
		const hosts = hostsOf.get(pageKey(page.url));
		// On the tab's host when it was marked there, else on its last.
		const target = openAt(page.url, hosts, tabUrl);
		// An address is cut at its start: its end tells two pages apart.
		const address = () => h("bdi", { dir: "ltr" }, path);
		// The page in front is said by `aria-current` alone, once.
		const name = title || address();
		const whole = title ? `${title}\n${target}` : target;
		const tooltip = web
			? `${whole}\nOpens in a new tab; the case's marks are drawn there`
			: whole;
		const nameClass = `page-name${title ? "" : " cut-start"}`;
		const filtered = byPage.page?.url === page.url;
		const sayCurrent = front && !said;
		if (sayCurrent) said = true;
		const marked = hostLine(hosts, group);
		return h(
			"li",
			{
				"data-page": page.url,
				...(front ? { "data-here": true } : {}),
				...(filtered ? { "data-filter": true } : {}),
			},
			web
				? h(
						"button",
						{
							type: "button",
							class: `link ${nameClass}`,
							title: tooltip,
							...(sayCurrent ? { "aria-current": "page" } : {}),
							onclick: () => actions.openPage(p.current, target),
						},
						name,
					)
				: h("span", { class: nameClass, title: tooltip }, name),
			// The count sets the list's page filter; the title opens the page.
			pageCount(p.current, page, marks, byPage, actions),
			title ? h("span", { class: "page-address cut-start" }, address()) : null,
			marked === undefined ? null : h("span", { class: "page-hosts" }, marked),
		);
	};
	// When the sites change, a site's heading and list are kept by its name
	// and only put in their new order; a new site's are made.
	if (
		groups.length !== p.groups.length ||
		groups.some((g, i) => g.name !== p.groups[i]?.name)
	) {
		const byName = new Map(p.groups.map((g) => [g.name, g]));
		p.groups = groups.map(
			(g) => byName.get(g.name) ?? groupParts(p, g.name, p.groupSeq++),
		);
		p.groupsBox.replaceChildren(...p.groups.flatMap((g) => [g.head, g.list]));
	}
	p.siteGroups = groups;
	p.sitesHeading.textContent = groups.length > 1 ? "Sites" : "Site";
	groups.forEach((g, i) => {
		const parts = p.groups[i];
		if (parts === undefined) return;
		const n = g.pages.length;
		parts.count.textContent = `${n} page${n === 1 ? "" : "s"}`;
		// The page in front, on its site's heading: there while the list is
		// closed (the style sheet takes it off an open one, whose row says it).
		const front = g.pages.find((page) => page.url === here?.url);
		parts.here.hidden = front === undefined;
		parts.here.textContent =
			front === undefined ? "" : `This tab: ${pageLabel(front)}`;
		parts.list.replaceChildren(...g.pages.map((page) => row(page, g.name)));
	});
	// Moved or made again, a focused element loses the focus: it goes back to
	// the same heading, or to the same row, in its list or, where that list
	// is gone (its site left the case), in the first that has the page.
	if (at !== null && at.isConnected && document.activeElement !== at)
		at.focus();
	if (focused?.page !== undefined) {
		const lists = [focused.list, ...p.groups.map((g) => g.list)].filter(
			(ul) => ul.isConnected,
		);
		for (const ul of lists) {
			const li = [...ul.children].find(
				(x) => (x as HTMLElement).dataset["page"] === focused.page,
			);
			if (li === undefined) continue;
			li.querySelector<HTMLElement>(focused.control)?.focus();
			break;
		}
	}
}

function renderCase(state: PanelState, actions: Actions): void {
	const c = state.current;
	if (c === undefined) {
		parts = undefined;
		holdDelete(undefined);
		caseView.replaceChildren(h("p", { class: "meta" }, "Loading…"));
		return;
	}
	if (parts?.current.id !== c.id) {
		clearCue();
		parts = createParts(c, actions);
	}
	const p = parts;
	p.current = c;
	// The summary: what the store has, unless the user typed another.
	const draft = state.verdictDrafts.get(c.id);
	const verdict = draft ?? c.verdict ?? "";
	if (p.verdict.value !== verdict) p.verdict.value = verdict;
	p.verdictStatus.textContent =
		state.verdictStatus ?? (draft === undefined ? "" : "Not saved yet");
	// Only while the text differs from what is stored.
	p.saveVerdict.hidden = draft === undefined;
	// The field once the case has a summary or one is being typed; it then
	// stays, also when emptied.
	if (verdict !== "") p.summaryOpen = true;
	showSummary(p);
	const summaryWho = c.summaryBy
		? byline(c.summaryBy.user, c.summaryBy.app)
		: undefined;
	setHint(
		p.summaryBy,
		c.verdict && c.summaryBy && summaryWho
			? `Last changed by ${summaryWho}, ${formatDate(c.summaryBy.at)}`
			: undefined,
	);

	renderTitle(state, p, c);
	renderLink(state, p, c);
	const pages = casePages(c);
	const several = pages.length > 1;
	const web = !several && isWebPage(c.page.url);
	p.page.hidden = !web;
	p.page.textContent = web ? shortUrl(c.page.url) : "";
	// Several: the list says it, under its own heading (DEC-065).
	p.about.hidden = web || several;
	p.about.textContent = several ? "" : web ? "" : c.page.url;
	renderPages(
		p,
		c,
		several ? siteGroups(c) : [],
		state.tab?.url,
		pageFilter(c, state.markPage, state.tab?.url),
		actions,
	);
	// The site of the page in front starts open; all of them where the tab
	// shows none of the case's pages (DEC-063, DEC-067).
	const tabUrl = state.tab?.url;
	p.front =
		tabUrl !== undefined && isWebPage(tabUrl)
			? pageInFront(c, tabUrl)
			: undefined;
	foldPages(p);
	// A case of one page: its site beside its address.
	const sites = several ? [] : caseSites(c);
	p.siteRow.hidden = sites.length === 0;
	p.siteLabel.textContent = sites.length > 1 ? "Sites" : "Site";
	p.siteText.textContent = sites.join(", ");
	p.linkMenu.textContent =
		c.link === undefined ? "Add a link…" : "Change link…";
	// The window the marks of the page in front were made in (DEC-038).
	const madeAt = viewportAt(c, state.tab?.url);
	p.madeAt.textContent = sizeOf(madeAt);
	p.madeOn.textContent = formatDate(c.createdAt);
	// Offered only when the difference can change the page's layout (DEC-061).
	const size = state.tab?.size;
	p.size.hidden =
		size === undefined || sameSize(size, madeAt) || !sizeMatters(size, madeAt);
	p.sizeText.textContent = size
		? `This tab: ${sizeOf(size)}. Marks made at ${sizeOf(madeAt)}. `
		: "";
	setHint(
		p.origin,
		c.importedAt === undefined
			? undefined
			: `Imported from a file on ${formatDate(c.importedAt)}. Its link, comments, statuses and reopen notes and summary are as the file says: whoever wrote it, whatever author or AI app it names.`,
	);
	// Marks the panel loaded, or an AI app (the page says so).
	const here =
		state.loaded?.caseId === c.id && state.loaded.tabId === state.tab?.id
			? state.loaded
			: undefined;
	p.loadedHere = here !== undefined || state.overlay?.loadedCase === c.id;
	// On a tab without access, the tool bar says why in place of its
	// buttons, which could not work there (DEC-076).
	const plan = planOf(state);
	renderAccess(p.access, state, plan.inCase, NO_ACCESS_CASE);
	const ok = plan.pageControls;
	// A tool bar with its name only while it holds the buttons.
	if (ok) {
		p.dock.setAttribute("role", "toolbar");
		p.dock.setAttribute("aria-label", "Marks on this tab");
	} else {
		p.dock.removeAttribute("role");
		p.dock.removeAttribute("aria-label");
	}
	setHint(
		p.accessPointer,
		plan.inCase === "no-access"
			? "Sitegloss has no access to this tab yet: the bar at the end of the case says why and what to do."
			: plan.inCase === "cannot"
				? "Sitegloss cannot work on this kind of page: the bar at the end of the case says more."
				: undefined,
	);
	p.dock.toggleAttribute("data-notice", !ok);
	// The toolbar on the tab in front adds to this case (DEC-023).
	p.adding =
		state.overlay?.visible === true && state.overlay.target?.caseId === c.id;
	p.addMarks.hidden = !ok;
	p.addMarks.disabled = state.leaving?.phase === "finishing";
	// Calm at rest, always in reach; primary only while adding is on, and it
	// says so (DEC-064).
	setLabel(
		p.addMarks,
		p.adding ? undefined : "add",
		p.adding ? "Adding marks: Done" : "Add marks",
	);
	p.addMarks.classList.toggle("primary", p.adding);
	// Its words say what it does; no pressed state beside them (DEC-064's review).
	p.addMarks.title = p.adding
		? "Stop adding marks: the toolbar goes once each mark is in the case"
		: "Each mark you draw on the page goes into this case when its comment is done";
	// The same button at the end of a long list of marks; not primary, which
	// is the view's one button that starts drawing (DEC-024).
	setHint(p.leaving, leavingText(state.leaving));
	setHint(p.tabLine, ok ? tabLineText(state, c, p.adding) : undefined);
	// The case has no mark of this page (DEC-057), or the search is over and
	// found none of those it has.
	const none =
		here !== undefined &&
		!here.settling &&
		noneHere(c, [...here.matches.values()], here.url);
	const looking =
		state.drawing !== undefined &&
		state.drawing === state.tab?.id &&
		here === undefined;
	// A case without marks has nothing to show or hide.
	p.loadButton.hidden = !ok || none || looking || c.marks.length === 0;
	setLabel(
		p.loadButton,
		p.loadedHere ? "hide-marks" : "show-marks",
		p.loadedHere ? "Hide marks" : "Show marks",
	);
	p.loadButton.title = p.loadedHere
		? "Take this case's marks off the page in this tab; they stay off on this tab until you show them again"
		: "Look for each mark's element on the page in this tab and draw the marks there";
	const allLost =
		none &&
		here !== undefined &&
		findsOn(c, [...here.matches.values()], here.url).own.length > 0;
	setHint(p.noneFound, noneFoundText(c, state.tab?.url, allLost));
	// With a team (DEC-039): whether the case is the team's, and what a
	// delete then means.
	const sync = caseSync(state.cloud, c.id);
	// Said only of a case the team does not have: which team the cases sync
	// with is the account's, in the top bar (`account-menu.ts`).
	p.team.hidden = sync.kind !== "local";
	p.teamRow.hidden = p.team.hidden;
	p.team.dataset["sync"] = sync.kind;
	p.teamText.textContent = sync.kind === "local" ? "On this device only. " : "";
	p.share.hidden = !sync.mayShare;
	// Closed: filed away, not frozen (DEC-046). Whoever may change the case
	// may close it; in a team, the role says.
	const team = teamOf(state.cloud);
	const mayClose =
		sync.kind !== "synced" ||
		(team?.permissions.includes("case:close") ?? true);
	setLabel(
		p.closeButton,
		c.closed ? "reopen" : "close",
		c.closed ? "Reopen case" : "Close case",
	);
	// Leaving after a Close: the button is busy, so no press reopens the case
	// before the panel is on the list.
	const leavingNow = state.leaving?.phase === "finishing";
	p.closeButton.disabled = !mayClose || leavingNow;
	if (leavingNow) p.closeButton.setAttribute("aria-busy", "true");
	else p.closeButton.removeAttribute("aria-busy");
	p.closeButton.title = !mayClose
		? `Your role in “${sync.team}” does not allow closing its cases`
		: c.closed
			? "Open the case again: it goes back to the list of open cases"
			: "Close the case: it is filed away under Closed, and stays readable and changeable. A new open mark opens it again.";
	setHint(
		p.closedLine,
		c.closed
			? `Closed ${formatDate(c.closed.at)}${byline(c.closed.user, c.closed.app) ? ` by ${byline(c.closed.user, c.closed.app)}` : ""}.`
			: undefined,
	);
	renderStep(state, p, c, mayClose, actions);
	const threadContext: ThreadContext = {
		me: state.cloud.account?.userId,
		mayComment:
			sync.kind !== "synced" ||
			(team?.permissions.includes("comment:create") ?? true),
	};
	renderThread(p.thread, c, threadContext, actions);
	const armed = state.deleteArmedAt !== undefined;
	p.deleteButton.toggleAttribute("data-armed", armed);
	holdDelete(armed && sync.mayDelete ? p.deleteButton : undefined);
	p.deleteButton.disabled = !sync.mayDelete;
	setLabel(
		p.deleteButton,
		"delete",
		!armed
			? "Delete case"
			: sync.kind === "synced"
				? "Really delete for the team?"
				: "Really delete?",
	);
	p.deleteButton.title = !sync.mayDelete
		? `Your role in “${sync.team}” does not allow deleting its cases`
		: sync.kind === "synced"
			? armed
				? `Click again to delete this case and its screenshots, here and for everyone in “${sync.team}”`
				: `Delete this case and its screenshots, here and for everyone in “${sync.team}” (click twice). Files exported before stay.`
			: armed
				? "Click again to delete this case and its screenshots"
				: "Delete this case and its screenshots from this browser (click twice). Files exported before stay.";
	const of = (e: Exported["of"] | undefined) =>
		e !== undefined && e !== "all" && e.caseId === c.id;
	renderSaved(
		p.saved,
		of(state.exported?.of) ? state.exported : undefined,
		of(state.askingDownloads),
		actions,
	);
	// What the draw found counts the matches as they are now: a mark saved
	// since, while adding, is counted as the next draw would count it.
	const caseHint = state.caseHint;
	// What a draw found is the page filter's counts and each mark's word
	// now (DEC-061): no sentence on screen; a screen reader still hears it
	// (a status line, kept out of sight). What went wrong is said as before.
	const foundNow =
		typeof caseHint === "object" && state.loaded?.caseId === c.id
			? foundLine(c, state.loaded)
			: undefined;
	// Said once the draw has settled, not at every step of its count
	// (DEC-064's review): while it settles, the line says what it said.
	const settling = foundNow !== undefined && state.loaded?.settling === true;
	const again = typeof caseHint === "string" && state.caseHintSeq !== p.hintSeq;
	p.hintSeq = state.caseHintSeq;
	if (!settling) {
		const said =
			verifyLine?.caseId === c.id && Date.now() - verifyLine.at < VERIFY_LINE_MS
				? verifyLine.text
				: undefined;
		setHint(
			p.hint,
			typeof caseHint !== "object" ? (caseHint ?? said) : foundNow,
			again,
		);
		p.hint.classList.toggle("visually-hidden", foundNow !== undefined);
	}

	// A filter ends once none of its marks are left (nothing to show), or a
	// mark was added (it would not show, as if it was not saved).
	// The page filter first: the status chips count what it leaves.
	const byPage = pageFilter(c, state.markPage, state.tab?.url);
	const onPage: Case = { ...c, marks: c.marks.filter(byPage.shows) };
	const f = state.markFilter;
	const filter =
		f?.caseId === c.id &&
		caseCounts(onPage)[f.group] > 0 &&
		c.marks.every((a) => a.number <= f.upTo)
			? f.group
			: undefined;
	const pageKeyNow = JSON.stringify([
		byPage.choice ?? null,
		byPage.page?.url ?? null,
	]);
	// The status block: under the marks' heading, where its chips filter the
	// list (the owner; DEC-023 had it in the header).
	const front = state.tab?.url ? pageInFront(c, state.tab.url) : undefined;
	// Keyed on what it shows, not on every change of the case: an open menu
	// survives a save or a sync.
	const pageCounts = marksByPage(c);
	const statusKey = JSON.stringify([
		filter ?? null,
		caseCounts(onPage),
		pageKeyNow,
		front?.url ?? null,
		byPage.unread ?? false,
		casePages(c).map((pg) => [
			pg.url,
			pg.title,
			pageCounts.get(pageKey(pg.url)) ?? 0,
		]),
	]);
	if (statusKey !== p.statusKey) {
		p.statusKey = statusKey;
		// The chip that was clicked is drawn anew: the focus stays on it.
		const at = document.activeElement as HTMLElement | null;
		const inside = at !== null && p.status.contains(at);
		const refocus = !inside
			? undefined
			: at.dataset["group"] !== undefined
				? `[data-group="${at.dataset["group"]}"]`
				: at.dataset["pageFilter"] !== undefined
					? `[data-page-filter="${at.dataset["pageFilter"]}"]`
					: at.id === "marks-page"
						? "#marks-page"
						: undefined;
		const block = statusBlock(onPage, filter, actions, byPage.page);
		// Beside the status chips, the page filter: the two combine.
		const chooser = pageChooser(c, byPage, state.tab?.url, actions);
		p.status.replaceChildren(
			...[block, chooser].filter((e): e is HTMLElement => e !== null),
		);
		p.status.hidden = block === null && chooser === null;
		if (refocus !== undefined)
			p.status.querySelector<HTMLElement>(refocus)?.focus();
	}

	const images = state.images?.caseId === c.id ? state.images : undefined;
	const loaded = state.loaded?.caseId === c.id ? state.loaded : undefined;
	const edit = state.markEdit;
	if (edit === undefined) focusedForm = undefined;
	const markArmed = state.markDeleteArmed?.markId;
	const imageArmed = state.imageDeleteArmed;
	// A mark's copy for an AI app, where the case's is offered: the server has it.
	const mayCopy = mayCopyMark(c, whereIs(state.cloud, c));
	// Images added here the team does not have, and why (DEC-058).
	const notSent = state.cloud.status?.notSent?.[c.id];
	// A mark's pin was clicked on the page (DEC-027): its row opens, once.
	const picked =
		state.picked?.caseId === c.id && state.picked.at !== p.pickedAt
			? state.picked
			: undefined;
	if (picked !== undefined) openMarks.add(`${c.id}:${picked.markId}`);
	const marksKey = JSON.stringify([
		picked?.at ?? null,
		filter ?? null,
		pageKeyNow,
		state.tab?.url ? (pageInFront(c, state.tab.url)?.url ?? null) : null,
		c.updatedAt,
		images?.version,
		loaded ? [loaded.url, ...loaded.matches.values()] : null,
		// What is typed stays out: a key press redraws nothing.
		edit ? [edit.markId, edit.mode] : null,
		// A mark's link offers the host in front too (DEC-050).
		tabOrigin(state.tab?.url),
		markArmed ?? null,
		// Whether a mark's Show must draw the marks first.
		p.loadedHere,
		p.loadButton.hidden,
		state.showingMark ?? null,
		imageArmed ? [imageArmed.markId, imageArmed.imageId] : null,
		notSent ?? null,
		ok,
		// A mark's comments: one in edit, a Delete asked once, earlier ones shown.
		threadStateKey(c.id),
		threadContext,
		mayCopy,
		state.markCopied?.caseId === c.id ? state.markCopied : null,
	]);
	if (marksKey !== p.marksKey) {
		const sorted = [...onPage.marks]
			.sort((x, y) => x.number - y.number)
			.filter(
				(a) => filter === undefined || GROUP_OF[markStatus(a)] === filter,
			);
		const narrowed = filter !== undefined || byPage.choice !== undefined;
		const showAll = () => {
			actions.filterMarks(c.id, undefined);
			actions.filterPage(c.id, undefined);
		};
		// The tab shows a page of this case, on whatever host.
		const caseTab =
			state.tab?.url !== undefined &&
			isWebPage(state.tab.url) &&
			pageInFront(c, state.tab.url) !== undefined;
		// A mark of another page than the one drawn on is not looked for
		// there: "on another page", whatever the page (DEC-057).
		const items = sorted.map((a) => {
			const match = loaded?.matches.get(a.id);
			const elsewhere =
				loaded !== undefined && !onPageInFront(c, a, loaded.url);
			return markItem(c, a, {
				urls: images?.urls,
				ready: images?.version === c.updatedAt,
				match: elsewhere ? undefined : match,
				tabUrl: state.tab?.url,
				elsewhere,
				linkTab: elsewhere || caseTab ? state.tab?.url : undefined,
				unread:
					state.tab?.url === "" ? verifyHereWay(wordsOf(state)) : undefined,
				edit: edit?.markId === a.id ? edit : undefined,
				armed: markArmed === a.id,
				imageArmed:
					imageArmed?.markId === a.id ? imageArmed.imageId : undefined,
				notSent,
				actions,
				thread: threadContext,
				canReach: ok,
				// What "Show marks" would do here; a mark of another page, or of
				// a kind this version cannot show, has nothing to go to.
				busy:
					state.showingMark?.caseId === c.id &&
					state.showingMark.markId === a.id,
				loadFirst:
					!p.loadedHere &&
					!p.loadButton.hidden &&
					mayLoadAndShow(c, a, state.tab?.url, true) &&
					!(a.shape.kind === "unknown" && a.element === null),
				changed: () => syncToggleAll(),
				mayCopy,
				copied:
					state.markCopied?.caseId === c.id && state.markCopied.markId === a.id
						? { ok: state.markCopied.ok, text: state.markCopied.text }
						: undefined,
			});
		});
		const toggleAll: HTMLButtonElement = h("button", {
			type: "button",
			class: "link",
			id: "toggle-marks",
			onclick: () => {
				const open = !items.every((li) => li.hasAttribute("data-open"));
				// A mark being edited keeps its form in view.
				for (const li of items)
					if (open || li.dataset["mark"] !== edit?.markId)
						setOpen(c.id, li, open);
				syncToggleAll();
			},
		});
		const syncToggleAll = () => {
			const all = items.every((li) => li.hasAttribute("data-open"));
			toggleAll.textContent = all ? "Collapse all" : "Expand all";
		};
		syncToggleAll();
		toggleAll.hidden = items.length === 0;
		// The button and the chips move into the new section: a move takes the
		// focus off them (Show marks was just pressed), so it is given back.
		const focused = document.activeElement as HTMLElement | null;
		const kept =
			focused !== null &&
			(focused === p.loadButton || p.status.contains(focused))
				? focused
				: undefined;
		const marks = h(
			"section",
			{ class: "marks", "aria-labelledby": "marks-heading" },
			h(
				"div",
				{ class: "marks-bar" },
				h(
					"h2",
					{ id: "marks-heading" },
					"Marks ",
					h("span", { class: "count" }, String(c.marks.length)),
				),
				// Kept across redraws, like the status block under the bar.
				h("div", { class: "marks-tools" }, toggleAll),
			),
			p.status,
			!narrowed || c.marks.length === 0
				? null
				: h(
						"p",
						{ class: "meta filtered", id: "marks-filtered" },
						`Showing ${items.length} of ${c.marks.length} marks. `,
						h(
							"button",
							{
								type: "button",
								class: "link",
								"data-action": "show-all",
								onclick: showAll,
							},
							"Show all",
						),
					),
			items.length > 0 ? h("ol", { class: "marks" }, ...items) : null,
			items.length > 0
				? null
				: c.marks.length === 0
					? h(
							"p",
							{ class: "empty" },
							"No marks yet. Click Add marks and draw on the page.",
						)
					: byPage.choice !== undefined
						? h(
								"p",
								{ class: "empty", id: "marks-none-on-page" },
								byPage.unread
									? "Sitegloss cannot read which page the tab in front shows (see the notice about this tab). "
									: byPage.page === undefined
										? "The tab in front shows none of this case's pages. "
										: "No marks on this page. ",
								h(
									"button",
									{
										type: "button",
										class: "link",
										"data-action": "all-pages",
										onclick: showAll,
									},
									"Show all pages",
								),
							)
						: null,
		);
		if (verifiedNow && Date.now() - verifiedNow.at > VERIFIED_WAIT_MS)
			verifiedNow = undefined;
		const v = verifiedNow;
		// Where the focus was before this redraw: a verified row that leaves a
		// filtered list (Start verifying filters it) hands its focus to the
		// next row's head (`focusInMarks`); that focus is still the Verify's.
		const leftBefore =
			v?.caseId === c.id && focusLeftBy(p.marks, v.markId) === true;
		const refocus = focusInMarks(p.marks);
		p.marks.replaceWith(marks);
		p.marks = marks;
		if (kept !== undefined && !kept.hidden) kept.focus();
		refocus?.(marks);
		// Verified and drawn so: the next mark to verify has the focus.
		// Only a focus that the Verify left behind is moved: nowhere (its button
		// went with the redraw), still in its row, or where this redraw put it
		// when the row left the list. A field or a button of another row,
		// which the person went to meanwhile, is theirs.
		const movedTo = leftBefore ? focusLeftBy(marks, undefined) : false;
		const focusHere =
			focusLeftBy(marks, v?.markId) === true || typeof movedTo === "string";
		if (
			v?.caseId === c.id &&
			focusHere &&
			c.marks.find((m) => m.id === v.markId)?.resolution
		) {
			const done = c.marks.find((m) => m.id === v.markId);
			if (done && markStatus(done) !== "fixed") {
				verifiedNow = undefined;
				const order = rowOrder(marks);
				// The next mark to verify opens by itself, in view, so that
				// verifying a row of them is one press each (the owner). The
				// one known at the click, which a filtered list still has
				// when the verified mark has left it; else the list as it is.
				// Held until the verified row has collapsed (runPending).
				const to = opensAfterVerify(order, v.markId, v.next);
				pending = {
					caseId: c.id,
					verified: v.markId,
					movedTo: typeof movedTo === "string" ? movedTo : undefined,
					to,
					number: c.marks.find((m) => m.id === to)?.number,
					// The next step already says it when nothing is open either.
					say: c.marks.some((m) => markStatus(m) === "open"),
					opensAt:
						closing?.caseId === c.id && closing.markId === v.markId
							? closing.at + COLLAPSE_MS
							: 0,
				};
			}
		}
		// The row a Verify is closing, on whichever node draws it now: a
		// redraw continues the collapse from where it is, not snapping it shut.
		if (closing?.caseId === c.id) {
			const elapsed = Date.now() - closing.at;
			const row = marks.querySelector<HTMLElement>(
				`li.mark[data-mark="${quoted(closing.markId)}"]`,
			);
			if (row && elapsed < COLLAPSE_MS && !row.hasAttribute("data-collapsing"))
				collapseRow(c.id, row, closing.h, elapsed);
		}
		// What the answer decided runs once that collapse is done.
		runPending();
		// The cue of the row a Verify opened, on whichever node draws it now,
		// for its second only: a redraw within it carries the cue on from
		// where it is (not from the start); later ones, and other cases, not.
		if (arrived?.caseId === c.id) {
			const elapsed = Date.now() - arrived.at;
			const row = marks.querySelector<HTMLElement>(
				`li.mark[data-mark="${quoted(arrived.markId)}"]`,
			);
			if (row && elapsed < ARRIVED_MS) {
				// Measured again on the node that carries it on.
				const now = row.querySelector<HTMLElement>(".body")?.offsetHeight;
				if (now) arrived.h = now;
				cueRow(row, elapsed, arrived.h);
			} else if (elapsed >= ARRIVED_MS) arrived = undefined;
		}
		if (picked !== undefined) {
			p.pickedAt = picked.at;
			const row = items.find((li) => li.dataset["mark"] === picked.markId);
			// Its head under the sticky bars, its actions in view where they fit.
			row?.setAttribute("data-picked", "");
			// The panel's own scroll: a row held after a click lets go.
			releaseHeld();
			row?.scrollIntoView?.({ block: "nearest" });
			if (picked.focus)
				row
					?.querySelector<HTMLElement>(".mark-toggle")
					?.focus({ preventScroll: true });
		}
		p.marksKey = marksKey;
	}

	const shotsKey = JSON.stringify([c.updatedAt, images?.version]);
	if (shotsKey !== p.shotsKey) {
		const list = h("div", { class: "shots" });
		for (const shot of c.shots) {
			const url = images?.urls.get(shot.image);
			if (url)
				list.append(h("img", { src: url, alt: `Screenshot ${shot.id}` }));
		}
		// The record as taken: there to look at, so out of the way until asked.
		const shots: HTMLDetailsElement = h(
			"details",
			{ class: "shots-section", id: "case-shots" },
			h(
				"summary",
				{},
				"Screenshots ",
				h("span", { class: "count" }, String(c.shots.length)),
			),
			list,
		);
		shots.open = p.shots.hasAttribute("open");
		p.shots.replaceWith(shots);
		p.shots = shots;
		p.shotsKey = shotsKey;
	}
}

// --- a mark in the list -------------------------------------------------------

/** Marks shown open (`caseId:markId`); the rest show only their head. */
const openMarks = new Set<string>();

/**
 * A drawn row's Show where it shows the mark on the page in front without
 * leaving it or drawing the marks first: what the row a Verify opens does too.
 */
const showsHere = new WeakMap<HTMLElement, () => void>();

function setOpen(caseId: string, li: HTMLElement, open: boolean): void {
	const key = `${caseId}:${li.dataset["mark"]}`;
	if (open) openMarks.add(key);
	else openMarks.delete(key);
	li.toggleAttribute("data-open", open);
	li.querySelector(".mark-toggle")?.setAttribute("aria-expanded", String(open));
	const body = li.querySelector<HTMLElement>(".body");
	if (body) body.hidden = !open;
}

/** A row drawn open, without the open set's say: a collapse in progress is only how it looks. */
function showOpen(li: HTMLElement): void {
	li.toggleAttribute("data-open", true);
	li.querySelector(".mark-toggle")?.setAttribute("aria-expanded", "true");
	const body = li.querySelector<HTMLElement>(".body");
	if (body) body.hidden = false;
}

/** A value inside a quoted attribute selector. */
const quoted = (value: string) => value.replace(/["\\]/g, "\\$&");

/**
 * The button in the marks list that has the focus, as something to find
 * again once the list is drawn anew: a Delete or Remove clicked once redraws
 * the list, and the second press from the keyboard must find the armed
 * control where the first left it (mark Delete, an added image's Remove, a
 * comment's Delete). A control that went with its image leaves the focus on
 * the next picture's, the way to add one, or the mark's head.
 */
function focusInMarks(
	list: HTMLElement,
): ((next: HTMLElement) => void) | undefined {
	const at = document.activeElement as HTMLElement | null;
	if (at === null || !list.contains(at)) return undefined;
	// A field being typed in at a mark (a comment, an edit, a note): the
	// same field after the redraw, with its caret (DEC-064's review).
	if (at.tagName === "TEXTAREA" || at.tagName === "INPUT")
		return fieldAgain(at as HTMLTextAreaElement | HTMLInputElement);
	if (at.tagName !== "BUTTON") return undefined;
	const markId = at.closest<HTMLElement>("li.mark")?.dataset["mark"];
	// The row's head is found again by its class (a second redraw, when
	// the pictures come, must not drop the focus the first one put there).
	const which = ["data-mark-action", "data-action", "class"].find((name) =>
		name === "class"
			? at.classList.contains("mark-toggle")
			: at.hasAttribute(name),
	);
	if (markId === undefined || which === undefined) return undefined;
	const value =
		which === "class" ? "mark-toggle" : (at.getAttribute(which) as string);
	const picture = at.closest("[data-picture]")?.getAttribute("data-picture");
	// A comment's Edit or Delete: that comment's, not the first one's.
	const comment = at.closest("[data-comment]")?.getAttribute("data-comment");
	// The marks around it, for when its row goes (a mark deleted).
	const marks = [...list.querySelectorAll<HTMLElement>("li.mark")].map(
		(li) => li.dataset["mark"],
	);
	const pictures = [
		...list.querySelectorAll(
			`li.mark[data-mark="${quoted(markId)}"] [data-picture]`,
		),
	].map((e) => e.getAttribute("data-picture"));
	return (next) => {
		const row = next.querySelector<HTMLElement>(
			`li.mark[data-mark="${quoted(markId)}"]`,
		);
		if (row === null) {
			// Deleted: the next mark's head, else the one before, else the
			// list's heading.
			const at = marks.indexOf(markId);
			const near = [...marks.slice(at + 1), ...marks.slice(0, at).reverse()]
				.map((id) =>
					next.querySelector<HTMLElement>(
						`li.mark[data-mark="${quoted(id as string)}"] .mark-toggle`,
					),
				)
				.find((e) => e !== null);
			const heading = next.querySelector<HTMLElement>("#marks-heading");
			if (near) near.focus();
			else if (heading) {
				heading.tabIndex = -1;
				heading.focus();
			}
			return;
		}
		const within =
			picture != null
				? `[data-picture="${quoted(picture)}"] `
				: comment != null
					? `[data-comment="${quoted(comment)}"] `
					: "";
		const same = row.querySelector<HTMLElement>(
			which === "class"
				? ".mark-toggle"
				: `${within}[${which}="${quoted(value)}"]`,
		);
		if (same !== null) return same.focus();
		// A comment's Edit: its field now, to type in.
		if (comment != null) {
			const field = row.querySelector<HTMLElement>(
				`[data-comment="${quoted(comment)}"] textarea`,
			);
			if (field !== null) return field.focus();
		}
		// A mark's action that went with its status (Verify, Save): the same
		// row's next control, the first of its actions now.
		if (which === "data-mark-action") {
			const next =
				[...row.querySelectorAll<HTMLElement>("[data-mark-action]")].find(
					(b) => b.getClientRects().length > 0,
				) ?? row.querySelector<HTMLElement>(".mark-toggle");
			if (next !== null) return next.focus();
		}
		// Gone with its picture: the next picture's control, else the way to
		// add one; else the mark's head.
		const after =
			picture == null ? [] : pictures.slice(pictures.indexOf(picture) + 1);
		const fallback =
			after
				.map((id) =>
					row.querySelector<HTMLElement>(
						`[data-picture="${quoted(id as string)}"] [data-action="remove-image"]`,
					),
				)
				.find((e) => e !== null) ??
			(picture == null
				? null
				: row.querySelector<HTMLElement>("[data-action=add-image]")) ??
			row.querySelector<HTMLElement>(".mark-toggle");
		fallback?.focus();
	};
}

/**
 * The field `at` in a mark's row found again after the list is drawn anew:
 * by its mark and what holds it (a comment, a form, the mark's comments),
 * with the caret where it was.
 */
function fieldAgain(
	at: HTMLTextAreaElement | HTMLInputElement,
): ((next: HTMLElement) => void) | undefined {
	const markId = at.closest<HTMLElement>("li.mark")?.dataset["mark"];
	if (markId === undefined) return undefined;
	const holder =
		[
			["data-comment", at.closest("[data-comment]")],
			["data-form", at.closest("[data-form]")],
			["data-mark-thread", at.closest("[data-mark-thread]")],
		].find(([, e]) => e !== null) ?? [];
	const [attr, el] = holder as [string | undefined, Element | null | undefined];
	const scope =
		attr && el ? `[${attr}="${quoted(el.getAttribute(attr) ?? "")}"] ` : "";
	const cls = at.classList[0] ? `[class~="${quoted(at.classList[0])}"]` : "";
	const selector = `li.mark[data-mark="${quoted(markId)}"] ${scope}${at.tagName.toLowerCase()}${cls}`;
	const start = at.selectionStart;
	const end = at.selectionEnd;
	return (next) => {
		const field = next.querySelector<HTMLTextAreaElement | HTMLInputElement>(
			selector,
		);
		if (field === null) return;
		field.focus({ preventScroll: true });
		if (start !== null && end !== null) {
			try {
				field.setSelectionRange(start, end);
			} catch {
				// A field without a caret (a radio): the focus is enough.
			}
		}
	};
}

interface MarkContext {
	/** The case's images as object URLs, by path; none: not read yet. */
	urls: ReadonlyMap<string, string> | undefined;
	/** `urls` were read for this version of the case. */
	ready: boolean;
	match: MarkMatch | undefined;
	/** The tab in front's address: a mark's link offers its host (DEC-050). */
	tabUrl: string | undefined;
	/** It is of another page of the case than the tab in front shows. */
	elsewhere: boolean;
	/**
	 * The tab's address for a mark's page link to take its host from: only a
	 * tab on a page of the case (another environment) or where the case is
	 * drawn; else none, and the link goes where the mark was made (DEC-079).
	 */
	linkTab: string | undefined;
	/** The tab's address is not known (no access): the way onto it, in words. */
	unread: string | undefined;
	edit: PanelState["markEdit"];
	armed: boolean;
	/** The added image of this mark whose Remove was clicked once. */
	imageArmed: string | undefined;
	/** The case's added images the team does not have, and why. */
	notSent: Readonly<Record<string, string>> | undefined;
	actions: Actions;
	/** Sitegloss may run on the tab in front: Show can scroll it; else no Show. */
	canReach: boolean;
	/**
	 * The case's marks are not drawn on the tab in front, which can take
	 * them, and this mark is of its page: Show draws them, then shows it.
	 */
	loadFirst: boolean;
	/** This mark's Show is drawing the marks now. */
	busy: boolean;
	/** A mark opened or closed by its own head. */
	changed: () => void;
	/** Its instructions for an AI app can be copied: the server has the case. */
	mayCopy: boolean;
	/** What this mark's last copy did, while that is said. */
	copied: { ok: boolean; text: string } | undefined;
	/** Who may write a mark's comments (DEC-061). */
	thread: ThreadContext;
}

/**
 * One mark: a head (its number, comment and Show) that opens and closes the
 * rest (crop, where it is, its actions). A mark being edited stays open.
 */
function markItem(c: Case, a: Mark, x: MarkContext): HTMLElement {
	const { match: m, edit, actions } = x;
	const bodyId = `mark-body-${a.id}`;
	const status = markStatus(a);
	// A mark to verify that is not on the page in front: no Verify, its page
	// named and offered instead (DEC-079).
	const away = status === "fixed" && !verifiesHere(c, a, x.tabUrl);
	const li: HTMLElement = h("li", {
		class: "mark",
		"data-mark": a.id,
		"data-status": status,
		...(away ? { "data-away": "" } : {}),
		...(m ? { "data-colour": colourOf(m) } : {}),
		// Verified and dismissed step back; a mark to verify is to be looked at.
		...(a.resolution && status !== "fixed"
			? { "data-resolved": a.resolution.kind }
			: {}),
	});
	const toggle = h(
		"button",
		{
			type: "button",
			class: "mark-toggle",
			"aria-controls": bodyId,
			onclick: () => {
				// Its form stays in view while it is being edited.
				if (edit) return;
				setOpen(c.id, li, !li.hasAttribute("data-open"));
				x.changed();
			},
		},
		h("span", { class: "number" }, String(a.number)),
		h("span", { class: "chevron", "aria-hidden": "true" }),
		h(
			"span",
			{ class: a.comment ? "comment" : "comment none" },
			a.comment || "No comment",
		),
		a.author === "ai" ? h("span", { class: "tag" }, "AI") : null,
	);
	// A mark of an unknown kind with no element is nowhere this version can
	// show (DEC-066). On a tab without access none: the tool bar says why
	// (DEC-076; "Show marks" is not there either, so `loadFirst` is false).
	const here =
		!x.loadFirst &&
		canShow(m) &&
		x.canReach &&
		!(a.shape.kind === "unknown" && m.status === "no-element")
			? () => actions.showMatch(c.id, a, m.current)
			: undefined;
	if (here) showsHere.set(li, here);
	const show = x.loadFirst
		? h(
				"button",
				{
					type: "button",
					class: "show icon-only",
					"data-action": "show",
					"data-loads": "",
					"aria-busy": x.busy ? "true" : "false",
					"aria-label": `Show the marks on this page and go to mark ${a.number}`,
					title: `Show this case's marks on this page, scroll to mark ${a.number} and outline it`,
					onclick: () => actions.loadAndShow(c, a),
				},
				icon("show-mark"),
			)
		: here
			? h(
					"button",
					{
						type: "button",
						class: "show icon-only",
						"data-action": "show",
						"aria-label": `Show mark ${a.number} on the page`,
						title: `Show mark ${a.number} on the page: scroll to it and outline it`,
						onclick: here,
					},
					icon("show-mark"),
				)
			: showElsewhere(c, a, x, actions);
	const body = h(
		"div",
		{ class: "body", id: bodyId },
		picturesView(c, a, x),
		a.shape.kind === "unknown"
			? h("p", { class: "hint newer-kind" }, newerKindText(a.shape.given.kind))
			: null,
		historyList(a),
		markPlace(c, a, x.tabUrl, actions),
		byline(a.createdBy, a.createdVia)
			? h(
					"p",
					{ class: "meta mark-by" },
					`Added by ${byline(a.createdBy, a.createdVia)}`,
				)
			: null,
		a.commentBy && byline(a.commentBy.user, a.commentBy.app)
			? h(
					"p",
					{ class: "meta mark-by" },
					`Comment by ${byline(a.commentBy.user, a.commentBy.app)}`,
				)
			: null,
		a.element ? h("p", { class: "meta" }, summarize(a.element)) : null,
		m ? matchView(c.id, a, m, actions) : null,
		// What a mark to verify of another page offers, and why no Verify.
		away && edit === undefined
			? h("p", { class: "meta away-hint" }, x.unread ?? AWAY_HINT)
			: null,
		edit
			? edit.mode === "resolve"
				? resolveForm(c, a, edit.kind, edit.text, actions)
				: edit.mode === "reopen"
					? reopenForm(c, a, edit.text, actions)
					: commentForm(c, a, edit.text, actions)
			: markActions(
					c,
					a,
					x.armed,
					actions,
					away ? { linkTab: x.linkTab, unread: x.unread } : null,
					// On an open mark, the one there is work to do on (where the
					// web app has it as a button).
					{ may: x.mayCopy && status === "open", said: x.copied },
				),
		// Its comments, at the mark, after what can be done with it (DEC-061).
		markThreadView(c, a, x.thread, actions),
	);
	const sub = markSubline(c, a, m, actions, x.elsewhere || away, x.linkTab);
	// A mark to verify: Verify in its title line, small, so a closed row is
	// two lines like every other (DEC-064); Reopen… and the rest when open.
	const headVerify =
		status === "fixed" && !away && edit === undefined
			? (() => {
					const b = verifyButton(c, a, actions);
					b.className = "small head-verify";
					b.setAttribute("aria-label", `Verify mark ${a.number}`);
					return b;
				})()
			: null;
	li.append(
		h("div", { class: "mark-head" }, toggle, headVerify, show),
		...(sub ? [sub] : []),
		body,
	);
	setOpen(c.id, li, edit !== undefined || openMarks.has(`${c.id}:${a.id}`));
	return li;
}

/** A web address's origin, else null: what a mark's link depends on of the tab. */
function tabOrigin(url: string | undefined): string | null {
	return url !== undefined && isWebPage(url) ? new URL(url).origin : null;
}

/**
 * Where a mark was made (DEC-050): its address with the query, a link that
 * opens it in the tab in front and shows the mark there; with the tab on
 * another host, the same path and query on that host too.
 */
function markPlace(
	c: Case,
	a: Mark,
	tabUrl: string | undefined,
	actions: Actions,
): HTMLElement {
	const targets = markTargets(c, a, tabUrl);
	if (targets === undefined)
		return h("p", { class: "meta mark-page" }, `Marked on ${markUrl(c, a)}`);
	const shown = shortAddress(targets.made);
	return h(
		"p",
		{ class: "meta mark-page" },
		"Marked on ",
		h(
			"button",
			{
				type: "button",
				class: "link page-link",
				"data-mark-link": "made",
				"aria-label": `Open ${shown}, where mark ${a.number} was made, in this tab`,
				title:
					"Open the page where this mark was made in this tab, and show the mark there",
				onclick: () => actions.openMarkPage(c, a, "made"),
			},
			shown,
		),
		targets.here === undefined ? null : " · ",
		targets.here === undefined
			? null
			: h(
					"button",
					{
						type: "button",
						class: "link page-link",
						"data-mark-link": "here",
						"aria-label": `Open the same page on ${targets.host}, and show mark ${a.number} there`,
						title: `Open ${targets.here} in this tab, and show the mark there`,
						onclick: () => actions.openMarkPage(c, a, "here"),
					},
					`Open on ${targets.host}`,
				),
	);
}

/** The most of a page's title that names it in a mark's row. */
const PAGE_NAME = 60;

/**
 * Where a mark of another page than the tab shows opens: its page by its
 * title (else its path), the address, and which of the mark's two targets it
 * is. With the tab on another host than the mark's, the same page on that
 * host (DEC-050): a developer on localhost stays on localhost. None for a
 * mark of no web page (an imported file's).
 */
function elsewhereTarget(
	c: Case,
	a: Mark,
	tabUrl: string | undefined,
): { name: string; address: string; where: "made" | "here" } | undefined {
	const targets = markTargets(c, a, tabUrl);
	if (targets === undefined) return undefined;
	const url = markUrl(c, a);
	const key = pageKey(url);
	const page = casePages(c).find((p) => pageKey(p.url) === key);
	// A page's title is the page's own text: one line, and not longer than a
	// name should be, before it goes into a label and a tooltip.
	const title = (page?.title ?? "").replace(/\s+/g, " ").trim();
	return {
		name:
			title === ""
				? shortPath(url, false)
				: title.length > PAGE_NAME
					? `${title.slice(0, PAGE_NAME - 1).trimEnd()}…`
					: title,
		address: targets.here ?? targets.made,
		where: targets.here === undefined ? "made" : "here",
	};
}

/**
 * A mark of another page than the tab shows, in its row's second line: the
 * page by its title, as a link that opens it in this tab and shows the mark
 * there (owner, 22 November 2026: a link, not the words "On another page").
 * A mark with nowhere to go keeps the words.
 */
function otherPage(
	c: Case,
	a: Mark,
	tabUrl: string | undefined,
	actions: Actions,
): HTMLElement {
	const to = elsewhereTarget(c, a, tabUrl);
	if (to === undefined) return h("span", { class: "state" }, "On another page");
	return h(
		"button",
		{
			type: "button",
			class: "link state elsewhere",
			"data-mark-link": to.where,
			// Starts with the words shown, so the control can be named by them.
			"aria-label": `On ${to.name}: opens in this tab and shows mark ${a.number} there`,
			title: `On another page: ${to.name}\n${to.address}\nOpens in this tab and shows the mark there`,
			onclick: () => actions.openMarkPage(c, a, to.where),
		},
		`On ${to.name}`,
	);
}

/**
 * "Show" on a mark of another page (owner, 22 November 2026: every mark has
 * it): it opens the mark's page in this tab and shows the mark there, as the
 * page's link in the second row does. "Every mark" holds while the case is
 * drawn on the tab: with its marks hidden no mark has Show, here or there.
 * There without access too, unlike the page's own Show (`canReach`): opening a page
 * needs no access to the page in front. In Chrome `openMarkPage` asks for the
 * site's access itself; in Firefox it cannot (`asksForSite`), and the tab's
 * notice offers the ways on (DEC-076).
 */
function showElsewhere(
	c: Case,
	a: Mark,
	x: { elsewhere: boolean; tabUrl?: string | undefined },
	actions: Actions,
): HTMLElement | null {
	if (!x.elsewhere) return null;
	const to = elsewhereTarget(c, a, x.tabUrl);
	if (to === undefined) return null;
	return h(
		"button",
		{
			type: "button",
			class: "show icon-only",
			"data-action": "show-elsewhere",
			"aria-label": `Show mark ${a.number}: open ${to.name} in this tab`,
			title: `Show mark ${a.number}: open ${to.name} in this tab and show the mark there\n${to.address}`,
			onclick: () => actions.openMarkPage(c, a, to.where),
		},
		icon("show-mark"),
	);
}

/**
 * A mark's head, second row: its status, where it is on the tab in front,
 * its added images and comments; why it came back, for a reopened one. A mark of another
 * page names that page as a link. (A mark to verify has Verify in its
 * title line, DEC-064.)
 */
function markSubline(
	c: Case,
	a: Mark,
	m: MarkMatch | undefined,
	actions: Actions,
	elsewhere = false,
	tabUrl?: string,
): HTMLElement | null {
	const status = markStatus(a);
	const pill = PILL[status];
	const last = a.reopens?.at(-1);
	const where = elsewhere ? null : matchWord(m);
	// The thread's comments about this mark (DEC-046).
	const talk = commentCount(c, a.id);
	const parts = [
		// A highlight's text, as a quote on one line (DEC-066): page text, shown as text.
		a.highlight
			? h(
					"q",
					{ class: "quote", title: a.highlight.text },
					textLength(a.highlight.text) > QUOTE_SHOWN
						? `${cutText(a.highlight.text, QUOTE_SHOWN - 1)}…`
						: a.highlight.text,
				)
			: null,
		a.shape.kind === "unknown"
			? h(
					"span",
					{ class: "tag newer-kind", title: newerKindText(a.shape.given.kind) },
					"Newer kind",
				)
			: null,
		pill ? h("span", { class: "pill", "data-status": status }, pill) : null,
		status === "open" && last
			? h(
					"span",
					{ class: "reopened" },
					last.note
						? `Reopened: ${last.note.split(/\r\n?|\n/)[0]}`
						: "Reopened",
				)
			: null,
		elsewhere ? otherPage(c, a, tabUrl, actions) : null,
		where ? h("span", { class: "state" }, where) : null,
		// Only what was added: the screenshot every mark has is not counted.
		(a.images?.length ?? 0) + (a.heldImages?.length ?? 0) > 0
			? ((n: number) =>
					h(
						"span",
						{ class: "tag images-count" },
						`+${n} image${n === 1 ? "" : "s"}`,
					))((a.images?.length ?? 0) + (a.heldImages?.length ?? 0))
			: null,
		talk > 0
			? h(
					"span",
					{ class: "tag comments-count" },
					`${talk} comment${talk === 1 ? "" : "s"}`,
				)
			: null,
	].filter((x) => x !== null);
	return parts.length > 0 ? h("div", { class: "mark-sub" }, ...parts) : null;
}

// --- the AI app ------------------------------------------------------------------

function callText(call: AiCall): string {
	const time = new Date(call.at).toLocaleTimeString();
	return `Last AI call: ${call.tool}, by ${call.app}, at ${time}`;
}

/** `text` as a sentence another can follow. */
const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

/** A problem in the pill's two or three words; the sentence is under the bar. */
const PROBLEM_LABEL: Record<AiProblem, string> = {
	tab: `AI: ${PANEL} only`,
	updated: "AI: reopen panel",
	unavailable: "AI unavailable",
	connection: "AI problem",
};

/**
 * The top bar's pill (DEC-023, DEC-024): the connection in two or three
 * words, a dot in its colour, and in the tooltip the whole of it and what a
 * click does. A problem is red and named; its sentence shows under the bar
 * (`renderAi`), so nobody has to hover to learn of it.
 */
export function aiPill(ai: PanelState["ai"]): {
	label: string;
	dot: "off" | "problem" | "waiting" | "connected";
	title: string;
} {
	if (ai.problem !== undefined) {
		const retrying = ai.problem === "connection" && ai.active;
		return {
			label: retrying ? "AI retrying…" : PROBLEM_LABEL[ai.problem],
			dot: "problem",
			title:
				ai.problem === "connection"
					? `${sentence(ai.status)} Click for the AI app card.`
					: sentence(ai.status),
		};
	}
	if (ai.connected && ai.apps > 0)
		return {
			label: `AI on · ${ai.apps} app${ai.apps === 1 ? "" : "s"}`,
			dot: "connected",
			title: `${sentence(ai.status)} Click to manage ${ai.apps === 1 ? "it" : "them"}.`,
		};
	if (ai.connected)
		return {
			label: "AI on, no app yet",
			dot: "waiting",
			title: `${sentence(ai.status)} Click for the address and code.`,
		};
	if (ai.active)
		return {
			label: "AI connecting…",
			dot: "waiting",
			title: `${sentence(ai.status)} Click for the AI app card.`,
		};
	return {
		label: "AI off",
		dot: "off",
		title: "AI access is off. Click to turn it on and set it up.",
	};
}

/** An AI app was just paired: said in its card, with the way back (DEC-045). */
function renderPaired(state: PanelState, actions: Actions): void {
	const box = byId<HTMLElement>("paired-next");
	const name = state.settings ? state.ai.justPaired?.name : undefined;
	box.hidden = name === undefined;
	if (name === undefined) return;
	byId("paired-next-text").textContent = `${name} is connected.`;
	const button = byId<HTMLButtonElement>("paired-back");
	button.textContent =
		state.view.kind === "case" ? "Back to the case" : "Back to the cases";
	button.onclick = () => actions.closeSettings();
}

function renderAi({ ai }: PanelState): void {
	const pill = aiPill(ai);
	aiLabel.textContent = pill.label;
	// The whole status in the pill's name, for a screen reader; the pill shows the label.
	aiStatus.textContent = ai.status;
	aiButton.title = pill.title;
	// Waiting for an app to pair: nothing to do but wait (a click shows how).
	aiAction.hidden = (ai.active && !ai.connected) || ai.problem !== undefined;
	aiAction.textContent = ai.connected ? "Manage" : "Turn on";
	bar.dataset["ai"] = pill.dot;
	// What is wrong, in words, on every view (DEC-024).
	aiProblem.hidden = ai.problem === undefined;
	aiProblemText.textContent =
		ai.problem === undefined ? "" : sentence(ai.status);
	// The one-click stop for an app that may be acting now: with no app
	// connected, the pill leads to the switch, which is enough.
	keepOn.checked = ai.keepOn;
	setHint(aiCall, ai.lastCall && callText(ai.lastCall));
	// Only a connection that is up has an app talking: the glow goes with
	// the connection at once, not a moment after.
	if (ai.connected) showTalking(ai.working);
	else {
		clearTimeout(talkingUntil);
		talkingUntil = undefined;
		delete aiButton.dataset["talking"];
	}
}

/**
 * How long the chip keeps saying an app talks after its last call ended:
 * most calls take a blink, and the glow has to be seen (four breaths; the
 * owner: "pulse 2 times more").
 */
export const TALKING_AFTER_MS = 5000;
let talkingAfter = TALKING_AFTER_MS;

/** A shorter hold, for a test that would otherwise sit it out. */
export function holdTalkingFor(ms: number): void {
	talkingAfter = ms;
}

let talkingUntil: ReturnType<typeof setTimeout> | undefined;

/**
 * While an AI app's tool call runs, and a moment after, the chip glows
 * (DEC-063): a style alone, nothing in its name, so a screen reader hears
 * no chatter; the AI card says the last call in words.
 */
function showTalking(working: boolean): void {
	if (working) {
		clearTimeout(talkingUntil);
		talkingUntil = undefined;
		aiButton.dataset["talking"] = "";
		return;
	}
	if (!("talking" in aiButton.dataset) || talkingUntil !== undefined) return;
	talkingUntil = setTimeout(() => {
		talkingUntil = undefined;
		delete aiButton.dataset["talking"];
	}, talkingAfter);
}

// The test build's guards and delays below are short (DEC-053): its clicks
// and pages come fast, and its tests need not sit them out.
declare const SITEGLOSS_TEST_BUILD: boolean | undefined;

/**
 * A click on the back button this soon after the last one, which it did
 * something else for, is that double click's second (as Delete's).
 */
export const BACK_CLICK_GAP_MS =
	typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD
		? 100
		: 500;

/** The back button's last click, and what it did then. */
let lastBack: { at: number; role: string } | undefined;

/**
 * The top bar's back button (DEC-023): "All cases" closes the open case,
 * "Back" leaves Settings for the view underneath; none on Home. One button
 * that changes its meaning under the pointer: the second click of a double
 * click does nothing (as Delete's).
 */
function renderBack(state: PanelState, actions: Actions): void {
	const onCase = state.view.kind === "case";
	const role = state.settings
		? "settings"
		: `case ${state.leaving?.phase ?? ""}`;
	const click = (act: () => void) => () => {
		const at = Date.now();
		const last = lastBack;
		lastBack = { at, role };
		if (
			last !== undefined &&
			last.role !== role &&
			at >= last.at &&
			at - last.at < BACK_CLICK_GAP_MS
		)
			return;
		act();
	};
	back.hidden = !state.settings && !onCase;
	renderCopyId(onCase && !state.settings ? state.current?.id : undefined);
	if (state.settings) {
		backLabel.textContent = "Back";
		back.setAttribute(
			"aria-label",
			onCase ? "Back to the case" : "Back to all cases",
		);
		back.title = onCase ? "Back to the open case" : "Back to the cases";
		back.disabled = false;
		back.onclick = click(() => actions.closeSettings());
		return;
	}
	backLabel.textContent = "All cases";
	back.setAttribute("aria-label", "All cases: close this case");
	back.title =
		"Close this case: the toolbar stops adding to it, and its marks leave this tab";
	back.disabled = state.leaving?.phase === "finishing";
	back.onclick = click(() => actions.closeCase());
}

/** Draw the panel from `state`. */
export function render(state: PanelState, actions: Actions): void {
	const had = document.activeElement as HTMLElement | null;
	renderViews(state, actions);
	keepAccessFocus(had);
}

/** Can take the focus now: in the page, shown, not disabled. */
function focusable(el: HTMLElement | null): boolean {
	return (
		el !== null &&
		el.isConnected &&
		el.closest("[hidden]") === null &&
		!(el as HTMLButtonElement).disabled
	);
}

/**
 * The focus never falls to the page's body when access changes what is
 * shown (DEC-076): a control that removed itself (Not now, Allow on all
 * sites once allowed) or that the notice replaced (New case, Add marks,
 * Show marks, a mark's Show) hands it on, in reading order, to what now
 * stands there: the notice's button, else the control the notice had
 * replaced, else the view's heading.
 */
function keepAccessFocus(had: HTMLElement | null): void {
	if (had === null || had === document.body || focusable(had)) return;
	// Only where the person is: a panel whose document has no focus (they
	// work in the page) takes none, or keys meant for the page would land
	// on a button here.
	if (!document.hasFocus()) return;
	// Only what access shows or hides: other focus has its own rules.
	const accessBound =
		had.closest("#all-sites-offer, #access-notice, #case-access") !== null ||
		["new-case", "add-marks", "load-case"].includes(had.id) ||
		had.dataset["action"] === "show";
	if (!accessBound) return;
	if (
		document.activeElement !== had &&
		document.activeElement !== document.body
	)
		return;
	const id = (x: string) => document.getElementById(x);
	const button = (notice: string) =>
		id(notice)?.querySelector<HTMLElement>("button") ?? null;
	const onCase = !caseView.hidden && caseView.contains(had);
	const onHome = !home.hidden && home.contains(had);
	if (!onCase && !onHome) return;
	const next = (
		onCase
			? [button("case-access"), id("add-marks"), id("load-case")]
			: [
					button("access-notice"),
					id("new-case"),
					id("open-here"),
					id("page-heading"),
				]
	).find((el): el is HTMLElement => focusable(el));
	next?.focus();
}

function renderViews(state: PanelState, actions: Actions): void {
	lastActions = actions;
	// A mark's comment opened for editing, or a Delete asked: drawn again.
	onThreadChange(() => render(state, actions));
	renderSyncBanner(state, actions);
	renderCloudBanner(state, actions);
	renderAi(state);
	renderAccount(state, actions);
	renderPaired(state, actions);
	renderBack(state, actions);
	allSites.checked = state.allSites;
	const onCase = state.view.kind === "case";
	home.hidden = onCase || state.settings;
	caseView.hidden = !onCase || state.settings;
	settingsView.hidden = !state.settings;
	if (onCase) {
		renderCase(state, actions);
	} else {
		parts = undefined;
		clearCue();
		holdDelete(undefined);
		caseView.replaceChildren();
	}
	// Under an open case and Settings too: Home is as it is when it shows
	// again ("← All cases", or a case the panel opened from the page).
	renderHome(state, actions);
}
