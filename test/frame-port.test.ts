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
