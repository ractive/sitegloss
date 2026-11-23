/**
 * The case format `sitegloss/2` (see kb/design/overview.md): the same JSON in
 * IndexedDB and in an export. Images are referenced by paths relative to the
 * case (`shots/s1.webp`, `crops/m1.webp`, `images/i_….webp`).
 */

import { storedQuery, withQuery } from "./query.ts";

export const CASE_FORMAT = "sitegloss/2";

/**
 * The format before it: its marks under another key, their ids
 * `a<number>`. Not read (DEC-051): a file of it is refused, and the store's
 * upgrade to its version 2 emptied what was kept in it (store.ts).
 */
export const OLD_CASE_FORMAT = "sitegloss/1";

/** The attributes element details keep (element.ts). */
export const ELEMENT_ATTRIBUTES = [
	"name",
	"type",
	"href",
	"src",
	"placeholder",
	"alt",
	"title",
] as const;

/** A language tag as `<html lang>` gives it, e.g. `de-CH`. */
export const LANGUAGE = /^[A-Za-z0-9-]{0,35}$/;

/** The highest mark number a case may use. */
export const MAX_NUMBER = 99_999;

/**
 * The longest summary for the developer a case may hold, in characters. It is
 * stored as `verdict`, its name before (DEC-019).
 */
export const MAX_VERDICT = 50_000;

/** The longest comment on a mark, in characters. */
export const MAX_COMMENT = 20_000;

/** The longest finding an AI app may write on a mark, in characters. */
export const MAX_FINDING = 5000;

/**
 * The most finding text a case may hold, all marks' findings together, in
 * characters: get_case stays readable (DEC-019).
 */
export const MAX_FINDINGS_TEXT = 200_000;

/** The most findings a mark may have. */
export const MAX_FINDINGS = 20;

/**
 * The most images a mark holds (DEC-058): here, in a file and at the team's
 * server alike. What was added here and does not fit beside the team's is
 * held back apart (`Mark.heldImages`), never in `images`.
 */
export const MAX_MARK_IMAGES = 6;

/** The most points a freehand mark may have. */
export const MAX_PEN_POINTS = 5000;

/** The longest page address a case may hold. */
export const MAX_URL = 8000;

/** The longest page title a case may hold. */
export const MAX_PAGE_TITLE = 2000;

/** The most pages a case lists (DEC-038). */
export const MAX_PAGES = 200;

/** The longest comment in a case's thread, in characters (DEC-046). */
export const MAX_CASE_COMMENT = 20_000;

/** The most comments a case's thread holds, as the server allows. */
export const MAX_CASE_COMMENTS = 1000;

