/**
 * Loading a case onto the page in front: each mark's element is looked
 * for by its details (match.ts) and its mark drawn again on that element, moved
 * and scaled with it: solid when found, dashed when only probable or tied; its
 * colour is its status (DEC-024). A mark without an element goes where it was. An element that a
 * re-render replaced afterwards is looked for again.
 */

import { PANEL } from "../lib/browser.ts";
import {
	type Candidate,
	createSearch,
	findCandidates,
	type PageSearch,
} from "../lib/candidates.ts";
import {
	type Case,
	caseCounts,
	MARK_CHANGED,
	MAX_COMMENT,
	MAX_REOPEN_NOTE,
	type Mark,
	type MarkStatus,
	markFor,
	markKey,
	markStatus,
	onPageInFront,
	pageInFront,
	pageKey,
	RESOLUTION_LABEL,
	RESOLVE_CHOICES,
	type Rect,
	type ResolveChoice,
	type Shape,
	STATUS_LABEL,
	shapeBounds,
	shapeOnBox,
	translateShape,
} from "../lib/case.ts";
import {
	cssSelector,
	type DescribeContext,
	describeElement,
	summarize,
} from "../lib/element.ts";
import { clearTextCache } from "../lib/match.ts";
import type {
	CandidateInfo,
	LoadResult,
	MarkAnswer,
	MarkMatch,
	MarkRequest,
} from "../lib/messages.ts";
import {
	type Overlay,
	type ReviewItem,
	reviewColour,
	ring,
} from "./overlay.ts";

interface Entry {
	mark: Mark;
	/** The best elements worth showing, best first. */
	candidates: Candidate[];
	match: MarkMatch;
}

/** Asks the side panel that shows the case (DEC-027). */
export type AskPanel = (request: MarkRequest) => Promise<MarkAnswer>;

/** No panel shows the case: nothing changes it from the page. */
export const NO_PANEL = `Open this case in Sitegloss's ${PANEL} to change its marks.`;

const askPanel: AskPanel = async (request) => {
	try {
		const answer = (await chrome.runtime.sendMessage(request)) as
			| MarkAnswer
			| undefined;
		return answer ?? { ok: false, error: NO_PANEL };
	} catch {
		return { ok: false, error: NO_PANEL };
	}
};

// The test build's guards and delays below are short (DEC-053): its clicks
// and pages come fast, and its tests need not sit them out.
declare const SITEGLOSS_TEST_BUILD: boolean | undefined;

/** How long "Really delete?" waits for its second click. */
export const DELETE_ARMED_MS = 4000;
/** A double click is no second thought. */
const DELETE_CLICK_GAP_MS =
	typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD
		? 100
		: 400;

/** How long one tick looks again for the marks a route did not have. */
const STALE_BUDGET_MS = 25;

/** The four ways Resolve… and Change… settle a mark, as the panel says them. */
const CHOICE_LABEL: Record<ResolveChoice, string> = {
	fixed: "Fixed, to verify",
	verified: "Fixed and verified",
	wontfix: RESOLUTION_LABEL.wontfix,
	cantreproduce: RESOLUTION_LABEL.cantreproduce,
};

/**
 * The popover of a loaded mark, open on the page (DEC-027): its comment with
 * the mark's commands, or the form of one of them.
 */
interface OpenMark {
	/** The mark's id as it is now: it follows the mark when the id changes. */
	markId: string;
	/**
	 * Which mark the popover was opened on (`markKey`). The team's sync can
	 * give the mark another number while the popover is open, and the id it
	 * had is then a teammate's mark: the popover follows its mark, and what
	 * it asks names the mark, not only the id.
	 */
	mark: string;
	/** The case has more than one mark this could be: nothing is asked for it. */
	lost?: boolean;
	mode: "main" | "resolve" | "reopen";
	/** The comment as the case has it, and as typed here. */
	base: string;
	draft: string;
	/** The status its commands were drawn for. */
	status: MarkStatus;
	/** Of the view shown now. */
	field: HTMLTextAreaElement | undefined;
	problem: HTMLElement;
	controls: HTMLButtonElement[];
	remove: HTMLButtonElement | undefined;
	armedAt: number | undefined;
	busy: boolean;
}

/** The comment as typed: read from its field while that is the view shown. */
function typed(open: OpenMark): string {
	if (open.field !== undefined) open.draft = open.field.value;
	return open.draft;
}

/** Let the page run between marks: loading a big case takes a while. */
const yieldToPage = () => new Promise<void>((r) => setTimeout(r, 0));

/** The same mark, as far as the page is concerned: where and on what. */
function sameMark(a: Mark, b: Mark): boolean {
	return (
		a.shot === b.shot &&
		JSON.stringify(a.shape) === JSON.stringify(b.shape) &&
		JSON.stringify(a.element) === JSON.stringify(b.element)
	);
}

