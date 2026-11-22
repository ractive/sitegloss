/**
 * End to end: each mark goes into the case as soon as it is done, without a
 * save step (DEC-014); "New case for this page" creates the case at once and opens
 * it, and a case left untouched goes again (DEC-026).
 */

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import type { Page } from "./browser.ts";
import { browserBinary, type Harness, startHarness } from "./harness.ts";
import {
	countColour,
	type Db,
	imagesOf,
	markElement,
	openCase,
	panelHome,
	READ_DB,
	renameInPanel,
	resetPanel,
	saveAs,
	shadow,
	showToolbar,
	until,
	worker,
} from "./steps.ts";

const status = `${shadow('[data-role="status"]')}?.textContent`;
const alert = `${shadow('[data-role="alert"]')}?.textContent`;

/** The mark numbers drawn on the page: drafts, and those in the case (fainter). */
/**
 * The marks on the page: drafts, and the case's own (fainter while adding to
 * it, or drawn by the loaded case: opening a case draws it, DEC-022).
 */
const drawn = (page: Page) =>
	page.eval<{ drafts: string[]; saved: string[] }>(`(() => {
		const svg = ${shadow("svg.marks")};
		const all = [...svg.querySelectorAll("g[data-number]")].filter((g) => g.closest("[data-review]") === null);
		const numbers = (saved) => all.filter((g) => (g.closest(".saved") !== null) === saved).map((g) => g.dataset.number);
		const review = [...svg.querySelectorAll("[data-review]")].map((g) => g.dataset.review);
		const saved = [...new Set([...numbers(true), ...review])].sort((a, b) => a - b);
		return { drafts: numbers(false), saved };
	})()`);

/** Until the page draws these marks (the loaded case follows a change a moment later). */
const drawnAre = async (
	page: Page,
	want: { drafts: string[]; saved: string[] },
) => {
	const json = JSON.stringify(want);
	const got = await until(
		() => drawn(page),
		(now) => JSON.stringify(now) === json,
	).catch(() => drawn(page));
	expect(got).toEqual(want);
};

const pressEscape = async (page: Page) => {
	for (const type of ["keyDown", "keyUp"])
		await page.send("Input.dispatchKeyEvent", {
			type,
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
		});
};

/** The toolbar's buttons, by what they say. */
const buttons = (page: Page) =>
	page.eval<string[]>(
		`[...${shadow(".toolbar")}.querySelectorAll("button")].map((b) => b.textContent).filter(Boolean)`,
	);

