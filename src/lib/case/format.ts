/**
 * The case format `sitegloss/2` (see kb/design/overview.md): the same JSON in
 * IndexedDB and in an export. Images are referenced by paths relative to the
 * case (`shots/s1.webp`, `crops/m1.webp`, `images/i_….webp`). Its types,
 * limits, ids, image paths, statuses and shapes.
 */

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

/**
 * The longest finding and the most a mark had (DEC-019), for reading the
 * findings of a stored case or a file: they become comments (DEC-081).
 */
export const MAX_FINDING = 5000;
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
	/**
	 * Findings from before DEC-081 that did not fit the thread yet (its
	 * `MAX_CASE_COMMENTS`), exactly as they were: they become comments on
	 * this mark once there is room (`findingsAsComments`). Never shown, sent
	 * or changed.
	 */
	findings?: unknown[];
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
 * A finding of an AI app on a mark, as a stored case or a file from before
 * DEC-081 holds it (DEC-019): it is read only to become a comment on the
 * mark (`findingsAsComments`).
 */
export interface OldFinding {
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
