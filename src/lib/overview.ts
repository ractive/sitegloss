/**
 * The overview of a case's marks that an AI app reads (DEC-081): one line of
 * plain text per mark, so that a case of hundreds of marks is read a page at
 * a time instead of as one answer too large to read. A copy of the server's
 * `packages/api/src/v1/overview.ts` (its DEC-052), held to it by the vectors
 * `test/mark-overview.json`, a copy of its `packages/api/vectors/mark-overview.json`,
 * which this copy has to give byte for byte; copied again when that changes.
 * `get_case` and `list_marks` answer with it; `overviewCase` reads a case of
 * this browser as the server's functions read the server's.
 *
 * A line, for example:
 *
 *     #7 open p2 box · button "Add to cart" · 2 added images · 3 comments · "Too close to the price"
 *
 * `#` and the number, a space, the status (as `set_mark_status` takes it), a
 * space, the page (`p` and its number, the case's pages numbered from 1;
 * `p?` when the case does not list it), a space, the kind (the shape's kind,
 * or `highlight` and the selected text). Then the facts, each after the
 * separator ` · ` (a space, U+00B7 MIDDLE DOT, a space), in this order: one
 * fact about the element (`elementFact`), the images a person added (left out
 * when none), the comments on the mark (left out when none), and last the
 * mark's own comment, always there. The comment is people's text: it is never
 * cut, and `quote` keeps it on its line and inside its quotes. Texts from the
 * page (the element's name or text, a highlight's text) are cut, with "…".
 *
 * Two ways of counting: texts are cut by code points (`[...text]`, so that no
 * cut splits a character), and the budget and a line's length are counted in
 * UTF-16 code units (JavaScript's `length`), as a client counts what it
 * receives.
 */

import {
	type Case,
	casePages,
	givenKind,
	type MarkStatus,
	markStatus,
	pageKey,
	shotUrl,
} from "./case.ts";

/** The most characters an answer of the overview holds: a page of lines stops at a mark before it. One mark longer than this is sent alone. */
export const OVERVIEW_BUDGET = 20_000;

/** Which marks an overview lists: by status group; `unsettled` (open and fixed, to verify) unless asked. */
export const MARK_FILTERS = [
	"unsettled",
	"open",
	"to verify",
	"verified",
	"dismissed",
	"all",
] as const;
export type MarkFilter = (typeof MARK_FILTERS)[number];

const STATUSES_OF: Record<MarkFilter, readonly MarkStatus[]> = {
	unsettled: ["open", "fixed"],
	open: ["open"],
	"to verify": ["fixed"],
	verified: ["verified"],
	dismissed: ["wontfix", "cantreproduce"],
	all: ["open", "fixed", "verified", "wontfix", "cantreproduce"],
};

const FILTER_WORDS: Record<MarkFilter, string> = {
	unsettled: "open and fixed (to verify) marks",
	open: "open marks",
	"to verify": "fixed marks (to verify)",
	verified: "verified marks",
	dismissed: "wontfix and cantreproduce marks",
	all: "all marks",
};

/** What the overview reads of a mark: the server's `Mark`, in part. */
export interface OverviewMark {
	id: string;
	number: number;
	shotId: string;
	status: MarkStatus;
	comment: string;
	shape: { kind: string };
	element: {
		tag: string;
		role?: string;
		name?: string;
		text?: string;
	} | null;
	highlight?: { text: string };
	images?: readonly unknown[];
}

/** What the overview reads of a case: the server's `CaseDetail`, in part. */
export interface OverviewCase {
	id: string;
	pages: readonly { url: string }[];
	shots: readonly { id: string; url: string }[];
	marks: readonly OverviewMark[];
	comments: readonly { markId: string | null }[];
}

/** Which marks, from where, and how much: `after` is a mark's number; the page starts after it. */
export interface OverviewQuery {
	status?: MarkFilter;
	/** One of the case's pages, numbered from 1 as the lines say it (`p2`). */
	page?: number;
	after?: number;
	budget?: number;
}

export interface Overview {
	/** The lines, the first saying what the overview leaves out, the last where it stops. */
	lines: string[];
	/** The marks the lines show, by number. */
	shown: number[];
	/** How many marks the filter matched. */
	matched: number;
	/** The `after` of the next page; null when this page is the last. */
	next: number | null;
}

/**
 * A case of this browser as the overview reads it: its pages as `casePages`
 * lists them, each screenshot's page, each mark's status, kind (`givenKind`:
 * a newer kind by its own name), the element's tag, role, name and text, and
 * its added images; the thread's comments by the mark they are on.
 */
