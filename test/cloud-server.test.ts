/**
 * The sync against a real sitegloss.dev server (DEC-039), when one is named:
 *
 *   SITEGLOSS_SERVER=http://localhost:3200 SITEGLOSS_PASSWORD=… \
 *     bun test test/cloud-server.test.ts
 *
 * The server is the app's local one with its demo team
 * (`bun scripts/serve-local.ts 3200 --demo` in the server's repository): the
 * users tess@example.com and dana@example.com, with the password its demo
 * data gives them. Skipped without the variables: CI has no server. The
 * tokens are got as the extension gets them, by the authorization code flow
 * with PKCE; only the browser's window is replaced, by signing in with the
 * password and answering the consent page over HTTP.
 */

import { describe, expect, test } from "bun:test";
import {
	type Case,
	withCaseComment,
	withChoice,
	withClosed,
	withComment,
	withoutAnnotation,
	withoutCaseComment,
} from "../src/lib/case.ts";
import { eventsUrl, httpApi } from "../src/lib/cloud/api.ts";
import {
	AuthError,
	discover,
	refreshTokens,
	Session,
	TOKENS_KEY,
	type Tokens,
} from "../src/lib/cloud/auth.ts";
import type { Account } from "../src/lib/cloud/book.ts";
import { CloudSync } from "../src/lib/cloud/engine.ts";
import { listen } from "../src/lib/cloud/sse.ts";
import {
	addMark,
	CART,
	change,
	images,
	look,
	PAY,
	removeCase,
	signIn,
	startCase,
	status,
	sync,
	webp,
} from "./cloud-helpers.ts";
import { SERVER as BASE, real, signInWindow } from "./cloud-real.ts";
import {
	type Case as Case030,
	withComment as withComment030,
} from "./compat/v0.3.0/src/lib/case.ts";
import { httpApi as httpApi030 } from "./compat/v0.3.0/src/lib/cloud/api.ts";
import {
	beginSignIn as beginSignIn030,
	codeFrom as codeFrom030,
	exchangeCode as exchangeCode030,
	Session as Session030,
} from "./compat/v0.3.0/src/lib/cloud/auth.ts";
import { CloudSync as CloudSync030 } from "./compat/v0.3.0/src/lib/cloud/engine.ts";
import { memoryKv as memoryKv030 } from "./compat/v0.3.0/src/lib/kv.ts";
import { MemoryStore as MemoryStore030 } from "./compat/v0.3.0/src/lib/store.ts";

const serverTest = BASE === undefined ? describe.skip : describe;