export interface Point {
	x: number;
	y: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Viewport {
	width: number;
	height: number;
	/** `devicePixelRatio`: screenshot pixels per CSS pixel. */
	dpr: number;
}

/** A mark, in CSS pixels of its screenshot (or of the document while drawing). */
export type Shape = KnownShape | UnknownShape;

/** The shapes this version draws. */
export type KnownShape =
	| { kind: "element"; rect: Rect }
	| { kind: "box"; rect: Rect }
	| { kind: "arrow"; from: Point; to: Point }
	| { kind: "pen"; points: Point[] }
	| { kind: "note"; at: Point };

/**
 * A shape of a kind this version does not know (DEC-066): made with a newer
 * Sitegloss, through a file or a team. The mark is kept with it, `given`
 * exactly as it came, and given back so (`shapeOut`) in a file and to the
 * server: nothing is lost, nothing is refused. It is not drawn. Only here,
 * in memory and in this browser's store; read again, it is looked at anew
 * (`validateCase`), so a version that knows the kind draws it.
 */
export interface UnknownShape {
	kind: "unknown";
	given: { kind: string } & Record<string, unknown>;
}

export type ShapeKind = Shape["kind"];

/**
 * A name a kind of shape may have (DEC-066): the rule for one this version
 * does not know, in a file and from the server alike. 1 to 64 characters,
 * any but control characters.
 */
export const isKindName = (kind: unknown): kind is string =>
	typeof kind === "string" &&
	kind.length >= 1 &&
	kind.length <= 64 &&
	![...kind].some((ch) => {
		const code = ch.charCodeAt(0);
		return code < 0x20 || code === 0x7f;
	});

/**
 * The most a shape of an unknown kind may hold, and an unknown field, as
 * JSON (DEC-066): a pen stroke of 5000 points is under 200 KB.
 */
export const MAX_UNKNOWN_SHAPE = 256 * 1024;
export const MAX_EXTRA = 16 * 1024;
/** The most unknown fields kept on one case, screenshot or mark, and on a whole case together (as JSON). */
export const MAX_EXTRA_KEYS = 32;
export const MAX_EXTRAS = 256 * 1024;

/** A shape as a file and the server have it: an unknown one as it came. */
export const shapeOut = (shape: Shape): Shape | UnknownShape["given"] =>
	shape.kind === "unknown" ? shape.given : shape;

/** The kind a mark's shape has in a file or at the server, an unknown one's too. */
export const givenKind = (shape: Shape): string =>
	shape.kind === "unknown" ? shape.given.kind : shape.kind;

/**
 * A mark made by selecting text on the page (DEC-066; the server's DEC-040):
 * the shape is a box round `rects`, and this says which text it was. A
 * client that does not know it sees the box with the same comment.
 */
export interface Highlight {
	/** The selected text, whitespace collapsed: 1 to 500 characters. */
	text: string;
	/** The text right before it in its element: at most 32 characters. */
	before?: string;
	/** The text right after it in its element: at most 32 characters. */
	after?: string;
	/** Its line boxes, top to bottom, in the shape's coordinates: 1 to 40. */
	rects: Rect[];
}

/** What a highlight may hold: the server's limits (its `HIGHLIGHT_LIMITS`). */
export const HIGHLIGHT_LIMITS = {
	text: 500,
	context: 32,
	rects: 40,
} as const;

const finiteRect = (v: unknown): v is Rect => {
	if (typeof v !== "object" || v === null) return false;
	const r = v as Record<string, unknown>;
	return [r["x"], r["y"], r["width"], r["height"]].every(
		(n) => typeof n === "number" && Number.isFinite(n),
	);
};

/** Whether `r` lies inside `box`, give or take 4 px (the server's tolerance). */
function within(r: Rect, box: Rect): boolean {
	// A box drawn right to left has a negative size: its edges, as the server reads them.
	const left = Math.min(box.x, box.x + box.width);
	const right = Math.max(box.x, box.x + box.width);
	const top = Math.min(box.y, box.y + box.height);
	const bottom = Math.max(box.y, box.y + box.height);
	return (
		r.x >= left - 4 &&
		r.y >= top - 4 &&
		r.x + r.width <= right + 4 &&
		r.y + r.height <= bottom + 4
	);
}

/**
 * A highlight within what a case and the server keep, or none: all of it or
 * nothing, and the mark kept either way, as the server does (an extra, like
 * an element's look; DEC-021 there). Only on a box.
 */
export function highlightWithin(
	v: unknown,
	shape: Shape,
): Highlight | undefined {
	if (shape.kind !== "box" || typeof v !== "object" || v === null)
		return undefined;
	const o = v as Record<string, unknown>;
	const { text, before, after, rects } = o;
	const context = (s: unknown) =>
		s === undefined ||
		(typeof s === "string" && textLength(s) <= HIGHLIGHT_LIMITS.context);
	if (
		typeof text !== "string" ||
		text.trim() === "" ||
		textLength(text) > HIGHLIGHT_LIMITS.text ||
		!context(before) ||
		!context(after) ||
		!Array.isArray(rects) ||
		rects.length < 1 ||
		rects.length > HIGHLIGHT_LIMITS.rects ||
		!rects.every(finiteRect) ||
		// Each a box of its own, inside the shape's (4 px of tolerance): the
		// server's rule too.
		!rects.every((r) => r.width > 0 && r.height > 0 && within(r, shape.rect))
	)
		return undefined;
	return {
		text,
		...(typeof before === "string" ? { before } : {}),
		...(typeof after === "string" ? { after } : {}),
		rects: rects.map(({ x, y, width, height }) => ({ x, y, width, height })),
	};
}

/** What Sitegloss knows about a mark's element (see element.ts). */
export interface ElementDetails {
	tag: string;
	/** A hand-written id (generated ones are left out). */
	id?: string;
	testId?: string;
	role?: string;
	/** Accessible name. */
	name?: string;
	/** Text content, whitespace collapsed, at most 200 characters. */
	text?: string;
	/** The readable parts of the classes. */
	classes: string[];
	/** `name`, `type`, `href` (path), `src` (file), `placeholder`, `alt`, `title`. */
	attributes: Record<string, string>;
	/**
	 * The heading it is under: its section's or card's title (DEC-047);
	 * before, the nearest heading before it.
	 */
	heading?: string;
	/**
	 * Only on a page's candidates, never stored: the heading by the rule
	 * before DEC-047, where it differs, to compare marks stored then with.
	 */
	headingBefore?: string;
	/** The landmark around it, e.g. `navigation: Hauptmenü`. */
	landmark?: string;
	/** Ancestors, nearest first, e.g. `nav`, `header.Header_root`. */
	ancestors: string[];
	/** Position and size in document coordinates (CSS pixels). */
	rect: Rect;
	/** The document's size when it was described. */
	page: { width: number; height: number };
	/** A best-effort CSS selector (W3C Web Annotation `CssSelector`). */
	selector: string;
	/**
	 * Computed CSS when the mark was made (DEC-048): property name to value,
	 * at most 40, never one that names a URL. Only on a mark's own element,
	 * recorded once; never on a page's candidates, never matched, never in
	 * the sync's fingerprint (`fixedOf`).
	 */
	styles?: Record<string, string>;
	/** The colour behind the element when the mark was made (DEC-048). */
	backdrop?: Backdrop;
	/** The boxes of up to six nearest element siblings when the mark was made (DEC-048). */
	siblings?: SiblingBox[];
}

/**
 * The colour that shows behind an element: its own background colour, or,
 * while that is transparent or translucent, composited over its ancestors'
 * until an opaque one (DEC-048).
 */
export interface Backdrop {
	/** As computed (`rgb(255, 255, 255)`); never a URL. */
	color: string;
	/** How many steps up the opaque background is (0: the element itself); none: the page's canvas. */
	depth?: number;
	/** A background image or gradient on the way may show instead of the colour. */
	image?: boolean;
}

/** The box of one of an element's nearest element siblings (DEC-048). */
export interface SiblingBox {
	/** Its place relative to the element: -1 right before it, 1 right after; never 0. */
	offset: number;
	tag: string;
	/** In document coordinates, as the element's `rect`. */
	rect: Rect;
}

/** The most computed styles an element keeps, and their names' and values' lengths: what the server keeps (its DEC-021). */
export const MAX_STYLES = 40;
export const MAX_STYLE_NAME = 60;
export const MAX_STYLE_VALUE = 300;
export const MAX_SIBLINGS = 6;
/** A property, or a vendor-prefixed one; never a custom property (`--x`), whose value is the author's own text. */
const STYLE_NAME = /^-?[a-z][a-z0-9-]*$/;
/** An element's name, as the server keeps a sibling's. */
const TAG = /^[A-Za-z][A-Za-z0-9_.:-]*$/;

/** CSS functions that fetch something, with or without a vendor prefix. */
const FETCHES = /\b(?:url|image|image-set|cross-fade|element|src|paint)\s*\(/i;
const QUOTED = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;

/** CSS text as a browser reads it: comments out, escapes decoded. */
function decodedCss(css: string): string {
	return css
		.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "")
		.replace(
			/\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\r\n|([\s\S]))/g,
			(_all, hex: string | undefined, char: string | undefined) => {
				if (hex !== undefined) {
					const code = Number.parseInt(hex, 16);
					return code === 0 ||
						code > 0x10ffff ||
						(code >= 0xd800 && code <= 0xdfff)
						? "�"
						: String.fromCodePoint(code);
				}
				return char === undefined || /[\n\r\f]/.test(char) ? "" : char;
			},
		);
}

/**
 * A CSS value that names a URL (a fetching function, `://`, a quoted path
 * or query), also behind comments or escapes: it can carry a query or a
 * token, which nothing recorded about an element does (DEC-009). The
 * server drops such a value too; the fixed list of properties (look.ts) is
 * what keeps them out in the first place.
 */
export function namesUrl(value: string): boolean {
	for (const text of [value, decodedCss(value)])
		if (
			FETCHES.test(text) ||
			text.includes("://") ||
			(text.match(QUOTED) ?? []).some((quoted) => /[/?]/.test(quoted))
		)
			return true;
	return false;
}

const keptValue = (value: unknown): value is string =>
	typeof value === "string" &&
	value.trim() !== "" &&
	value.length <= MAX_STYLE_VALUE &&
	!namesUrl(value);

const isFiniteNumber = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v);

/**
 * Computed styles within what the server keeps: a name of its form, a
 * value of at most 300 characters that names no URL, at most 40. What does
 * not fit is left out, not failed: these are extras.
 */
export function stylesWithin(v: unknown): Record<string, string> | undefined {
	if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
	const out: Record<string, string> = {};
	let count = 0;
	for (const [name, value] of Object.entries(v)) {
		if (count >= MAX_STYLES) break;
		if (
			name.length > MAX_STYLE_NAME ||
			!STYLE_NAME.test(name) ||
			!keptValue(value)
		)
			continue;
		out[name] = value;
		count++;
	}
	return count > 0 ? out : undefined;
}

