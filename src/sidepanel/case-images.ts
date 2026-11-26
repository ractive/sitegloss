/**
 * The open case's images as object URLs, kept across its edits: an edit
 * reads only the images that are new or changed, and lets go of the ones
 * the case no longer has.
 */

import type { Case } from "../lib/case.ts";
import type { CaseImages } from "./state.ts";

/**
 * What the image under each of the case's paths is: a path whose picture
 * may have changed gets another key. A path alone does not say it: the
 * team's sync moves a crop to a free path and writes another mark's crop
 * under the old one, and a screenshot's path is taken again once the last
 * one was deleted.
 */
export function imageKeys(c: Case): Map<string, string> {
	const keys = new Map<string, string>();
	const shots = new Map(c.shots.map((s) => [s.id, s]));
	for (const s of c.shots)
		keys.set(
			s.image,
			JSON.stringify(["shot", s.id, s.capturedAt, s.url ?? null]),
		);
	for (const a of c.marks) {
		const shot = shots.get(a.shot);
		// A crop is cut from its screenshot by its shape.
		keys.set(
			a.crop,
			JSON.stringify(["crop", a.id, a.shot, shot?.capturedAt ?? null, a.shape]),
		);
		// An added image's id is its adder's making, never used for another.
		// Those held back here too (DEC-058).
		for (const x of [...(a.images ?? []), ...(a.heldImages ?? [])])
			keys.set(x.image, JSON.stringify(["image", x.id]));
	}
	return keys;
}

/** Of the case's images: the URLs that stay, and the paths still to read. */
export function reuseImages(
	before: CaseImages | undefined,
	c: Case,
): { keys: Map<string, string>; kept: Map<string, string>; read: string[] } {
	const keys = imageKeys(c);
	const kept = new Map<string, string>();
	const read: string[] = [];
	const same = before?.caseId === c.id ? before : undefined;
	for (const [path, key] of keys) {
		const url = same?.keys?.get(path) === key ? same.urls.get(path) : undefined;
		if (url === undefined) read.push(path);
		else kept.set(path, url);
	}
	return { keys, kept, read };
}

/** The URLs of `before` that `urls` no longer has: to revoke. */
export function droppedUrls(
	before: CaseImages | undefined,
	urls: ReadonlyMap<string, string>,
): string[] {
	const now = new Set(urls.values());
	return [...(before?.urls.values() ?? [])].filter((url) => !now.has(url));
}
