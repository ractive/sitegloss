/**
 * `src/lib/case.ts` as Sitegloss 0.3.0 shipped it (commit 7b00a15), kept for
 * what 0.3.0 makes of a file this build writes (it refuses `sitegloss/2`,
 * DEC-051) and for cases as 0.3.0 stores them (`test/store.test.ts`). Not
 * edited; below this comment it is that file, with 0.3.0's names.
 */

/**
 * The case format `sitegloss/1` (see kb/design/overview.md): the same JSON in
 * IndexedDB and in an export. Images are referenced by paths relative to the
 * case (`shots/s1.webp`, `crops/a1.webp`).
 */

export const CASE_FORMAT = "sitegloss/1";

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

/** The highest annotation number a case may use. */
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

/** The most points a freehand mark may have. */
export const MAX_PEN_POINTS = 5000;

/** The longest page address a case may hold. */
export const MAX_URL = 8000;

/** The longest page title a case may hold. */
export const MAX_PAGE_TITLE = 2000;

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
export type Shape =
	| { kind: "element"; rect: Rect }
	| { kind: "box"; rect: Rect }
	| { kind: "arrow"; from: Point; to: Point }
	| { kind: "pen"; points: Point[] }
	| { kind: "note"; at: Point };

export type ShapeKind = Shape["kind"];

/** What Sitegloss knows about an annotation's element (see element.ts). */
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
	/** The nearest heading before the element. */
	heading?: string;
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
}

export interface Shot {
	id: string;
	/** `shots/<id>.webp` */
	image: string;
	scrollX: number;
	scrollY: number;
	viewport: Viewport;
	capturedAt: string;
	/** The page's address when it was taken; a case can span an app's routes. */
	url?: string;
}

export interface Annotation {
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
}

/** An AI app as the panel and the questions name it: its name beside its host. */
export function appLabel(app: FindingApp): string {
	return app.name ? `${app.name} (${app.host})` : app.host;
}

/** A finding the AI app `clientId` wrote here, not one from a file. */
export function isOwnFinding(f: Finding, clientId: string): boolean {
	return f.imported !== true && f.app.id === clientId;
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
}

export interface Verification {
	at: string;
	/** The AI app that set it through a tool; none: set in the panel. */
	app?: FindingApp;
	/** Came in from a file. */
	imported?: true;
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

export const markStatus = (a: Annotation): MarkStatus =>
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
	"closed",
] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

export const GROUP_OF: Record<MarkStatus, StatusGroup> = {
	open: "open",
	fixed: "toVerify",
	verified: "verified",
	wontfix: "closed",
	cantreproduce: "closed",
};

export const GROUP_LABEL: Record<StatusGroup, string> = {
	open: "Open",
	toVerify: "To verify",
	verified: "Verified",
	closed: "Closed",
};

export type CaseCounts = Record<StatusGroup, number>;

/** How many marks are open, to verify, verified and closed. */
export function caseCounts(c: Case): CaseCounts {
	const counts: CaseCounts = { open: 0, toVerify: 0, verified: 0, closed: 0 };
	for (const a of c.annotations) counts[GROUP_OF[markStatus(a)]]++;
	return counts;
}

export interface PageInfo {
	url: string;
	title: string;
	lang: string;
	viewport: Viewport;
	userAgent: string;
}

export interface Case {
	format: typeof CASE_FORMAT;
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	page: PageInfo;
	shots: Shot[];
	annotations: Annotation[];
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
}

/** The longest case title. */
export const MAX_TITLE = 500;

/** The longest link a case may carry (DEC-028). */
export const MAX_LINK = 2048;

/**
 * The most marks and screenshots a case holds. Marks added one by one have a
 * screenshot each (DEC-014), so there can be as many shots as marks.
 */
export const MAX_ANNOTATIONS = 1000;
export const MAX_SHOTS = MAX_ANNOTATIONS;

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
export const cropImage = (annotationId: string) => `crops/${annotationId}.webp`;
/** A screenshot taken for a save that is not committed yet (save.ts). */
export const pendingImage = (shotId: string) => `pending/${shotId}.webp`;

/** The paths of all images a case references (its screenshots and crops). */
export function caseImages(c: Case): Set<string> {
	return new Set([
		...c.shots.map((s) => s.image),
		...c.annotations.map((a) => a.crop),
	]);
}

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
const hashRoute = (hash: string) => /^#!?\/[^?#&=]*/.exec(hash)?.[0] ?? "";

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

