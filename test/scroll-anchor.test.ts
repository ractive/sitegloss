import { expect, test } from "bun:test";
import { anchorShift, markAnchorKeys } from "../src/sidepanel/scroll-anchor.ts";

test("the acted mark is held where it was clicked; when it went, the mark that takes its place is (DEC-060)", () => {
	const order = ["m1", "m2", "m3", "m4"];
	// The acted row, then the ones after it, then those before, nearest first.
	expect(markAnchorKeys(order, "m2")).toEqual(["m2", "m3", "m4", "m1"]);
	expect(markAnchorKeys(order, "m4")).toEqual(["m4", "m3", "m2", "m1"]);
	expect(markAnchorKeys(order, "gone")).toEqual(["gone"]);

	const tops = (map: Record<string, number>) => (key: string) => map[key];
	// Verify: the row drawn anew 190 px lower (pictures above came back): back up.
	expect(anchorShift(["m2", "m3"], 380, tops({ m2: 570, m3: 700 }))).toBe(190);
	// Deleted, or left out by a filter: the next mark takes its place.
	expect(anchorShift(["m2", "m3"], 380, tops({ m3: 570 }))).toBe(190);
	// Where it was: nothing to do; half a pixel is no move.
	expect(anchorShift(["m2"], 380, tops({ m2: 380.4 }))).toBe(0);
	// Nothing of it there (the list emptied): nothing to hold.
	expect(anchorShift(["m2", "m3"], 380, tops({}))).toBeUndefined();
});