/** A backdrop within what the server keeps, or none. */
export function backdropWithin(v: unknown): Backdrop | undefined {
	if (typeof v !== "object" || v === null) return undefined;
	const o = v as Record<string, unknown>;
	const color = o["color"];
	if (!keptValue(color)) return undefined;
	const depth = o["depth"];
	return {
		color,
		...(Number.isInteger(depth) &&
		(depth as number) >= 0 &&
		(depth as number) <= 1000
			? { depth: depth as number }
			: {}),
		...(o["image"] === true ? { image: true } : {}),
	};
}

/** Siblings' boxes within what a case and the server take, or none. */
export function siblingsWithin(v: unknown): SiblingBox[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out: SiblingBox[] = [];
	for (const s of v) {
		if (out.length >= MAX_SIBLINGS) break;
		if (typeof s !== "object" || s === null) continue;
		const o = s as Record<string, unknown>;
		const r = o["rect"] as Record<string, unknown> | null | undefined;
		const offset = o["offset"];
		if (
			!Number.isInteger(offset) ||
			offset === 0 ||
			Math.abs(offset as number) > 100 ||
			typeof o["tag"] !== "string" ||
			o["tag"].length > 100 ||
			!TAG.test(o["tag"]) ||
			typeof r !== "object" ||
			r === null ||
			![r["x"], r["y"], r["width"], r["height"]].every(isFiniteNumber)
		)
			continue;
		out.push({
			offset: offset as number,
			tag: o["tag"],
			rect: {
				x: r["x"] as number,
				y: r["y"] as number,
				width: r["width"] as number,
				height: r["height"] as number,
			},
		});
	}
	return out.length > 0 ? out : undefined;
}

/**
 * An element's computed styles, backdrop and siblings (DEC-048), each within
 * what a case and the server take; left out where none.
 */
export function lookOf(o: {
	styles?: unknown;
	backdrop?: unknown;
	siblings?: unknown;
}): Pick<ElementDetails, "styles" | "backdrop" | "siblings"> {
	const styles = stylesWithin(o.styles);
	const backdrop = backdropWithin(o.backdrop);
	const siblings = siblingsWithin(o.siblings);
	return {
		...(styles === undefined ? {} : { styles }),
		...(backdrop === undefined ? {} : { backdrop }),
		...(siblings === undefined ? {} : { siblings }),
	};
}

/** The element without its computed styles, backdrop and siblings: what is matched and fingerprinted. */
export function withoutLook(details: ElementDetails): ElementDetails {
	const { styles: _s, backdrop: _b, siblings: _i, ...rest } = details;
	return rest;
}

export interface Shot {
	id: string;
	/** `shots/<id>.webp` */
	image: string;
	scrollX: number;
	scrollY: number;
	viewport: Viewport;
	capturedAt: string;
	/**
	 * The page's address when it was taken: a case spans pages (DEC-038).
	 * Every screenshot taken since has one; one from before may have none,
	 * and is then the case's first page's (`shotUrl`).
	 */
	url?: string;
	/**
	 * The address's query when it was taken, without its `?`, as `keptQuery`
	 * leaves it (DEC-050): to open the page again as it was. None when it
	 * had none, or nothing of it is kept. It takes no part in which page the
	 * screenshot is of.
	 */
	query?: string;
}

export interface Mark {
	id: string;
	/** Shown on the page and in lists; unique in the case. */
	number: number;
	shot: string;
	comment: string;
	/** Who made it: the user, or an AI app through a tool. */
	author: "user" | "ai";
	/** In the shot's coordinates. */
	shape: Shape;
	/** `crops/<id>.webp` */
	crop: string;
	element: ElementDetails | null;
	/** How the mark was settled; none: still open. */
	resolution?: Resolution;
	/**
	 * The times it was opened again after it was settled, oldest first, each
	 * with the resolution it ended; none: never reopened (DEC-023).
	 */
	reopens?: Reopen[];
	/** What AI apps found about the mark, oldest first; none: no findings. */
	findings?: Finding[];
	/**
	 * Pictures a person added to the mark (pasted, chosen or dropped), oldest
	 * first, at most `MAX_MARK_IMAGES`; none: no images (DEC-058).
	 */
	images?: MarkImage[];
	/**
	 * Images added on this device that did not fit once the team's came back
	 * (the mark holds six there), oldest first (DEC-058): this browser's
	 * own, never in a file, the Markdown, an AI app's view or the wire. Not
	 * sent, and said so; the oldest moves into `images` as soon as a place
	 * frees up, and is then sent as any added image. Their files are kept.
	 */
	heldImages?: MarkImage[];
	/** Who made it, in a case synced with a team (DEC-039). */
	createdBy?: UserRef;
	/**
	 * The AI app it was made through (DEC-046): one paired with this
	 * browser, or the one a teammate's mark came through, as the server says.
	 */
	createdVia?: FindingApp;
	/**
	 * The AI app that made the mark's last change through this browser, while
	 * the mark is as that change left it (`of`: `markSignature`): what is sent
	 * of the change names the app. Any later change to the mark ends it, by
	 * hand too (DEC-046). This browser's note for its sync, never in a file.
	 */
	via?: { app: FindingApp; of: string };
	/**
	 * Who wrote the comment as it reads now, once it was changed after the
	 * mark was made: the server's record (DEC-046). Shown, never compared.
	 */
	commentBy?: Stamp;
	/**
	 * An arrow's, or an open freehand stroke's, elements under its first and
	 * its last point (DEC-047); none: not such a mark, or drawn before.
	 * `element` stays the element the mark is about (an arrow's: its head's).
	 */
	ends?: MarkEnds;
	/**
	 * The text it marks, for a mark made with the Highlight tool (DEC-066):
	 * its shape is a box round the text's lines, its element the one that
	 * holds all of the text. Set once, with the mark.
	 */
	highlight?: Highlight;
}

/**
 * A picture a person added to a mark (DEC-058), for what Sitegloss cannot
 * capture (a menu that closes, another state of the page). It is only added
 * or removed, never changed, so its id is the same here, on the wire and in a
 * file; the path follows the id, never the mark's number, and a mark that
 * takes another number moves no image.
 */
export interface MarkImage {
	/** `i_…`, of the adder's making. */
	id: string;
	/** `images/<id>.webp` */
	image: string;
	/** When, and in a case synced with a team by whom (the server's record). */
	added: ImageAdded;
}

/**
 * When an image was added, and by whom: a stamp; `imported`: it came in from
 * a file, which keeps its time and names nobody (the server's rule too).
 */
export type ImageAdded = Stamp & { imported?: true };

/** The elements at a mark's two ends, each `null` where there was none. */
export interface MarkEnds {
	start: ElementDetails | null;
	end: ElementDetails | null;
}

/**
 * When, by whom, and through which AI app something was done (DEC-046):
 * a case's closing, a comment's change, who wrote a summary. `user` comes
 * from a team's server only; `app` also from this browser's AI apps.
 */