/** The next annotation number and shot number of a case. */
export function nextNumbers(c: Case | undefined): {
	annotation: number;
	shot: number;
} {
	if (c === undefined) return { annotation: 1, shot: 1 };
	const max = (values: number[]) => values.reduce((a, b) => Math.max(a, b), 0);
	return {
		annotation:
			max([...c.annotations.map((a) => a.number), c.lastNumber ?? 0]) + 1,
		shot: max(c.shots.map((s) => Number(s.id.slice(1)) || 0)) + 1,
	};
}

/** The smallest rectangle around a shape. */
export function shapeBounds(shape: Shape): Rect {
	switch (shape.kind) {
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
	}
}

/**
 * The same page, whatever the origin: a case from prod "belongs" to localhost
 * too. A hash route names a page; a plain `#section` does not.
 */
export function samePath(a: string, b: string): boolean {
	const page = (href: string) => {
		const { pathname, hash } = new URL(href);
		return `${pathname.replace(/\/+$/, "") || "/"}${hashRoute(hash)}`;
	};
	try {
		return page(a) === page(b);
	} catch {
		return false;
	}
}

/**
 * The case is for `url`, sure enough to load it without a click: every site's
 * home page has the same path.
 */
export function isPageOf(c: Case, url: string): boolean {
	return isPageUrl(c.page.url, url);
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

/** `isPageOf` for a case's page address. */
export function isPageUrl(caseUrl: string, url: string): boolean {
	if (!samePath(caseUrl, url)) return false;
	try {
		const { origin, pathname } = new URL(url);
		return pathname !== "/" || origin === new URL(caseUrl).origin;
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
		default:
			fail(`${path}.kind`, "unknown shape");
	}
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
	return out as unknown as ElementDetails;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHOT_ID = /^s[1-9]\d{0,5}$/;

/** Ids of cases, shots and annotations: safe in image paths and keys. */
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

/** Check that `value` is a case in format `sitegloss/1` and return it typed. */
export function validateCase(value: unknown): Case {
	const o = obj(value, "case");
	const format = o["format"];
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
			id: shotId,
			image,
			scrollX: num(s["scrollX"], `case.shots[${i}].scrollX`),
			scrollY: num(s["scrollY"], `case.shots[${i}].scrollY`),
			viewport: viewport(s["viewport"], `case.shots[${i}].viewport`),
			capturedAt: str(s["capturedAt"], `case.shots[${i}].capturedAt`, 64),
			...(s["url"] === undefined
				? {}
				: { url: str(s["url"], `case.shots[${i}].url`, MAX_URL) }),
		};
	});
	const numbers = new Set<number>();
	const ids = new Set<string>();
	const annotations = arr(
		o["annotations"],
		"case.annotations",
		MAX_ANNOTATIONS,
	).map((v, i): Annotation => {
		const p = `case.annotations[${i}]`;
		const a = obj(v, p);
		const annotationId = id(a["id"], `${p}.id`);
		if (ids.has(annotationId)) fail(`${p}.id`, "is used twice");
		ids.add(annotationId);
		const number = num(a["number"], `${p}.number`);
		if (
			!Number.isInteger(number) ||
			number < 1 ||
			number > MAX_NUMBER ||
			numbers.has(number)
		)
			fail(`${p}.number`, `must be a unique integer from 1 to ${MAX_NUMBER}`);
		numbers.add(number);
		// Saving names new marks a<number>: another scheme would collide later.
		if (annotationId !== `a${number}`)
			fail(`${p}.id`, `must be a${number}, after its number`);
		const shot = str(a["shot"], `${p}.shot`, 64);
		if (!shotIds.has(shot)) fail(`${p}.shot`, "names no shot of the case");
		const crop = str(a["crop"], `${p}.crop`);
		if (crop !== cropImage(annotationId))
			fail(`${p}.crop`, `must be ${cropImage(annotationId)}`);
		const author = a["author"];
		if (author !== "user" && author !== "ai")
			fail(`${p}.author`, `must be "user" or "ai"`);
		return {
			id: annotationId,
			number,
			shot,
			comment: str(a["comment"], `${p}.comment`, MAX_COMMENT),
			author,
			shape: shape(a["shape"], `${p}.shape`),
			crop,
			element: element(a["element"], `${p}.element`),
			...(a["resolution"] === undefined
				? {}
				: { resolution: resolution(a["resolution"], `${p}.resolution`) }),
			...reopensOf(a["reopens"], `${p}.reopens`),
			...findingsOf(a["findings"], `${p}.findings`),
		};
	});
	const verdict = o["verdict"];
	const importedAt = o["importedAt"];
	const lastNumber = o["lastNumber"];
	const link = o["link"];
	return {
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
		shots,
		annotations,
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
			: { lastNumber: highest(lastNumber, annotations) }),
	};
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
	};
}

