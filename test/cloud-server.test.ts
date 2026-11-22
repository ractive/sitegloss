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
	addedImage,
	type Case,
	withCaseComment,
	withChoice,
	withClosed,
	withComment,
	withImages,
	withoutCaseComment,
	withoutImage,
	withoutMark,
} from "../src/lib/case.ts";
import { eventsUrl, sha256Of } from "../src/lib/cloud/api.ts";
import {
	AuthError,
	discover,
	refreshTokens,
	TOKENS_KEY,
	type Tokens,
} from "../src/lib/cloud/auth.ts";
import type { Account } from "../src/lib/cloud/book.ts";
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
	tagOf,
	webp,
} from "./cloud-helpers.ts";
import { SERVER as BASE, real } from "./cloud-real.ts";

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
		expect(demo.marks.length).toBeGreaterThanOrEqual(5);
		expect(demo.pages?.length).toBe(2);
		expect(demo.importedAt).toBeUndefined();
		expect(
			Object.values(await images(tess.device, "demo_case_1")),
		).not.toContain("MISSING");
		const crop = await tess.device.store.getImage(
			"demo_case_1",
			demo.marks[0]?.crop as string,
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
		expect(there.marks[0]?.createdBy?.name).toBe("Tess Tester");
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
			withChoice(c, "m1", "fixed", "Widened the column", now),
		);
		await dana.device.engine.request();
		for (let i = 0; i < 50 && heard.length === before; i++)
			await new Promise((r) => setTimeout(r, 100));
		expect(heard.length).toBeGreaterThan(before);
		await tess.device.engine.request();
		const mine = (await tess.device.store.getCase(id)) as Case;
		expect(mine.marks[0]?.resolution).toMatchObject({
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
				["m1", "Total is cut off"],
				["m2", "Pay button too pale"],
				["m3", "Tess's third"],
				["m4", "Dana's third"],
			]);
		expect(await images(dana.device, id)).toEqual(
			await images(tess.device, id),
		);

		// Two changes to one mark: both stay.
		await change(tess.device, id, (c, now) =>
			withComment(c, "m2", "Edited by Tess", now),
		);
		await change(dana.device, id, (c, now) =>
			withChoice(c, "m2", "wontfix", "", now),
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
			await change(dana.device, id, (c, now) => withoutMark(c, gone, now));
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

	test("the thread, closing and the app's name (DEC-046)", async () => {
		const caseId = `c_th${Date.now().toString(36)}`;
		const tess = await real(base, "tess", "tess@example.com");
		const dana = await real(base, "dana", "dana@example.com");
		await signIn(tess.device);
		await signIn(dana.device);
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
		const first = marks.marks[0]?.id as string;
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
					: there.marks.find((a) => a.id === k.mark)?.number,
			]),
		).toEqual([
			[`k_${caseId}_1`, "Both pages checked.", "Tess Tester", null, null],
			[`k_${caseId}_2`, "Fixed in PR 12.", "Tess Tester", "Claude", 1],
		]);
		expect(there.closed?.user?.name).toBe("Tess Tester");
		expect(there.closed?.app?.name).toBe("Claude");

		// Deleted here: the other device has it no more.
		await change(tess.device, caseId, (c, now) =>
			withoutCaseComment(c, `k_${caseId}_1`, now),
		);
		await tess.device.engine.request();
		await dana.device.engine.request();
		expect(
			((await dana.device.store.getCase(caseId)) as Case).comments?.map(
				(k) => k.id,
			),
		).toEqual([`k_${caseId}_2`]);

		await removeCase(tess.device, caseId);
		await tess.device.engine.request();
		await tess.session.end(base);
		await dana.session.end(base);
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
			marks: c.marks.map((x) =>
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
		const there = ((await dana.device.store.getCase(caseId)) as Case).marks[0];
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
		const after = ((await dana.device.store.getCase(caseId)) as Case).marks[0];
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
			marks: c.marks.map((x) =>
				x.id === a.id && x.element !== null
					? { ...x, element: { ...x.element, ...look } }
					: x,
			),
			updatedAt: now,
		}));
		await tess.device.engine.request();
		expect(status(tess.device)?.problems).toEqual([]);
		await dana.device.engine.request();
		const there = ((await dana.device.store.getCase(caseId)) as Case).marks[0];
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

