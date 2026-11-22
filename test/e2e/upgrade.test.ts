/**
 * End to end: a browser profile that ran 0.3.0 and then the build before the
 * thread (`panel-guidance`) opened by this build, as the owner reloads the
 * unpacked extension (DEC-046). Real Chrome, the real stores (IndexedDB and
 * the extension's storage), a real sitegloss.dev server:
 *
 *   SITEGLOSS_SERVER=http://localhost:3200 SITEGLOSS_PASSWORD=… \
 *   SITEGLOSS_SERVER_DATA=<serve-local's data folder> bun test test/e2e/upgrade.test.ts
 *
 * Each build is built from its commit in a worktree of this repository, and
 * the three are loaded one after the other over the same profile directory
 * (the same key, so the same extension id and the same data). What the
 * server received is read from its database: every operation it takes is
 * written down there (`applied_ops`, duplicates too), every image in `blobs`.
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	cpSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../../scripts/build.ts";
import {
	type Case,
	type Shape,
	withCaseComment,
	withFinding,
	withReopen,
	withResolution,
	withTitle,
} from "../../src/lib/case.ts";
import { exportCase } from "../../src/lib/export.ts";
import { readZip, writeZip } from "../../src/lib/zip.ts";
import { START_QUIET_MS } from "../../src/worker/cloud.ts";
import {
	addMark,
	change,
	device,
	removeCase,
	signIn,
	startCase,
} from "../cloud-helpers.ts";
import { real, SERVER } from "../cloud-real.ts";
import { Browser, newProfile, type Page } from "./browser.ts";
import { signInPanel } from "./cloud-steps.ts";
import { browserBinary } from "./harness.ts";
import { importFile, until } from "./steps.ts";

const DATA = process.env["SITEGLOSS_SERVER_DATA"];
const ROOT = join(import.meta.dir, "../..");
const id = (name: string) => `document.getElementById(${JSON.stringify(name)})`;
const text = (name: string) => `(${id(name)}?.textContent ?? "")`;
const row = (title: string) =>
	`[...document.querySelectorAll("[data-case]")].find((b) => b.textContent.includes(${JSON.stringify(title)}))`;

/** An export of this build as 0.3.x wrote it: `sitegloss/1`, the marks under `annotations`. */
async function asFormat1(zip: Uint8Array): Promise<Uint8Array> {
	const files = await readZip(zip);
	const {
		format: _format,
		marks,
		...rest
	} = JSON.parse(
		new TextDecoder().decode(files.get("case.json") as Uint8Array),
	);
	const old = { format: "sitegloss/1", ...rest, annotations: marks };
	files.set("case.json", new TextEncoder().encode(JSON.stringify(old)));
	return writeZip([...files].map(([name, data]) => ({ name, data })));
}

/** The unpacked development build (the fixed key) of `commit`, as the owner loads one. */
async function buildAt(commit: string, scratch: string): Promise<string> {
	const tree = join(scratch, `tree-${commit}`);
	await Bun.$`git -C ${ROOT} worktree add --detach ${tree} ${commit}`.quiet();
	await Bun.$`bun install --frozen-lockfile`.cwd(tree).quiet();
	const out = join(scratch, `dist-${commit}`);
	await Bun.$`bun scripts/build.ts --outdir ${out}`.cwd(tree).quiet();
	return out;
}

/** What the server has been sent so far, from its own database. */
function serverCounts(): {
	ops: number;
	blobs: number;
	seq: number;
	files: Record<string, number>;
} {
	const db = new Database(join(DATA as string, "local.db"), { readonly: true });
	try {
		const one = (sql: string) =>
			(db.query(sql).get() as { n: number } | null)?.n ?? 0;
		const files: Record<string, number> = {};
		const walk = (dir: string) => {
			for (const name of readdirSync(dir)) {
				const path = join(dir, name);
				const s = statSync(path);
				if (s.isDirectory()) walk(path);
				else files[path] = s.mtimeMs;
			}
		};
		walk(join(DATA as string, "blobs"));
		return {
			ops: one("select count(*) as n from applied_ops"),
			blobs: one("select count(*) as n from blobs"),
			seq: one("select max(seq) as n from team_sync"),
			files,
		};
	} finally {
		db.close();
	}
}

/**
 * `dist` put where the extension is loaded from: one directory for every
 * build, as the owner builds into `dist/` and reloads.
 */
function loadFrom(dist: string, dir: string, profile: string): string {
	rmSync(dir, { recursive: true, force: true });
	cpSync(dist, dir, { recursive: true });
	// What "Reload" in chrome://extensions does to the worker: the next one
	// is the build on disk. Chrome otherwise keeps running the worker script
	// it cached for an unpacked extension of the same version, and a reload
	// does not bring an extension back in headless Chrome. Only the workers'
	// cache goes: the extension's data (IndexedDB, its storage) stays.
	rmSync(join(profile, "Default", "Service Worker"), {
		recursive: true,
		force: true,
	});
	return dir;
}

