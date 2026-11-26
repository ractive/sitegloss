import { expect, test } from "bun:test";
import { droppedUrls, reuseImages } from "../src/sidepanel/case-images.ts";
import type { CaseImages } from "../src/sidepanel/state.ts";
import { sampleCase, withOneMark } from "./fixtures.ts";

const held = (c = withOneMark(sampleCase())): CaseImages => {
	const { keys } = reuseImages(undefined, c);
	return {
		caseId: c.id,
		version: c.updatedAt,
		urls: new Map([
			["shots/s1.webp", "blob:shot"],
			["crops/m1.webp", "blob:crop"],
		]),
		keys,
	};
};

test("an edit that leaves the images as they are reads none of them again", () => {
	const c = withOneMark(sampleCase());
	const edited = {
		...c,
		updatedAt: "2026-11-05T10:00:00Z",
		marks: c.marks.map((a) => ({ ...a, comment: "Darker" })),
	};
	const next = reuseImages(held(c), edited);
	expect(next.read).toEqual([]);
	expect(droppedUrls(held(c), next.kept)).toEqual([]);
});

test("a path that now holds another picture is read again, and the old URL let go", () => {
	const c = withOneMark(sampleCase());
	// The team's sync wrote another mark's crop under the path.
	const moved = {
		...c,
		marks: c.marks.map((a) => ({
			...a,
			shape: { kind: "note" as const, at: { x: 300, y: 40 } },
		})),
	};
	const next = reuseImages(held(c), moved);
	expect(next.read).toEqual(["crops/m1.webp"]);
	expect(droppedUrls(held(c), next.kept)).toEqual(["blob:crop"]);
});

test("another case reuses nothing", () => {
	const other = withOneMark(sampleCase("c_2"));
	expect(reuseImages(held(), other).read).toEqual([
		"shots/s1.webp",
		"crops/m1.webp",
	]);
});