serverTest("against a real server", () => {
	const base = BASE as string;
	const id = `c_it${Date.now().toString(36)}`;

	test("two devices of two people sync a case both ways, live", async () => {
		const tess = await real(base, "tess", "tess@example.com");
		const dana = await real(base, "dana", "dana@example.com");
		const me = await tess.device.api.me();
		expect(me.user.email).toBe("tess@example.com");
		const team = me.teams.find((t) => t.name === "Pedal & Pine web");
		expect(team?.permissions).toContain("mark:create");

		// Signing in fetches the team's cases: the demo case, its pictures too.
		await tess.device.engine.signedIn(base, me);
		await signIn(dana.device);
		const account = (await tess.device.engine.account()) as Account;
		expect(account.teamId).toBe(team?.id as string);
		expect(status(tess.device)?.state).toBe("synced");
		const demo = (await tess.device.store.getCase("demo_case_1")) as Case;
		expect(demo.annotations.length).toBeGreaterThanOrEqual(5);
		expect(demo.pages?.length).toBe(2);
		expect(demo.importedAt).toBeUndefined();
		expect(
			Object.values(await images(tess.device, "demo_case_1")),
		).not.toContain("MISSING");
		const crop = await tess.device.store.getImage(
			"demo_case_1",
			demo.annotations[0]?.crop as string,
		);
		const head = new Uint8Array(
			(await crop?.blob.arrayBuffer()) ?? new ArrayBuffer(0),
		).slice(0, 4);
		expect(new TextDecoder().decode(head)).toBe("RIFF");

		// The events stream, as the panel listens to it.
		const heard: number[] = [];
		const end = new AbortController();
		const listening = listen({
			url: eventsUrl(base, account.teamId as string),
			token: (fresh) => tess.session.access(base, fresh),
			onChange: (cursor) => heard.push(cursor),
			signal: end.signal,
		});

		// A new case of Tess's, across two pages.
		await startCase(tess.device, id);
		await addMark(tess.device, id, "Total is cut off", { element: true });
		await addMark(tess.device, id, "Pay button too pale", {
			url: PAY,
			title: "Payment",
		});
		await sync(tess.device, dana.device);
		const there = (await dana.device.store.getCase(id)) as Case;
		expect(look(there)).toEqual(look(await tess.device.store.getCase(id)));
		expect(
			look(there)?.marks.map((m) => [m.number, m.comment, m.page]),
		).toEqual([
			[1, "Total is cut off", "https://shop.example/cart"],
			[2, "Pay button too pale", PAY],
		]);
		expect(await images(dana.device, id)).toEqual(
			await images(tess.device, id),
		);
		expect(there.annotations[0]?.createdBy?.name).toBe("Tess Tester");
		// The pages are the server's, made from the screenshots: each with
		// the title its first screenshot named, though no list was ever sent.
		expect(there.pages).toEqual([
			{ url: "https://shop.example/cart", title: "Your cart", lang: "en" },
			{ url: PAY, title: "Payment", lang: "en" },
		]);
		expect(there.page.url).toBe("https://shop.example/cart");
		// Dana settles a mark: Tess hears of it on the stream, and has it with who did it.
		const before = heard.length;
		await change(dana.device, id, (c, now) =>
			withChoice(c, "a1", "fixed", "Widened the column", now),
		);
		await dana.device.engine.request();
		for (let i = 0; i < 50 && heard.length === before; i++)
			await new Promise((r) => setTimeout(r, 100));
		expect(heard.length).toBeGreaterThan(before);
		await tess.device.engine.request();
		const mine = (await tess.device.store.getCase(id)) as Case;
		expect(mine.annotations[0]?.resolution).toMatchObject({
			kind: "fixed",
			note: "Widened the column",
			user: { name: "Dana Developer" },
		});

		// Both add a mark at once: the server gives the later one the next number.
		await addMark(tess.device, id, "Tess's third");
		await addMark(dana.device, id, "Dana's third");
		await tess.device.engine.request();
		await dana.device.engine.request();
		await sync(tess.device, dana.device);
		for (const d of [tess.device, dana.device])
			expect(
				look(await d.store.getCase(id))?.marks.map((m) => [m.id, m.comment]),
			).toEqual([
				["a1", "Total is cut off"],
				["a2", "Pay button too pale"],
				["a3", "Tess's third"],
				["a4", "Dana's third"],
			]);
		expect(await images(dana.device, id)).toEqual(
			await images(tess.device, id),
		);

		// Two changes to one mark: both stay.
		await change(tess.device, id, (c, now) =>
			withComment(c, "a2", "Edited by Tess", now),
		);
		await change(dana.device, id, (c, now) =>
			withChoice(c, "a2", "wontfix", "", now),
		);
		await sync(tess.device, dana.device);
		for (const d of [tess.device, dana.device])
			expect(look(await d.store.getCase(id))?.marks[1]).toMatchObject({
				comment: "Edited by Tess",
				status: "wontfix",
			});

		// The refresh token rotates, and the new one works.
		const first = (tess.kv.data.get(TOKENS_KEY) as Tokens).refresh;
		await tess.session.access(base, true);
		const second = (tess.kv.data.get(TOKENS_KEY) as Tokens).refresh;
		expect(second).not.toBe(first);
		await tess.session.access(base, true);
		expect((await tess.device.api.me()).user.email).toBe("tess@example.com");

		// The same page on localhost is no second page at the server either,
		// and a page leaves the server's list with its last mark.
		const local = await addMark(dana.device, id, "Here too", {
			url: "http://localhost:3000/checkout/pay/",
			title: "Payment (dev)",
		});
		const done = await addMark(dana.device, id, "Thanks page", {
			url: "https://shop.example/done",
			title: "Thank you",
		});
		await sync(dana.device, tess.device);
		expect(
			(await tess.device.store.getCase(id))?.pages?.map((p) => [
				p.url,
				p.title,
			]),
		).toEqual([
			["https://shop.example/cart", "Your cart"],
			[PAY, "Payment"],
			["https://shop.example/done", "Thank you"],
		]);
		for (const gone of [done.id, local.id])
			await change(dana.device, id, (c, now) =>
				withoutAnnotation(c, gone, now),
			);
		await sync(dana.device, tess.device);
		expect(
			(await tess.device.store.getCase(id))?.pages?.map((p) => p.url),
		).toEqual(["https://shop.example/cart", PAY]);
		expect(status(tess.device)?.problems).toEqual([]);

		// The case is lost from Dana's store (nobody deleted it): it is read
		// from the server by itself, whole, and nothing is deleted for the team.
		dana.device.store.cases.delete(id);
		for (const key of [...dana.device.store.images.keys()])
			if (key.startsWith(`${id}/`)) dana.device.store.images.delete(key);
		await dana.device.engine.request();
		expect(look(await dana.device.store.getCase(id))).toEqual(
			look(await tess.device.store.getCase(id)),
		);
		expect(await images(dana.device, id)).toEqual(
			await images(tess.device, id),
		);
		await tess.device.engine.request();
		expect(await tess.device.store.getCase(id)).toBeDefined();

		// Deleted on one device: deleted for the team, and gone on the other.
		await removeCase(tess.device, id);
		await tess.device.engine.request();
		await dana.device.engine.request();
		expect(await dana.device.store.getCase(id)).toBeUndefined();
		expect(status(dana.device)?.state).toBe("synced");
		expect(status(tess.device)?.problems).toEqual([]);

		// Signing out ends the grant at the server: its tokens are refused.
		end.abort();
		await listening;
		const { access: old, refresh: spent } = tess.kv.data.get(
			TOKENS_KEY,
		) as Tokens;
		await tess.session.end(base);
		// The real server took the extension's sign-out (a public client's,
		// without a secret): the refresh token is worth nothing afterwards.
		const again = await refreshTokens(
			(input, init) => fetch(input, init),
			base,
			await discover((input, init) => fetch(input, init), base),
			{ access: old, refresh: spent, expiresAt: 0 },
			Date.now(),
		).catch((error: unknown) => error);
		expect(again).toBeInstanceOf(AuthError);
		expect((again as AuthError).signedOut).toBe(true);
		const refused = await fetch(`${base}/api/v1/me`, {
			headers: { authorization: `Bearer ${old}` },
		});
		// The access token is a signed one and holds until it runs out; the
		// refresh token is what the server ends.
		expect([200, 401]).toContain(refused.status);
		expect(tess.kv.data.has(TOKENS_KEY)).toBe(false);
		await dana.session.end(base);
	}, 120_000);

	test("the thread, closing and the app's name (DEC-046), with a 0.3.0 browser on the team", async () => {
		const caseId = `c_th${Date.now().toString(36)}`;
		const tess = await real(base, "tess", "tess@example.com");
		const dana = await real(base, "dana", "dana@example.com");
		const old = await real030(base, "dana@example.com");
		await signIn(tess.device);
		await signIn(dana.device);
		await old.engine.signedIn(base, await old.api.me());
		const CLAUDE = {
			id: "https://claude.ai/oauth",
			name: "Claude",
			host: "claude.ai",
		};
		await startCase(tess.device, caseId);
		await addMark(tess.device, caseId, "Total is cut off", { element: true });
		await addMark(tess.device, caseId, "Pay button too pale", { url: PAY });
		await tess.device.engine.request();
		const marks = (await tess.device.store.getCase(caseId)) as Case;
		const first = marks.annotations[0]?.id as string;
		// By hand on the case; through Claude on mark 1; closed through Claude.
		await change(tess.device, caseId, (c, now) =>
			withCaseComment(
				c,
				{ id: `k_${caseId}_1`, text: "Both pages checked." },
				now,
			),
		);
		await change(tess.device, caseId, (c, now) =>
			withCaseComment(
				c,
				{
					id: `k_${caseId}_2`,
					text: "Fixed in PR 12.",
					mark: first,
					app: CLAUDE,
				},
				now,
			),
		);
		await change(tess.device, caseId, (c, now) =>
			withClosed(c, true, now, CLAUDE),
		);
		await tess.device.engine.request();
		expect(status(tess.device)?.problems).toEqual([]);
		await sync(dana.device);
		const there = (await dana.device.store.getCase(caseId)) as Case;
		expect(
			there.comments?.map((k) => [
				k.id,
				k.text,
				k.user?.name,
				k.app?.name ?? null,
				k.mark === undefined
					? null
					: there.annotations.find((a) => a.id === k.mark)?.number,
			]),
		).toEqual([
			[`k_${caseId}_1`, "Both pages checked.", "Tess Tester", null, null],
			[`k_${caseId}_2`, "Fixed in PR 12.", "Tess Tester", "Claude", 1],
		]);
		expect(there.closed?.user?.name).toBe("Tess Tester");
		expect(there.closed?.app?.name).toBe("Claude");

		// 0.3.0 has the case and its marks, without problems.
		for (let i = 0; i < 2; i++) await old.engine.request();
		expect(old.statuses.at(-1)?.state).toBe("synced");
		expect(old.statuses.at(-1)?.problems).toEqual([]);
		const oldCase = (await old.store.getCase(caseId)) as Case030;
		expect(oldCase.annotations.map((a) => a.comment)).toEqual([
			"Total is cut off",
			"Pay button too pale",
		]);
		// 0.3.0 changes a mark's comment: it arrives; the thread and the close stay.
		await old.store.updateCase(caseId, (c) => ({
			value: withComment030(
				c as Case030,
				(c as Case030).annotations[0]?.id as string,
				"Total is cut off on small screens",
				new Date(Date.now() + 1000).toISOString(),
			),
		}));
		await old.engine.request();
		expect(old.statuses.at(-1)?.problems).toEqual([]);
		await tess.device.engine.request();
		const mine = (await tess.device.store.getCase(caseId)) as Case;
		expect(mine.annotations[0]?.comment).toBe(
			"Total is cut off on small screens",
		);
		expect(mine.comments).toHaveLength(2);
		expect(mine.closed).toBeDefined();

		// Deleted here: the server lists it with no case; 0.3.0 passes it by.
		await change(tess.device, caseId, (c, now) =>
			withoutCaseComment(c, `k_${caseId}_1`, now),
		);
		await tess.device.engine.request();
		await old.engine.request();
		expect(old.statuses.at(-1)?.problems).toEqual([]);
		await dana.device.engine.request();
		expect(
			((await dana.device.store.getCase(caseId)) as Case).comments?.map(
				(k) => k.id,
			),
		).toEqual([`k_${caseId}_2`]);

		// 0.3.0 adds an open mark: the server opens the case again, and Tess has it.
		await old.store.putImage(caseId, "crops/a3.webp", {
			blob: webp("crop by 0.3.0", 280, 160),
			width: 280,
			height: 160,
		});
		await old.store.updateCase(caseId, (c) => {
			const value = c as Case030;
			const one = value.annotations[0] as Case030["annotations"][number];
			return {
				value: {
					...value,
					annotations: [
						...value.annotations,
						{
							...one,
							id: "a3",
							number: 3,
							comment: "From 0.3.0",
							crop: "crops/a3.webp",
							shape: { kind: "note", at: { x: 5, y: 5 } },
							element: null,
						},
					],
					updatedAt: new Date(Date.now() + 2000).toISOString(),
				},
			};
		});
		await old.engine.request();
		expect(old.statuses.at(-1)?.problems).toEqual([]);
		await tess.device.engine.request();
		const reopened = (await tess.device.store.getCase(caseId)) as Case;
		expect(reopened.annotations.map((a) => a.comment)).toContain("From 0.3.0");
		expect(reopened.closed).toBeUndefined();

		await removeCase(tess.device, caseId);
		await tess.device.engine.request();
		await tess.session.end(base);
		await dana.session.end(base);
		await old.session.end(base);
	}, 120_000);
});

