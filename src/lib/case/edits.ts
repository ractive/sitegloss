/**
 * Changes to a case: to one mark, its images, the title and link, the case's
 * thread and its closing.
 */

import {
	addedImage,
	type Case,
	type CaseComment,
	CaseError,
	cropImage,
	cutText,
	type FindingApp,
	MAX_CASE_COMMENT,
	MAX_CASE_COMMENTS,
	MAX_COMMENT,
	MAX_LINK,
	MAX_MARK_IMAGES,
	MAX_REOPEN_NOTE,
	MAX_REOPENS,
	MAX_TITLE,
	type Mark,
	type MarkImage,
	markStatus,
	type Reopen,
	type ResolutionKind,
	type ResolveChoice,
	resolutionFor,
	STATUS_LABEL,
	textLength,
	type UserRef,
} from "./format.ts";
import { cutWas } from "./internal.ts";
import { withPagesOfShots } from "./pages.ts";
import { isSafeId } from "./validation.ts";

// --- changes to one mark ------------------------------------------------------

function changed(
	c: Case,
	markId: string,
	change: (a: Mark) => Mark,
	now: string,
): Case {
	if (!c.marks.some((a) => a.id === markId))
		throw new CaseError("The mark no longer exists.");
	return {
		...c,
		marks: c.marks.map((a) => (a.id === markId ? change(a) : a)),
		updatedAt: now,
	};
}

/** What a resolution is set to: in the panel, or by an AI app (`app`). */
export interface ResolutionChange {
	kind: ResolutionKind;
	note?: string;
	/** Fixed and verified at once (the panel's "Fixed and verified"); only with `fixed`. */
	verified?: boolean;
	/** The AI app that sets it through a tool. */
	app?: FindingApp;
}

/**
 * The case with the mark settled as `change`, in place of any resolution it
 * had. A verified fix stays verified as it was when it is still chosen.
 */
export function withResolution(
	c: Case,
	markId: string,
	change: ResolutionChange,
	now: string,
): Case {
	return changed(
		c,
		markId,
		(a) => {
			const note = cutText(change.note?.trim() ?? "", MAX_COMMENT);
			const verified =
				change.kind === "fixed" && change.verified === true
					? (a.resolution?.verified ?? { at: now })
					: undefined;
			return {
				...a,
				resolution: {
					kind: change.kind,
					...(note ? { note } : {}),
					at: now,
					...(change.app ? { app: change.app } : {}),
					...(verified ? { verified } : {}),
				},
			};
		},
		now,
	);
}

/**
 * The panel's Resolve… and Change…: another kind replaces the resolution;
 * the same kind keeps when and by whom it was set, and changes only the note
 * and whether the fix is verified. Nothing changed writes nothing.
 */
export function withChoice(
	c: Case,
	markId: string,
	choice: ResolveChoice,
	note: string,
	now: string,
): Case {
	const r = c.marks.find((x) => x.id === markId)?.resolution;
	const target = resolutionFor(choice);
	if (r?.kind === target.kind) {
		const text = cutText(note.trim(), MAX_COMMENT);
		if (
			(r.note ?? "") === text &&
			(r.verified !== undefined) === target.verified
		)
			return c;
		const verified = target.verified ? (r.verified ?? { at: now }) : undefined;
		return changed(
			c,
			markId,
			(a) => {
				const { note: _n, verified: _v, ...kept } = r;
				return {
					...a,
					resolution: {
						...kept,
						...(text ? { note: text } : {}),
						...(verified ? { verified } : {}),
					},
				};
			},
			now,
		);
	}
	return withResolution(c, markId, { ...resolutionFor(choice), note }, now);
}

/**
 * The case with the mark's fix verified. Only a fixed mark can be; one that
 * is verified already stays as it was.
 */
