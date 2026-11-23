import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
	anchorShift,
	holdClickedInPlace,
	markAnchorKeys,
} from "../src/sidepanel/scroll-anchor.ts";

test("which marks anchor the hold, and how far the page moves back (DEC-060)", () => {
	const order = ["m1", "m2", "m3", "m4"];
	// The acted row, then the ones after it, then those before, nearest first.
	expect(markAnchorKeys(order, "m2")).toEqual(["m2", "m3", "m4", "m1"]);
	expect(markAnchorKeys(order, "m4")).toEqual(["m4", "m3", "m2", "m1"]);
	expect(markAnchorKeys(order, "gone")).toEqual(["gone"]);

	const tops = (map: Record<string, number>) => (key: string) => map[key];
	// Verify: the row drawn anew 190 px lower (pictures above came back): back up.
	expect(anchorShift(["m2", "m3"], 380, tops({ m2: 570, m3: 700 }))).toBe(190);
	// Deleted, or left out by a filter: the next mark takes its place.
	expect(anchorShift(["m2", "m3"], 380, tops({ m3: 570 }))).toBe(190);
	// Where it was: nothing to do; half a pixel is no move.
	expect(anchorShift(["m2"], 380, tops({ m2: 380.4 }))).toBe(0);
	// Nothing of it there (the list emptied): nothing to hold.
	expect(anchorShift(["m2", "m3"], 380, tops({}))).toBeUndefined();
});

/** A panel of one list and a tool bar, with the scroll and the layout stubbed. */
function panel() {
	const window = new Window();
	const doc = window.document as unknown as Document;
	const win = window as unknown as Window & typeof globalThis;
	let scrollY = 1400;
	const scrollHeight = 2000;
	const html = doc.documentElement;
	Object.defineProperty(html, "clientHeight", {
		value: 600,
		configurable: true,
	});
	Object.defineProperty(html, "scrollHeight", {
		get: () => scrollHeight,
		configurable: true,
	});
	Object.defineProperty(win, "scrollY", {
		get: () => scrollY,
		configurable: true,
	});
	const frames: FrameRequestCallback[] = [];
	(win as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame =
		(cb: FrameRequestCallback) => frames.push(cb);
	(win as unknown as { scrollBy: unknown }).scrollBy = (
		_x: number,
		y: number,
	) => {
		scrollY += y;
	};
	doc.body.innerHTML = `<div id="case"><ol class="marks"><li class="mark" data-mark="m1"><button>Verify</button></li></ol><div class="case-dock" data-room-before></div></div>`;
	const root = doc.getElementById("case") as unknown as HTMLElement;
	const dock = () =>
		root.querySelector("[data-room-before]") as unknown as HTMLElement;
	const scroll = (to: number) => {
		scrollY = to;
		win.dispatchEvent(new window.Event("scroll") as unknown as Event);
	};
	return { window, doc, root, dock, scroll, html };
}

describe("the hold's room below the list (DEC-064's review)", () => {
	test("lent at a click, kept at the next press, given back only out of sight as the person scrolls up", () => {
		const p = panel();
		holdClickedInPlace(p.root);
		(p.root.querySelector("button") as unknown as HTMLButtonElement).click();
		expect(p.dock().style.marginTop).toBe("600px");
		expect(p.html.style.overflowAnchor).toBe("none");
		// The next press: the hold goes, the room stays (nothing moves under it).
		p.doc.dispatchEvent(new p.window.Event("pointerdown") as unknown as Event);
		expect(p.dock().style.marginTop).toBe("600px");
		expect(p.html.style.overflowAnchor).toBe("");
		// At the end of the page, all of it in sight: kept.
		p.scroll(1400);
		expect(p.dock().style.marginTop).toBe("600px");
		// Scrolled up 200 px: those 200 px of room are below the window now.
		p.scroll(1200);
		expect(p.dock().style.marginTop).toBe("400px");
	});

	test("a scroll of someone else's lets the hold go", () => {
		const p = panel();
		holdClickedInPlace(p.root);
		(p.root.querySelector("button") as unknown as HTMLButtonElement).click();
		expect(p.html.style.overflowAnchor).toBe("none");
		p.scroll(900);
		expect(p.html.style.overflowAnchor).toBe("");
	});

	test("a tool bar drawn anew gets the room again at the next click", () => {
		const p = panel();
		holdClickedInPlace(p.root);
		(p.root.querySelector("button") as unknown as HTMLButtonElement).click();
		const old = p.dock();
		const fresh = p.doc.createElement("div");
		fresh.setAttribute("data-room-before", "");
		old.replaceWith(fresh);
		(p.root.querySelector("button") as unknown as HTMLButtonElement).click();
		expect((fresh as unknown as HTMLElement).style.marginTop).toBe("600px");
	});
});
