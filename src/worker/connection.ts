/**
 * The connection to the user's AI app, in the service worker (DEC-015): the
 * library's `TabMcp` with Sitegloss's tools, the questions of tools that
 * change something, and the state the side panels show. A WebSocket that
 * carries messages keeps the worker alive (Chrome 116), and the relay's
 * heartbeat (a ping every 25 s, answered) carries some even when nothing
 * else happens. While AI access is on, an alarm wakes the worker once a
 * minute, and every worker start connects again: always with "Keep AI
 * access on", else until the browser closes or the extension is updated,
 * reloaded or disabled (all of which clear `chrome.storage.session`). The
 * settings and the address secret are in the worker's own IndexedDB
 * (`kv.ts`, DEC-016), out of content scripts' reach, as is what each AI app
 * may do without asking, which the library keeps beside the secret
 * (`always.ts`, DEC-018, DEC-043).
 */

import {
	type ConfirmAnswer,
	type ConfirmRequest,
	type ConnectionState,
	type StateChangeDetail,
	TabMcp,
} from "@ractive-ch/tab-mcp-client";
import {
	CodeFiller,
	type FillHost,
	PAIRING_PATH,
	type PagePort,
	pairingCodes,
} from "@ractive-ch/tab-mcp-client/extension";
import {
	BROWSER,
	dataConsent,
	FIREFOX,
	notificationOptions,
	PANEL,
} from "../lib/browser.ts";
import { cropImages, scaleImage, toWebp } from "../lib/images.ts";
import {
	type Broadcast,
	type ContentRequest,
	type OpenCaseAnswer,
	PAIRING_SCRIPT,
} from "../lib/messages.ts";
import type { CaseStore } from "../lib/store.ts";
import { AlwaysAllowed, removeOldStore } from "./always.ts";
import { badge } from "./badge.ts";
import { CodeWatch } from "./code-shown.ts";
import { decide } from "./decide.ts";
import { FillQuestion } from "./fill-question.ts";
import { endedProblem, KeepOn } from "./keep-on.ts";
import { type Kv, openKv } from "./kv.ts";
import { HOSTED_ORIGIN, PAIR_FILL_SITE } from "./pair-fill.ts";
import {
	type AiState,
	APP_ID,
	type CallView,
	type FillView,
	fillAppLabel,
	type PanelCommand,
	parseCommand,
	SERVER_NAME,
	type WorkerMessage,
} from "./protocol.ts";
import {
	appName,
	Questions,
	type QuestionsHost,
	visible,
} from "./questions.ts";
import { CachedSecretStorage } from "./secret.ts";
import {
	DEFAULT_RELAY,
	KEYS,
	loadSettings,
	type Replaced,
	relayProblem,
	SESSION_ON,
	SESSION_STOPPED,
	type Settings,
	saveReplaced,
	settleFillCode,
} from "./settings.ts";
import { type Capture, tabInFront, workerTab } from "./tab.ts";
import {
	confirmLines,
	createTools,
	INSTRUCTIONS,
	type TabBridge,
} from "./tools.ts";
import {
	WAS_ON_KEY,
	WENT_OFF_KEY,
	type WentOff,
	wentOffAfter,
	wentOffAtStart,
	wentOffOf,
} from "./went-off.ts";

/** Wakes the worker while AI access is on, should the connection be down. */
export const ALARM = "sitegloss-ai";

declare const SITEGLOSS_TEST_BUILD: boolean | undefined;

/** The notification of the fill-in question, when no panel is on screen. */
const FILL_NOTIFICATION = "sitegloss-fill";

/** One open side panel. */
interface Panel {
	port: chrome.runtime.Port;
	windowId?: number;
	/** It shows the address and code. */
	pairing: boolean;
	/** On screen, as it last said (covered by another extension's panel: not). */
	visible: boolean;
}

export interface ConnectionDeps {
	store: CaseStore;
	capture: Capture;
	/** A tool changed or deleted a case (the sync writes it, DEC-021). */
	changed?: (caseId: string) => void;
	/** Who is signed in to sitegloss.dev here, by id (DEC-039); none: nobody. */
	me?: () => Promise<string | undefined>;
	/** The team a case syncs with, by name; none: it is on this device only. */
	team?: (caseId: string) => Promise<string | undefined>;
	/** The settings database: `openKv()` unless given (a memory one in tests). */
	kv?: Kv;
}

/** Clear every notification of the extension: a previous worker's questions died with it. */
async function clearNotifications(): Promise<void> {
	try {
		const all = await chrome.notifications.getAll();
		await Promise.all(
			Object.keys(all).map((id) => chrome.notifications.clear(id)),
		);
	} catch {
		// None to clear, or notifications not available.
	}
}

/**
 * Close `chrome.storage.local` to content scripts, which may read and write
 * it by default. Only an extra layer (DEC-016): nothing is kept there any
 * more, and not every Chrome takes this for the local area, so a refusal is
 * only logged.
 */
async function restrictStorage(): Promise<void> {
	// Firefox has no access levels: its content scripts may always use it.
	if (FIREFOX) return;
	try {
		await chrome.storage.local.setAccessLevel({
			accessLevel: "TRUSTED_CONTEXTS",
		});
	} catch (error) {
		console.warn("Sitegloss: storage access level", error);
	}
}

/** Tell every tab's overlay, whatever a tab answers. */
async function tellTabs(news: ContentRequest): Promise<void> {
	try {
		for (const { id } of await chrome.tabs.query({}))
			if (id !== undefined)
				chrome.tabs.sendMessage(id, news).catch(() => undefined);
	} catch {
		// No tabs to tell.
	}
}

const message = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

async function broadcast(news: Broadcast): Promise<void> {
	try {
		await chrome.runtime.sendMessage(news);
	} catch {
		// No side panel open.
	}
}

/**
 * Firefox: why AI access does not come on, when the user has not allowed
 * that the AI app gets the pages' content and addresses (or took it back).
 */
export const NO_CONSENT =
	"Firefox has not been allowed to let Sitegloss send the pages' content and addresses to the AI app. Turn on AI access to be asked again.";