export interface Stamp {
	at: string;
	user?: UserRef;
	app?: FindingApp;
}

/**
 * A comment in a case's thread (DEC-046): the team's conversation about the
 * case, apart from its summary. `mark`: the mark it is about, by its id
 * here (`m<number>`, which follows the mark when it takes another number);
 * none: the case. `markGone`: it was about a mark deleted since.
 */
export interface CaseComment {
	/** Of the writer's making, the same everywhere: `k_…`. */
	id: string;
	mark?: string;
	markGone?: true;
	text: string;
	at: string;
	/** Who wrote it, in a case synced with a team. */
	user?: UserRef;
	/** The AI app it was written through. */
	app?: FindingApp;
	/** Its last change, once it was changed. */
	edited?: Stamp;
	/**
	 * From a file: who wrote it is what the file says. It is no AI app's own,
	 * and what is sent of it carries no app (DEC-046).
	 */
	imported?: true;
	/**
	 * Synced, and its writer is no longer known to the team (the account is
	 * gone): nobody's own (DEC-046).
	 */
	writerGone?: true;
}

/**
 * A person, as sitegloss.dev names who did something (DEC-039): there only
 * on what went through a team's sync, where the server wrote it down from
 * the login. Nothing here sets it.
 */
export interface UserRef {
	id: string;
	name: string;
}

/** The AI app that wrote a finding, as the relay named it then. */
export interface FindingApp {
	/** Its client id (a URL, e.g. `https://claude.ai/oauth`): the same for every pairing. */
	id: string;
	/** The name it declares, when the relay knew one. */
	name?: string;
	/** The host of its client id: the verified part. */
	host: string;
}

/**
 * A finding of an AI app on a mark (DEC-019): apart from the user's comment,
 * which no AI app changes. Only the app that wrote it may edit or delete it;
 * the user may delete any.
 */
export interface Finding {
	id: string;
	text: string;
	app: FindingApp;
	at: string;
	/** When its app last changed its text. */
	editedAt?: string;
	/** Came in from a file: no app's own, whichever app it names. */
	imported?: true;
	/** Whose AI app wrote it, in a case synced with a team (DEC-039). */
	user?: UserRef;
}

/** An AI app as the panel and the questions name it: its name beside its host. */
export function appLabel(app: FindingApp): string {
	return app.name ? `${app.name} (${app.host})` : app.host;
}

/**
 * A finding the AI app `clientId` wrote here, not one from a file. In a case
 * synced with a team a finding says whose app wrote it: the same app
 * connected to a teammate's browser is another one's, so only a finding of
 * the person signed in here (`me`) is this app's own.
 */
export function isOwnFinding(
	f: Finding,
	clientId: string,
	me?: string,
): boolean {
	return (
		f.imported !== true &&
		f.app.id === clientId &&
		(f.user === undefined || f.user.id === me)
	);
}

/** What became of a mark: fixed, or left as it is and why. */
export const RESOLUTION_KINDS = ["fixed", "wontfix", "cantreproduce"] as const;
export type ResolutionKind = (typeof RESOLUTION_KINDS)[number];

export const RESOLUTION_LABEL: Record<ResolutionKind, string> = {
	fixed: "Fixed",
	wontfix: "Won't fix",
	cantreproduce: "Can't reproduce",
};

export interface Resolution {
	kind: ResolutionKind;
	/** Why, in the user's words; none when it says nothing. */
	note?: string;
	at: string;
	/** The AI app that set it through a tool; none: set in the panel. */
	app?: FindingApp;
	/**
	 * The fix was checked and holds (DEC-023); only with `kind: "fixed"`. An
	 * addition, never a kind of its own: an older build refuses a kind it does
	 * not know, and with it the whole file.
	 */
	verified?: Verification;
	/** Came in from a file: who set it and when is what the file says. */
	imported?: true;
	/** Who set it, in a case synced with a team (DEC-039). */
	user?: UserRef;
}

export interface Verification {
	at: string;
	/** The AI app that set it through a tool; none: set in the panel. */
	app?: FindingApp;
	/** Came in from a file. */
	imported?: true;
	/** Who verified it, in a case synced with a team (DEC-039). */
	user?: UserRef;
}

/** A settled mark opened again, and the resolution that ended (DEC-023). */
export interface Reopen {
	/** What is still wrong; none when nothing was said (an AI app's call). */
	note?: string;
	at: string;
	/** The AI app that reopened it through a tool; none: in the panel. */
	app?: FindingApp;
	/** The resolution it ended, whole: the claimed fix and its note stay. */
	was: Resolution;
	/** Came in from a file. */
	imported?: true;
	/** Who reopened it, in a case synced with a team (DEC-039). */
	user?: UserRef;
}

/** The most reopens a mark keeps; the oldest goes when there are more. */
export const MAX_REOPENS = 20;

/** The longest reopen note, in characters: get_case stays readable. */
export const MAX_REOPEN_NOTE = 2000;

/** A mark's status: derived from its resolution, never stored as such. */
export const MARK_STATUSES = [
	"open",
	"fixed",
	"verified",
	"wontfix",
	"cantreproduce",
] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];

export const STATUS_LABEL: Record<MarkStatus, string> = {
	open: "Open",
	fixed: "Fixed, to verify",
	verified: "Verified",
	wontfix: "Won't fix",
	cantreproduce: "Can't reproduce",
};

/** The status of a mark settled as `r`; none: open. */
export function resolutionStatus(r: Resolution | undefined): MarkStatus {
	if (r === undefined) return "open";
	if (r.kind === "fixed") return r.verified ? "verified" : "fixed";
	return r.kind;
}

export const markStatus = (a: Mark): MarkStatus =>
	resolutionStatus(a.resolution);

/** What Resolve… and Change… can set: every status but open. */
export type ResolveChoice = Exclude<MarkStatus, "open">;

export const RESOLVE_CHOICES: readonly ResolveChoice[] = [
	"fixed",
	"verified",
	"wontfix",
	"cantreproduce",
];

/** The resolution a choice stands for: verified is a fix, verified at once. */
export const resolutionFor = (
	choice: ResolveChoice,
): { kind: ResolutionKind; verified: boolean } =>
	choice === "verified"
		? { kind: "fixed", verified: true }
		: { kind: choice, verified: false };

/** The four groups the case's summary counts and filters by. */
export const STATUS_GROUPS = [
	"open",
	"toVerify",
	"verified",
	"dismissed",
] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

export const GROUP_OF: Record<MarkStatus, StatusGroup> = {
	open: "open",
	fixed: "toVerify",
	verified: "verified",
	wontfix: "dismissed",
	cantreproduce: "dismissed",
};

export const GROUP_LABEL: Record<StatusGroup, string> = {
	open: "Open",
	toVerify: "To verify",
	verified: "Verified",
	dismissed: "Dismissed",
};

