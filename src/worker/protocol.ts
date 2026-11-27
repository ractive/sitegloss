/**
 * What the side panel and the service worker say to each other about the AI
 * connection, and who may say it (DEC-015). The connection lives in the
 * worker; the side panel is a view that sends commands over one named port
 * and gets the state back. Content scripts reach the same `chrome.runtime`
 * events, so the port's sender is checked: only the side panel's own page.
 * The settings are changed only this way too: the panel neither reads nor
 * writes them in storage (DEC-016).
 */

/** The name of the side panel's port (`chrome.runtime.connect`). */
export const PANEL_PORT = "ai";

/**
 * The MCP server's name, which Sitegloss registers with the relay: the side
 * panel's setup steps name the server by it in their commands.
 */
export const SERVER_NAME = "sitegloss";

/**
 * Sitegloss's app id: its MCP address is `<relay>/s/sitegloss/mcp`, the same
 * for every installation, the Firefox build's too (DEC-042, tab-mcp's
 * DEC-196); the pairing code alone says which installation an AI app is
 * paired with. Set, not left to the library to derive from `SERVER_NAME`,
 * so that a change of the server's name cannot change the address.
 */
export const APP_ID = "sitegloss";

/** The side panel's page in the build. */
export const PANEL_PATH = "/sidepanel/index.html";

/**
 * The answer to a question. "always": allow, and from now on this tool runs
 * without asking for this AI app, until it is disconnected (DEC-018).
 */
export type Answer = "allow" | "deny" | "always";

/** From the side panel. */
export type PanelCommand =
	/** The panel opened in window `windowId`. */
	| { type: "hello"; windowId: number }
	/**
	 * Whether the panel is on screen: another extension's panel for the tab
	 * (Claude in Chrome's) can cover it while it stays open.
	 */
	| { type: "visible"; visible: boolean }
	/** Connect (the AI access switch, Turn on AI access: the user's click). */
	| { type: "connect" }
	/** "Stop AI access": end the session, keep the pairing, Keep AI access off. */
	| { type: "stop" }
	| { type: "keep-on"; on: boolean }
	/** "Blur form fields in screenshots" (DEC-016: only the worker keeps it). */
	| { type: "blur-forms"; on: boolean }
	/** The card shows the address and code (`on`) or not: codes only while it does. */
	| { type: "pair"; on: boolean }
	| { type: "revoke"; grantId: string }
	/** "Allow all changes" for an AI app, on or off (DEC-018). */
	| { type: "allow-all"; grantId: string; on: boolean }
	/** A tool always allowed for an AI app asks again. */
	| { type: "ask-again"; grantId: string; tool: string }
	| { type: "new-address" }
	| { type: "set-relay"; relay: string }
	| { type: "answer"; id: string; answer: Answer }
	/** The answer to "Fill in the code for <app>?" (DEC-044): only a yes fills it in. */
	| { type: "fill"; id: string; yes: boolean }
	/** "Fill in the code for me" (on) or "Stop filling in the code" (DEC-044). */
	| { type: "fill-code"; on: boolean };

/** A connected AI app. */
export interface GrantView {
	grantId: string;
	/** Its self-declared name ("" if none). */
	name: string;
	/** The host of its client id: the verified part. */
	host: string;
	/** "Allow all changes": every tool that changes something runs without asking. */
	allowAll: boolean;
	/** The tools that run without asking (Always allow), with their titles. */
	always: { tool: string; title: string }[];
	/** Why its last Disconnect did not work, until it goes or the next try. */
	problem?: string;
}

/** A question nobody answers in this time ends as `"timeout"`: unanswered, the call does not run. */
export const QUESTION_TIMEOUT_MS = 60_000;

/** A question waiting for the user (a tool that changes something). */
export interface QuestionView {
	id: string;
	/** The AI app: its declared name beside its verified host. */
	app: string;
	/** The tool's name, and its title. */
	tool: string;
	title?: string;
	/** The case, mark and page it is about (`confirmLines`). */
	lines: string[];
	/** The arguments as JSON, invisible characters written as `\uXXXX`. */
	args: string;
	/** `Date.now()` when it ends unanswered: the call does not run then. */
	expiresAt: number;
}

/** An AI app's last tool call. */
export interface CallView {
	/** The tool's title. */
	tool: string;
	app: string;
	/** `Date.now()` when it came. */
	at: number;
}

