/**
 * End to end: Verify (DEC-023). The developer sets marks fixed and exports;
 * the tester imports the file over the copy here, reads what differs in the
 * prompt, and finds the marks to verify; Verified moves the bar and the
 * chips; Reopen asks what is still wrong, and the note shows in the card and
 * in get_case. An AI app's "verified" asks first and shows who set it.
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
import {
	type Db,
	exportOpenCase,
	importFile,
	markElement,
	openCase,
	panelHome,
	putCases,
	READ_DB,
	saveAs,
	shadow,
	showToolbar,
	until,
} from "./steps.ts";

interface CallResult {
	isError?: boolean;
	content: { type: string; text?: string }[];
}

const row = (id: string) => `document.querySelector('[data-mark="${id}"]')`;
const act = (id: string, name: string) =>
	`${row(id)}?.querySelector('[data-mark-action="${name}"]')`;
const chips = `[...document.querySelectorAll("#case-status .chip")].map((b) => b.textContent.trim())`;
const bar = `[...document.querySelectorAll("#case-status .progress > span")].map((s) => s.dataset.kind)`;

/** Put `cases` into the extension's database as they are. */

/** Reopen… on mark `id`, its note `note`: the button waits for the text. */
async function reopen(panel: Page, id: string, note: string): Promise<void> {
	await panel.eval(`${act(id, "reopen")}.click()`);
	const field = `${row(id)}.querySelector("[data-form=reopen] textarea")`;
	await panel.waitFor(field);
	expect(await panel.eval<boolean>(`${act(id, "reopen-done")}.disabled`)).toBe(
		true,
	);
	await panel.eval(`(() => {
		const field = ${field};
		field.value = ${JSON.stringify(note)};
		field.dispatchEvent(new Event("input"));
	})()`);
	expect(await panel.eval<boolean>(`${act(id, "reopen-done")}.disabled`)).toBe(
		false,
	);
	await panel.eval(`${act(id, "reopen-done")}.click()`);
	await panel.waitFor(`!${row(id)}.querySelector("[data-form=reopen]")`);
}

inFullSet("Verify", () => {
	let h: Harness;
	const readDb = () => h.control.eval<Db>(READ_DB);
	/** The cases as stored, whole. */
	const storedCases = async () => (await readDb()).cases as unknown as Case[];

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	test("fixed and exported, imported over the tester's copy, verified and reopened", async () => {
		const { page, tabId } = await h.open("v1");
		await showToolbar(h, page, tabId);
		await markElement(page, "[data-truth=submit]", "Too pale");
		await markElement(page, "[data-truth=tip]", "Say how much");
		await markElement(page, "[data-truth=contact]", "Hard to find");
		await saveAs(page, "Hand back");
		await page.send("Page.close");
		const tester = (await storedCases()).find((c) => c.title === "Hand back");
		if (tester === undefined) throw new Error("not saved");

		// The developer: marks 1 and 2 fixed, then Export.
		const panel = await panelHome(h);
		await openCase(panel, "Hand back");
		for (const id of ["m1", "m2"]) {
			await panel.eval(`${act(id, "resolve")}.click()`);
			await panel.waitFor(`${row(id)}.querySelector("[data-form=resolve]")`);
			await panel.eval(`(() => {
				const form = ${row(id)}.querySelector("[data-form=resolve]");
				form.querySelector('input[value="fixed"]').click();
				const note = form.querySelector("input.note");
				note.value = "Darker text";
				note.dispatchEvent(new Event("input"));
				form.querySelector('[data-mark-action="resolve-done"]').click();
			})()`);
			await panel.waitFor(`${row(id)}?.dataset.status === "fixed"`);
		}
		expect(await panel.eval<string[]>(chips)).toEqual([
			"● Open 1",
			"◐ To verify 2",
		]);
		const file = await exportOpenCase(h, panel);

		// The tester's copy is as it was handed over: all open.
		await putCases(h, [tester]);
		await panelHome(h);
		expect(
			await panel.eval<string>(
				`document.querySelector('[data-case="${tester.id}"]').textContent`,
			),
		).not.toContain("to verify");
		await importFile(panel, file);
		const replace = `document.querySelector('[data-action="import-replace"]')`;
		await panel.waitFor(replace);
		expect(
			await panel.eval<string>(
				`document.querySelector('[data-role="import-counts"]').textContent`,
			),
		).toBe("Here: 3 open. In the file: 1 open, 2 to verify.");
		await panel.click(replace);
		await until(storedCases, (cases) =>
			cases.some(
				(c) => c.id === tester.id && c.marks[0]?.resolution !== undefined,
			),
		);
		// The marks to verify: their pill, and Verified in the head.
		await panelHome(h);
		await openCase(panel, "Hand back");
		await panel.waitFor(`${row("m1")}?.dataset.status === "fixed"`);
		const pill = (id: string) =>
			panel.eval<string | null>(
				`${row(id)}.querySelector(".mark-sub .pill")?.textContent ?? null`,
			);
		expect([await pill("m1"), await pill("m2"), await pill("m3")]).toEqual([
			"To verify",
			"To verify",
			null,
		]);
		expect(await panel.eval<string[]>(bar)).toEqual(["open", "toVerify"]);

		// The tester's filter: only the marks to verify, then all again.
		await panel.click(
			`document.querySelector('#case-status .chip[data-group="toVerify"]')`,
		);
		await panel.waitFor(`document.querySelectorAll("li.mark").length === 2`);
		expect(
			await panel.eval<string>(
				`document.getElementById("marks-filtered").textContent`,
			),
		).toBe("Showing 2 of 3 marks. Show all");
		await panel.click(`document.querySelector('[data-action="show-all"]')`);
		await panel.waitFor(`document.querySelectorAll("li.mark").length === 3`);

		// Verified, from the collapsed head: the bar and the chips move.
		await panel.click(
			`${row("m1")}.querySelector('.mark-sub [data-mark-action="verify"]')`,
		);
		await panel.waitFor(`${row("m1")}?.dataset.status === "verified"`);
		expect(await panel.eval<string[]>(chips)).toEqual([
			"● Open 1",
			"◐ To verify 1",
			"✓ Verified 1",
		]);
		expect(await panel.eval<string[]>(bar)).toEqual([
			"open",
			"toVerify",
			"verified",
		]);

		// Reopen… needs a note; it shows in the head, the claimed fix stays.
		await reopen(panel, "m2", "Still pale on hover");
		await panel.waitFor(`${row("m2")}?.dataset.status === "open"`);
		expect(
			await panel.eval<string>(
				`${row("m2")}.querySelector(".mark-sub .reopened").textContent`,
			),
		).toBe("Reopened: Still pale on hover");
		const stored = (await storedCases()).find((c) => c.id === tester.id);
		expect(stored?.marks[1]?.reopens).toEqual([
			{
				note: "Still pale on hover",
				at: expect.any(String),
				// The developer's fix came in from the file.
				was: {
					kind: "fixed",
					note: "Darker text",
					at: expect.any(String),
					imported: true,
				},
			},
		]);
		expect(stored?.marks[0]?.resolution?.verified).toEqual({
			at: expect.any(String),
		});
	}, 90_000);
});

