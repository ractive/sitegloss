/**
 * The side panel's view of the AI connection, which lives in the service
 * worker (DEC-015). It shows the state the worker sends over the panel's
 * port, in the header (through the panel's state, `s.ai`) and in the "AI app"
 * card and the questions (drawn here), and sends the user's commands back.
 * Closing the panel changes nothing but pairing, which stops.
 *
 * The card is the tab-mcp extension's (its `sidepanel/card.ts`), with
 * Sitegloss's relay and "Keep AI access on" under it.
 * "Blur form fields in screenshots" goes the same way: the worker keeps it,
 * and the panel neither reads nor writes it in storage (DEC-016), as do
 * Always allow and "Allow all changes" for each AI app (DEC-018).
 */

import {
	askDataConsent,
	BROWSER,
	FIREFOX,
	PANEL,
	requestPermissions,
} from "../lib/browser.ts";
import { HOSTED_ORIGIN, PAIR_FILL_SITE } from "../worker/pair-fill.ts";
import {
	type AiState,
	type Answer,
	fillAppLabel,
	PANEL_PORT,
	type PanelCommand,
	QUESTION_TIMEOUT_MS,
	type QuestionView,
	type WorkerMessage,
} from "../worker/protocol.ts";
import { DEFAULT_RELAY, relayProblem } from "../worker/settings.ts";
import {
	ALLOW_DELAY_MS,
	armed,
	cardView,
	confirms,
	hasNewGrant,
	type KeepOnAsk,
	keepOnAskStarts,
	keepOnChosen,
	NOT_ASKING,
	nextKeepOnAsk,
	pairedSince,
	SWITCH_WAIT_MS,
	type SwitchIntent,
	stillPaired,
	switchShown,
	type TurnedOn,
	wentOffSentence,
} from "./card.ts";
import { byId, h } from "./dom.ts";
import { setCopyLabel, setLabel, withIcon } from "./icons.ts";
import { copyText, startSetup } from "./setup.ts";
import type { PanelState } from "./state.ts";
import { panelWindow } from "./window.ts";

/** Firefox: the user said no to its question about the data AI access sends. */
export const NO_CONSENT_ANSWER =
	"AI access sends the pages' marks, comments, screenshots, element details and addresses to your AI app, and Firefox was not allowed to let it. Turn it on again to be asked again.";

declare const SITEGLOSS_TEST_BUILD: boolean | undefined;
declare const SITEGLOSS_FIREFOX: boolean | undefined;

/** After a first click on Disconnect all apps with apps connected: the second does it. */
const NEW_ADDRESS_ARMED_MS = 4000;
/** The pairing code's place while there is none: as long as a code, `XXXX-XXXX`. */
const CODE_PLACEHOLDER = "––––-––––";
/** The button that disconnects every AI app (the library's `disconnectAll()`). */
const DISCONNECT_ALL = "Disconnect all apps";

/** How long the panel waits for the worker's Blur form fields before it starts an overlay. */
const BLUR_KNOWN_MS = 2000;

/** The worker's Blur form fields, as its last state said; `undefined` before one came. */
let blurValue: boolean | undefined;
let blurSettled: () => void = () => {};
/** The worker answered: with a state, or that it failed. */
const blurReady = new Promise<void>((resolve) => {
	blurSettled = resolve;
});

/**
 * "Blur form fields in screenshots", for an overlay the panel starts: the
 * worker's value once its first state came (a moment after the panel
 * opened). Without one in time, or when the worker failed, blur: the safe
 * side. The worker tells open overlays its value when it starts and when a
 * panel attaches, so a guess does not stay.
 */
/** The question under "Keep AI access on" (DEC-059). */
export const KEEP_ON_QUESTION =
	"Keep AI access on after a reload, an update of Sitegloss or a restart of the browser? Without it, you turn AI access on again each time.";

/** Where this browser keeps the answer: its own storage, not a case, not synced. */
const KEEP_ON_ASKED = "sitegloss.keepOnAsked";

/** Whether this browser answered the question, or set Keep AI access on by hand (or had it on). */
export function keepOnAnswered(): boolean {
	try {
		return localStorage.getItem(KEEP_ON_ASKED) !== null;
	} catch {
		return false;
	}
}

/** The answer kept: the question does not come again. */
export function rememberKeepOnAnswer(
	answer: "kept-on" | "not-now" | "unticked",
): void {
	try {
		localStorage.setItem(KEEP_ON_ASKED, answer);
	} catch {
		// No storage (a private window that refuses it): asked again next time.
	}
}

/**
 * The question in `box` while `asking`, nothing otherwise. Drawn once: the
 * box is a status region, which would say it again on every redraw. It
 * takes no focus and scrolls nothing; neither button is the primary one.
 * Taken away while one of its buttons has the focus, the focus goes to
 * `focusAfter` (the switch it was about), not to the page's start.
 */
export function showKeepOnQuestion(
	box: HTMLElement,
	asking: boolean,
	answer: (keep: boolean) => void,
	focusAfter?: HTMLElement,
): void {
	if (!asking) {
		if (box.childElementCount === 0) return;
		const held = box.contains(document.activeElement);
		box.replaceChildren();
		if (held) focusAfter?.focus();
		return;
	}
	if (box.childElementCount > 0) return;
	box.replaceChildren(
		h("p", {}, KEEP_ON_QUESTION),
		h(
			"div",
			{ class: "row" },
			h(
				"button",
				{
					type: "button",
					"data-answer": "keep",
					title: "The same as ticking Keep AI access on",
					onclick: () => answer(true),
				},
				"Keep it on",
			),
			h(
				"button",
				{
					type: "button",
					class: "quiet",
					"data-answer": "not-now",
					title:
						"AI access goes off after a reload, an update or a restart, as now; Keep AI access on above changes that any time",
					onclick: () => answer(false),
				},
				"Not now",
			),
		),
	);
}

export function blurFormsNow(): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		blurReady,
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, BLUR_KNOWN_MS);
		}),
	])
		.finally(() => clearTimeout(timer))
		.then(() => blurValue ?? true);
}