/**
 * A load stopped by a clear (the panel's or the page's own Hide) or by a load
 * of another case: no failure, its marks are simply not the page's now.
 */
export class LoadReplaced extends Error {
	constructor() {
		super("Loading was replaced by another one.");
	}
}

export class Reviewer {
	readonly overlay: Overlay;
	#case: Case | undefined;
	#entries: Entry[] = [];
	#focused: string | undefined;
	#frame = 0;
	#timer: ReturnType<typeof setInterval> | undefined;
	/** A newer load or a clear stops a load that is still running. */
	#generation = 0;
	/** Which page (`pageKey`) the marks were last looked for on. */
	#page = "";
	/**
	 * Marks to look for again: the address changed within the page (a
	 * single-page app went on to its next route), and a mark that was not
	 * there may be now.
	 */
	readonly #stale = new Set<Entry>();
	/** Looks still to take for a route's content that comes late; ticks until the next. */
	#late = { looks: 0, ticks: 0 };
	/** The case a load is finding marks for now, and a newer version of it. */
	#loading: { caseId: string } | undefined;
	#newer: Case | undefined;
	/** The newest load: an older one of the same case ends with its result. */
	#latest: { caseId: string; run: Promise<LoadResult> } | undefined;
	/** The mark whose popover is open (DEC-027). */
	#open: OpenMark | undefined;
	readonly #ask: AskPanel;
	/** How often the page is looked at without a scroll: 500 ms, unless a unit test gives its own. */
	readonly #tickMs: number;

	constructor(
		overlay: Overlay,
		ask: AskPanel = askPanel,
		options: { tickMs?: number } = {},
	) {
		this.overlay = overlay;
		this.#ask = ask;
		this.#tickMs = options.tickMs ?? 500;
		overlay.onPick = (number) => this.pick(number);
		const doc = overlay.doc;
		// Capture phase: scrolling inside a container moves elements too.
		doc.addEventListener("scroll", () => this.#schedule(), {
			capture: true,
			passive: true,
		});
		doc.defaultView?.addEventListener("resize", () => this.#schedule());
	}

	get caseId(): string | undefined {
		return this.#case?.id;
	}

	/** The case a load is finding marks for now, if one is under way. */
	get loadingCaseId(): string | undefined {
		return this.#loading?.caseId;
	}

	/**
	 * Find the case's elements and draw its marks. Two loads of the same case
	 * close together (the side panel's draw, an AI app's load_case, a search
	 * again) both end with the newest one's result; a load stopped by a clear
	 * or by another case's load rejects with `LoadReplaced`.
	 */
	load(c: Case): Promise<LoadResult> {
		const run: Promise<LoadResult> = this.#loadOnce(c).catch(
			(error: unknown) => {
				const newest = this.#latest;
				if (
					error instanceof LoadReplaced &&
					newest !== undefined &&
					newest.run !== run &&
					newest.caseId === c.id
				)
					// Its marks are that load's: the caller of this one may be done
					// with the case and must not take them off.
					return newest.run.then((r) => ({ ...r, adopted: true as const }));
				throw error;
			},
		);
		this.#latest = { caseId: c.id, run };
		void run
			.finally(() => {
				if (this.#latest?.run === run) this.#latest = undefined;
			})
			.catch(() => undefined);
		return run;
	}