serverTest("an arrow's ends at a real server (DEC-047; its DEC-020)", () => {
	const base = BASE as string;

	test("go with the new mark, come back from the server to another device, and are never patched", async () => {
		const caseId = `c_en${Date.now().toString(36)}`;
		const tess = await real(base, "tess", "tess@example.com");
		const dana = await real(base, "dana", "dana@example.com");
		await signIn(tess.device);
		await signIn(dana.device);
		await startCase(tess.device, caseId);
		const a = await addMark(
			tess.device,
			caseId,
			"From the badge to the price",
			{
				element: true,
			},
		);
		const start = {
			tag: "span",
			testId: "badge",
			classes: ["pp-badge"],
			attributes: {},
			ancestors: ["article.pp-card"],
			rect: { x: 10, y: 20, width: 40, height: 18 },
			page: { width: 1280, height: 2000 },
			selector: ".pp-badge",
		};
		await change(tess.device, caseId, (c, now) => ({
			...c,
			annotations: c.annotations.map((x) =>
				x.id === a.id
					? {
							...x,
							shape: {
								kind: "arrow",
								from: { x: 30, y: 30 },
								to: { x: 300, y: 200 },
							},
							ends: { start, end: null },
						}
					: x,
			),
			updatedAt: now,
		}));
		await tess.device.engine.request();
		expect(status(tess.device)?.problems).toEqual([]);
		await dana.device.engine.request();
		const there = ((await dana.device.store.getCase(caseId)) as Case)
			.annotations[0];
		expect(there?.ends?.start?.testId).toBe("badge");
		expect(there?.ends?.start?.classes).toEqual(["pp-badge"]);
		expect(there?.ends?.end).toBeNull();
		// A change to the mark goes as a patch; its ends stay as they were.
		await change(tess.device, caseId, (c, now) =>
			withComment(c, a.id, "From the badge to the price, on mobile", now),
		);
		await tess.device.engine.request();
		expect(status(tess.device)?.problems).toEqual([]);
		await dana.device.engine.request();
		const after = ((await dana.device.store.getCase(caseId)) as Case)
			.annotations[0];
		expect(after?.comment).toBe("From the badge to the price, on mobile");
		expect(after?.ends?.start?.testId).toBe("badge");
		await removeCase(tess.device, caseId);
		await tess.device.engine.request();
		await tess.session.end(base);
		await dana.session.end(base);
	}, 120_000);
});

