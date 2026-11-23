/**
 * The comment field of the page's dialogs, in a frame of the extension's own
 * (DEC-064). The content script hands it a port; what is typed goes to the
 * content script over it, never through the page.
 */

import type { FieldInit, FromField, ToField } from "../lib/field-protocol.ts";
import { framePort } from "../lib/frame-port.ts";
import { HOVER_COLOUR, PAGE_LOOK } from "../lib/page-look.ts";

const field = document.getElementById("field") as HTMLTextAreaElement;
const description = document.getElementById("description") as HTMLElement;
const root = document.documentElement.style;
root.setProperty("--paper", PAGE_LOOK.popover);
root.setProperty("--text", PAGE_LOOK.popoverText);
root.setProperty("--edge", PAGE_LOOK.popoverEdge);
root.setProperty("--focus", HOVER_COLOUR);

const { port, init } = await framePort<FieldInit>();
const say = (message: FromField) => port.postMessage(message);

field.setAttribute("aria-label", init.label);
if (init.description) {
	description.textContent = init.description;
	field.setAttribute("aria-describedby", "description");
}
field.maxLength = init.maxLength;
// A one-line note: one line high, Enter saves.
document.documentElement.toggleAttribute(
	"data-line",
	init.enterSubmits === true,
);
field.value = init.value;
field.disabled = false;

field.addEventListener("input", () =>
	say({ type: "input", value: field.value }),
);
field.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		e.preventDefault();
		say({ type: "escape", value: field.value });
	} else if (
		e.key === "Enter" &&
		!e.shiftKey &&
		(e.metaKey || e.ctrlKey || init.enterSubmits === true)
	) {
		e.preventDefault();
		say({ type: "submit", value: field.value });
	}
});
// The frame's height follows the field's, within its limits.
new ResizeObserver(() =>
	say({ type: "height", px: Math.ceil(document.body.scrollHeight) }),
).observe(field);
// The frame focused from the page: the field takes it.
addEventListener("focus", () => field.focus());

port.onmessage = (e: MessageEvent<ToField>) => {
	const m = e.data;
	if (m.type === "focus") field.focus();
	else if (m.type === "set") field.value = m.value;
	else if (m.type === "disabled") field.disabled = m.on;
	else if (m.type === "label") field.setAttribute("aria-label", m.label);
};