export type CaseCounts = Record<StatusGroup, number>;

/** How many marks are open, to verify, verified and dismissed. */
export function caseCounts(c: Case): CaseCounts {
	const counts: CaseCounts = {
		open: 0,
		toVerify: 0,
		verified: 0,
		dismissed: 0,
	};
	for (const a of c.marks) counts[GROUP_OF[markStatus(a)]]++;
	return counts;
}

export interface PageInfo {
	url: string;
	title: string;
	lang: string;
	viewport: Viewport;
	userAgent: string;
}

/**
 * A page of a case (DEC-038): its address as `plainUrl` gives it, and its
 * title and language when the mark was made (empty where not known).
 */
export interface CasePage {
	url: string;
	title: string;
	lang: string;
}

export interface Case {
	format: typeof CASE_FORMAT;
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	/**
	 * The case's first page, and the window and browser it was started in.
	 * Builds before DEC-038 know only this page.
	 */
	page: PageInfo;
	/**
	 * The pages the case's marks are on, the first one first (DEC-038). A case
	 * stored before has none: read them with `casePages`, which also gives
	 * those of such a case.
	 */
	pages?: CasePage[];
	shots: Shot[];
	marks: Mark[];
	/** The summary for the developer: what should change, as agreed (DEC-019). */
	verdict: string | null;
	/**
	 * A link the user attaches (DEC-028): a ticket, a design, a pull request.
	 * Only http or https, as it is shown as a link.
	 */
	link?: string;
	/** When this copy came in from a file: its texts are whoever wrote the file's. */
	importedAt?: string;
	/**
	 * The highest mark number used, a deleted mark's too: its pin stays on the
	 * screenshots, so no new mark takes its number.
	 */
	lastNumber?: number;
	/** Closed: filed away, not frozen (DEC-046); none: open. */
	closed?: Stamp;
	/** The thread, in the order the server took it (DEC-046). */
	comments?: CaseComment[];
	/** Who wrote the summary as it reads now: the server's record (DEC-046). */
	summaryBy?: Stamp;
	/**
	 * The last change, if an AI app made it through this browser's AI
	 * connection (DEC-046): what is sent of it names the app (`via`). Holds
	 * only while `at` is the case's `updatedAt`: any later change, by hand
	 * too, ends it.
	 */
	via?: { app: FindingApp; at: string };
	/**
	 * The AI app whose call made the case, through this browser: its
	 * `case.create` names the app (DEC-046). This browser's note, never in
	 * a file.
	 */
	createdVia?: FindingApp;
	/**
	 * Comments an AI app deleted through this browser, while the delete is
	 * not sent: what is sent names the app (DEC-046). Never in a file.
	 */
	deletedVia?: { id: string; app: FindingApp }[];
	/**
	 * Who started the case, in a case synced with a team: the reporter, as
	 * the server records it (DEC-071). None: not known (a case only in this
	 * browser, or not back from the server yet).
	 */
	createdBy?: UserRef;
	/**
	 * Who the case is assigned to, as the server last said (DEC-071): `null`
	 * nobody; none: not told (a case only in this browser, a server from
	 * before). The server's record, shown and kept, never sent: what is sent
	 * is `assign`.
	 */
	assignee?: UserRef | null;
	/** Who assigned it, and when: the server's stamp, while it has an assignee. */
	assignedBy?: Stamp;
	/**
	 * An assignment made in this browser and not taken by the server yet
	 * (DEC-071): `to` the member, `null` nobody. Sent as `case.patch`'s
	 * `assignee` with the next sync, and gone once the server's copy says
	 * it. This browser's note, never in a file.
	 */
	assign?: { to: UserRef | null; at: string };
	/**
	 * The server refused the last assignment made here (DEC-071): why, in
	 * words for the person. Said in the case until the next assignment.
	 * This browser's note, never in a file.
	 */
	assignRefused?: { text: string; at: string };
}

/** The longest case title. */
export const MAX_TITLE = 500;

/** The longest link a case may carry (DEC-028). */
export const MAX_LINK = 2048;

/**
 * The most marks and screenshots a case holds. Marks added one by one have a
 * screenshot each (DEC-014), so there can be as many shots as marks.
 */
export const MAX_MARKS = 1000;
export const MAX_SHOTS = MAX_MARKS;

export class CaseError extends Error {
	override name = "CaseError";
}

/**
 * A new random id with a prefix, e.g. `c_8f3k…`. `crypto.randomUUID` does not
 * exist in a content script on a plain http: page; this does.
 */
export function newId(prefix: string): string {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
	return `${prefix}_${hex}`;
}

export const shotImage = (shotId: string) => `shots/${shotId}.webp`;
export const cropImage = (markId: string) => `crops/${markId}.webp`;
/** An image a person added to a mark, by the image's own id (DEC-058). */
export const addedImage = (imageId: string) => `images/${imageId}.webp`;

/** A mark's id in its case: `m` and its number (`m1`, `m2`…; DEC-051). */
export const markIdOf = (number: number) => `m${number}`;
/** A screenshot taken for a save that is not committed yet (save.ts). */
export const pendingImage = (shotId: string) => `pending/${shotId}.webp`;

/**
 * The paths of all images a case references: its screenshots, its crops and
 * the images added to its marks.
 */
export function caseImages(c: Case): Set<string> {
	return new Set([
		...c.shots.map((s) => s.image),
		...c.marks.map((a) => a.crop),
		...c.marks.flatMap((a) => (a.images ?? []).map((x) => x.image)),
	]);
}

/** The files of the images held back on marks here (DEC-058): never in a file. */
export const heldImagesOf = (c: Case): string[] =>
	c.marks.flatMap((a) => (a.heldImages ?? []).map((x) => x.image));

/**
 * The screenshot's real pixels per CSS pixel. `devicePixelRatio` can differ
 * from what `captureVisibleTab` delivers (browser zoom, device emulation), so
 * the image's own width decides; `fallback` when it cannot.
 */
export function imageScale(
	imageWidth: number,
	viewportWidth: number,
	fallback: number,
): number {
	return imageWidth > 0 && viewportWidth > 0
		? imageWidth / viewportWidth
		: fallback;
}

/**
 * A page's address as Sitegloss keeps it and tells an AI app: origin and path,
 * since a query or a fragment can carry personal data or tokens, as for links
 * (DEC-009). A hash route (`#/path`, `#!/path`) names the page, so it stays,
 * up to the first character that starts parameters.
 */
export const hashRoute = (hash: string) =>
	/^#!?\/[^?#&=]*/.exec(hash)?.[0] ?? "";

export function plainUrl(href: string): string {
	try {
		const url = new URL(href);
		const route = hashRoute(url.hash);
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = route;
		return url.href.slice(0, MAX_URL);
	} catch {
		return href.slice(0, MAX_URL);
	}
}

