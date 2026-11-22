/**
 * Drawing the side panel from its state (DEC-011). `render` is the only code
 * that touches the panel's DOM. The open case's summary and buttons stay the
 * same elements while it is open, so typing, focus and clicks survive every
 * render; the other parts are redrawn when what they show changed.
 */

import {
	BROWSER,
	CANNOT_RUN_FILES_TEXT,
	CANNOT_RUN_TEXT,
	FIREFOX,
	PANEL,
} from "../lib/browser.ts";
import {
	appLabel,
	byline,
	type Case,
	caseCounts,
	casePages,
	cleanTitle,
	type FindingApp,
	GROUP_LABEL,
	GROUP_OF,
	isOfferedOn,
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
	type UserRef,
	viewportAt,
} from "../lib/case.ts";
import { summarize } from "../lib/element.ts";
import type { CandidateInfo, MarkMatch } from "../lib/messages.ts";
import {
	type CloudActions,
	caseSync,
	hostOf,
	renderCloudBanner,
	renderCloudSection,
	teamOf,
} from "./cloud-view.ts";
import { byId, formatDate, h, isWebPage, shortPath, shortUrl } from "./dom.ts";
import { foundLine, noneHere } from "./follow.ts";
import { markTargets, shortAddress } from "./mark-link.ts";
import { type Size, sameSize } from "./size.ts";
import type { AiCall, AiProblem, Exported, PanelState } from "./state.ts";
import {
	renderSyncBanner,
	renderSyncSection,
	type SyncActions,
} from "./sync-view.ts";
import {
	commentCount,
	renderThread,
	type ThreadActions,
} from "./thread-view.ts";

/** What the user can do; main.ts carries it out and updates the state. */
export interface Actions extends SyncActions, CloudActions, ThreadActions {
	/** Close the case (filed away, not frozen) or open it again (DEC-046). */
	setCaseClosed(caseId: string, closed: boolean): void;
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
	/** "Verified" on a fixed mark: the fix holds (DEC-023). */
	verifyMark(c: Case, a: Mark): void;
	/** "Reopen" in its form: the note says what is still wrong. */
	reopenMark(c: Case, a: Mark, note: string): void;
	/** A status chip: show only those marks; `undefined`: all of them. */
	filterMarks(caseId: string, group: StatusGroup | undefined): void;
	saveComment(c: Case, a: Mark, text: string): void;
	deleteMark(c: Case, a: Mark): void;
	/** "Add another image…": the dialog for the mark's added images (DEC-058). */
	addImages(c: Case, a: Mark): void;
	/** An added image's Remove: the first click asks, the second removes. */
	deleteImage(c: Case, a: Mark, imageId: string): void;
	/** An AI app's finding on a mark: the first click asks, the second deletes. */
	deleteFinding(c: Case, a: Mark, findingId: string): void;
	/** Open one of the case's pages in a new tab (DEC-038); none named: the first. */
	openPage(c: Case, url?: string): void;
	/**
	 * A mark's link (DEC-050): open where it was made (`made`), or the same
	 * path and query on the host in front (`here`), in the tab in front, and
	 * show the mark there once the page has its marks.
	 */
	openMarkPage(c: Case, a: Mark, where: "made" | "here"): void;
	/** Chrome's prompt for "Allow on all sites"; call it in the click. */
	allowAllSites(): void;
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
	importReplace(): void;
	importCopy(): void;
	importCancel(): void;
}

const bar = byId<HTMLElement>("bar");
const back = byId<HTMLButtonElement>("back");
const home = byId<HTMLElement>("home");
const caseView = byId<HTMLElement>("case-view");
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
const openHere = byId<HTMLButtonElement>("open-here");
const allSites = byId<HTMLInputElement>("all-sites");
const aiStatus = byId<HTMLSpanElement>("ai-status");
const aiLabel = byId<HTMLSpanElement>("ai-label");
const backLabel = byId<HTMLSpanElement>("back-label");
const aiButton = byId<HTMLButtonElement>("ai-button");
const aiAction = byId<HTMLSpanElement>("ai-action");
const aiCall = byId<HTMLParagraphElement>("ai-call");
const aiProblem = byId<HTMLDivElement>("ai-problem");
const aiProblemText = byId<HTMLParagraphElement>("ai-problem-text");
const stopAi = byId<HTMLButtonElement>("stop-ai");
const keepOn = byId<HTMLInputElement>("keep-on");
const importError = byId<HTMLDivElement>("import-error");
const importDone = byId<HTMLParagraphElement>("import-done");
const exportAll = byId<HTMLButtonElement>("export-all");
const importButton = byId<HTMLButtonElement>("import");
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

/** Why Sitegloss does not work on a tab yet, and what to do about it. */
export const NO_ACCESS =
	"Sitegloss may not run on this tab yet. Click the Sitegloss icon in the toolbar (or press Alt+Shift+O) while this tab is in front.";

/** A tab Sitegloss is not let onto even with "Allow on all sites". */
export const CANNOT_RUN = CANNOT_RUN_TEXT;

/** The same, where Sitegloss may not read files either: that is the toggle for them. */
export const CANNOT_RUN_FILES = CANNOT_RUN_FILES_TEXT;

/** The title of a button that needs the page, while Sitegloss may not run there. */
export const NEEDS_ACCESS =
	"Sitegloss may not run on this tab yet: see the notice.";

/**
 * Whether Sitegloss may run on the tab in front, as far as the panel knows:
 * Chrome tells the address only of a tab it may run on (a tab still loading
 * has none yet). `never`: not even with "Allow on all sites".
 */
