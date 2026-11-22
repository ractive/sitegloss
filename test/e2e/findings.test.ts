/**
 * End to end: AI apps' findings on a mark (DEC-019). An AI app adds one once
 * the user allows it; the side panel shows it under the mark with the app's
 * name; the user deletes it in the panel with a second click, and an
 * unsaved comment form on the mark stays as it is. That another AI app can
 * neither edit nor delete it is tools.test.ts's.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Client } from "@modelcontextprotocol/client";
import { startTestRelay } from "@ractive-ch/tab-mcp/testing";
import type { Case } from "../../src/lib/case.ts";
import { sampleCase } from "../fixtures.ts";
import { answerInPanel, connectAi, mcpClient, openSidePanel } from "./ai.ts";
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

interface CallResult {
	isError?: boolean;
	content: { type: string; text?: string }[];
}

/** A case with one mark, a note without an element. */
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
		},
	],
});

const storedMark = async (h: Harness) =>
	(await h.control.eval<{ cases: Case[] }>(READ_DB)).cases.find(
		(c) => c.id === "c_f",
	)?.marks[0];

const QUESTION = `document.querySelector("[data-question]")`;
const FINDING = `document.querySelector('[data-mark="m1"] [data-finding]')`;
const DELETE = `${FINDING}?.querySelector('[data-finding-action="delete"]')`;

inFullSet("AI findings on a mark", () => {
	let h: Harness;
	let panel: Page;
	let claude: Client;
	const relay = startTestRelay();

	const call = (client: Client, name: string, args: Record<string, unknown>) =>
		client.callTool({ name, arguments: args }) as Promise<CallResult>;
	/** A call that asks first: allowed in the panel. */
	const allowed = async (
		client: Client,
		name: string,
		args: Record<string, unknown>,
	) => {
		const result = call(client, name, args);
		await panel.waitFor(QUESTION, 10_000);
		const question = await panel.eval<string>(`${QUESTION}.textContent`);
		await answerInPanel(panel, "allow");
		await panel.waitFor(`!${QUESTION}`);
		return { result: await result, question };
	};

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
		await putCases(h, [markedCase()]);
		const tab = await h.open("v1");
		await step("bring the page to the front", () => tab.page.activate());
		panel = await openSidePanel(h);
		const address = await connectAi(panel, relay.url);
		claude = await mcpClient(relay, address);
		// The case open in the panel, its mark open.
		const item = `document.querySelector('button[data-case="c_f"]')`;
		await panel.waitFor(item, 10_000);
		await panel.eval(`${item}.click()`);
		const toggle = `document.querySelector('[data-mark="m1"] .mark-toggle')`;
		await panel.waitFor(toggle, 10_000);
		await panel.eval(`${toggle}.click()`);
	}, 60_000);

	afterAll(async () => {
		await claude?.close();
		await h?.stop();
		await relay.stop();
	});

	test("an AI app adds a finding once allowed; the panel shows it under the mark with the app", async () => {
		const { result, question } = await allowed(claude, "add_finding", {
			caseId: "c_f",
			mark: 1,
			text: "Button_primary sets a light grey background.",
		});
		expect(result.isError).toBeFalsy();
		// The question names the case and the mark.
		expect(question).toContain("Case: “Findings case”");
		expect(question).toContain("Mark 1: “The button is too light”");
		expect(result.content[0]?.text).toMatch(/finding f_[0-9a-f]+/);
		await panel.waitFor(FINDING, 10_000);
		const text = await panel.eval<string>(`${FINDING}.textContent`);
		expect(text).toContain("Button_primary sets a light grey background.");
		expect(text).toContain("client.example");
		// The user's comment is as it was.
		const mark = await storedMark(h);
		expect(mark?.comment).toBe("The button is too light");
		expect(mark?.author).toBe("user");
		expect(mark?.findings?.[0]?.app.id).toBe(
			"https://client.example/cimd.json",
		);
	});

	test("deleting a finding asks first, and leaves the mark's unsaved comment form open", async () => {
		// The finding the test above added.
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
