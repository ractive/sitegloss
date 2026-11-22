/**
 * `overlay:end` on the page's toolbar (DEC-023): the side panel closes the
 * case, and the toolbar finishes as its Done does, then adds to no case any
 * more; a mark that could not be added keeps it up, unless `discard`. The
 * toolbar always adds to a case (DEC-026).
 */

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	expect,
	test,
} from "bun:test";
import { Window } from "happy-dom";
import type { MarkAdder as MarkAdderClass } from "../src/content/adding.ts";
import type { WorkerRequest } from "../src/lib/messages.ts";

const window = new Window({
	url: "https://shop.example/cart",
	width: 1024,
	height: 768,
});
const globals = globalThis as unknown as Record<string, unknown>;
const names = [
	"window",
	"document",
	"location",
	"CSS",
	"CSSStyleSheet",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"MutationObserver",
	"HTMLElement",
	"Element",
	"chrome",
] as const;
const before = Object.fromEntries(names.map((n) => [n, globals[n]]));

/** What the worker answers, by request; the requests it got. */
let answer: (r: WorkerRequest) => object;
const asked: WorkerRequest[] = [];

let MarkAdder: typeof MarkAdderClass;
let PageActivity: typeof import("../src/content/activity.ts").PageActivity;
let PageBlur: typeof import("../src/content/blur.ts").PageBlur;
let Overlay: typeof import("../src/content/overlay.ts").Overlay;

beforeAll(async () => {
	// happy-dom has no hit test: a note on nothing in particular.
	Object.assign(window.document, { elementsFromPoint: () => [] });
	for (const n of names.slice(0, -1))
		globals[n] = n === "window" ? window : (window as never)[n];
	globals["CSS"] ??= { escape: (s: string) => s };
	globals["chrome"] = {
		runtime: {
			sendMessage: async (r: WorkerRequest) => {
				asked.push(r);
				return answer(r);
			},
		},
	};
	({ MarkAdder } = await import("../src/content/adding.ts"));
	({ PageActivity } = await import("../src/content/activity.ts"));
	({ PageBlur } = await import("../src/content/blur.ts"));
	({ Overlay } = await import("../src/content/overlay.ts"));
});

afterAll(() => {
	for (const n of names) globals[n] = before[n];
});

/** A worker that takes every screenshot and every mark. */
const works = (r: WorkerRequest): object => {
	switch (r.type) {
		case "capture":
			return { ok: true, width: 1024, height: 768 };
		case "case:number":
			return { ok: true, free: true, next: r.number + 1 };
		case "case:save":
			return {
				ok: true,
				caseId: r.request.caseId,
				title: r.request.title,
				marks: 1,
			};
		default:
			return { ok: true };
	}
};

/** A worker that takes no screenshot: no mark can be added. */
const noShots = (r: WorkerRequest): object =>
	r.type === "capture"
		? { ok: false, error: "The tab is not in front." }
		: works(r);

beforeEach(() => {
	// A scroll a test left would move the next test's marks under them.
	window.scrollTo(0, 0);
	window.document.body.innerHTML = `<main><p id="text">Some text</p></main>`;
	asked.length = 0;
	answer = works;
});

/** The overlays made: their timers stop after each test. */
const made: InstanceType<typeof Overlay>[] = [];

afterEach(() => {
	for (const overlay of made.splice(0)) overlay.setAddingMarks(false);
});

const target = { caseId: "c_open", title: "Open case", nextMark: 3 };

function adder(): {
	a: MarkAdderClass;
	overlay: InstanceType<typeof Overlay>;
} {
	const doc = window.document as unknown as Document;
	const overlay = new Overlay(doc);
	made.push(overlay);
	// The page stands still after 80 ms, not 800; screenshots 30 ms apart, not 620.
	const a = new MarkAdder(overlay, new PageBlur(doc), new PageActivity(), {
		stillMs: 80,
		shotGapMs: 30,
	});
	return { a, overlay };
}

/** Draw a note and close its comment: it goes into the case the toolbar adds to. */
function note(overlay: InstanceType<typeof Overlay>, a: MarkAdderClass): void {
	a.setTool("note");
	const at = { clientX: 40, clientY: 40, button: 0, pointerId: 1 };
	overlay.capture.dispatchEvent(
		new window.PointerEvent("pointerdown", at) as unknown as Event,
	);
	overlay.capture.dispatchEvent(
		new window.PointerEvent("pointerup", at) as unknown as Event,
	);
	const done = overlay.popover.querySelector<HTMLButtonElement>(
		'[data-action="comment-done"]',
	);
	if (done === null) throw new Error("no comment field");
	done.click();
}