export function access(state: PanelState): "yes" | "ask" | "never" {
	const tab = state.tab;
	if (tab === undefined || tab.url !== "" || tab.loading) return "yes";
	return state.allSites ? "never" : "ask";
}

/**
 * The page in front shows none of the case's marks (DEC-022): none was
 * found, or the case has none of this page, and then where they are
 * (DEC-057).
 */
export function noneFoundText(c: Case, url: string | undefined): string {
	if (
		url !== undefined &&
		url !== "" &&
		c.marks.some((a) => onPageInFront(c, a, url))
	)
		return "None of this case's marks were found on this page.";
	// The pages its marks are on, the first few by name (DEC-038): not the
	// page in front, nor a page without marks (the first page of a case
	// marked elsewhere).
	const counts = marksByPage(c);
	const front = url ? pageInFront(c, url) : undefined;
	const pages = casePages(c)
		.filter(
			(p) =>
				(counts.get(pageKey(p.url)) ?? 0) > 0 &&
				(front === undefined || pageKey(p.url) !== pageKey(front.url)),
		)
		.map((p) => shortUrl(p.url));
	const here = "This case has no marks on this page.";
	if (pages.length === 0) return here;
	const named = pages.slice(0, 3).join(", ");
	const more = pages.length > 3 ? ` and ${pages.length - 3} more` : "";
	return `${here} They are on ${named}${more}.`;
}

