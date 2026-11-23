/**
 * A small Chrome DevTools Protocol driver for the end-to-end tests, after
 * tab-mcp's `test/cdp.ts`: launch Chromium with the unpacked extension, open
 * pages, evaluate, click and type. Uses Bun's WebSocket; no Playwright. Over
 * a pipe it can also load an extension and click its icon (`launchPiped`).
 *
 * Branded Google Chrome ignores `--load-extension` (since Chrome 137), so the
 * tests need Chrome for Testing or Chromium: `CHROME_PATH`, else Playwright's
 * download.
 */

import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";

/**
 * `SITEGLOSS_E2E_SLOW=<rate>`: every page and worker the tests attach to runs
 * its CPU that many times slower (CDP `Emulation.setCPUThrottlingRate`), as
 * a busy CI machine may; unset or 1, at full speed.
 */
export const SLOW = Math.max(1, Number(process.env["SITEGLOSS_E2E_SLOW"]) || 1);

/** Chrome for Testing or Chromium; `undefined` if there is none. */
export function findBrowser(): string | undefined {
	const fromEnv = process.env["CHROME_PATH"];
	if (fromEnv) return fromEnv;
	const caches = [
		join(homedir(), "Library/Caches/ms-playwright"),
		join(homedir(), ".cache/ms-playwright"),
	];
	const binaries = [
		"chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
		"chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
		"chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
		"chrome-mac/Chromium.app/Contents/MacOS/Chromium",
		"chrome-linux64/chrome",
		"chrome-linux/chrome",
	];
	for (const cache of caches) {
		let dirs: string[];
		try {
			dirs = readdirSync(cache)
				.filter((d) => /^chromium-\d+$/.test(d))
				.sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
		} catch {
			continue;
		}
		for (const dir of dirs) {
			for (const binary of binaries) {
				const path = join(cache, dir, binary);
				if (Bun.file(path).size > 0) return path;
			}
		}
	}
	return undefined;
}

/**
 * How long a CDP command, an attach included, or an event waited for has to
 * come, by default: 20 s, times `SLOW`. Chrome does not answer every
 * command: an input event it routed to a frame that is removed before the
 * frame took it gets no answer at all (an Escape whose keydown closes the
 * dialog its field's frame is in, and its keyup). Past this the command
 * fails and says which it was and where, well before the test's own time
 * runs out. A caller with a longer bound of its own passes it (`goto`).
 */
export const ANSWER_MS = 20_000 * SLOW;

type Pending = {
	resolve: (v: Record<string, unknown>) => void;
	reject: (e: Error) => void;
	method: string;
	timer: ReturnType<typeof setTimeout>;
};

type Listener = (
	method: string,
	params: Record<string, unknown>,
	sessionId?: string,
) => void;

/** How CDP messages get to Chrome; what comes back goes to `receive`. */
interface Transport {
	send(message: string): void;
	close(): void;
}

/** `closed` is called once Chrome's end is gone, with what happened. */
type Connect = (
	receive: (message: string) => void,
	closed: (why: string) => void,
) => Transport;

const webSocket =
	(ws: WebSocket): Connect =>
	(receive, closed) => {
		ws.addEventListener("message", (e) => receive(String(e.data)));
		ws.addEventListener("close", () => closed("the CDP connection closed"));
		return { send: (message) => ws.send(message), close: () => ws.close() };
	};

/** `--remote-debugging-pipe`: Chrome reads fd 3 and writes fd 4, each message ends in NUL. */
const pipe =
	(toChrome: number, fromChrome: number): Connect =>
	(receive, closed) => {
		const writer = Bun.file(toChrome).writer();
		void (async () => {
			const decoder = new TextDecoder();
			let text = "";
			for await (const chunk of Bun.file(fromChrome).stream()) {
				text += decoder.decode(chunk, { stream: true });
				const messages = text.split("\0");
				text = messages.pop() ?? "";
				for (const message of messages) receive(message);
			}
			closed("Chrome closed its CDP pipe");
		})();
		return {
			send(message) {
				writer.write(`${message}\0`);
				void writer.flush();
			},
			close: () => void writer.end(),
		};
	};

