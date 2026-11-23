/**
 * Turning what the content script drew into a stored case (service worker).
 *
 * The content script captures each screenshot under a pending path of its
 * own (`pending/<shot>.webp`), so a save can never overwrite an image another
 * case version references. Saving draws the marks and cuts the crops (slow,
 * outside any transaction), then commits in one transaction against the case
 * as it is stored at that moment: the shots get their final ids, the marks'
 * numbers are checked against the stored ones, and the case and its images are
 * written together. A verdict saved or marks added meanwhile are kept.
 */

import { PANEL } from "./browser.ts";
import {
	CASE_FORMAT,
	type Case,
	type CasePage,
	caseExtras,
	casePages,
	cropImage,
	type FindingApp,
	MAX_MARKS,
	MAX_PAGES,
	MAX_SHOTS,
	type Mark,
	markIdOf,
	nextNumbers,
	type PageInfo,
	pageKey,
	pendingImage,
	plainUrl,
	type Rect,
	type Shot,
	samePage,
	shotImage,
	validateCase,
	withPagesOfShots,
} from "./case.ts";
import { isDarkGround, type RenderedMark } from "./marks.ts";
import { queryOf } from "./query.ts";
import type { CaseStore, StoredImage } from "./store.ts";

/** A mark as the content script sends it: with the crop's rectangle. */
export type MarkDraft = Omit<Mark, "crop"> & { cropRect: Rect };

export interface SaveRequest {
	caseId: string;
	/** `false`: add to the existing case `caseId`. */
	isNew: boolean;
	title: string;
	page: PageInfo;
	/**
	 * New shots with provisional ids; their images are stored under
	 * `pendingImage(id)`. The saved case gives them their final ids.
	 */
	shots: Shot[];
	marks: MarkDraft[];
	/** The id the pending screenshots are stored under, when not `caseId`. */
	imagesFrom?: string;
	/**
	 * The pending screenshots stay after the save: the toolbar adds a case's
	 * marks one by one, and the next mark on the same view shares its picture.
	 * The toolbar discards them once no mark needs them.
	 */
	keepPending?: boolean;
	/**
	 * Sent by the content script (`fromPage`): its numbers may not run far
	 * above the case's next one. Set by the worker, whatever the page says.
	 */
	fromPage?: boolean;
	/**
	 * Marks of the case on the same view, drawn on the new shot under the new
	 * marks: the screenshot shows what the user saw, as one save would. Only
	 * marks numbered below the new ones are drawn: Undo, which takes the
	 * highest number out, then never leaves a pin of its mark behind.
	 */
	alsoDrawn?: (RenderedMark & { shot: string })[];
}

/**
 * How far above the case's next number (and one more for each further mark
 * of the save) a mark from the page may be numbered. The toolbar numbers its
 * drafts on from the next number, and a draft taken out before it was added
 * leaves its number unused; nothing else leaves a gap. A number chosen at
 * will (99999) would end the case's numbers for good: a deleted mark's
 * number is never given again (DEC-014).
 */
export const MAX_NUMBER_GAP = 100;

/**
 * A save the content script sent (`case:save`): its marks are the user's,
 * whatever the draft says. Only an AI app's `add_mark`, in the worker,
 * stores a mark of an AI app (CR-07). A page adds to a case and makes none:
 * the side panel creates every case (DEC-026).
 */
export function fromPage(request: SaveRequest): SaveRequest {
	if (request.isNew)
		throw new SaveError(
			`a page adds marks to an existing case; the ${PANEL} creates cases.`,
		);
	return {
		...request,
		fromPage: true,
		marks: request.marks.map((a) => ({ ...a, author: "user" })),
	};
}

/** The most marks drawn on a screenshot besides its own (`alsoDrawn`). */
export const MAX_ALSO_DRAWN = 100;

/** Cut several crops from one screenshot. */
export type Crop = (
	image: Blob,
	rects: readonly Rect[],
	dpr: number,
) => Promise<StoredImage[]>;

/** A screenshot with marks drawn on it. */
export type Draw = (
	image: Blob,
	marks: readonly RenderedMark[],
	dpr: number,
) => Promise<StoredImage>;

export class SaveError extends Error {
	override name = "SaveError";
}

/**
 * Write the crops and the case, then remove the pending screenshots. A save
 * that fails keeps them: the marks they belong to can be saved again. `draw`
 * puts the marks on screenshots that were taken without them.
 */
