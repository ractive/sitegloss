/**
 * The case's thread in the side panel (DEC-046): the team's conversation
 * about the case, apart from its summary. Read it, write a comment, change
 * or delete one's own. A comment about one mark shows at that mark, with
 * "Add comment" there (DEC-061, as the web app's `markThread`); the thread
 * at the bottom keeps those about the case as a whole. Drawn again only when
 * what it shows changes; what is being typed stays across every redraw.
 */

import {
	byline,
	type Case,
	type CaseComment,
	isOwnComment,
	MAX_CASE_COMMENT,
} from "../lib/case.ts";
import { formatDate, h } from "./dom.ts";

/** What the user can do in the thread; `main.ts` carries it out. */
export interface ThreadActions {
	/** Answers whether it was saved: what was typed stays until it is. */
	addComment(
		caseId: string,
		text: string,
		markId: string | undefined,
	): Promise<boolean> | void;
	editComment(caseId: string, commentId: string, text: string): void;
	deleteComment(caseId: string, commentId: string): void;
}

/** What the thread needs to know besides the case. */
export interface ThreadContext {
	/** Who is signed in, by the server's id: their comments are their own. */
	me: string | undefined;
	/** The role allows writing comments (always, in a case on this device only). */
	mayComment: boolean;
}

/** A comment being changed, with what is typed; and a Delete asked once. */
let editing: { caseId: string; id: string; text: string } | undefined;
let armed: { caseId: string; id: string; at: number } | undefined;
/** The new comment being typed, per case, with the mark it is about. */
const drafts = new Map<string, { text: string; mark: string }>();

/** A second click on Delete this soon is a double click, and deletes nothing. */
const ARMED_GAP_MS = 500;
const ARMED_MS = 4000;

let redraw: (() => void) | undefined;

/** The panel draws again (a comment at a mark changed its edit or Delete state). */
let redrawAll: (() => void) | undefined;

/** Set by view.ts: how the whole open case is drawn again. */
export function onThreadChange(draw: () => void): void {
	redrawAll = draw;
}

/** Comments shown under a mark before "Show earlier": the web's number. */
export const UNDER_MARK = 3;

/** The marks whose earlier comments are unfolded. */
const unfolded = new Set<string>();
/** A new comment being typed at a mark, by `caseId:markId`. */
const markDrafts = new Map<string, string>();
/** The comments on their way to the store, by case or `caseId:markId`: one at a time. */
const sending = new Set<string>();
/** The marks whose comment box was opened with "Add comment" (DEC-063). */
const markBoxes = new Set<string>();
/** The mark whose comment box takes the focus when it is drawn next. */
let focusBox: string | undefined;
/**
 * Whether the case's Comments section is open, this session, per case
 * (DEC-063). Not set: open when the case has comments, closed when none.
 */
const threadOpen = new Map<string, boolean>();

/** What a mark's comments show besides the case, as one text: in the marks list's key. */
export function threadStateKey(caseId: string): string {
	return JSON.stringify([
		editing?.caseId === caseId ? editing.id : null,
		armed?.caseId === caseId ? armed.id : null,
		[...unfolded].filter((k) => k.startsWith(`${caseId}:`)),
		[...markBoxes].filter((k) => k.startsWith(`${caseId}:`)),
	]);
}

/**
 * The comments shown under a mark: the last `UNDER_MARK`, all once
 * unfolded; how many earlier ones are folded (as `markThread`).
 */
export function markThreadShown<T>(
	about: readonly T[],
	expanded: boolean,
): { shown: readonly T[]; earlier: number } {
	const shown = expanded ? about : about.slice(-UNDER_MARK);
	return { shown, earlier: about.length - shown.length };
}

/** Who wrote it and when, in words: "Dana Developer via Claude · 20 Nov, 14:07". */
export function commentMeta(c: Case, k: CaseComment, withMark = true): string {
	const who = byline(k.user, k.app) ?? "You";
	const mark = k.mark
		? c.marks.find((a) => a.id === k.mark)?.number
		: undefined;
	const about = !withMark
		? ""
		: mark !== undefined
			? ` · on mark ${mark}`
			: k.markGone
				? " · on a deleted mark"
				: "";
	const edited = k.edited
		? ` · edited${byline(k.edited.user, k.edited.app) && byline(k.edited.user, k.edited.app) !== who ? ` by ${byline(k.edited.user, k.edited.app)}` : ""}`
		: "";
	const file = k.imported ? " · as the file says" : "";
	return `${who} · ${formatDate(k.at)}${about}${edited}${file}`;
}

/**
 * The head of a comment: who wrote it, standing out, then the rest of
 * `commentMeta`'s line. Its text is that line, unchanged.
 */
