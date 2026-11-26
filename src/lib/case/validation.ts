/**
 * Reading a case from outside (a file, the store, the wire): `validateCase`,
 * and the findings that become comments (DEC-081).
 */

import { sha256Hex } from "../sha256.ts";
import { cleanLink } from "./edits.ts";
import {
	addedImage,
	CASE_FORMAT,
	type Case,
	type CaseComment,
	CaseError,
	type CasePage,
	cropImage,
	ELEMENT_ATTRIBUTES,
	type ElementDetails,
	type FindingApp,
	highlightWithin,
	isKindName,
	LANGUAGE,
	lookOf,
	MAX_CASE_COMMENT,
	MAX_CASE_COMMENTS,
	MAX_COMMENT,
	MAX_EXTRA,
	MAX_EXTRA_KEYS,
	MAX_EXTRAS,
	MAX_LINK,
	MAX_MARK_IMAGES,
	MAX_MARKS,
	MAX_NUMBER,
	MAX_PAGE_TITLE,
	MAX_PAGES,
	MAX_PEN_POINTS,
	MAX_REOPEN_NOTE,
	MAX_REOPENS,
	MAX_SHOTS,
	MAX_TITLE,
	MAX_UNKNOWN_SHAPE,
	MAX_URL,
	MAX_VERDICT,
	type Mark,
	type MarkImage,
	markIdOf,
	OLD_CASE_FORMAT,
	type Point,
	RESOLUTION_KINDS,
	type Rect,
	type Reopen,
	type Resolution,
	type ResolutionKind,
	type Shape,
	type Shot,
	type Stamp,
	shotImage,
	textLength,
	type UnknownShape,
	type UserRef,
	type Verification,
	type Viewport,
} from "./format.ts";
import {
	cutWas,
	MAX_FINDING,
	MAX_FINDINGS,
	type OldFinding,
} from "./internal.ts";
import { queryField } from "./pages.ts";

// --- validation (imports, iteration 3) ---------------------------------------

type Obj = Record<string, unknown>;

function fail(path: string, what: string): never {
	throw new CaseError(`${path}: ${what}`);
}

function obj(v: unknown, path: string): Obj {
	if (typeof v !== "object" || v === null || Array.isArray(v))
		fail(path, "must be an object");
	return v as Obj;
}

function str(v: unknown, path: string, max = 100_000): string {
	if (typeof v !== "string") fail(path, "must be a string");
	// Never more characters than UTF-16 units.
	if (v.length > max && textLength(v) > max)
		fail(path, `longer than ${max} characters`);
	return v;
}

function num(v: unknown, path: string): number {
	if (typeof v !== "number" || !Number.isFinite(v))
		fail(path, "must be a number");
	return v;
}

function arr(v: unknown, path: string, max = 10_000): unknown[] {
	if (!Array.isArray(v)) fail(path, "must be an array");
	if (v.length > max) fail(path, `more than ${max} items`);
	return v;
}

function point(v: unknown, path: string): Point {
	const o = obj(v, path);
	return { x: num(o["x"], `${path}.x`), y: num(o["y"], `${path}.y`) };
}

function rect(v: unknown, path: string): Rect {
	const o = obj(v, path);
	return {
		x: num(o["x"], `${path}.x`),
		y: num(o["y"], `${path}.y`),
		width: num(o["width"], `${path}.width`),
		height: num(o["height"], `${path}.height`),
	};
}

function viewport(v: unknown, path: string): Viewport {
	const o = obj(v, path);
	return {
		width: num(o["width"], `${path}.width`),
		height: num(o["height"], `${path}.height`),
		dpr: num(o["dpr"], `${path}.dpr`),
	};
}

function shape(v: unknown, path: string): Shape {
	const o = obj(v, path);
	switch (o["kind"]) {
		case "element":
		case "box":
			return { kind: o["kind"], rect: rect(o["rect"], `${path}.rect`) };
		case "arrow":
			return {
				kind: "arrow",
				from: point(o["from"], `${path}.from`),
				to: point(o["to"], `${path}.to`),
			};
		case "pen":
			return {
				kind: "pen",
				points: arr(o["points"], `${path}.points`, MAX_PEN_POINTS).map((p, i) =>
					point(p, `${path}.points[${i}]`),
				),
			};
		case "note":
			return { kind: "note", at: point(o["at"], `${path}.at`) };
		case "unknown": {
			// As this browser keeps one (`UnknownShape`): looked at anew, so a
			// kind this version knows is drawn again.
			const given = o["given"];
			if (typeof given === "object" && given !== null && !Array.isArray(given))
				return shape(given, `${path}.given`);
			return unknownShape(o, path);
		}
		default:
			return unknownShape(o, path);
	}
}