inFullSet("Verify with an AI app", () => {
	let h: Harness;
	let panel: Page;
	let page: Page;
	let claude: Client;
	const relay = startTestRelay();
	const QUESTION = `document.querySelector("[data-question]")`;

	const call = (name: string, args: Record<string, unknown>) =>
		claude.callTool({ name, arguments: args }) as Promise<CallResult>;

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
		const tab = await h.open("v1");
		page = tab.page;
		const url = await page.eval<string>("location.href");
		// A fixed mark without an element, on this page: drawn where it was.
		const c: Case = {
			...sampleCase("c_v"),
			title: "Verify case",
			page: { ...sampleCase().page, url },
			shots: [
				{
					id: "s1",
					image: "shots/s1.webp",
					scrollX: 0,
					scrollY: 0,
					viewport: { width: 1280, height: 800, dpr: 2 },
					capturedAt: "2026-11-13T10:00:00Z",
				},
			],
			marks: [
				{
					id: "m1",
					number: 1,
					shot: "s1",
					comment: "Too pale",
					author: "user",
					shape: { kind: "note", at: { x: 40, y: 40 } },
					crop: "crops/m1.webp",
					element: null,
					resolution: {
						kind: "fixed",
						note: "Darker text",
						at: "2026-11-13T11:00:00Z",
					},
				},
			],
		};
		await putCases(h, [c]);
		await page.activate();
		panel = await openSidePanel(h);
		const address = await connectAi(panel, relay.url);
		claude = await mcpClient(relay, address);
		const item = `document.querySelector('button[data-case="c_v"]')`;
		await panel.waitFor(item, 10_000);
		await panel.eval(`${item}.click()`);
		await panel.waitFor(row("m1"), 10_000);
	}, 60_000);

	afterAll(async () => {
		await claude?.close();
		await h?.stop();
		await relay.stop();
	});

	test("verified asks first, then shows who set it", async () => {
		const result = call("set_mark_status", {
			caseId: "c_v",
			mark: 1,
			status: "verified",
		});
		await panel.waitFor(QUESTION, 10_000);
		expect(await panel.eval<string>(`${QUESTION}.textContent`)).toContain(
			"Mark 1: “Too pale”, now Fixed, to verify.",
		);
		await answerInPanel(panel, "allow");
		const done = await result;
		expect(done.isError).toBeFalsy();
		expect(done.content[0]?.text).toBe("Mark 1 is verified.");
		await panel.waitFor(`${row("m1")}?.dataset.status === "verified"`, 10_000);
		await panel.eval(`${row("m1")}.querySelector(".mark-toggle").click()`);
		const verified = `[...${row("m1")}.querySelectorAll(".history li")].find((li) => li.dataset.kind === "verified")`;
		await panel.waitFor(verified);
		expect(await panel.eval<string>(`${verified}.textContent`)).toMatch(
			/^Verified .+ by .*client\.example/,
		);
		// On the page, a verified mark steps back.
		await page.waitFor(
			`${shadow("svg.marks")}?.querySelector('[data-review="1"][data-resolved]')`,
			10_000,
		);
	});

	test("a reopen in the panel: its note is in get_case", async () => {
		await reopen(panel, "m1", "Still pale on hover");
		await panel.waitFor(`${row("m1")}?.dataset.status === "open"`);
		const read = await call("get_case", { caseId: "c_v", images: false });
		const view = JSON.parse(read.content[0]?.text ?? "{}");
		expect(view.marks[0].status).toBe("open");
		expect(view.marks[0].resolution).toBeNull();
		expect(view.marks[0].reopens).toEqual([
			{ note: "Still pale on hover", at: expect.any(String), was: "verified" },
		]);
		// An AI app may not verify an open mark.
		const refused = call("set_mark_status", {
			caseId: "c_v",
			mark: 1,
			status: "verified",
		});
		await panel.waitFor(QUESTION, 10_000);
		await answerInPanel(panel, "allow");
		const answer = await refused;
		expect(answer.isError).toBe(true);
		expect(JSON.stringify(answer.content)).toContain(
			"only a fixed mark can be verified",
		);
	});
});
