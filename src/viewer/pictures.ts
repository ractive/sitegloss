/**
 * The pictures of one mark as the viewer shows them (DEC-060): its own
 * screenshot first, then the images a person added, oldest first, then
 * those held back on this device; each with its caption.
 */

import { byline, type Case, type Mark } from "../lib/case.ts";

export interface ViewerPicture {
	/** "screenshot", or the added image's id. */
	id: string;
	/** Its path in the case's images. */
	path: string;
	/** Which case, which mark, which picture: «Checkout» · Mark 3 · Image 1 of 2. */
	title: string;
	/** Who and when: "Added by Dana, 22 Nov 2026". */
	detail: string;
	/** For the image itself, said by a screen reader. */
	alt: string;
}

/** "22 Nov 2026" in the browser's language. */
const day = (iso: string) => {
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? iso
		: d.toLocaleDateString(undefined, {
				day: "numeric",
				month: "short",
				year: "numeric",
			});
};

/** The pictures of mark `markId` of `c`; none for a mark that is not there. */
export function markPictures(c: Case, markId: string): ViewerPicture[] {
	const a: Mark | undefined = c.marks.find((m) => m.id === markId);
	if (a === undefined) return [];
	const of = `“${c.title}” · Mark ${a.number}`;
	const added = a.images ?? [];
	const held = a.heldImages ?? [];
	const all = [...added, ...held];
	const shot = c.shots.find((s) => s.id === a.shot);
	return [
		{
			id: "screenshot",
			path: a.crop,
			title: `${of} · Screenshot`,
			detail: `Taken by Sitegloss${shot ? `, ${day(shot.capturedAt)}` : ""}`,
			alt: `Screenshot of mark ${a.number}`,
		},
		...all.map((image, i) => {
			const n = i + 1;
			const name = byline(image.added.user, image.added.app);
			const who = image.added.imported
				? "From an imported file"
				: name
					? `Added by ${name}`
					: "Added";
			const waiting = i >= added.length ? "; not sent yet" : "";
			return {
				id: image.id,
				path: image.image,
				title: `${of} · Image ${n} of ${all.length}`,
				detail: `${who}, ${day(image.added.at)}${waiting}`,
				alt: `Image ${n} of mark ${a.number}`,
			};
		}),
	];
}

/** Where the picture `id` is in `list`; the first when it is not there. */
export const pictureIndex = (list: readonly ViewerPicture[], id: string) =>
	Math.max(
		0,
		list.findIndex((p) => p.id === id),
	);

/** What the viewer over the page is to show, handed over its port (DEC-064). */
export interface ViewerInit {
	caseId: string;
	markId: string;
	pictureId: string;
}

/** The viewer's address for a mark's picture: an extension page, never the web page. */
export const viewerPath = (caseId: string, markId: string, pictureId: string) =>
	`viewer/index.html?${new URLSearchParams({ case: caseId, mark: markId, picture: pictureId })}`;
