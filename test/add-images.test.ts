import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
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
import { pngHeader } from "./fixtures.ts";

/** Re-encodes to a tag of the file's own bytes; a file tagged `broken` cannot be decoded. */
const fakeEncode: Encode = async (file) => {
	const text = await file.text();
	if (text.endsWith("broken")) throw new Error("decode failed");
	return { blob: new Blob([`webp:${text}`]), width: 1440, height: 900 };
};
/** A PNG of `width`×`height` with `tag` after its header. */
const file = (
	tag: string,
	{
		type = "image/png",
		size,
		width = 1440,
		height = 900,
		apng = false,
	} = {} as {
		type?: string;
		size?: number;
		width?: number;
		height?: number;
		apng?: boolean;
	},
) => {
	const blob = new Blob(
		[pngHeader(width, height, { apng, tag }) as Uint8Array<ArrayBuffer>],
		{
			type,
		},
	);
	return size === undefined
		? blob
		: Object.defineProperty(blob, "size", { value: size });
};

describe("which pictures the dialog takes (DEC-058)", () => {
	test.each([
		["a PNG", file("a"), undefined],
		["an SVG", new Blob(["<svg/>"], { type: "image/svg+xml" }), NOT_READABLE],
		["an AVIF", file("a", { type: "image/avif" }), NOT_READABLE],
		["a file with no type", file("a", { type: "" }), NOT_READABLE],
		[
			"a file over 30 MB",
			file("a", { size: 30 * 1024 * 1024 + 1 }),
			TOO_MANY_BYTES,
		],
		[
			"a small file declaring 23000 × 23000",
			file("a", { width: 23_000, height: 23_000 }),
			TOO_MANY_PIXELS,
		],
		[
			"a file whose header is not its type's",
			new Blob(["GIF89a"], { type: "image/png" }),
			NOT_READABLE,
		],
		["a file the browser cannot decode", file("broken"), NOT_READABLE],
	])("%s", async (_name, f, problem) => {
		let decoded = 0;
		const done = await prepareImage(f, new Set(), async (blob, max) => {
			decoded++;
			return fakeEncode(blob, max);
		});
		expect("problem" in done ? done.problem : undefined).toBe(problem);
		// A picture too large by its header is never decoded.
		if (problem === TOO_MANY_PIXELS) expect(decoded).toBe(0);
	});

	test("the same picture twice is refused by its re-encoded bytes", async () => {
		const first = await prepareImage(file("a"), new Set(), fakeEncode);
		if ("problem" in first) throw new Error(first.problem);
		expect(
			await prepareImage(file("a"), new Set([first.sha256]), fakeEncode),
		).toEqual({
			problem: ON_THE_MARK,
		});
		// An animated picture keeps its first frame, and says so.
		expect(
			(await prepareImage(
				file("g", { apng: true }),
				new Set(),
				fakeEncode,
			)) as object,
		).toMatchObject({ firstFrame: true });
		expect(
			(await prepareImage(file("s"), new Set(), fakeEncode)) as object,
		).toMatchObject({ firstFrame: false });
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
			[file("a"), file("b"), new Blob(["<svg/>"], { type: "image/svg+xml" })],
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