/** What a question's card says of the time left to answer it. */
export function countdownText(expiresAt: number, now: number): string {
	// Never more than the whole time, as the bar: a clock set back says no more.
	const left = Math.min(
		QUESTION_TIMEOUT_MS / 1000,
		Math.max(0, Math.ceil((expiresAt - now) / 1000)),
	);
	return `${left} s left to answer; no answer is Don't allow.`;
}

/** The share of the time to answer that is left, 1 to 0: the bar's width. */
export function timeLeftShare(expiresAt: number, now: number): number {
	return Math.min(1, Math.max(0, (expiresAt - now) / QUESTION_TIMEOUT_MS));
}

/** The panel's header text for the connection's state. */
export function statusText(a: AiState): string {
	if (a.state === "connected")
		return a.grants.length > 0
			? `Connected: ${a.grants.map((g) => g.name || g.host).join(", ")}`
			: "Waiting for an AI app to pair";
	if (a.state === "connecting") return "Connecting…";
	if (a.state === "reconnecting") return "Connection lost, retrying…";
	const problem =
		a.problem &&
		`Not connected: ${a.problem}${a.retrying ? " Trying again…" : ""}`;
	const replaced =
		a.replaced && "Not connected: Sitegloss's connection is in use elsewhere.";
	// Information, not a problem (`problemOf` says nothing of it): why it went off.
	const wentOff = wentOffSentence(a);
	return (
		[
			a.relayNote,
			replaced ?? problem ?? (wentOff && `Not connected: ${wentOff}`),
		]
			.filter(Boolean)
			.join(" ") || "Not connected"
	);
}

/**
 * Whether `statusText(a)` tells of something wrong: the connection failed, was
 * lost or was taken over, or the saved relay cannot be used. Connected or
 * connecting, all is well.
 */
export function problemOf(a: AiState): "connection" | undefined {
	if (a.state === "connected" || a.state === "connecting") return undefined;
	return a.state === "reconnecting" ||
		a.problem !== undefined ||
		a.replaced !== undefined ||
		a.relayNote !== undefined
		? "connection"
		: undefined;
}

/**
 * Start the panel's side of the connection; `update` changes the panel's
 * state, `showSettings` opens the Settings view, where the card is (an open
 * case stays open underneath, DEC-023).
 */
