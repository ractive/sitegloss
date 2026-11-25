/**
 * End to end: Verify (DEC-023). The developer sets marks fixed and exports;
 * the tester imports the file over the copy here, reads what differs in the
 * prompt, and finds the marks to verify; Verify moves the bar and the
 * chips; Reopen asks what is still wrong, and the note shows in the card and
 * the case. An AI app's "verified" (it asks first, and who set it shows),
 * and a reopen read back through get_case, are tools.test.ts's and
 * view.test.ts's.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { CASE_FORMAT, type Case } from "../../src/lib/case.ts";
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
	marksIn,
	openCase,
	panelHome,
	putCases,
	READ_DB,
	saveAs,
	shadow,
	showToolbar,
	until,
} from "./steps.ts";

const row = (id: string) => `document.querySelector('[data-mark="${id}"]')`;
const act = (id: string, name: string) =>
	`${row(id)}?.querySelector('[data-mark-action="${name}"]')`;
const chips = `[...document.querySelectorAll("#case-status .chip")].map((b) => b.textContent.trim())`;
const bar = `[...document.querySelectorAll("#case-status .progress > span")].map((s) => s.dataset.kind)`;

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
		// The marks to verify: their pill, and Verify in the head.
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

		// Verify only where the page was checked (DEC-079): with no page of the
		// case in front (here the panel's own tab) none; the tab on /v1, Verify.
		expect(
			await panel.eval<boolean>(
				`${row("m1")}.querySelector('.head-verify') === null`,
			),
		).toBe(true);
		const v1 = await h.open("v1");
		await v1.page.activate();
		await panel.waitFor(`${row("m1")}?.querySelector('.head-verify')`);

		// Verify, from the collapsed head: the bar and the chips move.
		// A real click, though the panel's tab is behind /v1: the focus moves
		// to the pressed button, as a person's click moves it.
		await panel.click(`${row("m1")}.querySelector('.head-verify')`);
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
		await v1.page.send("Page.close");
	}, 90_000);

	test("Verify pressed on an open row: the row collapses, the stored state follows, the next row opens", async () => {
		const at = "2026-11-22T10:00:00.000Z";
		const marks = [1, 2, 3].map((n) => ({
			id: `m${n}`,
			number: n,
			shot: "s1",
			comment: `Comment ${n}`,
			author: "user",
			shape: { kind: "note", at: { x: 40, y: 60 + n * 20 } },
			crop: `crops/m${n}.webp`,
			element: null,
			resolution: { kind: "fixed", at },
		}));
		const c = {
			format: CASE_FORMAT,
			id: "c_collapse",
			title: "Collapse first",
			createdAt: at,
			updatedAt: at,
			page: {
				url: `${h.base}/v1`,
				title: "Members",
				lang: "en",
				viewport: { width: 1280, height: 800, dpr: 2 },
				userAgent: "test",
			},
			shots: [
				{
					id: "s1",
					image: "shots/s1.webp",
					scrollX: 0,
					scrollY: 0,
					viewport: { width: 1280, height: 800, dpr: 2 },
					capturedAt: at,
				},
			],
			marks,
		} as unknown as Case;
		await putCases(h, [c]);
		const panel = await panelHome(h);
		await openCase(panel, "Collapse first");
		await panel.waitFor(`${row("m1")}?.dataset.status === "fixed"`);
		// The tester's tab on the case's page: its marks offer Verify (DEC-079).
		const v1 = await h.open("v1");
		await v1.page.activate();
		await panel.waitFor(`${row("m1")}?.querySelector('.head-verify')`);
		await panel.click(`${row("m1")}.querySelector(".mark-toggle")`);
		await panel.waitFor(`${row("m1")}.hasAttribute("data-open")`);
		await panel.click(
			`${row("m1")}.querySelector('.body [data-mark-action="verify"]')`,
		);
		// The state, not the time: stored as verified, then the next row is open.
		await until(
			async () =>
				(await storedCases()).find((x) => x.id === c.id)?.marks[0]?.resolution
					?.verified,
			(verified) => verified !== undefined,
		);
		await panel.waitFor(
			`${row("m2")}?.hasAttribute("data-open") && ${row("m2")}?.hasAttribute("data-picked")`,
		);
		await panel.waitFor(`!${row("m1")}.hasAttribute("data-open")`);
		expect(await panel.eval<string>(`${row("m1")}.dataset.status`)).toBe(
			"verified",
		);
		await v1.page.send("Page.close");
	}, 60_000);

	test("the mark a Verify opens is shown on the page in front, as its Show would; one of another page only opens, the tab stays", async () => {
		const { page, tabId } = await h.open("v1");
		await showToolbar(h, page, tabId);
		await markElement(page, "[data-truth=submit]", "Too pale");
		// Below the filler: shown means the page scrolled to it.
		await markElement(page, "[data-truth=contact]", "Hard to find");
		// Named below, with the rest of the case as the test wants it.
		const caseId = await marksIn(page);
		await page.send("Page.close");
		const made = (await storedCases()).find((c) => c.id === caseId);
		const [first, second] = made?.marks ?? [];
		if (made === undefined || first === undefined || second === undefined)
			throw new Error("not saved");
		// Both fixed, and a third mark to verify on /v2.
		const at = "2026-11-25T10:00:00.000Z";
		const fixed = { kind: "fixed", at };
		const c = {
			...made,
			title: "Shown next",
			shots: [
				...made.shots,
				{
					id: "s_v2",
					image: "shots/s_v2.webp",
					scrollX: 0,
					scrollY: 0,
					viewport: { width: 1280, height: 800, dpr: 2 },
					capturedAt: at,
					url: `${h.base}/v2`,
				},
			],
			marks: [
				...made.marks.map((m) => ({ ...m, resolution: fixed })),
				{
					id: "m_v2",
					number: 3,
					shot: "s_v2",
					comment: "On the other page",
					author: "user",
					shape: { kind: "note", at: { x: 40, y: 80 } },
					crop: "crops/m_v2.webp",
					element: null,
					resolution: fixed,
				},
			],
		} as unknown as Case;
		await putCases(h, [c]);
		const panel = await panelHome(h);
		await openCase(panel, "Shown next");
		const v1 = await h.open("v1");
		await v1.page.activate();
		// Drawn on the tab: the second mark's Show shows it here, nothing shown yet.
		await panel.waitFor(
			`${row(second.id)}?.querySelector('[data-action="show"]:not([data-loads])') && ${row(first.id)}.querySelector('.head-verify')`,
			15_000,
		);
		const outlined = shadow('[data-review="2"] [data-element]');
		expect(await v1.page.eval(`${outlined} === null`)).toBe(true);
		expect(await v1.page.eval<number>("scrollY")).toBe(0);

		await panel.click(`${row(first.id)}.querySelector('.head-verify')`);
		await panel.waitFor(`${row(second.id)}?.hasAttribute("data-open")`);
		// On the page: scrolled to it and outlined, as Show does.
		await v1.page.waitFor(`${outlined} !== null`);
		expect(
			await v1.page.eval<boolean>(
				`(() => { const r = document.querySelector("[data-truth=contact]").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`,
			),
		).toBe(true);
		// The panel's focus is where a Verify puts it: the opened row's head.
		expect(
			await panel.eval<boolean>(
				`document.activeElement === ${row(second.id)}.querySelector(".mark-toggle")`,
			),
		).toBe(true);

		// The next is on /v2: its row opens, the tab is not taken there.
		await panel.click(
			`${row(second.id)}.querySelector('.body [data-mark-action="verify"]')`,
		);
		await panel.waitFor(
			`${row("m_v2")}?.hasAttribute("data-open") && ${row("m_v2")}.hasAttribute("data-away")`,
		);
		await Bun.sleep(500);
		expect(
			await panel.eval<string>(
				`chrome.tabs.get(${v1.tabId}).then((t) => t.pendingUrl || t.url)`,
			),
		).toBe(`${h.base}/v1`);
		await v1.page.send("Page.close");
	}, 90_000);
});