/** Until the queue has added or failed what was drawn. */
const settle = async (a: MarkAdderClass, done: () => boolean) => {
	for (let i = 0; i < 1000 && !done(); i++) await Bun.sleep(5);
	expect(done()).toBe(true);
	return a;
};

test("the target is cleared and the toolbar hidden: it adds to no case until shown for one", async () => {
	const { a, overlay } = adder();
	a.show({ target });
	expect(a.state().target?.caseId).toBe("c_open");
	note(overlay, a);
	await settle(a, () => asked.some((r) => r.type === "case:save"));
	await settle(a, () => a.state().drafts === 0);
	await a.end("c_open");
	expect(a.state().visible).toBe(false);
	expect(a.state().target).toBeUndefined();
	// Shown again only for a case (DEC-026): the next one.
	a.show({ target: { caseId: "c_next", title: "Next", nextMark: 1 } });
	expect(a.state().target?.caseId).toBe("c_next");
	const status = overlay.toolbar.querySelector('[data-role="status"]');
	expect(status?.textContent).toBe("Adding to “Next”");
	// No New case button any more (DEC-023).
	expect(overlay.toolbar.querySelector('[data-action="new-case"]')).toBeNull();
});

test("the toolbar draws no case of its own: no Save case…, no title, no Close (DEC-026)", () => {
	const { a, overlay } = adder();
	a.show({ target });
	const actions = [...overlay.toolbar.querySelectorAll("button")].map(
		(b) => b.dataset["action"],
	);
	expect(actions).toEqual([
		"tool-element",
		"tool-box",
		"tool-arrow",
		"tool-pen",
		"tool-note",
		"undo",
		"close",
		"move-toolbar",
	]);
	expect(overlay.toolbar.querySelector("input")).toBeNull();
	expect(
		overlay.toolbar.querySelector<HTMLElement>('[data-action="close"]')
			?.textContent,
	).toBe("Done");
});

test("a toolbar hidden by its own Done still drops its case", async () => {
	const { a } = adder();
	a.show({ target });
	a.hide();
	expect(a.state().target?.caseId).toBe("c_open");
	await a.end("c_open");
	expect(a.state().target).toBeUndefined();
});

test("another case's toolbar is left as it is", async () => {
	const { a } = adder();
	a.show({ target });
	await a.end("c_other");
	expect(a.state().visible).toBe(true);
	expect(a.state().target?.caseId).toBe("c_open");
});

test("a mark that could not be added keeps the toolbar up and the case; discard drops it", async () => {
	answer = noShots;
	const { a, overlay } = adder();
	a.show({ target });
	note(overlay, a);
	const alert = () =>
		overlay.toolbar.querySelector('[data-role="alert"]')?.textContent ?? "";
	await settle(a, () => alert().startsWith("Mark 3 was not added"));
	await a.end("c_open");
	expect(a.state().visible).toBe(true);
	expect(a.state().target?.caseId).toBe("c_open");
	expect(a.state().drafts).toBe(1);
	expect(asked.some((r) => r.type === "case:save")).toBe(false);
	// Delete: without it.
	await a.end("c_open", { discard: true });
	expect(a.state().visible).toBe(false);
	expect(a.state().target).toBeUndefined();
	expect(a.state().drafts).toBe(0);
	expect(asked.some((r) => r.type === "case:save")).toBe(false);
});

test("the page tells the side panel when its marks not in the case or its case change", async () => {
	const { a, overlay } = adder();
	let told = 0;
	overlay.onChange = () => told++;
	a.show({ target });
	const shown = told;
	expect(shown).toBeGreaterThan(0);
	answer = noShots;
	note(overlay, a);
	expect(told).toBeGreaterThan(shown);
	expect(a.state().drafts).toBe(1);
	const alert = () =>
		overlay.toolbar.querySelector('[data-role="alert"]')?.textContent ?? "";
	// A failed write, not a draft: it says so, and stays for Add mark 3.
	await settle(a, () => alert().startsWith("Mark 3 was not added"));
	expect(
		overlay.toolbar.querySelector('[data-action="retry"]')?.textContent,
	).toBe("Add mark 3");
	await a.end("c_open", { discard: true });
});

