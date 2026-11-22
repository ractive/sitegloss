/**
 * Picking and finding again inside web components, on Chromium's own hit test
 * and with a closed shadow root: happy-dom has neither.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	browserBinary,
	type Harness,
	inFullSet,
	startHarness,
} from "./harness.ts";
import { comment, READ_DB, saveAs, shadow, showToolbar } from "./steps.ts";

interface Stored {
	title: string;
	marks: {
		element: {
			tag: string;
			text?: string;
			ancestors: string[];
			selector: string;
		} | null;
	}[];
}

inFullSet("web components", () => {
	let h: Harness;

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	test("the wheel scrolls a container around a shadow root while a tool is active", async () => {
		const { page, tabId } = await h.open("shadow");
		await showToolbar(h, page, tabId);
		await page.click(shadow('[data-action="tool-box"]'));
		const scroller = `document.getElementById("outer")`;
		const at = await page.centreOf(scroller);
		await page.send("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			// Left of the toolbar, which sits in the middle at the bottom.
			x: 100,
			y: at.y,
			deltaX: 0,
			deltaY: 200,
		});
		await page.waitFor(`${scroller}.scrollTop >= 200`);
		await page.send("Page.close");
	}, 60_000);

	test("a mark in a shadow root is on the button, also on the next visit", async () => {
		const { page, tabId } = await h.open("shadow");
		await showToolbar(h, page, tabId);
		for (const host of ["app-panel", "app-vault", "app-send"]) {
			const pressed = await page.eval<string>(
				`${shadow('[data-action="tool-element"]')}.getAttribute("aria-pressed")`,
			);
			if (pressed !== "true")
				await page.click(shadow('[data-action="tool-element"]'));
			// The button sits inside the component's padding.
			const r = await page.eval<{ x: number; y: number }>(
				`(() => { const r = document.querySelector("${host}").getBoundingClientRect(); return { x: r.x + 60, y: r.y + 60 }; })()`,
			);
			await page.mouse("mouseMoved", r.x, r.y);
			await page.waitFor(
				`Number(${shadow("svg.marks")}.querySelector(".hover")?.getAttribute("width")) < 400`,
			);
			await page.clickAt(r.x, r.y);
			await comment(page, `In ${host}`);
		}
		await saveAs(page, "Components");
		// "Save case…" opens the case in the control page, a panel too
		// (DEC-023): back to the list, so its draw does not meet this one.
		await h.control.waitFor(
			`document.querySelector("#case-view h2")?.textContent === "Components"`,
			10_000,
		);
		await h.control.eval(`document.getElementById("back").click()`);
		await h.control.waitFor(`!document.getElementById("home").hidden`);

		const db = await h.control.eval<{ cases: Stored[] }>(READ_DB);
		const saved = db.cases.find((c) => c.title === "Components");
		const elements = saved?.marks.map((a) => a.element);
		expect(elements?.map((e) => e?.tag)).toEqual([
			"button",
			"button",
			"button",
		]);
		expect(elements?.map((e) => e?.text)).toEqual([
			"Offen speichern",
			"Geschlossen speichern",
			"Offerte senden",
		]);
		expect(elements?.[1]?.ancestors).toEqual(["section", "app-vault", "main"]);
		expect(elements?.map((e) => e?.selector)).toEqual(["", "", ""]);

		const result = await h.control.eval<{
			matches: { status: string; candidates: { summary: string }[] }[];
		}>(
			`chrome.tabs.sendMessage(${tabId}, { type: "case:load", case: ${JSON.stringify(saved)} })`,
		);
		expect(result.matches.map((m) => m.status)).toEqual([
			"found",
			"found",
			"found",
		]);
		expect(result.matches[1]?.candidates[0]?.summary).toContain(
			"Geschlossen speichern",
		);
		// Outlined around the button, not the whole component.
		const widths = await page.eval<number[]>(
			`[...${shadow("svg.marks")}.querySelectorAll("[data-review] rect:not([data-casing])")].map((r) => Number(r.getAttribute("width")))`,
		);
		expect(widths.length).toBe(3);
		expect(Math.max(...widths)).toBeLessThan(400);
	}, 40_000);
});
