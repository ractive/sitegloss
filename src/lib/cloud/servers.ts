/**
 * The servers Sitegloss can sign in to (DEC-041), in one place: the service
 * itself, its development server, and any other address the user types.
 * Everything else about a server is derived from its origin: where to sign
 * in (its discovery document, auth.ts), its API and its events stream.
 *
 * What the sync keeps (the account, the tokens, the team, how far its
 * changes were read, which mark here is which there, what waits to be sent)
 * is kept per server, so cases synced with the development server never
 * reach the service, and switching back finds things as they were
 * (`scopedKv`).
 */

import type { Kv } from "../kv.ts";

/** The service. What an ordinary user signs in to, without ever choosing. */
export const PRODUCTION_SERVER = "https://app.sitegloss.dev";

/**
 * The development server: the first address is the one the chooser sets;
 * all of them are named "Development server" (its host may still change).
 */
export const DEVELOPMENT_SERVERS: readonly string[] = [
	"https://app.dev.sitegloss.dev",
	"https://app-dev.sitegloss.dev",
];
export const DEVELOPMENT_SERVER = DEVELOPMENT_SERVERS[0] as string;

declare const SITEGLOSS_DEV_SERVER: boolean | undefined;

/**
 * Whether the server chooser offers the development server: the development
 * build and the test builds do, the builds that go to people (`--store`, and
 * whatever is packed with `--zip`, so the release's four) do not. The build's
 * define decides, as for the Firefox and the test build (`browser.ts`);
 * without it (the unit tests) it is offered. Only a signpost: the development
 * server creates no accounts for anybody (service DEC-044), and its address
 * typed under "Another address…" works as ever.
 */
export const DEV_SERVER_OFFERED: boolean =
	typeof SITEGLOSS_DEV_SERVER === "undefined" || SITEGLOSS_DEV_SERVER;

/** The server unless the user chose another. */
export const DEFAULT_SERVER = PRODUCTION_SERVER;

/** Hosts a server may have over plain http: one's own machine. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Why `value` is no server address, or `undefined`. */
export function serverProblem(value: string): string | undefined {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return "Not an address.";
	}
	if (url.protocol === "https:") return undefined;
	if (url.protocol !== "http:") return "Use an https: address.";
	return LOOPBACK.has(url.hostname)
		? undefined
		: "Plain http: works only for localhost; use https: for other hosts.";
}

/** A server address as it is kept: its origin. `undefined`: not one. */
export function serverOrigin(value: string): string | undefined {
	return serverProblem(value) === undefined ? new URL(value).origin : undefined;
}

/** Which of the chooser's three a server is. */
export type ServerKind = "production" | "development" | "other";

export function serverKind(server: string): ServerKind {
	if (server === PRODUCTION_SERVER) return "production";
	return DEVELOPMENT_SERVERS.includes(server) ? "development" : "other";
}

const hostOf = (server: string): string => {
	try {
		return new URL(server).host;
	} catch {
		return server;
	}
};

/** A server as the chooser names it. */
export function serverLabel(server: string): string {
	const kind = serverKind(server);
	if (kind === "production") return `Sitegloss (${hostOf(server)})`;
	return kind === "development" ? "Development server" : hostOf(server);
}

/**
 * What the Account section says beside the account whenever the server is
 * not the service, so nobody takes test data for real; `undefined` for the
 * service, which needs no word.
 */
export function serverNote(server: string): string | undefined {
	const kind = serverKind(server);
	if (kind === "production") return undefined;
	return kind === "development"
		? `Development server (${hostOf(server)}): not the real Sitegloss`
		: `Another server (${hostOf(server)}): not sitegloss.dev`;
}

/** The key the chosen server is kept under: the one thing not kept per server. */
export const SERVER_KEY = "server";

/** The server chosen, as the database has it; the service unless another was set. */
export async function chosenServer(kv: Kv): Promise<string> {
	const set = await kv.get(SERVER_KEY).catch(() => undefined);
	return (
		(typeof set === "string" ? serverOrigin(set) : undefined) ?? DEFAULT_SERVER
	);
}

/** What a server's entries start with in the cloud's database. */
export const scopeOf = (server: string) => `@${server} `;

/**
 * The part of the cloud's database that is one server's: every key is kept
 * under the server's origin, and nothing of another server is seen.
 */
export function scopedKv(kv: Kv, server: string): Kv {
	const prefix = scopeOf(server);
	return {
		get: (key) => kv.get(prefix + key),
		async all() {
			const mine: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(await kv.all()))
				if (key.startsWith(prefix)) mine[key.slice(prefix.length)] = value;
			return mine;
		},
		set: (entries) =>
			kv.set(
				Object.fromEntries(
					Object.entries(entries).map(([key, value]) => [prefix + key, value]),
				),
			),
		remove: (key) => kv.remove(prefix + key),
	};
}