test("All cases after the toolbar's Done left a mark out tries it once more, and says so", async () => {
	answer = noShots;
	const { a, overlay } = adder();
	a.show({ target });
	note(overlay, a);
	const alert = () =>
		overlay.toolbar.querySelector('[data-role="alert"]')?.textContent ?? "";
	await settle(a, () => alert().startsWith("Mark 3 was not added"));
	// The toolbar's own Done: the mark stays out, Done again would discard it.
	overlay.toolbar
		.querySelector<HTMLButtonElement>('[data-action="close"]')
		?.click();
	await settle(a, () => alert().includes("Done again to discard it"));
	// The panel's first "← All cases" is no Done again: the mark stays.
	await a.end("c_open", { retry: true });
	expect(a.state().visible).toBe(true);
	expect(a.state().drafts).toBe(1);
	expect(a.state().target?.caseId).toBe("c_open");
	// Its second click is: the page's Done again decides.
	await a.end("c_open");
	expect(a.state().visible).toBe(false);
	expect(a.state().drafts).toBe(0);
	expect(a.state().target).toBeUndefined();
});

test("a case loaded onto the page leaves Undo its marks, whatever copy it is", async () => {
	const { a, overlay } = adder();
	a.show({ target });
	note(overlay, a);
	await settle(a, () => asked.some((r) => r.type === "case:save"));
	const undo = () =>
		overlay.toolbar.querySelector<HTMLButtonElement>('[data-action="undo"]');
	await settle(a, () => undo()?.disabled === false && a.state().drafts === 0);
	// Loaded with a copy read before mark 3 went in (a draw's retry): the
	// loaded marks draw the case's own, and Undo still reaches mark 3.
	a.caseLoaded(target.caseId);
	expect(undo()?.disabled).toBe(false);
	expect(undo()?.title).toBe("Take mark 3 out of “Open case”");
});

test("All cases during another case's add: a show for that case waiting for it is dropped", async () => {
	let release: () => void = () => undefined;
	const held = new Promise<void>((r) => {
		release = r;
	});
	answer = (r) => {
		if (r.type !== "case:save") return works(r);
		return held.then(() => works(r));
	};
	const { a, overlay } = adder();
	a.show({ target });
	note(overlay, a);
	await settle(a, () => a.state().saving);
	// The panel opens case X and Add marks: the show waits for the add.
	a.show({ target: { caseId: "c_x", title: "X", nextMark: 1 } });
	// "← All cases" for X before the add is over.
	await a.end("c_x");
	release();
	await settle(a, () => !a.state().saving);
	expect(a.state().target?.caseId).not.toBe("c_x");
	expect(a.state().visible).toBe(false);
});

test("every button of the toolbar that can be an icon alone has a tooltip, Done too", () => {
	const { a, overlay } = adder();
	a.show({ target });
	const bare = () =>
		[...overlay.toolbar.querySelectorAll("button")]
			.filter((b) => b.querySelector("svg") !== null && !b.disabled)
			.filter((b) => b.title === "")
			.map((b) => b.dataset["action"]);
	// The tools, Done and the move button.
	expect(bare()).toEqual([]);
	expect(
		overlay.toolbar.querySelector<HTMLElement>('[data-action="close"]')?.title,
	).toBe("Stop adding marks");
});

test("a rename reaches the toolbar adding to the case, and only that one (DEC-026)", async () => {
	const { a, overlay } = adder();
	a.show({ target });
	const status = () =>
		overlay.toolbar.querySelector('[data-role="status"]')?.textContent;
	expect(status()).toBe("Adding to “Open case”");
	a.setTitle("c_other", "Not this one");
	expect(status()).toBe("Adding to “Open case”");
	a.setTitle("c_open", "Login button");
	expect(status()).toBe("Adding to “Login button”");
	expect(a.state().target).toEqual({ ...target, title: "Login button" });
	// The next mark goes into the case under its new title.
	note(overlay, a);
	await settle(a, () => asked.some((r) => r.type === "case:save"));
	const save = asked.find((r) => r.type === "case:save");
	expect(save?.type === "case:save" && save.request.title).toBe("Login button");
});

test("what a new case records of the page: address, title, language, window", async () => {
	const { pageInfo } = await import("../src/content/adding.ts");
	const doc = window.document as unknown as Document;
	doc.title = "Cart";
	doc.documentElement.lang = "de-CH";
	expect(pageInfo(doc)).toEqual({
		url: "https://shop.example/cart",
		title: "Cart",
		lang: "de-CH",
		viewport: { width: 1024, height: 768, dpr: 1 },
		userAgent: navigator.userAgent,
	});
	// A language tag the format refuses is no language.
	doc.documentElement.lang = "not a tag!";
	expect(pageInfo(doc).lang).toBe("");
});

test("a rename while a mark is being added is not reverted", async () => {
	let release: () => void = () => undefined;
	const held = new Promise<void>((r) => {
		release = r;
	});
	answer = (r) =>
		r.type === "case:save" ? held.then(() => works(r)) : works(r);
	const { a, overlay } = adder();
	a.show({ target });
	note(overlay, a);
	await settle(a, () => asked.some((r) => r.type === "case:save"));
	a.setTitle("c_open", "Login button");
	release();
	await settle(a, () => !a.state().saving && a.state().drafts === 0);
	expect(a.state().target).toEqual({
		caseId: "c_open",
		title: "Login button",
		nextMark: 4,
	});
	const status = overlay.toolbar.querySelector('[data-role="status"]');
	expect(status?.textContent).toBe("Mark 3 added to “Login button”");
});