/**
 * A new profile. Its downloads go to `<profile>/Downloads` without asking, as
 * Chrome's own settings would send them (`Browser.downloads`); the
 * `downloads` API names its files only that way, not under CDP's
 * `Browser.setDownloadBehavior` "allow".
 */
export function newProfile(): string {
	const profile = mkdtempSync(join(tmpdir(), "sitegloss-chrome-"));
	mkdirSync(join(profile, "Default"));
	writeFileSync(
		join(profile, "Default", "Preferences"),
		JSON.stringify({
			download: {
				default_directory: join(profile, "Downloads"),
				prompt_for_download: false,
			},
		}),
	);
	return profile;
}

function chromeArguments(profile: string): string[] {
	return [
		"--headless=new",
		`--user-data-dir=${profile}`,
		"--no-first-run",
		"--no-default-browser-check",
		// No "Chromium Safe Storage" keychain prompt for a throwaway profile.
		"--use-mock-keychain",
		"--password-store=basic",
		"--disable-gpu",
		"--disable-background-networking",
		"--window-size=1280,800",
		// Headless Chrome's screen is 800×600 otherwise: no window could grow.
		"--screen-info={1920x1200}",
		// A plain http: host that is no secure context, as 127.0.0.1 is.
		"--host-resolver-rules=MAP sitegloss.test 127.0.0.1",
		...(process.platform === "linux" ? ["--no-sandbox"] : []),
	];
}

type ChromeProcess = Subprocess<"ignore", "ignore", "ignore" | "pipe">;

/**
 * Chromes still running, with their profiles. A run cut short (a timeout,
 * Ctrl-C, a closed terminal) never reaches close(); a Chrome left behind
 * under launchd keeps asking for the keychain.
 */
const running = new Map<ChromeProcess, string>();
function killRunning(): void {
	for (const [proc, profile] of running) {
		proc.kill("SIGKILL");
		try {
			rmSync(profile, { recursive: true, force: true });
		} catch {
			// Chrome may still be writing as it dies; a temp dir is left.
		}
	}
	running.clear();
}
process.on("exit", killRunning);
for (const [signal, code] of [
	["SIGHUP", 129],
	["SIGINT", 130],
	["SIGTERM", 143],
] as const)
	process.once(signal, () => {
		killRunning();
		process.exit(code);
	});

function started(proc: ChromeProcess, profile: string): ChromeProcess {
	running.set(proc, profile);
	void proc.exited.then(() => running.delete(proc));
	return proc;
}

/** Connect to a Chrome started with `--remote-debugging-port=0`. */
async function connectTo(
	proc: Subprocess<"ignore", "ignore", "pipe">,
): Promise<Connect> {
	const endpoint = await new Promise<string>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("Chrome did not start")),
			20_000,
		);
		void (async () => {
			const decoder = new TextDecoder();
			let text = "";
			for await (const chunk of proc.stderr) {
				text += decoder.decode(chunk, { stream: true });
				const m = /DevTools listening on (ws:\/\/\S+)/.exec(text);
				if (m?.[1] !== undefined) {
					clearTimeout(timer);
					resolve(m[1]);
					return;
				}
			}
			reject(new Error(`Chrome exited: ${text.slice(-500)}`));
		})();
	});
	const ws = new WebSocket(endpoint);
	await new Promise<void>((resolve, reject) => {
		// Within launch's own clean-up: a hang here would leave a Chrome behind.
		const timer = setTimeout(() => {
			ws.close();
			reject(new Error("CDP connection did not open"));
		}, 10_000);
		ws.addEventListener(
			"open",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
		ws.addEventListener(
			"error",
			() => {
				clearTimeout(timer);
				reject(new Error("CDP connection failed"));
			},
			{ once: true },
		);
	});
	return webSocket(ws);
}

