import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { TooManyPixels } from "../src/lib/images.ts";
import type { StoredImage } from "../src/lib/store.ts";
import {
	type Encode,
	NOT_READABLE,
	ON_THE_MARK,
	placesFor,
	prepareImage,
	TOO_MANY_BYTES,
	TOO_MANY_PIXELS,
} from "../src/sidepanel/add-images.ts";

/** Re-encodes to the file's own bytes; a file whose text is `pixels` has too many. */
const fakeEncode: Encode = async (file) => {
	const text = await file.text();
	if (text === "pixels") throw new TooManyPixels();
	if (text === "broken") throw new Error("decode failed");
	return { blob: new Blob([`webp:${text}`]), width: 1440, height: 900 };
};
const file = (text: string, type = "image/png", size?: number) => {
	const blob = new Blob([text], { type });
	return size === undefined
		? blob
		: Object.defineProperty(blob, "size", { value: size });
};

describe("which pictures the dialog takes (DEC-058)", () => {
	test.each([
		["a PNG", file("a"), undefined],
		["an SVG", file("<svg/>", "image/svg+xml"), NOT_READABLE],
		["a file with no type", file("a", ""), NOT_READABLE],
		[
			"a file over 30 MB",
			file("a", "image/jpeg", 30 * 1024 * 1024 + 1),
			TOO_MANY_BYTES,
		],
		["more than 64 million pixels", file("pixels"), TOO_MANY_PIXELS],
		[
			"a file the browser cannot decode",
			file("broken", "image/webp"),
			NOT_READABLE,
		],
	])("%s", async (_name, f, problem) => {
		const done = await prepareImage(f, new Set(), fakeEncode);
		expect("problem" in done ? done.problem : undefined).toBe(problem);
	});

	test("the same picture twice is refused by its re-encoded bytes", async () => {
		const first = await prepareImage(file("a"), new Set(), fakeEncode);
		if ("problem" in first) throw new Error(first.problem);
		expect(
			await prepareImage(file("a"), new Set([first.sha256]), fakeEncode),
		).toEqual({
			problem: ON_THE_MARK,
		});
		expect(
			(await prepareImage(
				file("g", "image/gif"),
				new Set(),
				fakeEncode,
			)) as object,
		).toMatchObject({ firstFrame: true });
	});

	test.each([
		[0, 2, { fit: 2 }],
		[4, 2, { fit: 2 }],
		[4, 3, { fit: 2, problem: "Mark 3 holds at most 6 images; 2 more fit." }],
		[5, 2, { fit: 1, problem: "Mark 3 holds at most 6 images; 1 more fits." }],
		[6, 1, { fit: 0, problem: "Mark 3 holds at most 6 images; no more fit." }],
	])("a mark holding %i takes %i: %o", (taken, wanted, expected) => {
		expect(placesFor(3, taken, wanted)).toEqual(expected);
	});
});

describe("the dialog that adds images to a mark (DEC-058)", () => {
	const window = new Window({
		url: "chrome-extension://x/sidepanel/index.html",
	});
	const globals = globalThis as unknown as Record<string, unknown>;
	const before = { document: globals["document"] };
	let open: typeof import("../src/sidepanel/add-images.ts").openAddImages;
	beforeAll(async () => {
		globals["document"] = window.document;
		open = (await import("../src/sidepanel/add-images.ts")).openAddImages;
	});
	afterAll(() => {
		globals["document"] = before.document;
		window.close();
	});

	test("previews what was given, numbered after the mark's images; Add keeps them, a failed Add stays", async () => {
		const added: StoredImage[][] = [];
		let fail = true;
		const back = window.document.createElement("button");
		window.document.body.append(back);
		const d = open({
			number: 3,
			screenshot: "blob:crop",
			have: 1,
			known: new Set(),
			encode: fakeEncode,
			returnTo: () => back as unknown as HTMLElement,
			add: async (images) => {
				if (fail) throw new Error("The browser's storage is full.");
				added.push(images);
			},
		});
		const q = (s: string) => d.dialog.querySelector<HTMLElement>(s);
		expect(window.document.activeElement?.textContent).toBe("Choose files…");
		expect(q(".add-images-head p")?.textContent).toContain(
			"Mark 3 has its screenshot already.",
		);
		await d.offer([], "paste");
		expect(q("[role=status]")?.textContent).toBe(
			"The clipboard holds no image. Copy a screenshot first.",
		);
		await d.offer(
			[file("a"), file("b"), file("<svg/>", "image/svg+xml")],
			"drop",
		);
		const rows = () =>
			[...d.dialog.querySelectorAll("li span")].map((s) => s.textContent);
		expect(rows()).toEqual(["Image 2, 1440 × 900", "Image 3, 1440 × 900"]);
		expect(q("[role=status]")?.textContent).toBe(NOT_READABLE);
		expect(q("[data-action=add]")?.textContent).toBe("Add 2 images");
		q("[aria-label='Remove image 2']")?.click();
		expect(rows()).toEqual(["Image 2, 1440 × 900"]);
		q("[data-action=add]")?.click();
		await Bun.sleep(0);
		expect(q("[role=status]")?.textContent).toBe(
			"The browser's storage is full.",
		);
		expect(d.dialog.isConnected).toBe(true);
		fail = false;
		q("[data-action=add]")?.click();
		await Bun.sleep(0);
		expect(added.map((x) => x.length)).toEqual([1]);
		expect(d.dialog.isConnected).toBe(false);
		expect(window.document.activeElement).toBe(back);
	});
});