/** `shop.example/cart and 2 more pages`: a case's pages in the list. */
export function pagesLine(c: Case): string {
	const [first, ...rest] = casePages(c);
	const more =
		rest.length === 0
			? ""
			: ` and ${rest.length} more page${rest.length === 1 ? "" : "s"}`;
	return `${shortUrl(first?.url ?? c.page.url)}${more}`;
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

/** A notice with the warning sign: its text, and a button where there is one. */
interface Notice {
	el: HTMLElement;
	text: HTMLParagraphElement;
	button: HTMLButtonElement;
}

function notice(id: string, button: HTMLButtonElement): Notice {
	const text = h("p", {});
	const el = h(
		"div",
		{ class: "notice", id, role: "status", hidden: true },
		warningIcon(),
		h("div", { class: "notice-body" }, text, button),
	);
	return { el, text, button };
}

/** The notice when Sitegloss may not run on the tab in front, with "Allow on all sites". */
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

const ALLOW_ALL_SITES_TITLE = `Let Sitegloss run on every site, without a click on its icon on each tab. ${BROWSER} asks first; you can take it back in the options, in Settings (the AI pill at the top).`;
const DETAILS_TITLE =
	"Open Sitegloss's page in chrome://extensions, where “Allow access to file URLs” is";

/**
 * Sitegloss may not run on the tab: "Allow on all sites" helps, or, where it
 * may run on all sites already, Chrome keeps the tab off limits; for a file
 * that is the "Allow access to file URLs" toggle, which the panel cannot
 * tell apart (Chrome hides the address), so it says both.
 */
function renderAccess(n: Notice, state: PanelState): void {
	const now = access(state);
	n.el.hidden = now === "yes";
	// Which tab it is about: the address and title are hidden too.
	n.el.dataset["tab"] = state.tab === undefined ? "" : String(state.tab.id);
	const files = now === "never" && state.fileAccess === false;
	n.text.textContent =
		now !== "never" ? NO_ACCESS : files ? CANNOT_RUN_FILES : CANNOT_RUN;
	// Firefox lets no extension open its add-ons page: the text says the way.
	n.button.hidden = now === "never" && (!files || FIREFOX);
	n.button.dataset["action"] = files ? "file-access" : "allow-all-sites";
	n.button.textContent = files
		? "Open Sitegloss's details"
		: "Allow on all sites";
	n.button.title = files ? DETAILS_TITLE : ALLOW_ALL_SITES_TITLE;
}

/** The actions of the last render, for the home view's notice made once. */
let lastActions: Actions | undefined;
const homeAccess = accessNotice("access-notice", () => lastActions as Actions);
newCaseButton.before(homeAccess.el);

const sizeOf = (s: Size) => `${s.width}×${s.height}`;

const percent = (score: number) => `${Math.round(score * 100)}%`;

function setHint(el: HTMLElement, text: string | undefined): void {
	el.hidden = text === undefined;
	el.textContent = text ?? "";
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
	const copy: HTMLButtonElement = h(
		"button",
		{
			type: "button",
			"data-action": "copy-path",
			title: "Copy the file's full path",
			onclick: () =>
				void actions.copyPath(exported.path).then((ok) => {
					if (!ok) return;
					copy.textContent = "Copied";
					setTimeout(() => {
						copy.textContent = "Copy";
					}, 1500);
				}),
		},
		"Copy",
	);
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

/** A case: opening it draws its marks on the tab in front (DEC-022). */
function caseItem(
	c: Case,
	actions: Actions,
	deviceOnly = false,
	/** Under "This page", a closed case says so: elsewhere it stands under Closed. */
	sayClosed = false,
): HTMLLIElement {
	const count = c.marks.length;
	// The bar beside it is a picture; the words say the same.
	const counts = countsText(caseCounts(c));
	return h(
		"li",
		{},
		h(
			"button",
			{
				type: "button",
				"data-case": c.id,
				title: `Open “${c.title}” and show its marks on the page in this tab`,
				onclick: () => actions.openCase(c.id),
			},
			h("span", { class: "title" }, c.title),
			sayClosed && c.closed !== undefined
				? h("span", { class: "tag closed-tag" }, "Closed")
				: null,
			// Signed in, a case the team does not have says so (DEC-039).
			deviceOnly
				? h("span", { class: "tag device-only" }, "This device only")
				: null,
			h("span", { class: "meta" }, pagesLine(c)),
			h(
				"span",
				{ class: "meta" },
				`${count} mark${count === 1 ? "" : "s"}${counts ? ` (${counts})` : ""}, ${formatDate(c.updatedAt)}`,
			),
			statusBar(c),
			c.verdict
				? h(
						"span",
						{ class: "meta" },
						`Summary for the developer: ${c.verdict.slice(0, 80)}`,
					)
				: null,
		),
	);
}

/** What the case list and the import prompt show now. */
let casesKey: string | undefined;
let importKey: string | undefined;

function renderCases(state: PanelState, actions: Actions): void {
	const url = state.tab?.url ?? "";
	const local = (c: Case) => caseSync(state.cloud, c.id).kind === "local";
	const key = JSON.stringify([
		url,
		state.cases.map((c) => [
			c.id,
			c.updatedAt,
			c.importedAt,
			local(c),
			c.closed !== undefined,
		]),
	]);
	if (key === casesKey) return;
	casesKey = key;
	// The page's own cases stand under "This page" (the owner): going on with
	// the case a page has is what is done most, a second case for it rarely.
	// Only on the same page of the same site as one of its screenshots
	// (DEC-050): elsewhere (localhost, staging) a case is opened by hand.
	// Not closed ones first, closed ones after; nothing opens by itself.
	const offered = state.cases.filter((c) => url && isOfferedOn(c, url));
	const own = [
		...offered.filter((c) => c.closed === undefined),
		...offered.filter((c) => c.closed !== undefined),
	];
	// Closed cases are filed away under Closed, folded (DEC-046): they leave
	// the list, and the page's own stand under "This page".
	const open = state.cases.filter((c) => c.closed === undefined);
	const closed = state.cases.filter(
		(c) => c.closed !== undefined && !own.includes(c),
	);
	const other = open.filter((c) => !own.includes(c));
	const one = own.length === 1 ? own[0] : undefined;
	here.hidden = own.length === 0;
	hereText.textContent =
		own.length === 0
			? ""
			: one
				? "This page already has a case. Open it to go on with its marks, or start a new one."
				: `This page already has ${own.length} cases. Open one to go on with its marks, or start a new one.`;
	hereCases.replaceChildren(
		...(own.length > 0
			? [
					h(
						"ul",
						{ class: "cases", "data-group": "here" },
						...own.map((c) => caseItem(c, actions, local(c), true)),
					),
				]
			: []),
	);
	// One case: opening it is the view's one amber button, a new case steps
	// back. Several: each row opens its case, and none is the one.
	openHere.hidden = one === undefined;
	openHere.onclick = one ? () => actions.openCase(one.id) : null;
	openHere.title = one
		? `Open “${one.title}” and show its marks on the page in this tab`
		: "";
	newCaseButton.classList.toggle("primary", own.length === 0);
	casesHeading.textContent = own.length > 0 ? "Other cases" : "Cases";
	casesList.replaceChildren(
		state.cases.length === 0
			? h(
					"p",
					{ class: "empty" },
					"No cases yet. Start one with “New case for this page”, or import a case someone sent you.",
				)
			: other.length === 0
				? h(
						"p",
						{ class: "empty" },
						open.length === 0 ? "No open cases." : "No cases for other pages.",
					)
				: h(
						"ul",
						{ class: "cases", "data-group": "other" },
						...other.map((c) => caseItem(c, actions, local(c))),
					),
		...(closed.length === 0 ? [] : [closedGroup(closed, actions, local)]),
	);
}

/** Whether the Closed group was unfolded: it stays so across redraws. */
let closedOpen = false;

/** The closed cases, folded by default (DEC-046). */
function closedGroup(
	closed: Case[],
	actions: Actions,
	local: (c: Case) => boolean,
): HTMLElement {
	const group = h(
		"details",
		{
			class: "closed-cases",
			id: "closed-cases",
			...(closedOpen ? { open: true } : {}),
			ontoggle: (e: Event) => {
				closedOpen = (e.target as HTMLDetailsElement).open;
			},
		},
		h(
			"summary",
			{},
			"Closed ",
			h("span", { class: "count" }, String(closed.length)),
		),
		h(
			"ul",
			{ class: "cases", "data-group": "closed" },
			...closed.map((c) => caseItem(c, actions, local(c))),
		),
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

/**
 * The tab in front is the web app of the server the account is signed in
 * to (DEC-045): its case pages show the same team's cases, marks and all,
 * as this panel does. Said in one line, where the address is known.
 */
export function webAppNote(state: PanelState): string | undefined {
	const server = state.cloud.account?.server;
	const url = state.tab?.url;
	if (server === undefined || !url) return undefined;
	try {
		if (new URL(url).origin !== new URL(server).origin) return undefined;
	} catch {
		return undefined;
	}
	return `This tab is your team's web app at ${hostOf(server)}: it shows the same cases as this panel.`;
}

function renderHome(state: PanelState, actions: Actions): void {
	const tab = state.tab;
	// Under "This page": its address, else its title (Chrome tells the
	// address only of a tab Sitegloss may run on).
	pageText.textContent = tab?.url ? shortUrl(tab.url) : (tab?.title ?? "");
	pageText.hidden = pageText.textContent === "";
	renderAccess(homeAccess, state);
	setHint(hint, state.hint);
	setHint(byId<HTMLElement>("web-app-note"), webAppNote(state));
	const ok = access(state) === "yes";
	// Always a new case, stored and opened at once (DEC-023, DEC-026).
	newCaseButton.disabled = !ok;
	newCaseButton.title = ok ? newCaseTitle : NEEDS_ACCESS;
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

/**
 * Pictures shown large (`caseId:markId` for the crop, `caseId:markId:imageId`
 * for an added image); the rest are small.
 */
const zoomed = new Set<string>();

/**
 * A picture of a mark as a tile, small at first: a click shows it large
 * across the row (as the crop was shown before the row), another small again.
 */
function pictureTile(
	key: string,
	src: string,
	label: string,
	title: string,
): HTMLElement {
	const button: HTMLButtonElement = h(
		"button",
		{
			type: "button",
			class: "tile",
			"data-action": "zoom",
			"aria-pressed": String(zoomed.has(key)),
			"aria-label": label,
			title,
			onclick: () => {
				const large = !zoomed.delete(key);
				if (large) zoomed.add(key);
				button.setAttribute("aria-pressed", String(large));
			},
		},
		h("img", { src, alt: "" }),
	);
	return button;
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
						`${c.id}:${a.id}`,
						shot,
						`Screenshot of mark ${a.number}, taken by Sitegloss`,
						"Taken by Sitegloss when the mark was made. It stays with the mark.",
					)
				: missing("The screenshot is missing."),
			h("figcaption", {}, "Screenshot"),
		),
		...added.map((image, i) => {
			const n = i + 1;
			const who = byline(image.added.user, image.added.app);
			const url = x.urls?.get(image.image);
			const armed = x.imageArmed === image.id;
			return h(
				"figure",
				{ class: "picture", "data-picture": image.id },
				url
					? pictureTile(
							`${c.id}:${a.id}:${image.id}`,
							url,
							`Image ${n} of ${added.length} on mark ${a.number}${who ? `, added by ${who}` : ""}`,
							`Added${who ? ` by ${who}` : ""}, ${shortDate(image.added.at)}. Click to show it larger, or small again`,
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
					h("span", { class: "plus", "aria-hidden": "true" }, "+ "),
					"Add another image…",
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
					`${added.length} of ${MAX_MARK_IMAGES} images`,
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
	/** The case's pages, where it has several (DEC-038). */
	pages: HTMLUListElement;
	pagesKey: string;
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
	/** Sitegloss may not run on the tab in front. */
	access: Notice;
	/** None of the case's marks were found on the tab in front (DEC-022). */
	noneFound: Notice;
	/** What the tab in front shows of the case, in one line. */
	tabLine: HTMLElement;
	/** The tab in front is the team's own web app (`webAppNote`). */
	webApp: HTMLElement;
	/** Show, or Hide where the case is loaded on the tab in front. */
	loadButton: HTMLButtonElement;
	loadedHere: boolean;
	/** "Add marks", or "Done adding" while the toolbar adds to the case. */
	addMarks: HTMLButtonElement;
	/** The same under the last mark of the list, where it has marks. */
	addMarksEnd: HTMLButtonElement;
	adding: boolean;
	/** "← All cases" is finishing the marks, or could not (DEC-023). */
	leaving: HTMLElement;
	deleteButton: HTMLButtonElement;
	/** Close case / Reopen case (DEC-046). */
	closeButton: HTMLButtonElement;
	/** Who closed it and when, while it is closed. */
	closedLine: HTMLElement;
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

function createParts(c: Case, actions: Actions): CaseParts {
	const verdict: HTMLTextAreaElement = h("textarea", {
		id: "verdict",
		rows: "2",
		placeholder:
			"What should change, as agreed. Whoever loads this case sees it first.",
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
	const renameButton = h(
		"button",
		{
			type: "button",
			class: "quiet",
			id: "rename-case",
			"aria-label": "Rename this case",
			title: "Change this case's title; it is saved at once",
			onclick: () => actions.startRename(created.current),
		},
		"Rename",
	);
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
		placeholder: "https://… a ticket, a design, a pull request",
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
		titleRow: h("div", { class: "case-title-row" }, title, renameButton),
		renameButton,
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
		meta: h("p", { class: "meta case-meta" }, page, about, madeAt, madeOn),
		pages: h("ul", { class: "case-pages", id: "case-pages", hidden: true }),
		pagesKey: "",
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
		noneFound: notice(
			"none-found",
			h(
				"button",
				{
					type: "button",
					"data-action": "open-case-page",
					title:
						"Open the page the marks were made on in a new tab; the case's marks are drawn there",
					onclick: () => actions.openPage(created.current),
				},
				"Open the case's page",
			),
		),
		tabLine: h("p", { class: "tab-line", id: "tab-line", hidden: true }),
		webApp: h("p", { class: "meta", id: "case-web-app", hidden: true }),
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
			"Add marks",
		),
		addMarksEnd: h(
			"button",
			{
				type: "button",
				id: "add-marks-end",
				onclick: () =>
					created.adding
						? actions.doneAdding(created.current)
						: actions.addMarks(created.current),
			},
			"Add marks",
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
		thread: h("section"),
		summaryBy: h("p", { class: "meta", id: "summary-by", hidden: true }),
		saved: h("div", { id: "export-saved", hidden: true }),
		hint: h("p", { class: "hint", id: "case-hint", hidden: true }),
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
		marks: h("section"),
		marksKey: "",
		pickedAt: undefined,
		shots: h("section"),
		shotsKey: "",
	};
	const header = h(
		"section",
		{ class: "case-header" },
		created.titleRow,
		created.rename,
		created.closedLine,
		created.meta,
		created.pages,
		created.team,
		created.linkRow,
		created.origin,
		h(
			"div",
			{ class: "row case-actions" },
			created.addMarks,
			h(
				"button",
				{
					type: "button",
					id: "export-case",
					title:
						"Save this case as one .zip file: its marks, comments, AI findings, summary, thread and screenshots, and case.md to read them without Sitegloss. Someone imports it with Import a case…",
					onclick: () => actions.exportCase(created.current),
				},
				"Export",
			),
		),
		created.leaving,
		created.saved,
		// What the tab in front shows of the case (DEC-022, DEC-023).
		h(
			"div",
			{ class: "this-tab", id: "this-tab" },
			created.access.el,
			created.noneFound.el,
			created.webApp,
			created.tabLine,
			created.hint,
			created.size,
		),
		// What the whole case comes to: the case's, not a mark's. Stored as
		// verdict, its name before (DEC-019).
		h(
			"div",
			{ class: "verdict" },
			h(
				"div",
				{ class: "verdict-head" },
				h("label", { for: "verdict" }, "Summary for the developer"),
				verdictStatus,
				created.saveVerdict,
			),
			verdict,
			created.summaryBy,
		),
	);
	caseView.replaceChildren(
		header,
		created.marks,
		created.thread,
		created.shots,
		h(
			"section",
			{ class: "case-footer" },
			created.deleteButton,
			created.closeButton,
		),
	);
	return created;
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
	const renaming = state.renaming?.caseId === c.id ? state.renaming : undefined;
	p.titleRow.hidden = renaming !== undefined;
	p.rename.hidden = renaming === undefined;
	if (renaming === undefined) {
		if (!p.renameOpen) return;
		p.renameOpen = false;
		// The keyboard is back where the rename started.
		const at = document.activeElement;
		if (at === null || at === document.body || p.rename.contains(at))
			queueMicrotask(() => p.renameButton.focus());
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
	p.linkEdit.hidden = editing !== undefined;
	p.linkEdit.textContent = link === undefined ? "Add a link" : "Edit";
	p.linkEdit.setAttribute(
		"aria-label",
		link === undefined ? "Add a link to this case" : "Edit this case's link",
	);
	p.linkForm.hidden = editing === undefined;
	if (editing === undefined) {
		if (!p.linkFormOpen) return;
		p.linkFormOpen = false;
		// The keyboard is back where the edit started.
		const at = document.activeElement;
		if (at === null || at === document.body || p.linkForm.contains(at))
			queueMicrotask(() => p.linkEdit.focus());
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

/** "2 open, 1 to verify, 1 dismissed": the groups with marks; nothing while every mark is open. */
function countsText(n: Record<StatusGroup, number>): string | undefined {
	if (n.toVerify + n.verified + n.dismissed === 0) return undefined;
	return STATUS_GROUPS.filter((g) => n[g] > 0)
		.map((g) => `${n[g]} ${GROUP_LABEL[g].toLowerCase()}`)
		.join(", ");
}

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
					" All marks are verified or dismissed.",
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
		label,
	);
}

const VERIFIED_TITLE = "The fix holds on the page you checked";
const REOPEN_TITLE =
	"Open the mark again, with a note on what is still wrong; how it was settled stays in its history";

const verifyButton = (c: Case, a: Mark, actions: Actions) =>
	markButton(
		"Verified",
		"verify",
		VERIFIED_TITLE,
		() => actions.verifyMark(c, a),
		true,
	);

const reopenButton = (c: Case, a: Mark, actions: Actions) =>
	markButton("Reopen…", "reopen", REOPEN_TITLE, () =>
		actions.editMark(c, a, "reopen"),
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
): HTMLElement {
	const status = markStatus(a);
	return h(
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
		status === "fixed" ? verifyButton(c, a, actions) : null,
		status === "open" ? null : reopenButton(c, a, actions),
		status === "open"
			? null
			: markButton(
					"Change…",
					"change",
					"Change how it was settled, or its note",
					() => actions.editMark(c, a, "resolve"),
				),
		markButton("Edit comment", "comment", undefined, () =>
			actions.editMark(c, a, "comment"),
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
			armed ? "Really delete?" : "Delete mark",
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
	queueMicrotask(() => field.focus());
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
	const noteField: HTMLInputElement = h("input", {
		type: "text",
		class: "note",
		placeholder: "Note (optional): what was done, or why",
		maxlength: String(MAX_COMMENT),
		"aria-label": `Note for mark ${a.number}`,
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
			placeholder: "What is still wrong? The developer reads this first.",
			"aria-label": `What is still wrong with mark ${a.number}`,
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
		h("fieldset", {}, h("legend", {}, `Reopen mark ${a.number}`), field),
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

/**
 * The pages of a case that has several (DEC-038): each with its marks
 * counted, and a link that opens it; the one the tab in front shows says so.
 * A row is the page's title (its address where it has none), its marks and,
 * under the title, its path: titles of one app repeat. Every row is two lines
 * whatever it holds and whichever page is in front, so the list never moves;
 * what does not fit is cut by the style sheet, and the tooltip has it whole.
 */
function renderPages(
	p: CaseParts,
	c: Case,
	pages: ReturnType<typeof casePages>,
	tabUrl: string | undefined,
	actions: Actions,
): void {
	// The page whose marks are drawn on the tab in front, whatever its host (DEC-050).
	const here = tabUrl ? pageInFront(c, tabUrl) : undefined;
	// Counted once for all the pages, not once per page.
	const counts = marksByPage(c);
	const marksOn = (url: string) => counts.get(pageKey(url)) ?? 0;
	const key = JSON.stringify([
		pages.map((page) => [page.url, page.title, marksOn(page.url)]),
		here?.url ?? null,
	]);
	if (key === p.pagesKey) return;
	p.pagesKey = key;
	p.pages.hidden = pages.length === 0;
	// The host only where it tells the pages apart.
	const hosts = new Set(
		pages.filter((page) => isWebPage(page.url)).map((page) => hostOf(page.url)),
	);
	p.pages.replaceChildren(
		...pages.map((page) => {
			const marks = marksOn(page.url);
			const front = here !== undefined && here.url === page.url;
			const title = page.title.trim();
			const web = isWebPage(page.url);
			const path = web ? shortPath(page.url, hosts.size > 1) : page.url;
			// An address is cut at its start: its end tells two pages apart.
			const address = () => h("bdi", { dir: "ltr" }, path);
			// The page in front is said by `aria-current` alone, once.
			const name = title || address();
			const whole = title ? `${title}\n${page.url}` : page.url;
			const tooltip = web
				? `${whole}\nOpens in a new tab; the case's marks are drawn there`
				: whole;
			const nameClass = `page-name${title ? "" : " cut-start"}`;
			return h(
				"li",
				{ "data-page": page.url, ...(front ? { "data-here": true } : {}) },
				web
					? h(
							"button",
							{
								type: "button",
								class: `link ${nameClass}`,
								title: tooltip,
								...(front ? { "aria-current": "page" } : {}),
								onclick: () => actions.openPage(p.current, page.url),
							},
							name,
						)
					: h("span", { class: nameClass, title: tooltip }, name),
				h("span", { class: "page-count" }, String(marks)),
				h("span", { class: "page-unit" }, ` mark${marks === 1 ? "" : "s"}`),
				title
					? h("span", { class: "page-address cut-start" }, address())
					: null,
			);
		}),
	);
}

function renderCase(state: PanelState, actions: Actions): void {
	const c = state.current;
	if (c === undefined) {
		parts = undefined;
		holdDelete(undefined);
		caseView.replaceChildren(h("p", { class: "meta" }, "Loading…"));
		return;
	}
	if (parts?.current.id !== c.id) parts = createParts(c, actions);
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
	p.about.hidden = web;
	p.about.textContent = several
		? `${pages.length} pages`
		: web
			? ""
			: c.page.url;
	renderPages(p, c, several ? pages : [], state.tab?.url, actions);
	// The window the marks of the page in front were made in (DEC-038).
	const madeAt = viewportAt(c, state.tab?.url);
	p.madeAt.textContent = sizeOf(madeAt);
	p.madeOn.textContent = formatDate(c.createdAt);
	const size = state.tab?.size;
	p.size.hidden = size === undefined || sameSize(size, madeAt);
	p.sizeText.textContent = size
		? `This tab is ${sizeOf(size)}, the marks were made at ${sizeOf(madeAt)}. `
		: "";
	setHint(
		p.origin,
		c.importedAt === undefined
			? undefined
			: `Imported from a file on ${formatDate(c.importedAt)}. Its link, comments, statuses and reopen notes, summary and findings are as the file says: whoever wrote it, whatever author or AI app it names.`,
	);
	// Marks the panel loaded, or an AI app (the page says so).
	const here =
		state.loaded?.caseId === c.id && state.loaded.tabId === state.tab?.id
			? state.loaded
			: undefined;
	p.loadedHere = here !== undefined || state.overlay?.loadedCase === c.id;
	renderAccess(p.access, state);
	const ok = access(state) === "yes";
	// The toolbar on the tab in front adds to this case (DEC-023).
	p.adding =
		state.overlay?.visible === true && state.overlay.target?.caseId === c.id;
	p.addMarks.disabled = !ok || state.leaving?.phase === "finishing";
	p.addMarks.textContent = p.adding ? "Done adding" : "Add marks";
	p.addMarks.classList.toggle("primary", !p.adding);
	p.addMarks.title = !ok
		? NEEDS_ACCESS
		: p.adding
			? "Stop adding marks: the toolbar goes once each mark is in the case"
			: "Each mark you draw on the page goes into this case when its comment is done";
	// The same button at the end of a long list of marks; not amber, which
	// is the view's one button that starts drawing (DEC-024).
	p.addMarksEnd.disabled = p.addMarks.disabled;
	p.addMarksEnd.textContent = p.addMarks.textContent;
	p.addMarksEnd.title = p.addMarks.title;
	setHint(p.leaving, leavingText(state.leaving));
	setHint(p.tabLine, ok ? tabLineText(state, c, p.adding) : undefined);
	setHint(p.webApp, webAppNote(state));
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
	p.loadButton.textContent = p.loadedHere ? "Hide marks" : "Show marks";
	p.loadButton.title = p.loadedHere
		? "Take this case's marks off the page in this tab; they stay off on this tab until you show them again"
		: "Look for each mark's element on the page in this tab and draw the marks there";
	p.noneFound.el.hidden = !none;
	p.noneFound.text.textContent = none ? noneFoundText(c, state.tab?.url) : "";
	p.noneFound.button.hidden =
		!none ||
		!isWebPage(c.page.url) ||
		pageInFront(c, state.tab?.url ?? "") !== undefined;
	// With a team (DEC-039): whether the case is the team's, and what a
	// delete then means.
	const sync = caseSync(state.cloud, c.id);
	p.team.hidden = sync.kind === "off";
	p.team.dataset["sync"] = sync.kind;
	p.teamText.textContent =
		sync.kind === "synced"
			? `Synced with “${sync.team}”`
			: sync.kind === "local"
				? "On this device only. "
				: "";
	p.share.hidden = !sync.mayShare;
	// Closed: filed away, not frozen (DEC-046). Whoever may change the case
	// may close it; in a team, the role says.
	const team = teamOf(state.cloud);
	const mayClose =
		sync.kind !== "synced" ||
		(team?.permissions.includes("case:close") ?? true);
	p.closeButton.textContent = c.closed ? "Reopen case" : "Close case";
	p.closeButton.disabled = !mayClose;
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
	renderThread(
		p.thread,
		c,
		{
			me: state.cloud.account?.userId,
			mayComment:
				sync.kind !== "synced" ||
				(team?.permissions.includes("comment:create") ?? true),
		},
		actions,
	);
	const armed = state.deleteArmedAt !== undefined;
	p.deleteButton.toggleAttribute("data-armed", armed);
	holdDelete(armed && sync.mayDelete ? p.deleteButton : undefined);
	p.deleteButton.disabled = !sync.mayDelete;
	p.deleteButton.textContent = !armed
		? "Delete case"
		: sync.kind === "synced"
			? "Really delete for the team?"
			: "Really delete?";
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
	setHint(
		p.hint,
		typeof caseHint !== "object"
			? caseHint
			: state.loaded?.caseId === c.id
				? foundLine(c, state.loaded)
				: undefined,
	);

	// A filter ends once none of its marks are left (nothing to show), or a
	// mark was added (it would not show, as if it was not saved).
	const f = state.markFilter;
	const filter =
		f?.caseId === c.id &&
		caseCounts(c)[f.group] > 0 &&
		c.marks.every((a) => a.number <= f.upTo)
			? f.group
			: undefined;
	// The status block: under the marks' heading, where its chips filter the
	// list (the owner; DEC-023 had it in the header).
	const statusKey = JSON.stringify([filter ?? null, caseCounts(c)]);
	if (statusKey !== p.statusKey) {
		p.statusKey = statusKey;
		// The chip that was clicked is drawn anew: the focus stays on it.
		const at = document.activeElement as HTMLElement | null;
		const group =
			at !== null && p.status.contains(at) ? at.dataset["group"] : undefined;
		const block = statusBlock(c, filter, actions);
		p.status.replaceChildren(...(block === null ? [] : [block]));
		p.status.hidden = block === null;
		if (group !== undefined)
			block?.querySelector<HTMLElement>(`[data-group="${group}"]`)?.focus();
	}

	const images = state.images?.caseId === c.id ? state.images : undefined;
	const loaded = state.loaded?.caseId === c.id ? state.loaded : undefined;
	const edit = state.markEdit;
	if (edit === undefined) focusedForm = undefined;
	const markArmed = state.markDeleteArmed?.markId;
	const findingArmed = state.findingDeleteArmed;
	const imageArmed = state.imageDeleteArmed;
	// A mark's pin was clicked on the page (DEC-027): its row opens, once.
	const picked =
		state.picked?.caseId === c.id && state.picked.at !== p.pickedAt
			? state.picked
			: undefined;
	if (picked !== undefined) openMarks.add(`${c.id}:${picked.markId}`);
	const marksKey = JSON.stringify([
		picked?.at ?? null,
		filter ?? null,
		c.updatedAt,
		images?.version,
		loaded ? [loaded.url, ...loaded.matches.values()] : null,
		// What is typed stays out: a key press redraws nothing.
		edit ? [edit.markId, edit.mode] : null,
		// A mark's link offers the host in front too (DEC-050).
		tabOrigin(state.tab?.url),
		markArmed ?? null,
		findingArmed ? [findingArmed.markId, findingArmed.findingId] : null,
		imageArmed ? [imageArmed.markId, imageArmed.imageId] : null,
		ok,
	]);
	if (marksKey !== p.marksKey) {
		const sorted = [...c.marks]
			.sort((x, y) => x.number - y.number)
			.filter(
				(a) => filter === undefined || GROUP_OF[markStatus(a)] === filter,
			);
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
				edit: edit?.markId === a.id ? edit : undefined,
				armed: markArmed === a.id,
				findingArmed:
					findingArmed?.markId === a.id ? findingArmed.findingId : undefined,
				imageArmed:
					imageArmed?.markId === a.id ? imageArmed.imageId : undefined,
				actions,
				canReach: ok,
				changed: () => syncToggleAll(),
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
				h("div", { class: "marks-tools" }, toggleAll, p.loadButton),
			),
			p.status,
			filter === undefined
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
								onclick: () => actions.filterMarks(c.id, undefined),
							},
							"Show all",
						),
					),
			items.length > 0 ? h("ol", { class: "marks" }, ...items) : null,
			items.length > 0 ? h("div", { class: "row" }, p.addMarksEnd) : null,
			items.length > 0
				? null
				: filter === undefined
					? h(
							"p",
							{ class: "empty" },
							"No marks yet. Click Add marks and draw on the page.",
						)
					: null,
		);
		p.marks.replaceWith(marks);
		p.marks = marks;
		if (kept !== undefined && !kept.hidden) kept.focus();
		if (picked !== undefined) {
			p.pickedAt = picked.at;
			const row = items.find((li) => li.dataset["mark"] === picked.markId);
			// Its head under the sticky bars, its actions in view where they fit.
			row?.setAttribute("data-picked", "");
			row?.scrollIntoView?.({ block: "nearest" });
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

function setOpen(caseId: string, li: HTMLElement, open: boolean): void {
	const key = `${caseId}:${li.dataset["mark"]}`;
	if (open) openMarks.add(key);
	else openMarks.delete(key);
	li.toggleAttribute("data-open", open);
	li.querySelector(".mark-toggle")?.setAttribute("aria-expanded", String(open));
	const body = li.querySelector<HTMLElement>(".body");
	if (body) body.hidden = !open;
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
	edit: PanelState["markEdit"];
	armed: boolean;
	/** The finding of this mark whose Delete was clicked once. */
	findingArmed: string | undefined;
	/** The added image of this mark whose Remove was clicked once. */
	imageArmed: string | undefined;
	actions: Actions;
	/** Sitegloss may run on the tab in front: Show can scroll it. */
	canReach: boolean;
	/** A mark opened or closed by its own head. */
	changed: () => void;
}

/**
 * One mark: a head (its number, comment and Show) that opens and closes the
 * rest (crop, where it is, its actions). A mark being edited stays open.
 */
function markItem(c: Case, a: Mark, x: MarkContext): HTMLElement {
	const { match: m, edit, actions } = x;
	const bodyId = `mark-body-${a.id}`;
	const status = markStatus(a);
	const li: HTMLElement = h("li", {
		class: "mark",
		"data-mark": a.id,
		"data-status": status,
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
	const show = canShow(m)
		? h(
				"button",
				{
					type: "button",
					class: "small show",
					"data-action": "show",
					"aria-label": `Show mark ${a.number} on the page`,
					title: x.canReach
						? "Scroll the page to this mark and outline it"
						: NEEDS_ACCESS,
					disabled: !x.canReach,
					onclick: () => actions.showMatch(c.id, a, m.current),
				},
				"Show",
			)
		: null;
	const body = h(
		"div",
		{ class: "body", id: bodyId },
		picturesView(c, a, x),
		historyList(a),
		findingsList(c, a, x.findingArmed, actions),
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
		edit
			? edit.mode === "resolve"
				? resolveForm(c, a, edit.kind, edit.text, actions)
				: edit.mode === "reopen"
					? reopenForm(c, a, edit.text, actions)
					: commentForm(c, a, edit.text, actions)
			: markActions(c, a, x.armed, actions),
	);
	const sub = markSubline(c, a, m, edit === undefined, actions, x.elsewhere);
	li.append(
		h("div", { class: "mark-head" }, toggle, show),
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

/**
 * A mark's head, second row: its status, where it is on the tab in front,
 * its AI findings; why it came back, for a reopened one. A mark to verify
 * offers Verified and Reopen… here, so verifying needs no expanding.
 */
function markSubline(
	c: Case,
	a: Mark,
	m: MarkMatch | undefined,
	buttons: boolean,
	actions: Actions,
	elsewhere = false,
): HTMLElement | null {
	const status = markStatus(a);
	const pill = PILL[status];
	const last = a.reopens?.at(-1);
	const where = elsewhere ? "On another page" : matchWord(m);
	const findings = a.findings?.length ?? 0;
	// The thread's comments about this mark (DEC-046).
	const talk = commentCount(c, a.id);
	const parts = [
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
		where ? h("span", { class: "state" }, where) : null,
		findings > 0
			? h(
					"span",
					{ class: "tag findings-count" },
					`${findings} AI finding${findings === 1 ? "" : "s"}`,
				)
			: null,
		// Only what was added: the screenshot every mark has is not counted.
		(a.images?.length ?? 0) > 0
			? h(
					"span",
					{ class: "tag images-count" },
					`+${a.images?.length} image${a.images?.length === 1 ? "" : "s"}`,
				)
			: null,
		talk > 0
			? h(
					"span",
					{ class: "tag comments-count" },
					`${talk} comment${talk === 1 ? "" : "s"}`,
				)
			: null,
		status === "fixed" && buttons
			? h(
					"span",
					{ class: "head-actions" },
					verifyButton(c, a, actions),
					reopenButton(c, a, actions),
				)
			: null,
	].filter((x) => x !== null);
	return parts.length > 0 ? h("div", { class: "mark-sub" }, ...parts) : null;
}

/** When a finding was written, and last changed. */
function findingTime(at: string, editedAt: string | undefined): string {
	return editedAt
		? `${formatDate(at)}, edited ${formatDate(editedAt)}`
		: formatDate(at);
}

/**
 * The AI apps' findings on a mark, under the user's comment and apart from
 * it: each with its app and time, and a Delete that asks once more.
 */
function findingsList(
	c: Case,
	a: Mark,
	armed: string | undefined,
	actions: Actions,
): HTMLElement | null {
	const findings = a.findings ?? [];
	if (findings.length === 0) return null;
	return h(
		"section",
		{ class: "findings", "aria-label": `AI findings on mark ${a.number}` },
		h("h3", {}, "AI findings"),
		h(
			"ul",
			{},
			...findings.map((f) =>
				h(
					"li",
					{ "data-finding": f.id },
					h("p", { class: "finding-text" }, f.text),
					h(
						"div",
						{ class: "finding-meta" },
						h(
							"span",
							{ class: "meta" },
							`${f.user ? byline(f.user, f.app) : appLabel(f.app)}${f.imported ? ", as the file says" : ""}, ${findingTime(f.at, f.editedAt)}`,
						),
						h(
							"button",
							{
								type: "button",
								class: "small danger",
								"data-finding-action": "delete",
								"aria-label":
									armed === f.id
										? `Really delete this finding on mark ${a.number}?`
										: `Delete this finding on mark ${a.number}`,
								title:
									armed === f.id
										? "Click again to delete this finding"
										: "Delete this AI finding (click twice); the mark and your comment stay",
								...(armed === f.id ? { "data-armed": true } : {}),
								onclick: () => actions.deleteFinding(c, a, f.id),
							},
							armed === f.id ? "Really delete?" : "Delete finding",
						),
					),
				),
			),
		),
	);
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
	stopAi.hidden = !(ai.active && ai.connected && ai.apps > 0);
	keepOn.checked = ai.keepOn;
	setHint(aiCall, ai.lastCall && callText(ai.lastCall));
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
	lastActions = actions;
	renderSyncBanner(state, actions);
	renderCloudBanner(state, actions);
	renderAi(state);
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
		holdDelete(undefined);
		caseView.replaceChildren();
	}
	// Under an open case and Settings too: Home is as it is when it shows
	// again ("← All cases", or a case the panel opened from the page).
	renderHome(state, actions);
}