export function withVerified(
	c: Case,
	markId: string,
	app: FindingApp | undefined,
	now: string,
): Case {
	const a = c.marks.find((x) => x.id === markId);
	if (a?.resolution?.verified) return c;
	return changed(
		c,
		markId,
		(a) => {
			const r = a.resolution;
			if (r?.kind !== "fixed")
				throw new CaseError(
					`Mark ${a.number} is ${STATUS_LABEL[markStatus(a)].toLowerCase()}: only a fixed mark can be verified.`,
				);
			return {
				...a,
				resolution: { ...r, verified: { at: now, ...(app ? { app } : {}) } },
			};
		},
		now,
	);
}

/**
 * The case with the mark open again: its resolution moves, whole (its note
 * cut to `MAX_REOPEN_NOTE`), into a new reopen with `note`, the oldest going
 * past `MAX_REOPENS`. An open mark stays as it is.
 */
export function withReopen(
	c: Case,
	markId: string,
	reopen: {
		note?: string;
		app?: FindingApp;
		/** The panel's: a note typed for a mark opened meanwhile is not lost unsaid. */
		refuseOpen?: boolean;
	},
	now: string,
): Case {
	const a = c.marks.find((x) => x.id === markId);
	if (a !== undefined && a.resolution === undefined) {
		if (reopen.refuseOpen)
			throw new CaseError(
				`Mark ${a.number} is open already: it was reopened meanwhile. Your note is not saved; add it to the comment, or Cancel.`,
			);
		return c;
	}
	return openedBy(
		c,
		changed(
			c,
			markId,
			(a) => {
				const { resolution: was, reopens = [], ...open } = a;
				if (was === undefined) return a;
				const note = cutText(reopen.note?.trim() ?? "", MAX_REOPEN_NOTE);
				const entry: Reopen = {
					...(note ? { note } : {}),
					at: now,
					...(reopen.app ? { app: reopen.app } : {}),
					was: cutWas(was),
				};
				return { ...open, reopens: [...reopens, entry].slice(-MAX_REOPENS) };
			},
			now,
		),
	);
}

/**
 * `c` after `next`: a mark that went from settled to open opens a closed
 * case, as at the server (DEC-046).
 */
function openedBy(c: Case, next: Case): Case {
	if (next.closed === undefined) return next;
	const reopened = next.marks.some(
		(a) =>
			a.resolution === undefined &&
			c.marks.find((x) => x.id === a.id)?.resolution !== undefined,
	);
	if (!reopened) return next;
	const { closed: _c, ...open } = next;
	return open;
}

export function withComment(
	c: Case,
	markId: string,
	comment: string,
	now: string,
): Case {
	return changed(
		c,
		markId,
		// The text is the user's now, whoever wrote it first.
		(a) => ({
			...a,
			comment: cutText(comment.trim(), MAX_COMMENT),
			author: "user",
		}),
		now,
	);
}

/**
 * Code points taken out of a title the user gives (Rename) or a page gives
 * ("New case for this page"): the C0 and C1 controls (U+0000–U+001F,
 * U+007F–U+009F), and the bidi embeddings and overrides (U+202A–U+202E) and
 * isolates (U+2066–U+2069), which would reorder the sentence a title is put
 * into ("Adding to “…”"). Titles already stored (a file, an older build) are
 * left as they are.
 */
const notInTitle = (cp: number) =>
	cp <= 0x1f ||
	(cp >= 0x7f && cp <= 0x9f) ||
	(cp >= 0x202a && cp <= 0x202e) ||
	(cp >= 0x2066 && cp <= 0x2069);

/** A character that shows: not a format character, a space or a control. */
const VISIBLE = /[^\p{Cf}\p{Z}\p{Cc}\s]/u;

/**
 * `text` as a title: without the code points `notInTitle` names, trimmed;
 * empty when no character in it shows (U+200B, a no-break space alone).
 */
export function cleanTitle(text: string): string {
	let kept = "";
	for (const ch of text) if (!notInTitle(ch.codePointAt(0) ?? 0)) kept += ch;
	kept = kept.trim();
	return VISIBLE.test(kept) ? kept : "";
}

