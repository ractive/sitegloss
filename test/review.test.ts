import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { Overlay } from "../src/content/overlay.ts";
import { fieldOf } from "../src/content/page-field.ts";
import {
	LoadReplaced,
	NO_PANEL,
	panelAsker,
	Reviewer,
} from "../src/content/review.ts";
import {
	type Case,
	MARK_CHANGED,
	type Mark,
	type Shape,
} from "../src/lib/case.ts";
import { describeElement } from "../src/lib/element.ts";
import type { MarkAnswer, MarkRequest } from "../src/lib/messages.ts";
import { isMarkRequest } from "../src/lib/messages.ts";
import { sampleCase } from "./fixtures.ts";

/**
 * The open popover's comment field, a frame of the extension's own (DEC-064),
 * driven as a textarea: a value set is typed in the frame, an Escape pressed
 * in it is said by it.
 */
function textField(popover: HTMLElement) {
	const f = fieldOf(popover.querySelector("iframe.field"));
	if (f === undefined) throw new Error("no comment field");
	return {
		get value() {
			return f.value;
		},
		set value(value: string) {
			f.receive({ type: "input", value });
		},
		getAttribute: (name: string) =>
			name === "aria-label" ? f.frame.title : null,
		dispatchEvent(e: Event) {
			if (e.type === "keydown" && (e as KeyboardEvent).key === "Escape")
				f.receive({ type: "escape", value: f.value });
			return true;
		},
	};
}

let doc: Document;
/** Puts happy-dom's own `getBoundingClientRect` back. */
let restoreLayout: () => void = () => undefined;
let overlay: ReturnType<typeof stubOverlay>;
let reviewer: Reviewer;
/** What the page asked of the side panel, and what the panel answers. */
let asked: MarkRequest[];
let answer: MarkAnswer;

interface Item {
	number: number;
	shape: Shape;
	found: boolean;
	focused: boolean;
}

/** What the reviewer uses of the overlay. */
function stubOverlay(document: Document) {
	return {
		doc: document,
		host: document.createElement("div"),
		reviewBar: document.createElement("div"),
		reviewing: false,
		items: [] as readonly Item[],
		setReviewing(on: boolean) {
			this.reviewing = on;
		},
		marksHidden: false,
		setMarksHidden(on: boolean) {
			this.marksHidden = on;
		},
		renderReview(items: readonly Item[]) {
			this.items = items;
		},
		// The one popover, as the overlay keeps it.
		popover: document.createElement("div"),
		onPick: undefined as ((number: number) => void) | undefined,
		dismissed: undefined as (() => void) | undefined,
		placed: 0,
		openPopover(content: Node[], dismissed: () => void) {
			this.dismissPopover();
			this.dismissed = dismissed;
			this.popover.replaceChildren(...content);
			this.popover.hidden = false;
		},
		closePopover() {
			this.dismissed = undefined;
			this.popover.hidden = true;
			this.popover.replaceChildren();
		},
		dismissPopover() {
			const dismissed = this.dismissed;
			if (dismissed === undefined) return false;
			this.dismissed = undefined;
			dismissed();
			this.closePopover();
			return true;
		},
		placePopover() {
			this.placed++;
		},
	};
}

/** How often the reviewer looks at the page by itself, here. */
const TICK_MS = 50;

/** Until `ok`, a second at most: a tick may fire late on a busy machine. */
async function until(ok: () => boolean): Promise<void> {
	const end = Date.now() + 1000;
	while (!ok()) {
		if (Date.now() > end) throw new Error("timed out");
		await Bun.sleep(5);
	}
}

beforeEach(() => {
	const window = new Window({ url: "https://www.example.com/kk" });
	doc = window.document as unknown as Document;
	// happy-dom lays nothing out. Its windows share one Element class, so
	// what is put on the prototype here is taken off again after each test:
	// left there, every element of a test file that runs later has a size.
	const proto = window.Element.prototype;
	const layout = proto.getBoundingClientRect;
	restoreLayout = () => {
		proto.getBoundingClientRect = layout;
	};
	proto.getBoundingClientRect = () =>
		({ x: 0, y: 0, width: 100, height: 20 }) as never;
	Object.assign(globalThis, {
		location: window.location,
		requestAnimationFrame: (run: () => void) => setTimeout(run, 0),
	});
	overlay = stubOverlay(doc);
	asked = [];
	answer = { ok: true };
	reviewer = new Reviewer(
		overlay as unknown as Overlay,
		async (request) => {
			asked.push(request);
			return answer;
		},
		{ tickMs: TICK_MS },
	);
});

afterEach(() => {
	reviewer.clear();
	restoreLayout();
});

const $ = (s: string) => doc.querySelector(s) as Element;
const bar = () =>
	overlay.reviewBar.querySelector("[data-role=review-status]")?.textContent;

const shot = (id: string, scrollY = 0, url?: string) => ({
	id,
	image: `shots/${id}.webp`,
	scrollX: 0,
	scrollY,
	viewport: { width: 1280, height: 800, dpr: 2 },
	capturedAt: "2026-11-04T10:00:00Z",
	...(url ? { url } : {}),
});

function caseOf(el: Element): Case {
	const element = describeElement(el);
	const mark = {
		id: "m1",
		number: 1,
		shot: "s1",
		shape: { kind: "element", rect: element.rect },
		element,
	} as Mark;
	return { ...sampleCase(), shots: [shot("s1")], marks: [mark] };
}

