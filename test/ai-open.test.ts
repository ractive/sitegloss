/**
 * An AI app's open_case never costs what a person typed or a decision they
 * have to make (review of DEC-050): `aiOpenRefusal`, refusal by refusal.
 */

import { describe, expect, test } from "bun:test";
import type { OverlayState } from "../src/lib/messages.ts";
import { aiOpenRefusal } from "../src/sidepanel/ai-open.ts";
import type { TabAnswer } from "../src/sidepanel/fresh.ts";
import { initialState, type PanelState } from "../src/sidepanel/state.ts";

const TAB = 7;
const toolbar = (caseId: string, visible = true): OverlayState =>
	({
		visible,
		target: { caseId, title: caseId, nextAnnotation: 1 },
		drafts: 0,
		saving: false,
	}) as unknown as OverlayState;

function showing(
	caseId: string | undefined,
	change?: (s: PanelState) => void,
): PanelState {
	const s = initialState();
	if (caseId !== undefined) s.view = { kind: "case", id: caseId };
	change?.(s);
	return s;
}

const tabs = (entries: [number, TabAnswer][] = []) => new Map(entries);

describe("open_case and the case the panel shows", () => {
	test("on Home, with the same case open, or another one left cleanly: nothing stands in the way", () => {
		expect(aiOpenRefusal(showing(undefined), "c_new", TAB, tabs())).toBe(
			undefined,
		);
		expect(aiOpenRefusal(showing("c_new"), "c_new", TAB, tabs())).toBe(
			undefined,
		);
		// Another case, nothing under way there; tabs without a toolbar, or
		// that do not answer, hold nothing of it.
		expect(
			aiOpenRefusal(
				showing("c_old"),
				"c_new",
				TAB,
				tabs([
					[TAB, "none"],
					[3, "unsure"],
					[4, toolbar("c_old", false)],
				]),
			),
		).toBe(undefined);
	});

	test("a mark's form open in the case shown: refused, the typing stays", () => {
		const s = showing("c_old", (x) => {
			x.markEdit = {
				annotationId: "a1",
				mode: "comment",
				text: "half a sen",
			} as never;
		});
		expect(aiOpenRefusal(s, "c_new", TAB, tabs())).toEqual({
			reason: "busy",
			caseId: "c_old",
			why: "a mark's form is open there, with what is typed in it",
		});
	});

	test("its title or its link being typed: refused", () => {
		expect(
			aiOpenRefusal(
				showing("c_old", (x) => {
					x.renaming = { caseId: "c_old", text: "New tit" };
				}),
				"c_new",
				TAB,
				tabs(),
			),
		).toMatchObject({ reason: "busy", why: "its title is being changed" });
		expect(
			aiOpenRefusal(
				showing("c_old", (x) => {
					x.linking = { caseId: "c_old", text: "https://ji" };
				}),
				"c_new",
				TAB,
				tabs(),
			),
		).toMatchObject({ reason: "busy", why: "its link is being changed" });
	});

	test("a leave under way, or one that waits for the user: refused", () => {
		expect(
			aiOpenRefusal(
				showing("c_old", (x) => {
					x.leaving = { phase: "finishing" };
				}),
				"c_new",
				TAB,
				tabs(),
			),
		).toMatchObject({ reason: "busy", why: "it is being closed" });
		expect(
			aiOpenRefusal(
				showing("c_old", (x) => {
					x.leaving = { phase: "blocked", left: 1 };
				}),
				"c_new",
				TAB,
				tabs(),
			),
		).toMatchObject({
			reason: "busy",
			why: "it is being closed, and a mark of its toolbar is not in it yet",
		});
	});

	test("its toolbar up on any tab, not only the AI app's: refused", () => {
		expect(
			aiOpenRefusal(
				showing("c_old"),
				"c_new",
				TAB,
				tabs([
					[TAB, "none"],
					[12, toolbar("c_old")],
				]),
			),
		).toEqual({
			reason: "busy",
			caseId: "c_old",
			why: "its toolbar is up on a tab, adding marks to it",
		});
	});

	test("the toolbar on the AI app's tab adding to a third case: refused as adding, also from Home", () => {
		for (const s of [showing(undefined), showing("c_new")])
			expect(
				aiOpenRefusal(s, "c_new", TAB, tabs([[TAB, toolbar("c_third")]])),
			).toEqual({ reason: "adding", caseId: "c_third" });
		// Adding to the case asked for is no reason.
		expect(
			aiOpenRefusal(
				showing(undefined),
				"c_new",
				TAB,
				tabs([[TAB, toolbar("c_new")]]),
			),
		).toBe(undefined);
	});
});
