/**
 * The AI connection's settings, kept by the service worker in its own
 * IndexedDB (`kv.ts`, DEC-016): the relay, "Keep AI access on", "Blur form
 * fields in screenshots", "Fill in the code for me" and a takeover of the
 * connection. Whether AI access is on for this browser session is in
 * `chrome.storage.session`.
 */

import type { Kv } from "./kv.ts";

/** The hosted relay, which allows the development build's ID. */
export const DEFAULT_RELAY = "https://tab-mcp.ractive.ch";

/** The library's address secrets: `tab-mcp:secret:<relay origin>:<name>`. */
export const SECRET_PREFIX = "tab-mcp:secret:";

/** Hosts the library accepts over plain http: and ws:. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Why `value` is no relay address the library accepts, or `undefined`. */
export function relayProblem(value: string): string | undefined {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		// Not an address.
		return "Not an address.";
	}
	if (url.protocol === "https:" || url.protocol === "wss:") return undefined;
	if (url.protocol !== "http:" && url.protocol !== "ws:")
		return "Use an https: (or wss:) address.";
	return LOOPBACK.has(url.hostname)
		? undefined
		: "Plain http: works only for localhost; use https: for other hosts.";
}

/** Keys in the worker's settings database. */
export const KEYS = {
	relay: "relay",
	keepOn: "keepAiOn",
	blurForms: "blurForms",
	replaced: "replaced",
	fillCode: "fillCode",
} as const;

/**
 * In `chrome.storage.session`: AI access is on until the browser closes, or
 * the extension is updated, reloaded or disabled. That area is for trusted
 * contexts only unless the extension opens it, which Sitegloss never does.
 */
export const SESSION_ON = "aiOn";
/**
 * Also there: "Stop AI access" was clicked in this browser session. It
 * holds over a stored Keep AI access on (whose write may have failed) until
 * the next connect or Keep AI access on.
 */
export const SESSION_STOPPED = "aiStopped";

/**
 * Another tab or program took Sitegloss's connection over (`replaced`):
 * kept across worker restarts, so a restart does not take it back by itself.
 */
export interface Replaced {
	sibling: boolean;
}

export interface Settings {
	/** As stored; `undefined` for none. The connection checks it. */
	relay: string | undefined;
	keepOn: boolean;
	blurForms: boolean;
	replaced: Replaced | undefined;
	/** "Fill in the code for me" on the hosted relay's pairing page (DEC-044): off by default. */
	fillCode: boolean;
}

function replacedOf(value: unknown): Replaced | undefined {
	return typeof value === "object" &&
		value !== null &&
		typeof (value as Replaced).sibling === "boolean"
		? { sibling: (value as Replaced).sibling }
		: undefined;
}

export async function loadSettings(kv: Kv): Promise<Settings> {
	const s = await kv.all();
	const relay = s[KEYS.relay];
	return {
		relay: typeof relay === "string" ? relay : undefined,
		keepOn: s[KEYS.keepOn] === true,
		blurForms: s[KEYS.blurForms] === true,
		replaced: replacedOf(s[KEYS.replaced]),
		fillCode: s[KEYS.fillCode] === true,
	};
}

export async function saveReplaced(
	kv: Kv,
	replaced: Replaced | undefined,
): Promise<void> {
	if (replaced === undefined) await kv.remove(KEYS.replaced);
	else await kv.set({ [KEYS.replaced]: { sibling: replaced.sibling } });
}

/** The hosted relay's site, as "Allow on that site" asked for it in 0.3.0. */
const OLD_FILL_SITE = { origins: [`${new URL(DEFAULT_RELAY).origin}/*`] };

/**
 * Once, when "Fill in the code for me" was never stored (an installation
 * from before it, or a new one): it is stored off, and the relay's site that
 * 0.3.0's "Allow on that site" may have granted is given back, unless the
 * user gave access to all sites (DEC-044, after review). The setting is
 * written first, so this never runs again and never takes a grant the user
 * gives later (turning it on stores it on).
 */
export async function settleFillCode(
	kv: Kv,
	permissions: Pick<typeof chrome.permissions, "contains" | "remove">,
): Promise<void> {
	if ((await kv.get(KEYS.fillCode)) !== undefined) return;
	await kv.set({ [KEYS.fillCode]: false });
	if (await permissions.contains({ origins: ["<all_urls>"] })) return;
	if (await permissions.contains(OLD_FILL_SITE))
		await permissions.remove(OLD_FILL_SITE);
}