function commentHead(c: Case, k: CaseComment, withMark: boolean): HTMLElement {
	const line = commentMeta(c, k, withMark);
	// As `commentMeta` begins: a person's name alone stands out, "via …" does not.
	const by = byline(k.user, k.app) ?? "You";
	const name = k.user?.name;
	const who = name && by.startsWith(name) ? name : by;
	return h(
		"p",
		{ class: "meta comment-meta" },
		...(who === "" ? [] : [h("strong", { class: "comment-who" }, who)]),
		line.slice(who.length),
	);
}

/**
 * A line that starts a list item: its indentation, "-", "*", "•", "–" or
 * "1." / "1)", the blanks after it, the rest. `s`: the rest is whatever
 * follows, so no input makes the match try again and again.
 */
const LIST_LINE = /^([ \t]*)([-*•–]|\d{1,3}[.)])([ \t]+)(.*)$/s;

/** A list item: its marker as typed in a column of its own, the text hanging beside it. */
function listItem(found: RegExpExecArray): HTMLElement {
	const [, indent = "", marker = "", gap = "", rest = ""] = found;
	const columns = [...indent].reduce((n, ch) => n + (ch === "\t" ? 4 : 1), 0);
	// The column's width, by the marker's kind: glyph widths differ, so this is near, not exact.
	const hang =
		(/\d/.test(marker) ? marker.length * 0.62 + 0.45 : 1.05) + columns * 0.28;
	// A div, not a paragraph: a copy of the list has one line end between its items.
	const item = h(
		"div",
		{ class: "comment-li", role: "listitem" },
		h("span", { class: "comment-marker" }, `${indent}${marker}${gap}`),
		rest,
	);
	item.style.setProperty("--hang", `${hang.toFixed(2)}em`);
	return item;
}

/**
 * A comment's text laid out as it was written (an AI app's report above
 * all): blank lines part paragraphs, and a line that starts a list item
 * hangs beside its marker. Text only: every character of every line is
 * kept, in order (blank lines become the gap between blocks, a line end is
 * a line end whichever kind it was), and nothing is read as markup, a link
 * or an emphasis.
 */
export function commentBlocks(text: string): HTMLElement[] {
	const blocks: HTMLElement[] = [];
	let lines: string[] = [];
	let list: HTMLElement | undefined;
	const flush = () => {
		if (lines.length > 0) blocks.push(h("p", {}, lines.join("\n")));
		lines = [];
	};
	for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
		const found = LIST_LINE.exec(line);
		if (found !== null) {
			flush();
			if (list === undefined) {
				list = h("div", { class: "comment-list", role: "list" });
				blocks.push(list);
			}
			list.append(listItem(found));
			continue;
		}
		list = undefined;
		if (line.trim() === "") flush();
		else lines.push(line);
	}
	flush();
	return blocks;
}

/** What the section shows, as one text: it is drawn again only when this changes. */
function keyOf(c: Case, context: ThreadContext): string {
	return JSON.stringify([
		c.id,
		c.comments ?? [],
		c.marks.map((a) => [a.id, a.number]),
		context,
		editing?.caseId === c.id ? editing.id : null,
		armed?.caseId === c.id ? armed.id : null,
		threadOpen.get(c.id) ?? null,
	]);
}

let drawnKey = "";

/** The thread's section for `c`, in `section`; again only when it changed. */
export function renderThread(
	section: HTMLElement,
	c: Case,
	context: ThreadContext,
	actions: ThreadActions,
): void {
	redraw = () => {
		drawnKey = "";
		renderThread(section, c, context, actions);
	};
	const key = keyOf(c, context);
	if (key === drawnKey && section.childElementCount > 0) return;
	drawnKey = key;
	// The keyboard stays where it was: the field being typed in is the same
	// field after the redraw.
	const focused = (document.activeElement as HTMLElement | null)?.dataset[
		"threadFocus"
	];
	// About the case as a whole: a mark's are at the mark (DEC-061); one
	// about a deleted mark is the case's again.
	const comments = (c.comments ?? []).filter(
		(k) => k.mark === undefined || !c.marks.some((a) => a.id === k.mark),
	);
	section.className = "thread";
	section.id = "case-thread";
	section.setAttribute("aria-labelledby", "thread-heading");
	// Open when there are comments, closed when there are none, until the
	// person opens or closes it (this session, per case).
	const open = threadOpen.get(c.id) ?? comments.length > 0;
	section.replaceChildren(
		h(
			"h2",
			{ id: "thread-heading" },
			h(
				"button",
				{
					type: "button",
					class: "thread-toggle",
					"aria-expanded": String(open),
					"aria-controls": "thread-body",
					"data-thread-focus": "toggle",
					onclick: () => {
						threadOpen.set(c.id, !open);
						redraw?.();
					},
				},
				h("span", { class: "chevron", "aria-hidden": "true" }),
				"Comments ",
				h("span", { class: "count" }, String(comments.length)),
			),
		),
		h(
			"div",
			{
				class: "thread-body",
				id: "thread-body",
				...(open ? {} : { hidden: true }),
			},
			...threadBody(c, comments, context, actions),
		),
	);
	if (focused !== undefined)
		section
			.querySelector<HTMLElement>(`[data-thread-focus="${focused}"]`)
			?.focus();
}