/**
 * The case under a new title (DEC-026: the side panel's Rename), cleaned
 * (`cleanTitle`) and cut to `MAX_TITLE`; one in which nothing shows is
 * refused, as a case always has a title.
 */
export function withTitle(c: Case, title: string, now: string): Case {
	const text = cutText(cleanTitle(title), MAX_TITLE);
	if (text === "") throw new CaseError("A case needs a title.");
	return { ...c, title: text, updatedAt: now };
}

/**
 * `text` as a case's link (DEC-028): trimmed, an http or https address of at
 * most `MAX_LINK` characters as the browser reads it; anything else is no
 * link. It is shown as a link that opens, so no other scheme (`javascript:`,
 * `data:`, `file:`) and no address relative to the panel.
 */
export function cleanLink(text: string): string | undefined {
	const trimmed = text.trim();
	if (trimmed === "") return undefined;
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return undefined;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
	// As the page's address is kept: a user name and password in an address
	// would go to the export, the synced file and a connected AI app.
	url.username = "";
	url.password = "";
	return url.href.length <= MAX_LINK ? url.href : undefined;
}

/**
 * Why `text` is no link, for the form: too long as the browser reads it, or
 * no http or https address at all.
 */
export function linkProblem(text: string): "long" | "address" {
	try {
		const url = new URL(text.trim());
		if (
			(url.protocol === "https:" || url.protocol === "http:") &&
			url.href.length > MAX_LINK
		)
			return "long";
	} catch {
		// Not an address.
	}
	return "address";
}

/**
 * The case with `link` attached, or without one for `undefined` (DEC-028);
 * the same case when nothing changes. `link` is one `cleanLink` gave.
 */
export function withLink(c: Case, link: string | undefined, now: string): Case {
	if (c.link === link) return c;
	const { link: _old, ...rest } = c;
	return link === undefined
		? { ...rest, updatedAt: now }
		: { ...rest, link, updatedAt: now };
}

/**
 * The case without the mark, and the images that go with it: its crop, the
 * images added to it, and its screenshot when no other mark is on it.
 */
export function withoutMark(
	c: Case,
	markId: string,
	now: string,
): { value: Case; images: string[] } {
	const gone = c.marks.find((a) => a.id === markId);
	if (gone === undefined) throw new CaseError("The mark no longer exists.");
	const marks = c.marks.filter((a) => a.id !== markId);
	const shotUsed = marks.some((a) => a.shot === gone.shot);
	const shot = c.shots.find((s) => s.id === gone.shot);
	return {
		// A page whose last screenshot went with the mark leaves the list.
		value: withPagesOfShots({
			...c,
			marks,
			// Its comments stay, about "a deleted mark" (DEC-046).
			...(c.comments === undefined
				? {}
				: {
						comments: c.comments.map((k) =>
							k.mark === markId
								? (({ mark: _m, ...rest }) => ({
										...rest,
										markGone: true as const,
									}))(k)
								: k,
						),
					}),
			shots: shotUsed ? c.shots : c.shots.filter((s) => s.id !== gone.shot),
			lastNumber: Math.max(c.lastNumber ?? 0, ...c.marks.map((a) => a.number)),
			updatedAt: now,
		}),
		images: [
			gone.crop,
			...(gone.images ?? []).map((x) => x.image),
			...(gone.heldImages ?? []).map((x) => x.image),
			...(shotUsed || shot === undefined ? [] : [shot.image]),
		],
	};
}

// --- images a person added to a mark (DEC-058) ---------------------------------

const withMarkImages = (a: Mark, images: MarkImage[]): Mark => {
	const { images: _, ...rest } = a;
	return images.length > 0 ? { ...rest, images } : rest;
};

/**
 * The mark with `images` as its added images and `held` held back
 * (DEC-058): what does not fit in six is held, and the oldest held image
 * takes a place that is free. `images` in order, the server's first.
 */