function verification(value: unknown, path: string): Verification {
	const o = obj(value, path);
	return {
		at: str(o["at"], `${path}.at`, 64),
		...appOf(o["app"], `${path}.app`),
		...importedOf(o["imported"], `${path}.imported`),
	};
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
		};
	});
	return findings.length > 0 ? { findings } : {};
}

function highest(value: unknown, annotations: readonly Annotation[]): number {
	const n = num(value, "case.lastNumber");
	if (
		!Number.isInteger(n) ||
		n > MAX_NUMBER ||
		annotations.some((a) => a.number > n)
	)
		fail(
			"case.lastNumber",
			"must be an integer no lower than any mark's number",
		);
	return n;
}

// --- changes to one mark ------------------------------------------------------

function changed(
	c: Case,
	annotationId: string,
	change: (a: Annotation) => Annotation,
	now: string,
): Case {
	if (!c.annotations.some((a) => a.id === annotationId))
		throw new CaseError("The mark no longer exists.");
	return {
		...c,
		annotations: c.annotations.map((a) =>
			a.id === annotationId ? change(a) : a,
		),
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
	annotationId: string,
	change: ResolutionChange,
	now: string,
): Case {
	return changed(
		c,
		annotationId,
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
	annotationId: string,
	choice: ResolveChoice,
	note: string,
	now: string,
): Case {
	const r = c.annotations.find((x) => x.id === annotationId)?.resolution;
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
			annotationId,
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
	return withResolution(
		c,
		annotationId,
		{ ...resolutionFor(choice), note },
		now,
	);
}

/**
 * The case with the mark's fix verified. Only a fixed mark can be; one that
 * is verified already stays as it was.
 */
export function withVerified(
	c: Case,
	annotationId: string,
	app: FindingApp | undefined,
	now: string,
): Case {
	const a = c.annotations.find((x) => x.id === annotationId);
	if (a?.resolution?.verified) return c;
	return changed(
		c,
		annotationId,
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
	annotationId: string,
	reopen: {
		note?: string;
		app?: FindingApp;
		/** The panel's: a note typed for a mark opened meanwhile is not lost unsaid. */
		refuseOpen?: boolean;
	},
	now: string,
): Case {
	const a = c.annotations.find((x) => x.id === annotationId);
	if (a !== undefined && a.resolution === undefined) {
		if (reopen.refuseOpen)
			throw new CaseError(
				`Mark ${a.number} is open already: it was reopened meanwhile. Your note is not saved; add it to the comment, or Cancel.`,
			);
		return c;
	}
	return changed(
		c,
		annotationId,
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
	);
}

export function withComment(
	c: Case,
	annotationId: string,
	comment: string,
	now: string,
): Case {
	return changed(
		c,
		annotationId,
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
 * The case without the mark, and the images that go with it: its crop, and its
 * screenshot when no other mark is on it.
 */
export function withoutAnnotation(
	c: Case,
	annotationId: string,
	now: string,
): { value: Case; images: string[] } {
	const gone = c.annotations.find((a) => a.id === annotationId);
	if (gone === undefined) throw new CaseError("The mark no longer exists.");
	const annotations = c.annotations.filter((a) => a.id !== annotationId);
	const shotUsed = annotations.some((a) => a.shot === gone.shot);
	const shot = c.shots.find((s) => s.id === gone.shot);
	return {
		value: {
			...c,
			annotations,
			shots: shotUsed ? c.shots : c.shots.filter((s) => s.id !== gone.shot),
			lastNumber: Math.max(
				c.lastNumber ?? 0,
				...c.annotations.map((a) => a.number),
			),
			updatedAt: now,
		},
		images: [
			gone.crop,
			...(shotUsed || shot === undefined ? [] : [shot.image]),
		],
	};
}

// --- findings of AI apps on a mark (DEC-019) ---------------------------------

const withFindings = (a: Annotation, findings: Finding[]): Annotation => {
	const { findings: _, ...rest } = a;
	return findings.length > 0 ? { ...rest, findings } : rest;
};

/** The finding text of all the case's marks, in characters. */
export const findingsTextOf = (c: Case): number =>
	c.annotations.reduce(
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

function findingOf(a: Annotation, findingId: string): Finding {
	const f = a.findings?.find((x) => x.id === findingId);
	if (f === undefined)
		throw new CaseError(`Mark ${a.number} has no finding ${findingId}.`);
	return f;
}

/** The case with `finding` added to the mark, after its others. */
export function withFinding(
	c: Case,
	annotationId: string,
	finding: Finding,
	now: string,
): Case {
	const next = changed(
		c,
		annotationId,
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
	annotationId: string,
	findingId: string,
	text: string,
	now: string,
): Case {
	const next = changed(
		c,
		annotationId,
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
	annotationId: string,
	findingId: string,
	now: string,
): Case {
	return changed(
		c,
		annotationId,
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
