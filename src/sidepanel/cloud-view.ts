/**
 * Drawing the account and the sync with a team (DEC-039): the Account
 * section on Home, and the banner above every view while the sync needs an
 * answer (cases that were here before the team, a sign-in that ran out).
 * Both are drawn again only when what they show changed, so a click and a
 * half-typed address survive every other render.
 */

import {
	DEV_SERVER_OFFERED,
	DEVELOPMENT_SERVER,
	PRODUCTION_SERVER,
	serverKind,
	serverLabel,
	serverNote,
} from "../lib/cloud/servers.ts";
import { byId, formatDate, h } from "./dom.ts";
import { type IconName, icon } from "./icons.ts";
import type { PanelState } from "./state.ts";

/** What the user can do about the account; `cloud.ts` carries it out. */
export interface CloudActions {
	/** "Sign in": the browser's sign-in window; call it in the click. */
	cloudSignIn(): void;
	cloudSignOut(): void;
	cloudTeam(teamId: string): void;
	/** "Sync now": also tries again what the server refused. */
	cloudSyncNow(): void;
	/** The cases that were here before the team: share them, or keep them here. */
	cloudDecide(share: boolean): void;
	/** "Share with team" on a case kept on this device. */
	cloudShare(caseId: string): void;
	/** The server's address, as typed; empty: sitegloss.dev's. */
	cloudServer(text: string): void;
}

type Cloud = PanelState["cloud"];

let now: CloudActions | undefined;
const act = (pick: (a: CloudActions) => void) => () => {
	if (now !== undefined) pick(now);
};

/** A server's address as the panel names it: its host. */
export function hostOf(server: string): string {
	try {
		return new URL(server).host;
	} catch {
		return server;
	}
}

/** The team the cases sync with, when one is chosen. */
export function teamOf(cloud: Cloud) {
	const account = cloud.account;
	return account?.teamId === undefined
		? undefined
		: account.teams.find((t) => t.id === account.teamId);
}

/** What signing in sends where: said before the click, in one sentence. */
export const SIGN_IN_NOTE = (server: string) =>
	`Signed in, your cases go to ${hostOf(server)} and to the members of your team: their marks, comments and screenshots, and the address of every page you marked (its query without what looks like a secret or an e-mail address). Without an account everything stays in this browser, as now.`;

/**
 * How a case goes from whoever finds what is wrong to whoever fixes it and
 * back (DEC-071), where the panel explains itself: the empty list and the
 * Team section before signing in.
 */
export const HAND_OVER_NOTE =
	"With a team, a case is handed over. Assign it to whoever fixes its open marks: it is under My cases for them, and the case says what is theirs to do. When every open mark is fixed, it is back under My cases for whoever started it, to check the fixes, verify them and close the case.";

export const SIGN_IN_TITLE =
	"Sign in at the server in a window of the browser; Sitegloss then syncs your cases with your team, both ways";
const SIGN_OUT_TITLE =
	"Stop syncing in this browser: the cases stay here, on this device only, and the team keeps its copies";
const SYNC_NOW_TITLE =
	"Send what changed here and fetch what the team changed, now; also tries again what the server refused";
const SYNC_THEM_TITLE =
	"Send these cases to the team: its members see them, with their screenshots, and what anyone changes syncs";
const KEEP_THEM_TITLE =
	"Leave these cases in this browser only; “Share with team” in a case shares it later";

const cases = (n: number) => `${n} case${n === 1 ? "" : "s"}`;

/**
 * How a case syncs, for its view and its row: not at all (nobody signed in,
 * or no team), with the team, or on this device only; and what the user may
 * do about it in the team.
 */