describe("elements replaced after loading", () => {
	const PAGE = `<main><h1>Prämien</h1><button>Berechnen</button></main>`;

	test("a re-render: showing finds the new element and outlines it", async () => {
		doc.body.innerHTML = PAGE;
		await reviewer.load(caseOf($("button")));
		expect(overlay.items.length).toBe(1);
		const old = $("button");
		$("main").innerHTML = `<h1>Prämien</h1><button>Berechnen</button>`;
		expect(old.isConnected).toBe(false);
		const match = reviewer.show("m1");
		expect(match?.status).toBe("found");
		expect(overlay.items.length).toBe(1);
		expect(bar()).toContain("1 of 1 found");
	});

	test("the bar's Hide stays the same element when the case is drawn again", async () => {
		doc.body.innerHTML = PAGE;
		const c = caseOf($("button"));
		await reviewer.load(c);
		const hide = overlay.reviewBar.querySelector('[data-action="review-hide"]');
		expect(hide).not.toBeNull();
		await reviewer.update({ ...c, title: "Renamed" });
		await reviewer.load(c);
		expect(overlay.reviewBar.querySelector('[data-action="review-hide"]')).toBe(
			hide,
		);
		expect(bar()).toContain("1 of 1 found");
		expect(
			overlay.reviewBar.querySelectorAll('[data-role="review-status"]'),
		).toHaveLength(1);
	});

	test("Hide marks keeps the case and leaves the pill that shows them again; Add marks on the bar adds to the case (DEC-061)", async () => {
		doc.body.innerHTML = PAGE;
		const c = caseOf($("button"));
		await reviewer.load(c);
		const said: boolean[] = [];
		const added: string[] = [];
		reviewer.onHiddenChange = (hidden) => void said.push(hidden);
		reviewer.onAddMarks = (x) => void added.push(x.id);
		(
			overlay.reviewBar.querySelector(
				'[data-action="review-add"]',
			) as HTMLButtonElement
		).click();
		expect(added).toEqual([c.id]);
		(
			overlay.reviewBar.querySelector(
				'[data-action="review-hide"]',
			) as HTMLButtonElement
		).click();
		// Nothing drawn, the case kept, the pill named for it.
		expect(reviewer.hidden).toBe(true);
		expect(reviewer.caseId).toBe(c.id);
		expect(overlay.reviewing).toBe(false);
		expect(overlay.marksHidden).toBe(true);
		expect(overlay.items).toHaveLength(0);
		const pill = overlay.reviewBar.querySelector('[data-action="review-show"]');
		expect(pill?.getAttribute("aria-label")).toBe(
			`Show the marks of “${c.title}”`,
		);
		expect(
			overlay.reviewBar.querySelector('[data-action="review-hide"]'),
		).toBeNull();
		(pill as HTMLButtonElement).click();
		expect(said).toEqual([true, false]);
		expect(reviewer.hidden).toBe(false);
		expect(overlay.reviewing).toBe(true);
		expect(overlay.items).toHaveLength(1);
		// An AI app showing a mark brings hidden marks back too.
		reviewer.hide();
		expect(reviewer.show("m1")?.status).toBe("found");
		expect(reviewer.hidden).toBe(false);
		reviewer.onHiddenChange = undefined;
		reviewer.onAddMarks = undefined;
	});

	test("a clear while the case is loading stops the load: nothing is drawn after it", async () => {
		doc.body.innerHTML = PAGE;
		const c = caseOf($("button"));
		const loading = reviewer.load(c);
		// What case:clear for this case looks at while the load runs.
		expect(reviewer.caseId).toBeUndefined();
		expect(reviewer.loadingCaseId).toBe(c.id);
		reviewer.clear();
		// Replaced, which is no failure, and no case is loaded.
		await expect(loading).rejects.toBeInstanceOf(LoadReplaced);
		expect(reviewer.caseId).toBeUndefined();
		expect(overlay.reviewing).toBe(false);
		expect(overlay.items).toEqual([]);
		expect(reviewer.loadingCaseId).toBeUndefined();
	});

	test("a clear for another case leaves the case drawn; one for it, or for none, clears it, also while it loads", async () => {
		doc.body.innerHTML = PAGE;
		const c = caseOf($("button"));
		await reviewer.load(c);
		reviewer.clearFor("c_other");
		expect(reviewer.caseId).toBe(c.id);
		expect(overlay.items.length).toBe(1);
		reviewer.clearFor(c.id);
		expect(reviewer.caseId).toBeUndefined();
		await reviewer.load(c);
		reviewer.clearFor(undefined);
		expect(reviewer.caseId).toBeUndefined();
		const loading = reviewer.load(c);
		reviewer.clearFor("c_other");
		expect(reviewer.loadingCaseId).toBe(c.id);
		reviewer.clearFor(c.id);
		await expect(loading).rejects.toBeInstanceOf(LoadReplaced);
		expect(overlay.items).toEqual([]);
		// None named ("← All cases") while another case loads: that load stops too.
		await reviewer.load(c);
		const other = reviewer.load({ ...c, id: "c_other" });
		reviewer.clearFor(undefined);
		await expect(other).rejects.toBeInstanceOf(LoadReplaced);
		expect(reviewer.caseId).toBeUndefined();
		expect(overlay.items).toEqual([]);
	});

	test("gone for good: showing says so", async () => {
		doc.body.innerHTML = PAGE;
		await reviewer.load(caseOf($("button")));
		$("button").remove();
		const match = reviewer.show("m1");
		expect(match?.status).toBe("lost");
		expect(match?.candidates).toEqual([]);
		expect(overlay.items.length).toBe(0);
		expect(bar()).toContain("0 of 1 found");
	});

	test("the review bar and the outlines follow without a click", async () => {
		doc.body.innerHTML = PAGE;
		await reviewer.load(caseOf($("button")));
		const old = $("button");
		$("main").innerHTML = `<h1>Prämien</h1><button>Berechnen</button>`;
		expect(old.isConnected).toBe(false);
		// The outline goes onto the new button by itself.
		await until(() => reviewer.target("m1")?.element === $("button"));
		expect(overlay.items.length).toBe(1);
		$("button").remove();
		await until(
			() =>
				(bar() ?? "").includes("0 of 1 found") && overlay.items.length === 0,
		);
	});

	test("an element still on the page is not searched for again", async () => {
		doc.body.innerHTML = PAGE;
		await reviewer.load(caseOf($("button")));
		$("button").textContent = "Jetzt berechnen und vergleichen";
		expect(reviewer.show("m1")?.score).toBe(1);
	});
});

