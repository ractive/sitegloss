/**
 * What the service worker refuses: a screenshot of a tab that left the front
 * (it would show another tab), and a screenshot of another tab than the one
 * asking.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Page } from "./browser.ts";
import {
	browserBinary,
	type Harness,
	inFullSet,
	startHarness,
} from "./harness.ts";
import { testWaits, worker } from "./steps.ts";

interface Capture {
	ok: boolean;
	error?: string;
	width?: number;
}

inFullSet("the worker refuses", () => {
	let h: Harness;
	let serviceWorker: Page;
	let a: { page: Page; tabId: number };
	let b: { page: Page; tabId: number };

	/** The page's own screenshot of a mark, which the worker takes (DEC-012). */
	const capture = (tabId: number) =>
		h.control.eval<Capture>(
			`chrome.scripting.executeScript({
				target: { tabId: ${tabId} },
				func: () => chrome.runtime.sendMessage({ type: "capture", caseId: "c_refusals", shotId: "s1" }),
			}).then(([injected]) => injected.result)`,
		);
	const captures = () => serviceWorker.eval<number>("globalThis.captures");

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
		a = await h.open("v1");
		b = await h.open("v2");
		serviceWorker = await worker(h);
		// Counts the real captures; `duringCapture` runs while one is under way.
		await serviceWorker.eval(`(() => {
			const real = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
			globalThis.captures = 0;
			chrome.tabs.captureVisibleTab = async (...args) => {
				globalThis.captures++;
				const image = await real(...args);
				await globalThis.duringCapture?.();
				return image;
			};
		})()`);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	test("nothing while the tab is in front", async () => {
		await a.page.activate();
		const answer = await capture(a.tabId);
		expect(answer.error).toBeUndefined();
		expect(answer.width).toBeGreaterThan(0);
		expect(await captures()).toBe(1);
	});

	test("a tab that left the front before the capture, and takes no picture", async () => {
		await a.page.activate();
		await b.page.activate();
		const before = await captures();
		const answer = await capture(a.tabId);
		expect(answer.ok).toBe(false);
		expect(answer.error).toContain("no longer in front");
		expect(await captures()).toBe(before);
	});

	test("a tab that left the front during the capture", async () => {
		await a.page.activate();
		await serviceWorker.eval(
			`globalThis.duringCapture = () => chrome.tabs.update(${b.tabId}, { active: true })`,
		);
		const before = await captures();
		const answer = await capture(a.tabId);
		await serviceWorker.eval("globalThis.duringCapture = undefined");
		expect(await captures()).toBe(before + 1);
		expect(answer.ok).toBe(false);
		expect(answer.error).toContain("no longer in front");
		expect(answer.width).toBeUndefined();
	});

	test("a capture Chrome never answers, and the queue goes on", async () => {
		await a.page.activate();
		await serviceWorker.eval(
			"globalThis.duringCapture = () => new Promise(() => {})",
		);
		// Not the 8 s a real capture gets: this one is given up on sooner.
		await testWaits(serviceWorker, { captureMs: 500 });
		const stuck = await capture(a.tabId);
		await serviceWorker.eval("globalThis.duringCapture = undefined");
		await testWaits(serviceWorker, {});
		expect(stuck.error).toContain("did not deliver");
		expect((await capture(a.tabId)).ok).toBe(true);
	}, 20_000);

	test("ids that are no ids", async () => {
		const send = (message: object) =>
			h.control.eval<{ ok: boolean; error?: string }>(
				`chrome.runtime.sendMessage(${JSON.stringify(message)})`,
			);
		expect(
			await send({ type: "images:discard", caseId: "../x", shotIds: [] }),
		).toEqual({ ok: false, error: "invalid id" });
		expect(
			await send({
				type: "case:save",
				request: {
					caseId: "c_1",
					imagesFrom: "../x",
					shots: [],
					marks: [],
				},
			}),
		).toEqual({ ok: false, error: "invalid id" });
	});

	test("the account and the tokens are asked for by a page of the extension only, never by a content script (DEC-039)", async () => {
		await a.page.activate();
		// As a content script would: a message from a web page's tab.
		const fromPage = (message: object) =>
			h.control.eval<unknown>(
				`chrome.scripting.executeScript({
					target: { tabId: ${a.tabId} },
					func: (m) => chrome.runtime.sendMessage(m).then((answer) => answer ?? null, (e) => "error: " + e.message),
					args: [${JSON.stringify(message)}],
				}).then(([injected]) => injected.result)`,
			);
		// The same messages from the extension's own page get an answer.
		const fromExtension = (message: object) =>
			h.control.eval<{ ok: boolean; error?: string }>(
				`chrome.runtime.sendMessage(${JSON.stringify(message)})`,
			);
		const token = {
			type: "cloud:token",
			server: "https://app.sitegloss.dev",
			teamId: "t",
		};
		for (const message of [
			token,
			{ type: "cloud:begin" },
			{ type: "cloud:sign-out" },
			{ type: "cloud:server", server: "https://evil.example" },
			{ type: "cloud:decide", share: true },
			{ type: "cloud:share", caseId: "c_1" },
			// A page must not end somebody's sign-in.
			{ type: "cloud:abandon", url: "https://app.sitegloss.dev/?state=x" },
			{ type: "cloud:finish", redirect: "https://x.chromiumapp.org/?code=c" },
			{ type: "cloud:team", teamId: "t" },
			{ type: "cloud:run", retry: true },
		])
			expect(await fromPage(message)).toBeNull();
		expect(await fromExtension(token)).toEqual({
			ok: false,
			error: "Not signed in.",
		});
		expect(
			await fromExtension({
				type: "cloud:abandon",
				url: "https://app.sitegloss.dev/?state=x",
			}),
		).toEqual({ ok: true });
		// Nothing a content script asked for happened: the server is still the service.
		const chosen = await serviceWorker.eval<unknown>(
			`new Promise((done) => { const open = indexedDB.open("sitegloss-cloud"); open.onsuccess = () => { const db = open.result; const names = [...db.objectStoreNames]; if (names.length === 0) return done(null); const all = db.transaction(names[0]).objectStore(names[0]).getAll(); all.onsuccess = () => done(JSON.stringify(all.result)); all.onerror = () => done("error"); }; open.onerror = () => done("error"); })`,
		);
		expect(String(chosen)).not.toContain("evil.example");
	});
});
