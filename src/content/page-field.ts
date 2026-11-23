/**
 * A comment field in a dialog on the page (DEC-064): a frame of the
 * extension's own (`field/index.html`), not a textarea in the shadow root.
 * The page's own scripts saw every key typed into a textarea there and every
 * paste (their listeners on `window` run before the content script's, which
 * is injected after them): in the frame they see neither. What was typed
 * comes back over the frame's port; `value` is the last that came.
 */

import type { FieldInit, FromField, ToField } from "../lib/field-protocol.ts";
import { handPort } from "../lib/frame-port.ts";

/** Each field by its frame: what a dialog's code and the unit tests reach it by. */
const fields = new WeakMap<Element, PageField>();

/** The field whose frame is `element`. */
export function fieldOf(
	element: Element | null | undefined,
): PageField | undefined {
	return element ? fields.get(element) : undefined;
}

/** The field page's address; none where there is no extension (the unit tests' DOM). */
function fieldUrl(): string {
	const runtime = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
	return runtime?.getURL ? runtime.getURL("field/index.html") : "about:blank";
}

export class PageField {
	readonly element: HTMLIFrameElement;
	#value: string;
	#port: MessagePort | undefined;
	#queue: ToField[] = [];
	onInput: ((value: string) => void) | undefined;
	onSubmit: ((value: string) => void) | undefined;
	onEscape: ((value: string) => void) | undefined;

	constructor(doc: Document, init: FieldInit) {
		this.#value = init.value;
		const frame = doc.createElement("iframe");
		frame.className = "field";
		frame.title = init.label;
		frame.src = fieldUrl();
		frame.addEventListener("load", () => {
			this.#port?.close();
			const port = handPort(frame, { ...init, value: this.#value });
			port.onmessage = (e: MessageEvent<FromField>) => this.receive(e.data);
			this.#port = port;
			for (const m of this.#queue.splice(0)) port.postMessage(m);
		});
		this.element = frame;
		fields.set(frame, this);
	}

	get value(): string {
		return this.#value;
	}

	set value(value: string) {
		this.#value = value;
		this.#say({ type: "set", value });
	}

	set disabled(on: boolean) {
		this.#say({ type: "disabled", on });
	}

	set label(label: string) {
		this.element.title = label;
		this.#say({ type: "label", label });
	}

	focus(): void {
		this.element.focus();
		this.#say({ type: "focus" });
	}

	#say(message: ToField): void {
		if (this.#port === undefined) this.#queue.push(message);
		else this.#port.postMessage(message);
	}

	/** What the frame said (a unit test says it in the frame's place). */
	receive(m: FromField): void {
		if (m.type === "height") {
			this.element.style.height = `${Math.max(40, Math.min(m.px, 260))}px`;
			return;
		}
		this.#value = m.value;
		if (m.type === "input") this.onInput?.(m.value);
		else if (m.type === "submit") this.onSubmit?.(m.value);
		else this.onEscape?.(m.value);
	}
}