export function withHeldImages(
	a: Mark,
	images: readonly MarkImage[],
	held: readonly MarkImage[],
): Mark {
	const all = [...images, ...held];
	const { heldImages: _h, ...rest } = withMarkImages(
		a,
		all.slice(0, MAX_MARK_IMAGES),
	);
	const back = all.slice(MAX_MARK_IMAGES);
	return back.length > 0 ? { ...rest, heldImages: back } : rest;
}

/**
 * The case with images added to the mark, after its others, each by its id
 * (`newId("i")`), its file at `addedImage(id)`, added `now`. Refused past
 * `MAX_MARK_IMAGES` and for an id the case has already.
 */
export function withImages(
	c: Case,
	markId: string,
	imageIds: readonly string[],
	now: string,
): Case {
	const taken = new Set(
		c.marks.flatMap((a) =>
			[...(a.images ?? []), ...(a.heldImages ?? [])].map((x) => x.id),
		),
	);
	for (const imageId of imageIds) {
		if (!isSafeId(imageId) || taken.has(imageId))
			throw new CaseError(`The image id ${imageId} cannot be used.`);
		taken.add(imageId);
	}
	return changed(
		c,
		markId,
		(a) => {
			const images = a.images ?? [];
			const free = MAX_MARK_IMAGES - images.length;
			if (imageIds.length > free)
				throw new CaseError(
					free > 0
						? `Mark ${a.number} holds at most ${MAX_MARK_IMAGES} images; ${free} more ${free === 1 ? "fits" : "fit"}.`
						: `Mark ${a.number} holds ${MAX_MARK_IMAGES} images, the most a mark may have. Remove one first.`,
				);
			return withMarkImages(a, [
				...images,
				...imageIds.map((imageId) => ({
					id: imageId,
					image: addedImage(imageId),
					added: { at: now },
				})),
			]);
		},
		now,
	);
}

/**
 * The case without one of the images added to the mark, and the file that
 * goes with it. Only an added image's id is taken: the mark's own screenshot
 * (its crop) is never removed this way.
 */
export function withoutImage(
	c: Case,
	markId: string,
	imageId: string,
	now: string,
): { value: Case; images: string[] } {
	const mark = c.marks.find((a) => a.id === markId);
	// The mark's own screenshot is no added image: it goes only with the mark.
	if (
		mark !== undefined &&
		[mark.id, mark.crop, cropImage(mark.id)].includes(imageId)
	)
		throw new CaseError(
			"The mark's screenshot stays with the mark; only an added image can be removed.",
		);
	const gone = [...(mark?.images ?? []), ...(mark?.heldImages ?? [])].find(
		(x) => x.id === imageId,
	);
	const value = changed(
		c,
		markId,
		(a) => {
			if (gone === undefined)
				throw new CaseError("The image is no longer on the mark.");
			// A place freed here: the oldest held image takes it (DEC-058).
			return withHeldImages(
				a,
				(a.images ?? []).filter((x) => x.id !== imageId),
				(a.heldImages ?? []).filter((x) => x.id !== imageId),
			);
		},
		now,
	);
	return { value, images: gone === undefined ? [] : [gone.image] };
}

// --- the case's thread and its closing (DEC-046) ---------------------------------

/** `value` as JSON with its keys in order: the same content, the same text. */
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object")
		return `{${Object.keys(value)
			.filter((k) => (value as Record<string, unknown>)[k] !== undefined)
			.sort()
			.map(
				(k) =>
					`${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
			)
			.join(",")}}`;
	return JSON.stringify(value);
}

/**
 * What can change of a mark (its comment, author, status, reopens
 * and added images), as a short text: equal while the mark is unchanged
 * (DEC-046). An image added by hand ends an AI app's note, so it is never
 * sent as the app's doing; the images' ids count only where there are any,
 * so a mark without images keeps the text it had before them (DEC-058).
 */
export function markSignature(a: Mark): string {
	const text = canonicalJson([
		a.comment,
		a.author,
		a.resolution ?? null,
		a.reopens ?? [],
		// Where the findings were (DEC-081): a mark keeps the signature it had.
		[],
		...(a.images ? [a.images.map((x) => x.id)] : []),
	]);
	// FNV-1a, twice over, as 16 hex digits.
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
		h2 = Math.imul(h2 ^ ch, 0x811c9dc5) >>> 0;
	}
	return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}:${text.length}`;
}