export async function saveCase(
	store: CaseStore,
	request: SaveRequest,
	crop: Crop,
	now: Date = new Date(),
	draw?: Draw,
	/**
	 * The AI app that adds the marks through this browser's AI connection
	 * (DEC-046): each new mark is made through it, and what is sent of the
	 * case names it. Only the worker's own tools give it; a page's draft
	 * cannot.
	 */
	app?: FindingApp,
): Promise<Case> {
	const from = request.imagesFrom ?? request.caseId;
	// Said plainly before the slow part, rather than by validateCase after it.
	if (!request.isNew) {
		const c = await store.getCase(request.caseId);
		if (c !== undefined) checkRoom(c, request);
	}
	const lowest = Math.min(...request.marks.map((a) => a.number));
	const screenshots = new Map<string, StoredImage>();
	const crops = new Map<MarkDraft, StoredImage>();
	for (const shot of request.shots) {
		const stored = await store.getImage(from, pendingImage(shot.id));
		if (stored === undefined)
			throw new SaveError(`the screenshot ${shot.id} is missing`);
		const drafts = request.marks.filter((a) => a.shot === shot.id);
		const others = (request.alsoDrawn ?? [])
			.slice(0, MAX_ALSO_DRAWN)
			.filter((m) => m.shot === shot.id && m.number < lowest);
		const image = draw
			? await draw(
					stored.blob,
					[...others, ...drafts.map(drawnOf)],
					shot.viewport.dpr,
				)
			: stored;
		screenshots.set(shot.id, image);
		const cut = await crop(
			image.blob,
			drafts.map((d) => d.cropRect),
			shot.viewport.dpr,
		);
		drafts.forEach((d, i) => {
			const c = cut[i];
			if (c !== undefined) crops.set(d, c);
		});
	}
	for (const draft of request.marks) {
		if (!crops.has(draft))
			throw new SaveError(`mark ${draft.number} names no new screenshot`);
	}
	const stamp = now.toISOString();
	const saved = await store.updateCase(request.caseId, (current) => {
		if (request.isNew && current !== undefined)
			throw new SaveError("A case with this id exists already.");
		if (!request.isNew && current === undefined)
			throw new SaveError("The case no longer exists.");
		if (current !== undefined) checkRoom(current, request);
		const images = new Map<string, StoredImage>();
		const finalIds = new Map<string, string>();
		const shots = [...(current?.shots ?? [])];
		// The first mark's page is the case's (review of PR 57): a case
		// "New case for this page" made has the page as it was at that click,
		// and the window or the route may have changed before the mark.
		const started = current !== undefined && current.shots.length > 0;
		const here = { ...request.page, url: plainUrl(request.page.url) };
		// A mark on another page adds that page to the case (DEC-038).
		const pages: CasePage[] = started ? casePages(current) : [];
		let shotNumber = nextNumbers(current).shot;
		for (const shot of request.shots) {
			const id = `s${shotNumber++}`;
			finalIds.set(shot.id, id);
			// Every screenshot says which page it is of, and keeps what may be
			// kept of its query, to open it again as it was (DEC-050): from
			// the address it was taken on, never from what a sender says.
			const { query: _sent, ...taken } = shot;
			const href = shot.url ?? request.page.url;
			const url = shot.url === undefined ? here.url : plainUrl(shot.url);
			const query = queryOf(href);
			shots.push({
				...taken,
				url,
				...(query === undefined ? {} : { query }),
				id,
				image: shotImage(id),
			});
			if (!pages.some((p) => samePage(p.url, url)))
				pages.push(
					// The page's title and language are those of the page the
					// marks were sent from, which is the screenshot's.
					samePage(url, here.url)
						? { url, title: here.title, lang: here.lang }
						: { url, title: "", lang: "" },
				);
			const image = screenshots.get(shot.id);
			if (image !== undefined)
				images.set(shotImage(id), {
					blob: image.blob,
					width: image.width,
					height: image.height,
				});
		}
		const taken = new Set(current?.marks.map((a) => a.number));
		const marks: Mark[] = [...(current?.marks ?? [])];
		const next = nextNumbers(current).mark;
		const highest = next + request.marks.length - 1 + MAX_NUMBER_GAP;
		for (const draft of request.marks) {
			if (request.fromPage && draft.number > highest)
				throw new SaveError(
					`mark ${draft.number} is far above the case's next number, ${next}: a mark from the page is numbered on from it.`,
				);
			// A deleted mark's number stays its own: its pin is on the screenshots.
			if (taken.has(draft.number) || draft.number <= (current?.lastNumber ?? 0))
				throw new SaveError(
					`mark ${draft.number} exists in the case already: the case changed meanwhile. Adding it again gives it the next free number.`,
				);
			taken.add(draft.number);
			const id = markIdOf(draft.number);
			// A new mark's fields, and nothing else of the draft: it is open and
			// has no findings, whatever the sender put in (CR-07).
			marks.push({
				id,
				number: draft.number,
				shot: finalIds.get(draft.shot) ?? draft.shot,
				comment: draft.comment,
				author: draft.author,
				shape: draft.shape,
				crop: cropImage(id),
				element: draft.element,
				...(draft.ends === undefined ? {} : { ends: draft.ends }),
				// The text it marks (DEC-066); `validateCase` holds it to the limits.
				...(draft.highlight === undefined
					? {}
					: { highlight: draft.highlight }),
				...(app === undefined ? {} : { createdVia: app }),
			});
			const image = crops.get(draft);
			if (image !== undefined) images.set(cropImage(id), image);
		}
		// In the order of their numbers, whatever order they went in: a mark
		// added again with "Add mark N" can come after a later one (DEC-014).
		marks.sort((a, b) => a.number - b.number);
		// The list is the pages the screenshots are of (`withPagesOfShots`): a
		// page that kept no mark (the first page of a case from before the
		// list stays when its last mark goes) is not written into it now.
		const value = withPagesOfShots(
			validateCase({
				// What a newer Sitegloss wrote on the case stays (DEC-066).
				...(current === undefined ? {} : caseExtras(current)),
				format: CASE_FORMAT,
				id: request.caseId,
				title: current?.title ?? (request.title.trim() || "Untitled case"),
				createdAt: current?.createdAt ?? stamp,
				updatedAt: stamp,
				page: started ? current.page : here,
				pages:
					pages.length > 0
						? pages
						: [{ url: here.url, title: here.title, lang: here.lang }],
				shots,
				marks,
				verdict: current?.verdict ?? null,
				link: current?.link,
				importedAt: current?.importedAt,
				// What else the case holds stays (DEC-046): its thread, who wrote
				// its summary. A new open mark opens a closed case, as the
				// server does with it.
				comments: current?.comments,
				summaryBy: current?.summaryBy,
				deletedVia: current?.deletedVia,
				// Made by an app's call: its making names the app (DEC-046).
				createdVia: current === undefined ? app : current.createdVia,
				...(app === undefined ? {} : { via: { app, at: stamp } }),
				// The highest number used, the new marks' too: a case's format
				// refuses a lastNumber below a mark's (it was kept as it was, so
				// a mark added after a delete or an Undo could not be stored).
				...(current?.lastNumber === undefined
					? {}
					: {
							lastNumber: Math.max(
								current.lastNumber,
								...marks.map((a) => a.number),
							),
						}),
			}),
		);
		return { value, images };
	});
	if (!request.keepPending)
		await store
			.deleteImages(
				from,
				request.shots.map((s) => pendingImage(s.id)),
			)
			.catch(() => undefined);
	return saved;
}