describe("a drawn mark", () => {
	/** A case of one mark drawn on an element, which was at `rect`. */
	function drawnOn(el: Element, shape: Shape, scrollY = 0): Case {
		const c = caseOf(el);
		const a = c.marks[0] as Mark;
		const element = a.element as NonNullable<Mark["element"]>;
		const rect = { x: 500, y: 1000, width: 200, height: 40 };
		return {
			...c,
			shots: [shot("s1", scrollY)],
			marks: [{ ...a, shape, element: { ...element, rect } }],
		};
	}

	test("goes on its element, moved and scaled with it", async () => {
		doc.body.innerHTML = `<button>Berechnen</button>`;
		// In the shot, scrolled by 900: y 110 is 1010 on the page.
		const rect = { x: 550, y: 110, width: 100, height: 20 };
		await reviewer.load(drawnOn($("button"), { kind: "box", rect }, 900));
		// The element is at 0, 0 and 100×20 now: half as wide and high.
		expect(overlay.items[0]?.shape).toEqual({
			kind: "box",
			rect: { x: 25, y: 5, width: 50, height: 10 },
		});
	});

	test("an element's mark stays the element's box", async () => {
		doc.body.innerHTML = `<button>Berechnen</button>`;
		await reviewer.load(caseOf($("button")));
		expect(overlay.items[0]?.shape).toEqual({
			kind: "element",
			rect: { x: 0, y: 0, width: 100, height: 20 },
		});
	});

	/** A case of one mark without an element, on a shot of `url`. */
	function withoutElement(url?: string): Case {
		const shape = { kind: "note", at: { x: 40, y: 50 } } as const;
		const mark = {
			id: "m1",
			number: 1,
			shot: "s1",
			shape,
			element: null,
		} as Mark;
		return {
			...sampleCase(),
			shots: [shot("s1", 100, url)],
			marks: [mark],
		};
	}

	test("without an element goes where it was, unconfirmed", async () => {
		await reviewer.load(withoutElement());
		expect(overlay.items[0]?.shape).toEqual({
			kind: "note",
			at: { x: 40, y: 150 },
		});
		expect(overlay.items[0]?.found).toBe(false);
	});

	test("without an element Show scrolls to it", async () => {
		const win = doc.defaultView as unknown as Window;
		const scrolled: ScrollToOptions[] = [];
		win.scrollTo = ((to: ScrollToOptions) => {
			scrolled.push(to);
		}) as typeof win.scrollTo;
		await reviewer.load(withoutElement());
		reviewer.show("m1");
		expect(scrolled[0]?.top).toBe(150 - win.innerHeight / 2);
		await Bun.sleep(10);
		expect(overlay.items[0]?.focused).toBe(true);
	});

	test("without an element stays off another route's page", async () => {
		await reviewer.load(withoutElement("https://www.example.com/hypo"));
		expect(overlay.items.length).toBe(0);
	});
});

describe("the outline", () => {
	test("is not green for an element without identity", async () => {
		doc.body.innerHTML = `<main><img src="/a.png" /><img src="/b.png" /></main>`;
		const c = caseOf($("img"));
		$("img").remove();
		await reviewer.load(c);
		expect(overlay.items.length).toBe(1);
		expect(overlay.items[0]?.found).toBe(false);
	});
});

describe("a loaded case that changes", () => {
	const PAGE = `<main><h1>Prämien</h1><button>Berechnen</button><p>Kontakt</p></main>`;
	function twoMarks(): Case {
		const mark = (id: string, n: number, el: Element): Mark => {
			const element = describeElement(el);
			return {
				id,
				number: n,
				shot: "s1",
				comment: "",
				author: "user",
				shape: { kind: "element", rect: element.rect },
				crop: `crops/${id}.webp`,
				element,
			};
		};
		return {
			...sampleCase(),
			shots: [shot("s1")],
			marks: [mark("m1", 1, $("button")), mark("m2", 2, $("p"))],
		};
	}

	test("a dismissed mark is drawn settled, no longer counted, its candidate kept", async () => {
		doc.body.innerHTML = PAGE;
		const c = twoMarks();
		await reviewer.load(c);
		reviewer.show("m1", 0);
		const settled = {
			...c,
			marks: c.marks.map((a) =>
				a.id === "m2"
					? { ...a, resolution: { kind: "wontfix" as const, at: "now" } }
					: a,
			),
		};
		const result = await reviewer.update(settled);
		expect(result?.matches.map((m) => m.markId)).toEqual(["m1", "m2"]);
		expect(
			(overlay.items as unknown as { status: string }[]).map((i) => i.status),
		).toEqual(["open", "wontfix"]);
		expect(bar()).toContain("1 of 1 found");
		expect(bar()).not.toContain("to verify");
	});

	test("a mark to verify is counted and said; all settled says so", async () => {
		doc.body.innerHTML = PAGE;
		const c = twoMarks();
		await reviewer.load(c);
		const fixed = {
			...c,
			marks: c.marks.map((a) =>
				a.id === "m2"
					? { ...a, resolution: { kind: "fixed" as const, at: "now" } }
					: a,
			),
		};
		await reviewer.update(fixed);
		expect(
			(overlay.items as unknown as { status: string }[]).map((i) => i.status),
		).toEqual(["open", "fixed"]);
		expect(bar()).toBe(`${c.title}·2 of 2 found · 1 to verify`);
		const done = {
			...c,
			marks: c.marks.map((a) => ({
				...a,
				resolution: {
					kind: "fixed" as const,
					at: "now",
					verified: { at: "now" },
				},
			})),
		};
		await reviewer.update(done);
		expect(
			(overlay.items as unknown as { status: string }[]).map((i) => i.status),
		).toEqual(["verified", "verified"]);
		expect(bar()).toContain("all verified or dismissed");
	});

	test("a deleted mark leaves; another case is not touched", async () => {
		doc.body.innerHTML = PAGE;
		const c = twoMarks();
		await reviewer.load(c);
		const result = await reviewer.update({
			...c,
			marks: [c.marks[0] as Mark],
		});
		expect(result?.matches.length).toBe(1);
		expect(overlay.items.length).toBe(1);
		expect(await reviewer.update({ ...c, id: "c_other" })).toBeNull();
	});

	test("a replaced copy giving an id to another mark: that one is looked for anew", async () => {
		doc.body.innerHTML = PAGE;
		const c = twoMarks();
		await reviewer.load(c);
		const [first, second] = c.marks as [Mark, Mark];
		// m2 now marks the heading, as a file imported over it says.
		const h1 = describeElement($("h1"));
		const replaced = {
			...c,
			marks: [
				first,
				{
					...second,
					element: h1,
					shape: { kind: "element" as const, rect: h1.rect },
				},
			],
		};
		const result = await reviewer.update(replaced);
		expect(result?.matches[1]?.candidates[0]?.selector).toBe(
			describeElement($("h1")).selector,
		);
	});

	test("a change while the case still loads is drawn once the load ends", async () => {
		doc.body.innerHTML = PAGE;
		const c = twoMarks();
		const loading = reviewer.load(c);
		expect(
			await reviewer.update({ ...c, marks: [c.marks[0] as Mark] }),
		).toBeNull();
		expect((await loading).matches.length).toBe(1);
		expect(overlay.items.length).toBe(1);
	});
});

