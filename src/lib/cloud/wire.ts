/**
 * Between a case as it is stored here and as it travels (DEC-039): what of
 * it syncs, the operations that say how it differs from what the server last
 * had, and what a confirmed operation and a change from the server make of
 * the bookkeeping. Pure: the engine reads, sends and stores.
 */

import {
	addedImage,
	CASE_FORMAT,
	type Case,
	type CaseComment,
	type CasePage,
	casePages,
	cropImage,
	cutText,
	ELEMENT_ATTRIBUTES,
	type ElementDetails,
	type Finding,
	type FindingApp,
	type Highlight,
	highlightWithin,
	type ImageAdded,
	isSafeId,
	LANGUAGE,
	lookOf,
	MAX_CASE_COMMENT,
	MAX_CASE_COMMENTS,
	MAX_COMMENT,
	MAX_FINDING,
	MAX_FINDINGS,
	MAX_LINK,
	MAX_MARK_IMAGES,
	MAX_PAGE_TITLE,
	MAX_PAGES,
	MAX_PEN_POINTS,
	MAX_REOPEN_NOTE,
	MAX_REOPENS,
	MAX_TITLE,
	MAX_URL,
	MAX_VERDICT,
	type Mark,
	type MarkEnds,
	type MarkImage,
	markIdOf,
	markSignature,
	pageAt,
	pageKey,
	queryField,
	type Rect,
	type Reopen,
	type Resolution,
	type Shape,
	type Shot,
	type Stamp,
	samePage,
	shapeBounds,
	shapeOut,
	shotImage,
	shotUrl,
	type UserRef,
	withHeldImages,
	withoutLook,
} from "../case.ts";
import { cropRectFor } from "../save.ts";
import type {
	AppRef,
	ImageRef,
	Op,
	OpOf,
	WireCase,
	WireComment,
	WireElement,
	WireFinding,
	WireMark,
	WirePage,
	WireReopen,
	WireResolution,
	WireShot,
	WireStamp,
} from "./api.ts";
import type {
	CaseBook,
	CaseContent,
	ContentImage,
	MarkContent,
	Shadow,
	ShadowComment,
	ShadowMark,
	TheirMark,
} from "./book.ts";

// --- comparing -------------------------------------------------------------------

/**
 * `value` as one text, the same for the same content whatever the order of
 * its keys; what is `undefined` is left out, and so is who did something
 * (`user`): the server writes that down, a client never says it.
 */
export function canonical(value: unknown, users = false): string {
	return JSON.stringify(value, (key, inner: unknown) => {
		if (key === "user" && !users) return undefined;
		if (typeof inner !== "object" || inner === null || Array.isArray(inner))
			return inner;
		const sorted: Record<string, unknown> = {};
		for (const k of Object.keys(inner).sort())
			sorted[k] = (inner as Record<string, unknown>)[k];
		return sorted;
	});
}

export const same = (a: unknown, b: unknown): boolean =>
	canonical(a) === canonical(b);

/** A short, stable number of a text (cyrb53): enough to tell changes apart. */
export function hashText(text: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * An operation without its id, as one short text: the same change again has
 * the same. Without its image too (a new screenshot's, a new mark's crop):
 * which operation it is does not hang on that, and so what is held back is
 * known before any image is read.
 */
export function opKey(op: Op): string {
	const { opId: _id, ...rest } = op;
	const unread = (images: readonly NewMarkImage[] | undefined) =>
		images?.map((x) => ({ ...x, image: null }));
	const plain =
		rest.type === "shot.create"
			? { ...rest, shot: { ...rest.shot, image: null } }
			: rest.type === "mark.create"
				? {
						...rest,
						mark: {
							...rest.mark,
							crop: null,
							images: unread(rest.mark.images),
						},
					}
				: rest.type === "mark.patch" && rest.images?.add !== undefined
					? {
							...rest,
							images: { ...rest.images, add: unread(rest.images.add) },
						}
					: rest;
	return `${op.type}:${hashText(canonical(plain))}`;
}

/** An image to add to a mark, as an operation names it (DEC-058). */
export type NewMarkImage = NonNullable<
	NonNullable<OpOf<"mark.patch">["images"]>["add"]
>[number];

// --- what of a case syncs --------------------------------------------------------

/** A case's highest mark number used, a deleted mark's too. */
export const highestNumber = (c: Case): number =>
	Math.max(c.lastNumber ?? 0, ...c.marks.map((a) => a.number));

export function caseContent(c: Case): CaseContent {
	return {
		title: c.title,
		link: c.link ?? null,
		summary: c.verdict,
		lastNumber: highestNumber(c),
	};
}

export function markContent(a: Mark): MarkContent {
	return {
		comment: a.comment,
		author: a.author,
		resolution: a.resolution ?? null,
		reopens: a.reopens ?? [],
		findings: a.findings ?? [],
		images: (a.images ?? []).map((x) => ({ id: x.id, added: x.added })),
	};
}

/** An AI app as the server takes it (`via`, DEC-046): within its limits. */
export function appOut(app: FindingApp): AppRef {
	return {
		id: app.id.slice(0, 2000),
		...(app.name ? { name: cutText(app.name, 200) } : {}),
		host: app.host.slice(0, 255),
	};
}

/**
 * The AI app the case's last change was made through, while it is the last
 * change (`Case.via`); none: the person's, by hand. For what is the case's
 * own (its patch, closing and reopening) only: a mark, a comment and the
 * case's making say their own app (DEC-046).
 */
export function viaOf(c: Case): { via?: AppRef } {
	return c.via !== undefined && c.via.at === c.updatedAt
		? { via: appOut(c.via.app) }
		: {};
}

/**
 * `after`, a change the sync made to `before` (a merge, a renumbering), with
 * `before`'s AI app note carried over when the case's own content (title,
 * link, summary, closed) is as it was: the app's change is still what waits
 * to be sent (DEC-046).
 */
export function carryVia(before: Case | undefined, after: Case): Case {
	const via = before?.via;
	if (before === undefined || via === undefined) return after;
	if (via.at !== before.updatedAt) return after;
	// A note of its own, made with the change: that one.
	if (after.via !== undefined && after.via.at === after.updatedAt) return after;
	const same =
		after.title === before.title &&
		after.link === before.link &&
		after.verdict === before.verdict &&
		(after.closed === undefined) === (before.closed === undefined);
	return same
		? { ...after, via: { app: via.app, at: after.updatedAt } }
		: after;
}

/** The AI app a mark's last change was made through, while the mark is as it left it. */
export function markViaOf(a: Mark): { via?: AppRef } {
	return a.via !== undefined && a.via.of === markSignature(a)
		? { via: appOut(a.via.app) }
		: {};
}

/**
 * What never changes of a mark once it is made, as one text: its drawing
 * and its element, as they are after the way to the server and back. Both
 * sides are compared in that form everywhere: an element is cut on the way
 * out (an `id` of 600 characters goes as 500) and on the way in, and a
 * mark compared uncut here with itself cut there was "another mark", made
 * anew at every run. Without the element's computed styles, backdrop and
 * siblings (DEC-048): marks synced before had none, and a fingerprint that
 * took them in would make every one of them another drawing, deleted and
 * made again for the whole team (the lesson of `ends`, DEC-047).
 */
export function fixedOf(a: Pick<Mark, "shape" | "element">): string {
	const element = elementIn(elementOut(a.element));
	return hashText(
		canonical([
			// As the server has it: an unknown kind as it came (DEC-066).
			shapeOut(shapeIn(shapeOut(a.shape) as WireMark["shape"])),
			element === null ? null : withoutLook(element),
		]),
	);
}

// --- to the server ---------------------------------------------------------------

/** A timestamp the server takes (ISO 8601, UTC), or none. */
const stamp = (value: string | undefined): string | undefined =>
	value !== undefined &&
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)
		? value
		: undefined;

/** The element's details within what the server takes. */
function elementOut(e: ElementDetails | null): WireElement | null {
	if (e === null) return null;
	const { styles: _s, backdrop: _b, siblings: _i, ...rest } = e;
	return {
		...rest,
		...(e.id === undefined ? {} : { id: e.id.slice(0, 500) }),
		...(e.testId === undefined ? {} : { testId: e.testId.slice(0, 500) }),
		...(e.role === undefined ? {} : { role: e.role.slice(0, 200) }),
		// Within the server's rules again, so that nothing in them can make
		// the request invalid (DEC-048).
		...lookOf(e),
	};
}

/** The case as the server takes a new one. */
export function newCaseOf(c: Case): OpOf<"case.create">["case"] {
	const created = stamp(c.createdAt);
	const imported = stamp(c.importedAt);
	return {
		id: c.id,
		...caseContent(c),
		client: {
			viewport: c.page.viewport,
			userAgent: c.page.userAgent.slice(0, 1000),
			...(c.page.lang ? { lang: c.page.lang } : {}),
		},
		...(created ? { createdAt: created } : {}),
		...(imported ? { importedAt: imported } : {}),
	};
}

export function newShotOf(
	c: Case,
	shot: Shot,
	id: string,
	image: ImageRef,
): OpOf<"shot.create">["shot"] {
	return {
		id,
		url: shotUrl(c, shot),
		// To open the page again as it was (DEC-050); the server filters it
		// again, and one that does not know the field leaves it out.
		...(shot.query === undefined ? {} : { query: shot.query }),
		image,
		scrollX: shot.scrollX,
		scrollY: shot.scrollY,
		viewport: shot.viewport,
		capturedAt: stamp(shot.capturedAt) ?? EPOCH,
	};
}

