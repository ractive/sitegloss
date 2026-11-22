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
	/** Which mark of which case, and what this picture is. */
	caption: string;
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
	const of = `Mark ${a.number} of “${c.title}”`;
	const added = a.images ?? [];
	const held = a.heldImages ?? [];
	return [
		{
			id: "screenshot",
			path: a.crop,
			caption: `${of}: the screenshot Sitegloss took`,
			alt: `Screenshot of mark ${a.number}`,
		},
		...[...added, ...held].map((image, i) => {
			const n = i + 1;
			const who = image.added.imported
				? "from an imported file"
				: (() => {
						const name = byline(image.added.user, image.added.app);
						return name ? `added by ${name}` : "added";
					})();
			const waiting = i >= added.length ? ", not sent yet" : "";
			return {
				id: image.id,
				path: image.image,
				caption: `${of}: image ${n}, ${who} on ${day(image.added.at)}${waiting}`,
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

/** The viewer's address for a mark's picture: an extension page, never the web page. */
export const viewerPath = (caseId: string, markId: string, pictureId: string) =>
	`viewer/index.html?${new URLSearchParams({ case: caseId, mark: markId, picture: pictureId })}`;