/** The thread's comments and its form. */
function threadBody(
	c: Case,
	comments: readonly CaseComment[],
	context: ThreadContext,
	actions: ThreadActions,
): HTMLElement[] {
	return [
		comments.length === 0
			? h(
					"p",
					{ class: "meta empty" },
					"No comments about the case yet. What was done, a question, a decision: it goes here, beside the summary. A comment about one mark goes at the mark.",
				)
			: h(
					"ol",
					{ class: "comments" },
					...comments.map((k) => item(c, k, context, actions)),
				),
		context.mayComment
			? form(c, actions)
			: h(
					"p",
					{ class: "meta" },
					"Your role in the team does not allow writing comments.",
				),
	];
}

function item(
	c: Case,
	k: CaseComment,
	context: ThreadContext,
	actions: ThreadActions,
	atMark = false,
): HTMLElement {
	const again = () => (atMark ? redrawAll?.() : redraw?.());
	const own = isOwnComment(k, context.me) && context.mayComment;
	const li = h("li", { class: "comment-item", "data-comment": k.id });
	if (editing?.caseId === c.id && editing.id === k.id) {
		const field = h("textarea", {
			class: "comment-edit",
			rows: "3",
			maxlength: String(MAX_CASE_COMMENT),
			"aria-label": "The comment's text",
			"data-thread-focus": `edit-${k.id}`,
			oninput: (e: Event) => {
				if (editing) editing.text = (e.target as HTMLTextAreaElement).value;
			},
		});
		field.value = editing.text;
		li.append(
			commentHead(c, k, !atMark),
			field,
			h(
				"div",
				{ class: "row" },
				h(
					"button",
					{
						type: "button",
						class: "small strong",
						"data-action": "comment-save",
						onclick: () => {
							const text = editing?.text ?? "";
							editing = undefined;
							actions.editComment(c.id, k.id, text);
							again();
						},
					},
					"Save",
				),
				h(
					"button",
					{
						type: "button",
						class: "small",
						"data-action": "comment-cancel",
						onclick: () => {
							editing = undefined;
							again();
						},
					},
					"Cancel",
				),
			),
		);
		return li;
	}
	const isArmed = armed?.caseId === c.id && armed.id === k.id;
	const buttons = own
		? h(
				"div",
				{ class: "row comment-actions" },
				h(
					"button",
					{
						type: "button",
						class: "small",
						"data-action": "comment-edit",
						onclick: () => {
							editing = { caseId: c.id, id: k.id, text: k.text };
							again();
						},
					},
					"Edit",
				),
				h(
					"button",
					{
						type: "button",
						class: "small danger",
						"data-action": "comment-delete",
						...(isArmed ? { "data-armed": true } : {}),
						title: isArmed
							? "Click again to delete this comment, also for the team"
							: "Delete this comment (click twice)",
						onclick: () => {
							const now = Date.now();
							if (
								armed?.caseId === c.id &&
								armed.id === k.id &&
								now - armed.at >= ARMED_GAP_MS
							) {
								armed = undefined;
								actions.deleteComment(c.id, k.id);
								again();
								return;
							}
							if (armed?.id === k.id) return;
							armed = { caseId: c.id, id: k.id, at: now };
							again();
							setTimeout(() => {
								if (armed?.id === k.id && armed.at === now) {
									armed = undefined;
									again();
								}
							}, ARMED_MS);
						},
					},
					isArmed ? "Really delete?" : "Delete comment",
				),
			)
		: undefined;
	li.append(
		commentHead(c, k, !atMark),
		h("div", { class: "comment-text" }, ...commentBlocks(k.text)),
		...(buttons === undefined ? [] : [buttons]),
	);
	return li;
}