/** A screenshot's page as `shot.create` names it: its title and language, where known. */
export function pageOfShot(
	c: Case,
	shot: Shot,
): { page?: { title?: string; lang?: string } } {
	const page = pageAt(c, shotUrl(c, shot));
	const named = {
		...(page?.title ? { title: page.title } : {}),
		...(page?.lang ? { lang: page.lang } : {}),
	};
	return Object.keys(named).length > 0 ? { page: named } : {};
}

export function newMarkOf(
	a: Mark,
	id: string,
	shotId: string,
	crop: ImageRef,
	createdAt: string | undefined,
	/** Its added images, each with its picture at the server (DEC-058). */
	images: NewMarkImage[] = [],
): OpOf<"mark.create">["mark"] {
	const content = markContent(a);
	const created = stamp(createdAt);
	return {
		id,
		number: a.number,
		shotId,
		comment: content.comment,
		author: content.author,
		// A kind this version does not know, as it came (DEC-066).
		shape: shapeOut(a.shape) as WireMark["shape"],
		crop,
		element: elementOut(a.element),
		resolution: content.resolution,
		reopens: content.reopens,
		findings: content.findings,
		...(images.length > 0 ? { images } : {}),
		...(created ? { createdAt: created } : {}),
		// An arrow's or an open stroke's ends (DEC-047; the server's DEC-020):
		// with the new mark only, cut as `element` is.
		...(a.ends === undefined
			? {}
			: {
					ends: {
						start: elementOut(a.ends.start),
						end: elementOut(a.ends.end),
					},
				}),
		// The text it marks (DEC-066; the server's DEC-040): with the new
		// mark only, as `ends`; the server keeps it or drops it whole.
		...(a.highlight === undefined ? {} : { highlight: a.highlight }),
	};
}

// --- finding the changes ---------------------------------------------------------

/** The server's ids of the marks and screenshots, to their ids here. */
export function reverse(map: Record<string, string>): Map<string, string> {
	return new Map(Object.entries(map).map(([here, there]) => [there, here]));
}

/** What stands for an image's picture where only whether one goes counts. */
const ANY_IMAGE: ImageRef = { sha256: "", width: 1, height: 1, bytes: 1 };

/**
 * The images to add, each with its picture (`image` of its path; one that
 * is not here is left out and named in `missing`), and to remove: what is
 * here and the server did not have, and the reverse (DEC-058). A shadow
 * that was not told of images is taken as none.
 */
function imagesPatch(
	local: MarkContent,
	before: MarkContent,
	image: (path: string) => ImageRef | undefined,
	missing: string[],
): OpOf<"mark.patch">["images"] {
	const had = new Set((before.images ?? []).map((x) => x.id));
	const kept = new Set((local.images ?? []).map((x) => x.id));
	const add: NewMarkImage[] = [];
	for (const x of local.images ?? []) {
		if (had.has(x.id)) continue;
		const ref = image(addedImage(x.id));
		if (ref === undefined) missing.push(addedImage(x.id));
		else add.push(newImageOf(x, ref));
	}
	const remove = [...had].filter((id) => !kept.has(id));
	return add.length > 0 || remove.length > 0
		? {
				...(add.length > 0 ? { add } : {}),
				...(remove.length > 0 ? { remove } : {}),
			}
		: undefined;
}

/** An image as an operation adds it: its time is believed only for an imported case. */
export function newImageOf(x: ContentImage, ref: ImageRef): NewMarkImage {
	const at = stamp(x.added.at);
	return { id: x.id, image: ref, ...(at ? { at } : {}) };
}

/**
 * What a mark's patch has to say for `local` to become what the server has.
 * `image` gives an added image's picture (by its path); without one, only
 * whether something is to be said counts.
 */
export function markPatch(
	local: MarkContent,
	before: MarkContent,
	image: (path: string) => ImageRef | undefined = () => ANY_IMAGE,
	missing: string[] = [],
): Omit<OpOf<"mark.patch">, "opId" | "type" | "markId"> | undefined {
	const patch: Omit<OpOf<"mark.patch">, "opId" | "type" | "markId"> = {};
	if (local.comment !== before.comment || local.author !== before.author) {
		patch.comment = local.comment;
		patch.author = local.author;
	}
	if (
		!same(
			[local.resolution, local.reopens],
			[before.resolution, before.reopens],
		)
	)
		patch.state = { resolution: local.resolution, reopens: local.reopens };
	const known = new Map(before.findings.map((f) => [f.id, f]));
	const upsert = local.findings.filter((f) => !same(f, known.get(f.id)));
	const kept = new Set(local.findings.map((f) => f.id));
	const remove = before.findings
		.filter((f) => !kept.has(f.id))
		.map((f) => f.id);
	if (upsert.length > 0 || remove.length > 0)
		patch.findings = {
			...(upsert.length > 0 ? { upsert } : {}),
			...(remove.length > 0 ? { remove } : {}),
		};
	const images = imagesPatch(local, before, image, missing);
	if (images !== undefined) patch.images = images;
	return Object.keys(patch).length > 0 ? patch : undefined;
}

