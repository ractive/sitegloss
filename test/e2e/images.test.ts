/**
 * End to end: an image added to a mark in the side panel (DEC-058), where
 * only a real browser can tell. A picture pasted into the dialog is decoded
 * and re-encoded by the browser's canvas, kept as WebP with its longest side
 * at 2048 px, and shown on the mark after its screenshot.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { openSidePanel } from "./ai.ts";
import type { Page } from "./browser.ts";
import {
	browserBinary,
	type Harness,
	inFullSet,
	startHarness,
} from "./harness.ts";
import {
	type Db,
	markElement,
	parkControl,
	READ_DB,
	saveAs,
	shadow,
} from "./steps.ts";

const id = (name: string) => `document.getElementById(${JSON.stringify(name)})`;

inFullSet("images added to a mark", () => {
	let h: Harness;
	let panel: Page;
	let page: Page;

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
		await parkControl(h);
		({ page } = await h.open("v1"));
		await page.activate();
		panel = await openSidePanel(h);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	test("a pasted picture is kept as WebP of at most 2048 px and shown after the mark's screenshot", async () => {
		await panel.waitFor(`!${id("new-case")}.disabled`);
		await panel.eval(`${id("new-case")}.click()`);
		await page.waitFor(shadow('[data-action="tool-box"]'));
		await markElement(page, "h1", "The menu closes before it can be marked");
		await saveAs(page, "Images on a mark", panel);
		await panel.eval(`${id("add-marks")}.click()`);
		await panel.waitFor(
			`${id("add-marks")}.textContent === "Add marks"`,
			20_000,
		);
		await panel.eval(`document.querySelector(".mark-toggle").click()`);
		await panel.waitFor(
			`document.querySelector('.mark[data-open] [data-picture="screenshot"] button.tile[data-action=zoom]')`,
		);
		await panel.click(`document.querySelector('[data-action="add-image"]')`);
		await panel.waitFor(`document.querySelector("dialog.add-images[open]")`);
		// A wide PNG, pasted as the clipboard of a screenshot tool gives it.
		await panel.eval(`(async () => {
			const canvas = new OffscreenCanvas(3000, 1500);
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = "#3366cc";
			ctx.fillRect(0, 0, 3000, 1500);
			const png = await canvas.convertToBlob({ type: "image/png" });
			const data = new DataTransfer();
			data.items.add(new File([png], "menu.png", { type: "image/png" }));
			document.activeElement.dispatchEvent(
				new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
			);
		})()`);
		await panel.waitFor(
			`document.querySelector(".add-images-list li span")?.textContent === "Image 1, 2048 × 1024"`,
			10_000,
		);
		await panel.click(
			`document.querySelector('.add-images [data-action="add"]')`,
		);
		await panel.waitFor(
			`!document.querySelector("dialog.add-images") && document.querySelectorAll(".mark[data-open] .pictures figure").length === 2`,
			10_000,
		);
		expect(
			await panel.eval<string[]>(
				`[...document.querySelectorAll(".mark[data-open] .pictures button.tile[data-action=zoom]")].map((b) => b.getAttribute("aria-label"))`,
			),
		).toEqual([
			"Screenshot of mark 1, taken by Sitegloss",
			"Image 1 of 1 on mark 1",
		]);
		const db = await panel.eval<
			Db & { cases: { marks: { images?: { image: string }[] }[] }[] }
		>(READ_DB);
		const c = db.cases[0];
		const path = c?.marks[0]?.images?.[0]?.image as string;
		expect(path).toMatch(/^images\/i_[0-9a-f]{16}\.webp$/);
		expect(db.images.find((i) => i.key === `${c?.id}/${path}`)?.type).toBe(
			"image/webp",
		);
		// The stored file is the re-encoded one, at 2048 px.
		expect(
			await panel.eval<number[]>(`new Promise((resolve) => {
				const open = indexedDB.open("sitegloss");
				open.onsuccess = () => {
					const get = open.result.transaction("images").objectStore("images").get(${JSON.stringify(`${c?.id}/${path}`)});
					get.onsuccess = () => resolve([get.result.width, get.result.height]);
				};
			})`),
		).toEqual([2048, 1024]);
	}, 120_000);
});
