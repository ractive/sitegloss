/** What the page's dialogs and their comment field frame say to each other (DEC-064). */

export interface FieldInit {
	/** The field's accessible name. */
	label: string;
	/** Read with the label: the help under it. */
	description?: string;
	value: string;
	maxLength: number;
	/** Enter alone saves (a one-line note); otherwise Ctrl or Cmd with Enter. */
	enterSubmits?: boolean;
	/** Not to be typed in now (a request under way); kept across a reload. */
	disabled?: boolean;
}

/** To the frame. */
export type ToField =
	| { type: "focus" }
	| { type: "set"; value: string }
	| { type: "disabled"; on: boolean }
	| { type: "label"; label: string };

/** From the frame. */
export type FromField =
	/** The port arrived: the field can be typed in. */
	| { type: "ready" }
	/** The field took or lost the focus (kept across a reload of the frame). */
	| { type: "focus"; on: boolean }
	| { type: "input"; value: string }
	| { type: "submit"; value: string }
	| { type: "escape"; value: string }
	| { type: "height"; px: number };

/**
 * What a key in the field means: Escape, or saving with Ctrl or Cmd and
 * Enter (Enter alone in a one-line note). A key an input method takes (a
 * candidate chosen with Enter, dismissed with Escape) means nothing: a
 * half-typed comment is neither saved nor dropped (DEC-064's review).
 */
export function fieldKey(
	e: Pick<
		KeyboardEvent,
		"key" | "isComposing" | "keyCode" | "shiftKey" | "metaKey" | "ctrlKey"
	>,
	enterSubmits: boolean,
): "escape" | "submit" | undefined {
	if (e.isComposing || e.keyCode === 229) return undefined;
	if (e.key === "Escape") return "escape";
	if (
		e.key === "Enter" &&
		!e.shiftKey &&
		(e.metaKey || e.ctrlKey || enterSubmits)
	)
		return "submit";
	return undefined;
}
