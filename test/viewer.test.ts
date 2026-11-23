import { expect, test } from "bun:test";
import type { Case } from "../src/lib/case.ts";
import {
	markPictures,
	pictureIndex,
	viewerPath,
} from "../src/viewer/pictures.ts";
import { sampleCase, withOneMark } from "./fixtures.ts";

test("the viewer's pictures of a mark: its screenshot, then the added images and those held back, each with which mark of which case and who added it", () => {
	const base = withOneMark(sampleCase("c_v"));
	const m1 = base.marks[0];
	if (m1 === undefined) throw new Error("no mark");
	const c: Case = {
		...base,
		title: "Checkout",
		marks: [
			{
				...m1,
				images: [
					{
						id: "i_a",
						image: "images/i_a.webp",
						added: {
							at: "2026-11-20T10:00:00Z",
							user: { id: "u1", name: "Ann" },
						},
					},
					{
						id: "i_b",
						image: "images/i_b.webp",
						added: { at: "2026-11-21T10:00:00Z", imported: true },
					},
				],
				heldImages: [
					{
						id: "i_c",
						image: "images/i_c.webp",
						added: { at: "2026-11-22T10:00:00Z" },
					},
				],
			},
		],
	};
	const list = markPictures(c, "m1");
	expect(list.map((p) => [p.id, p.path, p.alt])).toEqual([
		["screenshot", "crops/m1.webp", "Screenshot of mark 1"],
		["i_a", "images/i_a.webp", "Image 1 of mark 1"],
		["i_b", "images/i_b.webp", "Image 2 of mark 1"],
		["i_c", "images/i_c.webp", "Image 3 of mark 1"],
	]);
	// Short: case, mark, picture; who and when on the second line.
	expect(list[0]?.title).toBe("“Checkout” · Mark 1 · Screenshot");
	expect(list[0]?.detail).toMatch(/^Taken by Sitegloss, /);
	expect(list[1]?.title).toBe("“Checkout” · Mark 1 · Image 1 of 3");
	expect(list[1]?.detail).toMatch(/^Added by Ann, /);
	expect(list[2]?.detail).toMatch(/^From an imported file, /);
	expect(list[3]?.detail).toMatch(/; not sent yet$/);
	// Previous and next go by this order; an unknown picture starts at the first.
	expect(pictureIndex(list, "i_b")).toBe(2);
	expect(pictureIndex(list, "gone")).toBe(0);
	expect(markPictures(c, "m9")).toEqual([]);
	// An extension page of its own, never the web page.
	expect(viewerPath("c_v", "m1", "i_a")).toBe(
		"viewer/index.html?case=c_v&mark=m1&picture=i_a",
	);
});
