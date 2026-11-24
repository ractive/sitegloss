/**
 * The side panel's one state (DEC-011): everything it shows comes from here,
 * and only `update` changes it, which schedules one `render`. Asynchronous
 * work (reading the store, asking the tab) ends in an `update`; a newer piece
 * of work for the same thing makes an older one drop its result (`Latest`).
 */

import {
	type Case,
	markFor,
	type ResolveChoice,
	type StatusGroup,
} from "../lib/case.ts";
import type { CloudStatus, SyncMode } from "../lib/cloud/book.ts";
import type { CheckedExport } from "../lib/export.ts";
import type { MarkMatch, OverlayState } from "../lib/messages.ts";
import type { SyncStatus, SyncTargetKind } from "../lib/sync.ts";
import type { Copied } from "./next-step.ts";
import type { ChosenPage } from "./page-filter.ts";
import type { Size } from "./size.ts";

export interface MarkEdit {
	markId: string;
	/**
	 * Which mark the form was opened on (`markKey`): its id can come to be
	 * another mark's while the form is open (the team's sync renumbers).
	 */
	mark: string;
	/** Resolve… or Change…, Edit comment, or Reopen… with its note (DEC-023). */
	mode: "resolve" | "comment" | "reopen";
	/** The status chosen (resolve). */
	kind: ResolveChoice;
	/** The note (resolve, reopen) or the comment (comment), as typed. */
	text: string;
}

export interface TabInfo {
	id: number;
	url: string;
	title: string;
	/** In CSS pixels, as a case's viewport; unknown where Chrome does not say. */
	size: Size | undefined;
	/** Still loading: an address not known yet says nothing about access. */
	loading?: boolean;
	/**
	 * A page no extension may run on (DEC-076): the browser's refusal said
	 * so (`page`: a store, a page of its own, a PDF's viewer), or it is a
	 * file and files are not allowed (`file`, Firefox, which tells the
	 * address). No click and no all sites helps.
	 */
	cannotRun?: "page" | "file";
}

/** The case loaded onto a tab, and where its marks were found there. */
export interface Loaded {
	caseId: string;
	tabId: number;
	matches: Map<string, MarkMatch>;
	/** The page's address where they were found. */
	url: string;
	/** The marks not found are looked for again in a moment. */
	settling?: boolean;
}

/**
 * Under the open case's buttons: a sentence, or `found`, what the panel's
 * draw found there, which the case view words from `loaded` as it is now
 * (`foundLine`): a mark saved since counts as the next draw would count it.
 */
export type CaseHint = string | { kind: "found" };

/** Object URLs of one version of a case's images, by path. */
export interface CaseImages {
	caseId: string;
	version: string;
	urls: Map<string, string>;
}

/** Where the last export went, as Chrome told (DEC-020). */
export interface Exported {
	/** The case exported, or every case. */
	of: { caseId: string } | "all";
	downloadId: number;
	/** The file's absolute path. */
	path: string;
}

/** A file of several cases being imported, one after the other. */
export interface ImportBatch {
	/** The file's name. */
	name: string;
	/** The cases still to import, after the one asked about. */
	rest: CheckedExport[];
	total: number;
	stored: number;
	skipped: number;
}

/** An AI app's last tool call. */
export interface AiCall {
	/** The tool's title. */
	tool: string;
	app: string;
	/** `Date.now()` when it came. */
	at: number;
}

export type AiProblem = "tab" | "updated" | "unavailable" | "connection";

