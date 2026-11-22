import { CASE_FORMAT, type Case } from "../src/lib/case.ts";
import type { CaseStore } from "../src/lib/store.ts";

/** A case without shots or marks. */
export function sampleCase(
	id = "c_1",
	updatedAt = "2026-11-04T10:00:00Z",
): Case {
	return {
		format: CASE_FORMAT,
		id,
		title: "Button contrast",
		createdAt: "2026-11-04T10:00:00Z",
		updatedAt,
		page: {
			url: "https://www.example.com/kk",
			title: "KK",
			lang: "de",
			viewport: { width: 1280, height: 800, dpr: 2 },
			userAgent: "test",
		},
		shots: [],
		marks: [],
		verdict: null,
	};
}

/** Store a case as the worker and the side panel do; images go separately. */
export function putCase(store: CaseStore, value: Case): Promise<Case> {
	return store.updateCase(value.id, () => ({ value }));
}

/**
 * `c` with one mark (a note) on one screenshot, as a case gets its first mark;
 * `putMarked` stores it with both images, so it can be exported.
 */
export function withOneMark(c: Case): Case {
	return {
		...c,
		shots: [
			{
				id: "s1",
				image: "shots/s1.webp",
				scrollX: 0,
				scrollY: 0,
				viewport: { width: 1280, height: 800, dpr: 2 },
				capturedAt: "2026-11-04T10:00:00Z",
			},
		],
		marks: [
			{
				id: "m1",
				number: 1,
				shot: "s1",
				comment: "Too pale",
				author: "user",
				shape: { kind: "note", at: { x: 10, y: 20 } },
				crop: "crops/m1.webp",
				element: null,
			},
		],
	};
}

/** The smallest WebP header (VP8X) an import reads: 10×10 pixels. */
function tinyWebp(): Blob {
	const out = new Uint8Array(30);
	out.set(new TextEncoder().encode("RIFF\x00\x00\x00\x00WEBPVP8X"), 0);
	out[16] = 10;
	out[24] = 9;
	out[27] = 9;
	return new Blob([out], { type: "image/webp" });
}

/** Store `c` with one mark and its two images. */
export async function putMarked(store: CaseStore, c: Case): Promise<Case> {
	const marked = withOneMark(c);
	for (const path of ["shots/s1.webp", "crops/m1.webp"])
		await store.putImage(marked.id, path, {
			blob: tinyWebp(),
			width: 10,
			height: 10,
		});
	return putCase(store, marked);
}