/** Everything the panel shows of the connection. */
export interface AiState {
	relay: string;
	/** The saved relay could not be used, and the default is used instead. */
	relayNote?: string;
	keepOn: boolean;
	/** "Blur form fields in screenshots". */
	blurForms: boolean;
	/**
	 * The library's state: `reconnecting` while it connects again by itself
	 * after the connection broke (waiting for an attempt or making one).
	 */
	state: "disconnected" | "connecting" | "connected" | "reconnecting";
	/** "Keep AI access on" waits to try again. */
	retrying: boolean;
	/** Why the last connect failed, or the last command. */
	problem?: string;
	address?: string;
	grants: GrantView[];
	/** A panel's pairing view is open. */
	pairing: boolean;
	code?: string;
	/** `code` was typed in, and its AI app has not connected yet: not to be typed again. */
	codeUsed?: true;
	/**
	 * Why AI access went off by itself (DEC-072): information, not a problem.
	 * Gone once it is turned on again.
	 */
	wentOff?: "idle" | "expired" | "restart";
	/** Another tab or program took Sitegloss's connection over (it connects with Sitegloss's secret). */
	replaced?: { sibling: boolean };
	lastCall?: CallView;
	/** How many AI apps' tool calls are running now (DEC-063): the panel's chip shows it. */
	running?: number;
	questions: QuestionView[];
	/** "Fill in the code for me": on (DEC-044); off by default. */
	fillCode: boolean;
	/** The relay in use is one whose pairing page Sitegloss fills in (the hosted one). */
	fillHere: boolean;
	/**
	 * An AI app opened the hosted relay's pairing page in this browser:
	 * Sitegloss asks whether to fill in its code there (DEC-044). The name
	 * and host as the page's form gives them.
	 */
	fill?: FillView;
	/** Why the last fill-in did not happen, for a while after it (DEC-044). */
	fillProblem?: string;
}

/** The question whether to fill in the code for an AI app (DEC-044). */
export interface FillView {
	id: string;
	/** `data-client-name`: the name the AI app gave itself. */
	name: string;
	/** `data-client-host`: its verified host. */
	host: string;
}

/**
 * The AI app as the fill-in question names it: the verified host first, its
 * own name for itself apart (a name can be anything, "Claude (claude.ai)"
 * too).
 */
export function fillAppLabel(view: Pick<FillView, "name" | "host">): string {
	return view.name
		? `An AI app at ${view.host} (it calls itself “${view.name}”)`
		: `An AI app at ${view.host}`;
}

/** From the service worker. */
export type WorkerMessage =
	| { type: "state"; state: AiState }
	/** The connection could not start (its settings could not be read): why. */
	| { type: "failed"; problem: string };

/** The sender of a port, as far as the check needs it. */
export interface Sender {
	id?: string;
	url?: string;
	tab?: unknown;
}

/**
 * A port from the side panel: this extension's page at the panel's path, not
 * in a tab. A content script's port has `tab`, and its `url` is the page's;
 * the panel's page opened in a tab by its address is not the side panel
 * either, and gets nothing. `origin` is the extension's own,
 * `runtime.getURL("")`: `chrome-extension://<id>/` in Chrome, and in Firefox
 * `moz-extension://<UUID>/`, a UUID of each installation, not the id.
 * `inTab` lets the panel's page in a tab through: only Firefox's test
 * build, as automation cannot reach Firefox's sidebar.
 */
export function isPanelSender(
	sender: Sender,
	extensionId: string,
	options: { origin?: string; inTab?: boolean } = {},
): boolean {
	if (sender.id !== extensionId) return false;
	if (sender.tab !== undefined && options.inTab !== true) return false;
	try {
		const url = new URL(sender.url ?? "");
		const origin = new URL(
			options.origin ?? `chrome-extension://${extensionId}/`,
		);
		// Not `url.origin`: it is "null" for these schemes in some engines.
		return (
			url.protocol === origin.protocol &&
			url.host === origin.host &&
			url.host !== "" &&
			url.pathname === PANEL_PATH
		);
	} catch {
		// Not an address.
		return false;
	}
}

const isString = (value: unknown): value is string => typeof value === "string";
const isBoolean = (value: unknown): value is boolean =>
	typeof value === "boolean";

/** A panel command, checked; `undefined` for anything else. */
export function parseCommand(message: unknown): PanelCommand | undefined {
	if (typeof message !== "object" || message === null) return undefined;
	const m = message as Record<string, unknown>;
	switch (m["type"]) {
		case "hello":
			return Number.isInteger(m["windowId"])
				? { type: "hello", windowId: m["windowId"] as number }
				: undefined;
		case "visible":
			return isBoolean(m["visible"])
				? { type: "visible", visible: m["visible"] }
				: undefined;
		case "connect":
		case "stop":
		case "new-address":
			return { type: m["type"] };
		case "keep-on":
		case "blur-forms":
		case "pair":
		case "fill-code":
			return isBoolean(m["on"]) ? { type: m["type"], on: m["on"] } : undefined;
		case "revoke":
			return isString(m["grantId"])
				? { type: "revoke", grantId: m["grantId"] }
				: undefined;
		case "allow-all":
			return isString(m["grantId"]) && isBoolean(m["on"])
				? { type: "allow-all", grantId: m["grantId"], on: m["on"] }
				: undefined;
		case "ask-again":
			return isString(m["grantId"]) && isString(m["tool"])
				? { type: "ask-again", grantId: m["grantId"], tool: m["tool"] }
				: undefined;
		case "set-relay":
			return isString(m["relay"])
				? { type: "set-relay", relay: m["relay"] }
				: undefined;
		case "answer":
			return isString(m["id"]) &&
				(m["answer"] === "allow" ||
					m["answer"] === "deny" ||
					m["answer"] === "always")
				? { type: "answer", id: m["id"], answer: m["answer"] }
				: undefined;
		case "fill":
			return isString(m["id"]) && isBoolean(m["yes"])
				? { type: "fill", id: m["id"], yes: m["yes"] }
				: undefined;
		default:
			return undefined;
	}
}
