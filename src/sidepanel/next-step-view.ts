/**
 * The open case's next step, drawn (DEC-069): under the counts, one quiet
 * line and the panel's own buttons, no colour of its own. A region with a
 * name; its sentence is announced when it changes, never on a render that
 * leaves it as it was. What a copy did is said under it.
 */

import { h } from "./dom.ts";
import type { NextStep, StepAction } from "./next-step.ts";

export interface StepParts {
	el: HTMLElement;
	text: HTMLElement;
	row: HTMLElement;
	note: HTMLElement;
	/** The buttons as last drawn: they are made again only when it changes. */
	key: string;
	/** What a click does, as of the latest render. */
	act: (action: StepAction) => void;
}

const LABEL: Record<StepAction, { label: string; title: string }> = {
	"add-marks": {
		label: "Add marks",
		title:
			"Each mark you draw on the page goes into this case when its comment is done",
	},
	share: {
		label: "Share with team",
		title:
			"Send this case to your team: its members see it, with its screenshots, and what anyone changes syncs",
	},
	export: {
		label: "Export…",
		title:
			"Save this case as one .zip file: its marks, comments, AI findings, summary, thread and screenshots, and case.md to read them without Sitegloss. Someone imports it with Import a case…",
	},
	"copy-link": {
		label: "Copy link",
		title:
			"Copy the case's address in the web app: it opens the case for the members of the team",
	},
	"copy-ai": {
		label: "Copy for your AI app",
		title:
			"Instructions for your AI app to work on this case: its address, how to reach it, and what to do with each mark",
	},
	verify: {
		label: "Start verifying",
		title:
			"Show only the marks to verify, and go to the first one: open its page with the fix and check it",
	},
	close: {
		label: "Close case",
		title:
			"Close the case: it is filed away under Closed, and stays readable and changeable. A new open mark opens it again.",
	},
};

export function nextStepParts(): StepParts {
	const text = h("p", {
		class: "next-step-text",
		id: "next-step-text",
		"aria-live": "polite",
	});
	const row = h("div", { class: "row next-step-actions" });
	const note = h("p", {
		class: "meta next-step-note",
		id: "next-step-note",
		role: "status",
	});
	const el = h(
		"section",
		{
			class: "next-step",
			id: "next-step",
			"aria-label": "Next step",
			tabindex: "-1",
			hidden: true,
		},
		text,
		row,
		note,
	);
	return { el, text, row, note, key: "", act: () => undefined };
}

/**
 * Draw `step` (none: the block is hidden). `act` carries out an action, as
 * the panel's other place for it does; `off` names the actions that cannot
 * be taken now, with why, as their other place says it.
 */
export function renderNextStep(
	p: StepParts,
	step: NextStep | undefined,
	note: string | undefined,
	act: (action: StepAction) => void,
	off: Partial<Record<StepAction, string>> = {},
): void {
	p.act = act;
	p.el.hidden = step === undefined;
	const text = step?.text ?? "";
	// The same words are not written again: a live region would say them again.
	if (p.text.textContent !== text) p.text.textContent = text;
	const shown = step === undefined ? undefined : note;
	if (p.note.textContent !== (shown ?? "")) p.note.textContent = shown ?? "";
	p.note.hidden = shown === undefined;
	const actions = step?.actions ?? [];
	const key = JSON.stringify(actions.map((a) => [a, off[a] ?? null]));
	if (key === p.key) return;
	p.key = key;
	const had = p.row.contains(document.activeElement);
	p.row.replaceChildren(
		...actions.map((action) => {
			const why = off[action];
			return h(
				"button",
				{
					type: "button",
					class: "small",
					"data-step": action,
					title: why ?? LABEL[action].title,
					disabled: why !== undefined,
					onclick: () => p.act(action),
				},
				LABEL[action].label,
			);
		}),
	);
	p.row.hidden = actions.length === 0;
	// A click that changed the step keeps the focus in the block.
	if (had)
		(p.row.querySelector<HTMLElement>("button:not(:disabled)") ?? p.el).focus();
}