export function caseSync(
	cloud: Cloud,
	caseId: string,
): {
	kind: "off" | "synced" | "local";
	team?: string;
	mayShare: boolean;
	mayDelete: boolean;
} {
	const team = teamOf(cloud);
	if (team === undefined || cloud.account?.expired)
		return { kind: "off", mayShare: false, mayDelete: true };
	const mode = cloud.modes[caseId];
	// A case the sync has not seen yet was made since: it is the team's.
	const synced = mode === undefined || mode === "synced";
	return {
		kind: synced ? "synced" : "local",
		team: team.name,
		mayShare: !synced && team.permissions.includes("case:create"),
		// A case on this device only is the user's to delete, whatever the team allows.
		mayDelete: !synced || team.permissions.includes("case:delete"),
	};
}

/** A time before `now`, as people say it: "just now", "5 minutes ago". */
export function ago(iso: string, now: number = Date.now()): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const minutes = Math.floor((now - at) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	return `on ${formatDate(iso)}`;
}

const waits = (n: number) =>
	`${cases(n)} ${n === 1 ? "waits" : "wait"} to be sent.`;

/**
 * The line that says what the sync is at (DEC-045): the state, not a time.
 * From the worker's last run (its state, what waits to be sent) and this
 * panel's stream (open: what the team changes arrives at once).
 */
export function statusLine(cloud: Cloud, now: number = Date.now()): string {
	const status = cloud.status;
	if (cloud.account?.expired)
		return "Signed out by the server: sign in again to go on syncing. Nothing is lost meanwhile.";
	if (teamOf(cloud) === undefined)
		return cloud.account !== undefined && cloud.account.teams.length === 0
			? `You are in no team yet. Create or join one on ${hostOf(cloud.account.server)}, then click Sync now.`
			: (status?.text ?? "Choose a team to sync with.");
	const waiting = status?.waiting ?? 0;
	switch (status?.state) {
		case "syncing":
			return status.left ? `Syncing ${cases(status.left)}…` : "Syncing…";
		case "offline":
			return `Offline: changes are kept and sync when the server can be reached.${waiting > 0 ? ` ${waits(waiting)}` : ""}`;
		case "problem":
			return status.text ?? "Some changes were not taken by the server:";
		case "signed-out":
			return status.text ?? "Sign in again to go on syncing.";
		case "synced": {
			if (waiting > 0) return waits(waiting);
			if (cloud.live === true) return "Up to date. Changes sync as you work.";
			const when =
				status.lastSyncedAt === undefined ? "" : ago(status.lastSyncedAt, now);
			const synced = when === "" ? "Synced." : `Last synced ${when}.`;
			// Closed for a while: what the team changes comes with the next look.
			return cloud.live === false
				? `${synced} The team's changes are not coming in live right now: they come at the next sync, or with Sync now.`
				: synced;
		}
		default:
			return "Starting…";
	}
}

/**
 * Whether "Sync now" can do something: not while everything is sent, the
 * stream is open and nothing was refused.
 */
export function syncNowHelps(cloud: Cloud): boolean {
	const status = cloud.status;
	if (teamOf(cloud) === undefined) return true;
	if (status === undefined) return true;
	if (status.state === "syncing") return false;
	return !(
		status.state === "synced" &&
		cloud.live === true &&
		(status.waiting ?? 0) === 0 &&
		status.problems.length === 0
	);
}

function button(
	action: string,
	label: string,
	title: string,
	onclick: () => void,
	options: { strong?: boolean; disabled?: boolean; icon?: IconName } = {},
): HTMLButtonElement {
	return h(
		"button",
		{
			type: "button",
			"data-action": action,
			title,
			onclick,
			...(options.strong ? { class: "strong" } : {}),
			...(options.disabled ? { disabled: true } : {}),
		},
		options.icon === undefined ? null : icon(options.icon),
		label,
	);
}

/**
 * Which server to sign in to (DEC-041): the service, its development
 * server, or another address typed here (as the relay's: saved when the
 * field is left). Folded away: whoever never opens it signs in to the
 * service and is never asked. Only while nobody is signed in.
 */