/**
 * The length of `text` in characters as JSON Schema's maxLength counts them:
 * code points, an emoji one, not two UTF-16 units.
 */
export function textLength(text: string): number {
	let n = 0;
	for (const _ of text) n++;
	return n;
}

/** `text` cut to `max` characters (code points), never inside a pair. */
export function cutText(text: string, max: number): string {
	if (text.length <= max) return text;
	let end = 0;
	let n = 0;
	for (const ch of text) {
		if (n === max) break;
		end += ch.length;
		n++;
	}
	return text.slice(0, end);
}

/** The IndexedDB key of a case's image. */
export const imageKey = (caseId: string, path: string) => `${caseId}/${path}`;

/** The next mark number and shot number of a case. */
export function nextNumbers(c: Case | undefined): {
	mark: number;
	shot: number;
} {
	if (c === undefined) return { mark: 1, shot: 1 };
	const max = (values: number[]) => values.reduce((a, b) => Math.max(a, b), 0);
	return {
		mark: max([...c.marks.map((a) => a.number), c.lastNumber ?? 0]) + 1,
		shot: max(c.shots.map((s) => Number(s.id.slice(1)) || 0)) + 1,
	};
}

/** The smallest rectangle around a shape; an unknown one has none (a zero box at 0, 0). */
export function shapeBounds(shape: Shape): Rect {
	switch (shape.kind) {
		case "unknown":
			return { x: 0, y: 0, width: 0, height: 0 };
		case "element":
		case "box":
			return shape.rect;
		case "note":
			return { x: shape.at.x, y: shape.at.y, width: 0, height: 0 };
		case "arrow":
			return boundsOf([shape.from, shape.to]);
		case "pen":
			return boundsOf(shape.points);
	}
}

export function boundsOf(points: readonly Point[]): Rect {
	if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** A position along one axis of a box, on the same axis of another box. */
function along(
	v: number,
	start: number,
	size: number,
	newStart: number,
	newSize: number,
): number {
	if (size <= 0 || v < start) return newStart + v - start;
	if (v > start + size) return newStart + newSize + v - start - size;
	return newStart + ((v - start) * newSize) / size;
}

/**
 * A shape that was on the box `from`, on the box `to`. What was inside the box
 * scales with it; what was outside keeps its distance to the edge, or a small
 * element that grew would throw it far away. An element's mark is the box itself.
 */
export function shapeOnBox(shape: Shape, from: Rect, to: Rect): Shape {
	const p = (q: Point): Point => ({
		x: along(q.x, from.x, from.width, to.x, to.width),
		y: along(q.y, from.y, from.height, to.y, to.height),
	});
	switch (shape.kind) {
		case "element":
			return { kind: "element", rect: to };
		case "box": {
			const { x, y, width, height } = shape.rect;
			const a = p({ x, y });
			const b = p({ x: x + width, y: y + height });
			return {
				kind: "box",
				rect: { ...a, width: b.x - a.x, height: b.y - a.y },
			};
		}
		case "note":
			return { kind: "note", at: p(shape.at) };
		case "arrow":
			return { kind: "arrow", from: p(shape.from), to: p(shape.to) };
		case "pen":
			return { kind: "pen", points: shape.points.map(p) };
		case "unknown":
			return shape;
	}
}

/** A highlight's lines moved by `dx`, `dy`. */
export const translateHighlight = (
	h: Highlight,
	dx: number,
	dy: number,
): Highlight => ({
	...h,
	rects: h.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })),
});

/**
 * Which page an address is (DEC-038). A case lists each page once, and a page
 * is its path in whatever environment: a case made on production is looked at
 * on staging and fixed on localhost, and a mark added there is on the same
 * page, not on a second one. So the key leaves the origin out, except for a
 * home page, where the origin is all there is to tell two sites apart.
 *
 * The key is the path without the slashes at its end, and the hash route
 * (`#/book`, `#!/book`) written as `#/book`, also without slashes at its end.
 * A query and a plain fragment (`#section`) name no page. What is no web
 * address is its own key.
 *
 * This is the server's function (sitegloss.dev, `packages/api/src/v1/page.ts`)
 * and has to stay it: `test/page-key.json` holds the server's vectors, and
 * everything here that asks "the same page?" asks this.
 */
export function pageKey(address: string): string {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return address;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return address;
	const path = url.pathname.replace(/\/+$/, "");
	const route = (/^#!?(\/[^?#&=]*)/.exec(url.hash)?.[1] ?? "").replace(
		/\/+$/,
		"",
	);
	if (path === "" && route === "") return `${url.origin}/`;
	return route === "" ? path : `${path}#${route}`;
}

/** Whether two addresses are the same page of a case (`pageKey`). */
export const samePage = (a: string, b: string): boolean =>
	pageKey(a) === pageKey(b);