export interface PanelState {
	tab: TabInfo | undefined;
	overlay: OverlayState | undefined;
	/** Under "This page". */
	hint: string | undefined;
	/**
	 * The list takes the focus once per `seq` (a case the person's own press
	 * closed): on the case's card if it is on screen, else on the list's
	 * heading.
	 */
	homeFocus: { seq: number; caseId: string | undefined };
	cases: Case[];
	view: { kind: "home" } | { kind: "case"; id: string };
	/**
	 * The Settings view (the AI app card) is drawn instead of
	 * the view underneath, which stays as it is: an open case stays open.
	 */
	settings: boolean;
	/**
	 * "← All cases" at work (DEC-023): the toolbar adding to the case is
	 * finishing; or it could not, with marks not in the case yet, and the
	 * next click leaves without them.
	 */
	leaving:
		| { phase: "finishing" }
		| { phase: "blocked"; left: number }
		| undefined;
	/**
	 * Tabs the user took the open case's marks off ("Hide marks"): they are
	 * not drawn there again by themselves until "Show marks", or the case is
	 * opened again (DEC-022).
	 */
	hiddenOn: Set<number>;
	/** The panel is drawing the open case's marks on this tab now. */
	drawing: number | undefined;
	/** A mark's Show is drawing the case's marks first: that mark's button is busy. */
	showingMark: { caseId: string; markId: string } | undefined;
	/** The open case, once read. */
	current: Case | undefined;
	images: CaseImages | undefined;
	/** Under the open case's buttons. */
	caseHint: CaseHint | undefined;
	/**
	 * One more for every hint an action writes, the same words again too:
	 * the line is written anew, so a second failure is said again
	 * (DEC-064's second review).
	 */
	caseHintSeq: number;
	loaded: Loaded | undefined;
	/**
	 * An import that would replace a case that is here already; in a file of
	 * several cases, with the rest of them.
	 */
	importing:
		| { parsed: CheckedExport; existing: Case; batch?: ImportBatch }
		| undefined;
	/**
	 * Why the last import or "Export all cases" failed, until the next one or a
	 * dismiss.
	 */
	importError: string | undefined;
	/**
	 * What an import is at work on (a file's name, or the case asked about),
	 * while it reads or stores; no other import starts meanwhile.
	 */
	importWork: string | undefined;
	/** What importing a file of several cases came to, until the next import. */
	importDone: string | undefined;
	/** "Export all cases" is at work. */
	exportingAll: boolean;
	/** Where the last export went, when Chrome told; until the next one. */
	exported: Exported | undefined;
	/** Chrome's prompt for "downloads" is open for this export. */
	askingDownloads: Exported["of"] | undefined;
	/** Sitegloss may use chrome.downloads (DEC-020). */
	downloads: boolean;
	/** When "Delete" was clicked once. */
	deleteArmedAt: number | undefined;
	/** A mark of the open case being resolved or its comment edited. */
	markEdit: MarkEdit | undefined;
	/**
	 * The open case's title being changed (DEC-026): the text typed, and why
	 * the last save failed.
	 */
	renaming: { caseId: string; text: string; error?: string } | undefined;
	/**
	 * The open case's link being added or changed (DEC-028): the text typed,
	 * and why the last save failed or the text is no link.
	 */
	linking: { caseId: string; text: string; error?: string } | undefined;
	/**
	 * The status chip pressed: the open case's list shows only those marks,
	 * while there are any and no mark above `upTo` (the highest number when
	 * it was pressed) was added.
	 */
	markFilter: { caseId: string; group: StatusGroup; upTo: number } | undefined;
	/**
	 * The page filter of the open case's list (`page-filter.ts`): this page
	 * (it follows the tab) or one page of the case; none: all pages.
	 */
	markPage: ChosenPage | undefined;
	/**
	 * The mark whose pin was clicked on the page (DEC-027): the list opens it
	 * and brings it into view, once per click (`at`).
	 */
	picked:
		| {
				caseId: string;
				markId: string;
				at: number;
				/** Its head takes the focus: the button that asked went (This page's Start verifying). */
				focus?: true;
		  }
		| undefined;
	/**
	 * "Start verifying" pressed on This page (DEC-079): the case it opens,
	 * until that case is read; then the next step's Start verifying runs.
	 */
	verifyOnOpen: string | undefined;
	/**
	 * What the next step's last copy did (DEC-069), said in its block for
	 * a few seconds (`COPIED_MS` in main.ts), or until the next copy.
	 */
	copied: (Copied & { caseId: string; at: number }) | undefined;
	/**
	 * "My cases" in the list of cases (DEC-071): only the cases where it is
	 * the person's turn. Kept for the browser's session.
	 */
	mine: boolean;
	/** A mark's Delete, clicked once: the second click deletes. */
	markDeleteArmed: { markId: string; mark: string; at: number } | undefined;
	/**
	 * A finding's Delete, clicked once: the second click deletes. A finding's
	 * id is unique on its mark only (a case from a file).
	 */
	findingDeleteArmed:
		| { markId: string; mark: string; findingId: string; at: number }
		| undefined;
	/** An added image's Remove, clicked once: the second click removes it (DEC-058). */
	imageDeleteArmed:
		| { markId: string; mark: string; imageId: string; at: number }
		| undefined;
	/**
	 * Next to "Save summary": "Saved", or why not. The summary for the
	 * developer is stored as `verdict` (DEC-019).
	 */
	verdictStatus: string | undefined;
	/** Summaries typed and not saved yet, by case. */
	verdictDrafts: Map<string, string>;
	/** Sitegloss may run on every site ("Allow on all sites"). */
	allSites: boolean;
	/**
	 * The person said "Not now" to the offer of all sites, or took all sites
	 * back: the offer does not come again (DEC-076). Kept in this browser.
	 */
	allSitesDeclined: boolean;
	/** The browser has answered whether Sitegloss may run on all sites. */
	allSitesKnown: boolean;
	/** The shortcut that clicks the icon, as the browser has it (`commands.getAll`). */
	shortcut: string | undefined;
	/** Sitegloss may read file:// pages ("Allow access to file URLs"); unknown at first. */
	fileAccess: boolean | undefined;
	/** The sync to Downloads or a folder (DEC-021, DEC-025). */
	sync: {
		/** Where it writes; `undefined`: not syncing. */
		target: SyncTargetKind | undefined;
		/** `downloads`, or the folder's id. */
		targetId: string | undefined;
		/** The folder's name, when syncing to a folder. */
		folder: string | undefined;
		/** The worker's status for this target, once it has one. */
		status: SyncStatus | undefined;
		/** What the panel itself could not do (the picker, the database). */
		problem: string | undefined;
		/** Chrome's prompt for downloads is open. */
		asking: boolean;
		/** "Change…": the Off state's buttons, while the target keeps running. */
		changing: boolean;
		/** The user said no to Allow access or Allow downloads. */
		refused: boolean;
	};
	/** The account at sitegloss.dev and the sync with a team (DEC-039). */
	cloud: {
		/** The server chosen: the service's address, unless another was chosen (DEC-041). */
		server: string;
		/** Who is signed in; `undefined`: nobody. */
		account:
			| {
					name: string;
					email: string;
					userId: string;
					/** Where they are signed in. */
					server: string;
					/** Their teams, with what they may do in each (`case:create`, …). */
					teams: {
						id: string;
						name: string;
						/** Its part of the web app's addresses (`/t/<slug>/…`); none from a server before it. */
						slug?: string;
						permissions: string[];
					}[];
					/** The team the cases sync with; none chosen yet: `undefined`. */
					teamId: string | undefined;
					/** The server refused the sign-in: sign in again. */
					expired: boolean;
			  }
			| undefined;
		/** What the worker's sync is at, once it has run. */
		status: CloudStatus | undefined;
		/** How each case syncs, by its id; one not named was made since. */
		modes: Record<string, SyncMode>;
		/**
		 * The cases the server has, as the sync last knew it, by id: the
		 * team's id (DEC-069). None named: not known to be there.
		 */
		atTeam: Record<string, string>;
		/**
		 * The chosen team's members, to assign a case to (DEC-071), as the
		 * server last listed them; none: not known, or the server lists none.
		 */
		members: { id: string; name: string }[] | undefined;
		/** The browser's sign-in window is open. */
		signingIn: boolean;
		/** What the panel itself could not do (the sign-in, the address). */
		problem: string | undefined;
		/**
		 * The team's events stream, as this panel listens to it: open (what
		 * the team changes arrives at once), closed for a while, or not
		 * known yet (`undefined`: it is being opened).
		 */
		live: boolean | undefined;
		/** The minute it is: a time said as "5 minutes ago" is said anew. */
		minute: number;
	};
	ai: {
		status: string;
		connected: boolean;
		/** How many AI apps are paired, while connected. */
		apps: number;
		/** Connected, or on the way there: something "Stop AI access" can end. */
		active: boolean;
		/**
		 * `status` says that something is wrong or what the user has to do
		 * (DEC-024): the pill says so in red and the sentence shows under the
		 * top bar. `tab`: this page is no side panel; `updated`: the panel
		 * belongs to the version before; `unavailable`: the worker's
		 * connection could not start; `connection`: it failed, was lost or was
		 * taken over.
		 */
		problem: AiProblem | undefined;
		/** "Keep AI access on". */
		keepOn: boolean;
		lastCall: AiCall | undefined;
		/** An AI app's tool call is running (DEC-063). */
		working: boolean;
		/**
		 * The AI app that was just paired in the open card, while it stays
		 * connected and the card stays open: what to do next is said there
		 * (DEC-045).
		 */
		justPaired?: { grantId: string; name: string };
	};
}

