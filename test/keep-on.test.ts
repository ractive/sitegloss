import { beforeEach, describe, expect, test } from "bun:test";
import type {
	ConnectionState,
	ConnectOptions,
	DisconnectReason,
	StateChangeDetail,
} from "@ractive-ch/tab-mcp-client";
import { KeepOn, type KeptConnection } from "../src/worker/keep-on.ts";

/**
 * What `TabMcp` 0.16 does for `KeepOn`, with connects that fail on demand:
 * every change of state is a `statechange` with the reason where the library
 * gives one (`client.test.ts` checks these against the library itself).
 * Nothing else is sent, so a listener for an event the library no longer
 * has (`connected`, `disconnected`, `reconnecting`) hears nothing here either.
 */
class FakeConnection extends EventTarget implements KeptConnection {
	state: KeptConnection["state"] = "disconnected";
	/** The errors of the next connects; none left: it works. */
	errors: Error[] = [];
	calls: ConnectOptions[] = [];
	async connect(options: ConnectOptions = {}) {
		this.calls.push(options);
		this.set("connecting");
		await Bun.sleep(0);
		const error = this.errors.shift();
		if (error !== undefined) {
			this.set("disconnected");
			throw error;
		}
		this.set("connected");
		return {} as Awaited<ReturnType<KeptConnection["connect"]>>;
	}
	set(state: ConnectionState, reason?: DisconnectReason) {
		this.state = state;
		this.dispatchEvent(
			new CustomEvent<StateChangeDetail>("statechange", {
				detail: reason === undefined ? { state } : { state, reason },
			}),
		);
	}
	end(reason: DisconnectReason) {
		this.set("disconnected", reason);
	}
	/** The relay refused an attempt while reconnecting: `error` first, already `disconnected`. */
	refuse(error: Error) {
		this.state = "disconnected";
		this.dispatchEvent(new CustomEvent("error", { detail: { error } }));
		this.set("disconnected");
	}
}

let wanted: boolean;
let changes: number;
/** What KeepOn said at each change: its problem and whether a try waits. */
let seen: { problem: string | undefined; retrying: boolean }[];
let connection: FakeConnection;
let keep: KeepOn;

/** A KeepOn that waits `delaysMs` between tries, watching `connection`. */
function keepOn(delaysMs: number[]): KeepOn {
	const kept = new KeepOn(
		() => wanted,
		() => {
			changes++;
			seen.push({ problem: kept.problem, retrying: kept.retrying });
		},
		delaysMs,
	);
	kept.watch(connection);
	return kept;
}

/**
 * Until `done` holds, two seconds at most: what a test waits for is a state,
 * not a number of turns of the event loop a promise chain happens to take.
 */
async function until(done: () => boolean): Promise<void> {
	for (let i = 0; i < 2000 && !done(); i++) await Bun.sleep(1);
	expect(done()).toBe(true);
}

beforeEach(() => {
	wanted = true;
	changes = 0;
	seen = [];
	connection = new FakeConnection();
	keep = keepOn([1, 2]);
});