describe("loads close together", () => {
	const PAGE = `<main><h1>Prämien</h1><button>Berechnen</button></main>`;

	test("two loads of one case both end with the newer one's result", async () => {
		doc.body.innerHTML = PAGE;
		const c = caseOf($("button"));
		const first = reviewer.load(c);
		const second = reviewer.load(c);
		const [a, b] = await Promise.all([first, second]);
		expect(b.matches.map((m) => m.status)).toEqual(["found"]);
		// The older one's is the newer's, and says so: its marks are that
		// load's, not this caller's to take off.
		expect(a).toEqual({ ...b, adopted: true });
		expect(b.adopted).toBeUndefined();
		expect(reviewer.caseId).toBe(c.id);
	});

	test("another case's load stops the one before: replaced", async () => {
		doc.body.innerHTML = PAGE;
		const c = caseOf($("button"));
		const other = { ...caseOf($("h1")), id: "c_other" };
		const first = reviewer.load(c);
		const second = reviewer.load(other);
		await expect(first).rejects.toBeInstanceOf(LoadReplaced);
		expect((await second).caseId).toBe("c_other");
	});

	test("a change during the second of two loads is drawn once it ends", async () => {
		doc.body.innerHTML = PAGE;
		const one = caseOf($("button"));
		const c: Case = {
			...one,
			marks: [...one.marks, { ...(one.marks[0] as Mark), id: "m2", number: 2 }],
		};
		const first = reviewer.load(c);
		const second = reviewer.load(c);
		expect(
			await reviewer.update({
				...c,
				marks: [c.marks[0] as Mark],
			}),
		).toBeNull();
		expect((await second).matches.length).toBe(1);
		expect((await first).matches.length).toBe(1);
		expect(overlay.items.length).toBe(1);
	});
});

describe("a load that draws a newer copy at its end", () => {
	const PAGE = `<main><h1>Prämien</h1><button>Berechnen</button><a href="#">Link</a><p>Text hier</p></main>`;
	const withMarks = (base: Case, ...selectors: string[]): Case => ({
		...base,
		marks: [
			...base.marks,
			...selectors.map((sel, i) => ({
				...(base.marks[0] as Mark),
				id: `m${i + 2}`,
				number: i + 2,
				element: describeElement($(sel)),
			})),
		],
	});
	/** Until the load has found its marks and turns to the newer copy. */
	const found = async () => {
		while (reviewer.caseId === undefined)
			await new Promise((r) => setTimeout(r, 0));
	};

	test("a clear while it draws the newer copy: replaced, not its first result", async () => {
		doc.body.innerHTML = PAGE;
		const c = caseOf($("button"));
		const loading = reviewer.load(c);
		expect(await reviewer.update(withMarks(c, "a", "p"))).toBeNull();
		await found();
		reviewer.clear();
		await expect(loading).rejects.toBeInstanceOf(LoadReplaced);
	});

	test("a newer load while it draws the newer copy: both end with the newest", async () => {
		doc.body.innerHTML = PAGE;
		const c = caseOf($("button"));
		const newer = withMarks(c, "a", "p");
		const loading = reviewer.load(c);
		expect(await reviewer.update(newer)).toBeNull();
		await found();
		const again = reviewer.load(newer);
		expect((await again).matches.length).toBe(3);
		expect((await loading).matches.length).toBe(3);
	});
});

