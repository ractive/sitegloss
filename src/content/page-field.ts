/**
 * A comment field in a dialog on the page (DEC-064): a frame of the
 * extension's own (`field/index.html`), not a textarea in the shadow root.
 * The page's own scripts saw every key typed into a textarea there and every
 * paste (their listeners on `window` run before the content script's, which
 * is injected after them): in the frame they see neither. What was typed
 * comes back over the frame's port; `value` is the last that came.
 *
 * Each load of the frame gets a token of its own, handed once: a frame that
 * loads again (the overlay moved into a modal dialog of the page, which the
 * page can cause) is sent to a new address with a new token before anything
 * is handed to it, so a token is never good twice. The frame cannot be seen
 * or typed in until it answered this load's hello ("ready"). Where it does
 * not come up, the dialog says so and offers the side panel instead. A frame
 * that loads again gets what it had back: the text, the label, the state,
 * and the focus if it had it.
 */

import type { FieldInit, FromField, ToField } from "../lib/field-protocol.ts";
import { frameToken, handPort } from "../lib/frame-port.ts";

/** Each field by its frame and its box: what a dialog's code and the unit tests reach it by. */
const fields = new WeakMap<Element, PageField>();

/** The field whose frame (or box) is `element`. */
export function fieldOf(
	element: Element | null | undefined,
): PageField | undefined {
	return element ? fields.get(element) : undefined;
}

/** The field page's address; none where there is no extension (the unit tests' DOM). */
function fieldUrl(): string | undefined {
	const runtime = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
	return runtime?.getURL ? runtime.getURL("field/index.html") : undefined;
}

/** How long the frame has to say it is ready before the dialog offers the panel. */
export const FIELD_READY_MS = 4000;

export class PageField {
	/** What the dialog puts in place: the frame, and the way out where it fails. */
	readonly element: HTMLDivElement;
	readonly frame: HTMLIFrameElement;
	#init: FieldInit;
	#value: string;
	#port: MessagePort | undefined;
	#queue: ToField[] = [];
	#ready = false;
	/** The focus is to be in the field once it is ready (asked, or held before a reload). */
	#wantFocus = false;
	/** Held across a move: the old document's blur as it goes does not count. */
	#holdFocus = false;
	#timer: ReturnType<typeof setTimeout> | undefined;
	/** This load's token, and whether it was handed already. */
	#token = "";
	#handed = false;
	#loads = 0;
	readonly #fallback: HTMLDivElement;
	onInput: ((value: string) => void) | undefined;
	onSubmit: ((value: string) => void) | undefined;
	onEscape: ((value: string) => void) | undefined;
	/** "Write it in the side panel", where the frame did not come up. */
	onPanel: (() => void) | undefined;

	constructor(doc: Document, init: FieldInit) {
		this.#init = { ...init };
		this.#value = init.value;
		const frame = doc.createElement("iframe");
		frame.className = "field";
		frame.title = init.label;
		// Not to be seen or typed in until this load answered (see above).
		frame.style.visibility = "hidden";
		const url = fieldUrl();
		const go = () => {
			this.#token = frameToken();
			this.#handed = false;
			this.#loads++;
			frame.src =
				url === undefined
					? "about:blank"
					: `${url}?load=${this.#loads}#${this.#token}`;
		};
		go();
		frame.addEventListener("load", () => {
			if (url === undefined) return;
			this.#port?.close();
			this.#port = undefined;
			this.#ready = false;
			frame.style.visibility = "hidden";
			// Loaded again with a token already handed (moved, or reloaded by
			// the page): to a new address and a new token first.
			if (this.#handed) {
				go();
				return;
			}
			this.#handed = true;
			const port = handPort(frame, this.#token, {
				...this.#init,
				value: this.#value,
			});
			port.onmessage = (e: MessageEvent<FromField>) => this.receive(e.data);
			this.#port = port;
			for (const m of this.#queue.splice(0)) port.postMessage(m);
			this.#wait();
		});
		const say = doc.createElement("p");
		say.className = "field-problem";
		say.textContent =
			"This page does not let Sitegloss's comment field load. Write it in the side panel instead.";
		const panel = doc.createElement("button");
		panel.type = "button";
		panel.dataset["action"] = "field-in-panel";
		panel.textContent = "Write it in the side panel";
		panel.addEventListener("click", () => this.onPanel?.());
		const fallback = doc.createElement("div");
		fallback.className = "field-fallback";
		fallback.hidden = true;
		fallback.append(say, panel);
		const box = doc.createElement("div");
		box.className = "field-box";
		box.append(frame, fallback);
		this.element = box;
		this.frame = frame;
		this.#fallback = fallback;
		fields.set(box, this);
		fields.set(frame, this);
		if (url !== undefined) this.#wait();
	}

	/** Until the frame says it is ready; past that, the dialog offers the panel. */
	#wait(): void {
		clearTimeout(this.#timer);
		this.#ready = false;
		this.#timer = setTimeout(() => {
			if (!this.#ready) this.unavailable();
		}, FIELD_READY_MS);
	}

	/** The frame did not come up: say so, with the way to the side panel. */
	unavailable(): void {
		this.frame.hidden = true;
		this.#fallback.hidden = false;
	}

	get available(): boolean {
		return this.#fallback.hidden === true;
	}

	get value(): string {
		return this.#value;
	}

	set value(value: string) {
		this.#value = value;
		this.#say({ type: "set", value });
	}

	set disabled(on: boolean) {
		this.#init.disabled = on;
		this.#say({ type: "disabled", on });
	}

	set label(label: string) {
		this.#init.label = label;
		this.frame.title = label;
		this.#say({ type: "label", label });
	}

	focus(): void {
		this.#wantFocus = true;
		if (!this.available) {
			this.#fallback.querySelector("button")?.focus();
			return;
		}
		if (!this.#ready) return;
		this.#focusField();
	}

	/** The field had the focus as the overlay moved: it gets it back once loaded again. */
	keepFocus(): void {
		this.#wantFocus = true;
		this.#holdFocus = true;
	}

	#focusField(): void {
		this.frame.focus();
		this.#say({ type: "focus" });
	}

	#say(message: ToField): void {
		if (this.#port === undefined) this.#queue.push(message);
		else this.#port.postMessage(message);
	}

	/** What the frame said (a unit test says it in the frame's place). */
	receive(m: FromField): void {
		if (m.type === "ready") {
			this.#ready = true;
			clearTimeout(this.#timer);
			// Late, after the way out was offered: the focus that was on it, or
			// asked for, goes into the field, not to the page (DEC-064's
			// second review).
			const root = this.element.getRootNode() as Document | ShadowRoot;
			const onFallback =
				!this.available && this.#fallback.contains(root.activeElement ?? null);
			this.frame.hidden = false;
			this.frame.style.visibility = "";
			this.#fallback.hidden = true;
			this.#holdFocus = false;
			if (this.#wantFocus || onFallback) this.#focusField();
			return;
		}
		if (m.type === "focus") {
			// The person moved on from the field: no focus to give back; but
			// not the blur of a document that goes as the overlay moves.
			if (m.on) this.#wantFocus = true;
			else if (!this.#holdFocus) this.#wantFocus = false;
			return;
		}
		if (m.type === "height") {
			this.frame.style.height = `${Math.max(40, Math.min(m.px, 260))}px`;
			return;
		}
		this.#value = m.value;
		if (m.type === "input") this.onInput?.(m.value);
		else if (m.type === "submit") this.onSubmit?.(m.value);
		else this.onEscape?.(m.value);
	}
}