export const initialState = (): PanelState => ({
	tab: undefined,
	overlay: undefined,
	hint: undefined,
	homeFocus: { seq: 0, caseId: undefined },
	cases: [],
	view: { kind: "home" },
	settings: false,
	leaving: undefined,
	hiddenOn: new Set(),
	drawing: undefined,
	showingMark: undefined,
	current: undefined,
	images: undefined,
	caseHint: undefined,
	caseHintSeq: 0,
	loaded: undefined,
	importing: undefined,
	importError: undefined,
	importWork: undefined,
	importDone: undefined,
	exportingAll: false,
	exported: undefined,
	askingDownloads: undefined,
	downloads: false,
	deleteArmedAt: undefined,
	markEdit: undefined,
	renaming: undefined,
	linking: undefined,
	markFilter: undefined,
	markPage: undefined,
	picked: undefined,
	verifyOnOpen: undefined,
	copied: undefined,
	mine: false,
	markDeleteArmed: undefined,
	findingDeleteArmed: undefined,
	imageDeleteArmed: undefined,
	verdictStatus: undefined,
	verdictDrafts: new Map(),
	allSites: false,
	allSitesDeclined: false,
	allSitesKnown: false,
	shortcut: undefined,
	fileAccess: undefined,
	sync: {
		target: undefined,
		targetId: undefined,
		folder: undefined,
		status: undefined,
		problem: undefined,
		asking: false,
		changing: false,
		refused: false,
	},
	cloud: {
		server: "https://app.sitegloss.dev",
		account: undefined,
		status: undefined,
		modes: {},
		atTeam: {},
		members: undefined,
		signingIn: false,
		problem: undefined,
		live: undefined,
		minute: 0,
	},
	ai: {
		status: "Not connected",
		connected: false,
		apps: 0,
		active: false,
		problem: undefined,
		keepOn: false,
		lastCall: undefined,
		working: false,
	},
});

