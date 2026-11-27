/**
 * The open case's next step, drawn (DEC-069): under the counts, one quiet
 * line and the panel's own buttons, no colour of its own. A region with a
 * name; its sentence is announced when it changes, never on a render that
 * leaves it as it was. What a copy did is said under it. Both live regions
 * stay rendered while empty (out of sight, not `hidden`), so that a reader
 * hears what is written into them.
 *
 * Assign… (DEC-071) is a menu button: the team's members, the person
 * looking first as "You", then Nobody; the one the case has is checked.
 */

import type { UserRef } from "../lib/case.ts";
import { h } from "./dom.ts";
import { type IconName, icon } from "./icons.ts";
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
	/** What a pick in the Assign menu does, as of the latest render. */
	pick: (to: UserRef | null) => void;
}

/** The Assign menu's choices (DEC-071). */
export interface AssignChoices {
	/** The team's members, as the server listed them. */
	members: UserRef[];
	/** Who has the case now (as shown here); null: nobody. */
	current: UserRef | null;
	/** Who is looking. */
	me: string;
	pick: (to: UserRef | null) => void;
}

/**
 * Each action's words, tooltip and icon (DEC-078: the same as its other
 * place). Copy link is its icon alone, its words in its name and tooltip:
 * with the icons, three or four buttons in a row took a line more, and it
 * is the least of them (it never stands alone).
 */
const LABEL: Record<
	StepAction,
	{ label: string; title: string; icon: IconName; iconOnly?: true }
> = {
	"add-marks": {
		icon: "add",
		label: "Add marks",
		title:
			"Each mark you draw on the page goes into this case when its comment is done",
	},
	share: {
		icon: "share",
		label: "Share with team",
		title:
			"Send this case to your team: its members see it, with its screenshots, and what anyone changes syncs",
	},
	export: {
		icon: "export",
		label: "Export…",
		title:
			"Save this case as one .zip file: its marks, comments, summary, thread and screenshots, and case.md to read them without Sitegloss. Someone imports it with Import a case…",
	},
	"copy-link": {
		icon: "link",
		iconOnly: true,
		label: "Copy link",
		title:
			"Copy the case's address in the web app: it opens the case for the members of the team",
	},
	"copy-ai": {
		icon: "copy",
		label: "Copy for your AI app",
		title:
			"Instructions for your AI app to work on this case: its address, how to reach it, and what to do with each mark",
	},
	verify: {
		icon: "check",
		label: "Start verifying",
		title:
			"Show only the marks to verify, and go to the first one: open its page with the fix and check it",
	},
	close: {
		icon: "close",
		label: "Close case",
		title:
			"Close the case: it is filed away under Closed, and stays readable and changeable. A new open mark opens it again.",
	},
	assign: {
		icon: "assign",
		label: "Assign",
		title:
			"Choose who fixes the open marks: a member of the team. They see it under My cases; when every open mark is fixed, it comes back to whoever started the case to verify",
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
		},
		text,
		row,
		note,
	);
	return {
		el,
		text,
		row,
		note,
		key: "",
		act: () => undefined,
		pick: () => undefined,
	};
}

/** Out of sight but rendered: a live region a reader keeps listening to. */
const away = (el: HTMLElement, out: boolean) =>
	el.classList.toggle("visually-hidden", out);

/**
 * Draw `step` (none: the block is out of sight). `act` carries out an action, as
 * the panel's other place for it does; `off` names the actions that cannot
 * be taken now, with why, as their other place says it.
 */
export function renderNextStep(
	p: StepParts,
	step: NextStep | undefined,
	note: string | undefined,
	act: (action: StepAction) => void,
	off: Partial<Record<StepAction, string>> = {},
	assign?: AssignChoices,
): void {
	p.act = act;
	if (assign !== undefined) p.pick = assign.pick;
	away(p.el, step === undefined);
	// A region with a name only while it says something: an empty one is no
	// landmark for a reader to land on.
	if (step === undefined) {
		p.el.removeAttribute("aria-label");
		p.el.removeAttribute("tabindex");
	} else {
		p.el.setAttribute("aria-label", "Next step");
		// Where the focus goes when a click leaves the block no button.
		p.el.setAttribute("tabindex", "-1");
	}
	const text = step?.text ?? "";
	// The same words are not written again: a live region would say them again.
	if (p.text.textContent !== text) p.text.textContent = text;
	const shown = step === undefined ? undefined : note;
	if (p.note.textContent !== (shown ?? "")) p.note.textContent = shown ?? "";
	away(p.note, shown === undefined);
	const actions = step?.actions ?? [];
	const key = JSON.stringify([
		actions.map((a) => [a, off[a] ?? null]),
		actions.includes("assign") && assign !== undefined
			? [assign.members, assign.current?.id ?? null, assign.me]
			: null,
	]);
	if (key === p.key) return;
	p.key = key;
	// The button that has the focus, by its action: a click that changed the
	// step keeps the focus on it, or in the block.
	const active = document.activeElement as HTMLElement | null;
	const had = active !== null && p.row.contains(active);
	const pressed = had ? active.dataset["step"] : undefined;
	p.row.replaceChildren(
		...actions.map((action) => {
			const why = off[action];
			if (action === "assign" && assign !== undefined)
				return assignMenu(p, assign, why);
			const { label, title, iconOnly } = LABEL[action];
			return h(
				"button",
				{
					type: "button",
					class: iconOnly ? "small icon-only" : "small",
					"data-step": action,
					...(iconOnly ? { "aria-label": label } : {}),
					title: iconOnly ? `${label}: ${why ?? title}` : (why ?? title),
					disabled: why !== undefined,
					onclick: () => p.act(action),
				},
				icon(LABEL[action].icon),
				iconOnly ? null : label,
			);
		}),
	);
	p.row.hidden = actions.length === 0;
	// (The menu's button holds the action's name too: the focus finds it.)
	if (had)
		(
			p.row.querySelector<HTMLElement>(
				`button[data-step="${pressed}"]:not(:disabled)`,
			) ??
			p.row.querySelector<HTMLElement>("button:not(:disabled)") ??
			p.el
		).focus();
}

