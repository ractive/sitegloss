/**
 * End to end in Firefox: the account and the sync with a team (DEC-039),
 * against a real sitegloss.dev server:
 *
 *   SITEGLOSS_SERVER=http://localhost:3200 SITEGLOSS_PASSWORD=… bun test test/e2e/firefox/cloud.test.ts
 *
 * Skipped without the variable, and without ff-rdp and Firefox. As in the
 * Chromium suite (`../cloud.test.ts`) nothing is stood in for: "Sign in"
 * opens Firefox's own sign-in window, which ff-rdp reaches as a tab, and the
 * test types the demo user's e-mail address and password there. The server
 * has to allow Firefox's redirect address (`FIREFOX_REDIRECT`), in its
 * `EXTENSION_REDIRECT_URIS`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { withTitle } from "../../../src/lib/case.ts";
import {
	addMark,
	change,
	removeCase,
	signIn,
	startCase,
} from "../../cloud-helpers.ts";
import { PASSWORD, real, SERVER } from "../../cloud-real.ts";
import {
	backgroundLog,
	type FirefoxHarness,
	firefoxReady,
	LOCK_WAIT_MS,
	startFirefox,
} from "./harness.ts";

/**
 * Where Firefox's sign-in window ends for the add-on `sitegloss@ractive.ch`:
 * the SHA-1 of that id, at `extensions.allizom.org`. The same for every
 * install, as the add-on's id is.
 */
export const FIREFOX_REDIRECT =
	"https://06e95dca9ff68bfd10ed74d5a76de715f9cc9d14.extensions.allizom.org/";

const id = (name: string) => `document.getElementById(${JSON.stringify(name)})`;
const text = (name: string) => `(${id(name)}?.textContent ?? "")`;
const row = (title: string) =>
	`[...document.querySelectorAll("[data-case]")].find((b) => b.querySelector(".title")?.textContent === ${JSON.stringify(title)})`;

describe.skipIf(SERVER === undefined || !firefoxReady)(
	"Firefox: the account and the sync with a team, against a real server",
	() => {
		const base = SERVER as string;
		let h: FirefoxHarness;
		let starting: Promise<FirefoxHarness> | undefined;

		beforeAll(async () => {
			starting = startFirefox("test");
			h = await starting;
		}, LOCK_WAIT_MS + 120_000);

		afterAll(async () => {
			const started = await starting?.catch(() => undefined);
			await started?.stop();
		}, 180_000);

		test("Firefox's redirect address is the one the server is told", async () => {
			expect(
				await h.rdp.eval<string>(h.panel, "browser.identity.getRedirectURL()"),
			).toBe(FIREFOX_REDIRECT);
		});

		test("sign in, the team's cases arrive, a teammate's change shows at once, sign out", async () => {
			const panel = h.panel;
			await h.rdp.eval(
				panel,
				`(() => { document.querySelector(".cloud-server").open = true; const choice = ${id("cloud-server-choice")}; choice.value = "other"; choice.dispatchEvent(new Event("change")); const field = ${id("cloud-server")}; field.value = ${JSON.stringify(base)}; field.dispatchEvent(new Event("change")); field.blur(); return true; })()`,
			);
			await h.rdp.waitFor(
				panel,
				`${text("cloud")}.includes(${JSON.stringify(new URL(base).host)})`,
				"the server's address in the panel",
			);
			// "Sign in" opens Firefox's own sign-in window on the server's page
			// (`identity.launchWebAuthFlow`): a tab ff-rdp reaches by its address.
			await h.rdp.eval(
				panel,
				`(${id("cloud")}.querySelector('[data-action="cloud-sign-in"]').click(), true)`,
			);
			const window = new URL(base).host;
			await h.rdp.waitFor(
				window,
				`!!document.querySelector('input[type="email"]')`,
				"the server's sign-in page in Firefox's window",
				30_000,
			);
			expect(
				new URL(
					await h.rdp.eval<string>(window, "location.href"),
				).searchParams.get("redirect_uri"),
			).toBe(FIREFOX_REDIRECT);
			await h.rdp.run([
				"--tab",
				window,
				"type",
				'input[type="email"]',
				"tess@example.com",
			]);
			await h.rdp.run([
				"--tab",
				window,
				"type",
				'input[type="password"]',
				PASSWORD,
			]);
			await h.rdp.run(["--tab", window, "click", 'button[type="submit"]']);
			// The first time, the server asks whether Sitegloss may.
			const allow = `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Allow")`;
			for (let i = 0; i < 100; i++) {
				const signed = await h.rdp.eval<boolean>(
					panel,
					`${text("cloud-who")}.includes("Tess Tester")`,
				);
				if (signed) break;
				await h.rdp
					.eval(
						window,
						`location.pathname.startsWith("/consent") && !!${allow} && (${allow}.click(), true)`,
					)
					.catch(() => undefined);
				await Bun.sleep(300);
			}
			await h.rdp.waitFor(
				panel,
				`${text("cloud-who")}.includes("Tess Tester")`,
				"who is signed in",
				30_000,
			);
			await h.rdp.waitFor(
				panel,
				// The state in words since DEC-045: up to date while it listens.
				`${text("cloud-status")}.startsWith("Up to date")`,
				"the first sync",
				60_000,
			);
			const demo = "Home and booking: what is off before the launch";
			await h.rdp.waitFor(panel, `!!(${row(demo)})`, "the team's case", 30_000);

			// A teammate's case shows here without a reload: the events stream.
			const dana = await real(base, "dana", "dana@example.com");
			await signIn(dana.device);
			const caseId = `c_ff${Date.now().toString(36)}`;
			const title = `Seen live in Firefox ${caseId}`;
			await startCase(dana.device, caseId);
			await change(dana.device, caseId, (c, now) => withTitle(c, title, now));
			await addMark(dana.device, caseId, "Dana's mark");
			const sent = Date.now();
			await dana.device.engine.request();
			await h.rdp.waitFor(
				panel,
				`!!(${row(title)})`,
				"the teammate's case",
				15_000,
			);
			console.log(
				`Firefox: a teammate's case showed in the open panel after ${Date.now() - sent} ms`,
			);
			await removeCase(dana.device, caseId);
			await dana.device.engine.request();
			await h.rdp.waitFor(
				panel,
				`!(${row(title)})`,
				"the deleted case to go",
				15_000,
			);
			await dana.session.end(base);

			await h.rdp.eval(
				panel,
				`(${id("cloud")}.querySelector('[data-action="cloud-sign-out"]').click(), true)`,
			);
			await h.rdp.waitFor(
				panel,
				`${id("cloud")}?.dataset.cloud === "off"`,
				"signed out",
			);
			expect(await h.rdp.eval<boolean>(panel, `!!(${row(demo)})`)).toBe(true);
			// Nothing the event page complained of.
			expect(await backgroundLog(h)).toEqual([]);
		}, 240_000);
	},
);