describe("a loaded mark's pin clicked on the page (DEC-027)", () => {
	const PAGE = `<main><h1>Prämien</h1><button>Berechnen</button><p>Tipp</p></main>`;
	const field = () => textField(overlay.popover);
	const button = (action: string) =>
		overlay.popover.querySelector(
			`[data-action="${action}"]`,
		) as HTMLButtonElement;
	const settled = () => new Promise<void>((r) => setTimeout(r, 0));

	async function loaded(comment = "Too pale"): Promise<Case> {
		doc.body.innerHTML = PAGE;
		const c = caseOf($("button"));
		const marked = {
			...c,
			marks: c.marks.map((a) => ({ ...a, comment })),
		};
		await reviewer.load(marked);
		return marked;
	}

	test("its comment opens in the popover, its element is outlined, the panel is told", async () => {
		const c = await loaded();
		expect(overlay.onPick).toBeDefined();
		overlay.onPick?.(1);
		expect(overlay.popover.hidden).toBe(false);
		expect(field().value).toBe("Too pale");
		expect(field().getAttribute("aria-label")).toBe("Comment of mark 1");
		expect(overlay.popover.querySelector(".pin")?.textContent).toBe("1");
		expect(button("mark-delete").textContent).toBe("Delete mark");
		// Cmd+Enter (Ctrl+Enter) in the field presses Done: the button shows
		// it, and its name stays "Done".
		const done = button("mark-done");
		expect(done.firstChild?.textContent).toBe("Done");
		expect(done.querySelector(".keys")?.getAttribute("aria-hidden")).toBe(
			"true",
		);
		expect(done.getAttribute("aria-keyshortcuts")).toMatch(
			/^(Meta|Control)\+Enter$/,
		);
		expect(overlay.items[0]?.focused).toBe(true);
		expect(overlay.placed).toBeGreaterThan(0);
		expect(asked).toEqual([
			{ type: "mark:picked", caseId: c.id, markId: "m1" },
		]);
		// A second click on the same pin leaves what is being typed.
		field().value = "Typing";
		overlay.onPick?.(1);
		expect(field().value).toBe("Typing");
		expect(asked.length).toBe(1);
		// A number the case has no mark for opens nothing.
		reviewer.clear();
		overlay.onPick?.(1);
		expect(overlay.popover.hidden).toBe(true);
	});

	test("Add another image… asks the panel to open its dialog, after the comment typed is kept; a full mark offers none (DEC-058)", async () => {
		const c = await loaded();
		overlay.onPick?.(1);
		field().value = "Menu closes";
		button("mark-add-image").click();
		await settled();
		expect(asked.slice(1).map((r) => r.type)).toEqual([
			"mark:comment",
			"mark:add-image",
		]);
		expect(asked.at(-1)).toMatchObject({ caseId: c.id, markId: "m1" });
		expect(overlay.popover.hidden).toBe(true);
		const full = {
			...c,
			marks: c.marks.map((a) => ({
				...a,
				images: Array.from({ length: 6 }, (_, i) => ({
					id: `i_${i}`,
					image: `images/i_${i}.webp`,
					added: { at: "2026-11-22T10:00:00Z" },
				})),
			})),
		};
		await reviewer.update(full);
		overlay.onPick?.(1);
		expect(
			overlay.popover.querySelector('[data-action="mark-add-image"]'),
		).toBeNull();
	});

	test("a mark that is not open says its status beside the label", async () => {
		const c = await loaded();
		const fixed = {
			...c,
			marks: c.marks.map((a) => ({
				...a,
				resolution: { kind: "fixed" as const, at: "2026-11-14T10:00:00Z" },
			})),
		};
		await reviewer.update(fixed);
		overlay.onPick?.(1);
		expect(overlay.popover.querySelector(".state")?.textContent).toBe(
			"Fixed, to verify",
		);
	});

	test("Done with the comment as it was asks nothing; a changed one is stored, then the popover goes", async () => {
		const c = await loaded();
		overlay.onPick?.(1);
		button("mark-done").click();
		await settled();
		expect(overlay.popover.hidden).toBe(true);
		expect(asked.length).toBe(1);

		overlay.onPick?.(1);
		field().value = "  Much too pale ";
		button("mark-done").click();
		// Off while the panel is asked: no second request.
		expect(button("mark-done").disabled).toBe(true);
		button("mark-done").click();
		await settled();
		expect(asked.at(-1)).toMatchObject({
			type: "mark:comment",
			caseId: c.id,
			markId: "m1",
			text: "Much too pale",
		});
		expect(asked.filter((r) => r.type === "mark:comment").length).toBe(1);
		expect(overlay.popover.hidden).toBe(true);
	});

	test("what could not be stored is said in the popover, which stays with the text", async () => {
		await loaded();
		overlay.onPick?.(1);
		answer = { ok: false, error: NO_PANEL };
		field().value = "Changed";
		button("mark-done").click();
		await settled();
		expect(overlay.popover.hidden).toBe(false);
		const problem = overlay.popover.querySelector(".problem") as HTMLElement;
		expect(problem.hidden).toBe(false);
		expect(problem.textContent).toBe(NO_PANEL);
		expect(problem.getAttribute("role")).toBe("alert");
		expect(field().value).toBe("Changed");
		expect(button("mark-done").disabled).toBe(false);
	});

	test("Delete mark asks twice, and not on a double click", async () => {
		const c = await loaded();
		overlay.onPick?.(1);
		const realNow = Date.now;
		let now = 1_000_000;
		Date.now = () => now;
		try {
			button("mark-delete").click();
			expect(button("mark-delete").textContent).toBe("Really delete?");
			expect(button("mark-delete").hasAttribute("data-armed")).toBe(true);
			// The second half of a double click.
			now += 100;
			button("mark-delete").click();
			await settled();
			expect(asked.some((r) => r.type === "mark:delete")).toBe(false);
			now += 1000;
			button("mark-delete").click();
			await settled();
		} finally {
			Date.now = realNow;
		}
		expect(asked.at(-1)).toMatchObject({
			type: "mark:delete",
			caseId: c.id,
			markId: "m1",
		});
		expect(overlay.popover.hidden).toBe(true);
	});

	test("Escape drops what was typed; a click beside it, or another popover, keeps it", async () => {
		const c = await loaded();
		overlay.onPick?.(1);
		field().value = "Dropped";
		field().dispatchEvent(
			new (doc.defaultView as unknown as Window).KeyboardEvent("keydown", {
				key: "Escape",
			}) as never,
		);
		expect(overlay.popover.hidden).toBe(true);
		expect(asked.some((r) => r.type === "mark:comment")).toBe(false);

		overlay.onPick?.(1);
		field().value = "Kept";
		// What the mark adder does at a press beside the popover, or as it opens
		// a new mark's comment.
		expect(overlay.dismissPopover()).toBe(true);
		expect(overlay.popover.hidden).toBe(true);
		expect(asked.at(-1)).toMatchObject({
			type: "mark:comment",
			caseId: c.id,
			markId: "m1",
			text: "Kept",
		});
	});

	test("the popover goes with its mark, and with the case", async () => {
		const c = await loaded();
		overlay.onPick?.(1);
		// Another change of the case leaves it open.
		await reviewer.update({ ...c, title: "Renamed" });
		expect(overlay.popover.hidden).toBe(false);
		await reviewer.update({ ...c, marks: [] });
		expect(overlay.popover.hidden).toBe(true);
		await reviewer.load(c);
		overlay.onPick?.(1);
		expect(overlay.popover.hidden).toBe(false);
		reviewer.clear();
		expect(overlay.popover.hidden).toBe(true);
	});

	const commands = () =>
		[...overlay.popover.querySelectorAll(".commands button")].map(
			(b) => b.textContent,
		);
	const settledAs = (
		c: Case,
		kind: "fixed" | "wontfix" | "cantreproduce",
		more: object = {},
	): Case => ({
		...c,
		marks: c.marks.map((a) => ({
			...a,
			resolution: { kind, at: "2026-11-14T10:00:00Z", ...more },
		})),
	});
	const radios = () =>
		[
			...overlay.popover.querySelectorAll<HTMLInputElement>(
				".choices input[type=radio]",
			),
		].map((r) => [r.value, r.checked]);

	test("the commands are the panel's for the mark's status", async () => {
		const c = await loaded();
		overlay.onPick?.(1);
		expect(commands()).toEqual(["Resolve…"]);
		reviewer.clear();
		await reviewer.load(settledAs(c, "fixed"));
		overlay.onPick?.(1);
		expect(commands()).toEqual(["Verify", "Reopen…", "Change…"]);
		reviewer.clear();
		await reviewer.load(settledAs(c, "fixed", { verified: { at: "x" } }));
		overlay.onPick?.(1);
		expect(commands()).toEqual(["Reopen…", "Change…"]);
		reviewer.clear();
		await reviewer.load(settledAs(c, "cantreproduce"));
		overlay.onPick?.(1);
		expect(commands()).toEqual(["Reopen…", "Change…"]);
		// Delete mark and Done are there for every status.
		expect(button("mark-delete")).not.toBeNull();
		expect(button("mark-done")).not.toBeNull();
	});

	test("Resolve…: the four ways and a note; Save settles the mark and the popover goes", async () => {
		const c = await loaded();
		overlay.onPick?.(1);
		button("mark-resolve").click();
		await settled();
		expect(overlay.popover.querySelector(".label")?.textContent).toBe(
			"1Mark 1 is",
		);
		expect(radios()).toEqual([
			["fixed", true],
			["verified", false],
			["wontfix", false],
			["cantreproduce", false],
		]);
		const note = textField(overlay.popover);
		expect(note.value).toBe("");
		(
			overlay.popover.querySelector(
				'.choices input[value="wontfix"]',
			) as HTMLInputElement
		).checked = true;
		note.value = "By design";
		button("mark-resolve-done").click();
		await settled();
		expect(asked.at(-1)).toMatchObject({
			type: "mark:resolve",
			caseId: c.id,
			markId: "m1",
			kind: "wontfix",
			note: "By design",
		});
		expect(overlay.popover.hidden).toBe(true);
	});

	test("a comment typed is stored before a command's form opens; Cancel is back at the comment", async () => {
		const c = await loaded();
		overlay.onPick?.(1);
		field().value = "Much too pale";
		button("mark-resolve").click();
		await settled();
		expect(asked.at(-1)).toMatchObject({
			type: "mark:comment",
			caseId: c.id,
			markId: "m1",
			text: "Much too pale",
		});
		expect(overlay.popover.querySelector(".choices")).not.toBeNull();
		button("mark-back").click();
		expect(field().value).toBe("Much too pale");
		expect(commands()).toEqual(["Resolve…"]);
		// Stored already: Done asks nothing more.
		const before = asked.length;
		button("mark-done").click();
		await settled();
		expect(asked.length).toBe(before);
		expect(overlay.popover.hidden).toBe(true);
	});

	test("a comment that could not be stored keeps the popover at the comment", async () => {
		await loaded();
		overlay.onPick?.(1);
		answer = { ok: false, error: NO_PANEL };
		field().value = "Changed";
		button("mark-resolve").click();
		await settled();
		expect(overlay.popover.querySelector(".choices")).toBeNull();
		expect(field().value).toBe("Changed");
		expect(overlay.popover.querySelector(".problem")?.textContent).toBe(
			NO_PANEL,
		);
	});

	test("Verify: one click, for a mark to verify", async () => {
		const c = await loaded();
		await reviewer.update(settledAs(c, "fixed"));
		overlay.onPick?.(1);
		button("mark-verify").click();
		await settled();
		expect(asked.at(-1)).toMatchObject({
			type: "mark:verify",
			caseId: c.id,
			markId: "m1",
		});
		expect(overlay.popover.hidden).toBe(true);
	});

	test("Reopen… needs what is still wrong; what the panel refuses is said in the form", async () => {
		const c = await loaded();
		await reviewer.update(settledAs(c, "fixed"));
		overlay.onPick?.(1);
		button("mark-reopen").click();
		await settled();
		const note = () => textField(overlay.popover);
		expect(note().getAttribute("aria-label")).toBe(
			"What is still wrong with mark 1",
		);
		expect(button("mark-reopen-done").disabled).toBe(true);
		note().value = "  ";
		note().dispatchEvent(
			new (doc.defaultView as unknown as Window).Event("input") as never,
		);
		expect(button("mark-reopen-done").disabled).toBe(true);
		note().value = "Still pale on hover";
		note().dispatchEvent(
			new (doc.defaultView as unknown as Window).Event("input") as never,
		);
		expect(button("mark-reopen-done").disabled).toBe(false);
		answer = { ok: false, error: "Not saved: no." };
		button("mark-reopen-done").click();
		await settled();
		expect(overlay.popover.hidden).toBe(false);
		expect(overlay.popover.querySelector(".problem")?.textContent).toBe(
			"Not saved: no.",
		);
		expect(note().value).toBe("Still pale on hover");
		answer = { ok: true };
		button("mark-reopen-done").click();
		await settled();
		expect(asked.at(-1)).toMatchObject({
			type: "mark:reopen",
			caseId: c.id,
			markId: "m1",
			note: "Still pale on hover",
		});
		expect(overlay.popover.hidden).toBe(true);
	});

	test("Change… starts from how the mark was settled, with its note", async () => {
		const c = await loaded();
		await reviewer.update(settledAs(c, "wontfix", { note: "By design" }));
		overlay.onPick?.(1);
		button("mark-change").click();
		await settled();
		expect(radios().find(([, checked]) => checked)?.[0]).toBe("wontfix");
		expect(textField(overlay.popover).value).toBe("By design");
	});

	test("the case changes under the popover: other commands, the comment typed stays, one changed elsewhere shows", async () => {
		const c = await loaded();
		overlay.onPick?.(1);
		// Untouched here, changed in the panel: it shows, and Done asks nothing.
		const edited = {
			...c,
			marks: c.marks.map((a) => ({
				...a,
				comment: "From the panel",
			})),
		};
		await reviewer.update(edited);
		expect(field().value).toBe("From the panel");
		// Being typed here while the panel resolves the mark: the text stays.
		field().value = "Typing";
		await reviewer.update(settledAs(edited, "fixed"));
		expect(commands()).toEqual(["Verify", "Reopen…", "Change…"]);
		expect(field().value).toBe("Typing");
		expect(overlay.popover.querySelector(".state")?.textContent).toBe(
			"Fixed, to verify",
		);
		const before = asked.length;
		button("mark-done").click();
		await settled();
		expect(asked.slice(before)).toMatchObject([
			{
				type: "mark:comment",
				caseId: c.id,
				markId: "m1",
				text: "Typing",
			},
		]);
	});

	test("only a mark's request with its fields is one", () => {
		const base = { caseId: "c_1", markId: "m1" };
		expect(isMarkRequest({ type: "mark:picked", ...base })).toBe(true);
		expect(isMarkRequest({ type: "mark:delete", ...base })).toBe(true);
		expect(isMarkRequest({ type: "mark:comment", ...base, text: "" })).toBe(
			true,
		);
		expect(isMarkRequest({ type: "mark:comment", ...base })).toBe(false);
		expect(isMarkRequest({ type: "mark:comment", ...base, text: 1 })).toBe(
			false,
		);
		expect(isMarkRequest({ type: "mark:delete", caseId: "c_1" })).toBe(false);
		expect(isMarkRequest({ type: "mark:verify", ...base })).toBe(true);
		expect(isMarkRequest({ type: "mark:reopen", ...base, note: "x" })).toBe(
			true,
		);
		expect(isMarkRequest({ type: "mark:reopen", ...base })).toBe(false);
		expect(
			isMarkRequest({ type: "mark:resolve", ...base, kind: "fixed", note: "" }),
		).toBe(true);
		// Only the four ways the panel has; "open" is Reopen's.
		expect(
			isMarkRequest({ type: "mark:resolve", ...base, kind: "open", note: "" }),
		).toBe(false);
		expect(
			isMarkRequest({ type: "mark:resolve", ...base, kind: "fixed" }),
		).toBe(false);
		expect(isMarkRequest({ type: "cases:changed", caseId: "c_1" })).toBe(false);
		expect(isMarkRequest(null)).toBe(false);
	});
});

