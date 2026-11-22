/**
 * A case through the side panel's own buttons and file input: exported,
 * imported with both answers to the prompt, deleted, with the database read
 * after each step. And what a worker that starts again cleans up.
 */

import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readZip } from "../../src/lib/zip.ts";
import { sampleCase } from "../fixtures.ts";
import {
	browserBinary,
	type Harness,
	inBothSets,
	PAST_GUARD_MS,
	startHarness,
} from "./harness.ts";
import { fullTest } from "./mode.ts";
import {
	type Db,
	download,
	downloadShown,
	exportOpenCase,
	imageBytes,
	imagesOf,
	importFile,
	markElement,
	openCase,
	panelHome,
	READ_DB,
	resetPanel,
	restartWorker,
	saveAs,
	showToolbar,
	until,
} from "./steps.ts";

/** Run `body` (an expression using `tx`) in a transaction on the extension's database. */
const write = (body: string) => `new Promise((resolve, reject) => {
	const open = indexedDB.open("sitegloss");
	open.onerror = () => reject(open.error);
	open.onsuccess = () => {
		const tx = open.result.transaction(["cases", "images"], "readwrite");
		tx.oncomplete = () => resolve(true);
		tx.onerror = () => reject(tx.error);
		${body};
	};
})`;

const putImage = (key: string, storedAt?: number) =>
	`tx.objectStore("images").put({ blob: new Blob(["x"], { type: "image/webp" }), width: 1, height: 1${storedAt === undefined ? "" : `, storedAt: ${storedAt}`} }, ${JSON.stringify(key)})`;