/** The state and its one way to change. */
export class Panel {
	readonly state: PanelState = initialState();
	readonly #render: (state: PanelState) => void;
	#scheduled = false;

	constructor(render: (state: PanelState) => void) {
		this.#render = render;
	}

	/** Change the state; the panel renders once, after the current task. */
	update(change: (state: PanelState) => void): void {
		change(this.state);
		if (this.#scheduled) return;
		this.#scheduled = true;
		queueMicrotask(() => {
			this.#scheduled = false;
			this.#render(this.state);
		});
	}
}

export { Latest } from "../lib/latest.ts";

/**
 * The open form after the case changed: still on its mark, also when that
 * mark has another id now (the team's sync gave it another number, and
 * the id it had is a teammate's mark). Closed when the mark is gone.
 */
export function editAfter(
	edit: MarkEdit | undefined,
	c: Case | undefined,
): MarkEdit | undefined {
	if (edit === undefined || c === undefined) return edit;
	const now = markFor(c, edit.markId, edit.mark);
	// Gone, or not to be told from another mark: nothing to hold a form to.
	if (now === undefined || now === "ambiguous") return undefined;
	return now.id === edit.markId ? edit : { ...edit, markId: now.id };
}

/**
 * What is held on a mark by its id (a delete asked once, a finding's) after
 * the case changed: still on its mark, under the id the mark has now; gone
 * when the mark is, or cannot be told from another. A "Really delete?" must
 * not be waiting on a teammate's mark that got the id.
 */
export function heldAfter<T extends { markId: string; mark: string }>(
	held: T | undefined,
	c: Case | undefined,
): T | undefined {
	if (held === undefined || c === undefined) return held;
	const now = markFor(c, held.markId, held.mark);
	if (now === undefined || now === "ambiguous") return undefined;
	return now.id === held.markId ? held : { ...held, markId: now.id };
}