/**
 * Assign… and its menu (DEC-071): a menu button, as the case's "…" is, with
 * the members as radio items. A pick goes to `p.pick`; Escape or a click
 * elsewhere closes it, the arrows move in it.
 */
function assignMenu(
	p: StepParts,
	choices: AssignChoices,
	off: string | undefined,
): HTMLElement {
	listenOutside();
	const close = (back: boolean) => {
		menu.hidden = true;
		button.setAttribute("aria-expanded", "false");
		if (openMenu?.wrap === wrap) openMenu = undefined;
		if (back) button.focus();
	};
	const you = choices.members.find((m) => m.id === choices.me);
	const others = choices.members
		.filter((m) => m.id !== choices.me)
		.sort((a, b) => a.name.localeCompare(b.name));
	const item = (to: UserRef | null, label: string) => {
		const checked = (choices.current?.id ?? null) === (to?.id ?? null);
		return h(
			"button",
			{
				type: "button",
				role: "menuitemradio",
				"aria-checked": String(checked),
				"data-assign": to?.id ?? "",
				onclick: () => {
					close(true);
					p.pick(to);
				},
			},
			h("span", { class: "check", "aria-hidden": "true" }, checked ? "✓" : ""),
			label,
		);
	};
	const menu: HTMLElement = h(
		"div",
		{
			class: "case-menu assign-menu",
			id: "assign-menu",
			role: "menu",
			"aria-label": "Assign the case to",
			hidden: true,
			onkeydown: (e: Event) => {
				const k = e as KeyboardEvent;
				const items = [...menu.querySelectorAll<HTMLElement>("button")];
				const at = items.indexOf(document.activeElement as HTMLElement);
				if (k.key === "Escape") {
					k.preventDefault();
					close(true);
				} else if (k.key === "ArrowDown" || k.key === "ArrowUp") {
					k.preventDefault();
					const step = k.key === "ArrowDown" ? 1 : -1;
					items[(at + step + items.length) % items.length]?.focus();
				} else if (k.key === "Tab") close(false);
			},
		},
		...(you === undefined ? [] : [item(you, "You")]),
		...others.map((m) => item(m, m.name)),
		item(null, "Nobody"),
	);
	// The sentence beside it names who has the case: the button need not.
	const label = choices.current === null ? LABEL.assign.label : "Reassign";
	const button: HTMLButtonElement = h(
		"button",
		{
			type: "button",
			class: "small menu-button",
			"data-step": "assign",
			"aria-haspopup": "menu",
			"aria-expanded": "false",
			"aria-controls": "assign-menu",
			title: off ?? LABEL.assign.title,
			disabled: off !== undefined,
			onclick: () => {
				if (!menu.hidden) return close(true);
				menu.hidden = false;
				button.setAttribute("aria-expanded", "true");
				openMenu = { wrap, close };
				(
					menu.querySelector<HTMLElement>('[aria-checked="true"]') ??
					menu.querySelector<HTMLElement>("button")
				)?.focus();
			},
			onkeydown: (e: Event) => {
				// Escape on the button too, while the menu is open.
				if ((e as KeyboardEvent).key === "Escape" && !menu.hidden) {
					e.preventDefault();
					close(true);
				}
			},
		},
		icon(LABEL.assign.icon),
		label,
		h("span", { class: "chevron", "aria-hidden": "true" }),
	);
	const wrap: HTMLElement = h("span", { class: "assign" }, button, menu);
	// Tab or Shift+Tab out of it closes it; a press elsewhere is `listenOutside`'s.
	wrap.addEventListener("focusout", (e) => {
		const to = (e as FocusEvent).relatedTarget as Node | null;
		if (to !== null && !wrap.contains(to)) close(false);
	});
	return wrap;
}

/** The Assign menu that is open, and how to close it. */
let openMenu: { wrap: HTMLElement; close: (back: boolean) => void } | undefined;
let listening = false;

/**
 * A press anywhere outside the open Assign menu closes it, as the case's
 * "…" menu does: on text, the facts or another button alike (a click there
 * moves no focus out of it in every browser). The focus stays where the
 * press put it.
 */
function listenOutside(): void {
	if (listening) return;
	listening = true;
	document.addEventListener(
		"pointerdown",
		(e) => {
			const menu = openMenu;
			if (menu === undefined) return;
			if (!menu.wrap.isConnected) {
				openMenu = undefined;
				return;
			}
			if (!menu.wrap.contains(e.target as Node)) menu.close(false);
		},
		true,
	);
}
