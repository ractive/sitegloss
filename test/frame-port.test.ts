import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { PageField } from "../src/content/page-field.ts";
import { fieldKey } from "../src/lib/field-protocol.ts";
import { FRAME_HELLO, helloPort } from "../src/lib/frame-port.ts";

describe("the field's frame takes one hello, the content script's (DEC-064)", () => {
	const parent = {};
	const { port1 } = new MessageChannel();
	const hello = (over: Record<string, unknown> = {}) => ({
		source: parent,
		ports: [port1] as readonly MessagePort[],
		data: { type: FRAME_HELLO, token: "t-1", init: { label: "x" } },
		...over,
	});

	test("from its parent, one port, its type, the token of its address: taken", () => {
		expect(helloPort(hello(), parent, "t-1")?.port === port1).toBe(true);
	});

	test("the page's own hello is refused: it cannot name the token", () => {
		for (const e of [
			hello({ data: { type: FRAME_HELLO, init: {} } }),
			hello({ data: { type: FRAME_HELLO, token: "guessed", init: {} } }),
			hello({ data: { type: "other", token: "t-1", init: {} } }),
			hello({ ports: [] }),
			hello({ ports: [port1, port1] }),
			hello({ source: {} }),
		])
			expect(helloPort(e, parent, "t-1")).toBeUndefined();
		// A frame without a token in its address takes nothing.
		expect(helloPort(hello(), parent, "")).toBeUndefined();
	});
});

describe("a field whose frame does not come up (DEC-064)", () => {
	test("the dialog says so and offers the side panel; a late ready brings the field back", () => {
		const doc = new Window().document as unknown as Document;
		const field = new PageField(doc, {
			label: "Comment for mark 1",
			value: "",
			maxLength: 100,
		});
		let panel = 0;
		field.onPanel = () => void panel++;
		doc.body.append(field.element);
		expect(field.available).toBe(true);
		field.unavailable();
		expect(field.available).toBe(false);
		expect(field.frame.hidden).toBe(true);
		const button = field.element.querySelector(
			'[data-action="field-in-panel"]',
		) as HTMLButtonElement;
		expect(
			field.element.querySelector(".field-problem")?.textContent,
		).toContain("side panel");
		button.click();
		expect(panel).toBe(1);
		field.receive({ type: "ready" });
		expect(field.available).toBe(true);
		expect(field.frame.hidden).toBe(false);
	});
});

describe("the field's keys (DEC-064's review)", () => {
	const key = (k: string, more: Partial<KeyboardEvent> = {}) => ({
		key: k,
		isComposing: false,
		keyCode: 0,
		shiftKey: false,
		metaKey: false,
		ctrlKey: false,
		...more,
	});

	test("Escape and Ctrl or Cmd with Enter; Enter alone only in a one-line note", () => {
		expect(fieldKey(key("Escape"), false)).toBe("escape");
		expect(fieldKey(key("Enter", { ctrlKey: true }), false)).toBe("submit");
		expect(fieldKey(key("Enter", { metaKey: true }), false)).toBe("submit");
		expect(fieldKey(key("Enter"), false)).toBeUndefined();
		expect(fieldKey(key("Enter"), true)).toBe("submit");
		expect(fieldKey(key("Enter", { shiftKey: true }), true)).toBeUndefined();
	});

	test("an input method's Enter and Escape save and drop nothing", () => {
		expect(
			fieldKey(key("Escape", { isComposing: true }), false),
		).toBeUndefined();
		expect(fieldKey(key("Enter", { isComposing: true }), true)).toBeUndefined();
		expect(fieldKey(key("Enter", { keyCode: 229 }), true)).toBeUndefined();
	});
});

