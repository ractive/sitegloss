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
			`document.querySelector('.mark[data-open] [data-picture="screenshot"] button.tile[data-action=open-larger]')`,
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
				`[...document.querySelectorAll(".mark[data-open] .pictures button.tile[data-action=open-larger]")].map((b) => b.getAttribute("aria-label"))`,
			),
		).toEqual([
			"Screenshot of mark 1, taken by Sitegloss: shows it large",
			"Image 1 of 1 on mark 1: shows it large",
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
		/** A stored image's size, and whether its bytes hold an EXIF or XMP chunk. */
		const storedAt = (key: string) =>
			panel.eval<[number, number, boolean]>(`new Promise((resolve) => {
				const open = indexedDB.open("sitegloss");
				open.onsuccess = () => {
					const get = open.result.transaction("images").objectStore("images").get(${JSON.stringify("")} + ${JSON.stringify(key)});
					get.onsuccess = async () => {
						const text = new TextDecoder("latin1").decode(await get.result.blob.arrayBuffer());
						resolve([get.result.width, get.result.height, /EXIF|Exif|XMP /.test(text)]);
					};
				};
			})`);
		// The stored file is the re-encoded one, at 2048 px.
		expect(await storedAt(`${c?.id}/${path}`)).toEqual([2048, 1024, false]);

		// A photo's JPEG, 300 × 100, turned a quarter (EXIF Orientation 6), with
		// a GPS tag: kept upright, 100 × 300, and with no metadata at all.
		await panel.click(`document.querySelector('[data-action="add-image"]')`);
		await panel.waitFor(`document.querySelector("dialog.add-images[open]")`);
		await panel.eval(`(async () => {
			const canvas = new OffscreenCanvas(300, 100);
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = "#cc3366";
			ctx.fillRect(0, 0, 300, 100);
			const plain = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg" })).arrayBuffer());
			const tiff = [
				0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8,
				0, 2,
				0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0,
				0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 38,
				0, 0, 0, 0,
				0, 1,
				0, 1, 0, 2, 0, 0, 0, 2, 0x4e, 0, 0, 0,
				0, 0, 0, 0,
			];
			const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
			const length = exif.length + 2;
			const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 255, ...exif, ...plain.subarray(2)]);
			const data = new DataTransfer();
			data.items.add(new File([jpeg], "photo.jpg", { type: "image/jpeg" }));
			document.activeElement.dispatchEvent(
				new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
			);
		})()`);
		await panel.waitFor(
			`document.querySelector(".add-images-list li span")?.textContent === "Image 2, 100 × 300"`,
			10_000,
		);
		await panel.click(
			`document.querySelector('.add-images [data-action="add"]')`,
		);
		await panel.waitFor(
			`!document.querySelector("dialog.add-images") && document.querySelectorAll(".mark[data-open] .pictures figure").length === 3`,
			10_000,
		);
		const after = await panel.eval<
			Db & { cases: { marks: { images?: { image: string }[] }[] }[] }
		>(READ_DB);
		const photo = after.cases[0]?.marks[0]?.images?.[1]?.image as string;
		expect(await storedAt(`${c?.id}/${photo}`)).toEqual([100, 300, false]);
	}, 120_000);
});