/**
 * A shape of a kind this version does not know, kept as it came (DEC-066):
 * a newer Sitegloss made it. Only a kind that is no name at all is refused.
 */
function unknownShape(o: Obj, path: string): UnknownShape {
	const kind = o["kind"];
	if (!isKindName(kind)) fail(`${path}.kind`, "must name a kind of shape");
	if (JSON.stringify(o).length > MAX_UNKNOWN_SHAPE)
		fail(path, `is larger than ${MAX_UNKNOWN_SHAPE / 1024} KB`);
	return { kind: "unknown", given: { ...o, kind } };
}

function optionalString(o: Obj, key: string, path: string, out: Obj): void {
	if (o[key] !== undefined) out[key] = str(o[key], `${path}.${key}`, 2000);
}

function element(v: unknown, path: string): ElementDetails | null {
	if (v === null) return null;
	const o = obj(v, path);
	const given = obj(o["attributes"], `${path}.attributes`);
	const attributes: Record<string, string> = {};
	for (const k of ELEMENT_ATTRIBUTES) {
		if (Object.hasOwn(given, k))
			attributes[k] = str(given[k], `${path}.attributes.${k}`, 2000);
	}
	const page = obj(o["page"], `${path}.page`);
	const out: Obj = {
		tag: str(o["tag"], `${path}.tag`, 64),
		classes: arr(o["classes"], `${path}.classes`, 200).map((c, i) =>
			str(c, `${path}.classes[${i}]`, 200),
		),
		attributes,
		ancestors: arr(o["ancestors"], `${path}.ancestors`, 50).map((c, i) =>
			str(c, `${path}.ancestors[${i}]`, 300),
		),
		rect: rect(o["rect"], `${path}.rect`),
		page: {
			width: num(page["width"], `${path}.page.width`),
			height: num(page["height"], `${path}.page.height`),
		},
		selector: str(o["selector"], `${path}.selector`, 2000),
	};
	for (const key of [
		"id",
		"testId",
		"role",
		"name",
		"text",
		"heading",
		"landmark",
	])
		optionalString(o, key, path, out);
	// Optional extras (DEC-048): kept where within the rules, else left out.
	Object.assign(out, lookOf(o));
	return out as unknown as ElementDetails;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHOT_ID = /^s[1-9]\d{0,5}$/;

/** Ids of cases, shots and marks: safe in image paths and keys. */
export const isSafeId = (value: string) => SAFE_ID.test(value);

function id(v: unknown, path: string): string {
	const s = str(v, path, 64);
	if (!SAFE_ID.test(s)) fail(path, "is not a valid id");
	return s;
}

function language(v: unknown, path: string): string {
	const s = str(v, path, 35);
	if (!LANGUAGE.test(s)) fail(path, "is not a language tag");
	return s;
}

/**
 * The keys a case, a screenshot and a mark have in this version. What else a
 * file or this browser's store holds there is a newer Sitegloss's (DEC-066):
 * kept as it is (`extrasOf`), so that a change and an export here give it
 * back. Only at these three levels: an element's details stay their
 * allow-list (DEC-009), and nothing kept so is shown, sent to the server or
 * to an AI app, whose views name their fields.
 */
const CASE_KEYS = new Set([
	"format",
	"id",
	"title",
	"createdAt",
	"updatedAt",
	"page",
	"pages",
	"shots",
	"marks",
	"verdict",
	"link",
	"importedAt",
	"lastNumber",
	"closed",
	"comments",
	"summaryBy",
	"via",
	"createdVia",
	"deletedVia",
	"createdBy",
	"assignee",
	"assignedBy",
	"assign",
	"assignRefused",
]);
const SHOT_KEYS = new Set([
	"id",
	"image",
	"scrollX",
	"scrollY",
	"viewport",
	"capturedAt",
	"url",
	"query",
]);
const MARK_KEYS = new Set([
	"id",
	"number",
	"shot",
	"comment",
	"author",
	"shape",
	"crop",
	"element",
	"ends",
	"resolution",
	"reopens",
	"findings",
	"images",
	"heldImages",
	"createdBy",
	"createdVia",
	"commentBy",
	"via",
	"highlight",
]);

/** A case's fields this version does not know (DEC-066), for code that rebuilds a case from its named fields. */
export const caseExtras = (c: Case): Record<string, unknown> =>
	extrasOf(c as unknown as Obj, CASE_KEYS, { left: MAX_EXTRAS });

/** The fields of `o` this version does not know, as they are (`CASE_KEYS`). */
function extrasOf(
	o: Obj,
	known: ReadonlySet<string>,
	/** What the whole case may still keep (`MAX_EXTRAS`), shared by its parts. */
	budget: { left: number },
): Obj {
	const out: Obj = {};
	let keys = 0;
	for (const [key, value] of Object.entries(o)) {
		if (known.has(key) || value === undefined) continue;
		// Bounded: what nothing here reads does not grow a case without end.
		const size = key.length + (JSON.stringify(value)?.length ?? 0);
		if (size > MAX_EXTRA || size > budget.left || keys >= MAX_EXTRA_KEYS)
			continue;
		out[key] = value;
		budget.left -= size;
		keys++;
	}
	return out;
}

/** Check that `value` is a case in format `sitegloss/2` and return it typed. */
export function validateCase(value: unknown): Case {
	// Findings from before DEC-081 are comments on their marks.
	const o = obj(findingsAsComments(value), "case");
	const extras = { left: MAX_EXTRAS };
	const format = o["format"];
	if (format === OLD_CASE_FORMAT)
		throw new CaseError(
			`This case file is in the old format ${OLD_CASE_FORMAT}; this version of Sitegloss reads ${CASE_FORMAT} only.`,
		);
	if (typeof format === "string" && format !== CASE_FORMAT)
		fail(
			"case.format",
			`is "${format.slice(0, 40)}"; Sitegloss reads "${CASE_FORMAT}" only`,
		);
	if (format !== CASE_FORMAT) fail("case.format", `must be "${CASE_FORMAT}"`);
	const page = obj(o["page"], "case.page");
	const shotIds = new Set<string>();
	const shots = arr(o["shots"], "case.shots", MAX_SHOTS).map((v, i): Shot => {
		const s = obj(v, `case.shots[${i}]`);
		const shotId = id(s["id"], `case.shots[${i}].id`);
		if (!SHOT_ID.test(shotId))
			fail(`case.shots[${i}].id`, "must be s followed by a number");
		if (shotIds.has(shotId)) fail(`case.shots[${i}].id`, "is used twice");
		shotIds.add(shotId);
		const image = str(s["image"], `case.shots[${i}].image`);
		if (image !== shotImage(shotId))
			fail(`case.shots[${i}].image`, `must be ${shotImage(shotId)}`);
		return {
			...extrasOf(s, SHOT_KEYS, extras),
			id: shotId,
			image,
			scrollX: num(s["scrollX"], `case.shots[${i}].scrollX`),
			scrollY: num(s["scrollY"], `case.shots[${i}].scrollY`),
			viewport: viewport(s["viewport"], `case.shots[${i}].viewport`),
			capturedAt: str(s["capturedAt"], `case.shots[${i}].capturedAt`, 64),
			...(s["url"] === undefined
				? {}
				: { url: str(s["url"], `case.shots[${i}].url`, MAX_URL) }),
			// Filtered again, never a failed file: an extra (DEC-050).
			...queryField(s["query"]),
		};
	});
	const numbers = new Set<number>();
	const ids = new Set<string>();
	const imageIds = new Set<string>();
	const marks = arr(o["marks"], "case.marks", MAX_MARKS).map((v, i): Mark => {
		const p = `case.marks[${i}]`;
		const a = obj(v, p);
		const markId = id(a["id"], `${p}.id`);
		if (ids.has(markId)) fail(`${p}.id`, "is used twice");
		ids.add(markId);
		const number = num(a["number"], `${p}.number`);
		if (
			!Number.isInteger(number) ||
			number < 1 ||
			number > MAX_NUMBER ||
			numbers.has(number)
		)
			fail(`${p}.number`, `must be a unique integer from 1 to ${MAX_NUMBER}`);
		numbers.add(number);
		// Saving names new marks m<number>: another scheme would collide later.
		if (markId !== markIdOf(number))
			fail(`${p}.id`, `must be ${markIdOf(number)}, after its number`);
		const shot = str(a["shot"], `${p}.shot`, 64);
		if (!shotIds.has(shot)) fail(`${p}.shot`, "names no shot of the case");
		const crop = str(a["crop"], `${p}.crop`);
		if (crop !== cropImage(markId))
			fail(`${p}.crop`, `must be ${cropImage(markId)}`);
		const author = a["author"];
		if (author !== "user" && author !== "ai")
			fail(`${p}.author`, `must be "user" or "ai"`);
		const drawn = shape(a["shape"], `${p}.shape`);
		const highlight = highlightWithin(a["highlight"], drawn);
		return {
			// What a newer Sitegloss wrote and this one does not know (DEC-066).
			...extrasOf(a, MARK_KEYS, extras),
			id: markId,
			number,
			shot,
			comment: str(a["comment"], `${p}.comment`, MAX_COMMENT),
			author,
			shape: drawn,
			// Outside the limits it goes, and the mark stays (the server's rule).
			...(highlight === undefined ? {} : { highlight }),
			crop,
			element: element(a["element"], `${p}.element`),
			...(a["ends"] === undefined
				? {}
				: {
						ends: {
							start: element(
								obj(a["ends"], `${p}.ends`)["start"] ?? null,
								`${p}.ends.start`,
							),
							end: element(
								obj(a["ends"], `${p}.ends`)["end"] ?? null,
								`${p}.ends.end`,
							),
						},
					}),
			...(a["resolution"] === undefined
				? {}
				: { resolution: resolution(a["resolution"], `${p}.resolution`) }),
			...reopensOf(a["reopens"], `${p}.reopens`),
			// Findings that did not fit the thread yet (DEC-081): kept as they are.
			...leftFindings(a["findings"], `${p}.findings`),
			...imagesOf(a["images"], `${p}.images`, imageIds),
			// This browser's images held back (DEC-058); a file never has them
			// (the import leaves them out), the store does.
			...((): { heldImages?: MarkImage[] } => {
				const held = imagesOf(
					a["heldImages"],
					`${p}.heldImages`,
					imageIds,
				).images;
				return held === undefined ? {} : { heldImages: held };
			})(),
			...createdByOf(a["createdBy"], `${p}.createdBy`),
			...(a["createdVia"] === undefined
				? {}
				: {
						createdVia: appOf(a["createdVia"], `${p}.createdVia`)
							.app as FindingApp,
					}),
			...(a["commentBy"] === undefined
				? {}
				: { commentBy: stampOf(a["commentBy"], `${p}.commentBy`) }),
			...(a["via"] === undefined
				? {}
				: {
						via: {
							app: appOf(obj(a["via"], `${p}.via`)["app"], `${p}.via.app`)
								.app as FindingApp,
							of: str(obj(a["via"], `${p}.via`)["of"], `${p}.via.of`, 64),
						},
					}),
		};
	});
	const verdict = o["verdict"];
	const importedAt = o["importedAt"];
	const lastNumber = o["lastNumber"];
	const link = o["link"];
	const pages = o["pages"];
	return {
		...extrasOf(o, CASE_KEYS, extras),
		format: CASE_FORMAT,
		id: id(o["id"], "case.id"),
		title: str(o["title"], "case.title", MAX_TITLE),
		createdAt: str(o["createdAt"], "case.createdAt", 64),
		updatedAt: str(o["updatedAt"], "case.updatedAt", 64),
		page: {
			url: str(page["url"], "case.page.url", MAX_URL),
			title: str(page["title"], "case.page.title", MAX_PAGE_TITLE),
			lang: language(page["lang"], "case.page.lang"),
			viewport: viewport(page["viewport"], "case.page.viewport"),
			userAgent: str(page["userAgent"], "case.page.userAgent", 2000),
		},
		...(pages === undefined ? {} : { pages: pagesOf(pages) }),
		shots,
		marks,
		verdict:
			verdict === null || verdict === undefined
				? null
				: str(verdict, "case.verdict", MAX_VERDICT),
		...(link === undefined ? {} : { link: linkOf(link, "case.link") }),
		...(importedAt === undefined
			? {}
			: { importedAt: str(importedAt, "case.importedAt", 64) }),
		...(lastNumber === undefined
			? {}
			: { lastNumber: highest(lastNumber, marks) }),
		...(o["closed"] === undefined || o["closed"] === null
			? {}
			: { closed: stampOf(o["closed"], "case.closed") }),
		...(o["comments"] === undefined
			? {}
			: { comments: commentsOf(o["comments"], marks) }),
		...(o["summaryBy"] === undefined
			? {}
			: { summaryBy: stampOf(o["summaryBy"], "case.summaryBy") }),
		...(o["via"] === undefined ? {} : { via: viaOf(o["via"]) }),
		...(o["createdVia"] === undefined
			? {}
			: {
					createdVia: appOf(o["createdVia"], "case.createdVia")
						.app as FindingApp,
				}),
		...(o["deletedVia"] === undefined
			? {}
			: {
					deletedVia: arr(
						o["deletedVia"],
						"case.deletedVia",
						MAX_CASE_COMMENTS,
					).map((v, i) => {
						const d = obj(v, `case.deletedVia[${i}]`);
						return {
							id: id(d["id"], `case.deletedVia[${i}].id`),
							app: appOf(d["app"], `case.deletedVia[${i}].app`)
								.app as FindingApp,
						};
					}),
				}),
		// The hand-over (DEC-071): the server's records, and what waits to go.
		...createdByOf(o["createdBy"], "case.createdBy"),
		...(o["assignee"] === undefined
			? {}
			: { assignee: person(o["assignee"], "case.assignee") ?? null }),
		...(o["assignedBy"] === undefined || o["assignedBy"] === null
			? {}
			: { assignedBy: stampOf(o["assignedBy"], "case.assignedBy") }),
		...(o["assign"] === undefined ? {} : { assign: assignOf(o["assign"]) }),
		...(o["assignRefused"] === undefined
			? {}
			: {
					assignRefused: {
						text: str(
							obj(o["assignRefused"], "case.assignRefused")["text"],
							"case.assignRefused.text",
							1000,
						),
						at: str(
							obj(o["assignRefused"], "case.assignRefused")["at"],
							"case.assignRefused.at",
							64,
						),
					},
				}),
	};
}

/** An assignment waiting to be sent (`Case.assign`). */
function assignOf(value: unknown): { to: UserRef | null; at: string } {
	const o = obj(value, "case.assign");
	return {
		to: person(o["to"], "case.assign.to") ?? null,
		at: str(o["at"], "case.assign.at", 64),
	};
}

/** When, by whom and through which app (DEC-046). */
function stampOf(value: unknown, path: string): Stamp {
	const o = obj(value, path);
	return {
		at: str(o["at"], `${path}.at`, 64),
		...userOf(o["user"], `${path}.user`),
		...appOf(o["app"], `${path}.app`),
	};
}

/** The last change's AI app, while it is the last change (`Case.via`). */
function viaOf(value: unknown): { app: FindingApp; at: string } {
	const o = obj(value, "case.via");
	return {
		app: appOf(o["app"], "case.via.app").app as FindingApp,
		at: str(o["at"], "case.via.at", 64),
	};
}

/**
 * A case's thread (DEC-046). A comment may name a mark the case no longer
 * has (deleted since): it stays, about "a deleted mark".
 */
function commentsOf(value: unknown, marks: Mark[]): CaseComment[] {
	const ids = new Set<string>();
	const live = new Set(marks.map((a) => a.id));
	return arr(value, "case.comments", MAX_CASE_COMMENTS).map(
		(v, i): CaseComment => {
			const p = `case.comments[${i}]`;
			const o = obj(v, p);
			const commentId = id(o["id"], `${p}.id`);
			if (ids.has(commentId)) fail(`${p}.id`, "is used twice");
			ids.add(commentId);
			const text = str(o["text"], `${p}.text`, MAX_CASE_COMMENT);
			if (text.trim() === "") fail(`${p}.text`, "must say something");
			const mark =
				o["mark"] === undefined ? undefined : str(o["mark"], `${p}.mark`, 64);
			const gone = mark !== undefined && !live.has(mark);
			return {
				id: commentId,
				...(mark === undefined || gone ? {} : { mark }),
				// About a live mark, or about one deleted: never both.
				...(gone || (mark === undefined && o["markGone"] === true)
					? { markGone: true }
					: {}),
				text,
				at: str(o["at"], `${p}.at`, 64),
				...userOf(o["user"], `${p}.user`),
				...appOf(o["app"], `${p}.app`),
				...(o["edited"] === undefined
					? {}
					: { edited: stampOf(o["edited"], `${p}.edited`) }),
				...(o["imported"] === true ? { imported: true as const } : {}),
				...(o["writerGone"] === true ? { writerGone: true as const } : {}),
			};
		},
	);
}

/** A case's list of pages (DEC-038); a page's language may be left out. */
function pagesOf(value: unknown): CasePage[] {
	return arr(value, "case.pages", MAX_PAGES).map((v, i): CasePage => {
		const p = `case.pages[${i}]`;
		const page = obj(v, p);
		return {
			url: str(page["url"], `${p}.url`, MAX_URL),
			title: str(page["title"], `${p}.title`, MAX_PAGE_TITLE),
			lang: language(page["lang"] ?? "", `${p}.lang`),
		};
	});
}

/**
 * A case's link as stored: a file Sitegloss wrote only has one `cleanLink`
 * gives, and one in another scheme (`javascript:`) never becomes a link.
 * What is kept is `cleanLink`'s reading of it, so what was checked here is
 * what opens: a file from elsewhere may spell an address another way.
 */
function linkOf(value: unknown, path: string): string {
	const link = cleanLink(str(value, path, MAX_LINK));
	if (link === undefined) return fail(path, "must be an http or https address");
	return link;
}

function resolution(value: unknown, path: string): Resolution {
	const o = obj(value, path);
	const kind = o["kind"];
	if (!RESOLUTION_KINDS.includes(kind as ResolutionKind))
		fail(`${path}.kind`, `must be one of ${RESOLUTION_KINDS.join(", ")}`);
	const note = o["note"];
	const verified = o["verified"];
	return {
		kind: kind as ResolutionKind,
		...(note === undefined || note === ""
			? {}
			: { note: str(note, `${path}.note`, MAX_COMMENT) }),
		at: str(o["at"], `${path}.at`, 64),
		...appOf(o["app"], `${path}.app`),
		// Only a fix is verified: on another kind it is dropped, not refused.
		...(verified === undefined || kind !== "fixed"
			? {}
			: { verified: verification(verified, `${path}.verified`) }),
		...importedOf(o["imported"], `${path}.imported`),
		...userOf(o["user"], `${path}.user`),
	};
}

function verification(value: unknown, path: string): Verification {
	const o = obj(value, path);
	return {
		at: str(o["at"], `${path}.at`, 64),
		...appOf(o["app"], `${path}.app`),
		...importedOf(o["imported"], `${path}.imported`),
		...userOf(o["user"], `${path}.user`),
	};
}

/**
 * Who did something, as a team's sync wrote it down (DEC-039), or nobody: an
 * addition a build before it leaves out, as every field it does not know.
 */
function person(value: unknown, path: string): UserRef | undefined {
	if (value === undefined || value === null) return undefined;
	const user = obj(value, path);
	return {
		id: str(user["id"], `${path}.id`, 64),
		name: str(user["name"], `${path}.name`, 200),
	};
}

function userOf(value: unknown, path: string): { user?: UserRef } {
	const user = person(value, path);
	return user === undefined ? {} : { user };
}

function createdByOf(value: unknown, path: string): { createdBy?: UserRef } {
	const createdBy = person(value, path);
	return createdBy === undefined ? {} : { createdBy };
}

/** `imported: true`, or nothing; anything else is refused. */
function importedOf(value: unknown, path: string): { imported?: true } {
	if (value !== undefined && typeof value !== "boolean")
		fail(path, "must be true or false");
	return value === true ? { imported: true } : {};
}

/** A resolution that came in from a file, its verification too. */
export const importedResolution = (r: Resolution): Resolution => ({
	...r,
	...(r.verified ? { verified: { ...r.verified, imported: true } } : {}),
	imported: true,
});

/** The AI app that set something, as a finding records it; none: nothing. */
function appOf(value: unknown, path: string): { app?: FindingApp } {
	if (value === undefined) return {};
	const app = obj(value, path);
	const name = app["name"];
	return {
		app: {
			id: str(app["id"], `${path}.id`, 2000),
			...(name === undefined ? {} : { name: str(name, `${path}.name`, 200) }),
			host: str(app["host"], `${path}.host`, 255),
		},
	};
}

/** A mark's reopens, the newest `MAX_REOPENS`; none or an empty list: none. */
function reopensOf(value: unknown, path: string): { reopens?: Reopen[] } {
	if (value === undefined) return {};
	const given = arr(value, path, 1000);
	const from = Math.max(0, given.length - MAX_REOPENS);
	const reopens = given.slice(from).map((v, j): Reopen => {
		const p = `${path}[${from + j}]`;
		const r = obj(v, p);
		const note = r["note"];
		return {
			...(note === undefined || note === ""
				? {}
				: { note: str(note, `${p}.note`, MAX_REOPEN_NOTE) }),
			at: str(r["at"], `${p}.at`, 64),
			...appOf(r["app"], `${p}.app`),
			was: cutWas(resolution(r["was"], `${p}.was`)),
			...importedOf(r["imported"], `${p}.imported`),
			...userOf(r["user"], `${p}.user`),
		};
	});
	return reopens.length > 0 ? { reopens } : {};
}

/** A mark's findings that did not fit the thread yet (DEC-081): checked, and kept as they came. */
function leftFindings(value: unknown, path: string): { findings?: unknown[] } {
	if (value === undefined) return {};
	findingsOf(value, path);
	return { findings: value as unknown[] };
}

/** A mark's findings; none, or an empty list: no `findings` at all. */
function findingsOf(value: unknown, path: string): { findings?: OldFinding[] } {
	if (value === undefined) return {};
	const ids = new Set<string>();
	const findings = arr(value, path, MAX_FINDINGS).map((v, i): OldFinding => {
		const p = `${path}[${i}]`;
		const f = obj(v, p);
		const findingId = id(f["id"], `${p}.id`);
		if (ids.has(findingId)) fail(`${p}.id`, "is used twice");
		ids.add(findingId);
		const app = obj(f["app"], `${p}.app`);
		const editedAt = f["editedAt"];
		const imported = f["imported"];
		if (imported !== undefined && typeof imported !== "boolean")
			fail(`${p}.imported`, "must be true or false");
		return {
			id: findingId,
			text: str(f["text"], `${p}.text`, MAX_FINDING),
			app: appOf(app, `${p}.app`).app as FindingApp,
			at: str(f["at"], `${p}.at`, 64),
			...(editedAt === undefined
				? {}
				: { editedAt: str(editedAt, `${p}.editedAt`, 64) }),
			...(imported === true ? { imported: true } : {}),
			...userOf(f["user"], `${p}.user`),
		};
	});
	return findings.length > 0 ? { findings } : {};
}

/**
 * A mark's added images (DEC-058); none, or an empty list: no `images` at
 * all. An id is unique in the whole case (`taken`), and the path is the one
 * its id gives: nothing else of the zip is ever read for one.
 */
function imagesOf(
	value: unknown,
	path: string,
	taken: Set<string>,
): { images?: MarkImage[] } {
	if (value === undefined) return {};
	const images = arr(value, path, MAX_MARK_IMAGES).map((v, i): MarkImage => {
		const p = `${path}[${i}]`;
		const x = obj(v, p);
		const imageId = id(x["id"], `${p}.id`);
		if (taken.has(imageId)) fail(`${p}.id`, "is used twice");
		taken.add(imageId);
		const image = str(x["image"], `${p}.image`);
		if (image !== addedImage(imageId))
			fail(`${p}.image`, `must be ${addedImage(imageId)}`);
		const added = obj(x["added"], `${p}.added`);
		return {
			id: imageId,
			image,
			added: {
				...stampOf(added, `${p}.added`),
				...importedOf(added["imported"], `${p}.added.imported`),
			},
		};
	});
	return images.length > 0 ? { images } : {};
}

function highest(value: unknown, marks: readonly Mark[]): number {
	const n = num(value, "case.lastNumber");
	if (!Number.isInteger(n) || n > MAX_NUMBER || marks.some((a) => a.number > n))
		fail(
			"case.lastNumber",
			"must be an integer no lower than any mark's number",
		);
	return n;
}

// --- findings, once kept apart, become comments (DEC-081) ----------------------

/**
 * The id of the comment a finding becomes here: the server's function (its
 * DEC-053), `f_` and the first 40 hexadecimal digits of the SHA-256 over the
 * UTF-8 bytes of the mark's id, a line feed and the finding's id, held to its
 * vectors (`test/finding-comment-id.json`); made from the mark's id here, so
 * it has the server's shape, not the value the server gives the same finding.
 * The same finding gives the same comment each time, never a second one.
 */
export function findingCommentId(markId: string, findingId: string): string {
	return `f_${sha256Hex(`${markId}\n${findingId}`).slice(0, 40)}`;
}

/** The shape of a comment's id that was a finding (`findingCommentId`), here or at the server. */
export const FINDING_COMMENT = /^f_[0-9a-f]{40}$/;

/**
 * A case with its marks' findings as comments on those marks (DEC-081): a
 * finding was what an AI app found out about a mark, and that is a comment
 * on the mark now. Each keeps its text as it is, its time, its app, the
 * person it was written for (in a case of a team) and whether it came from a
 * file; an edited one says when. The comments go into the thread by their
 * time; a finding whose comment is there already (the same id) adds nothing,
 * so the function can run on a case any number of times. A finding without
 * words makes none (the server's rule too). What does not fit the thread's
 * `MAX_CASE_COMMENTS` stays on its mark as it was, and becomes a comment when
 * a later run finds room. A finding that is not one (a file made by hand) fails as it did before.
 * Anything else of `value` is left as it is: `validateCase` checks it
 * afterwards, and the store's upgrade keeps a case it cannot read as it was.
 */
export function findingsAsComments(value: unknown): unknown {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return value;
	const o = value as Obj;
	const marks = o["marks"];
	if (!Array.isArray(marks)) return value;
	if (
		!marks.some(
			(m) =>
				m !== null &&
				typeof m === "object" &&
				(m as Obj)["findings"] !== undefined,
		)
	)
		return value;
	const thread: Obj[] = Array.isArray(o["comments"])
		? [...(o["comments"] as Obj[])]
		: [];
	const taken = new Set(
		thread.map((k) => (k !== null && typeof k === "object" ? k["id"] : "")),
	);
	const added: { comment: CaseComment; mark: number; raw: unknown }[] = [];
	const plain = marks.map((m, i) => {
		if (m === null || typeof m !== "object") return m;
		const { findings: given, ...mark } = m as Obj;
		if (given === undefined) return m;
		const markId = typeof mark["id"] === "string" ? mark["id"] : "";
		const { findings = [] } = findingsOf(given, `case.marks[${i}].findings`);
		const raws = given as unknown[];
		for (const [j, f] of findings.entries()) {
			const id = findingCommentId(markId, f.id);
			if (taken.has(id) || f.text.trim() === "") continue;
			taken.add(id);
			added.push({
				mark: i,
				raw: raws[j],
				comment: {
					id,
					mark: markId,
					text: f.text,
					at: f.at,
					...(f.user === undefined ? {} : { user: f.user }),
					app: f.app,
					...(f.editedAt === undefined
						? {}
						: {
								edited: {
									at: f.editedAt,
									...(f.user === undefined ? {} : { user: f.user }),
									app: f.app,
								},
							}),
					...(f.imported ? { imported: true as const } : {}),
				},
			});
		}
		return mark;
	});
	// By time, each after the comments written before it; the thread's own order stays.
	added.sort((x, y) => x.comment.at.localeCompare(y.comment.at));
	const left = new Map<number, unknown[]>();
	for (const { comment: k, mark, raw } of added) {
		if (thread.length >= MAX_CASE_COMMENTS) {
			left.set(mark, [...(left.get(mark) ?? []), raw]);
			continue;
		}
		const at = thread.findIndex(
			(other) =>
				other !== null &&
				typeof other === "object" &&
				typeof other["at"] === "string" &&
				other["at"].localeCompare(k.at) > 0,
		);
		if (at < 0) thread.push(k as unknown as Obj);
		else thread.splice(at, 0, k as unknown as Obj);
	}
	return {
		...o,
		marks: plain.map((m, i) =>
			left.has(i) ? { ...(m as Obj), findings: left.get(i) } : m,
		),
		...(thread.length > 0 ? { comments: thread } : {}),
	};
}
