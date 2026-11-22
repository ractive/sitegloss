/**
 * End to end: Always allow and Allow all changes (DEC-018). Always allow in
 * a question lets that tool of that AI app run without asking, and no other;
 * Allow all changes in the AI app card lets every tool through; Ask again
 * takes a tool back; the notification's Always allow counts too; it survives
 * a worker restart; a Disconnect the relay cannot save says so and keeps
 * it; Disconnect forgets it.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Client } from "@modelcontextprotocol/client";
import {
	MemoryTokenStore,
	type RevokeOptions,
	type RevokeSelector,
} from "@ractive-ch/tab-mcp";
import { startTestRelay } from "@ractive-ch/tab-mcp/testing";
import type { Case } from "../../src/lib/case.ts";
import { sampleCase } from "../fixtures.ts";
import {
	answerInPanel,
	byId,
	clickNotification,
	closeSidePanel,
	connectAi,
	mcpClient,
	newNotification,
	notifications,
	openSidePanel,
} from "./ai.ts";
import type { Page } from "./browser.ts";
import {
	browserBinary,
	type Harness,
	inFullSet,
	PAST_GUARD_MS,
	startHarness,
} from "./harness.ts";
import { putCases, READ_DB, settingsOf, until, worker } from "./steps.ts";
import { step } from "./trace.ts";

interface CallResult {
	isError?: boolean;
	content: { type: string; text?: string }[];
}

const caseIds = async (h: Harness) =>
	(await h.control.eval<{ cases: Case[] }>(READ_DB)).cases.map((c) => c.id);

/** A memory store whose revocations fail while `failing`, as a store that is down. */
class FlakyStore extends MemoryTokenStore {
	failing = false;
	override revoke(selector: RevokeSelector, options: RevokeOptions) {
		if (this.failing) return Promise.reject(new Error("store down"));
		return super.revoke(selector, options);
	}
}

const QUESTION = `document.querySelector("[data-question]")`;
/** The time after the questions' dialog in which "Allow all changes" turns nothing on is over. */
const QUIET_OVER = `!document.body.hasAttribute("data-quiet")`;
const GRANT = `document.querySelector("#pair-grants li[data-grant]")`;