/** What a case's patch has to say. */
export function casePatch(
	local: CaseContent,
	before: CaseContent,
): Omit<OpOf<"case.patch">, "opId" | "type" | "caseId"> | undefined {
	const patch: Omit<OpOf<"case.patch">, "opId" | "type" | "caseId"> = {};
	if (local.title !== before.title) patch.title = local.title;
	if (local.link !== before.link) patch.link = local.link;
	if (local.summary !== before.summary) patch.summary = local.summary;
	// Never the pages: the server keeps that list from the screenshots, and a
	// patch of it would replace the whole list with this device's view of it.
	// The server only ever raises it.
	if (local.lastNumber > before.lastNumber) patch.lastNumber = local.lastNumber;
	return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * Ids written down before their case was stored (`CaseBook.announced`) are
 * taken as the server's only for the mark or screenshot they were meant
 * for: one that is not here (the case was never stored), or is another one
 * by now (a mark the user made under that id since), loses the id. The
 * note itself goes: it is settled.
 */
export function settleAnnounced(
	c: Case | undefined,
	book: CaseBook,
): Set<string> {
	/** Marks of the server's that lost the id they were announced under. */
	const loose = new Set<string>();
	const told = book.announced;
	if (told === undefined) return loose;
	const marks = new Map((c?.marks ?? []).map((a) => [a.id, a]));
	const shots = new Map((c?.shots ?? []).map((s) => [s.id, s]));
	for (const [id, fixed] of Object.entries(told.marks)) {
		const a = marks.get(id);
		if (a === undefined || fixedOf(a) !== fixed) {
			const wire = book.marks[id];
			if (wire !== undefined) loose.add(wire);
			delete book.marks[id];
		}
	}
	for (const [id, capturedAt] of Object.entries(told.shots))
		if (shots.get(id)?.capturedAt !== capturedAt) delete book.shots[id];
	delete book.announced;
	return loose;
}

/** What a time that the server does not take is sent as. */
const EPOCH = new Date(0).toISOString();

/** A time as an instant; what is no time is the epoch, as it is sent. */
const instant = (time: string | undefined): number => {
	const ms = Date.parse(time ?? "");
	return Number.isNaN(ms) ? 0 : ms;
};

/**
 * The book made true to the case before anything is derived from it. What
 * an id here stands for can change without the book hearing of it:
 *
 * - Ids written down before their case was stored (`settleAnnounced`).
 * - A screenshot's id here (`s<n>`) is given again after an Undo or a
 *   delete: a screenshot taken at another time than the server's is not
 *   the server's.
 * - A mark's id here (`m<number>`) is another mark's after a renumbering
 *   this server's book did not hear of (the case synced with another
 *   server meanwhile, DEC-041): a mark with another drawing, or on another
 *   screenshot, than the server's mark is not that mark.
 *
 * And the other way round: a mark here without an id at the server, when
 * the server has a mark that no mark here stands for, with the same
 * drawing on the same screenshot. It is the same mark when it has the same
 * number, or when the server's mark has lost its mark here: the id it was
 * known under is gone (the mark was renumbered and the bookkeeping not
 * written before the worker stopped), or was shown to be another mark's.
 * They are put together again, so the mark is neither deleted nor made a
 * second time.
 */
export function relink(c: Case, book: CaseBook): void {
	// A mark that was to move to an announced id and did not (the case was
	// not stored) is still here, under the id it had: found again below.
	const loose = settleAnnounced(c, book);
	const shadow = book.shadow;
	if (shadow === undefined) return;
	for (const s of c.shots) {
		const wire = book.shots[s.id];
		const before = wire === undefined ? undefined : shadow.shots[wire];
		// As instants, and the time here as it is sent: a time written another
		// way than the server takes (an offset, no seconds, a space: a case
		// from a file) goes as the epoch, and compared as it stands it would
		// be "another screenshot" for ever, its marks deleted and made again.
		if (
			before?.capturedAt !== undefined &&
			instant(before.capturedAt) !== instant(stamp(s.capturedAt) ?? EPOCH)
		)
			delete book.shots[s.id];
	}
	const here = new Set(c.marks.map((a) => a.id));
	for (const id of Object.keys(book.marks))
		if (!here.has(id) && shadow.marks[book.marks[id] as string] === undefined)
			delete book.marks[id];
	/**
	 * Marks of the server's whose mark here turned out to be another one, or
	 * is under its old id no more (renumbered, the book not written).
	 */
	const freed = new Set<string>([
		...loose,
		...Object.entries(book.marks)
			.filter(([id]) => !here.has(id))
			.map(([, wire]) => wire),
	]);
	for (const a of c.marks) {
		const wire = book.marks[a.id];
		const before = wire === undefined ? undefined : shadow.marks[wire];
		if (wire === undefined || before === undefined) continue;
		if (before.fixed !== fixedOf(a) || before.shotId !== book.shots[a.shot]) {
			delete book.marks[a.id];
			freed.add(wire);
		}
	}
	const stood = new Set(
		Object.entries(book.marks)
			.filter(([id]) => here.has(id))
			.map(([, wire]) => wire),
	);
	const orphans = Object.entries(shadow.marks).filter(([id]) => !stood.has(id));
	if (orphans.length === 0) return;
	for (const a of c.marks) {
		if (book.marks[a.id] !== undefined) continue;
		const shot = book.shots[a.shot];
		if (shot === undefined) continue;
		const at = orphans.findIndex(
			([wire, mark]) =>
				mark.shotId === shot &&
				mark.fixed === fixedOf(a) &&
				(mark.number === a.number || freed.has(wire)),
		);
		if (at < 0) continue;
		const [wire] = orphans.splice(at, 1)[0] as [string, ShadowMark];
		for (const [id, other] of Object.entries(book.marks))
			if (other === wire) delete book.marks[id];
		book.marks[a.id] = wire;
	}
}

/** The images the operations for a case name: the engine uploads them first. */
export interface ImageNeed {
	/** The image's path in the case here. */
	path: string;
}

/**
 * The operations that make the server's copy of the case what it is here,
 * in the order they have to go; `book` gets an id for each mark and
 * screenshot the server does not know yet (and is not written here).
 * `image` says what the server calls an image of the case; `undefined`: it
 * is not here (the mark or screenshot is then left out, and named in
 * `missing`).
 */
export function deriveOps(
	c: Case,
	book: CaseBook,
	image: (path: string) => ImageRef | undefined,
	newId: (prefix: string) => string,
	/** Who is signed in: only their own comments are deleted from here. */
	me?: string,
): { ops: Op[]; missing: string[] } {
	relink(c, book);
	const ops: Op[] = [];
	const missing: string[] = [];
	const shadow = book.shadow;
	const content = caseContent(c);
	// An AI app's change names the app (DEC-046); the person's never does.
	const via = viaOf(c);
	if (shadow === undefined)
		ops.push({
			opId: newId("o"),
			type: "case.create",
			case: newCaseOf(c),
			// Only when an app's call made the case: sharing it is the person's.
			...(c.createdVia === undefined ? {} : { via: appOut(c.createdVia) }),
		});
	else {
		const patch = casePatch(content, shadow.case);
		if (patch !== undefined)
			ops.push({
				opId: newId("o"),
				type: "case.patch",
				caseId: c.id,
				...patch,
				...via,
			});
		// Open again before any mark goes (a mark sent first would open it
		// at the server by itself, and the reopen would be a duplicate).
		if (shadow.closed === true && c.closed === undefined)
			ops.push({ opId: newId("o"), type: "case.reopen", caseId: c.id, ...via });
	}
	const marks = shadow?.marks ?? {};
	const shots = shadow?.shots ?? {};
	const byId = new Map(c.marks.map((a) => [a.id, a]));
	// A mark whose drawing is another one now (a file replaced the case) is
	// another mark: the old one goes, this one is new.
	for (const a of c.marks) {
		const wire = book.marks[a.id];
		const before = wire === undefined ? undefined : marks[wire];
		if (before !== undefined && before.fixed !== fixedOf(a))
			delete book.marks[a.id];
	}
	const standing = new Set(
		Object.entries(book.marks)
			.filter(([id]) => byId.has(id))
			.map(([, wire]) => wire),
	);
	for (const wire of Object.keys(marks))
		if (!standing.has(wire))
			ops.push({ opId: newId("o"), type: "mark.delete", markId: wire });
	// Screenshots the server does not have, for the marks that need them.
	const left = new Set<string>();
	for (const shot of c.shots) {
		const known = book.shots[shot.id];
		if (known !== undefined && shots[known] !== undefined) continue;
		const ref = image(shot.image);
		if (ref === undefined) {
			missing.push(shot.image);
			left.add(shot.id);
			continue;
		}
		const id = known ?? newId("sh");
		book.shots[shot.id] = id;
		ops.push({
			opId: newId("o"),
			type: "shot.create",
			// What the page is called, for the server's list of pages: it adds
			// the page with the first screenshot of it (DEC-039).
			...pageOfShot(c, shot),
			caseId: c.id,
			shot: newShotOf(c, shot, id, ref),
		});
	}
	const sorted = [...c.marks].sort((x, y) => x.number - y.number);
	for (const a of sorted) {
		const wire = book.marks[a.id];
		if (wire !== undefined && marks[wire] !== undefined) continue;
		const shotId = book.shots[a.shot];
		const ref = image(a.crop);
		if (shotId === undefined || left.has(a.shot) || ref === undefined) {
			if (ref === undefined) missing.push(a.crop);
			continue;
		}
		const id = wire ?? newId("m");
		book.marks[a.id] = id;
		const shot = c.shots.find((s) => s.id === a.shot);
		// Its added images go with it; one not here is left out, and named.
		const images: NewMarkImage[] = [];
		for (const x of markContent(a).images ?? []) {
			const picture = image(addedImage(x.id));
			if (picture === undefined) missing.push(addedImage(x.id));
			else images.push(newImageOf(x, picture));
		}
		ops.push({
			opId: newId("o"),
			type: "mark.create",
			caseId: c.id,
			mark: newMarkOf(a, id, shotId, ref, shot?.capturedAt, images),
			// Made through an AI app of this browser's: that app.
			...(a.createdVia === undefined ? {} : { via: appOut(a.createdVia) }),
		});
	}
	for (const a of sorted) {
		const wire = book.marks[a.id];
		const before = wire === undefined ? undefined : marks[wire];
		if (wire === undefined || before === undefined) continue;
		const patch = markPatch(markContent(a), before.content, image, missing);
		if (patch !== undefined)
			ops.push({
				opId: newId("o"),
				type: "mark.patch",
				markId: wire,
				...patch,
				...markViaOf(a),
			});
	}
	ops.push(...commentOps(c, book, newId, me));
	// Closed once the marks are there: a new open mark sent after the close
	// would open it again at the server.
	if (c.closed !== undefined && shadow?.closed !== true)
		ops.push({ opId: newId("o"), type: "case.close", caseId: c.id, ...via });
	return { ops, missing };
}

/**
 * The thread's operations (DEC-046): comments not at the server yet, in the
 * thread's order; changed texts; and deletes of one's own comments the
 * server still has. A comment about a mark the server does not have yet
 * waits for it; one about a mark deleted since goes as the case's.
 */
function commentOps(
	c: Case,
	book: CaseBook,
	newId: (prefix: string) => string,
	me: string | undefined,
): Op[] {
	const ops: Op[] = [];
	const known = book.shadow?.comments ?? {};
	const here = new Set((c.comments ?? []).map((k) => k.id));
	const deletedBy = new Map((c.deletedVia ?? []).map((d) => [d.id, d.app]));
	for (const [id, before] of Object.entries(known))
		if (!here.has(id) && ownAtServer(before, me)) {
			const app = deletedBy.get(id);
			ops.push({
				opId: newId("o"),
				type: "comment.delete",
				commentId: id,
				// The app that deleted it, if one did; by hand, none.
				...(app === undefined ? {} : { via: appOut(app) }),
			});
		}
	for (const k of c.comments ?? []) {
		const before = known[k.id];
		if (before === undefined) {
			const markId = k.mark === undefined ? undefined : book.marks[k.mark];
			if (k.mark !== undefined && markId === undefined) continue;
			ops.push({
				opId: newId("o"),
				type: "comment.create",
				caseId: c.id,
				comment: {
					id: k.id,
					text: k.text,
					...(markId === undefined ? {} : { markId }),
					at: k.at,
				},
				...(k.app === undefined || k.imported ? {} : { via: appOut(k.app) }),
			});
		} else if (before.text !== k.text && ownAtServer(before, me))
			// Only one's own: another's text here is the server's again at
			// the next merge (DEC-046).
			ops.push({
				opId: newId("o"),
				type: "comment.patch",
				commentId: k.id,
				text: k.text,
				...(k.edited?.app === undefined || k.imported
					? {}
					: { via: appOut(k.edited.app) }),
			});
	}
	return ops;
}

/** A comment the server has is one's own: written by the person signed in (or not known). */
const ownAtServer = (before: ShadowComment, me: string | undefined) =>
	before.userId === undefined || before.userId === me;

/** The case's content as a new case's operation said it. */
const contentOfNew = (n: OpOf<"case.create">["case"]): CaseContent => ({
	title: n.title,
	link: n.link ?? null,
	summary: n.summary ?? null,
	lastNumber: n.lastNumber ?? 0,
});

/**
 * What the server has of the case once it took `op`: the shadow follows.
 * `number`: the number the server gave a new mark.
 */
export function applyOp(book: CaseBook, op: Op, number?: number): void {
	if (op.type === "case.create") {
		// A new case's thread is empty at the server: known as such (a shadow
		// without one is a book from before DEC-046, read again once).
		book.shadow = {
			case: contentOfNew(op.case),
			shots: {},
			marks: {},
			comments: {},
		};
		return;
	}
	const shadow = book.shadow;
	if (shadow === undefined) return;
	switch (op.type) {
		case "case.patch":
			shadow.case = {
				title: op.title ?? shadow.case.title,
				link: op.link === undefined ? shadow.case.link : op.link,
				summary: op.summary === undefined ? shadow.case.summary : op.summary,
				lastNumber: Math.max(shadow.case.lastNumber, op.lastNumber ?? 0),
			};
			return;
		case "shot.create":
			shadow.shots[op.shot.id] = {
				image: op.shot.image,
				capturedAt: op.shot.capturedAt,
			};
			return;
		case "mark.create": {
			const n = number ?? op.mark.number;
			shadow.marks[op.mark.id] = {
				number: n,
				shotId: op.mark.shotId,
				content: {
					comment: op.mark.comment,
					author: op.mark.author ?? "user",
					resolution: op.mark.resolution ?? null,
					reopens: op.mark.reopens ?? [],
					findings: op.mark.findings ?? [],
					images: (op.mark.images ?? []).map(sentImage),
				},
				fixed: fixedOf({
					shape: op.mark.shape as Shape,
					element: op.mark.element as ElementDetails | null,
				}),
			};
			shadow.case.lastNumber = Math.max(shadow.case.lastNumber, n);
			return;
		}
		case "mark.patch": {
			const mark = shadow.marks[op.markId];
			if (mark === undefined) return;
			const c = mark.content;
			if (op.comment !== undefined) c.comment = op.comment;
			if (op.author !== undefined) c.author = op.author;
			if (op.state !== undefined) {
				c.resolution = op.state.resolution;
				c.reopens = op.state.reopens;
			}
			if (op.findings !== undefined) {
				const gone = new Set(op.findings.remove ?? []);
				const kept = c.findings.filter((f) => !gone.has(f.id));
				for (const f of op.findings.upsert ?? []) {
					const at = kept.findIndex((k) => k.id === f.id);
					if (at >= 0) kept[at] = f;
					else kept.push(f);
				}
				c.findings = kept;
			}
			// Removed first, then added; an id the mark has stays (the server's rule).
			if (op.images !== undefined) {
				const gone = new Set(op.images.remove ?? []);
				const kept = (c.images ?? []).filter((x) => !gone.has(x.id));
				for (const x of op.images.add ?? [])
					if (!kept.some((k) => k.id === x.id)) kept.push(sentImage(x));
				c.images = kept;
			}
			return;
		}
		case "mark.delete":
			dropMark(book, op.markId);
			return;
		case "case.close":
			shadow.closed = true;
			return;
		case "case.reopen":
			shadow.closed = false;
			return;
		case "comment.create":
			shadow.comments = {
				...shadow.comments,
				[op.comment.id]: { text: op.comment.text },
			};
			return;
		case "comment.patch": {
			const before = shadow.comments?.[op.commentId];
			if (before !== undefined) before.text = op.text;
			return;
		}
		case "comment.delete":
			if (shadow.comments !== undefined) delete shadow.comments[op.commentId];
			return;
		default:
			return;
	}
}

/** The paths here of the images added to marks that an operation sends (DEC-058). */
export function addedImagesOf(op: Op): string[] {
	const images =
		op.type === "mark.create"
			? (op.mark.images ?? [])
			: op.type === "mark.patch"
				? (op.images?.add ?? [])
				: [];
	return images.map((x) => addedImage(x.id));
}

/** An image as the server has it once an operation added it. */
const sentImage = (x: NewMarkImage): ContentImage => ({
	id: x.id,
	added: { at: x.at ?? "" },
	ref: x.image,
});

/** Forget a mark of the shadow, and its screenshot when no mark is on it any more. */
export function dropMark(book: CaseBook, wire: string): void {
	const shadow = book.shadow;
	const mark = shadow?.marks[wire];
	if (shadow === undefined || mark === undefined) return;
	delete shadow.marks[wire];
	for (const [here, there] of Object.entries(book.marks))
		if (there === wire) delete book.marks[here];
	if (!Object.values(shadow.marks).some((m) => m.shotId === mark.shotId))
		dropShot(book, mark.shotId);
}

export function dropShot(book: CaseBook, wire: string): void {
	if (book.shadow !== undefined) delete book.shadow.shots[wire];
	for (const [here, there] of Object.entries(book.shots))
		if (there === wire) delete book.shots[here];
}

// --- from the server -------------------------------------------------------------

const text = (value: unknown, max: number): string =>
	typeof value === "string" ? cutText(value, max) : "";

const lang = (value: unknown): string =>
	typeof value === "string" && LANGUAGE.test(value) ? value : "";

const userIn = (value: unknown): { user?: UserRef } => {
	const u = value as UserRef | null | undefined;
	return typeof u?.id === "string" && typeof u.name === "string"
		? { user: { id: u.id.slice(0, 64), name: cutText(u.name, 200) } }
		: {};
};

const appIn = (app: WireResolution["app"]): Pick<Resolution, "app"> =>
	app === undefined
		? {}
		: {
				app: {
					id: text(app.id, 2000),
					...(app.name ? { name: text(app.name, 200) } : {}),
					host: text(app.host, 255),
				},
			};

/** When, by whom, through which app, as the server says it (DEC-046). */
export function stampIn(w: WireStamp): Stamp {
	return {
		at: text(w.at, 64),
		...userIn(w.user),
		...appIn(w.app),
	};
}

/** A comment of the server's, its mark by its id here (`marks`: the server's id to the one here). */
export function commentIn(
	w: WireComment,
	marks: ReadonlyMap<string, string>,
): CaseComment {
	const mark = w.markId === null ? undefined : marks.get(w.markId);
	return {
		id: w.id,
		...(mark === undefined ? {} : { mark }),
		...(w.markId !== null && mark === undefined ? { markGone: true } : {}),
		text: text(w.text, MAX_CASE_COMMENT) || "…",
		at: text(w.at, 64),
		...userIn(w.user),
		// Synced with no writer: the account is gone, and it is nobody's own.
		...(w.user === null ? { writerGone: true as const } : {}),
		...appIn(w.app),
		...(w.edited === undefined ? {} : { edited: stampIn(w.edited) }),
	};
}

function resolutionIn(r: WireResolution): Resolution {
	return {
		kind: r.kind,
		...(r.note ? { note: text(r.note, MAX_COMMENT) } : {}),
		at: text(r.at, 64),
		...appIn(r.app),
		...(r.verified && r.kind === "fixed"
			? {
					verified: {
						at: text(r.verified.at, 64),
						...appIn(r.verified.app),
						...(r.verified.imported ? { imported: true } : {}),
						...userIn(r.verified.user),
					},
				}
			: {}),
		...(r.imported ? { imported: true } : {}),
		...userIn(r.user),
	};
}

/**
 * A reopen as a case here keeps it: the note of the resolution it ended is
 * cut as `validateCase` cuts it. What comes in has to be what is then
 * stored, to the letter: a difference between the two would read as a
 * change made here, and be sent, for ever.
 */
function wasIn(r: WireResolution): Resolution {
	const was = resolutionIn(r);
	return was.note !== undefined && was.note.length > MAX_REOPEN_NOTE
		? { ...was, note: cutText(was.note, MAX_REOPEN_NOTE) }
		: was;
}

const reopenIn = (r: WireReopen): Reopen => ({
	...(r.note ? { note: text(r.note, MAX_REOPEN_NOTE) } : {}),
	at: text(r.at, 64),
	...appIn(r.app),
	was: wasIn(r.was),
	...(r.imported ? { imported: true } : {}),
	...userIn(r.user),
});

const findingIn = (f: WireFinding): Finding => ({
	id: f.id,
	text: text(f.text, MAX_FINDING),
	app: appIn(f.app).app as Finding["app"],
	at: text(f.at, 64),
	...(f.editedAt ? { editedAt: text(f.editedAt, 64) } : {}),
	...(f.imported ? { imported: true } : {}),
	...userIn(f.user),
});

/** A mark's content as the server has it, within what a case here holds. */
export function contentIn(m: WireMark): MarkContent {
	return {
		comment: text(m.comment, MAX_COMMENT),
		author: m.author === "ai" ? "ai" : "user",
		resolution: m.resolution ? resolutionIn(m.resolution) : null,
		reopens: (m.reopens ?? []).slice(-MAX_REOPENS).map(reopenIn),
		findings: (m.findings ?? []).slice(0, MAX_FINDINGS).map(findingIn),
		// Absent: a server that does not keep images says nothing of them.
		...(m.images === undefined ? {} : { images: imagesIn(m.images) }),
	};
}

/**
 * A mark's images as the server has them (DEC-058), within what a case here
 * holds: an id that cannot be a path here is left out.
 */
function imagesIn(images: NonNullable<WireMark["images"]>): ContentImage[] {
	const seen = new Set<string>();
	const out: ContentImage[] = [];
	for (const x of images) {
		if (!isSafeId(x.id) || seen.has(x.id)) continue;
		seen.add(x.id);
		out.push({
			id: x.id,
			added: {
				...stampIn(x.added),
				...(x.added.imported ? { imported: true as const } : {}),
			},
			ref: x.image,
		});
	}
	return out.slice(0, MAX_MARK_IMAGES);
}

/** A mark's ends as the server sends them (DEC-047; the server's DEC-020). */
function endsIn(e: NonNullable<WireMark["ends"]>): MarkEnds {
	return { start: elementIn(e.start), end: elementIn(e.end) };
}

function elementIn(e: WireElement | null | undefined): ElementDetails | null {
	if (e === null || e === undefined) return null;
	const attributes: Record<string, string> = {};
	for (const key of ELEMENT_ATTRIBUTES) {
		const value = e.attributes?.[key];
		if (typeof value === "string") attributes[key] = value.slice(0, 2000);
	}
	const optional = (
		key: "id" | "testId" | "role" | "name" | "text" | "heading" | "landmark",
	) =>
		typeof e[key] === "string"
			? { [key]: (e[key] as string).slice(0, 2000) }
			: {};
	return {
		tag: text(e.tag, 64),
		...optional("id"),
		...optional("testId"),
		...optional("role"),
		...optional("name"),
		...optional("text"),
		classes: (e.classes ?? []).slice(0, 200).map((c) => text(c, 200)),
		attributes,
		...optional("heading"),
		...optional("landmark"),
		ancestors: (e.ancestors ?? []).slice(0, 50).map((a) => text(a, 300)),
		rect: e.rect,
		page: e.page,
		selector: text(e.selector, 2000),
		// A mark's computed styles, backdrop and siblings (DEC-048): kept,
		// never fingerprinted (`fixedOf`).
		...lookOf(e),
	} as ElementDetails;
}

/**
 * A mark's shape from the server: one of a kind this version does not know
 * is kept as it came (DEC-066), and the case still syncs.
 */
function shapeIn(shape: WireMark["shape"]): Shape {
	const kind = (shape as { kind: unknown }).kind;
	if (kind === "pen" && "points" in shape)
		return { kind: "pen", points: shape.points.slice(0, MAX_PEN_POINTS) };
	if (
		kind === "element" ||
		kind === "box" ||
		kind === "arrow" ||
		kind === "note"
	)
		return shape as Shape;
	return {
		kind: "unknown",
		given: { ...(shape as Record<string, unknown>), kind: String(kind) },
	};
}

/** A highlight from the server, within the limits, on a box; else none (DEC-066). */
const highlightIn = (w: WireMark, shape: Shape): { highlight?: Highlight } => {
	const highlight = highlightWithin(w.highlight, shape);
	return highlight === undefined ? {} : { highlight };
};

const pagesIn = (pages: readonly WirePage[]): CasePage[] =>
	pages.slice(0, MAX_PAGES).map((p) => ({
		url: text(p.url, MAX_URL),
		title: text(p.title, MAX_PAGE_TITLE),
		lang: lang(p.lang),
	}));

/**
 * The case with the list of pages the server sent (DEC-039): the server
 * keeps that list, from the screenshots, and it is taken as it is. `page` is
 * its first page, with the window of that page's first screenshot. An empty
 * list: the first screenshot's page; without screenshots, what the case had.
 * A page only this device knows yet (its screenshot has not been sent, or
 * was not taken) stays after the server's, with its title.
 */
export function withPagesOf(c: Case, server: readonly CasePage[]): Case {
	// A screenshot from before screenshots named their page is of `page`,
	// and says so before `page` becomes another one.
	const shots = c.shots.some((s) => s.url === undefined)
		? c.shots.map((s) => (s.url === undefined ? { ...s, url: c.page.url } : s))
		: c.shots;
	const pinned = shots === c.shots ? c : { ...c, shots };
	const listed = new Set(server.map((p) => pageKey(p.url)));
	const taken = new Set(shots.map((s) => pageKey(s.url ?? c.page.url)));
	const own = casePages(pinned).filter(
		(p) => !listed.has(pageKey(p.url)) && taken.has(pageKey(p.url)),
	);
	const pages = casePages({ ...pinned, shots: [], pages: [...server, ...own] });
	const first = server.length > 0 || shots.length > 0 ? pages[0] : undefined;
	if (first === undefined || pages.length === 0) return pinned;
	const made = shots.find((s) => samePage(s.url ?? "", first.url));
	return {
		...pinned,
		pages,
		page: {
			...c.page,
			url: first.url,
			title: first.title,
			lang: first.lang || c.page.lang,
			...(made === undefined ? {} : { viewport: made.viewport }),
		},
	};
}

/** What of a case the server has that a patch can say, within what a case here holds. */
export function caseContentIn(w: WireCase): CaseContent {
	return {
		title: text(w.title, MAX_TITLE),
		link:
			typeof w.link === "string" && w.link.length <= MAX_LINK ? w.link : null,
		summary:
			typeof w.summary === "string" && w.summary !== ""
				? text(w.summary, MAX_VERDICT)
				: null,
		lastNumber: Number.isInteger(w.lastNumber) ? w.lastNumber : 0,
	};
}

/** A number of what a mark says: its comment, how it was settled, its findings. */
export const saidOf = (m: MarkContent): string =>
	hashText(
		canonical([
			m.comment,
			m.resolution?.kind ?? null,
			m.resolution?.note ?? "",
			m.findings.map((f) => f.text),
			m.reopens.length,
		]),
	);

/** A mark of the team's, as a book keeps it of a case that is not the team's here. */
export function theirMark(w: WireMark): TheirMark {
	return {
		number: w.number,
		fixed: fixedOf({ shape: shapeIn(w.shape), element: elementIn(w.element) }),
		said: saidOf(contentIn(w)),
	};
}

/**
 * How many marks of the case here the team has too (the same number and
 * drawing) and says something else of: joining the two cases keeps the
 * team's words for those.
 */
export function differing(
	c: Case,
	theirs: Readonly<Record<string, TheirMark>>,
): number {
	const here = new Map(c.marks.map((a) => [a.number, a]));
	let n = 0;
	for (const mark of Object.values(theirs)) {
		const a = here.get(mark.number);
		if (
			a !== undefined &&
			fixedOf(a) === mark.fixed &&
			saidOf(markContent(a)) !== mark.said
		)
			n++;
	}
	return n;
}

/** What came from the server about one case since the last time. */
export interface Incoming {
	case?: WireCase;
	shots: WireShot[];
	marks: WireMark[];
	/** Ids at the server of marks and screenshots it no longer has. */
	removedMarks: string[];
	removedShots: string[];
	/** The thread's new and changed comments (DEC-046); with `whole`, all of them, in the server's order. */
	comments?: WireComment[];
	/** Ids of comments the server no longer has. */
	removedComments?: string[];
}

/** An image a merge writes: where, and which of the server's. */
export interface ImageWanted {
	path: string;
	image: ImageRef;
}

export interface Merged {
	value: Case;
	book: CaseBook;
	/** Images the merge writes, by path, and paths it takes away. */
	images: Map<string, unknown>;
	deleteImages: string[];
	/** The case here is another one now. */
	changed: boolean;
}

/** A merge needs an image it was not given: read it, and merge again. */
export class NeedsImage extends Error {
	constructor(
		/** A path of the case here whose image has to be read. */
		readonly local: string | undefined,
		/** An image of the server's that has to be fetched. */
		readonly remote: ImageRef | undefined,
	) {
		super("an image is needed");
	}
}

/** A case here for one the server has and this device does not. */
function caseOf(w: WireCase, shots: readonly WireShot[]): Case {
	const pages = pagesIn(w.pages ?? []);
	const first = pages[0] ?? { url: shots[0]?.url ?? "", title: "", lang: "" };
	// The window of the first page: that of its first screenshot.
	const made = shots.find((s) => samePage(s.url, first.url)) ?? shots[0];
	return {
		format: CASE_FORMAT,
		id: w.id,
		title: text(w.title, MAX_TITLE) || "Untitled case",
		createdAt: text(w.createdAt, 64),
		updatedAt: text(w.updatedAt, 64),
		page: {
			url: first.url,
			title: first.title,
			lang: first.lang || lang(w.client?.lang),
			viewport: made?.viewport ??
				w.client?.viewport ?? { width: 0, height: 0, dpr: 1 },
			userAgent: text(w.client?.userAgent, 2000),
		},
		pages: pages.length > 0 ? pages : [first],
		shots: [],
		marks: [],
		verdict: null,
		// As the server says: a case someone imported from a file stays one.
		...(typeof w.importedAt === "string" ? { importedAt: w.importedAt } : {}),
	};
}

const withContent = (a: Mark, content: MarkContent): Mark => {
	const {
		resolution: _r,
		reopens: _o,
		findings: _f,
		images: _i,
		heldImages: _h,
		...rest
	} = a;
	// Not told of images: the mark keeps its own.
	const images: MarkImage[] =
		content.images === undefined
			? (a.images ?? [])
			: content.images.map((x) => ({
					id: x.id,
					image: addedImage(x.id),
					added: x.added as ImageAdded,
				}));
	// Six at most; what was added here and does not fit is held back, and
	// the oldest held takes a place that is free (DEC-058).
	const fitted = withHeldImages(rest as Mark, images, a.heldImages ?? []);
	return {
		...rest,
		...(fitted.images === undefined ? {} : { images: fitted.images }),
		...(fitted.heldImages === undefined
			? {}
			: { heldImages: fitted.heldImages }),
		comment: content.comment,
		author: content.author,
		...(content.resolution
			? { resolution: content.resolution as Resolution }
			: {}),
		...(content.reopens.length > 0
			? { reopens: content.reopens as Reopen[] }
			: {}),
		...(content.findings.length > 0
			? { findings: content.findings as Finding[] }
			: {}),
	};
};

/**
 * `local` with what is new at the server, field by field: what was not
 * changed here since the server last had it (`before`) becomes the
 * server's; what was changed here stays, and is sent next.
 */
export function mergeContent(
	local: MarkContent,
	before: MarkContent | undefined,
	incoming: MarkContent,
): MarkContent {
	// Nothing to tell a change here by: the server's copy counts, and an
	// image only here stays (it is sent).
	if (before === undefined)
		return withImagesOf(incoming, mergeImages(local, undefined, incoming));
	const text =
		local.comment === before.comment && local.author === before.author;
	const state = same(
		[local.resolution, local.reopens],
		[before.resolution, before.reopens],
	);
	const was = new Map(before.findings.map((f) => [f.id, f]));
	const now = new Map(incoming.findings.map((f) => [f.id, f]));
	const here = new Map(local.findings.map((f) => [f.id, f]));
	const findings: WireFinding[] = [];
	// The server's order; a finding changed or added here keeps its place or follows.
	for (const f of incoming.findings) {
		const mine = here.get(f.id);
		const old = was.get(f.id);
		// Deleted here since: it stays away, and the delete is sent.
		if (mine === undefined && old !== undefined) continue;
		findings.push(mine !== undefined && !same(mine, old) ? mine : f);
	}
	for (const f of local.findings)
		if (!now.has(f.id) && !was.has(f.id)) findings.push(f);
	return withImagesOf(
		{
			comment: text ? incoming.comment : local.comment,
			author: text ? incoming.author : local.author,
			resolution: state ? incoming.resolution : local.resolution,
			reopens: state ? incoming.reopens : local.reopens,
			findings: findings.slice(0, MAX_FINDINGS),
		},
		mergeImages(local, before, incoming),
	);
}

/** `content` with `images`; none: not told. */
const withImagesOf = (
	content: MarkContent,
	images: ContentImage[] | undefined,
): MarkContent => {
	const { images: _i, ...rest } = content;
	return images === undefined ? rest : { ...rest, images };
};

/**
 * A mark's images merged as findings are (DEC-058), by id: the server's in
 * its order, but one removed here since stays away (the remove is sent); one
 * added here and unknown there stays (it is sent); one the server had and
 * no longer has goes. Not told by the server: what is here stays.
 */
function mergeImages(
	local: MarkContent,
	before: MarkContent | undefined,
	incoming: MarkContent,
): ContentImage[] | undefined {
	if (incoming.images === undefined) return local.images;
	const was = new Set((before?.images ?? []).map((x) => x.id));
	const here = new Set((local.images ?? []).map((x) => x.id));
	const now = new Set(incoming.images.map((x) => x.id));
	return [
		...incoming.images.filter((x) => here.has(x.id) || !was.has(x.id)),
		// Never sent from here (not in the shadow): kept whatever the team's
		// mark holds; what does not fit in six is held back (`withContent`).
		// Only one the server took, or the person removes, leaves the device.
		...(local.images ?? []).filter((x) => !now.has(x.id) && !was.has(x.id)),
	].slice(0, 2 * MAX_MARK_IMAGES);
}

/** The next free number above every number of `c` and those in `taken`. */
function freeNumber(c: Case, taken: Iterable<number>): number {
	return Math.max(highestNumber(c), ...taken) + 1;
}

/**
 * Give marks other numbers: `to` maps a mark's id here to its new number.
 * A mark that holds one of those numbers and is not moving itself moves to
 * a free one (it is one the server does not know yet: the server's numbers
 * count). Ids, crop paths and the book follow. `images` reads a crop that
 * moves; without it the merge asks for it (`NeedsImage`).
 */
export function renumber(
	c: Case,
	book: CaseBook,
	to: ReadonlyMap<string, number>,
	crops: ReadonlyMap<string, unknown>,
	out: { images: Map<string, unknown>; deleteImages: Set<string> },
): Case {
	const moves = new Map<string, number>();
	for (const [id, number] of to) {
		const a = c.marks.find((x) => x.id === id);
		if (a !== undefined && a.number !== number) moves.set(id, number);
	}
	if (moves.size === 0) return c;
	const targets = new Set(moves.values());
	let free = freeNumber(c, targets);
	for (const a of c.marks)
		if (!moves.has(a.id) && targets.has(a.number)) moves.set(a.id, free++);
	const wireIds: Record<string, string> = {};
	const renamed = new Map<string, string>();
	for (const a of c.marks) {
		const number = moves.get(a.id);
		renamed.set(a.id, number === undefined ? a.id : markIdOf(number));
	}
	for (const [id, wire] of Object.entries(book.marks))
		wireIds[renamed.get(id) ?? id] = wire;
	book.marks = wireIds;
	const marks = c.marks.map((a) => {
		const number = moves.get(a.id);
		if (number === undefined) return a;
		const id = markIdOf(number);
		// Its crop as stored: the path may be taken by another mark's meanwhile.
		const crop = crops.get(a.crop);
		if (crop === undefined) throw new NeedsImage(a.crop, undefined);
		out.images.set(cropImage(id), crop);
		out.deleteImages.add(a.crop);
		return { ...a, id, number, crop: cropImage(id) };
	});
	// A path one mark left and another took is written, not deleted.
	for (const path of out.images.keys()) out.deleteImages.delete(path);
	return {
		...c,
		marks: marks.sort((x, y) => x.number - y.number),
		// A comment follows its mark to its new id (DEC-046).
		...(c.comments === undefined
			? {}
			: {
					comments: c.comments.map((k) =>
						k.mark === undefined || !renamed.has(k.mark)
							? k
							: { ...k, mark: renamed.get(k.mark) as string },
					),
				}),
		// Never below a mark's number, where the case keeps it.
		...(c.lastNumber === undefined
			? {}
			: {
					lastNumber: Math.max(c.lastNumber, ...marks.map((a) => a.number)),
				}),
	};
}

/**
 * The case here after what came from the server (`incoming`), and the book
 * after it. `current`: the case as stored now, or none. `fetched`: the
 * server's images by their SHA-256, `crops`: images of the case here by
 * path; one that is needed and not given is asked for (`NeedsImage`).
 * `whole`: `incoming` is everything the server has of the case, so what it
 * does not name is gone there (deleted, or with `lost`, lost by a server
 * restored from an old copy).
 *
 * `undefined`: nothing to store (the case is the server's and was deleted
 * here, which is sent next; or nothing is known of it).
 */
export function mergeCase(
	current: Case | undefined,
	given: CaseBook | undefined,
	incoming: Incoming,
	fetched: ReadonlyMap<string, unknown>,
	crops: ReadonlyMap<string, unknown>,
	options: {
		teamId: string;
		whole: boolean;
		/**
		 * With `whole`: the server's history is another one (`reset`), so what
		 * it does not name it has lost, not deleted. That stays here and is
		 * sent again; nothing is deleted on a restored server's word.
		 */
		lost?: boolean;
		now: string;
		/** Who is signed in: whether what the thread waits to send is all sent. */
		me?: string;
	},
): Merged | undefined {
	let book: CaseBook = structuredClone(
		given ?? {
			caseId: incoming.case?.id ?? current?.id ?? "",
			mode: "synced" as const,
			teamId: options.teamId,
			marks: {},
			shots: {},
		},
	);
	if (current === undefined) {
		// Deleted here, and the delete not sent yet: it stays deleted.
		if (book.shadow !== undefined) return undefined;
		if (incoming.case === undefined) return undefined;
	}
	let c: Case = current ?? caseOf(incoming.case as WireCase, incoming.shots);
	if (
		given === undefined ||
		given.mode !== "synced" ||
		given.shadow === undefined
	) {
		// A case here that the server has too, and no record of what it had (it
		// came in from a file, or was kept on this device): marks with the same
		// number and drawing are the same marks, and the server's copy counts.
		book = adopt(c, book, incoming, options.teamId);
	}
	const shadow: Shadow = book.shadow ?? {
		case: caseContent(c),
		shots: {},
		marks: {},
	};
	book.shadow = shadow;
	const out = {
		images: new Map<string, unknown>(),
		deleteImages: new Set<string>(),
	};
	const need = (ref: ImageRef): unknown => {
		const image = fetched.get(ref.sha256);
		if (image === undefined) throw new NeedsImage(undefined, ref);
		return image;
	};

	const removedMarks = new Set(incoming.removedMarks);
	const removedShots = new Set(incoming.removedShots);
	if (options.whole) {
		const marks = new Set(incoming.marks.map((m) => m.id));
		const shots = new Set(incoming.shots.map((s) => s.id));
		for (const id of Object.keys(shadow.marks)) {
			if (marks.has(id)) continue;
			// Lost by the server: no longer what it has, and so sent again
			// under the id it had.
			if (options.lost) delete shadow.marks[id];
			else removedMarks.add(id);
		}
		for (const id of Object.keys(shadow.shots)) {
			if (shots.has(id)) continue;
			if (options.lost) delete shadow.shots[id];
			else removedShots.add(id);
		}
	}

	// Marks the server no longer has go here too, whatever was changed on them.
	const markHere = reverse(book.marks);
	/** Screenshots here that lost a mark to the server's deletes. */
	const emptied = new Set<string>();
	for (const wire of removedMarks) {
		const id = markHere.get(wire);
		const a = c.marks.find((x) => x.id === id);
		if (a !== undefined) {
			out.deleteImages.add(a.crop);
			for (const x of [...(a.images ?? []), ...(a.heldImages ?? [])])
				out.deleteImages.add(x.image);
			emptied.add(a.shot);
			c = {
				...c,
				marks: c.marks.filter((x) => x !== a),
				// Its comments stay, about "a deleted mark".
				...(c.comments === undefined
					? {}
					: {
							comments: c.comments.map((k) =>
								k.mark === a.id
									? (({ mark: _m, ...rest }) => ({
											...rest,
											markGone: true as const,
										}))(k)
									: k,
							),
						}),
			};
		}
		delete shadow.marks[wire];
		if (id !== undefined) delete book.marks[id];
	}

	// New screenshots.
	const shotHere = reverse(book.shots);
	let nextShot =
		c.shots.reduce((n, s) => Math.max(n, Number(s.id.slice(1)) || 0), 0) + 1;
	for (const w of incoming.shots) {
		if (removedShots.has(w.id)) continue;
		const known = shotHere.get(w.id);
		const had = given?.shadow?.shots[w.id] !== undefined;
		shadow.shots[w.id] = { image: w.image, capturedAt: w.capturedAt };
		if (known !== undefined && c.shots.some((s) => s.id === known)) continue;
		// Its last mark was deleted here, and the delete is not sent yet.
		if (had) continue;
		const id = `s${nextShot++}`;
		out.images.set(shotImage(id), need(w.image));
		if (known !== undefined) delete book.shots[known];
		book.shots[id] = w.id;
		shotHere.set(w.id, id);
		c = {
			...c,
			shots: [
				...c.shots,
				{
					id,
					image: shotImage(id),
					scrollX: w.scrollX,
					scrollY: w.scrollY,
					viewport: w.viewport,
					capturedAt: text(w.capturedAt, 64),
					url: text(w.url, MAX_URL),
					// As the server keeps it, held to the same rule here (DEC-050).
					...queryField(w.query),
				},
			],
		};
	}

	// Marks: what changed of those that are here, and new ones.
	const numbers = new Map<string, number>();
	const added: { mark: Mark; wire: string; crop: unknown }[] = [];
	for (const w of [...incoming.marks].sort((x, y) => x.number - y.number)) {
		if (removedMarks.has(w.id)) continue;
		const content = contentIn(w);
		const before = shadow.marks[w.id];
		const had = given?.shadow?.marks[w.id] !== undefined;
		const drawn = { shape: shapeIn(w.shape), element: elementIn(w.element) };
		const creator = userIn(w.createdBy).user;
		// The server's record of who did what (DEC-046): shown, never compared.
		const records = (a: Mark): Mark => {
			const { createdVia: _v, commentBy: _b, ...rest } = a;
			return {
				...rest,
				...(w.createdVia === undefined
					? a.createdVia === undefined
						? {}
						: { createdVia: a.createdVia }
					: { createdVia: appIn(w.createdVia).app as FindingApp }),
				...(w.commentBy === undefined
					? {}
					: { commentBy: stampIn(w.commentBy) }),
			};
		};
		shadow.marks[w.id] = {
			number: w.number,
			shotId: w.shotId,
			// A server that says nothing of images: what the shadow knew stays
			// (DEC-058), so what was sent is not sent at every run.
			content:
				content.images === undefined
					? withImagesOf(content, before?.content.images)
					: content,
			fixed: fixedOf(drawn),
		};
		// Its images changed at the server: an add refused for the mark's
		// limit may go now (DEC-058).
		if (
			content.images !== undefined &&
			!same(
				(before?.content.images ?? []).map((x) => x.id),
				content.images.map((x) => x.id),
			) &&
			book.rejected !== undefined
		) {
			book.rejected = book.rejected.filter((r) => r.mark !== w.id);
			if (book.rejected.length === 0) delete book.rejected;
		}
		/** The files of the images `next` has that `was` had not, from the server. */
		const imageFiles = (was: Mark | undefined, next: Mark) => {
			const had = new Set((was?.images ?? []).map((x) => x.id));
			const refs = new Map((content.images ?? []).map((x) => [x.id, x.ref]));
			for (const x of next.images ?? []) {
				if (had.has(x.id)) continue;
				const ref = refs.get(x.id);
				if (ref !== undefined) out.images.set(x.image, need(ref));
			}
			const kept = new Set(
				[...(next.images ?? []), ...(next.heldImages ?? [])].map((x) => x.id),
			);
			for (const x of [...(was?.images ?? []), ...(was?.heldImages ?? [])])
				if (!kept.has(x.id)) out.deleteImages.add(x.image);
		};
		const id = markHere.get(w.id);
		const a = c.marks.find((x) => x.id === id);
		if (a !== undefined) {
			const kept = withContent(
				a,
				mergeContent(markContent(a), before?.content, content),
			);
			// Its ends are set once: what this device drew stays; one drawn
			// elsewhere comes from the server. Its highlight too (DEC-066).
			const ended =
				kept.ends === undefined && w.ends !== undefined
					? { ...kept, ends: endsIn(w.ends) }
					: kept;
			const merged =
				ended.highlight === undefined
					? { ...ended, ...highlightIn(w, ended.shape) }
					: ended;
			const next: Mark = records(
				creator === undefined ? merged : { ...merged, createdBy: creator },
			);
			imageFiles(a, next);
			c = {
				...c,
				marks: c.marks.map((x) => (x === a ? next : x)),
			};
			if (a.number !== w.number) numbers.set(a.id, w.number);
			continue;
		}
		// Deleted here, and the delete not sent yet: it stays deleted.
		if (had) continue;
		const shot = shotHere.get(w.shotId);
		if (shot === undefined || !c.shots.some((s) => s.id === shot)) {
			// Its screenshot is not here, so it cannot be shown; not kept as
			// known either, so it comes with the case's whole state again.
			delete shadow.marks[w.id];
			continue;
		}
		const markId = markIdOf(w.number);
		const fresh = records(
			withContent(
				{
					id: markId,
					number: w.number,
					shot,
					comment: "",
					author: "user",
					shape: drawn.shape,
					crop: cropImage(markId),
					element: drawn.element,
					...(creator === undefined ? {} : { createdBy: creator }),
					...(w.ends === undefined ? {} : { ends: endsIn(w.ends) }),
					...highlightIn(w, drawn.shape),
				},
				content,
			),
		);
		imageFiles(undefined, fresh);
		added.push({
			wire: w.id,
			// A crop cut here from a whole-screenshot one (DEC-047), if one was.
			crop: fetched.get(cutKey(w.id)) ?? need(w.crop),
			mark: fresh,
		});
	}
	// The server's numbers count: a mark here that holds one of them, and is
	// not that mark, is one the server does not know yet and moves to a free
	// number. Its pin in the screenshot keeps the old one (a known limit).
	const claimed = new Set([
		...numbers.values(),
		...added.map((x) => x.mark.number),
	]);
	let free = freeNumber(c, [
		...claimed,
		...incoming.marks.map((m) => m.number),
		incoming.case?.lastNumber ?? 0,
		shadow.case.lastNumber,
	]);
	for (const a of c.marks)
		if (!numbers.has(a.id) && claimed.has(a.number)) numbers.set(a.id, free++);
	c = renumber(c, book, numbers, crops, out);
	for (const x of added) {
		out.images.set(x.mark.crop, x.crop);
		book.marks[x.mark.id] = x.wire;
	}
	if (added.length > 0)
		c = {
			...c,
			marks: [...c.marks, ...added.map((x) => x.mark)].sort(
				(x, y) => x.number - y.number,
			),
		};

	c = mergeComments(
		c,
		book,
		given,
		incoming,
		options.whole,
		options.lost,
		options.me,
	);

	// Screenshots the server no longer has: gone here when no mark is on them.
	const shotNow = reverse(book.shots);
	for (const wire of removedShots) {
		delete shadow.shots[wire];
		const id = shotNow.get(wire);
		if (id === undefined) continue;
		// With a mark made here on it, not sent yet: the screenshot keeps its
		// id and is sent again with the mark, which brings it back.
		if (c.marks.some((a) => a.shot === id)) continue;
		delete book.shots[id];
		emptied.add(id);
	}
	// A screenshot that lost its last mark this way goes, as when a mark is
	// deleted here (the server deletes it with its last mark, too).
	for (const id of emptied) {
		const shot = c.shots.find((s) => s.id === id);
		if (shot === undefined || c.marks.some((a) => a.shot === id)) continue;
		out.deleteImages.add(shot.image);
		const wire = book.shots[id];
		if (wire !== undefined) delete shadow.shots[wire];
		delete book.shots[id];
		c = { ...c, shots: c.shots.filter((s) => s !== shot) };
	}

	// The case's own fields.
	if (incoming.case !== undefined) {
		const theirs = caseContentIn(incoming.case);
		const mine = caseContent(c);
		const was = given?.shadow?.case ?? (book.shadow?.case as CaseContent);
		const pick = <K extends keyof CaseContent>(key: K): CaseContent[K] =>
			same(mine[key], was[key]) ? theirs[key] : mine[key];
		const title = pick("title") || c.title;
		const link = pick("link");
		const summary = pick("summary");
		const lastNumber = Math.max(theirs.lastNumber, highestNumber(c));
		const { link: _l, lastNumber: _n, ...rest } = c;
		c = {
			...rest,
			title,
			verdict: summary,
			...(link === null ? {} : { link }),
			...(lastNumber > 0 || c.lastNumber !== undefined ? { lastNumber } : {}),
		};
		c = withPagesOf(c, pagesIn(incoming.case.pages ?? []));
		shadow.case = theirs;
		// Closed or open (DEC-046): the server's, unless changed here since,
		// which is sent next. A server before it says nothing of it.
		const w = incoming.case;
		if (w.closed !== undefined) {
			const was = given?.shadow?.closed === true;
			if ((c.closed !== undefined) === was) {
				const { closed: _c, ...open } = c;
				c = w.closed === null ? open : { ...open, closed: stampIn(w.closed) };
			}
			shadow.closed = w.closed !== null;
		}
		// Who wrote the summary as it reads now: the server's record, unless
		// the summary was changed here since, which is sent next.
		if (same(mine.summary, was.summary)) {
			const { summaryBy: _s, ...unsigned } = c;
			c =
				w.summaryBy === undefined
					? unsigned
					: { ...unsigned, summaryBy: stampIn(w.summaryBy) };
		}
	}
	for (const path of out.images.keys()) out.deleteImages.delete(path);

	const changed = current === undefined || !same(strip(current), strip(c));
	if (changed) {
		const theirs = incoming.case?.updatedAt;
		c = {
			...c,
			updatedAt:
				typeof theirs === "string" &&
				current !== undefined &&
				theirs > current.updatedAt
					? theirs
					: current === undefined
						? c.updatedAt
						: options.now > current.updatedAt
							? options.now
							: new Date(Date.parse(current.updatedAt) + 1).toISOString(),
		};
	}
	// What the sync changed does not end an app's change waiting to go.
	if (changed) c = carryVia(current, c);
	book.title = c.title;
	book.mode = "synced";
	book.teamId = options.teamId;
	// Nothing left to send: the next look at the case can pass it by.
	if (isClean(c, book, options.me)) {
		book.cleanAt = c.updatedAt;
		// The server and this device agree: what was sent last arrived, and
		// what it refused before is no longer wanted here either.
		delete book.sent;
		delete book.rejected;
	} else delete book.cleanAt;
	return {
		value: c,
		book,
		images: out.images,
		deleteImages: [...out.deleteImages],
		changed,
	};
}

/**
 * The thread merged with the server's (DEC-046). The server's comments come
 * in; one's own changed here keeps its text (it is sent); another's takes
 * the server's back. A delete the server lost goes from the shadow, so the
 * comment is sent again. Comments only here that would take the case past
 * `MAX_CASE_COMMENTS` are parked in the book, unsent, and said; they come
 * back when there is room.
 */
function mergeComments(
	c: Case,
	book: CaseBook,
	given: CaseBook | undefined,
	incoming: Incoming,
	whole: boolean,
	lost: boolean | undefined,
	me: string | undefined,
): Case {
	const shadow = book.shadow as Shadow;
	const known = { ...shadow.comments };
	const was = given?.shadow?.comments ?? {};
	const removed = new Set(incoming.removedComments ?? []);
	const came = incoming.comments ?? [];
	if (whole && incoming.comments !== undefined) {
		const named = new Set(came.map((w) => w.id));
		for (const id of Object.keys(known))
			if (!named.has(id)) {
				if (lost) delete known[id];
				else removed.add(id);
			}
	}
	let list = (c.comments ?? []).filter((k) => !removed.has(k.id));
	for (const id of removed) delete known[id];
	const marks = reverse(book.marks);
	for (const w of came) {
		if (removed.has(w.id) || w.caseId !== c.id) continue;
		const theirs = commentIn(w, marks);
		const before = was[w.id];
		known[w.id] = {
			text: w.text,
			...(w.user === null ? {} : { userId: w.user.id }),
		};
		const at = list.findIndex((k) => k.id === w.id);
		if (at >= 0) {
			const mine = list[at] as CaseComment;
			list[at] =
				before !== undefined &&
				mine.text !== before.text &&
				ownAtServer(before, me)
					? {
							...theirs,
							text: mine.text,
							...(mine.edited ? { edited: mine.edited } : {}),
						}
					: theirs;
		} else if (before === undefined) list.push(theirs);
	}
	// Another's text changed here (a file put in place): the server's again.
	list = list.map((k) => {
		const before = known[k.id];
		return before !== undefined &&
			before.text !== k.text &&
			!ownAtServer(before, me)
			? { ...k, text: before.text }
			: k;
	});
	if (whole && incoming.comments !== undefined) {
		const order = new Map(came.map((w, i) => [w.id, i]));
		list = [
			...list
				.filter((k) => order.has(k.id))
				.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0)),
			...list.filter((k) => !order.has(k.id)),
		];
	}
	// Within the limit: what only this device has waits beyond it.
	const parked = [...(book.parkedComments ?? [])];
	const room = MAX_CASE_COMMENTS - list.length;
	if (room < 0) {
		const extra = list.filter((k) => known[k.id] === undefined).slice(room);
		const out = new Set(extra.map((k) => k.id));
		list = list.filter((k) => !out.has(k.id));
		parked.unshift(...extra);
	} else if (parked.length > 0) list.push(...parked.splice(0, room));
	if (parked.length > 0) book.parkedComments = parked;
	else delete book.parkedComments;
	// Who deleted a comment matters until the server has the delete.
	const deletedVia = (c.deletedVia ?? []).filter(
		(d) => known[d.id] !== undefined,
	);
	shadow.comments = known;
	const { comments: _k, deletedVia: _d, ...rest } = c;
	return {
		...rest,
		...(list.length > 0 ? { comments: list } : {}),
		...(deletedVia.length > 0 ? { deletedVia } : {}),
	};
}