	async #loadOnce(c: Case): Promise<LoadResult> {
		const loading = { caseId: c.id };
		this.#loading = loading;
		this.#newer = undefined;
		try {
			const result = await this.#load(c);
			const newer = this.#newer;
			this.#newer = undefined;
			this.#loading = undefined;
			if (newer === undefined) return result;
			const generation = this.#generation;
			const updated = await this.update(newer);
			// Stopped while it drew the newer copy: its first result is gone too.
			if (generation !== this.#generation) throw new LoadReplaced();
			return updated ?? result;
		} finally {
			// A newer load's, if one started meanwhile.
			if (this.#loading === loading) this.#loading = undefined;
		}
	}

	async #load(c: Case): Promise<LoadResult> {
		const generation = ++this.#generation;
		clearTextCache(); // what an abandoned load left behind
		const search = this.#search();
		const entries: Entry[] = [];
		for (const mark of [...c.marks].sort((a, b) => a.number - b.number)) {
			await yieldToPage();
			if (generation !== this.#generation) throw new LoadReplaced();
			entries.push(this.#find(search, mark, c));
		}
		this.#closeMark();
		this.#case = c;
		this.#entries = entries;
		this.#page = pageKey(location.href);
		this.#stale.clear();
		this.#late = { looks: 0, ticks: 0 };
		this.#focused = undefined;
		this.overlay.setReviewing(true);
		clearInterval(this.#timer);
		// Layout changes (lazy content, accordions) move elements without a scroll.
		this.#timer = setInterval(() => {
			this.#checkPage();
			// One search a tick: a new route replaces every element at once.
			const replaced = this.#entries.find((e) => this.#replaced(e));
			if (replaced !== undefined) this.#findAgain(replaced);
			// The marks the last route did not have, a few a tick.
			else this.#lookAgain(STALE_BUDGET_MS);
			this.#schedule();
		}, this.#tickMs);
		this.#renderBar();
		this.#render();
		clearTextCache();
		return {
			caseId: c.id,
			url: location.href,
			matches: entries.map((e) => e.match),
		};
	}

	/**
	 * The loaded case changed (a mark settled, edited, deleted or added): its
	 * marks follow, and the candidates chosen stay for marks still the same.
	 * `null` when another case, or none, is loaded. A load of the case still
	 * running takes the newer version when it is done.
	 */
	async update(c: Case): Promise<LoadResult | null> {
		if (this.#loading?.caseId === c.id) {
			this.#newer = c;
			return null;
		}
		if (this.#case?.id !== c.id) return null;
		const generation = this.#generation;
		const byId = new Map(c.marks.map((a) => [a.id, a]));
		const kept: Entry[] = [];
		const search: Mark[] = [];
		for (const e of this.#entries) {
			const mark = byId.get(e.mark.id);
			if (mark === undefined) continue;
			// A replaced copy (an import) may give the id to another mark.
			if (sameMark(mark, e.mark)) {
				const next = { ...e, mark };
				// Still to be looked for again, as the entry it replaces was.
				if (this.#stale.delete(e)) this.#stale.add(next);
				kept.push(next);
			} else search.push(mark);
		}
		const known = new Set(this.#entries.map((e) => e.mark.id));
		search.push(...c.marks.filter((a) => !known.has(a.id)));
		if (search.length > 0) {
			const page = this.#search();
			for (const mark of search) {
				await yieldToPage();
				if (generation !== this.#generation || this.#case?.id !== c.id)
					return null;
				kept.push(this.#find(page, mark, c));
			}
			kept.sort((a, b) => a.mark.number - b.mark.number);
			clearTextCache();
		}
		this.#case = c;
		this.#entries = kept;
		if (this.#focused !== undefined && !byId.has(this.#focused))
			this.#focused = undefined;
		this.#follow(c);
		this.#renderBar();
		this.#render();
		return {
			caseId: c.id,
			url: location.href,
			matches: kept.map((e) => e.match),
		};
	}

	#search(): PageSearch {
		return createSearch(this.overlay.doc, { exclude: this.overlay.host });
	}

	/**
	 * The address changed within the page to another page (`pageKey`): the
	 * marks that were not found are looked for again (the next route of a
	 * single-page app has the next page's marks, finding 1 of DEC-038's
	 * review), and which mark is on its own page is judged anew.
	 */
	#checkPage(): void {
		const page = pageKey(location.href);
		if (page === this.#page || this.#case === undefined) return;
		this.#page = page;
		for (const entry of this.#entries) {
			if (entry.match.status === "lost") this.#stale.add(entry);
			else this.#judgePage(entry);
		}
		// A route's content often comes after its address.
		this.#late = { looks: 2, ticks: 3 };
		this.#renderBar();
		this.#render();
	}

	/** Look for stale marks again, for `budget` ms at most; whether any is left. */
	#lookAgain(budget: number): boolean {
		if (this.#stale.size === 0) {
			// Once more, a moment later, for this page's marks still not there.
			if (this.#late.looks === 0 || --this.#late.ticks > 0) return false;
			this.#late = { looks: this.#late.looks - 1, ticks: 3 };
			for (const entry of this.#entries)
				if (entry.match.status === "lost" && this.#own(entry.mark))
					this.#stale.add(entry);
			if (this.#stale.size === 0) return false;
		}
		const until = performance.now() + budget;
		const search = this.#search();
		for (const entry of [...this.#stale]) {
			this.#stale.delete(entry);
			if (this.#entries.includes(entry)) {
				const fresh = this.#find(search, entry.mark);
				entry.candidates = fresh.candidates;
				entry.match = fresh.match;
			}
			if (performance.now() >= until) break;
		}
		clearTextCache();
		this.#renderBar();
		this.#render();
		return this.#stale.size > 0;
	}

	/**
	 * The loaded case's marks on the page as it is now, for the panel: after
	 * the address changed within the page, the marks not there before are
	 * looked for first. `null` when another case, or none, is loaded.
	 */
	async matches(caseId: string): Promise<LoadResult | null> {
		if (this.#case?.id !== caseId) return null;
		const generation = this.#generation;
		this.#checkPage();
		// A new route replaced the elements: those marks are looked for too,
		// now, not one a tick.
		for (const entry of this.#entries)
			if (this.#replaced(entry)) this.#stale.add(entry);
		while (this.#lookAgain(STALE_BUDGET_MS)) {
			await yieldToPage();
			if (generation !== this.#generation || this.#case?.id !== caseId)
				return null;
		}
		return {
			caseId,
			url: location.href,
			matches: this.#entries.map((e) => e.match),
		};
	}

	/**
	 * Whether the mark's own page is the page in front: by path and hash
	 * route, whatever the host (DEC-050).
	 */
	#own(mark: Mark, c: Case | undefined = this.#case): boolean {
		return c !== undefined && onPageInFront(c, mark, location.href);
	}

	/**
	 * Say of a found mark whether it is on another page of the case than its
	 * own (DEC-038): on the cart, a find of the payment page's mark may be a
	 * look-alike. On a page that is none of the case's nothing is said: the
	 * user loaded the case there, and every mark is looked for as on its own
	 * page (the page in another version, under another path).
	 */
	#judgePage(entry: Entry, c: Case | undefined = this.#case): void {
		const { otherPage: _was, ...match } = entry.match;
		const found = match.status !== "lost" && match.status !== "no-element";
		entry.match =
			found &&
			c !== undefined &&
			pageInFront(c, location.href) !== undefined &&
			!this.#own(entry.mark, c)
				? { ...match, otherPage: true }
				: match;
	}

	#find(
		search: PageSearch,
		mark: Mark,
		c: Case | undefined = this.#case,
	): Entry {
		const entry = this.#findOnPage(search, mark);
		this.#judgePage(entry, c);
		return entry;
	}

	#findOnPage(search: PageSearch, mark: Mark): Entry {
		const base = {
			markId: mark.id,
			number: mark.number,
			current: 0,
		};
		const stored = mark.element;
		if (stored === null)
			return {
				mark,
				candidates: [],
				match: { ...base, status: "no-element", score: 0, candidates: [] },
			};
		const found = findCandidates(search, stored);
		const { status, candidates, truncated } = found;
		return {
			mark,
			candidates,
			match: {
				...base,
				status,
				score: found.score,
				candidates: candidates.map((k) => this.#info(k, search.context)),
				...(truncated ? { truncated: true } : {}),
			},
		};
	}

	/** The shown element left the page: a re-render, or it is gone. */
	#replaced(entry: Entry): boolean {
		return this.#element(entry)?.isConnected === false;
	}

	/**
	 * The entry as the page has it now, for an answer about this one mark: its
	 * element left the page, or the address changed within the page and the
	 * mark was not looked for since.
	 */
	#fresh(entry: Entry): void {
		this.#checkPage();
		if (!this.#replaced(entry) && !this.#stale.has(entry)) return;
		this.#stale.delete(entry);
		this.#findAgain(entry);
	}

	#findAgain(entry: Entry): void {
		const fresh = this.#find(this.#search(), entry.mark);
		entry.candidates = fresh.candidates;
		entry.match = fresh.match;
		clearTextCache();
		this.#renderBar();
	}

	#info(candidate: Candidate, context: DescribeContext): CandidateInfo {
		const { element, score, found } = candidate;
		const rect = element.getBoundingClientRect();
		return {
			score: Math.round(score * 100) / 100,
			summary: summarize(
				describeElement(element, context, { selector: false }),
			),
			selector: cssSelector(element),
			visible: rect.width > 0 && rect.height > 0,
			found,
		};
	}

	/**
	 * Whether the mark under `markId` in the case as loaded here is the
	 * mark `key` names (`markKey`); a copy from before a renumbering has
	 * another mark there.
	 */
	holds(markId: string, key: string): boolean {
		const c = this.#case;
		const entry = this.#entries.find((e) => e.mark.id === markId);
		return (
			c !== undefined && entry !== undefined && markKey(c, entry.mark) === key
		);
	}

	/** Whether the loaded mark `markId` is a mark of the page in front (`onPageInFront`). */
	isOwn(markId: string): boolean {
		const entry = this.#entries.find((e) => e.mark.id === markId);
		return entry !== undefined && this.#own(entry.mark);
	}

	/** Scroll to a mark's element (or another candidate) and focus it. */
	show(markId: string, candidate?: number): MarkMatch | undefined {
		const entry = this.#entries.find((e) => e.mark.id === markId);
		if (entry === undefined) return undefined;
		this.#fresh(entry);
		const count = entry.candidates.length;
		if (candidate !== undefined && count > 0)
			entry.match.current = ((candidate % count) + count) % count;
		entry.match.score = entry.candidates[entry.match.current]?.score ?? 0;
		this.#focused = markId;
		const element = this.#element(entry);
		if (element !== undefined)
			element.scrollIntoView({
				block: "center",
				inline: "nearest",
				behavior: "instant",
			});
		else if (entry.match.status === "no-element") this.#scrollTo(entry.mark);
		this.overlay.setReviewing(true);
		this.#render();
		return entry.match;
	}

	/**
	 * The element a mark is drawn on now (looked for again when a
	 * re-render replaced it), without scrolling or focusing anything.
	 */
	target(
		markId: string,
	): { element: Element | undefined; match: MarkMatch } | undefined {
		const entry = this.#entries.find((e) => e.mark.id === markId);
		if (entry === undefined) return undefined;
		this.#fresh(entry);
		return { element: this.#element(entry), match: entry.match };
	}

	/** Bring a mark without an element to the middle of the window. */
	#scrollTo(mark: Mark): void {
		const win = this.overlay.doc.defaultView;
		if (win === null || this.#whereItWas(mark) === undefined) return;
		const b = shapeBounds(this.#stored(mark));
		win.scrollTo({
			left: b.x + b.width / 2 - win.innerWidth / 2,
			top: b.y + b.height / 2 - win.innerHeight / 2,
			behavior: "instant",
		});
	}

	/**
	 * A loaded mark's pin was clicked (DEC-027): its comment opens in the
	 * popover a new mark's comment is typed in, with the commands the panel
	 * has for it (Resolve…, Verified, Reopen…, Change…, Delete mark) and Done,
	 * and the side panel shows the mark.
	 */
	pick(number: number): void {
		const c = this.#case;
		const entry = this.#entries.find((e) => e.mark.number === number);
		if (c === undefined || entry === undefined) return;
		const { mark } = entry;
		// Open for this mark already: what is being typed stays.
		if (this.#open?.markId === mark.id && !this.overlay.popover.hidden) return;
		const open: OpenMark = {
			markId: mark.id,
			mark: markKey(c, mark),
			mode: "main",
			base: mark.comment,
			draft: mark.comment,
			status: markStatus(mark),
			field: undefined,
			problem: this.overlay.doc.createElement("p"),
			controls: [],
			remove: undefined,
			armedAt: undefined,
			busy: false,
		};
		this.overlay.openPopover([], () => {
			// Closed for another popover, or by a click beside it: a comment
			// typed is the mark's, as a new mark's is; a form half filled in
			// settles nothing.
			if (this.#open !== open) return;
			this.#open = undefined;
			const text = typed(open).trim();
			if (!open.busy && text !== open.base)
				void this.#ask({
					type: "mark:comment",
					caseId: c.id,
					markId: mark.id,
					text,
				});
		});
		this.#open = open;
		// Its element is outlined, as after the panel's Show.
		this.#focused = mark.id;
		this.#fill(open);
		void this.#ask({
			type: "mark:picked",
			caseId: c.id,
			markId: mark.id,
		});
	}

	/** The open popover's mark, as the case has it now. */
	#openMark(): { c: Case; open: OpenMark; mark: Mark } | undefined {
		const c = this.#case;
		const open = this.#open;
		if (c === undefined || open === undefined) return undefined;
		const mark = this.#entries.find((e) => e.mark.id === open.markId)?.mark;
		return mark === undefined ? undefined : { c, open, mark };
	}

	/** Draw the popover's view (`open.mode`) and put it at its mark. */
	#fill(open: OpenMark): void {
		const now = this.#openMark();
		if (now === undefined || now.open !== open) return;
		const { mark } = now;
		const doc = this.overlay.doc;
		// What was typed in the view that goes stays the draft.
		typed(open);
		open.controls = [];
		open.remove = undefined;
		open.armedAt = undefined;
		open.field = undefined;
		const problem = doc.createElement("p");
		problem.className = "problem";
		problem.setAttribute("role", "alert");
		problem.hidden = true;
		open.problem = problem;
		const button = (
			text: string,
			action: string,
			run: () => void,
			primary = false,
		) => {
			const b = doc.createElement("button");
			b.type = "button";
			if (primary) b.className = "primary";
			b.dataset["action"] = action;
			b.textContent = text;
			b.addEventListener("click", run);
			open.controls.push(b);
			return b;
		};
		const row = (className: string, ...children: Node[]) => {
			const div = doc.createElement("div");
			div.className = className;
			div.append(...children);
			return div;
		};
		const pin = doc.createElement("span");
		pin.className = "pin";
		pin.style.background = reviewColour({ status: open.status });
		pin.textContent = String(mark.number);
		const label = doc.createElement("div");
		label.className = "label";
		const back = () => {
			if (open.busy) return;
			open.mode = "main";
			this.#fill(open);
		};
		let content: Node[];
		let focus: HTMLElement;
		if (open.mode === "resolve") {
			label.append(pin, `Mark ${mark.number} is`);
			const name = `sitegloss-resolution-${mark.id}`;
			const chosen: ResolveChoice =
				open.status === "open" ? "fixed" : open.status;
			const choices = doc.createElement("div");
			choices.className = "choices";
			choices.setAttribute("role", "radiogroup");
			choices.setAttribute("aria-label", `Mark ${mark.number} is`);
			for (const kind of RESOLVE_CHOICES) {
				const radio = doc.createElement("input");
				radio.type = "radio";
				radio.name = name;
				radio.value = kind;
				radio.checked = kind === chosen;
				const choice = doc.createElement("label");
				choice.className = "choice";
				choice.append(radio, CHOICE_LABEL[kind]);
				choices.append(choice);
			}
			const note = doc.createElement("input");
			note.type = "text";
			note.className = "note";
			note.placeholder = "Note (optional): what was done, or why";
			note.maxLength = MAX_COMMENT;
			note.setAttribute("aria-label", `Note for mark ${mark.number}`);
			note.value = mark.resolution?.note ?? "";
			const save = () => {
				const kind = (choices.querySelector<HTMLInputElement>("input:checked")
					?.value ?? chosen) as ResolveChoice;
				void this.#settle(open, {
					type: "mark:resolve",
					caseId: now.c.id,
					markId: mark.id,
					kind,
					note: note.value,
				});
			};
			note.addEventListener("keydown", (e) => {
				if (e.key === "Enter") save();
				else if (e.key === "Escape") back();
			});
			content = [
				label,
				choices,
				note,
				problem,
				row(
					"row",
					button("Cancel", "mark-back", back),
					button("Save", "mark-resolve-done", save, true),
				),
			];
			focus = note;
		} else if (open.mode === "reopen") {
			label.append(pin, "Reopen");
			const note = doc.createElement("textarea");
			note.maxLength = MAX_REOPEN_NOTE;
			note.placeholder = "What is still wrong? The developer reads this first.";
			note.setAttribute(
				"aria-label",
				`What is still wrong with mark ${mark.number}`,
			);
			const reopen = () => {
				// The developer reads it first: a reopen says why.
				if (note.value.trim() === "") return;
				void this.#settle(open, {
					type: "mark:reopen",
					caseId: now.c.id,
					markId: mark.id,
					note: note.value,
				});
			};
			const done = button("Reopen", "mark-reopen-done", reopen, true);
			done.disabled = true;
			note.addEventListener("input", () => {
				if (!open.busy) done.disabled = note.value.trim() === "";
			});
			note.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) reopen();
				else if (e.key === "Escape") back();
			});
			content = [
				label,
				note,
				problem,
				row("row", button("Cancel", "mark-back", back), done),
			];
			focus = note;
		} else {
			label.append(pin, "Comment");
			if (open.status !== "open") {
				const state = doc.createElement("span");
				state.className = "state";
				state.textContent = STATUS_LABEL[open.status];
				label.append(state);
			}
			const field = doc.createElement("textarea");
			field.setAttribute("aria-label", `Comment of mark ${mark.number}`);
			field.placeholder = "What is wrong, or what should change?";
			field.maxLength = MAX_COMMENT;
			field.value = open.draft;
			field.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void this.#done();
				// What was typed is dropped, as the panel's Cancel does.
				else if (e.key === "Escape") this.#closeMark();
			});
			open.field = field;
			// The panel's commands for a mark of this status, in its order.
			const commands: HTMLButtonElement[] = [];
			if (open.status === "open")
				commands.push(
					button(
						"Resolve…",
						"mark-resolve",
						() => void this.#form(open, "resolve"),
					),
				);
			else {
				if (open.status === "fixed")
					commands.push(
						button(
							"Verified",
							"mark-verify",
							() =>
								void this.#settle(open, {
									type: "mark:verify",
									caseId: now.c.id,
									markId: mark.id,
								}),
						),
					);
				commands.push(
					button(
						"Reopen…",
						"mark-reopen",
						() => void this.#form(open, "reopen"),
					),
					button(
						"Change…",
						"mark-change",
						() => void this.#form(open, "resolve"),
					),
				);
			}
			const remove = button(
				"Delete mark",
				"mark-delete",
				() => void this.#delete(),
			);
			open.remove = remove;
			content = [
				label,
				field,
				problem,
				row("commands", ...commands),
				row(
					"row",
					remove,
					button("Done", "mark-done", () => void this.#done(), true),
				),
			];
			focus = field;
		}
		this.overlay.popover.replaceChildren(...content);
		this.#render();
		focus.focus();
	}

	/**
	 * Ask the panel, with the buttons off meanwhile; says why it did not work.
	 * Answers whether it did, and `false` when the popover went meanwhile.
	 */
	async #request(open: OpenMark, request: MarkRequest): Promise<boolean> {
		// Not to be told from another mark any more: nothing is asked for it.
		if (open.lost) {
			open.problem.textContent = MARK_CHANGED;
			open.problem.hidden = false;
			return false;
		}
		open.busy = true;
		const was = open.controls.map((b) => b.disabled);
		for (const b of open.controls) b.disabled = true;
		open.problem.hidden = true;
		// About the mark the popover is on now, and said which one that is:
		// the panel refuses when the case has another mark under that id.
		const answer = await this.#ask({
			...request,
			markId: open.markId,
			mark: open.mark,
		});
		if (this.#open !== open) return false;
		open.busy = false;
		open.controls.forEach((b, i) => {
			b.disabled = was[i] ?? false;
		});
		if (answer.ok) return true;
		open.problem.textContent = answer.error;
		open.problem.hidden = false;
		return false;
	}

	/** A comment typed is stored before anything else is done with the mark. */
	async #keep(open: OpenMark): Promise<boolean> {
		const now = this.#openMark();
		if (now === undefined || now.open !== open) return false;
		const text = typed(open).trim();
		if (text === open.base) return true;
		const kept = await this.#request(open, {
			type: "mark:comment",
			caseId: now.c.id,
			markId: open.markId,
			text,
		});
		if (kept) {
			open.base = text;
			open.draft = text;
		}
		return kept;
	}

	/** Resolve…, Change… or Reopen…: its form takes the popover. */
	async #form(open: OpenMark, mode: "resolve" | "reopen"): Promise<void> {
		if (open.busy || this.#open !== open) return;
		if (!(await this.#keep(open))) return;
		open.mode = mode;
		this.#fill(open);
	}

	/** A command that settles the mark: done, the popover goes. */
	async #settle(open: OpenMark, request: MarkRequest): Promise<void> {
		if (open.busy || this.#open !== open) return;
		if (!(await this.#keep(open))) return;
		if (await this.#request(open, request)) this.#closeMark();
	}

	/** Done: a changed comment is stored, then the popover goes. */
	async #done(): Promise<void> {
		const open = this.#open;
		if (open === undefined || open.busy) return;
		if (await this.#keep(open)) this.#closeMark();
	}

	/** Delete mark: asked twice, as in the panel; the mark leaves the case. */
	async #delete(): Promise<void> {
		const now = this.#openMark();
		if (now === undefined || now.open.busy) return;
		const { open } = now;
		const remove = open.remove;
		if (remove === undefined) return;
		if (open.armedAt === undefined) {
			const at = Date.now();
			open.armedAt = at;
			remove.textContent = "Really delete?";
			remove.setAttribute("data-armed", "");
			setTimeout(() => {
				if (this.#open !== open || open.armedAt !== at || open.busy) return;
				open.armedAt = undefined;
				remove.textContent = "Delete mark";
				remove.removeAttribute("data-armed");
			}, DELETE_ARMED_MS);
			return;
		}
		if (Date.now() - open.armedAt < DELETE_CLICK_GAP_MS) return;
		if (
			await this.#request(open, {
				type: "mark:delete",
				caseId: now.c.id,
				markId: now.mark.id,
			})
		)
			this.#closeMark();
	}

	/**
	 * The case changed under the open popover: it goes with its mark (deleted
	 * here, in the panel, by an AI app); a comment changed elsewhere shows
	 * unless one is being typed; another status draws its commands anew.
	 */
	#follow(c: Case): void {
		const open = this.#open;
		if (open === undefined) return;
		// Its mark, under whatever id it has now. Gone: the popover goes,
		// with what was typed.
		const mark = markFor(c, open.markId, open.mark);
		if (mark === undefined) {
			this.#closeMark();
			return;
		}
		// The id is another mark's, and more than one mark has this one's
		// screenshot and drawing: a change is not applied to the first found.
		// It is refused and said, and what was typed stays to be read.
		if (mark === "ambiguous") {
			open.lost = true;
			open.problem.textContent = MARK_CHANGED;
			open.problem.hidden = false;
			return;
		}
		open.lost = false;
		const moved = mark.id !== open.markId;
		open.markId = mark.id;
		const untouched = typed(open).trim() === open.base;
		open.base = mark.comment;
		if (untouched) {
			open.draft = mark.comment;
			if (open.field !== undefined) open.field.value = mark.comment;
		}
		const status = markStatus(mark);
		// Another number: the popover says the one the mark has now, and what
		// is being typed stays (`#fill` keeps it).
		if (moved && !open.busy) {
			open.status = status;
			this.#fill(open);
			return;
		}
		if (status === open.status) return;
		open.status = status;
		// A request under way ends the popover or says why not; a form open
		// is answered by the panel, which knows the mark as it is now.
		if (open.mode === "main" && !open.busy) this.#fill(open);
	}

	/** The popover goes, with what was typed in it. */
	#closeMark(): void {
		if (this.#open === undefined) return;
		this.#open = undefined;
		this.overlay.closePopover();
	}

	clear(): void {
		this.#closeMark();
		this.#generation++;
		clearInterval(this.#timer);
		this.#timer = undefined;
		this.#case = undefined;
		this.#entries = [];
		this.#stale.clear();
		this.#late = { looks: 0, ticks: 0 };
		this.#focused = undefined;
		this.overlay.renderReview([]);
		this.overlay.setReviewing(false);
	}

	#element(entry: Entry): Element | undefined {
		return entry.candidates[entry.match.current]?.element;
	}

	#schedule(): void {
		if (this.#frame !== 0 || !this.overlay.reviewing) return;
		this.#frame = requestAnimationFrame(() => {
			this.#frame = 0;
			this.#render();
		});
	}

	/** A mark in document coordinates, as it was on its shot. */
	#stored(mark: Mark): Shape {
		const shot = this.#case?.shots.find((s) => s.id === mark.shot);
		return translateShape(mark.shape, shot?.scrollX ?? 0, shot?.scrollY ?? 0);
	}

	/** A mark on its element, whose box is `rect` now. */
	#onElement(entry: Entry, rect: Rect): ReviewItem {
		const { mark } = entry;
		const details = mark.element;
		return {
			number: mark.number,
			shape: details
				? shapeOnBox(this.#stored(mark), details.rect, rect)
				: mark.shape,
			rect,
			// The shown candidate itself decides the colour.
			// And only on the mark's own page: elsewhere it may be a look-alike.
			found:
				entry.match.status !== "ambiguous" &&
				entry.match.otherPage !== true &&
				entry.candidates[entry.match.current]?.found === true,
			focused: mark.id === this.#focused,
			status: markStatus(mark),
		};
	}

	/** A mark without an element, where it was; its page may be another route. */
	#whereItWas(mark: Mark): ReviewItem | undefined {
		// Only on its own page: a case spans pages (DEC-038).
		if (!this.#own(mark)) return undefined;
		const win = this.overlay.doc.defaultView;
		return {
			number: mark.number,
			shape: translateShape(
				this.#stored(mark),
				-(win?.scrollX ?? 0),
				-(win?.scrollY ?? 0),
			),
			rect: null,
			found: false,
			focused: mark.id === this.#focused,
			status: markStatus(mark),
		};
	}

	#render(): void {
		if (!this.overlay.reviewing) return;
		const items: ReviewItem[] = [];
		/** The mark the popover is open for, where it is drawn now. */
		let open: ReviewItem | undefined;
		const add = (entry: Entry, item: ReviewItem) => {
			items.push(item);
			if (entry.mark.id === this.#open?.markId) open = item;
		};
		for (const entry of this.#entries) {
			if (entry.match.status === "no-element") {
				const item = this.#whereItWas(entry.mark);
				if (item !== undefined) add(entry, item);
				continue;
			}
			const el = this.#element(entry);
			if (el === undefined || !el.isConnected) continue;
			const r = el.getBoundingClientRect();
			if (r.width === 0 && r.height === 0) continue;
			add(
				entry,
				this.#onElement(entry, {
					x: r.x,
					y: r.y,
					width: r.width,
					height: r.height,
				}),
			);
		}
		this.overlay.renderReview(items);
		// The popover follows its mark; a mark off the page leaves it where it is.
		if (open !== undefined)
			this.overlay.placePopover(shapeBounds((open as ReviewItem).shape));
	}

	#renderBar(): void {
		const doc = this.overlay.doc;
		// Verified and dismissed marks are drawn, faded, but no longer counted;
		// open ones and those to verify are what to look at.
		const active = this.#entries.filter((e) => {
			const status = markStatus(e.mark);
			return status === "open" || status === "fixed";
		});
		// Not one found on a page that is not its own: maybe a look-alike.
		const found = active.filter(
			(e) =>
				e.match.status !== "lost" &&
				e.match.status !== "no-element" &&
				e.match.otherPage !== true,
		).length;
		const toVerify = this.#case ? caseCounts(this.#case).toVerify : 0;
		const title = doc.createElement("span");
		title.className = "title";
		title.textContent = this.#case?.title ?? "";
		const count = doc.createElement("span");
		count.className = "count";
		count.textContent =
			active.length === 0 && this.#entries.length > 0
				? "all verified or dismissed"
				: `${found} of ${active.length} found${toVerify > 0 ? ` · ${toVerify} to verify` : ""}`;
		const sep = doc.createElement("span");
		sep.className = "sep";
		sep.setAttribute("aria-hidden", "true");
		sep.textContent = "·";
		const text = doc.createElement("span");
		text.className = "text";
		text.dataset["role"] = "review-status";
		text.append(title, sep, count);
		const bar = this.overlay.reviewBar;
		// Hide stays the same element: a click pressed on it while the case
		// is drawn again (a mark added, a search again) still lands.
		let hide = bar.querySelector<HTMLButtonElement>(
			'[data-action="review-hide"]',
		);
		if (hide === null) {
			hide = doc.createElement("button");
			hide.type = "button";
			hide.dataset["action"] = "review-hide";
			hide.textContent = "Hide";
			hide.addEventListener("click", () => this.clear());
			bar.replaceChildren(ring(doc), text, hide);
			return;
		}
		bar.querySelector('[data-role="review-status"]')?.replaceWith(text);
	}
}