interface TargetInfo {
	targetId: string;
	type: string;
	url: string;
}

/** What is at a point, and whether it is the element meant (or inside it). */
interface Hit {
	ok: boolean;
	at: string;
}

/** The element at a point, through open shadow roots, against `expression`'s. */
const hitTest = (expression: string, { x, y }: { x: number; y: number }) =>
	`(() => {
		const target = ${expression};
		let hit = document.elementFromPoint(${x}, ${y});
		while (hit?.shadowRoot) {
			const inner = hit.shadowRoot.elementFromPoint(${x}, ${y});
			if (inner === null || inner === hit) break;
			hit = inner;
		}
		const name = (e) => e === null ? "nothing" : e.tagName.toLowerCase() + (e.dataset?.action ? "[data-action=" + e.dataset.action + "]" : e.className && typeof e.className === "string" ? "." + e.className.split(" ").join(".") : "");
		const box = target.getBoundingClientRect();
		// Not laid out yet (hidden, not drawn): nothing to press.
		if (box.width === 0 && box.height === 0) return { ok: false, at: "the element without a box yet" };
		// A page element under Sitegloss's layer, which a tool puts over the
		// page on purpose: the press is for the layer.
		const through = target.getRootNode() === document && hit !== null && hit.getRootNode() !== document;
		return { ok: hit !== null && (hit === target || target.contains(hit) || through), at: name(hit) };
	})()`;

export class Browser {
	readonly #proc: ChromeProcess;
	readonly #profile: string;
	readonly #transport: Transport;
	readonly #pending = new Map<number, Pending>();
	readonly #listeners = new Set<Listener>();
	/** The target of each session `attach` opened. */
	readonly #sessions = new Map<string, string>();
	#nextId = 0;
	/** The profile outlives this browser (`launchIn`). */
	#keep = false;
	/** Why Chrome can answer no more (it exited, the connection closed). */
	#gone: string | undefined;
	/** The events `event` waits for, each failed by `#lost` with its reason. */
	readonly #awaited = new Set<(why: string) => void>();