describe("a case of several pages on the page in front (DEC-038)", () => {
	const KK = "https://www.example.com/kk";
	const PAY = "https://www.example.com/kk/pay";
	const CART_PAGE = `<main class="Cart_form"><h1>Warenkorb</h1><button class="Button_primary" type="submit">Weiter</button></main>`;
	const PAY_PAGE = `<main class="Pay_form"><h1>Zahlung</h1><input name="iban"><a class="Help_link" href="/hilfe">Hilfe zur Zahlung</a></main>`;

	/** A case with one mark on each of two pages, described from the pages' own markup. */
	function flow(): Case {
		const mark = (
			n: number,
			shotId: string,
			html: string,
			selector: string,
		) => {
			doc.body.innerHTML = html;
			const element = describeElement($(selector));
			return {
				id: `m${n}`,
				number: n,
				shot: shotId,
				shape: { kind: "element", rect: element.rect },
				element,
			} as Mark;
		};
		return {
			...sampleCase(),
			pages: [
				{ url: KK, title: "Warenkorb", lang: "de" },
				{ url: PAY, title: "Zahlung", lang: "de" },
			],
			shots: [shot("s1", 0, KK), shot("s2", 0, PAY)],
			marks: [mark(1, "s1", CART_PAGE, "button"), mark(2, "s2", PAY_PAGE, "a")],
		};
	}
	const go = (path: string, html: string) => {
		(doc.defaultView as unknown as Window).history.pushState({}, "", path);
		doc.body.innerHTML = html;
	};
	const statuses = (matches: { status: string }[] | undefined) =>
		matches?.map((m) => m.status);

	/**
	 * An app shell: a header every route has, with the logo marked on the
	 * cart (mark 1), and the route's own content in `main`; mark 2 is the
	 * payment page's help link.
	 */
	const HEADER = `<header class="Shell_header"><a class="Logo_home" href="/">Acme</a></header>`;
	function shell(): Case {
		doc.body.innerHTML = `${HEADER}${PAY_PAGE}`;
		const help = describeElement($("a.Help_link"));
		doc.body.innerHTML = `${HEADER}${CART_PAGE}`;
		const logo = describeElement($("a.Logo_home"));
		const mark = (n: number, shotId: string, element: typeof logo) =>
			({
				id: `m${n}`,
				number: n,
				shot: shotId,
				shape: { kind: "element", rect: element.rect },
				element,
				comment: "",
			}) as Mark;
		return {
			...flow(),
			marks: [mark(1, "s1", logo), mark(2, "s2", help)],
		};
	}
	/** The router goes on: the address and `main` change, the header stays. */
	const route = (path: string, main: string) => {
		(doc.defaultView as unknown as Window).history.pushState({}, "", path);
		$("main").outerHTML = main;
	};

	test("a single-page app goes on to its next route: its marks are drawn and the previous route's go", async () => {
		const c = shell();
		doc.body.innerHTML = `${HEADER}${CART_PAGE}`;
		const first = await reviewer.load(c);
		expect(statuses(first.matches)).toEqual(["found", "lost"]);
		const logo = $("a.Logo_home");
		// The logo's popover open, a comment typed: the route change closes it.
		overlay.onPick?.(1);
		textField(overlay.popover).value = "Larger";
		route("/kk/pay", PAY_PAGE);
		expect(location.href).toBe(PAY);
		// The logo is still there, and still not the payment page's mark.
		expect(logo.isConnected).toBe(true);
		// Asked about that one mark at once (an AI app's get_mark_element).
		expect(reviewer.target("m2")?.match.status).toBe("found");
		expect(reviewer.target("m2")?.element).toBe($("a.Help_link"));
		expect(reviewer.target("m1")?.element).toBeUndefined();
		expect(overlay.popover.hidden).toBe(true);
		expect(asked.at(-1)).toMatchObject({
			type: "mark:comment",
			markId: "m1",
			text: "Larger",
		});
		// The panel's question: what is there now, for the page it shows now.
		const now = await reviewer.matches(c.id);
		expect(now?.url).toBe(PAY);
		expect(statuses(now?.matches)).toEqual(["lost", "found"]);
		expect(now?.matches[0]?.candidates).toHaveLength(0);
		expect(overlay.items.map((i) => i.number)).toEqual([2]);
		expect(bar()).toContain("1 of 1 found");
		expect(await reviewer.matches("c_other")).toBeNull();
	});

	test("by itself too, a moment later, and for content that comes after the address", async () => {
		const c = shell();
		doc.body.innerHTML = `${HEADER}${CART_PAGE}`;
		await reviewer.load(c);
		expect(overlay.items.map((i) => i.number)).toEqual([1]);
		// The address first, the route's content only after a second.
		route("/kk/pay", `<main><p>Lädt…</p></main>`);
		await Bun.sleep(TICK_MS * 1.4);
		// The logo's mark went with its route, though the logo stayed.
		expect(overlay.items).toHaveLength(0);
		route("/kk/pay", PAY_PAGE);
		await until(() => overlay.items.length > 0);
		expect(overlay.items.map((i) => i.number)).toEqual([2]);
		expect(overlay.items[0]?.found).toBe(true);
	});

	test("a mark is looked for and drawn only on its own page, also once the page in front joins the case", async () => {
		const c = flow();
		// Another page with the cart's button in it, and none of the case's pages.
		const DONE = "https://www.example.com/kk/done";
		const DONE_PAGE = `<main class="Done_page"><h1>Danke</h1><button class="Button_primary" type="submit">Weiter</button></main>`;
		go("/kk/done", DONE_PAGE);
		const first = await reviewer.load(c);
		// Neither is looked for here: no candidate, nothing drawn, nothing counted.
		expect(first.matches.map((m) => [m.status, m.candidates.length])).toEqual([
			["lost", 0],
			["lost", 0],
		]);
		expect(overlay.items).toHaveLength(0);
		expect(bar()).toContain("no marks on this page");
		// A mark added here: the page is one of the case's now, and the cart's
		// button is still not mark 1 (it was, dashed: "Unsure").
		const element = describeElement($("h1"));
		const added: Case = {
			...c,
			pages: [...(c.pages ?? []), { url: DONE, title: "Danke", lang: "de" }],
			shots: [...c.shots, shot("s3", 0, DONE)],
			marks: [
				...c.marks,
				{
					id: "m3",
					number: 3,
					shot: "s3",
					shape: { kind: "element", rect: element.rect },
					element,
				} as Mark,
			],
		};
		const next = await reviewer.update(added);
		expect(
			next?.matches.map((m) => [m.number, m.status, m.candidates.length]),
		).toEqual([
			[1, "lost", 0],
			[2, "lost", 0],
			[3, "found", 1],
		]);
		expect(overlay.items.map((i) => i.number)).toEqual([3]);
		expect(bar()).toContain("1 of 1 found");
		// On the cart, the cart's mark is drawn, and the done page's goes.
		go("/kk", CART_PAGE);
		const back = await reviewer.matches(c.id);
		expect(statuses(back?.matches)).toEqual(["found", "lost", "lost"]);
		expect(overlay.items.map((i) => [i.number, i.found])).toEqual([[1, true]]);
	});
});