/** The writes of "Stop AI access": the session's stop, Keep AI access on, the session's on. */
type StopWrite = "stopped" | "keepOn" | "session";

/**
 * "Stop AI access": `disconnect` first, whatever the writes after it do
 * (CR-08). Every write is tried; the errors of those that failed come back.
 */
export async function stopFirst(
	disconnect: () => void,
	writes: Partial<Record<StopWrite, () => Promise<unknown>>>,
): Promise<Partial<Record<StopWrite, unknown>>> {
	disconnect();
	const failed: Partial<Record<StopWrite, unknown>> = {};
	for (const [name, write] of Object.entries(writes))
		try {
			await write();
		} catch (error) {
			failed[name as StopWrite] = error;
		}
	return failed;
}

/** What the panel says after a Stop whose writes `failed`; `undefined` when none did. */
export function stopProblem(
	failed: Partial<Record<StopWrite, unknown>>,
): string | undefined {
	const errors = Object.values(failed);
	if (errors.length === 0) return undefined;
	const said = `AI access is off now, but a setting could not be saved (${message(errors[0])}).`;
	// The session's stop holds over the rest until the browser closes.
	if ("stopped" in failed && ("keepOn" in failed || "session" in failed))
		return `${said} It may come on again the next time ${BROWSER} starts Sitegloss in the background.`;
	if ("keepOn" in failed)
		return `${said} Keep AI access on is still saved as on: AI access comes on again when ${BROWSER} restarts.`;
	return said;
}

/**
 * AI access on for this browser session after a change of the library's
 * state: on once connected; off after the user's `disconnect()`, and after
 * the relay ended a session (idle, old, or for a reason `KeepOn` names)
 * unless "Keep AI access on" connects again. `undefined`: unchanged, as
 * while reconnecting.
 */
export function sessionOnAfter(
	{ state, reason }: StateChangeDetail,
	keepOn: boolean,
): boolean | undefined {
	if (state === "connected") return true;
	if (state !== "disconnected") return undefined;
	if (reason === "user") return false;
	const ended =
		reason === "idle" ||
		reason === "expired" ||
		endedProblem(reason) !== undefined;
	if (ended && !keepOn) return false;
	return undefined;
}

/** The icon's part of the connection: "…" while connecting or reconnecting. */
export function badgeOf(
	state: ConnectionState,
): "connected" | "connecting" | "off" {
	if (state === "connected") return "connected";
	if (state === "connecting" || state === "reconnecting") return "connecting";
	return "off";
}

/** What the worker knows when `revoke()` rejected. */
export interface RevokeFailure {
	error: unknown;
	/** The library's state then. */
	state: ConnectionState;
	/** The relay's error may answer an earlier revoke (`unattributed`). */
	unattributed: boolean;
}

/**
 * Whether a relay's `error` may answer another revoke than the one it
 * rejected: it names no request (a relay before 0.10.2), and a revoke of
 * this session timed out before, whose answer may still come. The queue
 * pairs answers only while every revoke waits for its own.
 */
export function unattributed(error: unknown, timedOut: boolean): boolean {
	const e = error as { code?: unknown; for?: unknown } | undefined;
	return (
		timedOut &&
		e?.for === undefined &&
		(e?.code === "unknown_id" || e?.code === "store_unavailable")
	);
}

/** What the card says when Disconnect for `app` did not work. */
export function revokeProblem(
	{ error, state, unattributed }: RevokeFailure,
	app: string,
): string {
	const not = `${app} was not disconnected`;
	if (unattributed)
		return `${not}: the relay's answer may be for an earlier Disconnect it was slow to answer. Try again.`;
	const code = (error as { code?: unknown } | undefined)?.code;
	if (code === "store_unavailable")
		return `${not}: the relay could not save this. Try again.`;
	if (code === "unknown_id")
		return `The relay no longer knows ${app}, so it cannot reach Sitegloss any more. It leaves this list when AI access next connects.`;
	const name = (error as { name?: unknown } | undefined)?.name;
	// Nothing was sent: AI access is off, or the connection is on its way
	// back (or closing, a moment before the state says so).
	if (name === "InvalidStateError")
		return state === "disconnected"
			? `${not}: Sitegloss is not connected to the relay. Turn on AI access and try again.`
			: `${not}: the connection to the relay is being restored. Try again once it is connected.`;
	// Sent, and the session ended before the answer: the relay may have done it.
	if (name === "NetworkError")
		return `Sitegloss could not confirm that ${app} was disconnected: the connection ended first. It shows when AI access is next on.`;
	if (name === "TimeoutError")
		return `${not}: the relay did not answer. Try again.`;
	return `${not}: ${message(error)}`;
}

