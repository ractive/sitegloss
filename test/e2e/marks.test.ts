/**
 * End to end: a mark's screenshot is taken when the mark is drawn (DEC-012),
 * on pages that do what real pages do. See extension.test.ts for the basics.
 */

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import type { Mark, Shot } from "../../src/lib/case.ts";
import type { Page } from "./browser.ts";
import {
	browserBinary,
	type Harness,
	opened,
	startHarness,
} from "./harness.ts";
import {
	comment,
	countColour,
	type Db,
	HOST,
	markElement,
	READ_DB,
	resetPanel,
	saveAs,
	shadow,
	showToolbar,
	worker,
} from "./steps.ts";

const BLUE: [number, number, number] = [0, 120, 255];
const GREEN: [number, number, number] = [0, 170, 80];
const ORANGE: [number, number, number] = [240, 150, 0];
const PLAIN: [number, number, number] = [0, 160, 0];
const SECRET: [number, number, number] = [200, 0, 160];
const MARK: [number, number, number] = [229, 25, 95];

describe.skipIf(browserBinary === undefined)(
	"marks and their screenshots",
	() => {
		let h: Harness;

		beforeAll(async () => {
			h = await startHarness(browserBinary as string);
		}, 60_000);

		afterAll(async () => {
			await h?.stop();
		});

		// The control page is a side panel too: it opened the case each toolbar
		// added to (DEC-023), whose marks would follow to the next tab.
		beforeEach(() => resetPanel(h));

		const saved = async (title: string) => {
			const db = await h.control.eval<Db>(READ_DB);
			const c = db.cases.find((x) => x.title === title);
			if (c === undefined) throw new Error(`no case ${title}`);
			return { c, images: db.images };
		};

		const sendToTab = <T>(tabId: number, request: object) =>
			h.control.eval<T>(
				`chrome.tabs.sendMessage(${tabId}, ${JSON.stringify(request)})`,
			);

		let count = 0;
		/** A page in a new tab, with an address no tab closing right now has. */
		const open = (path: string) => h.open(`${path}?tab=${count++}`);

		/** Close a tab without the question unsaved marks ask. */
		const close = (page: Page) =>
			h.browser.send("Target.closeTarget", { targetId: page.targetId });

		/**
		 * Wait until the toolbar's marks are in the case (their screenshots
		 * taken), or a moment where one cannot be (a test's own failure).
		 */
		const shotsTaken = async (tabId: number) => {
			await Bun.sleep(300);
			const end = Date.now() + 8000;
			while (Date.now() < end) {
				const s = await sendToTab<{ drafts: number; saving: boolean }>(tabId, {
					type: "overlay:state",
				});
				if (s.drafts === 0 && !s.saving) return;
				await Bun.sleep(100);
			}
		};

		test("marks in a scrolling container each keep what they were drawn on", async () => {
			const { page, tabId } = await open("app");
			await showToolbar(h, page, tabId);
			await markElement(page, "#near", "near");
			await shotsTaken(tabId);
			await markElement(page, "#far", "far");
			await shotsTaken(tabId);
			await saveAs(page, "Scroller");
			const { c } = await saved("Scroller");
			expect(c.shots).toHaveLength(2);
			expect(
				await countColour(h.control, "Scroller", "crops/a1.webp", BLUE),
			).toBeGreaterThan(1000);
			expect(
				await countColour(h.control, "Scroller", "crops/a2.webp", GREEN),
			).toBeGreaterThan(1000);
			expect(
				await countColour(h.control, "Scroller", "shots/s1.webp", GREEN),
			).toBe(0);
			await close(page);
		}, 60_000);

		test("a mark the page moved away from gets its screenshot by itself once the page stands still, and the page comes back", async () => {
			const { page, tabId } = await open("long");
			await showToolbar(h, page, tabId);
			// An AI app holds the page, so the mark's screenshot has to wait.
			await sendToTab(tabId, { type: "page:blur", blurForms: false });
			await markElement(page, "#near", "drawn at the top");
			await page.eval("window.scrollTo(0, 2400)");
			await markElement(page, "#far", "drawn further down");
			const down = await page.eval<number>("scrollY");
			await sendToTab(tabId, { type: "page:unblur" });
			// Taken again by itself once the page stands still, without Add
			// mark N (DEC-026): saveAs clicks nothing.
			await saveAs(page, "Waited");
			expect(
				await page.eval(`${shadow('[data-action="retry"]')} === null`),
			).toBe(true);
			// The page is back where the user left it.
			expect(await page.eval<number>("scrollY")).toBe(down);
			const { c } = await saved("Waited");
			const shotOf = (n: number) => c.marks.find((a) => a.number === n)?.shot;
			expect(new Set([shotOf(1), shotOf(2)]).size).toBe(2);
			expect(
				await countColour(h.control, "Waited", "crops/a1.webp", BLUE),
			).toBeGreaterThan(1000);
			expect(
				await countColour(h.control, "Waited", "crops/a2.webp", GREEN),
			).toBeGreaterThan(1000);
			expect(
				await countColour(
					h.control,
					"Waited",
					`shots/${shotOf(1)}.webp`,
					GREEN,
				),
			).toBe(0);
			await close(page);
		}, 60_000);

		test("a mark's element is recorded where its screenshot shows it", async () => {
			const { page, tabId } = await open("long");
			await showToolbar(h, page, tabId);
			// An AI app holds the page, so the mark's screenshot has to wait.
			await sendToTab(tabId, { type: "page:blur", blurForms: false });
			const near = await page.eval<{ x: number; y: number }>(
				`(() => { const { x, y } = document.querySelector("#near").getBoundingClientRect(); return { x, y }; })()`,
			);
			await page.click(shadow('[data-action="tool-box"]'));
			await page.drag(
				{ x: near.x + 10, y: near.y + 5 },
				{ x: near.x + 60, y: near.y + 25 },
			);
			await comment(page, "pushed down");
			// Something above pushes the element down before the screenshot.
			await page.eval(
				`document.querySelector("#near").style.marginTop = "200px"`,
			);
			await sendToTab(tabId, { type: "page:unblur" });
			await Bun.sleep(1800);
			await saveAs(page, "Pushed down");
			const { c } = await saved("Pushed down");
			const a = c.marks[0] as Mark;
			const shot = c.shots[0] as Shot;
			if (a.shape.kind !== "box") throw new Error("not a box");
			expect(a.element?.selector).toContain("near");
			expect(
				a.shape.rect.y + shot.scrollY - (a.element?.rect.y ?? 0),
			).toBeCloseTo(5, 0);
			await close(page);
		}, 60_000);

		test("after an undo the next mark does not share a screenshot from elsewhere", async () => {
			const { page, tabId } = await open("long");
			await showToolbar(h, page, tabId);
			await markElement(page, "#near", "at the top");
			await shotsTaken(tabId);
			await markElement(page, "#far", "undone");
			await shotsTaken(tabId);
			await page.click(shadow('[data-action="undo"]'));
			await markElement(page, "#far", "kept");
			await shotsTaken(tabId);
			await saveAs(page, "After undo");
			const { c } = await saved("After undo");
			expect(c.marks.map((a) => a.shot)).toEqual(["s1", "s2"]);
			expect(
				await countColour(h.control, "After undo", "crops/a2.webp", GREEN),
			).toBeGreaterThan(1000);
			await close(page);
		}, 60_000);

		test("a failed screenshot leaves nothing for the next mark to share", async () => {
			const { page, tabId } = await open("long");
			await showToolbar(h, page, tabId);
			await markElement(page, "#near", "at the top");
			await shotsTaken(tabId);
			await page.eval("window.scrollTo(0, 2400)");
			await Bun.sleep(100);
			// The next screenshot fails, with the tab in front and nothing moving.
			await (await worker(h)).eval(`(() => {
			const real = chrome.tabs.captureVisibleTab;
			chrome.tabs.captureVisibleTab = () => {
				chrome.tabs.captureVisibleTab = real;
				return Promise.reject(new Error("no picture"));
			};
		})()`);
			await markElement(page, "#far", "its screenshot fails");
			await page.waitFor(
				`${shadow('[data-role="alert"]')}?.textContent.includes("its screenshot could not be taken (no picture)")`,
				20_000,
			);
			await markElement(page, "#far", "the next one");
			await shotsTaken(tabId);
			// A screenshot that failed waits for the user: Add mark 2.
			await page.click(shadow('[data-action="retry"]'));
			await saveAs(page, "Failed shot");
			const { c } = await saved("Failed shot");
			expect(c.marks[2]?.shot).not.toBe("s1");
			expect(
				await countColour(h.control, "Failed shot", "crops/a3.webp", GREEN),
			).toBeGreaterThan(1000);
			await close(page);
		}, 60_000);

		test("a value typed between two marks is a change of the page", async () => {
			const { page, tabId } = await open("ui");
			await showToolbar(h, page, tabId);
			await markElement(page, "#label", "before");
			await shotsTaken(tabId);
			await page.click(shadow('[data-action="tool-element"]'));
			await page.click(`document.getElementById("plain")`);
			await page.type("X");
			await markElement(page, "#other", "after");
			await shotsTaken(tabId);
			await saveAs(page, "Typed");
			expect((await saved("Typed")).c.shots).toHaveLength(2);
			await close(page);
		}, 60_000);

		test("a second click on Add mark N while its screenshot is awaited adds it once (DEC-026)", async () => {
			const { page, tabId } = await open("long");
			await showToolbar(h, page, tabId);
			// The screenshot fails once: the mark waits for Add mark N.
			await (await worker(h)).eval(`(() => {
			const real = chrome.tabs.captureVisibleTab;
			chrome.tabs.captureVisibleTab = () => {
				chrome.tabs.captureVisibleTab = real;
				return Promise.reject(new Error("no picture"));
			};
		})()`);
			await markElement(page, "#near", "drawn at the top");
			await page.waitFor(
				`${shadow('[data-role="alert"]')}?.textContent.startsWith("Mark 1 was not added: its screenshot could not be taken")`,
				20_000,
			);
			await page.eval(
				`(() => { const b = ${shadow('[data-action="retry"]')}; b.click(); b.click(); })()`,
			);
			await page.waitFor(
				`${shadow('[data-role="status"]')}?.textContent.startsWith("Mark 1 added")`,
				20_000,
			);
			await Bun.sleep(1200);
			const caseId = (
				await sendToTab<{ target: { caseId: string } }>(tabId, {
					type: "overlay:state",
				})
			).target.caseId;
			const db = await h.control.eval<Db>(READ_DB);
			expect(
				db.cases.find((c) => c.id === caseId)?.marks.map((a) => a.number),
			).toEqual([1]);
			await close(page);
		}, 60_000);

		test("a mark without a screenshot from another route is not added, and is kept", async () => {
			const { page, tabId } = await open("app");
			await showToolbar(h, page, tabId);
			// An AI app holds the page, so the mark's screenshot has to wait.
			await sendToTab(tabId, { type: "page:blur", blurForms: false });
			await markElement(page, "#near", "on the first route");
			await page.eval("goToB()");
			await sendToTab(tabId, { type: "page:unblur" });
			await page.waitFor(
				`${shadow('[data-role="alert"]')}?.textContent.includes("another page")`,
				20_000,
			);
			// Add mark 1 says so again: a screenshot of this route would show another.
			await page.click(shadow('[data-action="retry"]'));
			await page.waitFor(
				`${shadow('[data-role="alert"]')}?.textContent.includes("another page")`,
				20_000,
			);
			expect(
				await sendToTab<{ drafts: number }>(tabId, { type: "overlay:state" }),
			).toMatchObject({ drafts: 1 });
			await close(page);
		}, 60_000);

		test("the wheel scrolls a container while a tool is active", async () => {
			const { page, tabId } = await open("app");
			await showToolbar(h, page, tabId);
			await page.click(shadow('[data-action="tool-box"]'));
			await page.send("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: 300,
				y: 300,
				deltaX: 0,
				deltaY: 400,
			});
			await page.waitFor(
				`document.getElementById("scroller").scrollTop >= 400`,
			);
			await close(page);
		}, 60_000);

		test("a mark follows its element when the container scrolls", async () => {
			const { page, tabId } = await open("app");
			await showToolbar(h, page, tabId);
			await markElement(page, "#near", "near");
			const badgeY = () =>
				page.eval<number>(
					`${HOST}.shadowRoot.querySelector("[data-number] circle").getBoundingClientRect().y`,
				);
			const before = await badgeY();
			await page.eval(`document.getElementById("scroller").scrollTop = 100`);
			await page.waitFor(
				`${HOST}.shadowRoot.querySelector("[data-number] circle").getBoundingClientRect().y < ${before - 90}`,
			);
			await close(page);
		}, 60_000);

		test("marks on two routes of an app keep their route and what it showed", async () => {
			const { page, tabId } = await open("app");
			await showToolbar(h, page, tabId);
			await markElement(page, "#near", "on route a");
			await shotsTaken(tabId);
			await page.eval("goToB()");
			await markElement(page, "#route-b", "on route b");
			await shotsTaken(tabId);
			// The first mark's element left with its route: it is not drawn over
			// this one, by the toolbar or by the case drawn on the page.
			const drawn = () =>
				page.eval<string[]>(
					`[...new Set([...${HOST}.shadowRoot.querySelectorAll(".drafts [data-number], .saved [data-number], [data-review]")].map((g) => g.dataset.number ?? g.dataset.review))]`,
				);
			const end = Date.now() + 5000;
			while (JSON.stringify(await drawn()) !== '["2"]' && Date.now() < end)
				await Bun.sleep(100);
			expect(await drawn()).toEqual(["2"]);
			await saveAs(page, "Routes");
			const { c } = await saved("Routes");
			const shots = c.shots as unknown as { url: string }[];
			expect(shots.map((s) => new URL(s.url).pathname)).toEqual([
				"/app",
				"/app/b",
			]);
			expect(
				await countColour(h.control, "Routes", "shots/s1.webp", BLUE),
			).toBeGreaterThan(1000);
			expect(
				await countColour(h.control, "Routes", "shots/s2.webp", ORANGE),
			).toBeGreaterThan(1000);
			expect(c.marks[0]?.element?.text).toBe("Near the top");
			await close(page);
		}, 60_000);

		test("a mark on something that goes away keeps its details and its picture", async () => {
			const { page, tabId } = await open("ui");
			await showToolbar(h, page, tabId);
			await markElement(page, "#item", "the menu item");
			await shotsTaken(tabId);
			await page.eval(`document.getElementById("menu").remove()`);
			await markElement(page, "#label", "the label");
			await shotsTaken(tabId);
			await saveAs(page, "Menu");
			const { c } = await saved("Menu");
			expect(c.marks[0]?.element?.text).toBe("Menu item");
			expect(c.shots).toHaveLength(2);
			expect(
				await countColour(h.control, "Menu", "shots/s1.webp", BLUE),
			).toBeGreaterThan(1000);
			expect(await countColour(h.control, "Menu", "shots/s2.webp", BLUE)).toBe(
				0,
			);
			await close(page);
		}, 60_000);

		test("marks drawn while nothing changed share one capture, each its own copy; undo leaves no trace", async () => {
			const { page, tabId } = await open("ui");
			await showToolbar(h, page, tabId);
			await markElement(page, "#label", "first");
			await shotsTaken(tabId);
			await markElement(page, "#other", "second");
			await markElement(page, "#item", "third");
			await page.click(shadow('[data-action="undo"]'));
			await shotsTaken(tabId);
			await saveAs(page, "Shared");
			const { c, images } = await saved("Shared");
			// Added one by one, each mark has a copy of the one capture (DEC-014).
			expect(c.shots).toHaveLength(2);
			expect(c.marks.map((a) => a.shot)).toEqual(["s1", "s2"]);
			expect(
				images
					.map((i) => i.key)
					.filter((k) => k.startsWith(`${c.id}/pending/`)),
			).toEqual([]);
			// Both marks are on the image, drawn at saving, and the overlay is not.
			expect(
				await countColour(h.control, "Shared", "crops/a1.webp", MARK, 60),
			).toBeGreaterThan(100);
			expect(
				await countColour(h.control, "Shared", "crops/a2.webp", MARK, 60),
			).toBeGreaterThan(100);
			await close(page);
		}, 60_000);

		test("password fields are blurred in a mark's screenshot, form fields as set right now", async () => {
			const shotOf = async (title: string, blur: boolean) => {
				const { page, tabId } = await open("ui");
				await showToolbar(h, page, tabId);
				// Changed with the toolbar up: the setting must reach it.
				await sendToTab(tabId, { type: "overlay:settings", blurForms: blur });
				await markElement(page, "#label", "a mark");
				await shotsTaken(tabId);
				await saveAs(page, title);
				await close(page);
				// Back to the list: the next toolbar's case opens there.
				await h.control.eval(`document.getElementById("back").click()`);
				await h.control.waitFor(`!document.getElementById("home").hidden`);
			};
			await shotOf("Clear", false);
			await shotOf("Blurred", true);
			expect(
				await countColour(h.control, "Clear", "shots/s1.webp", PLAIN),
			).toBeGreaterThan(500);
			expect(
				await countColour(h.control, "Clear", "shots/s1.webp", SECRET),
			).toBe(0);
			// `transition: all 2s` on the field must not fade the blur in too late.
			expect(
				await countColour(h.control, "Blurred", "shots/s1.webp", PLAIN),
			).toBe(0);
		}, 60_000);

		test("an add waits while an AI app holds the page, and goes in after (DEC-026)", async () => {
			const { page, tabId } = await open("ui");
			const caseId = await showToolbar(h, page, tabId);
			await page.click(shadow('[data-action="tool-element"]'));
			await page.click(`document.getElementById("label")`);
			await page.waitFor(shadow(".popover textarea"));
			await shotsTaken(tabId);
			await sendToTab(tabId, { type: "page:blur", blurForms: false });
			await page.type("a mark");
			await page.click(shadow('[data-action="comment-done"]'));
			await Bun.sleep(1000);
			const marks = async () =>
				(await h.control.eval<Db>(READ_DB)).cases.find((c) => c.id === caseId)
					?.marks.length;
			expect(await marks()).toBe(0);
			await sendToTab(tabId, { type: "page:unblur" });
			await page.waitFor(
				`${shadow('[data-role="status"]')}?.textContent.startsWith("Mark 1 added")`,
				20_000,
			);
			expect(await marks()).toBe(1);
			await close(page);
		}, 60_000);

		test("the page hears nothing of the overlay", async () => {
			const { page, tabId } = await open("ui");
			await showToolbar(h, page, tabId);
			await markElement(page, "#label", "a mark");
			const pressEscape = async () => {
				for (const type of ["keyDown", "keyUp"])
					await page.send("Input.dispatchKeyEvent", {
						type,
						key: "Escape",
						code: "Escape",
						windowsVirtualKeyCode: 27,
					});
			};
			await pressEscape(); // the tool goes off; the page's dialog would stay open
			expect(
				await page.eval(
					`${shadow('[data-action="tool-element"]')}.getAttribute("aria-pressed")`,
				),
			).toBe("false");
			expect(await page.eval("heard")).toEqual({
				pointerdown: 0,
				click: 0,
				keydown: 0,
			});
			await close(page);
		}, 60_000);

		test("a focus trap on the page leaves the comment field its focus", async () => {
			const { page, tabId } = await open("ui");
			await page.eval("trapFocus()");
			await showToolbar(h, page, tabId);
			await markElement(page, "#label", "typed despite the trap");
			await shotsTaken(tabId);
			await saveAs(page, "Trap");
			const { c } = await saved("Trap");
			expect(c.marks[0]?.comment).toBe("typed despite the trap");
			await close(page);
		}, 60_000);

		test("the overlay works inside a modal dialog and leaves with it", async () => {
			const { page, tabId } = await open("ui");
			await showToolbar(h, page, tabId);
			await page.eval(`document.getElementById("dialog").showModal()`);
			await page.waitFor(`${HOST}.parentElement.id === "dialog"`);
			await markElement(page, "#in-dialog", "in the dialog");
			await shotsTaken(tabId);
			await saveAs(page, "Dialog");
			const { c } = await saved("Dialog");
			expect(c.marks[0]?.element?.text).toBe("In the dialog");
			await page.eval(`document.getElementById("dialog").close()`);
			await page.waitFor(`${HOST}.parentElement === document.documentElement`);
			await close(page);
		}, 60_000);

		test("saving works on a plain http: host, where crypto.randomUUID does not exist", async () => {
			const url = h.base.replace("127.0.0.1", "sitegloss.test");
			const page = await h.browser.newPage(`${url}/ui?tab=plain`);
			expect(await page.eval("window.isSecureContext")).toBe(false);
			const tabId = await h.control.eval<number>(
				`chrome.tabs.query({}).then((tabs) => tabs.find((t) => t.url?.startsWith(${JSON.stringify(url)}))?.id)`,
			);
			opened.set(page, { h, tabId });
			await showToolbar(h, page, tabId);
			await markElement(page, "#label", "on http");
			await shotsTaken(tabId);
			await saveAs(page, "Plain http");
			expect((await saved("Plain http")).c.marks).toHaveLength(1);
			await close(page);
		}, 60_000);

		test("leaving a page with a mark not in the case yet asks first", async () => {
			const { page, tabId } = await open("ui");
			await showToolbar(h, page, tabId);
			const leaving = () =>
				page.eval<boolean>(
					`(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`,
				);
			expect(await leaving()).toBe(false);
			// An AI app holds the page: the mark waits for its screenshot.
			await sendToTab(tabId, { type: "page:blur", blurForms: false });
			await markElement(page, "#label", "not in yet");
			expect(await leaving()).toBe(true);
			await sendToTab(tabId, { type: "page:unblur" });
			await saveAs(page, "Left");
			expect(await leaving()).toBe(false);
			await close(page);
		}, 60_000);

		test("an AI mark takes the visible copy, and says when it no longer held the page", async () => {
			const { page, tabId } = await open("ui");
			await showToolbar(h, page, tabId);
			const mark = (selector: string) =>
				sendToTab<{ ok: boolean; rect?: { width: number }; error?: string }>(
					tabId,
					{
						type: "element:mark",
						selector,
						number: 1,
						blurForms: false,
					},
				);
			expect((await mark(".only")).error).toContain("is visible");
			const marked = await mark(".copy");
			expect(marked.rect?.width).toBeGreaterThan(0);
			expect(
				await sendToTab(tabId, {
					type: "case:show",
					caseId: "x",
					markId: "a1",
				}),
			).toEqual({
				error: "An AI app is taking a screenshot; try again in a moment.",
			});
			expect(await sendToTab(tabId, { type: "element:unmark" })).toEqual({
				held: true,
			});
			expect(await sendToTab(tabId, { type: "element:unmark" })).toEqual({
				held: false,
			});
			await close(page);
		}, 60_000);

		test("a comment can be finished before its screenshot is there", async () => {
			const { page, tabId } = await open("ui");
			await showToolbar(h, page, tabId);
			await markElement(page, "#label", "one");
			await markElement(page, "#item", "two");
			await saveAs(page, "Fast");
			const { c, images } = await saved("Fast");
			expect(c.marks.map((a) => a.comment)).toEqual(["one", "two"]);
			expect(images.some((i) => i.key.startsWith(`${c.id}/pending/`))).toBe(
				false,
			);
			await close(page);
		}, 60_000);
	},
);