/** Whether a mark can take `number` in the case now, and the case's next number. */
export async function numberFree(
	store: CaseStore,
	caseId: string,
	number: number,
): Promise<{ free: boolean; next: number }> {
	const c = await store.getCase(caseId);
	if (c === undefined) throw new SaveError("The case no longer exists.");
	return {
		free:
			number > (c.lastNumber ?? 0) && !c.marks.some((a) => a.number === number),
		next: nextNumbers(c).mark,
	};
}

/** How long after its screenshot the toolbar's Undo may take a mark out again. */
export const UNDO_WINDOW_MS = 24 * 60 * 60_000;

/** What the toolbar's add stored, as the worker recorded it (undo.ts). */
export interface AddedAs {
	shot: string;
	comment: string;
}

/**
 * Undo in the toolbar: take out the mark it just added, with its crop and its
 * screenshot. The worker allows it only for a mark this page added (undo.ts);
 * here the mark must still be as that add stored it (not resolved, its comment
 * not edited), the user's, the highest number in the case, on a screenshot of
 * its own taken lately. Its pin was on that screenshot only, which goes with
 * it, so its number is free again (unlike a delete, DEC-014). `lastNumber`
 * is set to the highest number left (0 for none): a case that has had a mark
 * is never untouched again (DEC-026).
 * `removed: false`: it was gone already (deleted in the side panel).
 */