export function overviewCase(c: Case): OverviewCase {
	return {
		id: c.id,
		pages: casePages(c).map((p) => ({ url: p.url })),
		shots: c.shots.map((s) => ({ id: s.id, url: shotUrl(c, s) })),
		marks: c.marks.map((a) => ({
			id: a.id,
			number: a.number,
			shotId: a.shot,
			status: markStatus(a),
			comment: a.comment,
			shape: { kind: givenKind(a.shape) },
			element:
				a.element === null
					? null
					: {
							tag: a.element.tag,
							...(a.element.role === undefined ? {} : { role: a.element.role }),
							...(a.element.name === undefined ? {} : { name: a.element.name }),
							...(a.element.text === undefined ? {} : { text: a.element.text }),
						},
			...(a.highlight === undefined
				? {}
				: { highlight: { text: a.highlight.text } }),
			...(a.images === undefined ? {} : { images: a.images }),
		})),
		comments: (c.comments ?? []).map((k) => ({ markId: k.mark ?? null })),
	};
}

/**
 * Characters that change how text reads without being seen: the direction
 * controls (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069) and
 * the tag characters. They are removed; the joiners U+200C and U+200D stay,
 * as emoji sequences and words in Persian or Indic scripts need them.
 */
const HIDDEN =
	/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u{e0000}-\u{e007f}]/gu;

/** A text on one line: hidden characters gone, every run of white space and control characters one space, trimmed. */
export function plainLine(value: string): string {
	return value
		.replace(HIDDEN, "")
		.replace(/[\s\p{Cc}]+/gu, " ")
		.trim();
}

/**
 * JSON for a tool's answer: `JSON.stringify` (with `indent` when given), and
 * the characters it leaves raw that could break a line or turn text around
 * written as `\uXXXX` escapes: U+0085, U+061C, U+200E, U+200F, U+2028 to
 * U+202E, U+2066 to U+2069 and the tag characters (as their UTF-16 units). It
 * parses back to the same value; on a reader's screen nothing in it starts a
 * line or hides.
 */
export function jsonText(value: unknown, indent?: number): string {
	return JSON.stringify(value, null, indent).replace(
		/[\u0085\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]|\udb40[\udc00-\udc7f]/g,
		(found) =>
			found
				.split("")
				.map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`)
				.join(""),
	);
}

const escaped = (value: string): string =>
	value.replace(/[\\"]/g, (c) => `\\${c}`);

/**
 * People's text, whole, quoted on one line: hidden characters removed, its
 * backslashes and quotes escaped, each line break (CR LF, CR, LF, U+0085,
 * U+2028, U+2029) written `\n`, any other control character a space. Nothing
 * in it can end the quote or start a line; nothing of it is cut.
 */
export function quote(value: string): string {
	return `"${escaped(value.replace(HIDDEN, ""))
		.replace(/\r\n|[\n\r\u0085\u2028\u2029]/g, "\\n")
		.replace(/\p{Cc}/gu, " ")}"`;
}

/** Text from a page, quoted: on one line (`plainLine`), cut to `limit` characters with "…", escaped. */
export function quoteStart(value: string, limit: number): string {
	const points = [...plainLine(value)];
	const start =
		points.length <= limit
			? points.join("")
			: `${points.slice(0, limit).join("")}…`;
	return `"${escaped(start)}"`;
}

/** A tag or role as a word: what is not an ASCII letter, digit, `-`, `_`, `.` or `:` goes; cut to 20. */
const word = (value: string): string =>
	[...value.replace(/[^A-Za-z0-9_.:-]/g, "")].slice(0, 20).join("");

const plural = (n: number, one: string): string =>
	`${n} ${one}${n === 1 ? "" : "s"}`;

/** The page a screenshot shows, as the case numbers its pages from 1; null when the case does not list it. */
export function pageNumberOf(
	found: OverviewCase,
	shotId: string,
): number | null {
	const shot = found.shots.find((candidate) => candidate.id === shotId);
	if (!shot) return null;
	const key = pageKey(shot.url);
	const at = found.pages.findIndex((page) => pageKey(page.url) === key);
	return at < 0 ? null : at + 1;
}

/**
 * The one fact about a mark's element a line gives: `button "Add to cart"`,
 * `a (link) "Pricing"`, `no element`. The tag as a word (`word`), and
 * `element` when nothing of it is left; the role in parentheses when one is
 * recorded and differs from the tag as words; the name, else the text, quoted
 * and cut to 40 code points, when either is not empty on one line.
 */
export function elementFact(element: OverviewMark["element"]): string {
	if (!element) return "no element";
	const tag = word(element.tag) || "element";
	const role = element.role ? word(element.role) : "";
	const label = plainLine(element.name ?? "") || plainLine(element.text ?? "");
	return `${tag}${role && role !== tag ? ` (${role})` : ""}${label ? ` ${quoteStart(label, 40)}` : ""}`;
}