describe.skipIf(browserBinary === undefined)("adding marks to a case", () => {
	let h: Harness;

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	// No page of a test before, the control page (a panel too) on Home.
	beforeEach(() => resetPanel(h));

	/** The toolbar is up on the tab, as the page says. */
	const toolbarUp = (tabId: number) =>
		h.control.eval<boolean>(
			`chrome.tabs.sendMessage(${tabId}, { type: "overlay:state" }).then((s) => s.visible)`,
		);

	const caseTitled = async (title: string) => {
		const db = await h.control.eval<Db>(READ_DB);
		const c = db.cases.find((x) => x.title === title);
		if (c === undefined) throw new Error(`no case ${title}`);
		return { c, db };
	};

	/** Take a case out of the store behind the panel's back; answers it to put back. */
	async function takeOut(caseId: string): Promise<object> {
		return h.control.eval<object>(`new Promise((resolve, reject) => {
			const open = indexedDB.open("sitegloss");
			open.onsuccess = () => {
				const tx = open.result.transaction("cases", "readwrite");
				const cases = tx.objectStore("cases");
				const get = cases.get(${JSON.stringify(caseId)});
				get.onsuccess = () => cases.delete(${JSON.stringify(caseId)});
				tx.oncomplete = () => resolve(get.result);
				tx.onerror = () => reject(tx.error);
			};
		})`);
	}

	async function putBack(value: object): Promise<void> {
		await h.control.eval(`new Promise((resolve, reject) => {
			const open = indexedDB.open("sitegloss");
			open.onsuccess = () => {
				const tx = open.result.transaction("cases", "readwrite");
				tx.objectStore("cases").put(${JSON.stringify(value)});
				tx.oncomplete = () => resolve(true);
				tx.onerror = () => reject(tx.error);
			};
		})`);
	}

	/** A case with one mark, saved from the toolbar, and the toolbar closed. */
	async function savedCase(title: string) {
		const v1 = await h.open("v1");
		await showToolbar(h, v1.page, v1.tabId);
		await markElement(v1.page, "h1", "First");
		await saveAs(v1.page, title);
		await v1.page.click(shadow('[data-action="close"]'));
		await until(
			() => toolbarUp(v1.tabId),
			(up) => !up,
		);
		// The panel back on Home: the next case it opens is the next toolbar's.
		await Bun.sleep(600);
		await h.control.eval(
			`document.getElementById("back").hidden || document.getElementById("back").click()`,
		);
		await h.control.waitFor(`!document.getElementById("home").hidden`);
		return v1;
	}

	/** "Add marks" in the side panel's case view. */
	async function addMarks(
		page: Page,
		title: string,
		says = `Adding to “${title}”`,
	): Promise<Page> {
		await page.activate();
		const panel = await panelHome(h);
		await openCase(panel, title);
		await page.activate();
		// The case's marks follow it to the page (DEC-022): drawn before the
		// toolbar comes, as a person's click on Add marks would find them.
		const { c } = await caseTitled(title);
		const tabId = await h.control.eval<number>(
			`chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t.id)`,
		);
		await until(
			() =>
				h.control.eval<string | null>(
					`chrome.tabs.sendMessage(${tabId}, { type: "overlay:state" }).then((s) => s.loadedCase ?? null, () => null)`,
				),
			(loaded) => loaded === c.id,
		);
		await panel.eval(`document.getElementById("add-marks").click()`);
		await page.waitFor(`${status} === ${JSON.stringify(says)}`);
		return panel;
	}

	test("Add marks puts each mark into the case as it is done, with no save step", async () => {
		const { page, tabId } = await savedCase("Straight in");
		const panel = await addMarks(page, "Straight in");
		const shown = await buttons(page);
		expect(shown).toContain("Done");
		// A new case starts with All cases, then New case for this page (DEC-023).
		expect(shown).not.toContain("New case");
		expect(shown.some((b) => b.startsWith("Save"))).toBe(false);
		expect(shown).not.toContain("Back");

		await markElement(page, "[data-truth=submit]", "Too pale");
		await page.waitFor(`${status} === "Mark 2 added to “Straight in”"`, 20_000);
		await drawnAre(page, { drafts: [], saved: ["1", "2"] });
		// The case view follows.
		await panel.waitFor(`document.querySelectorAll(".mark").length === 2`);

		// A comment closed with Escape keeps its mark: it goes in too. Nothing
		// moved: it shares the screenshot of mark 2, and its shot shows both.
		await page.click(shadow('[data-action="tool-note"]'));
		await page.click(`document.querySelector("[data-truth=tip]")`);
		await page.waitFor(shadow(".popover textarea"));
		await page.type("Say how much");
		await pressEscape(page);
		await page.waitFor(`${status} === "Mark 3 added to “Straight in”"`, 20_000);
		await panel.waitFor(`document.querySelectorAll(".mark").length === 3`);

		const { c, db } = await caseTitled("Straight in");
		expect(c.marks.map((a) => [a.number, a.comment, a.shot])).toEqual([
			[1, "First", "s1"],
			[2, "Too pale", "s2"],
			[3, "Say how much", "s3"],
		]);
		expect(imagesOf(db, c.id)).toEqual([
			"crops/a1.webp",
			"crops/a2.webp",
			"crops/a3.webp",
			"shots/s1.webp",
			"shots/s2.webp",
			"shots/s3.webp",
		]);
		// Mark 2's pin is on mark 3's screenshot too, as one save would show it.
		const MARK: [number, number, number] = [229, 25, 95];
		expect(
			await countColour(h.control, "Straight in", "shots/s3.webp", MARK),
		).toBeGreaterThan(
			await countColour(h.control, "Straight in", "shots/s2.webp", MARK),
		);
		// The page's picture waits for the next mark while the toolbar is up.
		expect(db.images.some((i) => i.key.includes("/pending/"))).toBe(true);

		await page.click(shadow('[data-action="close"]'));
		await until(
			() => toolbarUp(tabId),
			(up) => !up,
		);
		await until(
			() => h.control.eval<Db>(READ_DB),
			(now) => !now.images.some((i) => i.key.includes("/pending/")),
		);
		await page.send("Page.close");
	}, 90_000);

	test("Undo after an add takes the mark out of the case, and its number comes back", async () => {
		const { page } = await savedCase("Taken back");
		const panel = await addMarks(page, "Taken back");
		await markElement(page, "[data-truth=submit]", "Undo me");
		await page.waitFor(`${status} === "Mark 2 added to “Taken back”"`, 20_000);
		await panel.waitFor(`document.querySelectorAll(".mark").length === 2`);

		await page.click(shadow('[data-action="undo"]'));
		await page.waitFor(
			`${status} === "Mark 2 taken out of “Taken back”"`,
			20_000,
		);
		await drawnAre(page, { drafts: [], saved: ["1"] });
		await panel.waitFor(`document.querySelectorAll(".mark").length === 1`);
		const { c, db } = await caseTitled("Taken back");
		expect(c.marks.map((a) => a.number)).toEqual([1]);
		expect(c.shots.map((s) => s.id)).toEqual(["s1"]);
		expect(imagesOf(db, c.id)).toEqual(["crops/a1.webp", "shots/s1.webp"]);
		// Nothing more to take back: the saved case is not this toolbar's to undo.
		expect(
			await page.eval<boolean>(`${shadow('[data-action="undo"]')}.disabled`),
		).toBe(true);

		await markElement(page, "[data-truth=tip]", "Instead");
		await page.waitFor(`${status} === "Mark 2 added to “Taken back”"`, 20_000);
		const after = await caseTitled("Taken back");
		expect(after.c.marks.map((a) => [a.number, a.comment, a.shot])).toEqual([
			[1, "First", "s1"],
			[2, "Instead", "s2"],
		]);

		// Shown again, Undo reaches no mark of the earlier session.
		await page.click(shadow('[data-action="close"]'));
		await addMarks(page, "Taken back");
		expect(
			await page.eval<boolean>(`${shadow('[data-action="undo"]')}.disabled`),
		).toBe(true);
		await page.click(shadow('[data-action="close"]'));
		await page.send("Page.close");
	}, 90_000);

	test("a mark that could not be added stays on the page, says why, and is added on a second try", async () => {
		const { page, tabId } = await savedCase("Gone for a moment");
		await addMarks(page, "Gone for a moment");
		const { c } = await caseTitled("Gone for a moment");
		const stored = await takeOut(c.id);

		await markElement(page, "[data-truth=submit]", "Kept anyway");
		await page.waitFor(`${alert}?.startsWith("Mark 2 was not added")`, 20_000);
		expect(await page.eval<string>(alert)).toContain("no longer exists");
		expect(
			await page.eval<string>(
				`${shadow('[data-role="alert"]')}.getAttribute("role")`,
			),
		).toBe("alert");
		expect(await page.eval<string>(status)).toBe(
			"Mark 2 is not in “Gone for a moment” yet",
		);
		await drawnAre(page, { drafts: ["2"], saved: ["1"] });
		expect(await buttons(page)).toContain("Add mark 2");

		// Done tries once more, and stays while the mark is not in the case.
		await page.click(shadow('[data-action="close"]'));
		await page.waitFor(
			`${alert} === "Mark 2 is not in the case yet: Add mark 2, or Done again to discard it."`,
			20_000,
		);
		expect(await toolbarUp(tabId)).toBe(true);

		await putBack(stored);
		await page.click(shadow('[data-action="retry"]'));
		await page.waitFor(
			`${status} === "Mark 2 added to “Gone for a moment”"`,
			20_000,
		);
		expect(await page.eval<string>(alert)).toBe("");
		await drawnAre(page, { drafts: [], saved: ["1", "2"] });
		expect(await buttons(page)).not.toContain("Add mark 2");
		const after = await caseTitled("Gone for a moment");
		expect(after.c.marks.map((a) => a.comment)).toEqual([
			"First",
			"Kept anyway",
		]);
		await page.click(shadow('[data-action="close"]'));
		await until(
			() => toolbarUp(tabId),
			(up) => !up,
		);
		await page.send("Page.close");
	}, 90_000);

	test("Done again discards a mark that could not be added", async () => {
		const { page, tabId } = await savedCase("Discarded");
		await addMarks(page, "Discarded");
		const { c } = await caseTitled("Discarded");
		const stored = await takeOut(c.id);
		await markElement(page, "[data-truth=submit]", "Never stored");
		await page.waitFor(`${alert}?.startsWith("Mark 2 was not added")`, 20_000);
		await page.click(shadow('[data-action="close"]'));
		await page.waitFor(
			`${alert}?.includes("Done again to discard it")`,
			20_000,
		);
		await page.click(shadow('[data-action="close"]'));
		await until(
			() => toolbarUp(tabId),
			(up) => !up,
		);
		await putBack(stored);
		// Shown again, the mark is gone, and nothing was added meanwhile.
		await addMarks(page, "Discarded");
		await drawnAre(page, { drafts: [], saved: ["1"] });
		expect((await caseTitled("Discarded")).c.marks).toHaveLength(1);
		await page.click(shadow('[data-action="close"]'));
		await page.send("Page.close");
	}, 90_000);

	test("a mark that failed for one case does not go into another one unasked", async () => {
		// One tab per address: the harness finds a tab by its address.
		await (await savedCase("Case B")).page.send("Page.close");
		const { page } = await savedCase("Case A");
		await addMarks(page, "Case A");
		const a = (await caseTitled("Case A")).c;
		const stored = await takeOut(a.id);
		await markElement(page, "[data-truth=submit]", "Meant for A");
		await page.waitFor(`${alert}?.startsWith("Mark 2 was not added")`, 20_000);

		// The side panel switches the toolbar to case B.
		await putBack(stored);
		await addMarks(page, "Case B", "Mark 2 is not in “Case B” yet");
		await page.waitFor(`${alert}?.includes("it was for “Case A”")`, 10_000);
		await Bun.sleep(1500);
		const b = (await caseTitled("Case B")).c;
		expect(b.marks.map((x) => x.comment)).toEqual(["First"]);
		expect((await caseTitled("Case A")).c.marks).toHaveLength(1);
		// B's own mark is on the page: opening B drew it (DEC-022).
		await drawnAre(page, { drafts: ["2"], saved: ["1"] });

		// "Add mark 2" is the user's choice: then it goes into B.
		await page.click(shadow('[data-action="retry"]'));
		await page.waitFor(`${status} === "Mark 2 added to “Case B”"`, 20_000);
		expect((await caseTitled("Case B")).c.marks.map((x) => x.comment)).toEqual([
			"First",
			"Meant for A",
		]);
		await page.click(shadow('[data-action="close"]'));
		await page.send("Page.close");
	}, 90_000);

	/** The panel's case view shows `title`, with the toolbar adding to it. */
	const inCase = (panel: Page, title: string) =>
		panel.waitFor(
			`!document.getElementById("case-view").hidden && document.querySelector("#case-view .case-title")?.textContent === ${JSON.stringify(title)} && document.getElementById("add-marks").textContent === "Done adding"`,
			10_000,
		);

	/** The case open in the panel, as stored. */
	const openOne = async (panel: Page) => {
		const caseId = await panel.eval<string>(
			`document.getElementById("verdict")?.dataset.case`,
		);
		const db = await h.control.eval<Db>(READ_DB);
		const c = db.cases.find((x) => x.id === caseId);
		if (c === undefined) throw new Error(`no case ${caseId}`);
		return c;
	};

	/** "New case for this page" in the panel, on the tab `page` in front. */
	async function startNewCase(page: Page): Promise<Page> {
		await page.activate();
		const panel = h.control;
		await panel.waitFor(
			`!document.getElementById("home").hidden && !document.getElementById("new-case").disabled && document.getElementById("page").textContent.endsWith(new URL(${JSON.stringify(await page.eval<string>("location.href"))}).pathname)`,
			10_000,
		);
		await panel.eval(`document.getElementById("new-case").click()`);
		return panel;
	}

	test("New case for this page creates the case and opens it; a mark goes in without a save; Rename (DEC-026)", async () => {
		const { page, tabId } = await h.open("v1");
		const panel = await startNewCase(page);
		// At once: the page's title, the case view, the toolbar adding to it.
		const title = "Krankenkasse vergleichen (v1)";
		await inCase(panel, title);
		await page.waitFor(
			`${status} === ${JSON.stringify(`Adding to “${title}”`)}`,
		);
		expect(await buttons(page)).not.toContain("Save case…");
		expect(await buttons(page)).toContain("Done");
		await panel.waitFor(
			`document.getElementById("tab-line").textContent === "Adding marks: draw on the page. Each mark is saved into this case when its comment is done."`,
		);
		const made = { c: await openOne(panel) };
		expect(made.c.marks).toEqual([]);
		expect(made.c.shots).toEqual([]);
		expect(made.c.page.url).toBe(`${h.base}/v1`);
		expect(made.c.page.title).toBe(title);
		expect(made.c.page.viewport.width).toBeGreaterThan(0);

		// A mark with its comment: in the case and in the panel's list, no save.
		await markElement(page, "[data-truth=submit]", "Too pale");
		await page.waitFor(
			`${status} === ${JSON.stringify(`Mark 1 added to “${title}”`)}`,
			20_000,
		);
		await panel.waitFor(
			`[...document.querySelectorAll(".mark")].map((a) => a.textContent).join().includes("Too pale")`,
			10_000,
		);

		// Rename: where the title is shown; Escape leaves it, Enter stores it.
		await panel.eval(`document.getElementById("rename-case").click()`);
		await panel.waitFor(`document.activeElement?.id === "rename-field"`);
		const typeTitle = (text: string, key: string) =>
			panel.eval(`(() => {
				const f = document.getElementById("rename-field");
				f.value = ${JSON.stringify(text)};
				f.dispatchEvent(new Event("input"));
				f.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, cancelable: true }));
			})()`);
		await typeTitle("Not this", "Escape");
		await panel.waitFor(`document.getElementById("rename").hidden`);
		expect((await openOne(panel)).title).toBe(title);
		await panel.eval(`document.getElementById("rename-case").click()`);
		await typeTitle("   ", "Enter");
		await panel.waitFor(
			`document.getElementById("rename-hint").textContent === "A case needs a title."`,
		);
		expect(
			await panel.eval<boolean>(
				`document.getElementById("rename-save").disabled`,
			),
		).toBe(true);
		await typeTitle("Submit button contrast", "Enter");
		await inCase(panel, "Submit button contrast");
		// The toolbar follows, the list and the store have it.
		await page.waitFor(`${status} === "Adding to “Submit button contrast”"`);
		const renamed = await caseTitled("Submit button contrast");
		expect(renamed.c.id).toBe(made.c.id);
		expect(renamed.c.marks.map((a) => a.comment)).toEqual(["Too pale"]);

		// The next mark goes into it under its new title.
		await markElement(page, "h1", "Too long");
		await page.waitFor(
			`${status} === "Mark 2 added to “Submit button contrast”"`,
			20_000,
		);
		await page.click(shadow('[data-action="close"]'));
		await until(
			() => toolbarUp(tabId),
			(up) => !up,
		);
		await page.send("Page.close");
	}, 90_000);

	test("a link added, edited and removed in the case view is stored at once (DEC-028)", async () => {
		const { page } = await savedCase("Linked");
		const panel = await panelHome(h);
		await openCase(panel, "Linked");
		const linkOf = async () => (await caseTitled("Linked")).c.link;
		const anchor = `document.getElementById("case-link-open")`;
		const edit = `document.getElementById("case-link-edit")`;
		await panel.waitFor(
			`${edit}.textContent === "Add a link" && ${anchor}.hidden`,
		);
		const typeLink = (text: string, key: string) =>
			panel.eval(`(() => {
				const f = document.getElementById("case-link-field");
				f.value = ${JSON.stringify(text)};
				f.dispatchEvent(new Event("input"));
				f.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, cancelable: true }));
			})()`);
		const form = `document.getElementById("case-link-form")`;

		// Text that is no link keeps the form open and says why; nothing stored.
		await panel.eval(`${edit}.click()`);
		await panel.waitFor(`document.activeElement?.id === "case-link-field"`);
		await typeLink("javascript:alert(1)", "Enter");
		await panel.waitFor(
			`document.getElementById("case-link-hint").textContent === "A link starts with https:// or http://"`,
		);
		expect(await panel.eval<boolean>(`${form}.hidden`)).toBe(false);
		expect(await linkOf()).toBeUndefined();

		// Added: stored, an anchor to it, and Edit has the focus again.
		const ticket = "https://tickets.example.com/browse/ABC-123";
		await typeLink(ticket, "Enter");
		await panel.waitFor(
			`${form}.hidden && ${anchor}.getAttribute("href") === ${JSON.stringify(ticket)} && !${anchor}.hidden`,
		);
		expect(await linkOf()).toBe(ticket);
		expect(
			await panel.eval<string[]>(
				`[${anchor}.target, ${anchor}.rel, ${anchor}.textContent, ${edit}.textContent, document.activeElement?.id]`,
			),
		).toEqual([
			"_blank",
			"noopener noreferrer",
			"tickets.example.com/browse/ABC-123",
			"Edit",
			"case-link-edit",
		]);

		// Edited: the field starts with the stored link; Escape keeps it.
		await panel.eval(`${edit}.click()`);
		await panel.waitFor(
			`document.getElementById("case-link-field").value === ${JSON.stringify(ticket)}`,
		);
		await typeLink("https://example.com/not-this", "Escape");
		await panel.waitFor(`${form}.hidden`);
		expect(await linkOf()).toBe(ticket);
		const pr = "https://code.example.com/pull/7";
		await panel.eval(`${edit}.click()`);
		await typeLink(pr, "Enter");
		await panel.waitFor(
			`${anchor}.getAttribute("href") === ${JSON.stringify(pr)}`,
		);
		expect(await linkOf()).toBe(pr);

		// Saved empty: gone from the store and from the view.
		await panel.eval(`${edit}.click()`);
		await typeLink("   ", "Enter");
		await panel.waitFor(
			`${form}.hidden && ${anchor}.hidden && !${anchor}.hasAttribute("href") && ${edit}.textContent === "Add a link"`,
		);
		expect(await linkOf()).toBeUndefined();
		await page.send("Page.close");
	}, 60_000);

	test("All cases with no mark: the case goes again; with one mark it stays (DEC-026)", async () => {
		const { page, tabId } = await h.open("v1");
		const title = "Krankenkasse vergleichen (v1)";
		let panel = await startNewCase(page);
		await inCase(panel, title);
		const first = await openOne(panel);
		await allCases(panel);
		await home(panel);
		await until(
			() => toolbarUp(tabId),
			(up) => !up,
		);
		await until(
			() => h.control.eval<Db>(READ_DB),
			(db) => !db.cases.some((c) => c.id === first.id),
		);
		await panel.waitFor(
			`![...document.querySelectorAll("[data-case]")].some((e) => e.dataset.case === ${JSON.stringify(first.id)})`,
		);

		// Done adding, then back, with no mark: gone too.
		panel = await startNewCase(page);
		await inCase(panel, title);
		const second = await openOne(panel);
		await panel.eval(`document.getElementById("add-marks").click()`);
		await panel.waitFor(
			`document.getElementById("add-marks").textContent === "Add marks"`,
		);
		await allCases(panel);
		await home(panel);
		await until(
			() => h.control.eval<Db>(READ_DB),
			(db) => !db.cases.some((c) => c.id === second.id),
		);

		// A mark, then Undo: it has had a mark, so it is the user's and stays,
		// empty (review of PR 57).
		panel = await startNewCase(page);
		await inCase(panel, title);
		const third = await openOne(panel);
		await markElement(page, "h1", "Undone");
		await page.waitFor(`${status}?.startsWith("Mark 1 added to")`, 20_000);
		await page.click(shadow('[data-action="undo"]'));
		await page.waitFor(`${status}?.startsWith("Mark 1 taken out of")`, 20_000);
		expect((await openOne(panel)).marks).toEqual([]);
		await allCases(panel);
		await home(panel);
		await panel.waitFor(
			`[...document.querySelectorAll("[data-case]")].some((e) => e.dataset.case === ${JSON.stringify(third.id)})`,
		);
		const undone = (await h.control.eval<Db>(READ_DB)).cases.find(
			(c) => c.id === third.id,
		);
		expect(undone?.marks).toEqual([]);
		expect(undone?.lastNumber).toBe(0);

		// One mark: it stays, and shows in the list.
		panel = await startNewCase(page);
		await inCase(panel, title);
		await markElement(page, "h1", "Kept");
		await page.waitFor(`${status}?.startsWith("Mark 1 added to")`, 20_000);
		const kept = await openOne(panel);
		await allCases(panel);
		await home(panel);
		await panel.waitFor(
			`[...document.querySelectorAll("[data-case]")].some((e) => e.dataset.case === ${JSON.stringify(kept.id)})`,
		);
		const db = await h.control.eval<Db>(READ_DB);
		expect(db.cases.find((c) => c.id === kept.id)?.marks).toHaveLength(1);
		await page.send("Page.close");
	}, 120_000);

	/** Make the panel's `chrome.tabs.sendMessage` go through `body` (until it is reloaded). */
	const wrapSend = (body: string) =>
		h.control.eval(
			`(() => { const send = chrome.tabs.sendMessage.bind(chrome.tabs); chrome.tabs.sendMessage = (tabId, message) => (${body})(tabId, message, send); })()`,
		);

	test("New case for this page stays with the tab it was clicked for (review of PR 57)", async () => {
		const a = await h.open("v1");
		const b = await h.open("v2");
		// Sitegloss runs on the tab already: one question, no injection on the
		// way (each would count against the 5 s the page has to answer).
		await h.control.eval(
			`chrome.scripting.executeScript({ target: { tabId: ${a.tabId} }, files: ["content.js"] })`,
		);
		// The page answers when the test says so: once the other tab is in
		// front. A hold the test never released ends far inside the 5 s the
		// page has, and fails the test saying so.
		await wrapSend(`async (tabId, message, send) => {
			if (message.type === "page:info")
				await new Promise((release) => {
					globalThis.releaseInfo = release;
					setTimeout(() => {
						globalThis.heldTooLong = true;
						release();
					}, 3000);
				});
			return send(tabId, message);
		}`);
		const panel = await startNewCase(a.page);
		await h.control.waitFor(`typeof globalThis.releaseInfo === "function"`);
		await b.page.activate();
		const windowId = await h.control.eval<number>(
			`chrome.tabs.get(${a.tabId}).then((t) => t.windowId)`,
		);
		await until(
			() =>
				h.control.eval<number | undefined>(
					`chrome.tabs.query({ active: true, windowId: ${windowId} }).then(([t]) => t?.id)`,
				),
			(front) => front === b.tabId,
		);
		await h.control.eval("globalThis.releaseInfo()");
		if (await h.control.eval<boolean>("globalThis.heldTooLong === true"))
			throw new Error(
				"page:info was not released by the test within 3 s: the hold ended by itself",
			);
		// No content script on the tab yet: no toolbar either.
		const upOn = (tabId: number) =>
			h.control.eval<boolean>(
				`chrome.tabs.sendMessage(${tabId}, { type: "overlay:state" }).then((s) => s.visible, () => false)`,
			);
		await until(
			() => upOn(a.tabId),
			(up) => up,
			10_000,
		).catch(async (error: unknown) => {
			const said = await panel.eval<string>(
				`document.getElementById("hint").textContent + " | " + (document.getElementById("case-hint")?.textContent ?? "")`,
			);
			throw new Error(
				`no toolbar on the tab clicked for; the panel says: ${said}`,
				{ cause: error },
			);
		});
		expect(await upOn(b.tabId)).toBe(false);
		expect(
			await panel.eval<string>(`document.getElementById("hint").textContent`),
		).not.toContain("did not answer");
		const made = await openOne(panel);
		expect(made.page.url).toBe(`${h.base}/v1`);
		expect(made.title).toBe("Krankenkasse vergleichen (v1)");
		await a.page.send("Page.close");
		await b.page.send("Page.close");
	}, 60_000);

	test("the first mark's draw meeting a busy page is drawn once it is free (review of PR 57)", async () => {
		const { page } = await h.open("v1");
		// The page says it is busy at the first draw, as while the next
		// mark's screenshot is taken.
		await wrapSend(`(tabId, message, send) => {
			if (message.type === "case:load" && !globalThis.saidBusy) {
				globalThis.saidBusy = true;
				return Promise.resolve({ error: "The user is marking this page right now; try again in a moment.", busy: true });
			}
			return send(tabId, message);
		}`);
		const panel = await startNewCase(page);
		await inCase(panel, "Krankenkasse vergleichen (v1)");
		await markElement(page, "h1", "Too long");
		await panel.waitFor(
			`globalThis.saidBusy && document.getElementById("case-hint").textContent.includes("1 of 1 marks found")`,
			20_000,
		);
		expect(
			await panel.eval<string>(
				`document.getElementById("case-hint").textContent`,
			),
		).not.toContain("try again in a moment");
		await page.send("Page.close");
	}, 60_000);

	test("a page that does not answer: said under the button, which works again (review of PR 57)", async () => {
		const { page, tabId } = await h.open("v1");
		await wrapSend(`(tabId, message, send) =>
			message.type === "page:info" && globalThis.mute ? new Promise(() => {}) : send(tabId, message)`);
		await h.control.eval("globalThis.mute = true");
		const panel = await startNewCase(page);
		await panel.waitFor(
			`document.getElementById("hint").textContent === "This page did not answer. Reload it and try again."`,
			15_000,
		);
		expect(
			await panel.eval<boolean>(`document.getElementById("new-case").disabled`),
		).toBe(false);
		// The button works again once the page answers.
		await h.control.eval("globalThis.mute = false");
		await panel.eval(`document.getElementById("new-case").click()`);
		await inCase(panel, "Krankenkasse vergleichen (v1)");
		await until(
			() => toolbarUp(tabId),
			(up) => up,
		);
		await page.send("Page.close");
	}, 60_000);

	test("a toolbar button pressed while the toolbar draws itself again still takes the click", async () => {
		const { page, tabId } = await h.open("v1");
		const panel = await startNewCase(page);
		await inCase(panel, "Krankenkasse vergleichen (v1)");
		const pen = shadow('[data-action="tool-pen"]');
		const at = await page.centreOf(pen);
		await page.mouse("mouseMoved", at.x, at.y);
		await page.mouse("mousePressed", at.x, at.y);
		// Between press and release the toolbar draws itself again: a rename.
		const before = await page.eval<string>(
			`${shadow('[data-role="status"]')}.textContent`,
		);
		await h.control.eval(
			`chrome.tabs.sendMessage(${tabId}, { type: "overlay:title", caseId: document.getElementById("verdict").dataset.case, title: "Renamed under the press" })`,
		);
		await page.waitFor(
			`${shadow('[data-role="status"]')}.textContent !== ${JSON.stringify(before)}`,
		);
		await page.mouse("mouseReleased", at.x, at.y);
		await page.waitFor(`${pen}.getAttribute("aria-pressed") === "true"`, 5000);
		await page.send("Page.close");
	}, 60_000);

	test("an empty case whose toolbar holds a comment on another tab stays when left (review of PR 57)", async () => {
		const a = await h.open("v1");
		let panel = await startNewCase(a.page);
		await inCase(panel, "Krankenkasse vergleichen (v1)");
		const made = await openOne(panel);
		// A mark whose comment is still being typed: on the page only.
		await a.page.click(shadow('[data-action="tool-note"]'));
		await a.page.click(`document.querySelector("h1")`);
		await a.page.waitFor(shadow(".popover textarea"));
		await a.page.type("Still typing");
		// The panel opened again on another tab knows nothing of that toolbar.
		const b = await h.open("v2");
		await b.page.activate();
		panel = await panelHome(h);
		const item = `document.querySelector('[data-case="${made.id}"]')`;
		await panel.waitFor(item);
		await panel.eval(`${item}.click()`);
		await panel.waitFor(
			`document.getElementById("verdict")?.dataset.case === "${made.id}"`,
		);
		await allCases(panel);
		await home(panel);
		await Bun.sleep(1000);
		const db = await h.control.eval<Db>(READ_DB);
		expect(db.cases.some((c) => c.id === made.id)).toBe(true);
		expect(
			await a.page.eval<string>(`${shadow(".popover textarea")}.value`),
		).toBe("Still typing");
		await b.page.send("Page.close");
		await a.page.send("Page.close");
	}, 60_000);

	test("left without a mark, the user's case stays: renamed, or a summary typed and not saved (review of PR 57)", async () => {
		const { page } = await h.open("v1");
		const stays = async (id: string) =>
			(await h.control.eval<Db>(READ_DB)).cases.some((c) => c.id === id);

		// Renamed.
		let panel = await startNewCase(page);
		await inCase(panel, "Krankenkasse vergleichen (v1)");
		const renamed = await openOne(panel);
		await renameInPanel(panel, renamed.id, "Checkout bugs");
		await allCases(panel);
		await home(panel);
		await Bun.sleep(1000);
		expect(await stays(renamed.id)).toBe(true);

		// A summary typed and not saved.
		panel = await startNewCase(page);
		await inCase(panel, "Krankenkasse vergleichen (v1)");
		const typed = await openOne(panel);
		await panel.eval(`(() => {
			const v = document.getElementById("verdict");
			v.value = "Make it darker";
			v.dispatchEvent(new Event("input"));
		})()`);
		await panel.waitFor(`!document.getElementById("save-verdict").hidden`);
		await allCases(panel);
		await home(panel);
		await Bun.sleep(1000);
		expect(await stays(typed.id)).toBe(true);
		await page.send("Page.close");
	}, 60_000);

	test("the tab closed while the case has a mark: the case stays open (review of PR 57)", async () => {
		const { page } = await h.open("v1");
		const panel = await startNewCase(page);
		await inCase(panel, "Krankenkasse vergleichen (v1)");
		await markElement(page, "h1", "Kept");
		await page.waitFor(`${status}?.startsWith("Mark 1 added")`, 20_000);
		const made = await openOne(panel);
		await page.send("Page.close");
		await Bun.sleep(1500);
		expect(
			await panel.eval<string | undefined>(
				`document.getElementById("case-view").hidden ? undefined : document.getElementById("verdict")?.dataset.case`,
			),
		).toBe(made.id);
		expect(
			(await h.control.eval<Db>(READ_DB)).cases.some((c) => c.id === made.id),
		).toBe(true);
		await allCases(panel);
		await home(panel);
	}, 60_000);

	test("the tab closed with an untouched case's toolbar: the case goes, the panel on Home (DEC-026)", async () => {
		const { page } = await h.open("v1");
		const panel = await startNewCase(page);
		await inCase(panel, "Krankenkasse vergleichen (v1)");
		const made = await openOne(panel);
		await page.send("Page.close");
		await home(panel);
		await until(
			() => h.control.eval<Db>(READ_DB),
			(db) => !db.cases.some((c) => c.id === made.id),
		);
	}, 60_000);

	test("the case deleted elsewhere while adding: the toolbar goes, the panel on Home (DEC-026)", async () => {
		const { page, tabId } = await h.open("v1");
		const panel = await startNewCase(page);
		const title = "Krankenkasse vergleichen (v1)";
		await inCase(panel, title);
		await markElement(page, "h1", "In it");
		await page.waitFor(`${status}?.startsWith("Mark 1 added to")`, 20_000);
		const c = await openOne(panel);
		// Deleted as an AI app's delete_case or another window does it: the
		// store, then the news.
		await takeOut(c.id);
		await worker(h).then((w) =>
			w.eval(
				`chrome.runtime.sendMessage({ type: "cases:changed", caseId: ${JSON.stringify(c.id)} })`,
			),
		);
		await home(panel);
		await until(
			() => toolbarUp(tabId),
			(up) => !up,
		);
		expect(
			await h.control.eval<string | null>(
				`chrome.tabs.sendMessage(${tabId}, { type: "overlay:state" }).then((s) => s.target?.caseId ?? null)`,
			),
		).toBeNull();
		// No mark was lost: nothing is said.
		expect(
			await panel.eval<boolean>(`document.getElementById("hint").hidden`),
		).toBe(true);
		await page.send("Page.close");
	}, 60_000);

	test("the case deleted elsewhere with a mark not in it yet: that loss is said (DEC-026)", async () => {
		const { page, tabId } = await h.open("v1");
		const panel = await startNewCase(page);
		const title = "Krankenkasse vergleichen (v1)";
		await inCase(panel, title);
		const c = await openOne(panel);
		await takeOut(c.id);
		await markElement(page, "h1", "Lost");
		await page.waitFor(`${alert}?.startsWith("Mark 1 was not added")`, 20_000);
		await worker(h).then((w) =>
			w.eval(
				`chrome.runtime.sendMessage({ type: "cases:changed", caseId: ${JSON.stringify(c.id)} })`,
			),
		);
		await home(panel);
		// What Home says instead, if it does not say this.
		const said = `“${title}” was deleted, and 1 mark not in it yet is gone with it.`;
		await panel
			.waitFor(
				`document.getElementById("hint").textContent === ${JSON.stringify(said)}`,
				10_000,
			)
			.catch(async () => {
				const hint = await panel.eval<string>(
					`document.getElementById("hint").textContent`,
				);
				throw new Error(`Home says ${JSON.stringify(hint)}, not ${said}`);
			});
		await until(
			() => toolbarUp(tabId),
			(up) => !up,
		);
		await page.send("Page.close");
	}, 60_000);

	/**
	 * "← All cases" in the panel, as a person clicks it: a click within half
	 * a second of one it did something else for counts as that double click.
	 */
	const allCases = async (panel: Page) => {
		await Bun.sleep(600);
		await panel.eval(`document.getElementById("back").click()`);
	};
	const home = (panel: Page) =>
		panel.waitFor(`!document.getElementById("home").hidden`, 10_000);

	test("Add marks, then All cases: no toolbar, no marks, and New case for this page starts another case", async () => {
		const { page, tabId } = await savedCase("Closed after adding");
		const panel = await addMarks(page, "Closed after adding");
		await markElement(page, "[data-truth=submit]", "Second");
		await page.waitFor(
			`${status} === "Mark 2 added to “Closed after adding”"`,
			20_000,
		);
		await drawnAre(page, { drafts: [], saved: ["1", "2"] });

		await allCases(panel);
		await home(panel);
		await until(
			() => toolbarUp(tabId),
			(up) => !up,
		);
		// The case's marks leave the page, its toolbar is no longer its.
		await drawnAre(page, { drafts: [], saved: [] });
		await panel.waitFor(
			`document.getElementById("new-case").textContent === "New case for this page"`,
		);
		expect(
			await h.control.eval<string | null>(
				`chrome.tabs.sendMessage(${tabId}, { type: "overlay:state" }).then((s) => s.target?.caseId ?? null)`,
			),
		).toBeNull();

		await panel.eval(`document.getElementById("new-case").click()`);
		await inCase(panel, "Krankenkasse vergleichen (v1)");
		await page.waitFor(
			`${status} === "Adding to “Krankenkasse vergleichen (v1)”"`,
		);
		await markElement(page, "h1", "Another case's");
		await page.waitFor(
			`${status} === "Mark 1 added to “Krankenkasse vergleichen (v1)”"`,
			20_000,
		);
		expect((await caseTitled("Closed after adding")).c.marks).toHaveLength(2);
		expect((await openOne(panel)).marks.map((a) => a.comment)).toEqual([
			"Another case's",
		]);
		await page.click(shadow('[data-action="close"]'));
		await page.send("Page.close");
	}, 90_000);

	test("All cases after a blocked one: the page decides, a later mark that fails blocks again", async () => {
		const { page, tabId } = await savedCase("Blocked once");
		const panel = await addMarks(page, "Blocked once");
		const { c } = await caseTitled("Blocked once");
		const leaveHint = `document.getElementById("leave-hint")`;
		let stored = await takeOut(c.id);
		await markElement(page, "[data-truth=submit]", "Second");
		await page.waitFor(`${alert}?.startsWith("Mark 2 was not added")`, 20_000);
		await allCases(panel);
		await panel.waitFor(
			`!${leaveHint}.hidden && ${leaveHint}.textContent.startsWith("1 mark is not in the case yet")`,
			20_000,
		);

		// The mark goes in after all: the panel says nothing more about it.
		await putBack(stored);
		await page.click(shadow('[data-action="retry"]'));
		await page.waitFor(
			`${status} === "Mark 2 added to “Blocked once”"`,
			20_000,
		);
		await panel.waitFor(`${leaveHint}.hidden`, 10_000);

		// Much later a mark fails again: the first click finishes, it does not
		// discard.
		stored = await takeOut(c.id);
		await markElement(page, "[data-truth=tip]", "Third");
		await page.waitFor(`${alert}?.startsWith("Mark 3 was not added")`, 20_000);
		await allCases(panel);
		await panel.waitFor(
			`!${leaveHint}.hidden && ${leaveHint}.textContent.startsWith("1 mark is not in the case yet")`,
			20_000,
		);
		expect(await toolbarUp(tabId)).toBe(true);
		await drawnAre(page, { drafts: ["3"], saved: ["1", "2"] });
		await putBack(stored);
		// The second click leaves without it.
		await allCases(panel);
		await home(panel);
		await until(
			() => toolbarUp(tabId),
			(up) => !up,
		);
		expect(
			(await caseTitled("Blocked once")).c.marks.map((a) => a.comment),
		).toEqual(["First", "Second"]);
		await page.send("Page.close");
	}, 120_000);

	test("All cases with a mark not in the case: the panel stays and says so; again leaves without it", async () => {
		const { page, tabId } = await savedCase("Left behind");
		const panel = await addMarks(page, "Left behind");
		const { c } = await caseTitled("Left behind");
		const stored = await takeOut(c.id);
		await markElement(page, "[data-truth=submit]", "Not in it");
		await page.waitFor(`${alert}?.startsWith("Mark 2 was not added")`, 20_000);

		await allCases(panel);
		await panel.waitFor(
			`document.getElementById("leave-hint")?.textContent === "1 mark is not in the case yet; the toolbar on the page says why. Click All cases again to leave without it."`,
			20_000,
		);
		expect(
			await panel.eval<boolean>(`document.getElementById("case-view").hidden`),
		).toBe(false);
		expect(await toolbarUp(tabId)).toBe(true);
		await putBack(stored);

		await allCases(panel);
		await home(panel);
		await until(
			() => toolbarUp(tabId),
			(up) => !up,
		);
		await drawnAre(page, { drafts: [], saved: [] });
		expect((await caseTitled("Left behind")).c.marks).toHaveLength(1);
		await page.send("Page.close");
	}, 90_000);
});