export class Connection {
	readonly #deps: ConnectionDeps;
	readonly #tab: TabBridge;
	readonly #storage: CachedSecretStorage;
	readonly #kv: Kv;
	readonly #questions: Questions;
	readonly #panels = new Set<Panel>();
	readonly #keep: KeepOn;
	/** The tools' titles, by name, for the card's list. */
	#titles = new Map<string, string>();
	#settings: Settings;
	/** AI access is on for this browser session (without "Keep AI access on"). */
	#sessionOn: boolean;
	/** Why AI access went off by itself, until it is on again (DEC-072). */
	#wentOff: WentOff | undefined;
	#relay: string;
	#relayNote: string | undefined;
	#mcp: TabMcp;
	#listening = new AbortController();
	/** Why the last command failed, until the next connection. */
	#problem: string | undefined;
	#lastCall: CallView | undefined;
	/** The tool calls running now, by the library's id (DEC-063). */
	#running = new Set<number>();
	/** The pairing code the card shows: a used one waits for its app (`nextCodeShown`). */
	readonly #code = new CodeWatch(
		{
			now: () => Date.now(),
			setTimer: (run, ms) => setTimeout(run, ms),
			clearTimer: (timer) => clearTimeout(timer),
		},
		() => this.#changed(),
	);
	/** Why Disconnect did not work, by grant: until it goes, or connected again. */
	readonly #revokeProblems = new Map<string, RevokeFailure>();
	/** A revoke of this session timed out: its answer may still come. */
	#revokeTimedOut = false;
	/**
	 * Disconnects, one at a time. Relays from 0.10.2 name the grant their
	 * error answers and the library pairs it; an older one (the user may set
	 * any relay) names nothing, and the library then rejects every revoke
	 * waiting with that error, another app's included.
	 */
	#revokes: Promise<void> = Promise.resolve();
	/** Panel commands, one after the other. */
	#commands: Promise<void> = Promise.resolve();
	/** How Sitegloss asks whether to fill in the code (DEC-044). */
	readonly #fillAsk: FillQuestion = new FillQuestion(this.#fillAskHost());
	/**
	 * The rules of filling in the code: the client library's (DEC-044,
	 * tab-mcp's DEC-206). Without its one more fill for the same request:
	 * never without a yes, one page, one question, one fill.
	 */
	readonly #filler: CodeFiller = new CodeFiller(this.#fillHost(), {
		retry: false,
	});
	/** Pairing is held on for a code Sitegloss fills in. */
	#fillPairing = false;
	#sending = false;

	private constructor(
		deps: ConnectionDeps,
		kv: Kv,
		storage: CachedSecretStorage,
		settings: Settings,
		sessionOn: boolean,
		wentOff?: WentOff,
	) {
		this.#deps = deps;
		this.#kv = kv;
		this.#tab = workerTab(deps.capture);
		this.#storage = storage;
		this.#settings = settings;
		this.#sessionOn = sessionOn;
		this.#wentOff = wentOff;
		this.#questions = new Questions(this.#questionsHost());
		this.#keep = new KeepOn(
			() => this.#settings.keepOn && this.#settings.replaced === undefined,
			() => this.#changed(),
		);
		const relay = settings.relay ?? DEFAULT_RELAY;
		let mcp: TabMcp;
		try {
			if (relayProblem(relay) !== undefined)
				throw new TypeError(relayProblem(relay));
			mcp = this.#create(relay);
			this.#relay = relay;
		} catch (error) {
			// A stored address the library refuses must not stop the connection.
			this.#relayNote = `The saved relay ${relay} cannot be used (${message(error)}); using ${DEFAULT_RELAY}.`;
			this.#relay = DEFAULT_RELAY;
			mcp = this.#create(DEFAULT_RELAY);
		}
		this.#mcp = mcp;
		this.#watch(mcp);
	}

	/**
	 * The connection, connected again if the user left AI access on and the
	 * address was not taken over meanwhile.
	 */
	static async start(deps: ConnectionDeps): Promise<Connection> {
		await restrictStorage();
		// The settings live in IndexedDB, out of content scripts' reach (DEC-016).
		const kv = deps.kv ?? (await openKv());
		// A previous worker's questions died with it.
		await clearNotifications();
		// Sitegloss's own Always allow store, from before the library kept
		// them (DEC-043): nothing in it outlived client 0.17's new addresses.
		await removeOldStore(kv).catch((error: unknown) =>
			console.warn("Sitegloss: removing the old Always allow", error),
		);
		// Upgraded from 0.3.0: the relay's site it asked for goes back once.
		await settleFillCode(kv, chrome.permissions).catch((error: unknown) =>
			console.warn("Sitegloss: giving back the relay's site", error),
		);
		const [storage, settings, session] = await Promise.all([
			CachedSecretStorage.load(kv),
			loadSettings(kv),
			chrome.storage.session.get([SESSION_ON, SESSION_STOPPED]),
		]);
		// A Stop in this browser session holds, whatever was stored before it.
		const stopped = session[SESSION_STOPPED] === true;
		const sessionOn = !stopped && session[SESSION_ON] === true;
		// It was on, and the session's flag is gone: a restart ended it (DEC-072).
		let wentOff = wentOffOf(await kv.get(WENT_OFF_KEY).catch(() => undefined));
		const restarted = wentOffAtStart({
			wasOn: (await kv.get(WAS_ON_KEY).catch(() => undefined)) === true,
			sessionOn,
			stopped,
			keepOn: settings.keepOn,
			replaced: settings.replaced !== undefined,
		});
		if (restarted) {
			wentOff = { reason: "restart", at: Date.now() };
			await kv
				.set({ [WENT_OFF_KEY]: wentOff, [WAS_ON_KEY]: false })
				.catch((error: unknown) =>
					console.warn("Sitegloss: saving why AI access is off", error),
				);
		}
		const connection = new Connection(
			deps,
			kv,
			storage,
			stopped ? { ...settings, keepOn: false } : settings,
			sessionOn,
			wentOff,
		);
		connection.#showBadge();
		connection.#watchTabs();
		connection.keepUp();
		// Overlays a panel started before this worker knew: the stored value.
		connection.#tellBlur();
		return connection;
	}

	// --- The library's connection ---

	/** A connection to `relay`; throws a `TypeError` for an address the library refuses. */
	#create(relay: string): TabMcp {
		// The library's `alwaysAllow` stays unset: its dialogs are not used.
		// Sitegloss asks itself, and the library keeps what the user allowed
		// per AI app and tool in `storage` and honours it first (DEC-043).
		const mcp: TabMcp = new TabMcp({
			relay,
			server: {
				name: SERVER_NAME,
				title: "Sitegloss",
				version: chrome.runtime.getManifest().version,
				instructions: INSTRUCTIONS,
				icons: [],
			},
			app: APP_ID,
			appName: "Sitegloss",
			storage: this.#storage,
			// Off, as it always was here (the library's default until 0.23.0):
			// these tools are for the AI apps that connect over the relay, not
			// for whatever calls WebMCP in this document, and the mirror is a
			// chunk loaded with import(), which a service worker refuses.
			webmcp: false,
			onConfirm: (request) => this.#decide(mcp, request),
		});
		const tools = createTools({
			store: this.#deps.store,
			tab: this.#tab,
			images: { toWebp, scale: scaleImage, crop: cropImages },
			onChange: (caseId) => {
				this.#deps.changed?.(caseId);
				void broadcast({ type: "cases:changed", caseId });
			},
			// Read at each call: only the worker writes it, and only after the
			// write to the store succeeded, so this is what the panel shows.
			blurForms: () => this.#settings.blurForms,
			maxMessageBytes: () => mcp.session?.limits.maxMessageBytes,
			...(this.#deps.me ? { me: this.#deps.me } : {}),
			// open_case (DEC-050): the panel of the tab's window answers; none
			// open, nobody does.
			openInPanel: (request) =>
				chrome.runtime
					.sendMessage({ type: "panel:open-case", ...request })
					.then(
						(answer: OpenCaseAnswer | undefined) =>
							answer ?? { opened: false, reason: "no-panel" },
						(): OpenCaseAnswer => ({ opened: false, reason: "no-panel" }),
					),
		});
		// AI apps through the relay only: no WebMCP (off anyway, and a worker
		// has no document) and no served port. `tools.ts` refuses other
		// callers too.
		for (const tool of tools)
			void mcp.registerTool(tool, { callers: ["relay"] });
		this.#titles = new Map(tools.map((t) => [t.name, t.title ?? t.name]));
		return mcp;
	}

	/**
	 * Always allow and Allow all changes, by AI app (DEC-018): the library's,
	 * for the connection now (DEC-043).
	 */
	get #always(): AlwaysAllowed {
		return AlwaysAllowed.of(this.#mcp);
	}

	/** Questions an Always allow given meanwhile covers are allowed. */
	#allowCovered(): void {
		this.#questions.allowCovered((grantId, tool) =>
			this.#always.has(grantId, tool),
		);
	}

	/**
	 * A tool that changes something: runs without asking if the user chose
	 * Always allow for it, or Allow all changes, for this AI app (DEC-018);
	 * otherwise asks. The library checks that first and asks only for the
	 * rest (DEC-043). The "Last AI call" is recorded either way ("toolcall").
	 */
	#decide(mcp: TabMcp, request: ConfirmRequest): Promise<ConfirmAnswer> {
		return decide(
			{
				always: AlwaysAllowed.of(mcp),
				ask: async (r) => {
					const lines = await confirmLines(this.#deps.store, this.#tab, r, {
						...(this.#deps.me ? { me: this.#deps.me } : {}),
						...(this.#deps.team ? { team: this.#deps.team } : {}),
					});
					const front = await tabInFront().catch(() => undefined);
					// No answer in time is "timeout": `decide` tells the library
					// "unanswered", which the AI app hears as such, not as a no.
					return this.#questions.ask(r, lines, front?.id);
				},
				connected: (grantId) => mcp.grants.some((g) => g.grantId === grantId),
				kept: () => this.#allowCovered(),
				refused: (r) =>
					console.warn(
						`Sitegloss: refused ${r.tool.name} through WebMCP: only an AI app connected through the relay may change something`,
					),
			},
			request,
		).finally(() => this.#changed());
	}

	#watch(mcp: TabMcp): void {
		this.#listening.abort();
		this.#listening = new AbortController();
		const { signal } = this.#listening;
		const changed = () => this.#changed();
		// The code shown moves on with the facts, also with no panel open.
		const code = () =>
			this.#code.update(
				mcp.pairingCode,
				mcp.grants.map((g) => g.grantId),
			);
		this.#code.stop();
		code();
		signal.addEventListener("abort", () => this.#code.stop());
		for (const type of ["pairingcode", "grantschange"] as const) {
			mcp.addEventListener(type, code, { signal });
			mcp.addEventListener(type, changed, { signal });
		}
		// Allowances changed (by a switch, Always allow, an app's grant gone).
		signal.addEventListener("abort", AlwaysAllowed.of(mcp).onChange(changed));
		// The relay's list of the apps connected: only it, so a start or a
		// lost connection (no list yet) forgets nothing. The library forgets
		// the allowances of an app no longer in it itself (DEC-043).
		mcp.addEventListener(
			"grantschange",
			({ detail: { grants } }) => {
				// An AI app that just connected ends its questions and fills.
				this.#filler.grantsChanged(
					grants.map((g) => ({ grantId: g.grantId, host: g.client.host })),
				);
				for (const id of this.#revokeProblems.keys())
					if (!grants.some((g) => g.grantId === id))
						this.#revokeProblems.delete(id);
			},
			{ signal },
		);
		mcp.addEventListener(
			"toolcallend",
			({ detail: { id } }) => {
				if (this.#running.delete(id)) this.#changed();
			},
			{ signal },
		);
		// A connection that ends ends its calls with it.
		signal.addEventListener("abort", () => this.#running.clear());
		mcp.addEventListener(
			"toolcall",
			({ detail: { id, tool, title, client } }) => {
				this.#running.add(id);
				this.#lastCall = {
					tool: title ?? tool,
					// As the questions name it: the declared name escaped, the
					// verified host after it (or the WebMCP label).
					app: appName(client),
					at: Date.now(),
				};
				this.#changed();
			},
			{ signal },
		);
		// Every change of state (and each attempt scheduled while
		// reconnecting) redraws.
		mcp.addEventListener(
			"statechange",
			({ detail }) => {
				// The question to fill in a code needs a connection to give one.
				if (detail.state !== "connected") this.#withdrawFill();
				if (detail.state === "connected") {
					this.#problem = undefined;
					// "Not connected" no longer holds; a new session owes no answers.
					this.#revokeProblems.clear();
					this.#revokeTimedOut = false;
					void this.#setReplaced(undefined);
				}
				const on = sessionOnAfter(detail, this.#settings.keepOn);
				const off = wentOffAfter(detail, this.#settings.keepOn);
				if (off !== undefined)
					void this.#setWentOff({ reason: off, at: Date.now() });
				// On again, or the person's own stop: nothing to explain.
				else if (detail.state === "connected" || detail.reason === "user")
					void this.#setWentOff(undefined);
				if (on !== undefined) void this.#setSessionOn(on);
				this.#changed();
			},
			{ signal },
		);
		mcp.addEventListener(
			"replaced",
			({ detail: { sibling } }) => {
				void this.#setReplaced({ sibling });
				void this.#setWentOff(undefined);
				void this.#setSessionOn(false);
				this.#changed();
			},
			{ signal },
		);
		this.#keep.watch(mcp);
	}

	/**
	 * Whether AI access may come on: always in Chrome; in Firefox only with
	 * the user's data collection consent, which the panel asks for at the
	 * click that turns it on. Without it, the card says why.
	 */
	async #consented(): Promise<boolean> {
		if (!FIREFOX) return true;
		const yes = await dataConsent().catch(() => false);
		if (!yes) {
			this.#problem = NO_CONSENT;
			this.#changed();
		}
		return yes;
	}

	/**
	 * The consent taken back (Firefox, in its add-on's permissions): AI
	 * access ends now, as the user's Stop would, but nothing is saved: once
	 * allowed again, the settings hold as they were.
	 */
	async consentChanged(): Promise<void> {
		if (!FIREFOX || (await dataConsent().catch(() => false))) return;
		this.#keep.stop();
		this.#mcp.disconnect();
		this.#problem = NO_CONSENT;
		this.#changed();
	}

	/** AI access is on, or on its way: Firefox's event page must stay meanwhile. */
	get active(): boolean {
		return (
			this.#mcp.state !== "disconnected" ||
			this.#keep.retrying ||
			this.#questions.list.length > 0 ||
			this.#fillAsk.busy
		);
	}

	/** Connect now: the panel's button, a start or the alarm. */
	#connect(): void {
		const mcp = this.#mcp;
		if (mcp.state !== "disconnected") return;
		this.#problem = undefined;
		mcp.connect({ resume: true }).catch((error: unknown) => {
			if (mcp === this.#mcp) this.#keep.failed(error);
		});
	}

	async #setReplaced(replaced: Replaced | undefined): Promise<void> {
		this.#settings = { ...this.#settings, replaced };
		await saveReplaced(this.#kv, replaced);
		await this.#syncAlarm();
	}

	/** "Stop AI access" in this browser session: over a stored Keep AI access on. */
	async #setStopped(on: boolean): Promise<void> {
		await chrome.storage.session.set({ [SESSION_STOPPED]: on });
	}

	/** Remember (or forget) why AI access went off by itself; the store may fail, the memory holds. */
	async #setWentOff(wentOff: WentOff | undefined): Promise<void> {
		if (wentOff === undefined && this.#wentOff === undefined) return;
		this.#wentOff = wentOff;
		this.#changed();
		try {
			if (wentOff === undefined) await this.#kv.remove(WENT_OFF_KEY);
			else await this.#kv.set({ [WENT_OFF_KEY]: wentOff });
		} catch (error) {
			console.warn("Sitegloss: saving why AI access is off", error);
		}
	}

	async #setSessionOn(on: boolean): Promise<void> {
		this.#sessionOn = on;
		// Kept beside the session's flag, which a restart clears: the two
		// together tell a restart from a worker that was only stopped.
		await this.#kv
			.set({ [WAS_ON_KEY]: on })
			.catch((error: unknown) =>
				console.warn("Sitegloss: saving that AI access is on", error),
			);
		await chrome.storage.session.set({ [SESSION_ON]: on });
		await this.#syncAlarm();
	}

	/** Settings change in memory only once the store has them. */
	async #setKeepOn(on: boolean): Promise<void> {
		await this.#kv.set({ [KEYS.keepOn]: on });
		this.#settings = { ...this.#settings, keepOn: on };
		await this.#syncAlarm();
	}

	/**
	 * Blur form fields: kept, then told to the overlays already open. A write
	 * that fails changes nothing: the command's problem is shown, the panel's
	 * box goes back with the next state, and the tools keep the old value.
	 */
	async #setBlurForms(on: boolean): Promise<void> {
		await this.#kv.set({ [KEYS.blurForms]: on });
		this.#settings = { ...this.#settings, blurForms: on };
		this.#tellBlur();
	}

	#tellBlur(): void {
		void tellTabs({
			type: "overlay:settings",
			blurForms: this.#settings.blurForms,
		});
	}

	/** The alarm runs while AI access is on (and the connection is ours, not taken over). */
	async #syncAlarm(): Promise<void> {
		const on =
			(this.#settings.keepOn || this.#sessionOn) &&
			this.#settings.replaced === undefined;
		try {
			if (on) {
				if ((await chrome.alarms.get(ALARM)) === undefined)
					await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
			} else await chrome.alarms.clear(ALARM);
		} catch (error) {
			console.warn("Sitegloss: alarm", error);
		}
	}

	/**
	 * Use `relay` from now on. The connection to the one before is ended
	 * whatever its state: left retrying, it would connect again unseen.
	 */
	async #useRelay(relay: string): Promise<void> {
		const next = this.#create(relay);
		await this.#kv.set({ [KEYS.relay]: relay });
		await this.#switchTo(relay, next);
	}

	/** Switch to `next`, a connection to `relay` that is stored already. */
	async #switchTo(relay: string, next: TabMcp): Promise<void> {
		const before = this.#mcp;
		this.#settings = { ...this.#settings, relay };
		this.#relay = relay;
		this.#relayNote = undefined;
		this.#problem = undefined;
		await this.#setReplaced(undefined);
		// AI access was on for the relay before: this one connects with
		// "Keep AI access on", or on the user's click.
		await this.#setSessionOn(false);
		this.#mcp = next;
		this.#watch(next);
		// Its statechange is no longer heard: a question for the relay
		// before goes now, and the new relay's first list of grants is
		// taken as it is.
		this.#filler.reset();
		this.#fillAsk.withdraw();
		before.disconnect();
		// (It connects only with Keep AI access on, which Firefox lets it only
		// with the consent.)
		if (!FIREFOX || !this.#settings.keepOn || (await this.#consented()))
			this.#keep.connect();
		this.#changed();
	}

	// --- Chrome's events ---

	/**
	 * The worker started, or woke for the alarm: connect if AI access is on
	 * and the connection is down.
	 */
	keepUp(): void {
		void this.#syncAlarm();
		if (this.#settings.replaced !== undefined) return;
		if (!this.#settings.keepOn && !this.#sessionOn) return;
		// Firefox: only with the data collection consent, which the user may
		// have taken back since.
		if (FIREFOX)
			void this.#consented().then((yes) => {
				if (yes && this.#settings.replaced === undefined) this.#keepUp();
			});
		else this.#keepUp();
	}

	#keepUp(): void {
		if (this.#settings.keepOn) this.#keep.connect();
		// Not while the library reconnects by itself: `#connect` waits for
		// `disconnected`.
		else if (this.#sessionOn) this.#connect();
	}

	notificationButton(id: string, index: number): void {
		this.#questions.notificationButton(id, index);
	}

	notificationDismissed(id: string): void {
		this.#questions.notificationDismissed(id);
	}

	/** The window whose tab the question of notification `id` is about, if known. */
	notificationWindow(id: string): number | undefined {
		return this.#questions.windowOfNotification(id);
	}

	// --- The side panels ---

	/**
	 * A side panel's port, its sender already checked, with the messages it
	 * sent before the connection had started.
	 */
	addPanel(port: chrome.runtime.Port, early: unknown[] = []): void {
		const panel: Panel = { port, pairing: false, visible: true };
		this.#panels.add(panel);
		// Its overlays may have started before it knew the worker's value.
		this.#tellBlur();
		const receive = (raw: unknown) => {
			// Anything that is not a command is dropped; the rest run one after
			// the other, so a stop never ends before the connect that came first.
			const command = parseCommand(raw);
			if (command === undefined) return;
			// What ends filling in the code ends it on receipt, not behind
			// the commands before it: a yes waiting for its code types
			// nothing once AI access, the setting or the relay goes.
			if (this.#endsFill(command)) this.#withdrawFill();
			this.#commands = this.#commands
				.then(() => this.#command(panel, command))
				.catch((error: unknown) => {
					this.#problem = message(error);
					this.#changed();
				});
		};
		for (const raw of early) receive(raw);
		port.onMessage.addListener(receive);
		port.onDisconnect.addListener(() => {
			this.#panels.delete(panel);
			if (panel.pairing) this.#pairingOff();
			if (panel.windowId !== undefined)
				this.#questions.panelClosed(panel.windowId);
		});
		this.#send(panel);
	}

	async #command(panel: Panel, command: PanelCommand): Promise<void> {
		switch (command.type) {
			case "hello":
				panel.windowId = command.windowId;
				return;
			case "visible":
				panel.visible = command.visible;
				// Hidden: the questions it alone showed go out as notifications.
				if (!command.visible && panel.windowId !== undefined)
					this.#questions.panelClosed(panel.windowId);
				return;
			case "connect":
				if (FIREFOX && !(await this.#consented())) return;
				// The user's click takes the connection back after a takeover. AI
				// access is on for the session once connected ("connected").
				await this.#setReplaced(undefined);
				await this.#setStopped(false);
				await this.#setWentOff(undefined);
				this.#connect();
				this.#changed();
				return;
			case "stop": {
				// Ends the session, not the pairing: the AI app works again after
				// the next connect. "Keep AI access on" would undo that, so it is
				// off in memory at once, before the store has it, and the session
				// remembers the stop over it, so a new worker keeps it too (CR-08).
				const wasOn = this.#settings.keepOn;
				this.#settings = { ...this.#settings, keepOn: false };
				await this.#setWentOff(undefined);
				const failed = await stopFirst(
					() => {
						this.#keep.stop();
						this.#mcp.disconnect();
					},
					{
						stopped: () => this.#setStopped(true),
						...(wasOn
							? { keepOn: () => this.#kv.set({ [KEYS.keepOn]: false }) }
							: {}),
						session: () => this.#setSessionOn(false),
					},
				);
				await this.#syncAlarm();
				this.#changed();
				const problem = stopProblem(failed);
				if (problem !== undefined) throw new Error(problem);
				return;
			}
			case "keep-on":
				if (FIREFOX && command.on && !(await this.#consented())) return;
				await this.#setKeepOn(command.on);
				if (command.on) await this.#setStopped(false);
				if (command.on) await this.#setWentOff(undefined);
				if (command.on) this.#keep.connect();
				else this.#keep.stop();
				this.#changed();
				return;
			case "blur-forms":
				await this.#setBlurForms(command.on);
				this.#changed();
				return;
			case "pair":
				panel.pairing = command.on;
				if (command.on) this.#mcp.startPairing();
				else this.#pairingOff();
				this.#changed();
				return;
			case "revoke":
				// Not awaited: the commands after it (a Stop) must not wait for
				// the relay's answer, up to 15 s.
				this.#revoke(command.grantId);
				return;
			case "allow-all":
				// Only for an app the card shows.
				if (!this.#mcp.grants.some((g) => g.grantId === command.grantId))
					return;
				this.#always.setAll(command.grantId, command.on);
				if (command.on) this.#allowCovered();
				this.#changed();
				return;
			case "ask-again":
				this.#always.removeTool(command.grantId, command.tool);
				this.#changed();
				return;
			case "new-address":
				await this.#newAddress();
				return;
			case "set-relay":
				if (
					relayProblem(command.relay) !== undefined ||
					command.relay === this.#relay
				)
					return;
				await this.#useRelay(command.relay);
				return;
			case "answer":
				this.#questions.answer(command.id, command.answer);
				return;
			case "fill":
				this.#fillAsk.answer(command.id, command.yes);
				return;
			case "fill-code":
				await this.#setFillCode(command.on);
				this.#changed();
				return;
		}
	}

	/** Whether `command` ends filling in the code: Stop, turning it off, another relay. */
	#endsFill(command: PanelCommand): boolean {
		switch (command.type) {
			case "stop":
				return true;
			case "fill-code":
				return !command.on;
			case "set-relay":
				return (
					relayProblem(command.relay) === undefined &&
					command.relay !== this.#relay
				);
			default:
				return false;
		}
	}

	/**
	 * "Disconnect all apps" (the library's `disconnectAll()`). The address the
	 * AI apps are added with stays: it names the app (DEC-042). What is new is
	 * the secret behind it, the page the relay knows. The library first takes
	 * the old page back, connected or not, taken over or not, so the relay
	 * revokes every grant of it and disconnects the AI apps that may now talk
	 * to whoever took it; then it connects with the new secret if it was on.
	 * After a takeover AI access is off, and a new worker's library knows
	 * nothing of the takeover: it connects, so the card shows the address and
	 * a code to pair again. Once the secret is new, the takeover notice goes,
	 * also when connecting with it fails (`secretChanged`, which still names
	 * the secret's change).
	 */
	async #newAddress(): Promise<void> {
		const replaced = this.#settings.replaced !== undefined;
		this.#problem = undefined;
		this.#changed();
		try {
			// "connected" turns AI access on.
			await this.#mcp.disconnectAll();
			// The secret is new: no longer the one taken over, also should
			// the connect after it fail.
			await this.#setReplaced(undefined);
			if (replaced && (!FIREFOX || (await this.#consented())))
				await this.#mcp.connect({ resume: true });
		} catch (error) {
			this.#problem = message(error);
			// The secret changed, and only connecting with it failed (the
			// library connects itself after a takeover it saw).
			if ((error as { secretChanged?: unknown }).secretChanged === true)
				await this.#setReplaced(undefined).catch(() => {});
		}
		this.#changed();
	}

	/**
	 * Disconnect one AI app (DEC-017). Its Always allow goes with the grant,
	 * once the library's list no longer has it (DEC-018, DEC-043): also
	 * for a grant the relay does not know (expired), which client 0.16.1
	 * drops from the list when relay 0.10.2 says so. A relay before 0.10.2
	 * names no grant in its `unknown_id`: the library rejects, the app stays
	 * listed, and only then does the worker forget it and say why.
	 */
	#revoke(grantId: string): void {
		const mcp = this.#mcp;
		this.#revokeProblems.delete(grantId);
		this.#changed();
		this.#revokes = this.#revokes.then(() => {
			if (mcp !== this.#mcp) return;
			return mcp.revoke(grantId).catch((error: unknown) => {
				if (mcp !== this.#mcp) return;
				const failure: RevokeFailure = {
					error,
					state: mcp.state,
					unattributed: unattributed(error, this.#revokeTimedOut),
				};
				if ((error as { name?: unknown }).name === "TimeoutError")
					this.#revokeTimedOut = true;
				this.#revokeProblems.set(grantId, failure);
				// A relay before 0.10.2: the queue makes it this grant's answer,
				// unless an earlier one's may still come.
				if (
					(error as { code?: unknown }).code === "unknown_id" &&
					!failure.unattributed
				)
					AlwaysAllowed.of(mcp).forget(grantId);
				this.#changed();
			});
		});
	}

	/**
	 * Pairing stops once no panel's pairing view is open, and no code
	 * Sitegloss filled in waits for the relay.
	 */
	#pairingOff(): void {
		if (![...this.#panels].some((p) => p.pairing) && !this.#fillPairing)
			this.#mcp.stopPairing();
	}

	// --- Filling in the code on the relay's pairing page (DEC-044) ---

	/**
	 * The origin of the relay's pages whose pairing page Sitegloss fills in:
	 * the hosted relay's, while it is the relay Sitegloss connects to. A test
	 * build takes the origin its tests set instead (the define itself: other
	 * builds drop it).
	 */
	#fillOrigin(): string | undefined {
		if (typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD) {
			const test = (globalThis as { siteglossTestFillOrigin?: unknown })
				.siteglossTestFillOrigin;
			if (typeof test === "string") return test;
		}
		return new URL(this.#relay).origin === HOSTED_ORIGIN
			? HOSTED_ORIGIN
			: undefined;
	}

	/** Filling in may happen now: turned on, AI access connected, the hosted relay. */
	#fillOn(): boolean {
		return (
			this.#settings.fillCode &&
			this.#mcp.state === "connected" &&
			this.#fillOrigin() !== undefined
		);
	}

	/** Withdraw every question and fill: AI access off, or turned off. */
	#withdrawFill(): void {
		this.#filler.withdrawAll();
		this.#fillAsk.withdraw();
	}

	/** What the library's filler needs from Sitegloss (its `FillHost`). */
	#fillHost(): FillHost {
		return {
			extensionId: chrome.runtime.id,
			app: APP_ID,
			relayOrigin: () => this.#fillOrigin(),
			aiOn: () => this.#mcp.state === "connected",
			enabled: () => this.#settings.fillCode,
			ask: (tabId, client, signal) => this.#fillAsk.ask(tabId, client, signal),
			code: (signal, context) => this.#fillAsk.code(signal, context),
			release: () => this.#fillAsk.release(),
			failed: (why, context) => this.#fillAsk.failed(why, context),
			now: () => Date.now(),
		};
	}

	/** What Sitegloss's question needs: the panels, the library, pairing. */
	#fillAskHost() {
		return {
			notify: (view: FillView | undefined) => this.#fillNotice(view),
			changed: () => this.#changed(),
			visible,
			// Always on the connection of now, also while a panel shows the
			// code: a panel's flag may still be about the relay before a
			// switch. Sent again, `pairing.start` is answered with the code
			// that shows, which `takeCode` does not take for the next one.
			hold: (on: boolean) => {
				this.#fillPairing = on;
				if (on) this.#mcp.startPairing();
				else this.#pairingOff();
			},
			codes: () => pairingCodes(this.#mcp),
			now: () => Date.now(),
		};
	}

	/** The question as a notification, while no panel is on screen. */
	#fillNotice(view: FillView | undefined): void {
		if (view === undefined) {
			void chrome.notifications.clear(FILL_NOTIFICATION).catch(() => {});
			return;
		}
		if ([...this.#panels].some((p) => p.visible)) return;
		void chrome.notifications
			.create(
				FILL_NOTIFICATION,
				notificationOptions({
					type: "basic",
					iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
					title: `Connect an AI app at ${view.host}?`,
					message: `${fillAppLabel(view)} wants to connect to Sitegloss. To fill in the code, click the Sitegloss icon and answer in the ${PANEL}; or type the code yourself.`,
					priority: 2,
				}),
			)
			.catch(() => undefined);
	}

	/**
	 * A pairing page's port (taken at the worker's top level): the library
	 * checks its sender and asks, or closes it.
	 */
	pairingPage(page: PagePort): void {
		void this.#filler.page(page);
	}

	/**
	 * A tab finished loading `url`: on the relay's pairing page, while
	 * filling in may happen, the library's script goes into its top frame.
	 * It reads the form and opens its port; nothing is read here. Without
	 * the user's leave to see that site the browser refuses, and the user
	 * types the code as before.
	 */
	async pageLoaded(tabId: number, url: string | undefined): Promise<void> {
		const origin = this.#fillOrigin();
		if (url === undefined || origin === undefined || !this.#fillOn()) return;
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return;
		}
		if (parsed.origin !== origin || parsed.pathname !== PAIRING_PATH) return;
		await chrome.scripting
			.executeScript({
				target: { tabId, frameIds: [0] },
				files: [PAIRING_SCRIPT],
			})
			.catch(() => undefined);
	}

	/**
	 * Tabs that load the relay's pairing page. Added here, not at the
	 * worker's top level: it matters only while AI access is connected,
	 * which keeps the worker running, so no tab's loading wakes it. The
	 * page going ends its port, which withdraws its question.
	 */
	#watchTabs(): void {
		chrome.tabs?.onUpdated?.addListener((tabId, info, tab) => {
			if (info.status === "complete") void this.pageLoaded(tabId, tab.url);
		});
	}

	/**
	 * "Fill in the code for me" on or off: kept, then in force. Off, a
	 * question that waits goes at once, and the relay's site is given back
	 * unless the user gave access to all sites, which is not this feature's.
	 */
	async #setFillCode(on: boolean): Promise<void> {
		await this.#kv.set({ [KEYS.fillCode]: on });
		this.#settings = { ...this.#settings, fillCode: on };
		if (on) return;
		this.#withdrawFill();
		try {
			const all = await chrome.permissions.contains({
				origins: ["<all_urls>"],
			});
			if (!all) await chrome.permissions.remove(PAIR_FILL_SITE);
		} catch (error) {
			console.warn("Sitegloss: giving back the relay's site", error);
		}
	}

	#questionsHost(): QuestionsHost {
		return {
			windowOf: async (tabId) => {
				try {
					return (await chrome.tabs.get(tabId)).windowId;
				} catch {
					return undefined;
				}
			},
			panelInFocus: async (windowId) => {
				// Open is not enough: it has to be on screen, not covered by
				// another extension's panel for the tab.
				if (
					![...this.#panels].some((p) => p.windowId === windowId && p.visible)
				)
					return false;
				return (await chrome.windows.get(windowId)).focused;
			},
			notify: async (id, text) => {
				// Firefox: no buttons, no `requireInteraction` (the text says to
				// answer in the sidebar, `notificationText`).
				await chrome.notifications.create(
					id,
					notificationOptions({
						type: "basic",
						iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
						...text,
						buttons: text.buttons.map((title) => ({ title })),
						requireInteraction: true,
						priority: 2,
					}),
				);
			},
			clear: (id) => void chrome.notifications.clear(id).catch(() => {}),
			changed: () => this.#changed(),
			now: () => Date.now(),
		};
	}

	// --- State ---

	get state(): AiState {
		const mcp = this.#mcp;
		const problem = this.#keep.problem ?? this.#problem;
		const address = mcp.session?.address;
		// Read only: moved on by the code's and the apps' events (`#watch`).
		const shown = mcp.pairingCode === undefined ? {} : this.#code.shown;
		const { code, used: codeUsed } = shown;
		const replaced = this.#settings.replaced;
		const fill = this.#fillAsk.question;
		const fillProblem = this.#fillAsk.problem;
		return {
			relay: this.#relay,
			...(this.#relayNote !== undefined ? { relayNote: this.#relayNote } : {}),
			keepOn: this.#settings.keepOn,
			blurForms: this.#settings.blurForms,
			state: mcp.state,
			retrying: this.#keep.retrying,
			...(problem !== undefined ? { problem } : {}),
			...(address !== undefined ? { address } : {}),
			grants: mcp.grants.map((g) => {
				const always = this.#always.entry(g.grantId);
				const failed = this.#revokeProblems.get(g.grantId);
				const problem =
					failed === undefined
						? undefined
						: revokeProblem(failed, g.client.name || g.client.host);
				return {
					grantId: g.grantId,
					name: g.client.name,
					host: g.client.host,
					allowAll: always.all,
					always: always.tools.map((tool) => ({
						tool,
						title: this.#titles.get(tool) ?? tool,
					})),
					...(problem !== undefined ? { problem } : {}),
				};
			}),
			pairing: [...this.#panels].some((p) => p.pairing),
			...(code !== undefined ? { code } : {}),
			...(codeUsed !== undefined ? { codeUsed: true } : {}),
			...(replaced !== undefined
				? { replaced: { sibling: replaced.sibling } }
				: {}),
			...(this.#wentOff !== undefined ? { wentOff: this.#wentOff.reason } : {}),
			...(this.#lastCall !== undefined ? { lastCall: this.#lastCall } : {}),
			...(this.#running.size > 0 ? { running: this.#running.size } : {}),
			questions: this.#questions.list,
			fillCode: this.#settings.fillCode,
			fillHere: this.#fillOrigin() !== undefined,
			...(fill !== undefined ? { fill } : {}),
			...(fillProblem !== undefined ? { fillProblem } : {}),
		};
	}

	/** Tell the panels (once per turn of the event loop) and set the badge. */
	#changed(): void {
		this.#showBadge();
		if (this.#sending) return;
		this.#sending = true;
		queueMicrotask(() => {
			this.#sending = false;
			for (const panel of this.#panels) this.#send(panel);
		});
	}

	#send(panel: Panel): void {
		const news: WorkerMessage = { type: "state", state: this.state };
		try {
			panel.port.postMessage(news);
		} catch {
			// Closed meanwhile: its onDisconnect removes it.
		}
	}

	/**
	 * The icon says what is going on with no panel open: a question waits
	 * ("?"), it is connecting or retrying ("…"), or AI access is on (a green
	 * spark in the icon, no badge); the sync's "!" comes in between (badge.ts).
	 */
	#showBadge(): void {
		badge.ai({
			questions: this.#questions.list.length + (this.#fillAsk.question ? 1 : 0),
			ai: badgeOf(this.#mcp.state),
		});
	}
}