describe("the popover and a mark that takes another number", () => {
	const PAGE = `<main><h1>Prämien</h1><button>Berechnen</button><p>Tipp</p></main>`;
	const field = () => textField(overlay.popover);
	const button = (action: string) =>
		overlay.popover.querySelector(
			`[data-action="${action}"]`,
		) as HTMLButtonElement;
	const settled = () => new Promise<void>((r) => setTimeout(r, 0));

	/** A case with Tess's mark 3 on the button; and the same after the team's sync: Dana's mark is 3, Tess's is 4. */
	function cases(): { before: Case; after: Case } {
		doc.body.innerHTML = PAGE;
		const base = caseOf($("button"));
		const mine = {
			...(base.marks[0] as Mark),
			id: "m3",
			number: 3,
			comment: "Tess's third",
		};
		const hers = describeElement($("p"));
		const theirs = {
			id: "m3",
			number: 3,
			shot: "s2",
			comment: "Dana's third",
			shape: { kind: "element", rect: hers.rect },
			element: hers,
		} as Mark;
		const before: Case = { ...base, marks: [mine] };
		const after: Case = {
			...base,
			updatedAt: "2026-11-19T12:00:00.000Z",
			shots: [...base.shots, shot("s2", 0)].map((s, i) => ({
				...s,
				capturedAt: `2026-11-04T10:0${i}:00Z`,
			})),
			marks: [theirs, { ...mine, id: "m4", number: 4 }],
		};
		return {
			before: {
				...before,
				shots: before.shots.map((s) => ({
					...s,
					capturedAt: "2026-11-04T10:00:00Z",
				})),
			},
			after,
		};
	}

	test("typed into mark 3, which becomes mark 4 while a teammate's mark arrives as 3: the text is saved onto its own mark", async () => {
		const { before, after } = cases();
		await reviewer.load(before);
		overlay.onPick?.(3);
		field().value = "Typed while the sync ran";
		// The team's sync renumbers: the panel sends the case as it is now.
		await reviewer.update(after);
		expect(overlay.popover.hidden).toBe(false);
		// The popover is still on Tess's mark, which is 4 now, with her text.
		expect(overlay.popover.querySelector(".pin")?.textContent).toBe("4");
		expect(field().value).toBe("Typed while the sync ran");
		button("mark-done").click();
		await settled();
		const sent = asked.filter((r) => r.type === "mark:comment").at(-1);
		expect(sent).toMatchObject({
			type: "mark:comment",
			markId: "m4",
			text: "Typed while the sync ran",
		});
	});

	test("the id is another mark's and two marks have its screenshot and drawing: nothing is asked, and that is said", async () => {
		const { before, after } = cases();
		await reviewer.load(before);
		overlay.onPick?.(3);
		field().value = "Typed while the sync ran";
		// Tess's mark is 4 now, and a mark nothing tells from it is 5.
		const own = after.marks[1] as Mark;
		await reviewer.update({
			...after,
			marks: [...after.marks, { ...own, id: "m5", number: 5 }],
		});
		const problem = overlay.popover.querySelector(".problem");
		expect(overlay.popover.hidden).toBe(false);
		expect(problem?.textContent).toBe(MARK_CHANGED);
		expect(field().value).toBe("Typed while the sync ran");
		asked.length = 0;
		button("mark-done").click();
		await settled();
		// Not the teammate's mark 3, not the first of the two: nothing.
		expect(asked).toEqual([]);
		expect(overlay.popover.hidden).toBe(false);
		expect(problem?.textContent).toBe(MARK_CHANGED);
	});

	test("its mark gone from the case: the popover goes, and nothing is asked", async () => {
		const { before, after } = cases();
		await reviewer.load(before);
		overlay.onPick?.(3);
		field().value = "Typed";
		await reviewer.update({
			...after,
			marks: after.marks.filter((a) => a.id === "m3"),
		});
		expect(overlay.popover.hidden).toBe(true);
		expect(asked.some((r) => r.type === "mark:comment")).toBe(false);
	});
});