/** The case without its time, as one text; who did something counts: it shows. */
const strip = (c: Case) => {
	const { updatedAt: _u, ...rest } = c;
	return canonical(rest, true);
};

/** The case here is what the server has: there is nothing to send. */
export function isClean(c: Case, book: CaseBook, me?: string): boolean {
	const shadow = book.shadow;
	if (shadow === undefined) return false;
	if (casePatch(caseContent(c), shadow.case) !== undefined) return false;
	const wires = new Set<string>();
	for (const a of c.marks) {
		const wire = book.marks[a.id];
		const before = wire === undefined ? undefined : shadow.marks[wire];
		if (wire === undefined || before === undefined) return false;
		if (before.fixed !== fixedOf(a)) return false;
		if (markPatch(markContent(a), before.content) !== undefined) return false;
		wires.add(wire);
	}
	if (!Object.keys(shadow.marks).every((wire) => wires.has(wire))) return false;
	if ((c.closed !== undefined) !== (shadow.closed === true)) return false;
	// The thread: what commentOps would send.
	const known = shadow.comments ?? {};
	const here = new Map((c.comments ?? []).map((k) => [k.id, k]));
	for (const k of here.values()) {
		const before = known[k.id];
		if (before === undefined) return false;
		// Another's text that differs is not sent: it does not wait.
		if (before.text !== k.text && ownAtServer(before, me)) return false;
	}
	return Object.entries(known).every(
		([id, before]) =>
			here.has(id) || (before.userId !== undefined && before.userId !== me),
	);
}