serverTest("images added to a mark at a real server (DEC-058)", () => {
	const base = BASE as string;

	test("one device adds an image, the other sees it with who added it; removed there, it goes here", async () => {
		const caseId = `c_im${Date.now().toString(36)}`;
		const tess = await real(base, "tess", "tess@example.com");
		const dana = await real(base, "dana", "dana@example.com");
		await signIn(tess.device);
		await signIn(dana.device);
		await startCase(tess.device, caseId);
		await addMark(tess.device, caseId, "The menu closes", { element: true });
		await tess.device.engine.request();
		const a = ((await tess.device.store.getCase(caseId)) as Case)
			.marks[0] as Case["marks"][number];
		const imageId = `i_${caseId}`;
		await tess.device.store.updateCase(caseId, (current) => ({
			value: withImages(
				current as Case,
				a.id,
				[imageId],
				new Date().toISOString(),
			),
			images: new Map([
				[
					addedImage(imageId),
					{ blob: webp("the open menu", 640, 400), width: 640, height: 400 },
				],
			]),
		}));
		await tess.device.engine.request();
		expect(status(tess.device)?.problems).toEqual([]);
		await dana.device.engine.request();
		const there = (await dana.device.store.getCase(caseId)) as Case;
		const added = there.marks[0]?.images?.[0];
		expect(added?.id).toBe(imageId);
		expect(added?.added.user?.name).toBe("Tess Tester");
		const file = await dana.device.store.getImage(caseId, addedImage(imageId));
		expect(file ? await tagOf(file.blob) : "MISSING").toBe("the open menu");

		// Removed on Dana's device: gone on Tess's, its file too.
		await dana.device.store.updateCase(caseId, (current) => {
			const { value, images } = withoutImage(
				current as Case,
				there.marks[0]?.id as string,
				imageId,
				new Date().toISOString(),
			);
			return { value, deleteImages: images };
		});
		await dana.device.engine.request();
		expect(status(dana.device)?.problems).toEqual([]);
		await tess.device.engine.request();
		const back = (await tess.device.store.getCase(caseId)) as Case;
		expect(back.marks[0]?.images).toBeUndefined();
		expect(
			await tess.device.store.getImage(caseId, addedImage(imageId)),
		).toBeUndefined();

		await removeCase(tess.device, caseId);
		await tess.device.engine.request();
		await tess.session.end(base);
		await dana.session.end(base);
	}, 120_000);

	test("past six: the service refuses a seventh with limit; a device's late image is held back and the mark's comment still goes", async () => {
		const caseId = `c_ix${Date.now().toString(36)}`;
		const tess = await real(base, "tess", "tess@example.com");
		const dana = await real(base, "dana", "dana@example.com");
		await signIn(tess.device);
		await signIn(dana.device);
		await startCase(tess.device, caseId);
		await addMark(tess.device, caseId, "The menu closes", { element: true });
		await tess.device.engine.request();
		const markId = ((await tess.device.store.getCase(caseId)) as Case).marks[0]
			?.id as string;
		const add = (d: typeof tess.device, tags: string[]) =>
			d.store.updateCase(caseId, (current) => {
				const ids = tags.map((t) => `i_${caseId}_${t}`);
				return {
					value: withImages(
						current as Case,
						markId,
						ids,
						new Date().toISOString(),
					),
					images: new Map(
						ids.map((id, i) => [
							addedImage(id),
							{
								blob: webp(`picture ${tags[i]}`, 64, 40),
								width: 64,
								height: 40,
							},
						]),
					),
				};
			});
		await add(tess.device, ["a", "b", "c", "d", "e"]);
		await tess.device.engine.request();
		await dana.device.engine.request();
		// Both add a sixth, neither knowing of the other's.
		await add(tess.device, ["f"]);
		await tess.device.engine.request();
		await add(dana.device, ["g"]);
		await change(dana.device, caseId, (c, now) =>
			withComment(c, markId, "Seen on Firefox too", now),
		);
		await dana.device.engine.request();
		await dana.device.engine.request();
		const teamId = (await tess.device.engine.account())?.teamId as string;
		const there = await tess.device.api.getCase(teamId, caseId);
		const wire = there?.marks[0];
		expect(wire?.images).toHaveLength(6);
		expect(wire?.comment).toBe("Seen on Firefox too");
		const mine = ((await dana.device.store.getCase(caseId)) as Case).marks[0];
		expect(mine?.images).toHaveLength(6);
		expect(mine?.heldImages?.map((x) => x.id)).toEqual([`i_${caseId}_g`]);
		expect(status(dana.device)?.problems).toEqual([]);

		// The service's own answer to a seventh, which the sync holds back.
		const blob = webp("a seventh", 64, 40);
		const sha256 = await sha256Of(blob);
		await dana.device.api.putBlob(teamId, sha256, blob);
		const answer = await dana.device.api.ops(teamId, [
			{
				opId: `o_${caseId}`,
				type: "mark.patch",
				markId: wire?.id as string,
				images: {
					add: [
						{
							id: `i_${caseId}_x`,
							image: { sha256, width: 64, height: 40, bytes: blob.size },
						},
					],
				},
			},
		]);
		expect(answer.results[0]?.status).toBe("rejected");
		expect(answer.results[0]?.error?.code).toBe("limit");
		expect(answer.results[0]?.error?.message).toContain("at most 6 images");

		await removeCase(tess.device, caseId);
		await tess.device.engine.request();
		await tess.session.end(base);
		await dana.session.end(base);
	}, 120_000);
});