function form(c: Case, actions: ThreadActions): HTMLElement {
	const draft = drafts.get(c.id) ?? { text: "", mark: "" };
	const field = h("textarea", {
		id: "comment-new",
		rows: "3",
		maxlength: String(MAX_CASE_COMMENT),
		"aria-label": "A new comment",
		"data-thread-focus": "new",
		oninput: (e: Event) => {
			drafts.set(c.id, {
				...(drafts.get(c.id) ?? { mark: "" }),
				text: (e.target as HTMLTextAreaElement).value,
			});
		},
	});
	field.value = draft.text;
	return h(
		"div",
		{ class: "comment-form" },
		field,
		h(
			"div",
			{ class: "row comment-form-row" },
			h(
				"button",
				{
					type: "button",
					class: "small strong",
					"data-action": "comment-add",
					onclick: () => {
						const now = drafts.get(c.id) ?? { text: "", mark: "" };
						if (now.text.trim() === "" || sending.has(c.id)) return;
						// Kept until saved, as at a mark (DEC-064's review).
						sending.add(c.id);
						void Promise.resolve(actions.addComment(c.id, now.text, undefined))
							.then((saved) => {
								if (saved === false) return;
								if (drafts.get(c.id)?.text === now.text) drafts.delete(c.id);
								redraw?.();
							})
							.finally(() => sending.delete(c.id));
					},
				},
				"Add comment",
			),
		),
	);
}

/** How many comments are about a mark: said in its row. */
export function commentCount(c: Case, markId: string): number {
	return (c.comments ?? []).filter((k) => k.mark === markId).length;
}

/**
 * A mark's comments, at the mark (DEC-061): the last three, "Show earlier"
 * for the rest, each with its own Edit and Delete, and "Add comment" there.
 */
export function markThreadView(
	c: Case,
	a: { id: string; number: number },
	context: ThreadContext,
	actions: ThreadActions,
): HTMLElement {
	const key = `${c.id}:${a.id}`;
	const about = (c.comments ?? []).filter((k) => k.mark === a.id);
	const { shown, earlier } = markThreadShown(about, unfolded.has(key));
	const field = h("textarea", {
		class: "mark-comment-new",
		rows: "2",
		maxlength: String(MAX_CASE_COMMENT),
		"aria-label": `A new comment on mark ${a.number}`,
		oninput: (e: Event) =>
			void markDrafts.set(key, (e.target as HTMLTextAreaElement).value),
	});
	field.value = markDrafts.get(key) ?? "";
	// The box opens with "Add comment", the focus in it (DEC-063); one being
	// typed in stays open.
	const boxOpen = markBoxes.has(key) || field.value !== "";
	if (boxOpen && focusBox === key) {
		focusBox = undefined;
		queueMicrotask(() => field.focus());
	}
	return h(
		"section",
		{
			class: "mark-thread",
			"data-mark-thread": a.id,
			"aria-label": `Comments on mark ${a.number}`,
		},
		h("h3", {}, "Comments"),
		earlier > 0
			? h(
					"button",
					{
						type: "button",
						class: "link small",
						"data-action": "comments-earlier",
						onclick: () => {
							unfolded.add(key);
							redrawAll?.();
						},
					},
					`Show ${earlier} earlier`,
				)
			: null,
		shown.length > 0
			? h(
					"ol",
					{ class: "comments" },
					...shown.map((k) => item(c, k, context, actions, true)),
				)
			: null,
		!context.mayComment
			? null
			: !boxOpen
				? h(
						"button",
						{
							type: "button",
							class: "small",
							"data-action": "mark-comment-open",
							onclick: () => {
								markBoxes.add(key);
								focusBox = key;
								redrawAll?.();
							},
						},
						"Add comment",
					)
				: h(
						"div",
						{ class: "comment-form" },
						field,
						h(
							"div",
							{ class: "row" },
							h(
								"button",
								{
									type: "button",
									class: "small strong",
									"data-action": "mark-comment-add",
									onclick: () => {
										const text = markDrafts.get(key) ?? "";
										if (text.trim() === "" || sending.has(key)) return;
										// What was typed stays until it is saved; a save
										// that fails leaves the box and the text to try
										// again (DEC-064's review).
										sending.add(key);
										void Promise.resolve(actions.addComment(c.id, text, a.id))
											.then((saved) => {
												if (saved === false) return;
												if (markDrafts.get(key) === text)
													markDrafts.delete(key);
												markBoxes.delete(key);
												redrawAll?.();
											})
											.finally(() => sending.delete(key));
									},
								},
								"Add comment",
							),
							h(
								"button",
								{
									type: "button",
									class: "small",
									"data-action": "mark-comment-cancel",
									onclick: () => {
										markDrafts.delete(key);
										markBoxes.delete(key);
										redrawAll?.();
									},
								},
								"Cancel",
							),
						),
					),
	);
}