/** A web address's origin; none for anything else. */
function webOrigin(address: string): string | undefined {
	try {
		const url = new URL(address);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.origin
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * The same page on the same site (DEC-050): the origin and `pageKey`. What
 * Home offers under "This page" is held to this, and nothing more.
 */
export function exactPage(a: string, b: string): boolean {
	const origin = webOrigin(a);
	return origin !== undefined && origin === webOrigin(b) && samePage(a, b);
}

/**
 * Which page an address is for drawing a case opened by hand (DEC-050): its
 * path and hash route, whatever the host. `pageKey`, except that a home page
 * is `/` on any host: production's home page is the home page on
 * `localhost:3000/`. The extension's own; the shared `pageKey` and its
 * vectors do not change.
 */
export function pathKey(address: string): string {
	const key = pageKey(address);
	const origin = webOrigin(address);
	return origin !== undefined && key === `${origin}/` ? "/" : key;
}

/** Whether a mark of the page at `a` is drawn on the page at `b` (`pathKey`). */
export const samePath = (a: string, b: string): boolean =>
	pathKey(a) === pathKey(b);

/**
 * What tells a mark from every other mark of its case, whatever its number:
 * when its screenshot was taken, and its drawing. A mark's id (`m<number>`)
 * is another mark's after the team's sync gave it another number (DEC-039),
 * so what is opened on one mark is held to this, not to the id.
 */
export function markKey(c: Case, a: Mark): string {
	return markKeys(c).get(a.id) ?? drawnKey(c, a);
}

/** A mark's screenshot time and drawing, as a key. */
function drawnKey(c: Case, a: Mark): string {
	const shot = c.shots.find((s) => s.id === a.shot);
	return JSON.stringify([
		shot?.capturedAt ?? "",
		a.shape,
		a.element?.selector ?? null,
		a.element?.rect ?? null,
	]);
}

/**
 * Every mark's `markKey`, by id. Twins (the same drawing on the same
 * screenshot: the same element marked twice) are told apart by nothing but
 * their ids, so their key also names the ids all of them have now: once a
 * renumbering moves any of them, a key held from before names no mark, and
 * `markFor` refuses instead of taking a twin for the mark meant.
 */
function markKeys(c: Case): Map<string, string> {
	const drawn = new Map<string, string[]>();
	const of = new Map<string, string>();
	for (const a of c.marks) {
		const key = drawnKey(c, a);
		of.set(a.id, key);
		drawn.set(key, [...(drawn.get(key) ?? []), a.id]);
	}
	const keys = new Map<string, string>();
	for (const [id, key] of of) {
		const twins = drawn.get(key) ?? [];
		keys.set(
			id,
			twins.length > 1
				? JSON.stringify([...(JSON.parse(key) as unknown[]), [...twins].sort()])
				: key,
		);
	}
	return keys;
}

/**
 * The mark of `c` that something opened on the mark `id` with the key `key`
 * is about now (`markKey`): the mark under that id while it is still that
 * mark; else the one mark with that key (it has another number now). None:
 * it is not in the case any more. `"ambiguous"`: the key names no mark, or
 * more than one, and a mark with its screenshot and drawing is there (twins
 * whose ids moved, or a twin made since): nothing says which is meant,
 * whatever the ids say, and nothing may be changed.
 */
export function markFor(
	c: Case,
	id: string,
	key: string,
): Mark | "ambiguous" | undefined {
	const keys = markKeys(c);
	const under = c.marks.find((a) => a.id === id);
	if (under !== undefined && keys.get(under.id) === key) return under;
	const same = c.marks.filter((a) => keys.get(a.id) === key);
	if (same.length === 1) return same[0];
	if (same.length > 1) return "ambiguous";
	let drawn: string;
	try {
		drawn = JSON.stringify((JSON.parse(key) as unknown[]).slice(0, 4));
	} catch {
		return undefined;
	}
	return c.marks.some((a) => drawnKey(c, a) === drawn)
		? "ambiguous"
		: undefined;
}

/** What is said when a change cannot be held to its mark. */
export const MARK_CHANGED =
	"The case changed meanwhile, and this is not the mark it was: open the mark again. Nothing was saved.";

/** The address of the page a screenshot was taken on. */
export const shotUrl = (c: Case, shot: Shot | undefined): string =>
	shot?.url ?? c.page.url;

/** The address of the page a mark is on: its screenshot's. */
export function markUrl(c: Case, a: Mark): string {
	return shotUrl(
		c,
		c.shots.find((s) => s.id === a.shot),
	);
}

/**
 * The case's pages, the first one first (DEC-038): the stored list, or for a
 * case from before the list the first page; and every page a screenshot was
 * taken on that is not among them, without a title. A page is there once
 * (`pageKey`).
 */
export function casePages(c: Case): CasePage[] {
	const pages: CasePage[] = [];
	const seen = new Set<string>();
	const add = (page: CasePage) => {
		const key = pageKey(page.url);
		if (seen.has(key)) return;
		seen.add(key);
		pages.push(page);
	};
	for (const page of c.pages ?? []) add(page);
	if (c.pages === undefined || c.pages.length === 0)
		add({ url: c.page.url, title: c.page.title, lang: c.page.lang });
	for (const shot of c.shots)
		if (shot.url !== undefined) add({ url: shot.url, title: "", lang: "" });
	return pages.slice(0, MAX_PAGES);
}

/**
 * How many marks each page of the case has, by the page's key: one pass over
 * the screenshots and one over the marks, for a list of pages with counts.
 */
export function marksByPage(c: Case): Map<string, number> {
	const first = pageKey(c.page.url);
	const pageOf = new Map(
		c.shots.map((s) => [s.id, s.url === undefined ? first : pageKey(s.url)]),
	);
	const counts = new Map<string, number>();
	for (const a of c.marks) {
		const key = pageOf.get(a.shot) ?? first;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

/** How many of the case's marks are on the page `url`. */
export function marksOnPage(c: Case, url: string): number {
	return marksByPage(c).get(pageKey(url)) ?? 0;
}

/**
 * The page of the case's list that the address `url` is (`pageKey`): the
 * case's page in another environment is the same page, a home page is its
 * site's. For the list and what is sent of it; which marks are drawn on the
 * page in front is `pageInFront` (DEC-050).
 */
export function pageAt(c: Case, url: string): CasePage | undefined {
	const key = pageKey(url);
	return casePages(c).find((p) => pageKey(p.url) === key);
}

/**
 * The case with its list of pages as its screenshots have them: a page no
 * screenshot is of any more goes, and `page` follows the first one left,
 * with the window that page's first screenshot was taken in. A case without
 * screenshots keeps the pages it was started on; one stored before the list
 * (DEC-038) stays without it.
 */
export function withPagesOfShots(c: Case): Case {
	if (c.pages === undefined || c.shots.length === 0) return c;
	const taken = new Set(c.shots.map((s) => pageKey(shotUrl(c, s))));
	const pages = casePages(c).filter((p) => taken.has(pageKey(p.url)));
	const first = pages[0];
	if (first === undefined) return c;
	if (samePage(first.url, c.page.url)) return { ...c, pages };
	// A screenshot that names no page is of the page that leaves: it says so
	// before `page` becomes another one, or it would move with it.
	const shots = c.shots.map((s) =>
		s.url === undefined ? { ...s, url: c.page.url } : s,
	);
	const shot = shots.find((s) => samePage(s.url ?? "", first.url));
	return {
		...c,
		shots,
		pages,
		page: {
			...c.page,
			url: first.url,
			title: first.title,
			lang: first.lang,
			...(shot === undefined ? {} : { viewport: shot.viewport }),
		},
	};
}

/**
 * A case as it comes in from elsewhere (a file, the team), with `page`, the
 * list and the screenshots agreeing (DEC-038): every screenshot names its
 * page (one that did not is of `page`), `page` is the first of the list, and
 * a page is there once. Nothing checks this in a file, and what follows
 * (counts per page, "Open the page", a delete) relies on it.
 */
export function withPagesAgreed(c: Case): Case {
	const shots = c.shots.some((s) => s.url === undefined)
		? c.shots.map((s) => (s.url === undefined ? { ...s, url: c.page.url } : s))
		: c.shots;
	if (c.pages === undefined) return shots === c.shots ? c : { ...c, shots };
	const own = c.pages.find((p) => samePage(p.url, c.page.url)) ?? {
		url: c.page.url,
		title: c.page.title,
		lang: c.page.lang,
	};
	const pages = casePages({ ...c, shots: [], pages: [own, ...c.pages] });
	return { ...c, shots, pages };
}

/**
 * The window a mark of the page at `url` was made in: that of the first
 * screenshot of the page there (`pageInFront`), else of the case's first
 * page (DEC-038).
 */
export function viewportAt(c: Case, url: string | undefined): Viewport {
	const page = url ? pageInFront(c, url) : undefined;
	const shot =
		page === undefined
			? undefined
			: c.shots.find((s) => samePage(shotUrl(c, s), page.url));
	return shot?.viewport ?? c.page.viewport;
}

/**
 * The page of the case whose marks are drawn on the page at `url`
 * (DEC-050): by path and hash route, whatever the host (`pathKey`); of two
 * that both are (two sites' home pages), the one on the same site.
 */
export function pageInFront(c: Case, url: string): CasePage | undefined {
	const pages = casePages(c);
	return (
		pages.find((p) => exactPage(p.url, url)) ??
		pages.find((p) => samePath(p.url, url))
	);
}

/**
 * Whether the mark `a` is a mark of the page at `url`, for drawing and for
 * what a draw found (DEC-050): its page is the one `pageInFront` picks. So
 * of two sites' home pages in one case, on either site only that site's
 * marks are the page's own; on a third host, the first listed page's.
 * Everything that asks "is this mark on the page in front?" asks this.
 */
export function onPageInFront(c: Case, a: Mark, url: string): boolean {
	const page = pageInFront(c, url);
	return page !== undefined && samePage(page.url, markUrl(c, a));
}

/**
 * Home offers the case under "This page" (DEC-050): one of its screenshots
 * was taken on the same page of the same site (`exactPage`); a case with no
 * screenshot yet, on its page. Nothing else: no other host, no title.
 */
export function isOfferedOn(c: Case, url: string): boolean {
	if (c.shots.length === 0) return exactPage(c.page.url, url);
	return c.shots.some((s) => exactPage(shotUrl(c, s), url));
}

/** The address a mark was made on, with its query: what opens it again (DEC-050). */
export function markAddress(c: Case, a: Mark): string {
	const shot = c.shots.find((s) => s.id === a.shot);
	return withQuery(shotUrl(c, shot), shot?.query);
}

/** A screenshot's address with its query (DEC-050). */
export const shotAddress = (c: Case, shot: Shot): string =>
	withQuery(shotUrl(c, shot), shot.query);

/** A shot's `query` as a file or the team gives it: kept, or none (`storedQuery`). */
export function queryField(value: unknown): { query?: string } {
	const query = storedQuery(value);
	return query === undefined ? {} : { query };
}

/** A web page's address, one a click may open (an imported case's is anyone's). */
export function isWebPage(url: string): boolean {
	try {
		const { protocol } = new URL(url);
		return protocol === "https:" || protocol === "http:";
	} catch {
		return false;
	}
}

/** Move a shape by `dx`, `dy`. */
export function translateShape(shape: Shape, dx: number, dy: number): Shape {
	const p = (q: Point): Point => ({ x: q.x + dx, y: q.y + dy });
	const r = (q: Rect): Rect => ({ ...q, x: q.x + dx, y: q.y + dy });
	switch (shape.kind) {
		case "element":
		case "box":
			return { kind: shape.kind, rect: r(shape.rect) };
		case "note":
			return { kind: "note", at: p(shape.at) };
		case "arrow":
			return { kind: "arrow", from: p(shape.from), to: p(shape.to) };
		case "pen":
			return { kind: "pen", points: shape.points.map(p) };
		case "unknown":
			return shape;
	}
}

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
	const o = obj(value, "case");
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
			...findingsOf(a["findings"], `${p}.findings`),
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

/**
 * The resolution a reopen ended, its note cut to a reopen note's length:
 * twenty of them stay per mark, and a mark's history is bounded, or a case
 * outgrows what a file may hold.
 */
function cutWas(was: Resolution): Resolution {
	return was.note && was.note.length > MAX_REOPEN_NOTE
		? { ...was, note: cutText(was.note, MAX_REOPEN_NOTE) }
		: was;
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

/** A mark's findings; none, or an empty list: no `findings` at all. */
function findingsOf(value: unknown, path: string): { findings?: Finding[] } {
	if (value === undefined) return {};
	const ids = new Set<string>();
	const findings = arr(value, path, MAX_FINDINGS).map((v, i): Finding => {
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

// --- findings of AI apps on a mark (DEC-019) ---------------------------------

const withFindings = (a: Mark, findings: Finding[]): Mark => {
	const { findings: _, ...rest } = a;
	return findings.length > 0 ? { ...rest, findings } : rest;
};

/** The finding text of all the case's marks, in characters. */
export const findingsTextOf = (c: Case): number =>
	c.marks.reduce(
		(n, a) => (a.findings ?? []).reduce((m, f) => m + textLength(f.text), n),
		0,
	);

/**
 * `next`, unless it holds more finding text than `MAX_FINDINGS_TEXT` and more
 * than `before` did: a case from a file over the limit may still shrink.
 */
function withinFindingsText(before: Case, next: Case): Case {
	const total = findingsTextOf(next);
	if (total > MAX_FINDINGS_TEXT && total > findingsTextOf(before))
		throw new CaseError(
			`The case holds too much finding text: at most ${MAX_FINDINGS_TEXT} characters on all marks together. Shorten or delete findings of your own first.`,
		);
	return next;
}

function findingOf(a: Mark, findingId: string): Finding {
	const f = a.findings?.find((x) => x.id === findingId);
	if (f === undefined)
		throw new CaseError(`Mark ${a.number} has no finding ${findingId}.`);
	return f;
}

/** The case with `finding` added to the mark, after its others. */
export function withFinding(
	c: Case,
	markId: string,
	finding: Finding,
	now: string,
): Case {
	const next = changed(
		c,
		markId,
		(a) => {
			const findings = a.findings ?? [];
			if (findings.length >= MAX_FINDINGS)
				throw new CaseError(
					`Mark ${a.number} has ${MAX_FINDINGS} findings, the most a mark may have. Edit or delete one of your own instead.`,
				);
			return withFindings(a, [
				...findings,
				{ ...finding, text: cutText(finding.text.trim(), MAX_FINDING) },
			]);
		},
		now,
	);
	return withinFindingsText(c, next);
}

/** The case with the finding's text replaced; `editedAt` is `now`. */
export function withFindingText(
	c: Case,
	markId: string,
	findingId: string,
	text: string,
	now: string,
): Case {
	const next = changed(
		c,
		markId,
		(a) => {
			findingOf(a, findingId);
			return withFindings(
				a,
				(a.findings ?? []).map((f) =>
					f.id === findingId
						? { ...f, text: cutText(text.trim(), MAX_FINDING), editedAt: now }
						: f,
				),
			);
		},
		now,
	);
	return withinFindingsText(c, next);
}

/** The case without the finding. */
export function withoutFinding(
	c: Case,
	markId: string,
	findingId: string,
	now: string,
): Case {
	return changed(
		c,
		markId,
		(a) => {
			findingOf(a, findingId);
			return withFindings(
				a,
				(a.findings ?? []).filter((f) => f.id !== findingId),
			);
		},
		now,
	);
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
 * What can change of a mark (its comment, author, status, reopens, findings
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
		a.findings ?? [],
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