test("a mark the page moved away from gets its screenshot again by itself once the page stands still", async () => {
	window.document.body.innerHTML = `<main style="height: 3000px"><p id="text">Some text</p></main>`;
	const { a, overlay } = adder();
	a.show({ target });
	note(overlay, a);
	// The page scrolls before the mark's screenshot is taken: given up.
	window.scrollTo(0, 400);
	window.document.dispatchEvent(new window.Event("scroll"));
	const status = () =>
		overlay.toolbar.querySelector('[data-role="status"]')?.textContent ?? "";
	const alert = () =>
		overlay.toolbar.querySelector('[data-role="alert"]')?.textContent ?? "";
	for (let i = 0; i < 800 && !status().startsWith("Mark 3 added"); i++)
		await Bun.sleep(5);
	expect(status()).toBe("Mark 3 added to “Open case”");
	expect(alert()).toBe("");
	expect(asked.filter((r) => r.type === "capture")).toHaveLength(1);
	expect(asked.filter((r) => r.type === "case:save")).toHaveLength(1);
	expect(overlay.toolbar.querySelector('[data-action="retry"]')).toBeNull();
	// The page is back where the user left it.
	expect(window.scrollY).toBe(400);
});

test("a failed mark takes the next number of the case the toolbar is shown for", async () => {
	answer = noShots;
	const { a, overlay } = adder();
	a.show({ target });
	note(overlay, a);
	const alert = () =>
		overlay.toolbar.querySelector('[data-role="alert"]')?.textContent ?? "";
	await settle(a, () => alert().startsWith("Mark 3 was not added"));
	// "Add marks" for case B, whose next number is 7: the mark waits, as 7.
	answer = works;
	a.show({ target: { caseId: "c_b", title: "B", nextMark: 7 } });
	const retry = () =>
		overlay.toolbar.querySelector<HTMLButtonElement>('[data-action="retry"]');
	expect(retry()?.textContent).toBe("Add mark 7");
	expect(alert()).toContain("it was for “Open case”");
	expect(
		overlay.marks
			.querySelector(".drafts [data-number]")
			?.getAttribute("data-number"),
	).toBe("7");
	// Not into B unasked: Add mark 7 puts it there.
	expect(asked.some((r) => r.type === "case:save")).toBe(false);
	retry()?.click();
	await settle(a, () => asked.some((r) => r.type === "case:save"));
	const save = asked.find((r) => r.type === "case:save");
	expect(save?.type === "case:save" && save.request.caseId).toBe("c_b");
	expect(save?.type === "case:save" && save.request.marks[0]?.number).toBe(7);
});

test("a re-render keeps the toolbar's buttons: a click pressed before it still lands", async () => {
	const { a, overlay } = adder();
	a.show({ target });
	const button = (action: string) =>
		overlay.toolbar.querySelector<HTMLButtonElement>(
			`[data-action="${action}"]`,
		);
	const pen = button("tool-pen");
	const undo = button("undo");
	// Pressed: then the toolbar draws itself again (a rename, a draw of the
	// case, a mark's screenshot), then released on the same element.
	pen?.dispatchEvent(new window.MouseEvent("mousedown") as unknown as Event);
	a.setTitle("c_open", "Renamed");
	expect(button("tool-pen")).toBe(pen);
	expect(pen?.isConnected).toBe(true);
	pen?.dispatchEvent(new window.MouseEvent("mouseup") as unknown as Event);
	pen?.click();
	expect(button("tool-pen")?.getAttribute("aria-pressed")).toBe("true");
	expect(button("tool-pen")).toBe(pen);
	// What changed is taken over by the element that stays.
	expect(button("undo")).toBe(undo);
	note(overlay, a);
	expect(button("undo")).toBe(undo);
	expect(undo?.disabled).toBe(false);
	expect(undo?.title).toBe("Remove mark 3");
	// Nothing of this test's left running into the next.
	await settle(a, () => !a.state().saving && a.state().drafts === 0);
	// The order holds, the status and the alert where they were.
	expect(
		[...overlay.toolbar.querySelectorAll("button")].map(
			(b) => b.dataset["action"],
		),
	).toEqual([
		"tool-element",
		"tool-box",
		"tool-arrow",
		"tool-pen",
		"tool-note",
		"undo",
		"close",
		"move-toolbar",
	]);
});
