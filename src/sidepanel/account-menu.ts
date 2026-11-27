/**
 * The account in the top bar, on every view: a person button at the right
 * end, as the web app has it, and under it who is signed in, the team the
 * cases sync with, what the sync is at, and signing in and out. It is the
 * account's short form: the Team section on Home keeps the whole of it (the
 * server to sign in to, what the server refused). The actions are that
 * section's own (`CloudActions`).
 *
 * Drawn again only when what it shows changed, so an open menu and the
 * keyboard's place in it survive every other render.
 */

import { serverNote } from "../lib/cloud/servers.ts";
import {
	type CloudActions,
	hostOf,
	SIGN_IN_NOTE,
	SIGN_IN_TITLE,
	SIGN_OUT_TITLE,
	SYNC_NOW_TITLE,
	statusLine,
	syncNowHelps,
	teamOf,
} from "./cloud-view.ts";
import { byId, h } from "./dom.ts";
import { type IconName, icon } from "./icons.ts";
import { teamGuide } from "./server-mcp.ts";
import type { PanelState } from "./state.ts";

type Cloud = PanelState["cloud"];

let now: CloudActions | undefined;
let wired = false;

/** The account's page in the web app, as the web app's own menu links it. */
export function accountAddress(server: string, slug?: string): string {
	const address = new URL("/account", server);
	if (slug !== undefined) address.searchParams.set("from", slug);
	return address.href;
}

/**
 * What the button says of the account without opening it: its name for a
 * reader and its tooltip, and the dot on it (`ok`: signed in and syncing;
 * `warn`: something waits for the person; none: nobody signed in).
 */
export function accountSummary(cloud: Cloud): {
	label: string;
	state: "none" | "ok" | "warn";
} {
	const account = cloud.account;
	if (account === undefined)
		return { label: "Account: not signed in", state: "none" };
	if (account.expired)
		return {
			label: `Account: ${account.name}, the sign-in ran out`,
			state: "warn",
		};
	const team = teamOf(cloud);
	if (team === undefined)
		return {
			label: `Account: ${account.name}, no team chosen`,
			state: "warn",
		};
	const state = cloud.status?.state;
	return {
		label: `Account: ${account.name}, team “${team.name}”`,
		state: state === "problem" || state === "offline" ? "warn" : "ok",
	};
}

function close(back = false): void {
	const button = byId<HTMLButtonElement>("account");
	const pop = byId<HTMLElement>("account-pop");
	if (pop.hidden) return;
	pop.hidden = true;
	button.setAttribute("aria-expanded", "false");
	if (back) button.focus();
}

const items = (pop: HTMLElement) => [
	...pop.querySelectorAll<HTMLElement>(
		'[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)',
	),
];

/** The button, the keys and the press outside, once. */
function wire(): void {
	if (wired) return;
	wired = true;
	const button = byId<HTMLButtonElement>("account");
	const pop = byId<HTMLElement>("account-pop");
	button.replaceChildren(
		icon("account"),
		h("span", { class: "dot", "aria-hidden": "true" }),
	);
	button.addEventListener("click", () => {
		const open = pop.hidden;
		pop.hidden = !open;
		button.setAttribute("aria-expanded", String(open));
		if (open) items(pop)[0]?.focus();
	});
	pop.addEventListener("keydown", (e) => {
		const k = e as KeyboardEvent;
		const all = items(pop);
		const at = all.indexOf(document.activeElement as HTMLElement);
		if (k.key === "Escape") {
			k.preventDefault();
			close(true);
		} else if (k.key === "ArrowDown" || k.key === "ArrowUp") {
			k.preventDefault();
			const step = k.key === "ArrowDown" ? 1 : -1;
			all[(at + step + all.length) % all.length]?.focus();
		} else if (k.key === "Home" || k.key === "End") {
			k.preventDefault();
			all[k.key === "Home" ? 0 : all.length - 1]?.focus();
		} else if (k.key === "Tab") close();
	});
	// Escape on the button itself, with the menu open under it.
	button.addEventListener("keydown", (e) => {
		if ((e as KeyboardEvent).key === "Escape" && !pop.hidden) {
			e.preventDefault();
			close(true);
		}
	});
	// The menu closes on a press outside it.
	document.addEventListener(
		"pointerdown",
		(e) => {
			if (pop.hidden) return;
			const t = e.target as Node;
			if (pop.contains(t) || button.contains(t)) return;
			close();
		},
		true,
	);
}

/** One of the menu's actions: it runs, and the menu closes behind it. */
function item(
	id: string,
	label: string,
	title: string,
	glyph: IconName,
	pick: (a: CloudActions) => void,
	options: { disabled?: boolean } = {},
): HTMLButtonElement {
	return h(
		"button",
		{
			type: "button",
			role: "menuitem",
			id,
			title,
			"data-focus": id,
			...(options.disabled ? { disabled: true } : {}),
			onclick: () => {
				// Signing in opens the browser's window: asked in the click.
				if (now !== undefined) pick(now);
				close(true);
			},
		},
		icon(glyph),
		label,
	);
}

function serverLine(server: string): HTMLElement[] {
	const note = serverNote(server);
	return note === undefined
		? []
		: [h("p", { class: "cloud-server-note", id: "account-server" }, note)];
}

function signedOut(cloud: Cloud): HTMLElement[] {
	return [
		h(
			"div",
			{ class: "account-who", id: "account-who" },
			h("strong", {}, "Not signed in"),
			...serverLine(cloud.server),
			// What signing in sends where, before the click (cloud-view.ts).
			h("p", { class: "meta" }, SIGN_IN_NOTE(cloud.server)),
		),
		h(
			"div",
			{
				role: "menu",
				"aria-label": "Account",
				"aria-describedby": "account-who",
			},
			item(
				"account-sign-in",
				cloud.signingIn ? "Signing in…" : "Sign in",
				SIGN_IN_TITLE,
				"sign-in",
				(a) => a.cloudSignIn(),
				{ disabled: cloud.signingIn },
			),
		),
	];
}