/**
 * A book for a case that is here and at the server, with no record of what
 * the server had: its marks are matched to the server's by number and
 * drawing, and for those the server's copy counts (the shadow says the
 * server had what is here, so nothing here reads as changed). A mark only
 * here is new, and is sent.
 */
function adopt(
	c: Case,
	book: CaseBook,
	incoming: Incoming,
	teamId: string,
): CaseBook {
	const next: CaseBook = {
		caseId: c.id,
		mode: "synced",
		teamId,
		marks: {},
		shots: {},
		shadow: { case: caseContent(c), shots: {}, marks: {}, comments: {} },
	};
	const shadow = next.shadow as Shadow;
	const shotOf = new Map<string, string>();
	for (const w of incoming.marks) {
		const a = c.marks.find(
			(x) =>
				x.number === w.number &&
				fixedOf(x) ===
					fixedOf({ shape: shapeIn(w.shape), element: elementIn(w.element) }),
		);
		if (a === undefined) continue;
		next.marks[a.id] = w.id;
		shadow.marks[w.id] = {
			number: a.number,
			shotId: w.shotId,
			// Images by none: the team's come in, and those only here stay
			// and are sent (DEC-058).
			content: { ...markContent(a), images: [] },
			fixed: fixedOf(a),
		};
		shotOf.set(w.shotId, a.shot);
	}
	for (const w of incoming.shots) {
		const here = shotOf.get(w.id);
		if (here === undefined) continue;
		next.shots[here] = w.id;
		shadow.shots[w.id] = { image: w.image, capturedAt: w.capturedAt };
	}
	if (book.title !== undefined) next.title = book.title;
	return next;
}