serverTest("a mark's look at a real server (DEC-048; its DEC-021)", () => {
	const base = BASE as string;

	test("goes with the new mark, comes back to another device, and nothing more is sent", async () => {
		const caseId = `c_lk${Date.now().toString(36)}`;
		const tess = await real(base, "tess", "tess@example.com");
		const dana = await real(base, "dana", "dana@example.com");
		await signIn(tess.device);
		await signIn(dana.device);
		await startCase(tess.device, caseId);
		const a = await addMark(tess.device, caseId, "Book is hard to read", {
			element: true,
		});
		const look = {
			styles: {
				color: "rgb(245, 207, 88)",
				"background-color": "rgb(242, 194, 48)",
				"font-family": '"Inter", system-ui',
			},
			backdrop: { color: "rgb(242, 194, 48)", depth: 0 },
			siblings: [
				{ offset: -1, tag: "p", rect: { x: 1, y: 2, width: 30, height: 40 } },
			],
		};
		await change(tess.device, caseId, (c, now) => ({
			...c,
			annotations: c.annotations.map((x) =>
				x.id === a.id && x.element !== null
					? { ...x, element: { ...x.element, ...look } }
					: x,
			),
			updatedAt: now,
		}));
		await tess.device.engine.request();
		expect(status(tess.device)?.problems).toEqual([]);
		await dana.device.engine.request();
		const there = ((await dana.device.store.getCase(caseId)) as Case)
			.annotations[0];
		expect(there?.element).toMatchObject(look);
		// Both again: neither has anything to send.
		const sent: string[] = [];
		for (const d of [tess.device, dana.device]) {
			const ops = d.api.ops.bind(d.api);
			d.api.ops = async (team, list) => {
				sent.push(...list.map((o) => o.type));
				return ops(team, list);
			};
			await d.engine.request();
		}
		expect(sent).toEqual([]);
		await removeCase(tess.device, caseId);
		await tess.device.engine.request();
		await tess.session.end(base);
		await dana.session.end(base);
	}, 120_000);
});