test("a mark request no panel answers, or that cannot be sent, is said as no panel showing the case", async () => {
	const request: MarkRequest = {
		type: "mark:comment",
		caseId: "c_1",
		markId: "m1",
		text: "Typed",
	};
	const none = { ok: false, error: NO_PANEL };
	expect(await panelAsker(async () => undefined)(request)).toEqual(none);
	expect(
		await panelAsker(async () => {
			throw new Error("Could not establish connection.");
		})(request),
	).toEqual(none);
	expect(await panelAsker(async () => ({ ok: true }))(request)).toEqual({
		ok: true,
	});
});

describe("a highlight's text (DEC-066)", () => {
	// happy-dom has no style sheet of its own: the <b> is said to be inline.
	const PAGE = `<main><p>Ride the trails this <b style="display: inline">wekend</b>: pick up a bike</p></main>`;

	function highlighted(): Case {
		const p = $("p");
		const element = describeElement(p);
		const mark = {
			id: "m1",
			number: 1,
			shot: "s1",
			comment: "Typo",
			author: "user",
			shape: { kind: "box", rect: element.rect },
			crop: "crops/m1.webp",
			element,
			highlight: {
				text: "wekend: pick up",
				before: "Ride the trails this ",
				after: " a bike",
				rects: [element.rect],
			},
		} as Mark;
		return { ...sampleCase(), shots: [shot("s1")], marks: [mark] };
	}

	test("a fix in one of its text nodes makes it probable, the text changed; the text back makes it found", async () => {
		doc.body.innerHTML = PAGE;
		const loaded = await reviewer.load(highlighted());
		expect(loaded.matches[0]?.status).toBe("found");
		expect(loaded.matches[0]?.textChanged).toBeUndefined();
		// What a framework does with a fix: one text node's value set. The
		// range keeps its other end and is not collapsed.
		const node = $("b").firstChild as Text;
		node.nodeValue = "weekend";
		let now = await reviewer.matches(highlighted().id);
		await until(() => {
			void reviewer.matches(highlighted().id).then((m) => {
				now = m;
			});
			return now?.matches[0]?.textChanged === true;
		});
		expect(now?.matches[0]?.status).toBe("probable");
		// Undone (or the text came late): looked for again by itself.
		node.nodeValue = "wekend";
		await until(() => {
			void reviewer.matches(highlighted().id).then((m) => {
				now = m;
			});
			return now?.matches[0]?.textChanged === undefined;
		});
		expect(now?.matches[0]?.status).toBe("found");
	});
});