describe("a field's frame that loads again (DEC-064's second review)", () => {
	test("a new address and token before anything is handed; then its text, label, state and the focus it had", async () => {
		const had = (globalThis as { chrome?: unknown }).chrome;
		(globalThis as { chrome?: unknown }).chrome = {
			runtime: { getURL: (p: string) => `chrome-extension://abc/${p}` },
		};
		try {
			const win = new Window();
			const doc = win.document as unknown as Document;
			const field = new PageField(doc, {
				label: "Comment for mark 1",
				value: "",
				maxLength: 100,
			});
			const hellos: {
				token: string;
				init: Record<string, unknown>;
				port: MessagePort;
			}[] = [];
			Object.defineProperty(field.frame, "contentWindow", {
				value: {
					postMessage: (
						data: { token: string; init: Record<string, unknown> },
						_origin: string,
						transfer: MessagePort[],
					) =>
						hellos.push({
							token: data.token,
							init: data.init,
							port: transfer[0] as MessagePort,
						}),
				},
			});
			let focused = 0;
			field.frame.focus = () => void focused++;
			const load = () =>
				field.frame.dispatchEvent(new win.Event("load") as unknown as Event);
			const first = field.frame.src;
			// Hidden until this load's frame answers.
			expect(field.frame.style.visibility).toBe("hidden");
			load();
			field.receive({ type: "ready" });
			expect(field.frame.style.visibility).toBe("");
			field.receive({ type: "input", value: "Half way" });
			field.receive({ type: "focus", on: true });
			field.label = "Comment for mark 2";
			field.disabled = true;
			// The overlay moves; the old document's blur as it goes.
			field.keepFocus();
			field.receive({ type: "focus", on: false });
			load();
			// Nothing handed to that load: its token was used. A new address.
			expect(hellos.length).toBe(1);
			expect(field.frame.src === first).toBe(false);
			expect(field.frame.style.visibility).toBe("hidden");
			load();
			const again = hellos[1];
			if (again === undefined) throw new Error("no second hello");
			expect(again.token === hellos[0]?.token).toBe(false);
			expect(field.frame.src.endsWith(`#${again.token}`)).toBe(true);
			expect(again.init).toMatchObject({
				label: "Comment for mark 2",
				value: "Half way",
				disabled: true,
			});
			const heard: unknown[] = [];
			again.port.onmessage = (e) => void heard.push(e.data);
			const before = focused;
			field.receive({ type: "ready" });
			await new Promise((r) => setTimeout(r, 10));
			expect(focused).toBe(before + 1);
			expect(heard).toContainEqual({ type: "focus" });
		} finally {
			(globalThis as { chrome?: unknown }).chrome = had;
		}
	});

	test("a ready that comes after the way out was offered puts the focus into the field", () => {
		const had = (globalThis as { chrome?: unknown }).chrome;
		(globalThis as { chrome?: unknown }).chrome = {
			runtime: { getURL: (p: string) => `chrome-extension://abc/${p}` },
		};
		try {
			const win = new Window();
			const doc = win.document as unknown as Document;
			const field = new PageField(doc, { label: "x", value: "", maxLength: 9 });
			doc.body.append(field.element);
			let focused = 0;
			field.frame.focus = () => void focused++;
			field.unavailable();
			field.focus();
			expect(doc.activeElement?.getAttribute("data-action")).toBe(
				"field-in-panel",
			);
			field.receive({ type: "ready" });
			expect(field.available).toBe(true);
			expect(focused).toBe(1);
		} finally {
			(globalThis as { chrome?: unknown }).chrome = had;
		}
	});
});

test("the token needs no secure context: run with a crypto that has no randomUUID", async () => {
	const { frameToken } = await import("../src/lib/frame-port.ts");
	const random = {
		getRandomValues: <T extends ArrayBufferView | null>(a: T) =>
			crypto.getRandomValues(a as unknown as Uint8Array) as unknown as T,
	};
	expect("randomUUID" in random).toBe(false);
	const a = frameToken(random);
	expect(a).toMatch(/^[0-9a-f]{32}$/);
	expect(frameToken(random) === a).toBe(false);
});

test("the frame takes the first hello that holds, and no second one on that load", async () => {
	const { framePort, FRAME_HELLO: TYPE } = await import(
		"../src/lib/frame-port.ts"
	);
	const listeners = new Set<(e: Event) => void>();
	const target = {
		addEventListener: (_t: string, f: (e: Event) => void) =>
			void listeners.add(f),
		removeEventListener: (_t: string, f: (e: Event) => void) =>
			void listeners.delete(f),
	} as unknown as Parameters<typeof framePort>[0];
	const parent = {};
	const send = (port: MessagePort) => {
		for (const f of [...listeners])
			f({
				source: parent,
				ports: [port],
				data: { type: TYPE, token: "t", init: 1 },
			} as unknown as Event);
	};
	const taken = framePort<number>(target, parent, "t");
	const first = new MessageChannel().port1;
	const second = new MessageChannel().port1;
	send(first);
	send(second);
	expect((await taken).port === first).toBe(true);
	expect(listeners.size).toBe(0);
});