export function serverChooser(
	cloud: Cloud,
	offerDevelopment: boolean = DEV_SERVER_OFFERED,
): HTMLElement {
	const kind = serverKind(cloud.server);
	const input: HTMLInputElement = h("input", {
		type: "url",
		id: "cloud-server",
		// Not while a sign-in is under way: it ends at the server it began at.
		disabled: cloud.signingIn,
		spellcheck: "false",
		autocomplete: "off",
		placeholder: "https://…",
		"aria-label": "The other server's address",
		onchange: act((a) => {
			// An empty field chooses nothing: the server stays the one it was.
			if (input.value.trim() !== "") a.cloudServer(input.value);
		}),
	});
	input.value = kind === "other" ? cloud.server : "";
	const other = h(
		"label",
		{ class: "field", id: "cloud-server-other", hidden: kind !== "other" },
		"Its address: https, or http on this computer only.",
		input,
	);
	const option = (value: string, label: string) =>
		h(
			"option",
			{ value, ...(value === kind ? { selected: true } : {}) },
			label,
		);
	const select: HTMLSelectElement = h(
		"select",
		{
			id: "cloud-server-choice",
			disabled: cloud.signingIn,
			onchange: act((a) => {
				other.hidden = select.value !== "other";
				// Empty: the service's own address.
				if (select.value === "production") a.cloudServer("");
				else if (select.value === "development")
					a.cloudServer(DEVELOPMENT_SERVER);
				else input.focus();
			}),
		},
		option("production", serverLabel(PRODUCTION_SERVER)),
		// Not in a build that goes to people; whoever is set to it still sees
		// it, so the choice shows what it is.
		...(offerDevelopment || kind === "development"
			? [option("development", serverLabel(DEVELOPMENT_SERVER))]
			: []),
		option("other", "Another address…"),
	);
	select.value = kind;
	const details = h(
		"details",
		{ class: "cloud-server", ...(kind === "production" ? {} : { open: true }) },
		h("summary", {}, "Server"),
		h(
			"label",
			{ class: "field" },
			"The server to sign in to. Each server has its own account, team and cases: what synced with one is not sent to another.",
			select,
		),
		other,
	);
	return details;
}

/**
 * A server that is not the service, in words beside the account, so nobody
 * takes test data for real.
 */
function serverLine(server: string): HTMLElement[] {
	const note = serverNote(server);
	return note === undefined
		? []
		: [h("p", { class: "cloud-server-note", id: "cloud-server-name" }, note)];
}

function signedOut(cloud: Cloud): HTMLElement[] {
	return [
		h("p", { class: "sync-state" }, "Sign in to sync with your team."),
		...serverLine(cloud.server),
		h("p", { class: "meta" }, SIGN_IN_NOTE(cloud.server)),
		h("p", { class: "meta", id: "cloud-hand-over" }, HAND_OVER_NOTE),
		h(
			"div",
			{ class: "row" },
			button(
				"cloud-sign-in",
				cloud.signingIn ? "Signing in…" : "Sign in",
				SIGN_IN_TITLE,
				act((a) => a.cloudSignIn()),
				{ strong: true, disabled: cloud.signingIn, icon: "sign-in" },
			),
		),
		serverChooser(cloud),
	];
}