describe("KeepOn", () => {
	test("connects without a click, and only while wanted", async () => {
		wanted = false;
		keep.connect();
		expect(connection.calls).toEqual([]);
		wanted = true;
		keep.connect();
		expect(connection.calls).toEqual([{ resume: true }]);
	});

	test.each(["idle", "expired"] as const)(
		"connects again after a session ended as %s",
		(reason) => {
			connection.state = "connected";
			connection.end(reason);
			expect(connection.calls).toEqual([{ resume: true }]);
		},
	);

	test("stays off after an idle session when no longer wanted", () => {
		wanted = false;
		connection.state = "connected";
		connection.end("idle");
		expect(connection.calls).toEqual([]);
	});

	test.each(["user", "replaced", "disconnect_all"] as const)(
		"leaves a session that ended as %s alone",
		(reason) => {
			connection.state = "connected";
			connection.end(reason);
			expect(connection.calls).toEqual([]);
			expect(keep.problem).toBeUndefined();
			expect(keep.retrying).toBe(false);
		},
	);

	test.each([
		[
			"rate_limited",
			"The relay ended the connection: Sitegloss sent it too many messages at once.",
		],
		[
			"too_large",
			"The relay ended the connection: a message was too large for it.",
		],
		["policy", "The relay ended the connection: it refused a message."],
		["closed", "The relay closed the connection."],
		// Only without the library's reconnecting, which Sitegloss leaves on.
		["shutdown", "The relay shut down."],
		["heartbeat", "The relay stopped answering."],
		["network", "The network connection to the relay broke."],
	] as const)(
		"a session the relay ended as %s: says why and tries again later",
		async (reason, why) => {
			connection.state = "connected";
			connection.end(reason);
			// Not at once: a relay that ends every session gets no tight loop.
			expect(connection.calls).toEqual([]);
			expect(keep.problem).toBe(why);
			expect(keep.retrying).toBe(true);
			while (connection.state !== "connected") await Bun.sleep(1);
			expect(keep.problem).toBeUndefined();
		},
	);

	test("not wanted, a session the relay ended still says why, and stays off", async () => {
		wanted = false;
		connection.state = "connected";
		connection.end("rate_limited");
		expect(keep.problem).toBe(
			"The relay ended the connection: Sitegloss sent it too many messages at once.",
		);
		expect(keep.retrying).toBe(false);
		await Bun.sleep(10);
		expect(connection.calls).toEqual([]);
	});

	test("says why a connect failed and tries again until it works", async () => {
		connection.errors = [new Error("relay down"), new Error("still down")];
		keep.connect();
		await until(() => connection.state === "connected");
		await until(() => keep.problem === undefined);
		// As each try failed it said why, with the next one waiting.
		expect(seen.filter((s) => s.problem !== undefined)).toEqual([
			{ problem: "relay down", retrying: true },
			{ problem: "still down", retrying: true },
		]);
		expect(connection.calls).toHaveLength(3);
		expect(keep.problem).toBeUndefined();
		expect(keep.retrying).toBe(false);
		expect(changes).toBeGreaterThan(0);
	});

	test("the last wait repeats", async () => {
		connection.errors = Array.from({ length: 5 }, () => new Error("down"));
		keep.connect();
		while (connection.state !== "connected") await Bun.sleep(1);
		expect(connection.calls).toHaveLength(6);
	});

	test("no longer wanted: the next try does not happen", async () => {
		// A wait long enough to change one's mind in.
		keep = keepOn([50]);
		connection.errors = [new Error("relay down")];
		keep.connect();
		await until(() => keep.retrying);
		wanted = false;
		await Bun.sleep(80);
		expect(connection.calls).toHaveLength(1);
	});

	test("stop drops the waiting try, the reason, and a try on its way", async () => {
		keep = keepOn([50]);
		connection.errors = [new Error("relay down")];
		keep.connect();
		await until(() => keep.retrying);
		keep.stop();
		expect(keep.problem).toBeUndefined();
		expect(keep.retrying).toBe(false);
		await Bun.sleep(10);
		expect(connection.calls).toHaveLength(1);

		connection.errors = [new DOMException("cancelled", "AbortError")];
		keep.connect();
		keep.stop();
		await Bun.sleep(10);
		expect(keep.problem).toBeUndefined();
		expect(keep.retrying).toBe(false);
	});

	test("does not take the address back from a tab that took it over", async () => {
		connection.errors = [
			Object.assign(new Error("taken over"), { reason: "replaced" }),
		];
		keep.connect();
		await until(() => keep.problem !== undefined);
		// And no try after it.
		await Bun.sleep(10);
		expect(keep.problem).toBe("taken over");
		expect(keep.retrying).toBe(false);
		expect(connection.calls).toHaveLength(1);
	});

	test("takes over when the library gave up reconnecting", async () => {
		connection.set("connected");
		connection.set("reconnecting", "network");
		connection.refuse(new Error("refused"));
		expect(keep.problem).toBe("refused");
		expect(keep.retrying).toBe(true);
		while (connection.state !== "connected") await Bun.sleep(1);
		expect(connection.calls).toEqual([{ resume: true }]);
	});

	test("an error while connected is no failed connect", () => {
		connection.state = "connected";
		connection.dispatchEvent(
			new CustomEvent("error", { detail: { error: new Error("oops") } }),
		);
		expect(keep.problem).toBeUndefined();
		expect(keep.retrying).toBe(false);
	});

	test("leaves connecting to the library while it reconnects", () => {
		connection.set("connected");
		// The connection broke; the library schedules attempt 1, then 2.
		connection.set("reconnecting", "network");
		connection.set("reconnecting");
		keep.connect();
		expect(connection.calls).toEqual([]);
		expect(keep.retrying).toBe(false);
	});

	test("a connect the panel started failing counts as well", async () => {
		keep.failed(new Error("no relay"));
		expect(keep.problem).toBe("no relay");
		while (connection.state !== "connected") await Bun.sleep(1);
	});

	test("a new connection takes over from the one before", async () => {
		const old = connection;
		old.errors = [new Error("relay down")];
		keep.connect();
		connection = new FakeConnection();
		keep.watch(connection);
		await Bun.sleep(10);
		expect(keep.problem).toBeUndefined();
		expect(old.calls).toHaveLength(1);
		old.state = "connected";
		old.end("idle");
		expect(old.calls).toHaveLength(1);
	});
});
