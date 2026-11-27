/**
 * End to end: an AI app's open_case (DEC-050 and its review). With another
 * case open in the side panel and a mark's comment half typed there, the
 * call is refused and the typing stays; once the form is closed, the panel
 * leaves that case as "← All cases" does and opens the new one, whose mark
 * of the page in front (made on another host, the same path) is drawn.
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
	startHarness,
} from "./harness.ts";
import { parkControl, putCases, shadow } from "./steps.ts";
import { step } from "./trace.ts";

interface CallResult {
	isError?: boolean;
	content: { type: string; text?: string }[];
}

/** A case of one note on `url`, no element. */
const noteCase = (id: string, title: string, url: string): Case => ({
	...sampleCase(id),
	title,
	page: { ...sampleCase(id).page, url },
	shots: [
		{
			id: "s1",
			image: "shots/s1.webp",
			scrollX: 0,
			scrollY: 0,
			viewport: { width: 1280, height: 800, dpr: 2 },
			capturedAt: "2026-11-21T10:00:00Z",
			url,
		},
	],
	marks: [
		{
			id: "m1",
			number: 1,
			shot: "s1",
			comment: `${title}: the note`,
			author: "user",
			shape: { kind: "note", at: { x: 40, y: 120 } },
			crop: "crops/m1.webp",
			element: null,
		},
	],
});

const QUESTION = `document.querySelector("[data-question]")`;
const id = (name: string) => `document.getElementById(${JSON.stringify(name)})`;

inFullSet("open_case", () => {
	let h: Harness;
	let panel: Page;
	let page: Page;
	let tabId: number;
	let claude: Client;
	const relay = startTestRelay();

	/** open_case, allowed in the panel. */
	const openCase = async (caseId: string) => {
		const result = claude.callTool({
			name: "open_case",
			arguments: { caseId },
		}) as Promise<CallResult>;
		await panel.waitFor(QUESTION, 10_000);
		await answerInPanel(panel, "allow");
		await panel.waitFor(`!${QUESTION}`);
		return result;
	};
	const title = () =>
		panel.eval<string>(`document.querySelector("#case-view h2")?.textContent`);

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
		await putCases(h, [
			noteCase("c_old", "Old case", `${h.base}/v2`),
			// Made on production: the tab's page is the same path elsewhere.
			noteCase("c_new", "New case", "https://shop.example/v1"),
		]);
		const tab = await h.open("v1");
		page = tab.page;
		tabId = tab.tabId;
		// One panel in the page's window: the control page is one too.
		await parkControl(h);
		await step("bring the page to the front", () => page.activate());
		panel = await openSidePanel(h);
		const address = await connectAi(panel, relay.url);
		claude = await mcpClient(relay, address);
		// The old case open, its mark's comment half typed.
		const item = `document.querySelector('button[data-case="c_old"]')`;
		await panel.waitFor(item, 10_000);
		await panel.eval(`${item}.click()`);
		await panel.waitFor(`${id("verdict")}?.dataset.case === "c_old"`, 10_000);
		const edit = `document.querySelector('[data-mark="m1"] [data-mark-action="comment"]')`;
		await panel.waitFor(edit, 10_000);
		await panel.eval(`${edit}.click()`);
		const field = `document.querySelector('[data-mark="m1"] [data-form="comment"] textarea')`;
		await panel.waitFor(field);
		await panel.eval(
			`(() => { const f = ${field}; f.value = "Half a sente"; f.dispatchEvent(new Event("input")); })()`,
		);
	}, 60_000);

	afterAll(async () => {
		await claude?.close();
		await h?.stop();
		await relay.stop();
	});

	test("refused while a mark's comment is being typed in the case shown; the typing stays", async () => {
		const result = await openCase("c_new");
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain(
			'the panel is busy with "Old case": a mark\'s form is open there, with what is typed in it',
		);
		expect(await title()).toBe("Old case");
		expect(
			await panel.eval<string>(
				`document.querySelector('[data-mark="m1"] [data-form="comment"] textarea').value`,
			),
		).toBe("Half a sente");
		// Nothing of the new case was drawn over it: the page shows the old one.
		expect(
			await h.control.eval<string | null>(
				`chrome.tabs.sendMessage(${tabId}, { type: "overlay:state" }).then((s) => s.loadedCase ?? null)`,
			),
		).toBe("c_old");
	}, 60_000);

	test("with the form closed, the panel leaves the old case and opens the new one, its mark of this path drawn", async () => {
		await panel.eval(
			`[...document.querySelectorAll('[data-mark="m1"] [data-form="comment"] button')].find((b) => b.textContent === "Cancel").click()`,
		);
		await panel.waitFor(
			`!document.querySelector('[data-mark="m1"] [data-form="comment"]')`,
		);
		const result = await openCase("c_new");
		expect(result.isError).toBeFalsy();
		const said = JSON.parse(result.content[0]?.text ?? "{}");
		expect(said.panel).toBe("opened");
		expect(said.marks).toEqual([
			expect.objectContaining({
				mark: 1,
				status: "no-element",
				page: "https://shop.example/v1",
				onThisPage: true,
			}),
		]);
		await panel.waitFor(`${id("verdict")}?.dataset.case === "c_new"`, 10_000);
		expect(await title()).toBe("New case");
		// The note is drawn where it was, on the page in front.
		await page.waitFor(`${shadow('[data-review="1"]')} !== null`, 10_000);
		// The old case was left as a click leaves it: still there (it has a mark).
		await panel.eval(`${id("back")}.click()`);
		await panel.waitFor(
			`document.querySelector('button[data-case="c_old"]') !== null`,
		);
	}, 60_000);
});