/** A mark's line in the overview. */
export function markLine(found: OverviewCase, mark: OverviewMark): string {
	const page = pageNumberOf(found, mark.shotId);
	const kind = mark.highlight
		? `highlight ${quoteStart(mark.highlight.text, 50)}`
		: word(mark.shape.kind);
	const facts = [
		`#${mark.number} ${mark.status} ${page === null ? "p?" : `p${page}`} ${kind}`,
		elementFact(mark.element),
	];
	const images = mark.images?.length ?? 0;
	if (images > 0) facts.push(plural(images, "added image"));
	const comments = found.comments.filter(
		(entry) => entry.markId === mark.id,
	).length;
	if (comments > 0) facts.push(plural(comments, "comment"));
	facts.push(quote(mark.comment));
	return facts.join(" · ");
}

/** The literal call of `list_marks` with these filters: `list_marks("c_1", status: "all", page: 2, after: 40)`. */
export function listMarksCall(
	caseId: string,
	query: {
		status?: MarkFilter | undefined;
		page?: number | undefined;
		after?: number | undefined;
	},
): string {
	const args = [JSON.stringify(caseId)];
	if (query.status && query.status !== "unsettled")
		args.push(`status: ${JSON.stringify(query.status)}`);
	if (query.page !== undefined) args.push(`page: ${query.page}`);
	if (query.after !== undefined) args.push(`after: ${query.after}`);
	return `list_marks(${args.join(", ")})`;
}

/**
 * One page of the overview: the marks the filter matches, in ascending
 * number, after `after`, as many as fit `budget` characters with the
 * overview's own lines, at least one. Its first line says what it leaves out,
 * its second what the filter left out and the call that shows it, its last
 * how far it got and, when marks remain, the literal call for the next page.
 */
export function markOverview(
	found: OverviewCase,
	query: OverviewQuery = {},
): Overview {
	const status = query.status ?? "unsettled";
	const statuses = STATUSES_OF[status];
	const marks = [...found.marks].sort((a, b) => a.number - b.number);
	const matches = (mark: OverviewMark): boolean =>
		statuses.includes(mark.status) &&
		(query.page === undefined ||
			pageNumberOf(found, mark.shotId) === query.page);
	const matched = marks.filter(matches);
	const left = marks.filter((mark) => !matches(mark));
	const id = JSON.stringify(found.id);
	const head = `Overview: one line per mark: number, status, page, kind, element, added images, comments on the mark, then the mark's own comment in full. Not in it: pictures, element details, the comments on marks; get_mark(${id}, mark: <number>) has them.`;
	// In this order, each status that has a mark left out: open, fixed, verified, wontfix, cantreproduce.
	const byStatus = STATUSES_OF.all.flatMap((name): [MarkStatus, number][] => {
		const n = left.filter((mark) => mark.status === name).length;
		return n > 0 ? [[name, n]] : [];
	});
	const leftOut =
		left.length === 0
			? "Left out: none."
			: `Left out: ${left.length}${query.page !== undefined ? " with another status or on another page" : ""} (${byStatus.map(([name, n]) => `${n} ${name}`).join(", ")}): ${listMarksCall(found.id, { status: "all" })} lists every mark.`;
	const filter = `Listed: ${FILTER_WORDS[status]}${query.page !== undefined ? ` on p${query.page}` : ""}, ${matched.length} of ${marks.length}. ${leftOut}`;
	const before =
		query.after === undefined
			? 0
			: matched.filter((mark) => mark.number <= (query.after ?? 0)).length;
	const rest = matched.slice(before);
	const budget = query.budget ?? OVERVIEW_BUDGET;
	const foot = (count: number): string => {
		if (rest.length === 0)
			return matched.length === 0
				? "No mark matches."
				: `None after #${query.after}: the last mark that matches is #${matched.at(-1)?.number}.`;
		const first = rest[0] as OverviewMark;
		const last = rest[count - 1] as OverviewMark;
		const range =
			count === 1
				? `Line ${before + 1} of ${matched.length} (mark #${first.number}).`
				: `Lines ${before + 1} to ${before + count} of ${matched.length} (marks #${first.number} to #${last.number}).`;
		return count < rest.length
			? `${range} More: ${listMarksCall(found.id, { status, page: query.page, after: last.number })}`
			: `${range} That is the last of them.`;
	};
	const lines: string[] = [];
	let used = head.length + 1 + filter.length + 1;
	for (const mark of rest) {
		const line = markLine(found, mark);
		if (
			lines.length > 0 &&
			used + line.length + 1 + foot(lines.length + 1).length > budget
		)
			break;
		lines.push(line);
		used += line.length + 1;
	}
	const shown = rest.slice(0, lines.length).map((mark) => mark.number);
	return {
		lines: [head, filter, ...lines, foot(lines.length)],
		shown,
		matched: matched.length,
		next: lines.length < rest.length ? (shown.at(-1) ?? null) : null,
	};
}