function signedIn(cloud: Cloud): HTMLElement[] {
	const account = cloud.account as NonNullable<Cloud["account"]>;
	const team = teamOf(cloud);
	const status = cloud.status;
	const parts: HTMLElement[] = [
		h(
			"p",
			{ class: "sync-state", id: "cloud-who" },
			"Signed in as ",
			h("strong", {}, account.name),
			` (${account.email})`,
		),
		...serverLine(account.server),
	];
	if (account.teams.length > 1 || (account.teams.length === 1 && !team)) {
		const select: HTMLSelectElement = h(
			"select",
			{
				id: "cloud-team",
				onchange: act((a) => {
					if (select.value !== "") a.cloudTeam(select.value);
				}),
			},
			team === undefined ? h("option", { value: "" }, "Choose a team…") : null,
			...account.teams.map((t) =>
				h(
					"option",
					{
						value: t.id,
						...(t.id === account.teamId ? { selected: true } : {}),
					},
					t.name,
				),
			),
		);
		parts.push(h("label", { class: "field" }, "Team", select));
	} else if (team !== undefined)
		parts.push(
			h(
				"p",
				{ class: "sync-state", id: "cloud-team-name" },
				"Team: ",
				h("strong", {}, team.name),
			),
		);
	const state = account.expired ? "signed-out" : (status?.state ?? "off");
	parts.push(
		h(
			"p",
			{ class: "meta sync-line", id: "cloud-status", "data-state": state },
			statusLine(cloud),
		),
	);
	const problems = status?.problems ?? [];
	if (problems.length > 0)
		parts.push(
			h(
				"ul",
				{ class: "cloud-problems", id: "cloud-problems" },
				...problems.map((p) =>
					h(
						"li",
						{ class: "hint", role: "alert" },
						p.title ? `“${p.title}”: ${p.text}` : p.text,
					),
				),
			),
		);
	// What there is to tell that needs nothing done: said, not as a warning.
	const notes = status?.notes ?? [];
	if (notes.length > 0)
		parts.push(
			h(
				"ul",
				{ class: "cloud-problems cloud-notes", id: "cloud-notes" },
				...notes.map((n) =>
					h(
						"li",
						{ class: "meta" },
						n.title ? `“${n.title}”: ${n.text}` : n.text,
					),
				),
			),
		);
	parts.push(
		h(
			"div",
			{ class: "row" },
			...(account.expired
				? [
						button(
							"cloud-sign-in",
							cloud.signingIn ? "Signing in…" : "Sign in again",
							SIGN_IN_TITLE,
							act((a) => a.cloudSignIn()),
							{ strong: true, disabled: cloud.signingIn, icon: "sign-in" },
						),
					]
				: syncNowHelps(cloud)
					? [
							button(
								"cloud-sync-now",
								"Sync now",
								SYNC_NOW_TITLE,
								act((a) => a.cloudSyncNow()),
								{ icon: "sync" },
							),
						]
					: []),
			button(
				"cloud-sign-out",
				"Sign out",
				SIGN_OUT_TITLE,
				act((a) => a.cloudSignOut()),
				{ icon: "sign-out" },
			),
		),
	);
	return parts;
}

/** The Account section on Home. */
export function renderCloudSection(
	state: PanelState,
	actions: CloudActions,
): void {
	now = actions;
	const box = byId<HTMLDivElement>("cloud");
	const { cloud } = state;
	const key = JSON.stringify([
		cloud.server,
		cloud.account,
		cloud.status,
		cloud.signingIn,
		cloud.problem,
		cloud.live,
	]);
	// The time alone ("5 minutes ago", said anew each minute) changes the
	// line's words in place: nothing is drawn anew, the focus stays where it
	// is, and the live region does not say the whole section again.
	if (box.dataset["key"] === key) {
		const line = document.getElementById("cloud-status");
		const words = statusLine(cloud);
		if (line !== null && line.textContent !== words) line.textContent = words;
		return;
	}
	// An address half typed stays: the field is not drawn anew under the caret.
	const typing = document.activeElement?.id === "cloud-server";
	if (typing && box.dataset["key"] !== undefined) return;
	box.dataset["key"] = key;
	box.dataset["cloud"] =
		cloud.account === undefined
			? "off"
			: cloud.account.expired
				? "signed-out"
				: (cloud.status?.state ?? "off");
	// The chooser is drawn anew when a server was chosen in it: the keyboard
	// stays where it was.
	const choosing = document.activeElement?.id === "cloud-server-choice";
	box.replaceChildren(
		...(cloud.account === undefined ? signedOut(cloud) : signedIn(cloud)),
		...(cloud.problem === undefined
			? []
			: [
					h(
						"p",
						{ class: "hint", id: "cloud-problem", role: "alert" },
						cloud.problem,
					),
				]),
	);
	if (choosing) document.getElementById("cloud-server-choice")?.focus();
}

