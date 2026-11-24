/**
 * The pairing box's "How do I add it?": the client library's steps per AI app
 * (`@ractive-ch/tab-mcp-client/setup`, the same as its connect dialog and the
 * tab-mcp extension's panel), each command in a block with its own Copy, and
 * the Copy buttons' status line under it. Text only through `textContent`.
 */

import {
	SETUP_GUIDE,
	setupInstructions,
} from "@ractive-ch/tab-mcp-client/setup";
import { SERVER_NAME } from "../worker/protocol.ts";
import { byId, h } from "./dom.ts";
import { setLabel, withIcon } from "./icons.ts";

/** How long a Copy button says "Copied". */
export const COPIED_MS = 1500;
/** How long the status line says what a Copy did. */
export const STATUS_MS = 5000;

/** What a refused Copy says: what it was for is selected instead. */
export const SELECTED = "Selected: copy it with Ctrl+C or ⌘C";

/**
 * Copy `text` with `button`, which says "Copied" for a moment, its label
 * too ("Copied Codex command"); `announce` says so in the status line, as
 * the focus stays on the button. A refused clipboard (the panel not focused,
 * say) selects `shown`, the element that shows the text, to copy by hand.
 */
/** Each Copy button's pending switch back to "Copy": a new Copy restarts it. */
const reverts = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function copyText(
	button: HTMLElement,
	text: string,
	noun: string,
	shown: HTMLElement,
	announce: (message: string) => void,
): void {
	const say = (what: "Copy" | "Copied") => {
		setLabel(button, what === "Copied" ? "check" : "copy", what);
		button.setAttribute("aria-label", `${what} ${noun}`);
	};
	const refused = () => {
		shown.ownerDocument.getSelection()?.selectAllChildren(shown);
		announce(SELECTED);
	};
	const clipboard = button.ownerDocument.defaultView?.navigator.clipboard;
	if (clipboard === undefined) {
		refused();
		return;
	}
	clipboard.writeText(text).then(() => {
		say("Copied");
		announce(`Copied ${noun}`);
		clearTimeout(reverts.get(button));
		reverts.set(
			button,
			setTimeout(() => {
				reverts.delete(button);
				say("Copy");
			}, COPIED_MS),
		);
	}, refused);
}

/**
 * The list items for `address`: per AI app its name, what to do, a command
 * with Copy, a note.
 */
export function setupSteps(
	address: string,
	announce: (message: string) => void,
): HTMLLIElement[] {
	return setupInstructions(SERVER_NAME, address).map(
		({ id, app, text, command, note }) => {
			const parts: Node[] = [h("strong", {}, app), h("span", {}, text)];
			if (command !== undefined) {
				const noun = `${app} command`;
				// Its lines as they are: a one-line copy of Codex's two would run wrong.
				const pre = h("pre", { dir: "ltr" }, command);
				const copy = h(
					"button",
					{
						type: "button",
						class: "small copy",
						"aria-label": `Copy ${noun}`,
						onclick: () => copyText(copy, command, noun, pre, announce),
					},
					...withIcon("copy", "Copy"),
				);
				parts.push(h("div", { class: "command" }, pre, copy));
			}
			if (note !== undefined)
				parts.push(
					h(
						"p",
						{ class: "meta note" },
						...note.map((part) =>
							"code" in part ? h("code", {}, part.code) : part.text,
						),
					),
				);
			return h("li", { "data-app": id }, ...parts);
		},
	);
}

/** The setup steps and the status line, in the panel's page. */
export interface Setup {
	/** Show the steps for `address`, none for `""` (not pairing). */
	show(address: string): void;
	/** Say what a Copy did, in the status line. */
	announce(message: string): void;
}

export function startSetup(): Setup {
	const details = byId<HTMLDetailsElement>("setup");
	const steps = byId("setup-steps");
	const status = byId("copy-status");
	// The page names the guide too; the library's address is the one that counts.
	byId<HTMLAnchorElement>("setup-guide").href = SETUP_GUIDE;
	let statusTimer: ReturnType<typeof setTimeout> | undefined;
	const announce = (message: string) => {
		status.textContent = message;
		clearTimeout(statusTimer);
		statusTimer = setTimeout(() => {
			status.textContent = "";
		}, STATUS_MS);
	};
	/** The address the steps were made for. */
	let stepsFor = "";
	return {
		// The steps name the address: made again only when it changes, so a
		// "Copied" and the focus on a Copy stay.
		show(address) {
			details.hidden = address === "";
			if (address === stepsFor) return;
			stepsFor = address;
			steps.replaceChildren(
				...(address === "" ? [] : setupSteps(address, announce)),
			);
		},
		announce,
	};
}
