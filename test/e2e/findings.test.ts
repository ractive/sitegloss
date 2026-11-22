/**
 * End to end: an AI app's finding on a mark deleted in the side panel
 * (DEC-019): a second click deletes it, and an unsaved comment form on the
 * mark stays as it is (`main.ts` keeps the form for this change only; no
 * unit test reaches that). Adding a finding through the relay, the
 * question, and that another AI app can neither edit nor delete it are
 * tools.test.ts's; how a finding shows is view.test.ts's.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Case } from "../../src/lib/case.ts";
import { sampleCase } from "../fixtures.ts";
import { openSidePanel } from "./ai.ts";
import type { Page } from "./browser.ts";
import {
	browserBinary,
	type Harness,
	inFullSet,
	PAST_GUARD_MS,
	startHarness,
} from "./harness.ts";
import { putCases, READ_DB } from "./steps.ts";
import { step } from "./trace.ts";

/** A case with one mark, a note without an element, and an AI app's finding on it. */
const markedCase = (): Case => ({
	...sampleCase("c_f"),
	title: "Findings case",
	shots: [
		{
			id: "s1",
			image: "shots/s1.webp",
			scrollX: 0,
			scrollY: 0,
			viewport: { width: 1280, height: 800, dpr: 2 },
			capturedAt: "2026-11-10T10:00:00Z",
		},
	],
	marks: [
		{
			id: "m1",
			number: 1,
			shot: "s1",
			comment: "The button is too light",
			author: "user",
			shape: { kind: "note", at: { x: 10, y: 10 } },
			crop: "crops/m1.webp",
			element: null,
			findings: [
				{
					id: "f_1",
					text: "Button_primary sets a light grey background.",
					app: {
						id: "https://client.example/cimd.json",
						host: "client.example",
					},
					at: "2026-11-10T10:05:00Z",
				},
			],
		},
	],
});

const storedMark = async (h: Harness) =>
	(await h.control.eval<{ cases: Case[] }>(READ_DB)).cases.find(
		(c) => c.id === "c_f",
	)?.marks[0];

const FINDING = `document.querySelector('[data-mark="m1"] [data-finding]')`;
const DELETE = `${FINDING}?.querySelector('[data-finding-action="delete"]')`;

inFullSet("AI findings on a mark", () => {
	let h: Harness;
	let panel: Page;

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
		await putCases(h, [markedCase()]);
		const tab = await h.open("v1");
		await step("bring the page to the front", () => tab.page.activate());
		panel = await openSidePanel(h);
		// The case open in the panel, its mark open.
		const item = `document.querySelector('button[data-case="c_f"]')`;
		await panel.waitFor(item, 10_000);
		await panel.eval(`${item}.click()`);
		const toggle = `document.querySelector('[data-mark="m1"] .mark-toggle')`;
		await panel.waitFor(toggle, 10_000);
		await panel.eval(`${toggle}.click()`);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	test("deleting a finding asks first, and leaves the mark's unsaved comment form open", async () => {
		await panel.waitFor(FINDING, 10_000);
		const form = `document.querySelector('[data-mark="m1"] [data-form="comment"] textarea')`;
		await panel.eval(
			`document.querySelector('[data-mark="m1"] [data-mark-action="comment"]').click()`,
		);
		await panel.waitFor(form);
		await panel.eval(`(() => {
			const field = ${form};
			field.value = "A draft not saved yet";
			field.dispatchEvent(new Event("input", { bubbles: true }));
		})()`);
		await panel.eval(`${DELETE}.click()`);
		await panel.waitFor(`${DELETE}?.textContent === "Really delete?"`);
		expect((await storedMark(h))?.findings).toHaveLength(1);
		// Past the double-click guard: a second thought.
		await Bun.sleep(PAST_GUARD_MS);
		await panel.eval(`${DELETE}.click()`);
		await panel.waitFor(`!${FINDING}`, 10_000);
		expect((await storedMark(h))?.findings).toBeUndefined();
		expect(await panel.eval<string | undefined>(`${form}?.value`)).toBe(
			"A draft not saved yet",
		);
		expect((await storedMark(h))?.comment).toBe("The button is too light");
	});
});
