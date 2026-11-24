/**
 * End to end: each mark goes into the case as soon as it is done, without a
 * save step (DEC-014); "New case for this page" creates the case at once and opens
 * it, and a case left untouched goes again (DEC-026).
 */

import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { type Page, SLOW } from "./browser.ts";
import {
	browserBinary,
	type Harness,
	inBothSets,
	PAST_GUARD_MS,
	startHarness,
} from "./harness.ts";
import { fullTest } from "./mode.ts";
import {
	countColour,
	type Db,
	dialogField,
	imagesOf,
	keyboardTarget,
	markElement,
	openCase,
	panelHome,
	READ_DB,
	resetPanel,
	saveAs,
	shadow,
	showToolbar,
	testWaits,
	typeInField,
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

/**
 * Escape in the open dialog's comment field. Its keydown closes the dialog,
 * and the field's frame goes with it (DEC-064); the keyup comes once the
 * frame is gone, and lands in the page, as a person's does. A keyup Chrome
 * routed to the frame as it went would get no answer from Chrome at all.
 */
const escapeTheField = async (h: Harness, page: Page) => {
	const field = await dialogField(page);
	const key = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };
	await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
	const timeoutMs = 5000 * SLOW;
	await until(
		async () =>
			(await h.browser.targets()).some((t) => t.targetId === field.targetId),
		(there) => !there,
		timeoutMs,
	).catch(() => {
		throw new Error(
			`the comment field's frame is still there ${timeoutMs} ms after Escape`,
		);
	});
	await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
};

/** The toolbar's buttons, by what they say. */
const buttons = (page: Page) =>
	page.eval<string[]>(
		`[...${shadow(".toolbar")}.querySelectorAll("button")].map((b) => b.textContent).filter(Boolean)`,
	);