serverTest(
	"a screenshot's query at a real server (DEC-050; its DEC-023)",
	() => {
		const base = BASE as string;

		test("goes filtered with shot.create, the server keeps it, and another profile gets it", async () => {
			const caseId = `c_qy${Date.now().toString(36)}`;
			const tess = await real(base, "tess", "tess@example.com");
			const dana = await real(base, "dana", "dana@example.com");
			await signIn(tess.device);
			await signIn(dana.device);
			const sent: (string | undefined)[] = [];
			const ops = tess.device.api.ops.bind(tess.device.api);
			tess.device.api.ops = async (team, list) => {
				for (const o of list)
					if (o.type === "shot.create") sent.push(o.shot.query);
				return ops(team, list);
			};
			await startCase(tess.device, caseId);
			await addMark(tess.device, caseId, "Sorted by name, not price", {
				url: "https://shop.example/search?q=shoes&sort=price&access_token=abc&user=jane%40example.com#results",
				title: "Search",
			});
			await addMark(tess.device, caseId, "No query here", { url: CART });
			await tess.device.engine.request();
			expect(status(tess.device)?.problems).toEqual([]);
			// Filtered here before it went: only what may be kept.
			expect(sent).toEqual(["q=shoes&sort=price", undefined]);
			// The server has it, beside the plain address.
			const teamId = (await tess.device.engine.account())?.teamId as string;
			const atServer = await tess.device.api.getCase(teamId, caseId);
			expect(atServer?.shots.map((s) => [s.url, s.query]).sort()).toEqual(
				[
					["https://shop.example/search", "q=shoes&sort=price"],
					[CART, undefined],
				].sort(),
			);
			// Another profile, another person: the query comes back with the screenshot.
			await dana.device.engine.request();
			const there = (await dana.device.store.getCase(caseId)) as Case;
			const search = there.shots.find(
				(s) => s.url === "https://shop.example/search",
			);
			expect(search?.query).toBe("q=shoes&sort=price");
			expect(there.shots.find((s) => s.url === CART)).not.toHaveProperty(
				"query",
			);
			expect(there.pages?.map((p) => p.url)).toEqual([
				"https://shop.example/search",
				CART,
			]);
			// Nothing more to send on either side.
			const after: string[] = [];
			for (const d of [tess.device, dana.device]) {
				const send = d.api.ops.bind(d.api);
				d.api.ops = async (team, list) => {
					after.push(...list.map((o) => o.type));
					return send(team, list);
				};
				await d.engine.request();
			}
			expect(after).toEqual([]);
			await removeCase(tess.device, caseId);
			await tess.device.engine.request();
			await tess.session.end(base);
			await dana.session.end(base);
		}, 120_000);
	},
);