inFullSet(
	"Always allow, per tool or for all, until the AI app is disconnected",
	() => {
		let h: Harness;
		let panel: Page;
		let client: Client;
		let address: string;
		let tab: { page: Page; tabId: number };
		const store = new FlakyStore();
		const relay = startTestRelay({ store });

		const call = (name: string, args: Record<string, unknown> = {}) =>
			client.callTool({ name, arguments: args }) as Promise<CallResult>;
		/** A call that must run without a question in the panel. */
		const runs = async (name: string, args: Record<string, unknown>) => {
			const result = await call(name, args);
			expect(result.isError).toBeFalsy();
			expect(await panel.eval(`!${QUESTION}`)).toBe(true);
		};
		/** A call that must ask: answered in the panel with `answer`. */
		const asks = async (
			name: string,
			args: Record<string, unknown>,
			answer: "allow" | "deny" | "always",
		) => {
			const result = call(name, args);
			await panel.waitFor(QUESTION, 10_000);
			await answerInPanel(panel, answer);
			await panel.waitFor(`!${QUESTION}`);
			return result;
		};
		/**
		 * What the library keeps for the apps (DEC-043), beside the secret in
		 * the worker's settings database, by grant: `undefined` for nothing.
		 * Sitegloss's own store from before is never there.
		 */
		const kept = async () => {
			const settings = await settingsOf(h);
			expect(settings["alwaysAllowed"]).toBeUndefined();
			const text = settings[`tab-mcp:secret:${relay.url}:sitegloss#allowed`];
			if (typeof text !== "string") return undefined;
			const { grants } = JSON.parse(text) as {
				grants: {
					grantId: string;
					everything: boolean;
					tools: { name: string }[];
				}[];
			};
			const out: Record<string, { all: boolean; tools: string[] }> = {};
			for (const g of grants)
				if (g.everything || g.tools.length > 0)
					out[g.grantId] = {
						all: g.everything,
						tools: g.tools.map((t) => t.name),
					};
			return Object.keys(out).length > 0 ? out : undefined;
		};

		/**
		 * A new AI app paired with the address. The test token comes straight
		 * from the relay's store, which tells no session: connecting again makes
		 * the relay list it, as pairing would.
		 */
		const pairApp = async () => {
			client = await mcpClient(relay, address);
			await panel.eval(`${byId("stop-ai")}.click()`);
			await panel.waitFor(
				`document.documentElement.dataset.aiState === "disconnected"`,
				10_000,
			);
			await panel.eval(`${byId("connect")}.click()`);
			await panel.waitFor(GRANT, 10_000);
		};

		beforeAll(async () => {
			h = await startHarness(browserBinary as string);
			await putCases(h, [
				sampleCase("c_1"),
				sampleCase("c_2"),
				sampleCase("c_3"),
			]);
			tab = await h.open("v1");
			await step("bring the page to the front", () => tab.page.activate());
			panel = await openSidePanel(h);
			address = await connectAi(panel, relay.url);
			await pairApp();
		}, 60_000);

		afterAll(async () => {
			await client?.close();
			await h?.stop();
			await relay.stop();
		});

		test("the question explains Always allow, which arms with Allow", async () => {
			const result = call("set_summary", { caseId: "c_1", summary: "One" });
			// Neither yes counts the moment the question shows (the test build's
			// wait is short): read in the page as it appears.
			expect(
				await panel.eval<boolean>(`new Promise((resolve) => {
					const timer = setInterval(() => {
						const always = ${QUESTION}?.querySelector('button[data-answer="always"]');
						if (!always) return;
						clearInterval(timer);
						resolve(always.disabled);
					}, 5);
				})`),
			).toBe(true);
			await panel.waitFor(QUESTION, 10_000);
			// In a modal dialog (DEC-037): over the panel wherever it is scrolled
			// to, and Escape does not close it. Its buttons look alike, the
			// arguments have the focus, and it says how long it waits.
			const dialog = `document.getElementById("questions")`;
			expect(await panel.eval(`${dialog}.matches("dialog:modal")`)).toBe(true);
			// The key and the close request are both stopped (false: prevented)...
			expect(
				await panel.eval(
					`${dialog}.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))`,
				),
			).toBe(false);
			expect(
				await panel.eval(
					`${dialog}.dispatchEvent(new Event("cancel", { cancelable: true }))`,
				),
			).toBe(false);
			// ...a real Escape, twice (the second is the one a close watcher may
			// not let be stopped), leaves it open...
			for (let i = 0; i < 2; i++)
				for (const type of ["keyDown", "keyUp"])
					await panel.send("Input.dispatchKeyEvent", {
						type,
						key: "Escape",
						code: "Escape",
						windowsVirtualKeyCode: 27,
					});
			await panel.waitFor(`${dialog}.matches("dialog:modal")`);
			// ...and one closed while its question waits opens again.
			await panel.eval(`${dialog}.close()`);
			await panel.waitFor(`${dialog}.matches("dialog:modal")`);
			// Who asks for what describes it; the arguments are a named group.
			expect(
				await panel.eval<string>(
					`document.getElementById(${dialog}.getAttribute("aria-describedby")).textContent`,
				),
			).toBe(
				"Test client (client.example) wants to run Record the summary for the developer.",
			);
			expect(
				await panel.eval<string>(
					`${QUESTION}.querySelector("pre").getAttribute("role")`,
				),
			).toBe("group");
			expect(
				await panel.eval<string[]>(
					`[...${QUESTION}.querySelectorAll("button[data-answer]")].map((b) => b.className)`,
				),
			).toEqual(["", "", ""]);
			expect(
				await panel.eval(
					`document.activeElement === ${QUESTION}.querySelector("pre")`,
				),
			).toBe(true);
			expect(
				await panel.eval<string>(
					`${QUESTION}.querySelector(".countdown").textContent`,
				),
			).toMatch(/^(5\d|60) s left to answer; no answer is Don't allow\.$/);
			expect(await panel.eval<string>(`${QUESTION}.textContent`)).toContain(
				"Always allow: Record the summary for the developer runs without asking for Test client (client.example), until you disconnect it or an update of Sitegloss changes this tool.",
			);
			await answerInPanel(panel, "allow");
			expect((await result).isError).toBeFalsy();
			// It closes with its last question.
			await panel.waitFor(`!${dialog}.open`);
		});

		test("Always allow skips the next question of that tool for that app, not of another tool; Ask again in the card takes it back", async () => {
			expect(
				(await asks("set_summary", { caseId: "c_1", summary: "Two" }, "always"))
					.isError,
			).toBeFalsy();
			await runs("set_summary", { caseId: "c_1", summary: "Three" });
			// Another tool still asks.
			expect(
				(await asks("delete_case", { caseId: "c_2" }, "deny")).isError,
			).toBe(true);
			expect(await caseIds(h)).toContain("c_2");
			// The card lists it under the app.
			await panel.waitFor(
				`${GRANT}.textContent.includes("Always allowed: Record the summary for the developer")`,
			);

			// Ask again in the card takes it back: the tool asks again.
			// The card is in Settings, which the AI pill opens (DEC-023): focus
			// stays only in a view that shows.
			await panel.eval(`document.getElementById("ai-button").click()`);
			await panel.waitFor(`!document.getElementById("settings").hidden`);
			await panel.eval(
				`(() => { const b = ${GRANT}.querySelector('[data-focus="ask-again:set_summary"]'); b.focus(); b.click(); })()`,
			);
			await panel.waitFor(
				`!${GRANT}.textContent.includes("Always allowed")`,
				10_000,
			);
			// Its button went with it: the focus stays in that app's card.
			expect(
				await panel.eval<string | undefined>(
					"document.activeElement?.dataset.focus",
				),
			).toBe("allow-all");
			// Written through to the database a moment after the library has it.
			await until(kept, (k) => k === undefined, 10_000);
			expect(
				(await asks("set_summary", { caseId: "c_1", summary: "Four" }, "deny"))
					.isError,
			).toBe(true);
		});

		test("Allow all changes skips every tool's question until it is off, in the card and under the top bar on Home", async () => {
			const allowAll = `${GRANT}.querySelector('[data-focus="allow-all"]')`;
			expect(await panel.eval(`${allowAll}.checked`)).toBe(false);
			// Right after the questions' dialog closed the switch turns nothing
			// on (DEC-037): a double click on its last answer lands there. The
			// click is made in the page the moment the dialog has gone, so no
			// round trip of the test lies between the two.
			const result = call("set_summary", { caseId: "c_1", summary: "Four b" });
			await panel.waitFor(QUESTION, 10_000);
			await answerInPanel(panel, "deny");
			expect(
				await panel.eval<string>(`new Promise((resolve) => {
					const timer = setInterval(() => {
						if (document.getElementById("questions").open) return;
						clearInterval(timer);
						if (!document.body.hasAttribute("data-quiet")) return resolve("late");
						const s = ${allowAll};
						s.click();
						resolve(s.checked + " " + s.getAttribute("aria-checked"));
					}, 5);
				})`),
			).toBe("false false");
			expect((await result).isError).toBe(true);
			expect(await kept()).toBeUndefined();
			await panel.waitFor(QUIET_OVER);
			await panel.eval(`${allowAll}.click()`);
			await until(
				kept,
				(k) => Object.values(k ?? {}).some((e) => e.all),
				10_000,
			);
			await panel.waitFor(`${allowAll}.checked`);
			await runs("set_summary", { caseId: "c_1", summary: "Five" });
			await runs("delete_case", { caseId: "c_2" });
			expect(await caseIds(h)).not.toContain("c_2");
			await panel.eval(`${allowAll}.click()`);
			await until(kept, (k) => k === undefined, 10_000);

			// The same switch is under the top bar on Home, and Settings shows
			// only the card's.
			const bar = `document.querySelector('#ai-allow [data-focus="allow-all"]')`;
			const card = allowAll;
			const shown = `getComputedStyle(document.getElementById("ai-allow")).display !== "none"`;
			// In Settings the card has it: the bar's is not shown twice.
			expect(await panel.eval(shown)).toBe(false);
			await panel.eval(`document.getElementById("back").click()`);
			await panel.waitFor(`document.getElementById("settings").hidden`);
			expect(await panel.eval(shown)).toBe(true);
			// It names the app, which the card's has above it.
			expect(
				await panel.eval<string>(`${bar}.closest("label").textContent`),
			).toContain("Allow all changes ·");
			expect(await panel.eval(`${bar}.checked`)).toBe(false);
			await panel.waitFor(QUIET_OVER);
			await panel.eval(`(() => { const b = ${bar}; b.focus(); b.click(); })()`);
			await until(
				kept,
				(k) => Object.values(k ?? {}).some((e) => e.all),
				10_000,
			);
			// Redrawn with the new state: on, with the keyboard's focus kept, the
			// line that says what it means, and the card's switch on too.
			await panel.waitFor(`${bar}.checked && ${card}.checked`);
			expect(await panel.eval(`document.activeElement === ${bar}`)).toBe(true);
			expect(
				await panel.eval<string>(
					`document.getElementById("ai-allow").textContent`,
				),
			).toContain("deleting a case too");
			await runs("set_summary", { caseId: "c_1", summary: "Six and a half" });
			await panel.eval(`${bar}.click()`);
			await until(kept, (k) => k === undefined, 10_000);
			await panel.waitFor(`!${bar}.checked && !${card}.checked`);
			// Off, the tool asks again.
			expect(
				(await asks("set_summary", { caseId: "c_1", summary: "Six" }, "deny"))
					.isError,
			).toBe(true);
			// Back where the next tests expect the panel.
			await panel.eval(`document.getElementById("ai-button").click()`);
			await panel.waitFor(`!document.getElementById("settings").hidden`);
		});

		test("the notification's Always allow counts, and survives a worker restart", async () => {
			// The panel's window in front: the one closing it acts on.
			await tab.page.activate();
			await closeSidePanel(h, panel);
			const result = call("set_summary", { caseId: "c_1", summary: "Seven" });
			const id = await newNotification(h);
			// After the guard against a click that came too soon.
			await Bun.sleep(PAST_GUARD_MS);
			await clickNotification(h, id, 1);
			expect((await result).isError).toBeFalsy();
			await until(
				kept,
				(k) =>
					Object.values(k ?? {}).some((e) => e.tools.includes("set_summary")),
				10_000,
			);
			// No notification for the next call.
			expect(
				(await call("set_summary", { caseId: "c_1", summary: "Eight" }))
					.isError,
			).toBeFalsy();
			expect(await notifications(h)).toEqual([]);
			// A new worker reads it from its database. Stopped as Chrome does
			// (the sessions on it would keep it alive otherwise).
			const { targetId } = await h.browser.waitForTarget(
				(t) =>
					t.type === "service_worker" &&
					t.url === `chrome-extension://${h.extensionId}/background.js`,
			);
			await (await worker(h)).eval("globalThis.e2eBefore = true");
			await h.browser.send("Target.closeTarget", { targetId });
			await Bun.sleep(500);
			// With no side panel open, a message wakes it (as the alarm would).
			await h.control.eval(
				`chrome.runtime.sendMessage({ type: "images:discard", caseId: "c_none", shotIds: [] })`,
			);
			const end = Date.now() + 20_000;
			for (;;) {
				const again = await call("set_summary", {
					caseId: "c_1",
					summary: "Nine",
				}).catch(() => undefined);
				if (again !== undefined && !again.isError) break;
				if (Date.now() > end) throw new Error("the address did not answer");
				await Bun.sleep(250);
			}
			expect(await notifications(h)).toEqual([]);
			expect(
				await (await worker(h)).eval("globalThis.e2eBefore ?? false"),
			).toBe(false);
			await step("bring the page to the front", () => tab.page.activate());
			panel = await openSidePanel(h);
			await panel.waitFor(
				`${GRANT}?.textContent.includes("Always allowed: Record the summary for the developer")`,
				10_000,
			);
		}, 60_000);

		test("a Disconnect the relay cannot save says so, and keeps the app and its Always allow; one that works forgets them", async () => {
			const disconnect = `${GRANT}.querySelector('[data-focus="disconnect"]')`;
			store.failing = true;
			try {
				await panel.eval(`${disconnect}.click()`);
				// The second click confirms only after a moment (no double click).
				await Bun.sleep(PAST_GUARD_MS);
				await panel.eval(`${disconnect}.click()`);
				await panel.waitFor(`!${byId("pair-problem")}.hidden`, 20_000);
			} finally {
				store.failing = false;
			}
			expect(
				await panel.eval<string>(`${byId("pair-problem")}.textContent`),
			).toBe(
				"Test client was not disconnected: the relay could not save this. Try again.",
			);
			expect(
				await panel.eval(
					`${GRANT}.textContent.includes("Always allowed: Record the summary for the developer")`,
				),
			).toBe(true);
			expect(Object.keys((await kept()) ?? {})).toHaveLength(1);

			// Again, with the relay's store working: the app and its grants go.
			await panel.eval(`${disconnect}.click()`);
			await Bun.sleep(PAST_GUARD_MS);
			await panel.eval(`${disconnect}.click()`);
			await panel.waitFor(`!${GRANT}`, 10_000);
			// The try that worked takes the last one's text away.
			expect(await panel.eval(`${byId("pair-problem")}.hidden`)).toBe(true);
			await until(kept, (k) => k === undefined, 10_000);
			// Paired again for the next test, which is asked.
			await client.close();
			await pairApp();
		}, 60_000);

		test("Stop AI access in the dialog refuses what waits: the top bar's Stop is under it", async () => {
			const result = call("set_summary", { caseId: "c_3", summary: "Eleven" });
			await panel.waitFor(QUESTION, 10_000);
			// The rest of the panel is inert while a question waits.
			expect(
				await panel.eval(
					`(() => { const b = ${byId("stop-ai")}; b.focus(); return document.activeElement === b; })()`,
				),
			).toBe(false);
			await panel.eval(
				`document.querySelector("#questions [data-stop]").click()`,
			);
			await panel.waitFor(
				`document.documentElement.dataset.aiState === "disconnected"`,
				10_000,
			);
			await panel.waitFor(`!document.getElementById("questions").open`);
			// The call did not run.
			expect(
				await result.then(
					(r) => r.isError,
					() => true,
				),
			).toBe(true);
			const db = await h.control.eval<{ cases: Case[] }>(READ_DB);
			expect(db.cases.find((c) => c.id === "c_3")?.verdict).not.toBe("Eleven");
		}, 60_000);
	},
);
