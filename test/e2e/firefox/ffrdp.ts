/**
 * Firefox for the Firefox end-to-end tests, driven through the `ff-rdp` CLI
 * (https://github.com/ractive/ff-rdp): every call is one ff-rdp command on
 * this run's own debug port, which connects, does its work and disconnects.
 *
 * `FF_RDP_PATH` names the ff-rdp binary, else it is looked up on the PATH.
 * `FIREFOX_PATH` names Firefox; ff-rdp finds Firefox by itself (on macOS in
 * /Applications first, elsewhere on the PATH), so on Linux the folder of
 * `FIREFOX_PATH` goes first on ff-rdp's PATH, and the binary must be called
 * `firefox` (as in Mozilla's archives).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The ff-rdp binary: `FF_RDP_PATH`, else on the PATH. */
export function findFfRdp(): string | undefined {
	const fromEnv = process.env["FF_RDP_PATH"];
	if (fromEnv) return fromEnv;
	return Bun.which("ff-rdp") ?? undefined;
}

/** Firefox: `FIREFOX_PATH`, else where ff-rdp looks for it. */
export function findFirefox(): string | undefined {
	const fromEnv = process.env["FIREFOX_PATH"];
	if (fromEnv) return Bun.file(fromEnv).size > 0 ? fromEnv : undefined;
	const mac = "/Applications/Firefox.app/Contents/MacOS/firefox";
	if (process.platform === "darwin" && Bun.file(mac).size > 0) return mac;
	return Bun.which("firefox") ?? Bun.which("firefox-esr") ?? undefined;
}

/** The environment ff-rdp runs in: `FIREFOX_PATH`'s folder first on the PATH. */
export function ffRdpEnv(
	env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
	const firefox = env["FIREFOX_PATH"];
	if (!firefox) return env;
	return { ...env, PATH: `${dirname(firefox)}:${env["PATH"] ?? ""}` };
}

/** A port nothing listens on now, for Firefox's debug server. */
export function freePort(): number {
	const server = Bun.listen({
		hostname: "127.0.0.1",
		port: 0,
		socket: { data() {} },
	});
	const { port } = server;
	server.stop(true);
	return port;
}

/** What ff-rdp said when a command failed. */
export class FfRdpError extends Error {}

/** One Firefox, reached through ff-rdp on `port`. */
export class FfRdp {
	constructor(
		readonly binary: string,
		readonly port: number,
	) {}

	/**
	 * Run `ff-rdp --port <port> <args>`; resolves with its JSON's `results`.
	 * `input` goes to its stdin (`eval --stdin`).
	 */
	async run(
		args: string[],
		options: { input?: string; timeoutMs?: number } = {},
	): Promise<unknown> {
		const timeout = options.timeoutMs ?? 20_000;
		const proc = Bun.spawn(
			[
				this.binary,
				"--port",
				String(this.port),
				"--timeout",
				String(timeout),
				...args,
			],
			{
				stdin: options.input === undefined ? "ignore" : "pipe",
				stdout: "pipe",
				stderr: "pipe",
				env: ffRdpEnv(),
			},
		);
		if (options.input !== undefined && proc.stdin) {
			proc.stdin.write(options.input);
			await proc.stdin.end();
		}
		const killer = setTimeout(() => proc.kill(), timeout + 15_000);
		const [out, err, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]).finally(() => clearTimeout(killer));
		let parsed: { results?: unknown; error?: string } | undefined;
		try {
			parsed = JSON.parse(out) as { results?: unknown; error?: string };
		} catch {
			parsed = undefined;
		}
		if (code !== 0 || parsed === undefined || parsed.error !== undefined)
			throw new FfRdpError(
				`ff-rdp ${args.slice(0, 3).join(" ")}: ${parsed?.error ?? (out.trim() || err.trim() || `exit ${code}`)}`,
			);
		return parsed.results;
	}

	/**
	 * The value of `expression` in tab `tab` (a URL substring), awaited and
	 * passed as JSON; a throw or rejection there throws here.
	 */
	async eval<T>(tab: string, expression: string): Promise<T> {
		const text = await this.run(["--tab", tab, "eval", "--stdin"], {
			input: `JSON.stringify((await (async () => (${expression}))()) ?? null)`,
		});
		return JSON.parse(String(text)) as T;
	}

	/**
	 * The value of `expression` inside the first frame of tab `tab` whose
	 * address contains `frame` (cross-origin too: the extension's own frame
	 * on a page, DEC-064).
	 */
	async evalInFrame<T>(
		tab: string,
		frame: string,
		expression: string,
	): Promise<T> {
		const text = await this.run(
			["--tab", tab, "eval", "--frame", frame, "--stdin"],
			{
				input: `JSON.stringify((await (async () => (${expression}))()) ?? null)`,
			},
		);
		return JSON.parse(String(text)) as T;
	}

	/**
	 * Until `expression` in `tab` is truthy (and not an error): its value.
	 * `what` names it in the timeout's message.
	 */
	async waitFor<T>(
		tab: string,
		expression: string,
		what: string,
		timeoutMs = 15_000,
	): Promise<T> {
		const end = Date.now() + timeoutMs;
		let last: unknown;
		for (;;) {
			try {
				const value = await this.eval<T>(tab, expression);
				if (value) return value;
				last = value;
			} catch (error) {
				last = error instanceof Error ? error.message : error;
			}
			if (Date.now() > end)
				throw new Error(
					`timed out after ${timeoutMs} ms waiting for ${what} (last: ${JSON.stringify(last)})`,
				);
			await Bun.sleep(200);
		}
	}

	/** Stop the Firefox ff-rdp started on this port; nothing if none runs. */
	async stop(): Promise<void> {
		await this.run(["stop"], { timeoutMs: 10_000 }).catch(() => undefined);
	}
}

/**
 * Take the Firefox tests' lock: one run at a time on this machine, whoever
 * comes first (a lock directory with the holder's pid; one whose holder is
 * gone is taken over). Resolves with the function that gives it back.
 */
export async function takeLock(waitMs: number): Promise<() => void> {
	const dir = join(tmpdir(), "sitegloss-firefox-e2e.lock");
	const pidFile = join(dir, "pid");
	const end = Date.now() + waitMs;
	for (;;) {
		try {
			mkdirSync(dir);
			writeFileSync(pidFile, String(process.pid));
			return () => rmSync(dir, { recursive: true, force: true });
		} catch {
			let holder = 0;
			try {
				holder = Number(readFileSync(pidFile, "utf8"));
			} catch {
				// Being written, or just given back: try again.
			}
			if (holder > 0 && !alive(holder))
				rmSync(dir, { recursive: true, force: true });
			else if (Date.now() > end)
				throw new Error(`the Firefox tests' lock ${dir} stayed held`);
			else await Bun.sleep(500);
		}
	}
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