	/** Where Chrome's own settings save downloads (see `newProfile`). */
	get downloads(): string {
		return join(this.#profile, "Downloads");
	}

	private constructor(proc: ChromeProcess, profile: string, connect: Connect) {
		this.#proc = proc;
		this.#profile = profile;
		this.#transport = connect(
			(message) => {
				const msg = JSON.parse(message) as {
					id?: number;
					result?: Record<string, unknown>;
					error?: { message: string };
					method?: string;
					params?: Record<string, unknown>;
					sessionId?: string;
				};
				if (msg.id !== undefined) {
					const p = this.#pending.get(msg.id);
					this.#pending.delete(msg.id);
					if (p !== undefined) clearTimeout(p.timer);
					if (msg.error) p?.reject(new Error(msg.error.message));
					else p?.resolve(msg.result ?? {});
				} else if (msg.method !== undefined) {
					for (const l of this.#listeners)
						l(msg.method, msg.params ?? {}, msg.sessionId);
				}
			},
			(why) => this.#lost(why),
		);
		void proc.exited.then((code) => this.#lost(`Chrome exited (${code})`));
	}

	/** Chrome is gone: every command still waiting fails now, and every later one at once. */
	#lost(why: string): void {
		if (this.#gone !== undefined) return;
		this.#gone = why;
		for (const p of this.#pending.values()) {
			clearTimeout(p.timer);
			p.reject(new Error(`CDP ${p.method}: ${why}`));
		}
		this.#pending.clear();
		for (const fail of this.#awaited) fail(why);
		this.#awaited.clear();
	}

	/** The target a session is on, as the failure of a command to it says it. */
	async #describe(sessionId: string | undefined): Promise<string> {
		if (sessionId === undefined) return "the browser";
		const targetId = this.#sessions.get(sessionId);
		if (targetId === undefined) return `session ${sessionId}`;
		if (this.#gone !== undefined) return `target ${targetId} (${this.#gone})`;
		const info = await this.#command(
			"Target.getTargets",
			{ filter: [{}] },
			undefined,
			2000,
		).then(
			(r) =>
				(r as { targetInfos: TargetInfo[] }).targetInfos.find(
					(t) => t.targetId === targetId,
				),
			() => undefined,
		);
		return info === undefined
			? `target ${targetId} (no longer there)`
			: `the ${info.type} ${info.url} (target ${targetId})`;
	}

	/**
	 * Launch on the profile in `profile` with the unpacked extension in
	 * `extensionDir`, and leave the profile where it is on close: for loading
	 * another build over the data an earlier one left (an upgrade). Chrome
	 * keeps running the worker script it cached for an extension of the same
	 * version until it is reloaded (chrome://extensions, `reloadExtension`).
	 */
	static async launchIn(
		binary: string,
		extensionDir: string,
		profile: string,
	): Promise<Browser> {
		// Killed with the tests, like any other (the profile then goes too).
		const proc = started(
			Bun.spawn(
				[
					binary,
					...chromeArguments(profile),
					"--remote-debugging-port=0",
					`--disable-extensions-except=${extensionDir}`,
					`--load-extension=${extensionDir}`,
					"about:blank",
				],
				{ stdin: "ignore", stdout: "ignore", stderr: "pipe" },
			),
			profile,
		);
		try {
			const browser = new Browser(proc, profile, await connectTo(proc));
			browser.#keep = true;
			return browser;
		} catch (e) {
			proc.kill("SIGKILL");
			await proc.exited;
			throw e;
		}
	}

	static async launch(binary: string, extensionDir: string): Promise<Browser> {
		const profile = newProfile();
		const proc = started(
			Bun.spawn(
				[
					binary,
					...chromeArguments(profile),
					"--remote-debugging-port=0",
					`--disable-extensions-except=${extensionDir}`,
					`--load-extension=${extensionDir}`,
					"about:blank",
				],
				{ stdin: "ignore", stdout: "ignore", stderr: "pipe" },
			),
			profile,
		);
		try {
			return new Browser(proc, profile, await connectTo(proc));
		} catch (e) {
			proc.kill("SIGKILL");
			await proc.exited;
			rmSync(profile, { recursive: true, force: true });
			throw e;
		}
	}

	/**
	 * Launch without an extension, over a pipe: only there does Chrome offer
	 * the `Extensions` domain, for `loadExtension` and `clickIcon`.
	 */
	static async launchPiped(binary: string): Promise<Browser> {
		const profile = newProfile();
		const proc = started(
			Bun.spawn(
				[
					binary,
					...chromeArguments(profile),
					"--remote-debugging-pipe",
					"--enable-unsafe-extension-debugging",
					"about:blank",
				],
				{ stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
			) as unknown as ChromeProcess,
			profile,
		);
		const [, , , toChrome, fromChrome] = proc.stdio as unknown as number[];
		return new Browser(
			proc,
			profile,
			pipe(toChrome as number, fromChrome as number),
		);
	}

	/**
	 * A CDP command; one with no answer within `timeoutMs` (`ANSWER_MS`)
	 * fails, naming it and its target, or that Chrome went meanwhile.
	 */
	send(
		method: string,
		params: Record<string, unknown> = {},
		sessionId?: string,
		timeoutMs = ANSWER_MS,
	): Promise<Record<string, unknown>> {
		return this.#command(method, params, sessionId, timeoutMs);
	}

	#command(
		method: string,
		params: Record<string, unknown>,
		sessionId: string | undefined,
		timeoutMs: number,
	): Promise<Record<string, unknown>> {
		if (this.#gone !== undefined)
			return Promise.reject(new Error(`CDP ${method}: ${this.#gone}`));
		const id = ++this.#nextId;
		const answer = new Promise<Record<string, unknown>>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				void this.#describe(sessionId).then((target) =>
					reject(
						new Error(
							// Chrome gone as it was asked about the target: that is the cause.
							this.#gone !== undefined
								? `CDP ${method}: ${this.#gone}`
								: `CDP ${method} to ${target} got no answer in ${timeoutMs} ms`,
						),
					),
				);
			}, timeoutMs);
			this.#pending.set(id, { resolve, reject, method, timer });
		});
		this.#transport.send(
			JSON.stringify({
				id,
				method,
				params,
				...(sessionId ? { sessionId } : {}),
			}),
		);
		return answer;
	}

	/**
	 * The next event `method` (optionally for one session), within
	 * `timeoutMs`; at once a failure when Chrome is gone, or goes meanwhile.
	 */
	async event(
		method: string,
		sessionId?: string,
		timeoutMs = ANSWER_MS,
	): Promise<Record<string, unknown>> {
		if (this.#gone !== undefined)
			throw new Error(`no CDP event ${method}: ${this.#gone}`);
		const next = this.waitForEvent(method, sessionId);
		let timer: ReturnType<typeof setTimeout> | undefined;
		let fail: ((why: string) => void) | undefined;
		try {
			return await Promise.race([
				next.promise,
				new Promise<never>((_, reject) => {
					fail = (why) => reject(new Error(`no CDP event ${method}: ${why}`));
					this.#awaited.add(fail);
					timer = setTimeout(
						() =>
							void this.#describe(sessionId).then((target) =>
								reject(
									new Error(
										this.#gone !== undefined
											? `no CDP event ${method}: ${this.#gone}`
											: `no CDP event ${method} from ${target} in ${timeoutMs} ms`,
									),
								),
							),
						timeoutMs,
					);
				}),
			]);
		} finally {
			clearTimeout(timer);
			if (fail !== undefined) this.#awaited.delete(fail);
			next.cancel();
		}
	}

	/** The next event `method`, and a way to stop waiting for it. */
	waitForEvent(
		method: string,
		sessionId?: string,
	): { promise: Promise<Record<string, unknown>>; cancel: () => void } {
		let listener: Listener | undefined;
		const promise = new Promise<Record<string, unknown>>((resolve) => {
			listener = (m, params, s) => {
				if (m === method && (sessionId === undefined || s === sessionId)) {
					if (listener) this.#listeners.delete(listener);
					resolve(params);
				}
			};
			this.#listeners.add(listener);
		});
		return {
			promise,
			cancel: () => {
				if (listener) this.#listeners.delete(listener);
			},
		};
	}

	/** Open `url` in a new tab. */
	async newPage(url = "about:blank"): Promise<Page> {
		const { targetId } = (await this.send("Target.createTarget", {
			url: "about:blank",
		})) as { targetId: string };
		const page = await this.attachPage(targetId);
		if (url !== "about:blank") await page.goto(url);
		return page;
	}

	/** A page that is there already, such as a side panel. */
	async attachPage(targetId: string): Promise<Page> {
		const page = await this.attach(targetId);
		await page.send("Page.enable");
		await page.send("Runtime.enable");
		return page;
	}

	/** A session on any target; on a service worker only `eval` makes sense. */
	async attach(targetId: string): Promise<Page> {
		const { sessionId } = (await this.send("Target.attachToTarget", {
			targetId,
			flatten: true,
		})) as { sessionId: string };
		this.#sessions.set(sessionId, targetId);
		const page = new Page(this, sessionId, targetId);
		if (SLOW > 1)
			// Not every target has the Emulation domain: as fast as it is then.
			await page
				.send("Emulation.setCPUThrottlingRate", { rate: SLOW })
				.catch(() => undefined);
		return page;
	}

	/** Every target; tabs are targets of their own, beside the page they show. */
	async targets(): Promise<TargetInfo[]> {
		const { targetInfos } = (await this.send("Target.getTargets", {
			filter: [{}],
		})) as { targetInfos: TargetInfo[] };
		return targetInfos;
	}

	/** The first target `matches` accepts, once there is one. */
	async waitForTarget(
		matches: (target: TargetInfo) => boolean,
		timeoutMs = 5000,
	): Promise<TargetInfo> {
		const end = Date.now() + timeoutMs;
		for (;;) {
			const target = (await this.targets()).find(matches);
			if (target !== undefined) return target;
			if (Date.now() > end) throw new Error("timed out waiting for a target");
			await Bun.sleep(50);
		}
	}

	/** Load an unpacked extension and return its id. */
	async loadExtension(path: string): Promise<string> {
		const { id } = (await this.send("Extensions.loadUnpacked", {
			path,
		})) as { id: string };
		return id;
	}

	/** Click the extension's icon on the tab showing `url`, with all a person's click grants. */
	async clickIcon(extensionId: string, url: string): Promise<void> {
		const tab = await this.waitForTarget(
			(t) => t.type === "tab" && t.url === url,
		);
		await this.send("Extensions.triggerAction", {
			id: extensionId,
			targetId: tab.targetId,
		});
	}

	async close(): Promise<void> {
		try {
			await Promise.race([this.send("Browser.close"), Bun.sleep(2000)]);
		} catch {
			// already gone
		}
		this.#transport.close();
		if (this.#proc.exitCode === null) this.#proc.kill("SIGKILL");
		await this.#proc.exited;
		if (!this.#keep) rmSync(this.#profile, { recursive: true, force: true });
	}
}

/** An exception thrown by an expression evaluated in the page. */
class PageError extends Error {}

export class Page {
	readonly #browser: Browser;
	readonly sessionId: string;
	readonly targetId: string;

	constructor(browser: Browser, sessionId: string, targetId: string) {
		this.#browser = browser;
		this.sessionId = sessionId;
		this.targetId = targetId;
	}

	/** A command to this page's session; `timeoutMs` as `Browser.send`'s. */
	send(
		method: string,
		params: Record<string, unknown> = {},
		timeoutMs?: number,
	): Promise<Record<string, unknown>> {
		return this.#browser.send(method, params, this.sessionId, timeoutMs);
	}

	/** The next event `method` of this page, within `timeoutMs`. */
	event(method: string, timeoutMs?: number): Promise<Record<string, unknown>> {
		return this.#browser.event(method, this.sessionId, timeoutMs);
	}

	async goto(url: string, timeoutMs = 15_000): Promise<void> {
		const loaded = this.#browser.waitForEvent(
			"Page.loadEventFired",
			this.sessionId,
		);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			// The navigation has the load's bound, where that is the longer.
			const { errorText } = (await this.send(
				"Page.navigate",
				{ url },
				Math.max(timeoutMs, ANSWER_MS),
			)) as {
				errorText?: string;
			};
			if (errorText) throw new Error(`cannot open ${url}: ${errorText}`);
			await Promise.race([
				loaded.promise,
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(new Error(`${url} did not load`)),
						timeoutMs,
					);
				}),
			]);
		} finally {
			clearTimeout(timer);
			loaded.cancel(); // a navigation that failed leaves no listener behind
		}
	}

	/** Bring the tab to the front (the "active tab" of its window). */
	async activate(): Promise<void> {
		await this.#browser.send("Target.activateTarget", {
			targetId: this.targetId,
		});
		await this.send("Page.bringToFront");
		// A screenshot of a tab that has not painted since waits for a frame that
		// may never come.
		await this.eval(
			"new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 1000); })",
		);
	}

	/** Evaluate an expression (awaiting promises) and return its JSON value. */
	async eval<T = unknown>(expression: string): Promise<T> {
		const r = (await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		})) as {
			result: { value?: T };
			exceptionDetails?: { exception?: { description?: string }; text: string };
		};
		if (r.exceptionDetails) {
			throw new PageError(
				r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
			);
		}
		return r.result.value as T;
	}

	/**
	 * Wait until `expression` is truthy. One that throws in the page (an element
	 * not rendered yet) is not yet true, and the last error is in the timeout's
	 * message; a syntax error or a lost connection fails at once.
	 */
	async waitFor(expression: string, timeoutMs = 5000): Promise<void> {
		const end = Date.now() + timeoutMs;
		let last = "";
		for (;;) {
			try {
				if (await this.eval<boolean>(`Boolean(${expression})`)) return;
				last = "";
			} catch (e) {
				if (!(e instanceof PageError) || e.message.startsWith("SyntaxError"))
					throw e;
				last = e.message;
			}
			if (Date.now() > end)
				throw new Error(
					`timed out waiting for ${expression}${last ? ` (last: ${last})` : ""}`,
				);
			await Bun.sleep(50);
		}
	}

	async mouse(
		type: "mouseMoved" | "mousePressed" | "mouseReleased",
		x: number,
		y: number,
	): Promise<void> {
		await this.send("Input.dispatchMouseEvent", {
			type,
			x,
			y,
			button: "left",
			buttons: type === "mouseReleased" ? 0 : 1,
			clickCount: type === "mouseMoved" ? 0 : 1,
		});
	}

	/** A real click at a point of the window. */
	async clickAt(x: number, y: number): Promise<void> {
		await this.mouse("mouseMoved", x, y);
		await this.mouse("mousePressed", x, y);
		await this.mouse("mouseReleased", x, y);
	}

	/** Press, move in steps and release: a drag from one point to another. */
	async drag(
		from: { x: number; y: number },
		to: { x: number; y: number },
		steps = 8,
	): Promise<void> {
		await this.mouse("mouseMoved", from.x, from.y);
		await this.mouse("mousePressed", from.x, from.y);
		for (let i = 1; i <= steps; i++) {
			await this.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: from.x + ((to.x - from.x) * i) / steps,
				y: from.y + ((to.y - from.y) * i) / steps,
				button: "left",
				buttons: 1,
			});
		}
		await this.mouse("mouseReleased", to.x, to.y);
	}

	/** The centre of the element an expression returns, in window coordinates. */
	async centreOf(expression: string): Promise<{ x: number; y: number }> {
		return this.eval<{ x: number; y: number }>(
			`(() => { const e = ${expression}; e.scrollIntoView?.({ block: "nearest" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
		);
	}

	/** Click the element an expression returns (also inside a shadow root). */
	async click(expression: string): Promise<void> {
		// Sent at once, a click lands on what was at that spot before a scroll or a
		// late list moved it: wait until the element has stayed put for two frames,
		// and until it is what is at that spot (not covered, not moved away by a
		// layout of its own), then press. What was there instead is said.
		let at = await this.centreOf(expression);
		let hit: Hit = { ok: false, at: "" };
		for (let tries = 0; tries < 40; tries++) {
			await this.eval(
				"new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 200); })",
			);
			const now = await this.centreOf(expression);
			const stayed = now.x === at.x && now.y === at.y;
			at = now;
			if (!stayed) continue;
			hit = await this.eval<Hit>(hitTest(expression, at));
			if (hit.ok) break;
		}
		if (!hit.ok)
			throw new Error(
				`click: at (${Math.round(at.x)}, ${Math.round(at.y)}) is ${hit.at}, not ${expression}`,
			);
		await this.clickAt(at.x, at.y);
	}

	/** Type text into the focused element. */
	async type(text: string): Promise<void> {
		await this.send("Input.insertText", { text });
	}
}