/**
 * The source of the extension's running service worker, once it is the one
 * with `marker` (a text only that build has): woken by opening the panel.
 */
async function running(
	browser: Browser,
	extensionId: string,
	marker: string,
): Promise<string> {
	await browser.newPage(
		`chrome-extension://${extensionId}/sidepanel/index.html`,
	);
	/** The source of a worker target; "" when it answers nothing. */
	const sourceOf = async (targetId: string): Promise<string> => {
		const worker = await browser.attach(targetId);
		const parsed = worker.event("Debugger.scriptParsed");
		await worker.send("Debugger.enable");
		const { scriptId } = (await parsed) as { scriptId: string };
		const { scriptSource } = (await worker.send("Debugger.getScriptSource", {
			scriptId,
		})) as { scriptSource: string };
		return scriptSource;
	};
	/**
	 * One look at the extension's workers (an old one can linger beside the
	 * new): the one with `marker`, else the last one's source.
	 */
	const look = async (): Promise<string> => {
		const workers = (await browser.targets()).filter(
			(t) => t.type === "service_worker" && t.url.includes(extensionId),
		);
		let last = "";
		for (const w of workers) {
			last = await Promise.race([
				sourceOf(w.targetId).catch(() => ""),
				Bun.sleep(3000).then(() => ""),
			]);
			if (last.includes(marker)) return last;
		}
		return last;
	};
	return until(
		() => look().catch(() => ""),
		(source) => source.includes(marker),
		30_000,
	);
}

/** The side panel's document in a tab of `browser`. */
async function panelOf(browser: Browser, extensionId: string): Promise<Page> {
	const panel = await browser.newPage(
		`chrome-extension://${extensionId}/sidepanel/index.html`,
	);
	await panel.waitFor(`!!${id("home")}`, 15_000);
	return panel;
}

/** Until the panel says the sync is done: "Synced" (0.3.0) or "Up to date" (later). */
const synced = (panel: Page) =>
	panel.waitFor(
		`(${text("cloud-status")}.startsWith("Synced") || ${text("cloud-status")}.startsWith("Up to date"))`,
		60_000,
	);

/** The extension's cloud database, every key and value. */
const READ_CLOUD = `new Promise((resolve, reject) => {
	const open = indexedDB.open("sitegloss-cloud");
	open.onerror = () => reject(open.error);
	open.onsuccess = () => {
		const tx = open.result.transaction("settings");
		const store = tx.objectStore("settings");
		const keys = store.getAllKeys();
		const values = store.getAll();
		tx.oncomplete = () => resolve(Object.fromEntries(keys.result.map((k, i) => [k, values.result[i]])));
		tx.onerror = () => reject(tx.error);
	};
})`;

/** The extension's cases as stored, read in one of its pages: format and keys of each. */
const READ_CASES = `new Promise((resolve, reject) => {
	const open = indexedDB.open("sitegloss");
	open.onerror = () => reject(open.error);
	open.onsuccess = () => {
		const db = open.result;
		const all = db.transaction("cases").objectStore("cases").getAll();
		all.onsuccess = () => {
			const out = { version: db.version, cases: all.result.map((c) => ({ title: c.title, format: c.format, keys: Object.keys(c), marks: (c.marks ?? []).length })) };
			db.close();
			resolve(out);
		};
		all.onerror = () => reject(all.error);
	};
})`;

