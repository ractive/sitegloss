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
}

/** To the frame. */
export type ToField =
	| { type: "focus" }
	| { type: "set"; value: string }
	| { type: "disabled"; on: boolean }
	| { type: "label"; label: string };

/** From the frame. */
export type FromField =
	| { type: "input"; value: string }
	| { type: "submit"; value: string }
	| { type: "escape"; value: string }
	| { type: "height"; px: number };