inBothSets("adding marks to a case", () => {
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
		await Bun.sleep(PAST_GUARD_MS);
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

		// Escape with nothing written takes the mark back, as Cancel does: the
		// dialog goes, no mark is drawn, and the case keeps its two.
		await page.click(shadow('[data-action="tool-note"]'));
		await page.click(`document.querySelector("[data-truth=tip]")`);
		await dialogField(page);
		await escapeTheField(h, page);
		await page.waitFor(`${shadow(".popover")}.hidden`);
		await drawnAre(page, { drafts: [], saved: ["1", "2"] });

		// A comment with words closed with Escape keeps its mark: it goes in
		// too. Nothing moved: it shares the screenshot of mark 2, and its shot
		// shows both.
		await page.click(`document.querySelector("[data-truth=tip]")`);
		await typeInField(page, "Say how much");
		await escapeTheField(h, page);
		await page.waitFor(`${status} === "Mark 3 added to “Straight in”"`, 20_000);
		await panel.waitFor(`document.querySelectorAll(".mark").length === 3`);

		const { c, db } = await caseTitled("Straight in");
		expect(c.marks.map((a) => [a.number, a.comment, a.shot])).toEqual([
			[1, "First", "s1"],
			[2, "Too pale", "s2"],
			[3, "Say how much", "s3"],
		]);
		expect(imagesOf(db, c.id)).toEqual([
			"crops/m1.webp",
			"crops/m2.webp",
			"crops/m3.webp",
			"shots/s1.webp",
			"shots/s2.webp",
			"shots/s3.webp",
		]);
		// Mark 2's pin is on mark 3's screenshot too, as one save would show it.
		const MARK: [number, number, number] = [224, 24, 92];
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

	fullTest(
		"Undo after an add takes the mark out of the case, and its number comes back",
		async () => {
			const { page } = await savedCase("Taken back");
			const panel = await addMarks(page, "Taken back");
			await markElement(page, "[data-truth=submit]", "Undo me");
			await page.waitFor(
				`${status} === "Mark 2 added to “Taken back”"`,
				20_000,
			);
			await panel.waitFor(`document.querySelectorAll(".mark").length === 2`);

			await page.click(shadow('[data-action="undo"]'));
			await page.waitFor(
				`${status} === "Mark 2 deleted from “Taken back”"`,
				20_000,
			);
			await drawnAre(page, { drafts: [], saved: ["1"] });
			await panel.waitFor(`document.querySelectorAll(".mark").length === 1`);
			const { c, db } = await caseTitled("Taken back");
			expect(c.marks.map((a) => a.number)).toEqual([1]);
			expect(c.shots.map((s) => s.id)).toEqual(["s1"]);
			expect(imagesOf(db, c.id)).toEqual(["crops/m1.webp", "shots/s1.webp"]);
			// Nothing more to take back: the saved case is not this toolbar's to undo.
			expect(
				await page.eval<boolean>(`${shadow('[data-action="undo"]')}.disabled`),
			).toBe(true);

			await markElement(page, "[data-truth=tip]", "Instead");
			await page.waitFor(
				`${status} === "Mark 2 added to “Taken back”"`,
				20_000,
			);
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
		},
		90_000,
	);

	fullTest(
		"a mark that could not be added stays on the page, says why, and is added on a second try",
		async () => {
			const { page, tabId } = await savedCase("Gone for a moment");
			await addMarks(page, "Gone for a moment");
			const { c } = await caseTitled("Gone for a moment");
			const stored = await takeOut(c.id);

			await markElement(page, "[data-truth=submit]", "Kept anyway");
			await page.waitFor(
				`${alert}?.startsWith("Mark 2 was not added")`,
				20_000,
			);
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
		},
		90_000,
	);

	/** The panel's case view shows `title`, with the toolbar adding to it. */
	const inCase = (panel: Page, title: string) =>
		panel.waitFor(
			`!document.getElementById("case-view").hidden && document.querySelector("#case-view .case-title")?.textContent === ${JSON.stringify(title)} && document.getElementById("add-marks").textContent === "Adding marks: Done"`,
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

	fullTest(
		"New case for this page creates the case and opens it; a mark goes in without a save; Rename (DEC-026)",
		async () => {
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
			// A link is stored at once too (DEC-028).
			const ticket = "https://tickets.example.com/browse/ABC-123";
			await panel.eval(`document.getElementById("case-link-edit").click()`);
			await panel.waitFor(`document.activeElement?.id === "case-link-field"`);
			await panel.eval(`(() => {
				const f = document.getElementById("case-link-field");
				f.value = ${JSON.stringify(ticket)};
				f.dispatchEvent(new Event("input"));
				f.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
			})()`);
			await until(
				async () => (await caseTitled("Submit button contrast")).c.link,
				(link) => link === ticket,
			);

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
		},
		90_000,
	);

	fullTest(
		"All cases with no mark: the case goes again, also after Done adding (DEC-026)",
		async () => {
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

			await page.send("Page.close");
		},
		60_000,
	);

	/** Make the panel's `chrome.tabs.sendMessage` go through `body` (until it is reloaded). */
	const wrapSend = (body: string) =>
		h.control.eval(
			`(() => { const send = chrome.tabs.sendMessage.bind(chrome.tabs); chrome.tabs.sendMessage = (tabId, message) => (${body})(tabId, message, send); })()`,
		);

	fullTest(
		"a page that does not answer: said under the button, which works again",
		async () => {
			const { page, tabId } = await h.open("v1");
			await wrapSend(`(tabId, message, send) =>
			message.type === "page:info" && globalThis.mute ? new Promise(() => {}) : send(tabId, message)`);
			await h.control.eval("globalThis.mute = true");
			// Not the 5 s a page has to answer: this one is given up on sooner.
			await testWaits(h.control, { pageAnswerMs: 500 });
			const panel = await startNewCase(page);
			await panel.waitFor(
				`document.getElementById("hint").textContent === "This page did not answer. Reload it and try again."`,
				5000,
			);
			expect(
				await panel.eval<boolean>(
					`document.getElementById("new-case").disabled`,
				),
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
		},
		60_000,
	);

	fullTest(
		"left without a mark, the user's case stays when a summary was typed and not saved",
		async () => {
			const { page } = await h.open("v1");
			const stays = async (id: string) =>
				(await h.control.eval<Db>(READ_DB)).cases.some((c) => c.id === id);

			// A summary typed and not saved: the panel's draft counts (a rename is
			// fresh.test.ts's: the stored case says so).
			const panel = await startNewCase(page);
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
			// The list shows only after the untouched case is gone (DEC-026).
			expect(await stays(typed.id)).toBe(true);
			await page.send("Page.close");
		},
		60_000,
	);

	fullTest(
		"the tab closed with an untouched case's toolbar: the case goes, the panel on Home (DEC-026)",
		async () => {
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
		},
		60_000,
	);

	fullTest(
		"the case deleted elsewhere while adding: the toolbar goes, the panel on Home (DEC-026)",
		async () => {
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
		},
		60_000,
	);

	fullTest(
		"the case deleted elsewhere with a mark not in it yet: that loss is said (DEC-026)",
		async () => {
			const { page, tabId } = await h.open("v1");
			const panel = await startNewCase(page);
			const title = "Krankenkasse vergleichen (v1)";
			await inCase(panel, title);
			const c = await openOne(panel);
			await takeOut(c.id);
			await markElement(page, "h1", "Lost");
			await page.waitFor(
				`${alert}?.startsWith("Mark 1 was not added")`,
				20_000,
			);
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
		},
		60_000,
	);

	/**
	 * "← All cases" in the panel, as a person clicks it: a click right after
	 * one it did something else for counts as that double click.
	 */
	const allCases = async (panel: Page) => {
		await Bun.sleep(PAST_GUARD_MS);
		await panel.eval(`document.getElementById("back").click()`);
	};
	const home = (panel: Page) =>
		panel.waitFor(`!document.getElementById("home").hidden`, 10_000);

	fullTest(
		"All cases with a mark not in the case: the panel stays and says so; again leaves without it",
		async () => {
			const { page, tabId } = await savedCase("Left behind");
			const panel = await addMarks(page, "Left behind");
			const { c } = await caseTitled("Left behind");
			const stored = await takeOut(c.id);
			await markElement(page, "[data-truth=submit]", "Not in it");
			await page.waitFor(
				`${alert}?.startsWith("Mark 2 was not added")`,
				20_000,
			);

			await allCases(panel);
			await panel.waitFor(
				`document.getElementById("leave-hint")?.textContent === "1 mark is not in the case yet; the toolbar on the page says why. Click All cases again to leave without it."`,
				20_000,
			);
			expect(
				await panel.eval<boolean>(
					`document.getElementById("case-view").hidden`,
				),
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
		},
		90_000,
	);

	fullTest(
		"Close case with a mark not in the case: nothing is closed, the panel stays and says so",
		async () => {
			const { page, tabId } = await savedCase("Close blocked");
			const panel = await addMarks(page, "Close blocked");
			const { c } = await caseTitled("Close blocked");
			const stored = await takeOut(c.id);
			await markElement(page, "[data-truth=submit]", "Not in it");
			await page.waitFor(
				`${alert}?.startsWith("Mark 2 was not added")`,
				20_000,
			);
			await Bun.sleep(PAST_GUARD_MS);
			await panel.eval(`document.getElementById("close-case").click()`);
			await panel.waitFor(
				`document.getElementById("leave-hint")?.textContent?.startsWith("1 mark is not in the case yet")`,
				20_000,
			);
			expect(
				await panel.eval<boolean>(
					`document.getElementById("case-view").hidden`,
				),
			).toBe(false);
			await putBack(stored);
			expect("closed" in (await caseTitled("Close blocked")).c).toBe(false);
			expect(await toolbarUp(tabId)).toBe(true);
			await page.send("Page.close");
		},
		90_000,
	);

	test("what is typed or pasted in the page's dialog never reaches the page's own scripts (DEC-064)", async () => {
		const { page, tabId } = await h.open("v1");
		// The page's listeners, on window and document, capture phase,
		// before anything of Sitegloss's.
		await page.eval(`(() => {
				globalThis.heard = [];
				const hear = (e) => {
					const d = e.clipboardData ?? e.dataTransfer ?? null;
					const what = [e.key, e.data, d?.getData("text/plain")].filter(Boolean).join(" ");
					if (what) globalThis.heard.push(e.type + ": " + what);
				};
				for (const type of ["keydown", "keypress", "keyup", "beforeinput", "input", "paste", "drop", "copy", "cut"]) {
					window.addEventListener(type, hear, true);
					document.addEventListener(type, hear, true);
				}
			})()`);
		const caseId = await showToolbar(h, page, tabId);
		await page.click(shadow('[data-action="tool-element"]'));
		await page.waitFor(
			`${shadow('[data-action="tool-element"]')}.getAttribute("aria-pressed") === "true"`,
		);
		const at = await page.eval<{ x: number; y: number }>(
			`(() => { const r = document.querySelector("h1").getBoundingClientRect(); return { x: r.x + r.width - 30, y: r.y + r.height / 2 }; })()`,
		);
		await page.mouse("mouseMoved", at.x, at.y);
		await page.clickAt(at.x, at.y);
		await page.waitFor(
			`${shadow(".popover")} && !${shadow(".popover")}.hidden`,
		);
		// A clipboard with a sentence from a ticket.
		await h.browser.send("Browser.grantPermissions", {
			origin: h.base,
			permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
		});
		await page.activate();
		await page.eval(`navigator.clipboard.writeText("from the ticket")`);
		await page.eval("globalThis.heard.length = 0");
		// Keys pressed, then a paste, where the person's keyboard goes.
		const keys = await keyboardTarget(page);
		for (const ch of "Too pale ") {
			const code = ch === " " ? "Space" : `Key${ch.toUpperCase()}`;
			await keys.send("Input.dispatchKeyEvent", {
				type: "keyDown",
				key: ch,
				code,
				text: ch,
				unmodifiedText: ch,
			});
			await keys.send("Input.dispatchKeyEvent", {
				type: "keyUp",
				key: ch,
				code,
			});
		}
		await keys.send("Input.dispatchKeyEvent", {
			type: "rawKeyDown",
			key: "v",
			code: "KeyV",
			windowsVirtualKeyCode: 86,
			modifiers: 4,
			commands: ["paste"],
		});
		await keys.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "v",
			code: "KeyV",
			windowsVirtualKeyCode: 86,
			modifiers: 4,
		});
		await page.click(shadow('[data-action="comment-done"]'));
		const saved = await until(
			async () =>
				(await h.control.eval<Db>(READ_DB)).cases.find((c) => c.id === caseId)
					?.marks[0]?.comment,
			(comment) => comment !== undefined,
			20_000,
		);
		// The comment has it all; the page heard nothing of it.
		expect(saved).toBe("Too pale from the ticket");
		expect(await page.eval<string[]>("globalThis.heard")).toEqual([]);
		await page.send("Page.close");
	}, 60_000);

	fullTest(
		"a page that refuses every frame still gets the comment field: the extension's frame is exempt (DEC-064's review)",
		async () => {
			const { page, tabId } = await h.open("csp");
			const caseId = await showToolbar(h, page, tabId);
			await markElement(page, "h1", "Typed on a strict page");
			// The field came up (no way out offered) and the comment went in.
			const saved = await until(
				async () =>
					(await h.control.eval<Db>(READ_DB)).cases.find((c) => c.id === caseId)
						?.marks[0]?.comment,
				(comment) => comment !== undefined,
				20_000,
			);
			expect(saved).toBe("Typed on a strict page");
			await page.send("Page.close");
		},
		60_000,
	);
});