/** The way to the server's MCP for an AI app; none without a team's slug. */
function guideItem(cloud: Cloud): HTMLElement[] {
	const guide = teamGuide(cloud);
	if (guide === undefined) return [];
	return [
		h(
			"a",
			{
				role: "menuitem",
				id: "account-ai",
				"data-focus": "account-ai",
				href: guide.href,
				target: "_blank",
				rel: "noopener noreferrer",
				title: `How to connect an AI app to the MCP server at ${guide.host}, in a new tab`,
				onclick: () => close(),
			},
			icon("link"),
			"Connect an AI app",
		),
	];
}

function signedIn(cloud: Cloud): HTMLElement[] {
	const account = cloud.account as NonNullable<Cloud["account"]>;
	const team = teamOf(cloud);
	const state = account.expired ? "signed-out" : (cloud.status?.state ?? "off");
	// One team, and it is chosen: said, not offered. Else the teams to choose from.
	const choose = account.teams.length > 1 || team === undefined;
	const teams =
		choose && account.teams.length > 0
			? [
					h(
						"div",
						{ role: "group", "aria-labelledby": "account-teams-label" },
						h(
							"p",
							{ class: "menu-label", id: "account-teams-label" },
							team === undefined ? "Choose a team" : "Team",
						),
						...account.teams.map((t) => {
							const on = t.id === account.teamId;
							return h(
								"button",
								{
									type: "button",
									role: "menuitemradio",
									"aria-checked": String(on),
									"data-team": t.id,
									"data-focus": `team:${t.id}`,
									title: on
										? `Your cases sync with “${t.name}”`
										: `Sync your cases with “${t.name}” instead: its cases come here, and new ones go to it`,
									onclick: () => {
										if (!on) now?.cloudTeam(t.id);
										close(true);
									},
								},
								h(
									"span",
									{ class: "check", "aria-hidden": "true" },
									on ? icon("check") : null,
								),
								h("bdi", {}, t.name),
							);
						}),
					),
					h("hr", { role: "separator" }),
				]
			: [];
	return [
		h(
			"div",
			{ class: "account-who", id: "account-who" },
			h("strong", { id: "account-name" }, account.name),
			h("span", { class: "meta", id: "account-email" }, account.email),
			...serverLine(account.server),
			!choose && team !== undefined
				? h(
						"p",
						{ class: "account-team", id: "account-team" },
						"Team: ",
						h("strong", {}, team.name),
					)
				: null,
			h(
				"p",
				{
					class: "meta sync-line",
					id: "account-status",
					"data-state": state,
				},
				statusLine(cloud),
			),
		),
		h(
			"div",
			{
				role: "menu",
				"aria-label": "Account",
				"aria-describedby": "account-who",
			},
			...teams,
			account.expired
				? item(
						"account-sign-in",
						cloud.signingIn ? "Signing in…" : "Sign in again",
						SIGN_IN_TITLE,
						"sign-in",
						(a) => a.cloudSignIn(),
						{ disabled: cloud.signingIn },
					)
				: syncNowHelps(cloud)
					? item("account-sync-now", "Sync now", SYNC_NOW_TITLE, "sync", (a) =>
							a.cloudSyncNow(),
						)
					: null,
			// The team's page on connecting an AI app to the server (server-mcp.ts).
			...guideItem(cloud),
			// The account's own page is the web app's: a link, as its menu has it.
			h(
				"a",
				{
					role: "menuitem",
					id: "account-open",
					"data-focus": "account-open",
					href: accountAddress(account.server, team?.slug),
					target: "_blank",
					rel: "noopener noreferrer",
					title: `Your account at ${hostOf(account.server)}, in a new tab: your name, your password, your teams`,
					onclick: () => close(),
				},
				icon("account"),
				`Account at ${hostOf(account.server)}`,
			),
			item("account-sign-out", "Sign out", SIGN_OUT_TITLE, "sign-out", (a) =>
				a.cloudSignOut(),
			),
		),
	];
}

/** The person button and its menu, from the account as it is now. */
export function renderAccount(state: PanelState, actions: CloudActions): void {
	now = actions;
	wire();
	const { cloud } = state;
	const button = byId<HTMLButtonElement>("account");
	const pop = byId<HTMLElement>("account-pop");
	const summary = accountSummary(cloud);
	if (button.getAttribute("aria-label") !== summary.label) {
		button.setAttribute("aria-label", summary.label);
		button.title = summary.label;
	}
	button.dataset["state"] = summary.state;
	const key = JSON.stringify([
		cloud.server,
		cloud.account,
		cloud.status?.state ?? null,
		cloud.signingIn,
		syncNowHelps(cloud),
	]);
	if (pop.dataset["key"] === key) {
		// The time alone ("5 minutes ago") changes the line's words in place.
		const line = document.getElementById("account-status");
		const words = statusLine(cloud);
		if (line !== null && line.textContent !== words) line.textContent = words;
		return;
	}
	pop.dataset["key"] = key;
	// Drawn anew under the keyboard: the focus stays on the same item, or on
	// the first where that one is gone.
	const focused = pop.contains(document.activeElement)
		? (document.activeElement as HTMLElement).dataset["focus"]
		: undefined;
	pop.replaceChildren(
		...(cloud.account === undefined ? signedOut(cloud) : signedIn(cloud)),
	);
	if (focused === undefined || pop.hidden) return;
	const same = items(pop).find((el) => el.dataset["focus"] === focused);
	(same ?? items(pop)[0])?.focus();
}