/**
 * The mark `markId` as changed by `app` through this browser: what is sent
 * of the change names the app, until the mark changes again (DEC-046).
 * Without an app: the person's, and an earlier app's note ends.
 */
export function withMarkVia(
	c: Case,
	markId: string,
	app: FindingApp | undefined,
): Case {
	return {
		...c,
		marks: c.marks.map((a) => {
			if (a.id !== markId) return a;
			const { via: _v, ...rest } = a;
			return app === undefined
				? rest
				: { ...rest, via: { app, of: markSignature(rest) } };
		}),
	};
}

/**
 * The case after a change `app` made through this browser's AI connection:
 * what is sent of it names the app (`via`) while nothing changes after it.
 * Without an app, the change is the person's, and an earlier app's ends.
 */
function changedBy(c: Case, now: string, app?: FindingApp): Case {
	const { via: _v, ...rest } = c;
	return app === undefined
		? { ...rest, updatedAt: now }
		: { ...rest, updatedAt: now, via: { app, at: now } };
}

/** The comments about one mark, or about the case itself (`undefined`). */
export function commentsOn(c: Case, markId: string | undefined): CaseComment[] {
	return (c.comments ?? []).filter((k) =>
		markId === undefined ? k.mark === undefined : k.mark === markId,
	);
}

/** The case with a new comment at the end of its thread. */
export function withCaseComment(
	c: Case,
	comment: { id: string; text: string; mark?: string; app?: FindingApp },
	now: string,
): Case {
	const text = comment.text.trim();
	if (text === "") throw new CaseError("A comment needs some text.");
	if (textLength(text) > MAX_CASE_COMMENT)
		throw new CaseError(
			`A comment holds at most ${MAX_CASE_COMMENT.toLocaleString("en-US")} characters.`,
		);
	const comments = c.comments ?? [];
	if (comments.length >= MAX_CASE_COMMENTS)
		throw new CaseError(
			`A case holds at most ${MAX_CASE_COMMENTS} comments: delete one first.`,
		);
	if (comment.mark !== undefined && !c.marks.some((a) => a.id === comment.mark))
		throw new CaseError("The mark no longer exists.");
	return changedBy(
		{
			...c,
			comments: [
				...comments,
				{
					id: comment.id,
					...(comment.mark === undefined ? {} : { mark: comment.mark }),
					text,
					at: now,
					...(comment.app === undefined ? {} : { app: comment.app }),
				},
			],
		},
		now,
		comment.app,
	);
}

/** The case with a comment's text changed; by `app`, when an AI app changed it. */
export function withCaseCommentText(
	c: Case,
	commentId: string,
	text: string,
	now: string,
	app?: FindingApp,
): Case {
	const clean = text.trim();
	if (clean === "") throw new CaseError("A comment needs some text.");
	if (textLength(clean) > MAX_CASE_COMMENT)
		throw new CaseError(
			`A comment holds at most ${MAX_CASE_COMMENT.toLocaleString("en-US")} characters.`,
		);
	const comments = c.comments ?? [];
	const was = comments.find((k) => k.id === commentId);
	if (was === undefined) throw new CaseError("The comment no longer exists.");
	// The same text: nothing changes, nobody is named.
	if (was.text === clean) return c;
	return changedBy(
		{
			...c,
			comments: comments.map((k) =>
				k.id === commentId && k.text !== clean
					? {
							...k,
							text: clean,
							edited: { at: now, ...(app === undefined ? {} : { app }) },
						}
					: k,
			),
		},
		now,
		app,
	);
}