inBothSets("a case's way out and back", () => {
	let h: Harness;
	let folder: string;

	const readDb = () => h.control.eval<Db>(READ_DB);

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
		folder = mkdtempSync(join(tmpdir(), "sitegloss-export-"));
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
		rmSync(folder, { recursive: true, force: true });
	});

	// No page of a test before, the control page (a panel too) on Home.
	beforeEach(() => resetPanel(h));

	test("exported, imported with Keep both and with Replace, then deleted", async () => {
		const { page, tabId } = await h.open("v1");
		await showToolbar(h, page, tabId);
		await markElement(page, "[data-truth=submit]", "Too pale");
		await markElement(page, "[data-truth=tip]", "Say how much");
		await saveAs(page, "Round trip");
		await page.send("Page.close");

		const saved = (await readDb()).cases[0];
		if (saved === undefined) throw new Error("not saved");
		const paths = imagesOf(await readDb(), saved.id);
		expect(paths).toContain("crops/m1.webp");
		expect(paths).toContain("crops/m2.webp");
		expect(paths).toContain("shots/s1.webp");

		// Export: the file holds the case and the stored images, byte for byte.
		const panel = await panelHome(h);
		await openCase(panel, "Round trip");
		const file = await exportOpenCase(h, panel);
		// Where it went (DEC-020: the test build has "downloads"): the name
		// Sitegloss gave it, in Chrome's downloads folder, with Copy and Show
		// in folder.
		expect(realpathSync(file)).toBe(
			realpathSync(join(h.browser.downloads, "round-trip.sitegloss.zip")),
		);
		const shown = file;
		// The system's clipboard and file manager stay out of the test.
		await panel.eval(`(() => {
				window.copied = [];
				window.shown = [];
				navigator.clipboard.writeText = (text) => (window.copied.push(text), Promise.resolve());
				chrome.downloads.show = (id) => window.shown.push(id);
			})()`);
		await panel.click(
			`document.querySelector('#export-saved [data-action="copy-path"]')`,
		);
		await panel.waitFor(
			`document.querySelector('#export-saved [data-action="copy-path"]').textContent === "Copied"`,
		);
		expect(await panel.eval<string[]>("window.copied")).toEqual([shown]);
		await panel.click(
			`document.querySelector('#export-saved [data-action="show-file"]')`,
		);
		const [downloadId] = await panel.eval<number[]>("window.shown");
		const [item] = await panel.eval<{ filename: string }[]>(
			`chrome.downloads.search({ id: ${downloadId} })`,
		);
		expect(item?.filename).toBe(shown);
		const zip = await readZip(
			new Uint8Array(await Bun.file(file).arrayBuffer()),
		);
		expect([...zip.keys()].sort()).toEqual(
			["case.json", "case.md", ...paths].sort(),
		);
		const exported = JSON.parse(new TextDecoder().decode(zip.get("case.json")));
		expect(exported.id).toBe(saved.id);
		const bytes = (path: string) =>
			Buffer.from(zip.get(path) ?? []).toString("base64");
		for (const path of paths)
			expect((await imageBytes(h.control, "Round trip", path)).base64).toBe(
				bytes(path),
			);

		// The case is here already, so the panel asks. Keep both: a copy with its images.
		await panelHome(h);
		await importFile(panel, file);
		await panel.waitFor(
			`document.querySelector('[data-action="import-copy"]')`,
		);
		expect(
			await panel.eval<boolean>(
				`document.getElementById("import-prompt").hidden`,
			),
		).toBe(false);
		await panel.click(`document.querySelector('[data-action="import-copy"]')`);
		const both = await until(readDb, (db) => db.cases.length === 2);
		const copy = both.cases.find((c) => c.id !== saved.id);
		if (copy === undefined) throw new Error("no copy");
		expect(copy.title).toBe("Round trip (copy)");
		expect(copy.marks.map((a) => a.comment)).toEqual([
			"Too pale",
			"Say how much",
		]);
		expect(imagesOf(both, copy.id)).toEqual(paths);
		expect(imagesOf(both, saved.id)).toEqual(paths);
		for (const path of paths)
			expect(
				(await imageBytes(h.control, "Round trip (copy)", path)).base64,
			).toBe(bytes(path));

		// Replace: everything the case became since the export is gone.
		await h.control.eval(
			write(`
				tx.objectStore("cases").put({ ...${JSON.stringify(saved)}, title: "Changed since" });
				${putImage(`${saved.id}/crops/m9.webp`)};
				${putImage(`${saved.id}/shots/s1.webp`)};
			`),
		);
		await panelHome(h);
		await importFile(panel, file);
		await panel.waitFor(
			`document.querySelector('[data-action="import-replace"]')`,
		);
		await panel.click(
			`document.querySelector('[data-action="import-replace"]')`,
		);
		const replaced = await until(readDb, (db) =>
			db.cases.some((c) => c.title === "Round trip"),
		);
		expect(replaced.cases).toHaveLength(2);
		expect(imagesOf(replaced, saved.id)).toEqual(paths);
		for (const path of paths)
			expect((await imageBytes(h.control, "Round trip", path)).base64).toBe(
				bytes(path),
			);
		expect(imagesOf(replaced, copy.id)).toEqual(paths);

		// Delete: its screenshots go with it, and the copy's stay.
		await panel.waitFor(`document.getElementById("delete-case")`);
		await panel.click(`document.getElementById("delete-case")`);
		await panel.waitFor(
			`document.getElementById("delete-case")?.textContent === "Really delete?"`,
		);
		await Bun.sleep(PAST_GUARD_MS); // a confirming click this soon counts as a double-click
		await panel.click(`document.getElementById("delete-case")`);
		const left = await until(readDb, (db) => db.cases.length === 1);
		expect(left.cases[0]?.id).toBe(copy.id);
		expect(imagesOf(left, saved.id)).toEqual([]);
		expect(imagesOf(left, copy.id)).toEqual(paths);
		expect(left.images).toHaveLength(paths.length);
	}, 60_000);

	fullTest(
		"without the downloads permission, Export saves the file as before and shows no path",
		async () => {
			const panel = await panelHome(h);
			await openCase(panel, "Round trip (copy)");
			// The buttons say what they do (DEC-020).
			const titled = (ids: string[]) =>
				panel.eval<string[]>(
					`${JSON.stringify(ids)}.filter((id) => !document.getElementById(id)?.title)`,
				);
			expect(await titled(["export-case", "delete-case", "load-case"])).toEqual(
				[],
			);
			// Chrome's prompt answered no.
			await panel.eval(`(() => {
				window.asked = [];
				chrome.permissions.request = (p) => (window.asked.push(p), Promise.resolve(false));
			})()`);
			const into = join(folder, "declined");
			mkdirSync(into);
			const file = await download(
				h,
				panel,
				into,
				`document.getElementById("export-case")`,
			);
			expect(file.endsWith("round-trip-copy.sitegloss.zip")).toBe(true);
			const zip = await readZip(
				new Uint8Array(await Bun.file(file).arrayBuffer()),
			);
			expect(zip.has("case.json")).toBe(true);
			expect(await panel.eval("window.asked")).toEqual([
				{ permissions: ["downloads"] },
			]);
			await Bun.sleep(300);
			expect(
				await panel.eval<boolean>(
					`document.getElementById("export-saved").hidden && !document.getElementById("case-hint").textContent.startsWith("Could not")`,
				),
			).toBe(true);
		},
		30_000,
	);

	fullTest(
		"Export all cases: one file, imported again case by case",
		async () => {
			await h.control.eval(
				write(`
				tx.objectStore("cases").put(${JSON.stringify(sampleCase("c_all1"))});
				tx.objectStore("cases").put(${JSON.stringify({ ...sampleCase("c_all2", "2026-11-05T10:00:00Z"), title: "Second" })});
			`),
			);
			const before = await readDb();
			const panel = await panelHome(h);
			expect(
				await panel.eval<string[]>(
					`["import", "export-all", "stop-ai", "pair-new-address", "pair-replaced-new-address", "pair-take-back", "add-app"].filter((id) => !document.getElementById(id).title)`,
				),
			).toEqual([]);
			expect(
				await panel.eval<string>(
					`document.getElementById("keep-on").closest("label").title`,
				),
			).toContain("Stop AI access");
			const file = await downloadShown(
				h,
				panel,
				`document.getElementById("export-all")`,
				"export-all-saved",
			);
			expect(file).toMatch(/sitegloss-cases-\d{4}-\d\d-\d\d\.sitegloss\.zip$/);
			expect(
				await panel.eval<number>(
					`document.querySelectorAll('#export-all-saved [data-action="copy-path"], #export-all-saved [data-action="show-file"]').length`,
				),
			).toBe(2);
			const zip = await readZip(
				new Uint8Array(await Bun.file(file).arrayBuffer()),
			);
			const folders = [...zip.keys()].filter((n) => n.endsWith("/case.json"));
			expect(folders).toHaveLength(before.cases.length);
			expect(folders).toContain("second/case.json");

			// Into an empty browser: every case comes back, with its images.
			await h.control.eval(
				write(
					`tx.objectStore("cases").clear(); tx.objectStore("images").clear()`,
				),
			);
			await panelHome(h);
			await importFile(panel, file);
			const back = await until(
				readDb,
				(db) => db.cases.length === before.cases.length,
			);
			const ids = (db: Db) => db.cases.map((c) => c.id).sort();
			expect(ids(back)).toEqual(ids(before));
			expect(back.images.map((i) => i.key).sort()).toEqual(
				before.images.map((i) => i.key).sort(),
			);
			await panel.waitFor(
				`document.getElementById("import-done").textContent === "Imported all ${before.cases.length} cases of ${file.split("/").pop()}."`,
			);
			// Again: each one is here already, so each asks; Skip leaves it.
			await importFile(panel, file);
			for (let i = 1; i <= before.cases.length; i++) {
				await panel.waitFor(
					`document.getElementById("import-prompt").textContent.includes("Case ${i} of ${before.cases.length}")`,
				);
				if (i === 1) {
					// While it asks, no other import, and no export of all cases.
					expect(
						await panel.eval<boolean[]>(
							`["import", "export-all"].map((id) => document.getElementById(id).disabled)`,
						),
					).toEqual([true, true]);
					// Another file chosen anyway is not read: the batch goes on.
					await panel.eval(`(() => {
						const input = document.getElementById("import-file");
						const files = new DataTransfer();
						files.items.add(new File(["not a zip"], "other.zip"));
						input.files = files.files;
						input.dispatchEvent(new Event("change"));
					})()`);
					await Bun.sleep(300);
					expect(
						await panel.eval<[boolean, string]>(
							`[document.getElementById("import-error").hidden, document.getElementById("import-prompt").textContent]`,
						),
					).toEqual([true, expect.stringContaining("Case 1 of")]);
				}
				await panel.click(
					`document.querySelector('[data-action="import-cancel"]')`,
				);
			}
			await panel.waitFor(
				`document.getElementById("import-done").textContent.startsWith("Imported 0 of the ${before.cases.length} cases")`,
			);
			expect(
				await panel.eval<boolean[]>(
					`["import", "export-all"].map((id) => document.getElementById(id).disabled)`,
				),
			).toEqual([false, false]);
			expect(ids(await readDb())).toEqual(ids(before));
		},
		60_000,
	);

	fullTest(
		"a worker that starts again sweeps abandoned screenshots, and nothing else",
		async () => {
			const old = "c_gone/pending/p_old.webp";
			const undated = "c_gone/pending/p_undated.webp";
			const recent = "c_gone/pending/p_recent.webp";
			const finished = "c_gone/shots/s1.webp";
			await h.control.eval(
				write(`
				${putImage(old, 1000)};
				${putImage(undated)};
				${putImage(recent, Date.now())};
				${putImage(finished)};
			`),
			);
			const keys = (db: Db) => db.images.map((i) => i.key);
			expect(keys(await readDb())).toContain(old);

			await restartWorker(h);

			const swept = await until(readDb, (db) => !keys(db).includes(old));
			expect(keys(swept)).not.toContain(undated);
			expect(keys(swept)).toContain(recent);
			expect(keys(swept)).toContain(finished);
		},
		30_000,
	);
});
