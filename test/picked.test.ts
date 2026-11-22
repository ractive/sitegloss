import { describe, expect, test } from "bun:test";
import { type Case, type Mark, markKey } from "../src/lib/case.ts";
import { markAsked } from "../src/sidepanel/picked.ts";
import { sampleCase } from "./fixtures.ts";

describe("which panel answers a page about a mark (DEC-027)", () => {
	const mark: Mark = {
		id: "m1",
		number: 1,
		shot: "s1",
		comment: "Here",
		author: "user",
		shape: { kind: "note", at: { x: 1, y: 1 } },
		crop: "crops/m1.webp",
		element: null,
	};
	const c: Case = { ...sampleCase("c_open"), marks: [mark] };
	const request = { caseId: c.id, markId: mark.id };
	const showing = {
		open: c,
		loaded: { caseId: c.id, tabId: 7 },
		front: undefined,
	};

	test("the panel that has the case open and drew it on that tab", () => {
		expect(markAsked(showing, request, 7)).toBe(mark);
	});

	test("not for another tab, and not without a tab (an extension page, the worker)", () => {
		expect(markAsked(showing, request, 8)).toBeUndefined();
		expect(markAsked(showing, request, undefined)).toBeUndefined();
	});

	test("not for a case that is not open, or that this panel did not draw there", () => {
		expect(
			markAsked({ ...showing, open: undefined }, request, 7),
		).toBeUndefined();
		expect(
			markAsked({ ...showing, loaded: undefined }, request, 7),
		).toBeUndefined();
		expect(
			markAsked(
				{ ...showing, loaded: { caseId: "c_other", tabId: 7 } },
				request,
				7,
			),
		).toBeUndefined();
		expect(
			markAsked(showing, { ...request, caseId: "c_other" }, 7),
		).toBeUndefined();
		// Another case open, the asked one drawn on the tab before.
		expect(
			markAsked({ ...showing, open: sampleCase("c_next") }, request, 7),
		).toBeUndefined();
	});

	test("a panel opened again: the tab in front that shows the open case", () => {
		const reopened = {
			open: c,
			loaded: undefined,
			front: { tabId: 9, loadedCase: c.id },
		};
		expect(markAsked(reopened, request, 9)).toBe(mark);
		// Another tab, the tab in front showing another case or none, or
		// another case open in the panel.
		expect(markAsked(reopened, request, 7)).toBeUndefined();
		expect(
			markAsked(
				{ ...reopened, front: { tabId: 9, loadedCase: "c_other" } },
				request,
				9,
			),
		).toBeUndefined();
		expect(
			markAsked(
				{ ...reopened, front: { tabId: 9, loadedCase: undefined } },
				request,
				9,
			),
		).toBeUndefined();
		expect(
			markAsked({ ...reopened, open: sampleCase("c_next") }, request, 9),
		).toBeUndefined();
	});

	test("a mark the case no longer has is this panel's to say so", () => {
		expect(markAsked(showing, { ...request, markId: "a_gone" }, 7)).toBe(
			"gone",
		);
	});

	test("the page says which mark its popover is on: the id alone is another mark's after a renumbering", () => {
		const other: Mark = {
			...mark,
			comment: "A teammate's",
			shape: { kind: "note", at: { x: 50, y: 50 } },
		};
		const moved: Mark = { ...mark, id: "m2", number: 2 };
		const now = { ...showing, open: { ...c, marks: [other, moved] } };
		const key = markKey(c, mark);
		// Asked for "m1", which is the teammate's mark now: its own, under its new id.
		expect(markAsked(now, { ...request, mark: key }, 7)).toBe(moved);
		// Gone from the case.
		expect(
			markAsked(
				{ ...showing, open: { ...c, marks: [other] } },
				{ ...request, mark: key },
				7,
			),
		).toBe("gone");
		// Two that nothing tells apart, and the id is neither: not the first found.
		const twin = { ...moved, id: "m3", number: 3 };
		expect(
			markAsked(
				{ ...showing, open: { ...c, marks: [other, moved, twin] } },
				{ ...request, mark: key },
				7,
			),
		).toBe("changed");
		// A page of an older build says no mark: by the id, as before.
		expect(markAsked(now, request, 7)).toBe(other);
	});
});