/** What the banner asks or says; none: no banner. */
export function bannerOf(
	cloud: Cloud,
): { kind: "undecided" | "expired"; strong: string; text: string } | undefined {
	const team = teamOf(cloud);
	if (cloud.account?.expired)
		return {
			kind: "expired",
			strong: "Team sync is signed out.",
			text: "Sign in again to go on syncing; what you change meanwhile is kept and sent then.",
		};
	const n = cloud.status?.undecided ?? 0;
	// A team's name is the server's word, and this is where a click sends
	// cases: on a server that is not the service, the server is named too.
	const server = cloud.account?.server ?? cloud.server;
	const where =
		serverKind(server) === "production" ? "" : ` on ${hostOf(server)}`;
	// Cases the team already has under the same id are joined with the
	// team's: said before the click, with what it replaces here (DEC-039).
	const joins = cloud.status?.joins;
	const joined =
		joins === undefined || joins.cases === 0
			? ""
			: ` The team already has ${n === 1 ? "this case" : `${joins.cases} of them`}${joins.marks === 0 ? "." : `; where both differ the team's text is kept: ${joins.marks === 1 ? "1 mark" : `${joins.marks} marks`}.`}`;
	if (team !== undefined && n > 0)
		return {
			kind: "undecided",
			strong:
				n === 1
					? "1 case is on this device only."
					: `${n} cases are on this device only.`,
			text: `Sync ${n === 1 ? "it" : "them"} with “${team.name}”${where}? Its members will see ${n === 1 ? "it" : "them"}, with ${n === 1 ? "its" : "their"} marks, screenshots and the addresses of the pages marked.${joined}`,
		};
	return undefined;
}

/** The banner above every view: a question of the sync, until it is answered. */
export function renderCloudBanner(
	state: PanelState,
	actions: CloudActions,
): void {
	now = actions;
	const banner = byId<HTMLDivElement>("cloud-banner");
	const { cloud } = state;
	const said = bannerOf(cloud);
	const team = teamOf(cloud);
	const key = JSON.stringify([said, cloud.signingIn, team?.permissions]);
	if (banner.dataset["key"] === key) return;
	banner.dataset["key"] = key;
	if (said === undefined) {
		banner.hidden = true;
		delete banner.dataset["cloud"];
		banner.replaceChildren();
		return;
	}
	const mayShare = team?.permissions.includes("case:create") === true;
	banner.hidden = false;
	banner.dataset["cloud"] = said.kind;
	banner.replaceChildren(
		h(
			"p",
			{ class: "sync-banner-text" },
			h("strong", {}, said.strong),
			" ",
			said.kind === "undecided" && !mayShare
				? "Your role in the team does not allow sharing cases with it."
				: said.text,
		),
		h(
			"div",
			{ class: "row" },
			...(said.kind === "expired"
				? [
						button(
							"cloud-sign-in",
							cloud.signingIn ? "Signing in…" : "Sign in again",
							SIGN_IN_TITLE,
							act((a) => a.cloudSignIn()),
							{ strong: true, disabled: cloud.signingIn, icon: "sign-in" },
						),
					]
				: [
						...(mayShare
							? [
									button(
										"cloud-sync-them",
										(cloud.status?.undecided ?? 0) === 1
											? "Sync it"
											: "Sync them",
										SYNC_THEM_TITLE,
										act((a) => a.cloudDecide(true)),
										{ strong: true },
									),
								]
							: []),
						button(
							"cloud-keep-them",
							(cloud.status?.undecided ?? 0) === 1
								? "Keep it on this device"
								: "Keep them on this device",
							KEEP_THEM_TITLE,
							act((a) => a.cloudDecide(false)),
						),
					]),
		),
	);
}