describe.skipIf(
	SERVER === undefined || DATA === undefined || browserBinary === undefined,
)(
	"a profile of 0.3.0 and the build before the thread, opened by this build",
	() => {
		const base = SERVER as string;
		const scratch = mkdtempSync(join(tmpdir(), "sitegloss-upgrade-"));
		const profile = newProfile();
		let dists: { old: string; between: string; now: string };
		let extensionId: string;

		beforeAll(async () => {
			const now = join(scratch, "dist-now");
			const built = await build({ outdir: now });
			extensionId = built.id as string;
			dists = {
				old: await buildAt("v0.3.0", scratch),
				// The owner's build after 0.3.0: main with panel-guidance (#22).
				between: await buildAt("fad8287", scratch),
				now,
			};
		}, 600_000);

		afterAll(async () => {
			for (const name of readdirSync(scratch))
				if (name.startsWith("tree-"))
					await Bun.$`git -C ${ROOT} worktree remove --force ${join(scratch, name)}`
						.quiet()
						.nothrow();
			rmSync(scratch, { recursive: true, force: true });
			rmSync(profile, { recursive: true, force: true });
		});

		test("opens the cases, books and account as they are, sends nothing nobody did, and keeps syncing", async () => {
			const stamp = Date.now().toString(36);
			const fromTeam = `Upgrade, the team's ${stamp}`;
			const fromFile = `Upgrade, from a file ${stamp}`;
			const dana = await real(base, "dana", "dana@example.com");
			await signIn(dana.device);
			// A case of the team's, with marks and screenshots, that 0.3.0 receives.
			const teamCase = `c_upt${stamp}`;
			await startCase(dana.device, teamCase);
			await change(dana.device, teamCase, (c, now) =>
				withTitle(c, fromTeam, now),
			);
			await addMark(dana.device, teamCase, "Total is cut off", {
				element: true,
			});
			await addMark(dana.device, teamCase, "Pay button too pale", {
				element: true,
			});
			for (const text of ["From the badge", "Underlined", "A note"])
				await addMark(dana.device, teamCase, text);
			// Each kind of mark, one fixed, one reopened, and an AI finding.
			const shapes: Record<string, Shape> = {
				a3: { kind: "arrow", from: { x: 5, y: 5 }, to: { x: 60, y: 40 } },
				a4: {
					kind: "pen",
					points: [
						{ x: 1, y: 30 },
						{ x: 60, y: 31 },
						{ x: 120, y: 33 },
					],
				},
				a5: { kind: "note", at: { x: 30, y: 30 } },
			};
			await change(dana.device, teamCase, (c, now) =>
				withFinding(
					withReopen(
						withResolution(
							withResolution(
								{
									...c,
									marks: c.marks.map((a) => {
										const shape = shapes[a.id];
										return shape === undefined ? a : { ...a, shape };
									}),
								},
								"a1",
								{ kind: "fixed", note: "Widened the column" },
								now,
							),
							"a2",
							{ kind: "fixed" },
							now,
						),
						"a2",
						{ note: "Still too pale" },
						now,
					),
					"a3",
					{
						id: "f_upgrade",
						text: "The arrow points at the price",
						app: {
							id: "https://claude.ai/oauth",
							name: "Claude",
							host: "claude.ai",
						},
						at: now,
					},
					now,
				),
			);
			await dana.device.engine.request();
			// A case that 0.3.0 sends itself: imported from a file while signed in.
			const offline = device("file", dana.device.api, true);
			const fileCase = `c_upf${stamp}`;
			await startCase(offline, fileCase);
			await change(offline, fileCase, (c, now) => withTitle(c, fromFile, now));
			await addMark(offline, fileCase, "Logo blurred", { element: true });
			await addMark(offline, fileCase, "Footer overlaps", { element: true });
			// The file as 0.3.x writes it (sitegloss/1, DEC-051): 0.3.0 reads no other.
			const zip = join(scratch, "case.sitegloss.zip");
			writeFileSync(
				zip,
				await asFormat1(
					await exportCase(
						offline.store,
						(await offline.store.getCase(fileCase)) as Case,
					),
				),
			);

			// --- 0.3.0 ---
			let browser = await Browser.launchIn(
				browserBinary as string,
				loadFrom(dists.old, join(scratch, "extension"), profile),
				profile,
			);
			let panel = await panelOf(browser, extensionId);
			await signInPanel(browser, panel, base);
			await synced(panel);
			await panel.waitFor(row(fromTeam), 30_000);
			await importFile(panel, zip);
			await panel.waitFor(row(fromFile), 30_000);
			// It goes to the team: Dana has it, with both marks.
			await until(
				async () => {
					await dana.device.engine.request();
					return (await dana.device.store.getCase(fileCase)) as
						| Case
						| undefined;
				},
				(c) => c?.marks.length === 2,
				60_000,
			);
			await synced(panel);
			const before030 = await panel.eval<Record<string, unknown>>(READ_CLOUD);
			const book030 = Object.entries(before030).find(([k]) =>
				k.endsWith(`case:${teamCase}`),
			)?.[1] as { shadow?: Record<string, unknown> } | undefined;
			// What a 0.3.0 book is: a shadow without a thread or a closed state.
			expect(book030?.shadow).toBeDefined();
			expect("comments" in (book030?.shadow ?? {})).toBe(false);
			expect("closed" in (book030?.shadow ?? {})).toBe(false);
			await browser.close();

			console.log(
				"STAGE",
				"// --- the build before the thread ---",
				new Date().toISOString(),
			);
			// --- the build before the thread ---
			browser = await Browser.launchIn(
				browserBinary as string,
				loadFrom(dists.between, join(scratch, "extension"), profile),
				profile,
			);
			console.log(
				"STAGE",
				'// "Reload": the build before',
				new Date().toISOString(),
			);
			// The build before the thread runs (its worker knows the panel's
			// "cloud:check", DEC-045; 0.3.0's does not).
			expect(await running(browser, extensionId, '"cloud:check"')).toContain(
				'"cloud:check"',
			);
			panel = await panelOf(browser, extensionId);
			await panel.waitFor(
				`${text("cloud-who")}.includes("Tess Tester")`,
				30_000,
			);
			await synced(panel);
			await panel.waitFor(row(fromTeam), 30_000);
			await browser.close();

			// --- this build ---
			// Loaded after a while, as the owner will: a worker that synced
			// less than a minute ago does not look again at its start.
			await Bun.sleep(START_QUIET_MS + 2000);
			const sent = serverCounts();
			browser = await Browser.launchIn(
				browserBinary as string,
				loadFrom(dists.now, join(scratch, "extension"), profile),
				profile,
			);
			// This build's worker runs (a text only it has).
			expect(
				await running(browser, extensionId, "kept back and not sent"),
			).toContain("kept back and not sent");
			panel = await panelOf(browser, extensionId);
			// Signed in still: no sign-in asked.
			await panel.waitFor(
				`${text("cloud-who")}.includes("Tess Tester")`,
				30_000,
			);
			await synced(panel);
			// The once-over read of each case from before the thread has happened:
			// every synced book holds a thread now.
			await until(
				() => panel.eval<Record<string, unknown>>(READ_CLOUD),
				(db) =>
					Object.entries(db)
						.filter(([k]) => k.includes(" case:"))
						.every(([, b]) => {
							const book = b as { mode?: string; shadow?: object };
							return (
								book.mode !== "synced" ||
								book.shadow === undefined ||
								"comments" in book.shadow
							);
						}),
				60_000,
			);
			await synced(panel);
			// The cases as stored: every one brought to sitegloss/2 by the
			// store's upgrade (DEC-051), its marks under their new key.
			const stored = await panel.eval<{
				version: number;
				cases: {
					title: string;
					format: string;
					keys: string[];
					marks: number;
				}[];
			}>(READ_CASES);
			expect(stored.version).toBe(2);
			expect(stored.cases.length).toBeGreaterThanOrEqual(2);
			for (const c of stored.cases) {
				expect(c.format).toBe("sitegloss/2");
				expect(c.keys).not.toContain("annotations");
			}
			for (const [title, count] of [
				[fromTeam, 5],
				[fromFile, 2],
			] as const)
				expect(stored.cases.find((c) => c.title === title)?.marks).toBe(count);
			// Some time for anything that would still go.
			await Bun.sleep(5000);
			const after = serverCounts();
			// Nothing nobody did: no operation (no delete, no patch, no mark again),
			// no image sent again, the team's revision where it was.
			expect(after.ops).toBe(sent.ops);
			expect(after.blobs).toBe(sent.blobs);
			expect(after.seq).toBe(sent.seq);
			expect(after.files).toEqual(sent.files);
			// The panel shows both cases with their marks and pictures.
			for (const [title, count] of [
				[fromTeam, 5],
				[fromFile, 2],
			] as const) {
				await panel.waitFor(row(title), 15_000);
				await panel.click(row(title));
				await panel.waitFor(`!!${id("export-case")}`);
				await panel.waitFor(
					`document.querySelectorAll("[data-mark]").length === ${count}`,
					15_000,
				);
				await panel.click(id("back"));
				await panel.waitFor(`!${id("home")}.hidden`);
			}

			// And it keeps syncing: Dana's comment comes, Tess's goes.
			await change(dana.device, teamCase, (c, now) =>
				withCaseComment(
					c,
					{ id: `k_${stamp}_d`, text: "After the upgrade" },
					now,
				),
			);
			await dana.device.engine.request();
			// From here, what this browser sends (Dana's comment counted).
			const withDana = serverCounts().ops;
			await panel.click(row(fromTeam));
			await panel.waitFor(
				`${text("case-thread")}.includes("After the upgrade")`,
				30_000,
			);
			await panel.eval(
				`(() => { const f = ${id("comment-new")}; f.value = "Seen, from the new build"; f.dispatchEvent(new Event("input")); return true; })()`,
			);
			await panel.click(
				`document.querySelector('[data-action="comment-add"]')`,
			);
			await until(
				async () => {
					await dana.device.engine.request();
					return (await dana.device.store.getCase(teamCase)) as Case;
				},
				(c) =>
					c.comments?.some((k) => k.text === "Seen, from the new build") ===
					true,
				30_000,
			);
			// Tess's comment, and nothing else.
			expect(serverCounts().ops).toBe(withDana + 1);
			await browser.close();

			await removeCase(dana.device, teamCase);
			await removeCase(dana.device, fileCase);
			await dana.device.engine.request();
			await dana.session.end(base);
		}, 600_000);
	},
);