/** Where a crop cut here for the server's mark `markId` is handed to the merge. */
export const cutKey = (markId: string) => `cut:${markId}`;

/** The least a cut crop is, in CSS pixels either way: anything smaller shows nothing. */
const MIN_CUT = 8;

/**
 * The server's new marks whose crop is their screenshot's own picture: an AI
 * app added them without a live page (MCP `add_mark`, which cuts no images).
 * Known without the case here, so the case is read only when there is one.
 */
export function wholeShotMarks(
	incoming: Incoming,
	book: CaseBook | undefined,
): WireMark[] {
	const known = new Set(Object.values(book?.marks ?? {}));
	return incoming.marks.filter((m) => {
		if (known.has(m.id)) return false;
		const sha =
			incoming.shots.find((s) => s.id === m.shotId)?.image.sha256 ??
			book?.shadow?.shots[m.shotId]?.image.sha256;
		return sha !== undefined && sha === m.crop.sha256;
	});
}

/**
 * For each of `wholeShotMarks`, the part of the screenshot to cut a crop
 * from, as a crop is cut when a mark is drawn (DEC-047). A mark whose shape
 * is not on its screenshot, or whose part would be a sliver, keeps the whole
 * screenshot: that at least shows something.
 */
export function wholeShotCrops(
	incoming: Incoming,
	book: CaseBook | undefined,
	current: Case | undefined,
): { markId: string; sha256: string; rect: Rect; viewportWidth: number }[] {
	const shotHere = reverse(book?.shots ?? {});
	const out: {
		markId: string;
		sha256: string;
		rect: Rect;
		viewportWidth: number;
	}[] = [];
	for (const m of wholeShotMarks(incoming, book)) {
		const viewport =
			incoming.shots.find((s) => s.id === m.shotId)?.viewport ??
			current?.shots.find((s) => s.id === shotHere.get(m.shotId))?.viewport;
		if (viewport === undefined || viewport.width <= 0) continue;
		const shape = shapeIn(m.shape);
		// Where an unknown kind is, this version cannot say (DEC-066).
		if (shape.kind === "unknown") continue;
		const bounds = shapeBounds(shape);
		const on =
			bounds.x <= viewport.width &&
			bounds.y <= viewport.height &&
			bounds.x + bounds.width >= 0 &&
			bounds.y + bounds.height >= 0;
		if (!on) continue;
		const rect = cropRectFor(bounds, viewport);
		if (rect.width < MIN_CUT || rect.height < MIN_CUT) continue;
		out.push({
			markId: m.id,
			sha256: m.crop.sha256,
			rect,
			viewportWidth: viewport.width,
		});
	}
	return out;
}