export async function startAi(
	update: (change: (s: PanelState) => void) => void,
	showSettings: () => void,
): Promise<void> {
	const relayInput = byId<HTMLInputElement>("relay");
	const keepOn = byId<HTMLInputElement>("keep-on");
	const blurForms = byId<HTMLInputElement>("blur-forms");
	const blurNote = byId<HTMLParagraphElement>("blur-forms-note");
	/**
	 * The worker keeps the setting (DEC-016): without it the box is off, and
	 * says why under it, on Home, where the AI card that said it is not
	 * (DEC-076).
	 */
	const blurOff = (why: string | undefined) => {
		blurForms.disabled = why !== undefined;
		blurNote.hidden = why === undefined;
		if (blurNote.textContent !== (why ?? "")) blurNote.textContent = why ?? "";
	};
	const aiSwitch = byId<HTMLInputElement>("ai-switch");
	const buttons = [
		byId<HTMLButtonElement>("ai-button"),
		byId<HTMLButtonElement>("connect"),
	];

	// The panel's page opened in a tab by its address is no side panel: the
	// worker does not talk to it (DEC-015). But in Firefox's test build, as
	// automation cannot reach the sidebar (the defines themselves, not
	// `browser.ts`'s constants, so other builds drop the code).
	if (
		!(
			typeof SITEGLOSS_TEST_BUILD !== "undefined" &&
			SITEGLOSS_TEST_BUILD &&
			typeof SITEGLOSS_FIREFOX !== "undefined" &&
			SITEGLOSS_FIREFOX
		) &&
		(await chrome.tabs.getCurrent()) !== undefined
	) {
		update(
			(s) =>
				(s.ai = {
					...s.ai,
					status: `Open the ${PANEL} from the Sitegloss icon for AI access`,
					problem: "tab",
				}),
		);
		for (const b of buttons) b.disabled = true;
		keepOn.disabled = true;
		relayInput.disabled = true;
		blurOff(
			`Kept by Sitegloss's ${PANEL}: open the ${PANEL} from the Sitegloss icon to change it.`,
		);
		aiSwitch.disabled = true;
		blurSettled();
		return;
	}

	const setup = startSetup();
	const windowId = await panelWindow();
	let port: chrome.runtime.Port | undefined;
	let current: AiState | undefined;
	/** What the worker was told: pairing on (codes come only then). */
	let pairing = false;
	/** The user asked to add another AI app (with apps paired already). */
	let addingApp = false;
	/** Whether to keep AI access on: due after the person turned it on, shown once it is on (DEC-059). */
	let keepOnAsk: KeepOnAsk = NOT_ASKING;
	const keepOnBox = byId("keep-on-ask");
	const keepOnNote = byId("keep-on-note");
	/** AI access turned on by the person: asked once it is on, where `asksKeepOn` says so. */
	const turnedOn = (way: TurnedOn) => {
		if (current !== undefined)
			keepOnAsk = keepOnAskStarts(way, current, keepOnAnswered(), Date.now());
	};
	/** It did not come on (Firefox's consent refused): nothing to ask. */
	const notTurnedOn = () => {
		keepOnAsk = NOT_ASKING;
		if (current) showCard(current);
	};
	const answerKeepOn = (keep: boolean) => {
		// "Not now" is the answer at once; "Keep it on" once keep-on is really
		// on (`keepOnChosen`): a refused consent leaves it unanswered.
		if (!keep) rememberKeepOnAnswer("not-now");
		keepOnAsk = NOT_ASKING;
		// The question goes now, in the click, before a consent prompt can
		// take the focus: its button had it, so the switch gets it.
		if (current) showCard(current);
		// Exactly what ticking it does, Firefox's consent step included.
		if (keep && !keepOn.checked) keepOn.click();
	};
	// Answered in another panel of this browser: gone here too.
	window.addEventListener("storage", (e) => {
		if (e.key === KEEP_ON_ASKED && current) showCard(current);
	});
	/** The apps paired when "+ Add another AI app" was clicked. */
	let knownGrants: ReadonlySet<string> = new Set();
	/** While the pairing box shows: the apps paired before it did. */
	let beforePairing: ReadonlySet<string> | undefined;
	/** Disconnect asks first: the apps whose button was clicked once. */
	const disconnectArmed = new Map<
		string,
		{ at: number; timer: ReturnType<typeof setTimeout> }
	>();
	/** The user's flip of the AI access switch, while the worker acts on it. */
	let switchIntent: SwitchIntent | undefined;
	let newAddressArmedAt: number | undefined;
	/**
	 * Until when "Allow all changes" ignores being turned on after the
	 * questions' dialog closed (DEC-037): the second click of a double click
	 * on its last Allow lands on the panel under it.
	 */
	let quietUntil = 0;
	/** The relay field's text is half typed: a question took the focus from it. */
	let relayHeld = false;

	function send(command: PanelCommand): void {
		try {
			port?.postMessage(command);
		} catch {
			// The worker went away; the port reconnects and the view follows.
		}
	}

	/**
	 * The port to the worker. Chrome ends it when the worker stops (an update,
	 * a reload): connect again, which starts the worker.
	 */
	function connectPort(): void {
		let opened: chrome.runtime.Port;
		try {
			opened = chrome.runtime.connect({ name: PANEL_PORT });
		} catch {
			// The extension was updated or reloaded: this panel belongs to the
			// version before and can reach nothing any more.
			port = undefined;
			showQuestions([]);
			update(
				(s) =>
					(s.ai = {
						...s.ai,
						status: "Sitegloss was updated: close and open this panel again.",
						// Nothing it showed before holds: it can reach nothing.
						problem: "updated",
						connected: false,
						apps: 0,
						active: false,
						working: false,
					}),
			);
			return;
		}
		port = opened;
		opened.onMessage.addListener((news: WorkerMessage) => {
			if (news?.type === "state") show(news.state);
			else if (news?.type === "failed") failed(news.problem);
		});
		opened.onDisconnect.addListener(() => {
			if (port === opened) port = undefined;
			// No worker, no call running: the chip stops saying one is (DEC-064's review).
			update((s) => (s.ai = { ...s.ai, working: false }));
			// The worker stopped, and its questions with it: the next one's
			// first state lists what waits then.
			showQuestions([]);
			setTimeout(connectPort, 250);
		});
		if (windowId !== undefined) send({ type: "hello", windowId });
		sendVisible();
		if (pairing) send({ type: "pair", on: true });
	}

	/** The worker's connection could not start: nothing here can work. */
	function failed(problem: string): void {
		document.documentElement.dataset["aiState"] = "failed";
		// Its questions went with the worker: no dialog over a panel that
		// can answer nothing.
		showQuestions([]);
		blurValue = undefined;
		blurSettled();
		for (const b of buttons) b.disabled = true;
		keepOn.disabled = true;
		relayInput.disabled = true;
		blurOff(
			"Cannot be changed now: Sitegloss's background did not start (the AI pill at the top says more).",
		);
		aiSwitch.disabled = true;
		update(
			(s) =>
				(s.ai = {
					...s.ai,
					status: `AI access is not available: ${problem}`,
					problem: "unavailable",
					connected: false,
					apps: 0,
					active: false,
					working: false,
				}),
		);
	}

	function show(a: AiState): void {
		current = a;
		// The library's state, as the worker last said it.
		document.documentElement.dataset["aiState"] = a.state;
		const connected = a.state === "connected";
		update((s) => {
			s.ai = {
				...s.ai,
				status: statusText(a),
				problem: problemOf(a),
				connected,
				apps: connected ? a.grants.length : 0,
				allowAll: connected ? a.grants.filter((g) => g.allowAll).length : 0,
				active: a.state !== "disconnected" || a.retrying,
				keepOn: a.keepOn,
				lastCall: a.lastCall,
				working: connected && (a.running ?? 0) > 0,
			};
		});
		// A worker that failed before may have started since.
		for (const control of [...buttons, keepOn, relayInput, aiSwitch])
			control.disabled = false;
		blurOff(undefined);
		blurForms.checked = a.blurForms;
		blurValue = a.blurForms;
		blurSettled();
		if (document.activeElement !== relayInput && !relayHeld) {
			relayInput.value = a.relay;
			relayInput.setCustomValidity("");
		}
		showCard(a);
		showFill(a);
		showQuestions(a.questions);
	}

	// --- Filling in the code on the relay's pairing page (DEC-044) ---

	const fillAsk = byId("pair-fill-ask");
	const fillYes = byId<HTMLButtonElement>("pair-fill-yes");
	/** The question shown, and since when (Fill in the code waits, as Allow does). */
	let fillShown: { id: string; at: number } | undefined;
	/** Sitegloss may see the hosted relay's site: asked once, then on each change. */
	let fillAllowed: boolean | undefined;
	const checkFillAllowed = () =>
		chrome.permissions.contains(PAIR_FILL_SITE).then(
			(yes) => {
				fillAllowed = yes;
				if (current) showFill(current);
			},
			() => {},
		);
	void checkFillAllowed();
	chrome.permissions.onAdded?.addListener(() => void checkFillAllowed());
	chrome.permissions.onRemoved?.addListener(() => void checkFillAllowed());

	function showFill(a: AiState): void {
		const problem = byId("pair-fill-problem");
		problem.hidden = a.fillProblem === undefined;
		problem.textContent = a.fillProblem ?? "";
		const ask = a.fill;
		fillAsk.hidden = ask === undefined;
		if (ask === undefined) fillShown = undefined;
		else if (fillShown?.id !== ask.id) {
			fillShown = { id: ask.id, at: Date.now() };
			// As text: the names come from a web page.
			byId("pair-fill-ask-text").textContent =
				`${fillAppLabel(ask)} wants to connect to Sitegloss on the relay's page in this browser. Fill in the code there?`;
			fillYes.disabled = true;
		}
		// Under the code: "Fill in the code for me", a setting of its own, off
		// by default, on the hosted relay only (the worker says, `fillHere`).
		const host = new URL(HOSTED_ORIGIN).host;
		const working = a.fillCode && fillAllowed === true;
		byId("pair-fill").hidden = !a.fillHere || fillAllowed === undefined;
		byId("pair-fill-on").hidden = working;
		// On, also when the site was taken away in the browser's settings.
		byId("pair-fill-off").hidden = !a.fillCode;
		byId("pair-fill-text").textContent = working
			? `When an AI app opens ${host}'s pairing page in this browser, Sitegloss asks you, then fills in the code.`
			: `Pairing in this browser? Sitegloss can fill in the code on ${host}'s page for you, after asking.${fillAllowed ? "" : ` ${BROWSER} asks you first.`}`;
	}

	/**
	 * Fill in the code counts once the panel has been in front a moment with
	 * the question shown, as Allow does: leaving the panel starts the wait
	 * again.
	 */
	let fillFocusedSince: number | undefined;
	setInterval(() => {
		const now = Date.now();
		if (document.visibilityState === "visible" && document.hasFocus())
			fillFocusedSince ??= now;
		else fillFocusedSince = undefined;
		if (fillShown === undefined) return;
		const ready = armed(fillShown.at, fillFocusedSince, now);
		if (fillYes.disabled === ready) fillYes.disabled = !ready;
	}, 100);
	for (const [button, yes] of [
		[fillYes, true],
		[byId<HTMLButtonElement>("pair-fill-no"), false],
	] as const)
		button.addEventListener("click", () => {
			if (fillShown === undefined || button.disabled) return;
			send({ type: "fill", id: fillShown.id, yes });
		});
	byId<HTMLButtonElement>("pair-fill-on").addEventListener("click", () => {
		// In the click: the browser asks only during one (and answers at once
		// when Sitegloss has the site already).
		void requestPermissions(PAIR_FILL_SITE).then(
			(granted) => {
				if (granted) send({ type: "fill-code", on: true });
				return checkFillAllowed();
			},
			() => checkFillAllowed(),
		);
	});
	byId<HTMLButtonElement>("pair-fill-off").addEventListener("click", () =>
		send({ type: "fill-code", on: false }),
	);

	// --- Commands ---

	/**
	 * Send `command`, which turns AI access on: in Firefox once the user has
	 * allowed that the AI app gets the pages' content and addresses (its
	 * data collection consent). Firefox asks only in the click: call this in
	 * it, before any await. A no leaves AI access off, and says why.
	 */
	function turnOn(command: PanelCommand, refused: () => void = () => {}): void {
		if (!FIREFOX) {
			send(command);
			return;
		}
		askDataConsent().then(
			(yes) => {
				if (yes) send(command);
				else {
					refused();
					update(
						(s) =>
							(s.ai = {
								...s.ai,
								status: `Not connected: ${NO_CONSENT_ANSWER}`,
							}),
					);
				}
			},
			(error: unknown) => {
				refused();
				update(
					(s) =>
						(s.ai = {
							...s.ai,
							status: `Not connected: Firefox could not ask for the consent (${error instanceof Error ? error.message : String(error)}).`,
						}),
				);
			},
		);
	}

	/** The top bar's pill: to the card in Settings, turning AI access on if it is off. */
	byId<HTMLButtonElement>("ai-button").addEventListener("click", () => {
		if (current !== undefined && cardView(current, false).turnOn) {
			turnedOn("pill");
			turnOn({ type: "connect" }, notTurnedOn);
		}
		showSettings();
		// After the render that shows the Settings view.
		setTimeout(() => byId("ai-card").scrollIntoView({ block: "nearest" }));
	});

	byId<HTMLButtonElement>("connect").addEventListener("click", () => {
		turnedOn("button");
		turnOn({ type: "connect" }, notTurnedOn);
	});

	aiSwitch.addEventListener("change", () => {
		const intent = { on: aiSwitch.checked, until: Date.now() + SWITCH_WAIT_MS };
		switchIntent = intent;
		addingApp = false;
		if (aiSwitch.checked) turnedOn("switch");
		if (aiSwitch.checked)
			turnOn({ type: "connect" }, () => {
				switchIntent = undefined;
				keepOnAsk = NOT_ASKING;
				if (current) showCard(current);
				else aiSwitch.checked = false;
			});
		else send({ type: "stop" });
		// No state that matches the flip: the switch shows the state again.
		setTimeout(() => {
			if (switchIntent === intent && current) showCard(current);
		}, SWITCH_WAIT_MS);
	});

	function addApp(on: boolean): void {
		addingApp = on;
		// The apps already paired: one more connecting ends adding it.
		knownGrants = new Set(current?.grants.map((g) => g.grantId));
		if (current) showCard(current);
	}

	byId<HTMLButtonElement>("add-app").addEventListener("click", () =>
		addApp(true),
	);
	byId<HTMLButtonElement>("pair-done").addEventListener("click", () =>
		addApp(false),
	);

	keepOn.addEventListener("change", () => {
		// Set by hand: that is the answer too. Unticked, at once; ticked, once
		// keep-on is really on (`keepOnChosen` in showCard).
		if (!keepOn.checked && !keepOnAnswered()) rememberKeepOnAnswer("unticked");
		keepOnAsk = NOT_ASKING;
		if (current) showCard(current);
		if (keepOn.checked)
			turnOn({ type: "keep-on", on: true }, () => {
				keepOn.checked = current?.keepOn ?? false;
			});
		else send({ type: "keep-on", on: false });
	});

	// The worker keeps it and tells the overlays already open.
	blurForms.addEventListener("change", () =>
		send({ type: "blur-forms", on: blurForms.checked }),
	);

	relayInput.addEventListener("change", () => {
		// The questions' dialog took the focus from a relay half typed: that
		// is no commit. The text stays for when the dialog has gone.
		if (list.open) {
			relayHeld = true;
			return;
		}
		const value = relayInput.value.trim();
		const problem = relayProblem(value);
		if (problem !== undefined) {
			relayInput.setCustomValidity(problem);
			relayInput.reportValidity();
			return;
		}
		relayInput.setCustomValidity("");
		addApp(false);
		send({ type: "set-relay", relay: value });
	});

	/** A Copy in the pairing box; a refused clipboard selects what it shows. */
	function copy(
		button: HTMLButtonElement,
		text: string | undefined,
		noun: string,
		shown: HTMLElement,
	): void {
		if (text !== undefined) copyText(button, text, noun, shown, setup.announce);
	}

	const copyAddress = byId<HTMLButtonElement>("pair-copy");
	// The Copy buttons of index.html, with their icon (DEC-078).
	for (const id of ["pair-copy", "pair-copy-code"])
		setCopyLabel(byId<HTMLButtonElement>(id), "Copy");
	copyAddress.addEventListener("click", () =>
		copy(copyAddress, current?.address, "address", byId("pair-address")),
	);
	const copyCode = byId<HTMLButtonElement>("pair-copy-code");
	copyCode.addEventListener("click", () => {
		// A used code is not to be typed again (`aria-disabled`, kept focusable).
		if (current?.codeUsed) return;
		copy(copyCode, current?.code, "code", byId("pair-code"));
	});

	byId<HTMLButtonElement>("pair-take-back").addEventListener("click", () =>
		turnOn({ type: "connect" }),
	);

	// "Disconnect all apps", under the code and in the takeover notice: there
	// AI access is off and the code is hidden, and a new secret is what drops
	// the apps paired with the connection taken over. The address stays: it
	// names the app (DEC-042).
	const newAddressButtons = [
		"pair-new-address",
		"pair-replaced-new-address",
	].map((id) => byId<HTMLButtonElement>(id));
	const newAddressText = (text: string) => {
		// In the takeover notice without its icon: beside Connect again it
		// would take a line more at 340 px (DEC-078).
		for (const b of newAddressButtons)
			setLabel(b, b.id === "pair-new-address" ? "disconnect" : undefined, text);
	};
	newAddressText(DISCONNECT_ALL);
	for (const button of newAddressButtons)
		button.addEventListener("click", () => {
			const armed =
				newAddressArmedAt !== undefined &&
				Date.now() - newAddressArmedAt < NEW_ADDRESS_ARMED_MS;
			// With apps connected it asks first: they all have to pair again.
			if ((current?.grants.length ?? 0) > 0 && !armed) {
				newAddressArmedAt = Date.now();
				newAddressText("Really? Every app must pair again");
				setTimeout(() => {
					newAddressArmedAt = undefined;
					newAddressText(DISCONNECT_ALL);
				}, NEW_ADDRESS_ARMED_MS);
				return;
			}
			newAddressArmedAt = undefined;
			newAddressText(DISCONNECT_ALL);
			send({ type: "new-address" });
		});

	// --- The card ---

	/** Tell the worker whether to pair (codes come only then). */
	function syncPairing(on: boolean): void {
		if (on === pairing) return;
		pairing = on;
		send({ type: "pair", on });
	}

	function disconnectButton(grant: AiState["grants"][number]): HTMLElement {
		const armed = disconnectArmed.has(grant.grantId);
		return h(
			"button",
			{
				type: "button",
				"data-focus": "disconnect",
				"data-armed": armed ? "" : false,
				title: armed
					? "Click again to disconnect this app"
					: "Remove this app (click twice): it can no longer reach Sitegloss, and must be added and paired again to come back",
				onclick: () => {
					const first = disconnectArmed.get(grant.grantId);
					if (first === undefined) {
						// Asks first: the app has to be added and paired again after.
						disconnectArmed.set(grant.grantId, {
							at: Date.now(),
							timer: setTimeout(() => {
								disconnectArmed.delete(grant.grantId);
								if (current) showCard(current);
							}, NEW_ADDRESS_ARMED_MS),
						});
					} else {
						// The second click of a double click confirms nothing.
						if (!confirms(first.at, Date.now())) return;
						clearTimeout(first.timer);
						disconnectArmed.delete(grant.grantId);
						send({ type: "revoke", grantId: grant.grantId });
					}
					if (current) showCard(current);
				},
			},
			...withIcon(
				"disconnect",
				armed ? "Disconnect? Click again" : "Disconnect",
			),
		);
	}

	/**
	 * An AI app's "Allow all changes" switch (DEC-018), and while it is on the
	 * line that says what that means: in the card, under the app's name. Only
	 * there (DEC-084; DEC-036 had it under the top bar too): while it is on,
	 * the top bar's pill says so (`aiPill` in view.ts).
	 */
	function allowAll(grant: AiState["grants"][number]): HTMLElement[] {
		const app = grant.name || grant.host;
		const parts: HTMLElement[] = [
			h(
				"label",
				{
					class: "switch small",
					title: `On: every change ${app} asks for runs without asking you, until you disconnect it`,
				},
				h("input", {
					type: "checkbox",
					role: "switch",
					"data-focus": "allow-all",
					"aria-checked": String(grant.allowAll),
					checked: grant.allowAll,
					onchange: (event: Event) => {
						const input = event.currentTarget as HTMLInputElement;
						// The second click of a double click on the dialog's last
						// Allow lands on the panel under it: it turns nothing on.
						if (input.checked && Date.now() < quietUntil) {
							input.checked = false;
							input.setAttribute("aria-checked", "false");
							return;
						}
						input.setAttribute("aria-checked", String(input.checked));
						send({
							type: "allow-all",
							grantId: grant.grantId,
							on: input.checked,
						});
					},
				}),
				h("span", {}, "Allow all changes"),
			),
		];
		if (grant.allowAll)
			parts.push(
				h(
					"p",
					{ class: "meta" },
					`Every change ${app} asks for runs without asking you, deleting a case too, until you disconnect it.`,
				),
			);
		return parts;
	}

	/**
	 * What the card lets the user change for an AI app: "Allow all changes",
	 * and the tools always allowed, each with "Ask again".
	 */
	function grantAllows(grant: AiState["grants"][number]): HTMLElement[] {
		const app = grant.name || grant.host;
		const parts = allowAll(grant);
		if (grant.always.length > 0)
			parts.push(
				h(
					"ul",
					{ class: "always", "aria-label": `Always allowed for ${app}` },
					...grant.always.map(({ tool, title }) =>
						h(
							"li",
							{ "data-tool": tool },
							h("span", { class: "meta" }, `Always allowed: ${title}`),
							h(
								"button",
								{
									type: "button",
									class: "link",
									"data-focus": `ask-again:${tool}`,
									"aria-label": `Ask again before ${title}`,
									title: grant.allowAll
										? `Ask you again each time ${app} wants to run ${title}; this also turns Allow all changes off`
										: `Ask you again each time ${app} wants to run ${title}`,
									onclick: () =>
										send({ type: "ask-again", grantId: grant.grantId, tool }),
								},
								"Ask again",
							),
						),
					),
				),
			);
		return parts;
	}

	function showCard(a: AiState): void {
		// Adding another app ends with the connection.
		if (a.state !== "connected") addingApp = false;
		// And with the app being added connecting: the box has done its job.
		if (addingApp && hasNewGrant(knownGrants, a)) addingApp = false;
		const view = cardView(a, addingApp);
		// Keep-on really on, by the answer, by hand or from before: answered.
		if (keepOnChosen(keepOnAnswered(), a)) rememberKeepOnAnswer("kept-on");
		keepOnAsk = nextKeepOnAsk(keepOnAsk, a, keepOnAnswered(), Date.now());
		showKeepOnQuestion(keepOnBox, keepOnAsk.asking, answerKeepOn, aiSwitch);
		// While asked, the sentence under the checkbox would say the same.
		keepOnNote.hidden = keepOnAsk.asking;
		// The pairing box showed and an app is paired since: say what now.
		// (A connection that drops meanwhile does not end that: the app may
		// be listed only once Sitegloss is connected again.)
		const paired = pairedSince(beforePairing, a);
		update((s) => {
			// Only in the card that is open: a pairing done while elsewhere
			// is no news to come back to.
			if (paired !== undefined && s.settings) s.ai.justPaired = paired;
			// Disconnected, or AI access off: no longer said.
			const said = s.ai.justPaired;
			if (said !== undefined && !stillPaired(said.grantId, a))
				delete s.ai.justPaired;
		});
		if (paired !== undefined) beforePairing = undefined;
		else if (view.pairing)
			beforePairing ??= new Set(a.grants.map((g) => g.grantId));
		else if (a.state === "connected") beforePairing = undefined;
		byId("ai-state").dataset["state"] = view.status;
		// Only when it changes: a live region says it again at every assignment.
		const stateText = byId("ai-state-text");
		if (stateText.textContent !== view.stateText)
			stateText.textContent = view.stateText;
		// Also while connecting or retrying, so the user can stop it.
		const shown = switchShown(view.switchOn, switchIntent, Date.now());
		switchIntent = shown.intent;
		aiSwitch.checked = shown.checked;
		aiSwitch.setAttribute("aria-checked", String(shown.checked));
		byId("connect").hidden = !view.turnOn;
		byId("pair-replaced").hidden = a.replaced === undefined;
		byId("pair-replaced-text").textContent = a.replaced?.sibling
			? "Sitegloss's connection is in use elsewhere in this browser."
			: "Another tab or program took over Sitegloss's connection, and the AI apps paired with it may now talk to it. Disconnect all apps to end that.";
		const problem = [
			a.relayNote,
			a.state === "disconnected" ? a.problem : undefined,
			// A Disconnect that did not work, named by its app.
			...a.grants.map((g) => g.problem),
		]
			.filter(Boolean)
			.join(" ");
		byId("pair-problem").hidden = problem === "";
		byId("pair-problem").textContent = problem;
		for (const id of disconnectArmed.keys())
			if (!a.grants.some((g) => g.grantId === id)) {
				clearTimeout(disconnectArmed.get(id)?.timer);
				disconnectArmed.delete(id);
			}
		// Redrawn on every state: the control that had the keyboard's focus
		// keeps it, so Enter can confirm a Disconnect.
		const active = document.activeElement as HTMLElement | null;
		const focused = active?.closest<HTMLElement>("#pair-grants li[data-grant]")
			?.dataset["grant"];
		const focusedControl = active?.dataset["focus"];
		byId("pair-grants").replaceChildren(
			...a.grants.map((grant) =>
				h(
					"li",
					{ "data-grant": grant.grantId },
					h(
						"div",
						{ class: "grant-head" },
						h(
							"span",
							{},
							grant.name || grant.host,
							grant.name
								? h("span", { class: "meta" }, ` ${grant.host}`)
								: null,
						),
						disconnectButton(grant),
					),
					...grantAllows(grant),
				),
			),
		);
		if (focused !== undefined) {
			const item = byId("pair-grants").querySelector(
				`li[data-grant="${CSS.escape(focused)}"]`,
			);
			// The same control, or, when it went (an "Ask again" takes its own
			// tool away), the nearest one still there in the same app.
			const at = (selector: string) =>
				item?.querySelector<HTMLElement>(selector) ?? null;
			(
				at(`[data-focus="${CSS.escape(focusedControl ?? "disconnect")}"]`) ??
				(focusedControl?.startsWith("ask-again:")
					? (at('[data-focus^="ask-again:"]') ?? at('[data-focus="allow-all"]'))
					: null) ??
				at('[data-focus="disconnect"]')
			)?.focus();
		}
		syncPairing(view.pairing);
		byId("pairing").hidden = !view.pairing;
		byId("add-app").hidden = !view.addApp;
		byId("pair-done").hidden = !view.done;
		// The address only while pairing: it is what an AI app is added with.
		byId("pair-address").textContent = view.address;
		setup.show(view.address);
		const code = a.code;
		// As the relay sends it, `XXXX-XXXX`; typed with or without the dash.
		const codeBox = byId("pair-code");
		codeBox.textContent = code ?? CODE_PLACEHOLDER;
		// A used code stays, faint, until its app connects: no new code flashes.
		codeBox.toggleAttribute("data-used", a.codeUsed === true);
		const copyCodeButton = byId<HTMLButtonElement>("pair-copy-code");
		copyCodeButton.disabled = code === undefined;
		// Not `disabled`: the button keeps the keyboard's focus (after a Copy).
		if (a.codeUsed) copyCodeButton.setAttribute("aria-disabled", "true");
		else copyCodeButton.removeAttribute("aria-disabled");
		const note = a.codeUsed
			? "Code used. Waiting for your AI app…"
			: "The code changes every 2 minutes and after each use.";
		const codeNote = byId("pair-code-note");
		if (codeNote.textContent !== note) codeNote.textContent = note;
	}

	// --- Questions ---

	/**
	 * Arguments the box cannot show at once say how long they are, so that
	 * nobody takes the start for all: decided by the box's overflow once it
	 * is laid out, and again whenever its size changes.
	 */
	function scrollNote(pre: Element): void {
		const note = pre.parentElement?.querySelector("[data-scroll-note]");
		if (note === null || note === undefined) return;
		note.textContent =
			pre.scrollHeight > pre.clientHeight
				? ` (${(pre.textContent ?? "").length.toLocaleString("en-US")} characters: scroll to read all of them)`
				: "";
	}
	const overflow = new ResizeObserver((entries) => {
		for (const { target } of entries) scrollNote(target);
	});

	/** Since when the panel has been visible and focused, if it is. */
	let focusedSince: number | undefined;
	const cards = new Map<
		string,
		{ card: HTMLElement; shownAt: number; expiresAt: number }
	>();
	const list = byId<HTMLDialogElement>("questions");
	const questionStatus = byId("question-status");

	/**
	 * The questions in a modal dialog (DEC-037, as the tab-mcp extension's):
	 * over the panel wherever it is scrolled to, the rest of it inert while
	 * one waits. At the panel's top they were out of sight in a case scrolled
	 * down, and ran out unseen. It opens with the first question and closes
	 * with the last; the arguments take the focus, Allow waits as before.
	 */
	function showDialog(open: boolean): void {
		if (open && !list.open) {
			returnTo = focusedControl();
			list.showModal();
		} else if (!open && list.open) {
			// With the close, not at its event a task later.
			quietUntil = Date.now() + ALLOW_DELAY_MS;
			list.close();
			// The dialog gives the focus back to the element that had it, but
			// the card and the row under the bar were drawn again meanwhile:
			// to the same control of the same app, as drawn now.
			returnTo?.()?.focus();
			returnTo = undefined;
			relayHeld = false;
			arm();
		}
	}

	/**
	 * Where the focus is, if it is on a control of an AI app in the card: how
	 * to find that control again once it is redrawn.
	 */
	let returnTo: (() => HTMLElement | null) | undefined;
	function focusedControl(): (() => HTMLElement | null) | undefined {
		const active = document.activeElement as HTMLElement | null;
		const control = active?.dataset["focus"];
		const item = active?.closest<HTMLElement>("[data-grant]");
		const box = item?.closest<HTMLElement>("#pair-grants");
		const grant = item?.dataset["grant"];
		if (control === undefined || grant === undefined || !box) return undefined;
		return () =>
			document.querySelector<HTMLElement>(
				`#${box.id} [data-grant="${CSS.escape(grant)}"] [data-focus="${CSS.escape(control)}"]`,
			);
	}

	// The way out that allows nothing (the rest of the panel is inert, the
	// AI view's switch with it): every waiting call is refused.
	const stopInDialog = h(
		"button",
		{
			type: "button",
			"data-stop": "",
			title:
				"Pause AI access now: the waiting calls do not run, AI apps can no longer reach Sitegloss, and they stay paired",
			onclick: () => send({ type: "stop" }),
		},
		"Stop AI access",
	);
	const dialogFoot = h("div", { class: "questions-foot" }, stopInDialog);
	list.append(dialogFoot);
	// Escape does not close it: a question ends with an answer or its time.
	// `cancel` is not always cancelable (a close watcher without a user
	// activation), so the key is stopped too, and a dialog closed while
	// questions wait opens again.
	list.addEventListener("keydown", (event) => {
		if (event.key === "Escape") event.preventDefault();
	});
	list.addEventListener("cancel", (event) => event.preventDefault());
	list.addEventListener("close", () => {
		if (cards.size > 0) list.showModal();
		else {
			// A close showDialog did not make: the quiet time from now.
			quietUntil = Math.max(quietUntil, Date.now() + ALLOW_DELAY_MS);
			relayHeld = false;
			arm();
		}
	});

	/**
	 * Say `text` for screen readers: one short line for a new question, not
	 * its card with all the arguments. Emptied first, so the same line twice
	 * is said twice; lines of the same moment are said together.
	 */
	let announcing: ReturnType<typeof setTimeout> | undefined;
	const toAnnounce: string[] = [];
	function announce(text: string): void {
		questionStatus.textContent = "";
		toAnnounce.push(text);
		clearTimeout(announcing);
		announcing = setTimeout(() => {
			questionStatus.textContent = toAnnounce.splice(0).join(" ");
		}, 50);
	}

	function question(q: QuestionView): HTMLElement {
		const titles: Record<Answer, string> = {
			deny: "Refuse this call; nothing changes",
			allow: "Run this call once; the app asks again next time",
			always: `Run this call, and from now on ${q.title ?? q.tool} for ${q.app} without asking, until you disconnect it or an update of Sitegloss changes this tool`,
		};
		// Three buttons that look alike (DEC-037, as the tab-mcp extension's):
		// the card does not nudge towards allowing.
		const answer = (text: string, value: Answer) =>
			h(
				"button",
				{
					type: "button",
					"data-answer": value,
					title: titles[value],
					// Allow and Always allow only once the panel has been in front a
					// while: the click that brings it forward cannot approve.
					disabled: value !== "deny",
					onclick: (event: Event) => {
						if (!(event.currentTarget as HTMLButtonElement).disabled)
							send({ type: "answer", id: q.id, answer: value });
					},
				},
				text,
			);
		return h(
			"section",
			{ class: "question", "data-question": q.id },
			// The time left: a bar at the card's top that drains (only seen: the
			// line under the buttons says it).
			h(
				"div",
				{ class: "countdown-bar", "aria-hidden": "true" },
				h("span", { "data-drains": String(q.expiresAt) }),
			),
			h(
				"p",
				{ id: `asks-${q.id}` },
				h("strong", {}, `${q.app} wants to run ${q.title ?? q.tool}.`),
			),
			...q.lines.map((line) => h("p", {}, line)),
			h(
				"p",
				{ class: "meta" },
				`Tool ${q.tool}, with these arguments`,
				h("span", { "data-scroll-note": "" }),
				":",
			),
			// All of them, scrolling: what is allowed is what was shown (CR-03).
			// Reachable by keyboard to scroll them, and where the dialog's focus
			// goes: no key pressed as the question came answers it.
			// A group: an element without a role takes no name.
			h(
				"pre",
				{ tabindex: "0", role: "group", "aria-label": "Arguments" },
				q.args,
			),
			h(
				"div",
				{ class: "row" },
				answer("Don't allow", "deny"),
				answer("Allow", "allow"),
				answer("Always allow", "always"),
			),
			// Firefox leaves the focus in the page when its sidebar opens, and
			// Allow counts only in a panel that has it. Right under the buttons:
			// it says why two of them wait.
			...(FIREFOX
				? [
						h(
							"p",
							{ class: "meta", "data-focus-hint": "", hidden: true },
							`Click into the ${PANEL} to answer: Allow counts once it has the focus.`,
						),
					]
				: []),
			h(
				"p",
				{ class: "countdown", "data-expires": String(q.expiresAt) },
				countdownText(q.expiresAt, Date.now()),
			),
			h(
				"p",
				{ class: "meta" },
				`Always allow: ${q.title ?? q.tool} runs without asking for ${q.app}, until you disconnect it or an update of Sitegloss changes this tool.`,
			),
		);
	}

	function showQuestions(all: QuestionView[]): void {
		// A card dropped here stays dropped while the worker still lists it.
		for (const id of lostIds)
			if (!all.some((q) => q.id === id)) lostIds.delete(id);
		const questions = all.filter((q) => !lostIds.has(q.id));
		const ids = new Set(questions.map((q) => q.id));
		let removed = false;
		let hadFocus = false;
		for (const [id, { card }] of cards)
			if (!ids.has(id)) {
				const pre = card.querySelector("pre");
				if (pre !== null) overflow.unobserve(pre);
				hadFocus ||= card.contains(document.activeElement);
				card.remove();
				cards.delete(id);
				removed = true;
			}
		// What moved up under the pointer waits again, as if just shown.
		if (removed) for (const entry of cards.values()) entry.shownAt = Date.now();
		for (const q of questions)
			if (!cards.has(q.id)) {
				const card = question(q);
				dialogFoot.before(card);
				const pre = card.querySelector("pre");
				if (pre !== null) {
					scrollNote(pre);
					overflow.observe(pre);
				}
				cards.set(q.id, { card, shownAt: Date.now(), expiresAt: q.expiresAt });
				announce(`${q.app} wants to run ${q.title ?? q.tool}.`);
			}
		// The dialog is described by its first question: who asks for what.
		const [first] = cards.keys();
		if (first === undefined) list.removeAttribute("aria-describedby");
		else list.setAttribute("aria-describedby", `asks-${first}`);
		showDialog(cards.size > 0);
		// The answered card had the focus and went: to the next one's arguments.
		if (hadFocus)
			cards.values().next().value?.card.querySelector("pre")?.focus();
		arm();
	}

	/** How long after its end a card stays when no state took it away. */
	const LOST_CARD_MS = 5000;
	/** The questions whose cards were dropped so, while the worker lists them. */
	const lostIds = new Set<string>();

	/**
	 * Allow and Always allow count once the panel has been visible and focused for
	 * ALLOW_DELAY_MS with the question shown; leaving it starts the wait again.
	 */
	function arm(): void {
		const now = Date.now();
		if (document.visibilityState === "visible" && document.hasFocus())
			focusedSince ??= now;
		else focusedSince = undefined;
		for (const { card, shownAt } of cards.values()) {
			const ready = armed(shownAt, focusedSince, now);
			for (const b of card.querySelectorAll<HTMLButtonElement>(
				'button[data-answer="allow"], button[data-answer="always"]',
			))
				b.disabled = !ready;
			const hint = card.querySelector<HTMLElement>("[data-focus-hint]");
			if (hint !== null) hint.hidden = focusedSince !== undefined;
			const left = card.querySelector<HTMLElement>("[data-expires]");
			const text = countdownText(Number(left?.dataset["expires"]), now);
			if (left !== null && left.textContent !== text) left.textContent = text;
			const bar = card.querySelector<HTMLElement>("[data-drains]");
			if (bar !== null)
				bar.style.width = `${timeLeftShare(Number(bar.dataset["drains"]), now) * 100}%`;
		}
		// The quiet after the dialog, for the end-to-end tests: no look, as
		// nothing moved (switches going grey after every answer would flicker).
		document.body.toggleAttribute("data-quiet", now < quietUntil);
		// A card well past its end that no state took away (the worker's
		// timer and this clock disagree, or its news was lost): the panel is
		// not held under a dialog that waits for nothing.
		const lost = [...cards].filter(
			([, entry]) => now > entry.expiresAt + LOST_CARD_MS,
		);
		if (lost.length > 0) {
			for (const [id] of lost) lostIds.add(id);
			showQuestions((current?.questions ?? []).filter((q) => cards.has(q.id)));
		}
	}

	setInterval(() => {
		// While the mark of the quiet time is there too: a tick that comes late
		// (timers of a hidden panel) still takes it off.
		if (cards.size > 0 || document.body.hasAttribute("data-quiet")) arm();
	}, 100);
	for (const type of ["focus", "blur", "visibilitychange"])
		window.addEventListener(type, arm);

	/** Tell the worker whether the panel is on screen (not covered by another's). */
	function sendVisible(): void {
		send({ type: "visible", visible: document.visibilityState === "visible" });
	}
	document.addEventListener("visibilitychange", sendVisible);

	update((s) => (s.ai = { ...s.ai, status: "Not connected" }));
	relayInput.value = DEFAULT_RELAY;
	connectPort();
}