serverTest("a browser's 0.3.0 data, opened by this build", () => {
	const base = BASE as string;

	test("its cases, books and account open cleanly, keep syncing, and get the thread and closings 0.3.0 passed by", async () => {
		const caseId = `c_mg${Date.now().toString(36)}`;
		// Tess on 0.3.0: signed in, the team's cases here, a case of her own.
		const old = await real030(base, "tess@example.com");
		await old.engine.signedIn(base, await old.api.me());
		const dana = await real(base, "dana", "dana@example.com");
		await signIn(dana.device);
		await startCase(dana.device, caseId);
		await addMark(dana.device, caseId, "Total is cut off");
		await addMark(dana.device, caseId, "Pay button too pale");
		await dana.device.engine.request();
		await old.engine.request();
		expect((await old.store.getCase(caseId))?.annotations).toHaveLength(2);
		// What 0.3.0 cannot keep: Dana comments and closes the case. 0.3.0
		// reads past it and moves its cursor on.
		await change(dana.device, caseId, (c, now) =>
			withClosed(
				withCaseComment(
					c,
					{ id: `k_${caseId}_1`, text: "Before the upgrade" },
					now,
				),
				true,
				now,
			),
		);
		await dana.device.engine.request();
		await old.engine.request();
		await old.engine.request();
		expect(old.statuses.at(-1)?.state).toBe("synced");
		const cases = (await old.store.listCases()).length;

		// The extension is reloaded with this build: the same database.
		const session = new Session(old.kv as never, (input, init) =>
			fetch(input, init),
		);
		const plain = httpApi({
			server: base,
			token: (fresh) => session.access(base, fresh),
		});
		// Every write it makes, and every question about an image, counted.
		const writes: string[] = [];
		const api = {
			...plain,
			ops: (team: string, list: Parameters<typeof plain.ops>[1]) => {
				writes.push(...list.map((o) => o.type));
				return plain.ops(team, list);
			},
			putBlob: (...args: Parameters<typeof plain.putBlob>) => {
				writes.push("PUT blob");
				return plain.putBlob(...args);
			},
			hasBlob: (...args: Parameters<typeof plain.hasBlob>) => {
				writes.push("HEAD blob");
				return plain.hasBlob(...args);
			},
		};
		const statuses: { state: string; problems: unknown[] }[] = [];
		const engine = new CloudSync({
			store: old.store as never,
			kv: old.kv as never,
			api: () => api,
			onStatus: (s) => statuses.push(s),
		});
		// Signed in still, with the same account; no sign-in asked.
		expect((await engine.account())?.server).toBe(base);
		await engine.request();
		await engine.request();
		expect(statuses.at(-1)?.state).toBe("synced");
		expect(statuses.at(-1)?.problems).toEqual([]);
		expect((await old.store.listCases()).length).toBe(cases);
		// What 0.3.0 passed by is here now.
		const here = (await old.store.getCase(caseId)) as unknown as Case;
		expect(here.comments?.map((k) => k.text)).toEqual(["Before the upgrade"]);
		expect(here.closed?.user?.name).toBe("Dana Developer");
		// Up to here (the upgrade, and the case read again) nothing went:
		// no operation, no image, not even a question about one.
		expect(writes).toEqual([]);
		// And it keeps syncing both ways.
		await old.store.updateCase(caseId, (c) => ({
			value: withCaseComment(
				c as unknown as Case,
				{ id: `k_${caseId}_2`, text: "After the upgrade" },
				new Date().toISOString(),
			) as never,
		}));
		await engine.request();
		await dana.device.engine.request();
		expect(
			((await dana.device.store.getCase(caseId)) as Case).comments?.map(
				(k) => k.text,
			),
		).toEqual(["Before the upgrade", "After the upgrade"]);
		await change(dana.device, caseId, (c, now) =>
			withComment(c, "a1", "Total is cut off on small screens", now),
		);
		await dana.device.engine.request();
		await engine.request();
		expect(
			((await old.store.getCase(caseId)) as unknown as Case).annotations[0]
				?.comment,
		).toBe("Total is cut off on small screens");

		await removeCase(dana.device, caseId);
		await dana.device.engine.request();
		await dana.session.end(base);
		await session.end(base);
	}, 120_000);
});

/** A browser with 0.3.0's sync, signed in at the real server as 0.3.0 signs in. */
async function real030(base: string, email: string) {
	const kv = memoryKv030();
	const session = new Session030(kv, (input, init) => fetch(input, init));
	const { pending, url } = await beginSignIn030(
		base,
		await session.endpoints(base, true),
		process.env["SITEGLOSS_REDIRECT"] ??
			"https://ldmcfigcnobhnbaigehcaodheklibeon.chromiumapp.org/",
		Date.now(),
	);
	const ended = await signInWindow(base, email, url);
	await session.store(
		await exchangeCode030(
			(input, init) => fetch(input, init),
			pending,
			codeFrom030(pending, ended, Date.now()),
			Date.now(),
		),
	);
	const api = httpApi030({
		server: base,
		token: (fresh) => session.access(base, fresh),
	});
	const store = new MemoryStore030();
	const statuses: { state: string; problems: unknown[] }[] = [];
	// One database for the account and the sync, as the worker keeps them.
	const engine = new CloudSync030({
		store,
		kv,
		api: () => api,
		onStatus: (s) => statuses.push(s),
	});
	return { api, store, kv, engine, statuses, session };
}