export async function undoAdd(
	store: CaseStore,
	caseId: string,
	markId: string,
	added: AddedAs,
	now: Date = new Date(),
): Promise<{ removed: boolean; next: number }> {
	let removed = false;
	const saved = await store.updateCase(caseId, (current) => {
		if (current === undefined)
			throw new SaveError("The case no longer exists.");
		const gone = current.marks.find((a) => a.id === markId);
		if (gone === undefined) return { value: current };
		const refuse = (why: string) =>
			new SaveError(
				`mark ${gone.number} ${why}; delete it in the ${PANEL} if it should go.`,
			);
		if (gone.resolution !== undefined || gone.reopens !== undefined)
			throw refuse("was resolved since");
		if (gone.comment !== added.comment || gone.author !== "user")
			throw refuse("was edited since");
		if (current.marks.some((a) => a.number > gone.number))
			throw refuse("has marks after it");
		const shot = current.shots.find((s) => s.id === gone.shot);
		const shared = current.marks.some(
			(a) => a !== gone && a.shot === gone.shot,
		);
		const age = now.getTime() - Date.parse(shot?.capturedAt ?? "");
		if (
			shot === undefined ||
			gone.shot !== added.shot ||
			shared ||
			!(age >= 0 && age < UNDO_WINDOW_MS)
		)
			throw refuse("cannot be undone here");
		removed = true;
		const marks = current.marks.filter((a) => a !== gone);
		// The page of the screenshot that goes leaves the case with it, when
		// it was its only one (DEC-038).
		const value = validateCase(
			withPagesOfShots({
				...current,
				marks,
				shots: current.shots.filter((s) => s !== shot),
				// A mark was stored, so the case is the user's (DEC-026, review of
				// PR 57): `lastNumber` says so, set below the freed number so that
				// the number is free again. A case with no mark left gets 0.
				lastNumber: Math.max(
					current.lastNumber ?? 0,
					...marks.map((a) => a.number),
				),
				updatedAt: now.toISOString(),
			}),
		);
		return { value, deleteImages: [gone.crop, shot.image] };
	});
	return { removed, next: nextNumbers(saved).mark };
}

/** The case can take the request's marks and screenshots, or says why not. */
function checkRoom(c: Case, request: SaveRequest): void {
	const full =
		c.shots.length + request.shots.length > MAX_SHOTS
			? `${MAX_SHOTS} screenshots`
			: c.marks.length + request.marks.length > MAX_MARKS
				? `${MAX_MARKS} marks`
				: undefined;
	if (full !== undefined)
		throw new SaveError(
			`“${c.title}” holds ${full}, the most a case can; start a new case for further marks.`,
		);
	// The pages too (DEC-038): said here, before anything is stored, and not
	// by the format's check after it.
	const pages = new Set(casePages(c).map((p) => pageKey(p.url)));
	for (const shot of request.shots)
		pages.add(pageKey(plainUrl(shot.url ?? request.page.url)));
	if (pages.size > MAX_PAGES)
		throw new SaveError(
			`“${c.title}” holds marks on ${MAX_PAGES} pages, the most a case can; start a new case for marks on further pages.`,
		);
}

/**
 * A new mark as it is painted on its screenshot: a highlight as its strokes
 * (DEC-066), on a dark ground where its element's backdrop is dark.
 */
export function drawnOf(d: MarkDraft): RenderedMark {
	return {
		number: d.number,
		shape: d.shape,
		...(d.highlight === undefined
			? {}
			: {
					lines: d.highlight.rects,
					dark: isDarkGround(d.element?.backdrop?.color),
				}),
	};
}

/** A rectangle grown by `pad` and kept inside the viewport. */
export function cropRectFor(
	bounds: Rect,
	viewport: { width: number; height: number },
): Rect {
	const pad = bounds.width === 0 && bounds.height === 0 ? 120 : 40;
	const x = Math.max(0, bounds.x - pad);
	const y = Math.max(0, bounds.y - pad);
	return {
		x,
		y,
		width: Math.max(
			1,
			Math.min(viewport.width, bounds.x + bounds.width + pad) - x,
		),
		height: Math.max(
			1,
			Math.min(viewport.height, bounds.y + bounds.height + pad) - y,
		),
	};
}