/** The case without a comment; by `app`, when an AI app deleted it. */
export function withoutCaseComment(
	c: Case,
	commentId: string,
	now: string,
	app?: FindingApp,
): Case {
	const comments = c.comments ?? [];
	if (!comments.some((k) => k.id === commentId))
		throw new CaseError("The comment no longer exists.");
	const left = comments.filter((k) => k.id !== commentId);
	const { comments: _k, deletedVia: gone = [], ...rest } = c;
	// Who deleted it goes with the delete, not with the case (DEC-046).
	const deletedVia = [
		...gone.filter((d) => d.id !== commentId),
		...(app === undefined ? [] : [{ id: commentId, app }]),
	].slice(-MAX_CASE_COMMENTS);
	return changedBy(
		{
			...rest,
			...(left.length > 0 ? { comments: left } : {}),
			...(deletedVia.length > 0 ? { deletedVia } : {}),
		},
		now,
		app,
	);
}

/**
 * Who the case is assigned to as this browser shows it (DEC-071): the
 * assignment waiting to be sent, else the server's record; `null` nobody;
 * `undefined` not known.
 */
export const assigneeOf = (c: Case): UserRef | null | undefined =>
	c.assign !== undefined ? c.assign.to : c.assignee;

/**
 * The case assigned to `to` (`null`: nobody), waiting to be sent with the
 * next sync (DEC-071); by `app`, when an AI app did it. The same as shown
 * changes nothing. A pick is kept as `assign` even when it is the record
 * here again: the record may be older than what the server has (an
 * assignment sent and not read back yet), and only the sync, which knows
 * what the server has, may decide there is nothing to send.
 */
export function withAssigned(
	c: Case,
	to: UserRef | null,
	now: string,
	app?: FindingApp,
): Case {
	const same = (a: UserRef | null | undefined) =>
		a !== undefined && (a?.id ?? null) === (to?.id ?? null);
	if (same(assigneeOf(c))) return c;
	const { assign: _a, assignRefused: _r, ...rest } = c;
	return changedBy(
		{ ...rest, assign: { to: to && { id: to.id, name: to.name }, at: now } },
		now,
		app,
	);
}

/** The case closed (filed away, not frozen) or open again; by `app`, when an AI app did it. */
export function withClosed(
	c: Case,
	closed: boolean,
	now: string,
	app?: FindingApp,
): Case {
	if (closed === (c.closed !== undefined)) return c;
	const { closed: _c, ...rest } = c;
	return changedBy(
		closed
			? { ...rest, closed: { at: now, ...(app === undefined ? {} : { app }) } }
			: rest,
		now,
		app,
	);
}

/**
 * The comment a person or an app may change or delete (DEC-046): one's own;
 * an app only what it wrote, for the person signed in here. In a case kept
 * on this device (no user on it), one's own is every comment written here.
 */
export function isOwnComment(
	k: CaseComment,
	me: string | undefined,
	appId?: string,
): boolean {
	// Not synced yet (no person on it): one's own. Synced and its writer
	// gone: nobody's.
	const mine =
		k.writerGone !== true && (k.user === undefined || k.user.id === me);
	if (appId === undefined) return mine;
	// What a file says of an app proves nothing: no app's own.
	return mine && k.imported !== true && k.app?.id === appId;
}

/**
 * Who did something, in words (DEC-046): "Dana Developer via Claude Code",
 * the person alone, or the app alone (its name, else its host); none: not
 * known (done here, by hand).
 */
export function byline(
	user: UserRef | undefined,
	app: FindingApp | undefined,
): string | undefined {
	const appName = app === undefined ? undefined : app.name || app.host;
	if (user !== undefined && appName !== undefined)
		return `${user.name} via ${appName}`;
	return user?.name ?? appName;
}
