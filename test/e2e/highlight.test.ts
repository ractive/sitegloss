/**
 * End to end: the Highlight tool (DEC-066). A browser's selection and its
 * client rects are the thing under test: the drag selects the page's text
 * through the layer that takes the pointer, the mark keeps the text and its
 * line boxes, and loaded again after a reload it is drawn on the text's
 * lines. What the text and the lines are made of is highlight.test.ts's.
 */

import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import type { Case } from "../../src/lib/case.ts";
import {
	browserBinary,
	type Harness,
	inFullSet,
	startHarness,
} from "./harness.ts";
import {
	comment,
	type Db,
	marksIn,
	READ_DB,
	resetPanel,
	shadow,
	showToolbar,
	until,
} from "./steps.ts";

inFullSet("the Highlight tool", () => {
	let h: Harness;

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	beforeEach(() => resetPanel(h));

	test("a dragged selection becomes a mark with its text and lines, drawn on the text again after a reload", async () => {
		const { page, tabId } = await h.open("demo");
		await showToolbar(h, page, tabId);
		// The page hears a press on its link: none may reach it.
		await page.eval(`(() => {
			globalThis.pagePresses = 0;
			for (const type of ["mousedown", "click"])
				document.querySelector(".pp-lead").addEventListener(type, () => globalThis.pagePresses++);
		})()`);
		await page.click(shadow('[data-action="tool-highlight"]'));
		await page.waitFor(
			`${shadow('[data-action="tool-highlight"]')}.getAttribute("aria-pressed") === "true"`,
		);
		// From "wekend" to the end of the line: the quote's place in the lead.
		const at = await page.eval<{
			from: { x: number; y: number };
			to: { x: number; y: number };
		}>(`(() => {
			const p = document.querySelector(".pp-lead");
			const node = p.firstChild;
			const start = node.data.indexOf("wekend");
			const end = node.data.indexOf(" from 8 am");
			const r = document.createRange();
			r.setStart(node, start);
			r.setEnd(node, start + 1);
			const a = r.getClientRects()[0];
			r.setStart(node, end - 1);
			r.setEnd(node, end);
			const rects = r.getClientRects();
			const b = rects[rects.length - 1];
			return {
				from: { x: a.left + 1, y: a.top + a.height / 2 },
				to: { x: b.right - 1, y: b.top + b.height / 2 },
			};
		})()`);
		await page.drag(at.from, at.to);
		// The dialog opens at the selection, the stroke drawn as a preview.
		await page.waitFor(shadow('[data-action="comment-done"]'));
		expect(
			await page.eval<number>(
				`${shadow(".ink")}.querySelectorAll("[data-stroke]").length`,
			),
		).toBeGreaterThan(0);
		await comment(page, "Typo: weekend");
		const caseId = await marksIn(page);
		const db = await until(
			() => h.control.eval<Db>(READ_DB),
			(d) => d.cases.find((c) => c.id === caseId)?.marks.length === 1,
		);
		const c = db.cases.find((x) => x.id === caseId) as unknown as Case;
		const mark = c.marks[0];
		expect(mark?.shape.kind).toBe("box");
		expect(mark?.highlight?.text).toBe(
			"wekend: pick up a bike at the trailhead",
		);
		expect(
			mark?.highlight?.before?.endsWith("Ride the forest trails this "),
		).toBe(true);
		expect(mark?.highlight?.after?.startsWith(" from 8 am")).toBe(true);
		expect(mark?.highlight?.rects.length).toBeGreaterThanOrEqual(1);
		expect(mark?.element?.tag).toBe("p");
		expect(await page.eval<number>("globalThis.pagePresses")).toBe(0);

		// A double click takes a word: the browser's click count, which
		// pointerdown does not carry.
		const word = await page.eval<{ x: number; y: number }>(`(() => {
			const node = document.querySelector(".pp-lead").firstChild;
			const i = node.data.indexOf("forest");
			const r = document.createRange();
			r.setStart(node, i + 2);
			r.setEnd(node, i + 3);
			const a = r.getClientRects()[0];
			return { x: a.left + a.width / 2, y: a.top + a.height / 2 };
		})()`);
		await page.mouse("mouseMoved", word.x, word.y);
		for (const clickCount of [1, 2])
			for (const type of ["mousePressed", "mouseReleased"])
				await page.send("Input.dispatchMouseEvent", {
					type,
					x: word.x,
					y: word.y,
					button: "left",
					buttons: type === "mousePressed" ? 1 : 0,
					clickCount,
				});
		await page.waitFor(shadow('[data-action="comment-done"]'));
		await comment(page, "Wood, not forest");
		const words = await until(
			() => h.control.eval<Db>(READ_DB),
			(d) => d.cases.find((x) => x.id === caseId)?.marks.length === 2,
		);
		const second = (words.cases.find((x) => x.id === caseId) as unknown as Case)
			.marks[1];
		expect(second?.highlight?.text).toBe("forest");

		// Another visit: the case loaded on the page again is drawn on the
		// text's lines, found.
		await page.eval("location.reload()");
		await page.waitFor(
			`document.readyState === "complete" && !!document.querySelector(".pp-lead")`,
		);
		const loaded = await h.control.eval<{
			matches: { status: string; textChanged?: true }[];
		}>(
			`chrome.tabs.sendMessage(${tabId}, { type: "case:load", case: ${JSON.stringify(c)} }).catch(() => chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ["content.js"] }).then(() => chrome.tabs.sendMessage(${tabId}, { type: "case:load", case: ${JSON.stringify(c)} })))`,
		);
		expect(loaded.matches[0]?.status).toBe("found");
		expect(loaded.matches[0]?.textChanged).toBeUndefined();
		const drawn = await page.eval<{
			strokes: number;
			top: number;
			text: number;
		}>(`(() => {
			const ink = ${shadow(".ink")};
			const strokes = ink.querySelectorAll('[data-review="1"] [data-stroke]');
			const p = document.querySelector(".pp-lead");
			const r = document.createRange();
			const i = p.firstChild.data.indexOf("wekend");
			r.setStart(p.firstChild, i);
			r.setEnd(p.firstChild, i + 6);
			return {
				strokes: strokes.length,
				top: strokes[0]?.getBoundingClientRect().top ?? -1,
				text: r.getClientRects()[0].top,
			};
		})()`);
		expect(drawn.strokes).toBe(mark?.highlight?.rects.length ?? -1);
		expect(Math.abs(drawn.top - drawn.text)).toBeLessThan(6);

		// The fix changed the text in its place: drawn on the new text, probable only (DEC-083).
		await page.eval(
			`(t => { t.data = t.data.replace("wekend", "weekend"); })(document.querySelector(".pp-lead").firstChild)`,
		);
		const fixed = await h.control.eval<{ matches: Record<string, unknown>[] }>(
			`chrome.tabs.sendMessage(${tabId}, { type: "case:load", case: ${JSON.stringify(c)} })`,
		);
		expect(fixed.matches[0]).toMatchObject({
			status: "probable",
			textChanged: true,
			textNear: "reworded",
			textNow: "weekend: pick up a bike at the trailhead",
		});
	}, 60_000);
});
