/**
 * A screenshot's query (DEC-050): `keptQuery` held to the contract's table
 * and to the server's own vectors, and what a screenshot keeps of it.
 */

import { describe, expect, test } from "bun:test";
import {
	keptQuery,
	MAX_QUERY,
	nameWords,
	queryOf,
	SECRET_NAMES,
	SECRET_WORDS,
	storedQuery,
	withQuery,
} from "../src/lib/query.ts";
import vectors from "./kept-query.json" with { type: "json" };

describe("keptQuery", () => {
	test("the contract's table", () => {
		const hex48 = "0123456789abcdef".repeat(3);
		const table: [string, string][] = [
			["q=shoes&sort=price", "q=shoes&sort=price"],
			["keyword=shoes&page=2", "keyword=shoes&page=2"],
			// The word `code` in `countryCode`: a known cost, accepted.
			["zipcode=8000&countryCode=CH", "zipcode=8000"],
			["q=shoes&token=abc", "q=shoes"],
			["access_token=x&apiKey=y&api-key=z&q=1", "q=1"],
			["code=4%2FabC&state=xyz", ""],
			[
				"X-Amz-Signature=ab12&X-Amz-Credential=AK%2F2026&versionId=3",
				"versionId=3",
			],
			["user=jane%40example.com&tab=orders", "tab=orders"],
			[
				"id=2f1c1e8a-7c7e-4b7e-9d3a-0a1b2c3d4e5f",
				"id=2f1c1e8a-7c7e-4b7e-9d3a-0a1b2c3d4e5f",
			],
			[`magic=${hex48}`, ""],
			["a=1&&b=2&", "a=1&b=2"],
			["q=%E0%A4%A&x=1", "x=1"],
			["q=caf%C3%A9+au+lait", "q=caf%C3%A9+au+lait"],
		];
		for (const [given, kept] of table) expect(keptQuery(given)).toBe(kept);
	});

	test("the server's own vectors, and the same word lists", () => {
		// test/kept-query.json is sitegloss.dev's packages/api/vectors/kept-query.json.
		expect(vectors.vectors.length).toBeGreaterThan(100);
		for (const v of vectors.vectors)
			expect({ in: v.in, out: keptQuery(v.in) }).toEqual({
				in: v.in,
				out: v.out,
			});
		expect([...SECRET_WORDS]).toEqual(vectors.words);
		expect([...SECRET_NAMES]).toEqual(vectors.names);
	});

	test("names: words at every other character and at camelCase steps", () => {
		expect(nameWords("countryCode")).toEqual(["country", "code"]);
		expect(nameWords("X-Amz-Signature")).toEqual(["x", "amz", "signature"]);
		expect(nameWords("access_token")).toEqual(["access", "token"]);
		expect(nameWords("XMLHttpRequest")).toEqual(["xml", "http", "request"]);
		expect(nameWords("oauth2Token")).toEqual(["oauth2", "token"]);
		// Joined, a well-known name.
		expect(keptQuery("PHPSESSID=abc&JSESSIONID=def&SAMLResponse=x&p=1")).toBe(
			"p=1",
		);
		// A word inside another is no word of its own.
		expect(keptQuery("keyword=a&passage=b&codec=c&stateful=d")).toBe(
			"keyword=a&passage=b&codec=c&stateful=d",
		);
		// The name is decoded first: `api%5Fkey` is `api_key`.
		expect(keptQuery("api%5Fkey=1&my+token=2&q=3")).toBe("q=3");
	});

	test("values: an e-mail address, a JWT, a long opaque value", () => {
		expect(keptQuery("to=a%40b.example&q=1")).toBe("q=1");
		expect(keptQuery("t=eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl&q=1")).toBe("q=1");
		// 39 characters stay; 40 go.
		expect(keptQuery(`v=${"a".repeat(39)}`)).toBe(`v=${"a".repeat(39)}`);
		expect(keptQuery(`v=${"a".repeat(40)}`)).toBe("");
		// Long, but with other characters: a sentence, kept.
		const sentence = encodeURIComponent(
			"a long search for shoes in red or blue please",
		);
		expect(keptQuery(`q=${sentence}`)).toBe(`q=${sentence}`);
	});

	test("kept byte for byte, in order; a piece without = is a name alone", () => {
		expect(keptQuery("b=%7E2&a&c=")).toBe("b=%7E2&a&c=");
		expect(keptQuery("token")).toBe("");
		expect(keptQuery("")).toBe("");
		expect(keptQuery("&&&")).toBe("");
	});

	test("never throws", () => {
		for (const odd of ["%", "%%", "a=%ZZ", "%E0=1", "=", "==", "a==b"])
			expect(() => keptQuery(odd)).not.toThrow();
		expect(keptQuery("a=%ZZ&b=1")).toBe("b=1");
		expect(keptQuery("a==b")).toBe("a==b");
	});
});

describe("what a screenshot keeps", () => {
	test("the query of an address, none when nothing is kept", () => {
		expect(queryOf("https://shop.example/search?q=shoes&token=x#top")).toBe(
			"q=shoes",
		);
		expect(queryOf("https://shop.example/search?token=x")).toBeUndefined();
		expect(queryOf("https://shop.example/search")).toBeUndefined();
		expect(queryOf("not an address")).toBeUndefined();
		// A hash route's own parameters are not the query (out of scope).
		expect(queryOf("https://app.example/#/search?q=shoes")).toBeUndefined();
	});

	test("longer than 1024 code points: dropped whole, never cut", () => {
		const piece = (i: number) => `p${i}=${"é".repeat(10)}`;
		const pieces = Array.from({ length: 200 }, (_, i) => piece(i));
		const long = pieces.join("&");
		expect(storedQuery(long)).toBeUndefined();
		// Exactly the limit, in code points (é is one, not two units).
		const exact = `q=${"é".repeat(MAX_QUERY - 2)}`;
		expect(storedQuery(exact)).toBe(exact);
		expect(storedQuery(`${exact}x`)).toBeUndefined();
	});

	test("a file's query is filtered again; anything else is no query", () => {
		expect(storedQuery("q=1&token=2")).toBe("q=1");
		expect(storedQuery("?q=1")).toBe("q=1");
		expect(storedQuery("token=2")).toBeUndefined();
		for (const odd of [1, null, {}, [], true])
			expect(storedQuery(odd)).toBeUndefined();
	});

	test("the plain address with its query, before a hash route", () => {
		expect(withQuery("https://shop.example/search", "q=shoes")).toBe(
			"https://shop.example/search?q=shoes",
		);
		expect(withQuery("https://app.example/#/list", "tab=2")).toBe(
			"https://app.example/?tab=2#/list",
		);
		expect(withQuery("https://shop.example/", undefined)).toBe(
			"https://shop.example/",
		);
	});
});

describe("keptQuery on hostile input", () => {
	test("linear: the vectors' longest entries take a few milliseconds each", () => {
		const long = vectors.vectors.filter((v) => v.in.length >= 4000);
		expect(long.length).toBeGreaterThan(2);
		for (const v of long) {
			const start = performance.now();
			expect(keptQuery(v.in)).toBe(v.out);
			expect(performance.now() - start).toBeLessThan(50);
		}
	});

	test("an e-mail address or a JWT encoded twice or three times is found; four times is a known limit", () => {
		expect(keptQuery("x=jane%2540example.com&q=1")).toBe("q=1");
		expect(keptQuery("x=jane%252540example.com&q=1")).toBe("q=1");
		expect(keptQuery("x=jane%25252540example.com")).toBe(
			"x=jane%25252540example.com",
		);
		// A later decoding that fails only ends the rounds.
		expect(keptQuery("q=100%2525")).toBe("q=100%2525");
		// Longer than an address may be: nothing is parsed.
		expect(keptQuery(`q=${"a".repeat(8000)}`)).toBe("");
	});
});

describe("a query inside a value (amendment 5)", () => {
	test("a secret in a return address's own query drops the piece", () => {
		for (const piece of [
			"next=%2Freset%3Ftoken%3Dabc123def",
			"returnUrl=/reset?token=abc123",
			"redirect=https%3A%2F%2Fx.com%2Fcb%3Faccess_token%3Dabc",
			"next=%252Fcb%253Fsession%253Dxyz",
			"back=/a;sig=1",
		])
			expect(keptQuery(`${piece}&q=1`)).toBe("q=1");
		// A plain value with an = stays, and a return address without a secret.
		expect(keptQuery("q=a=b&filter=price=10&next=%2Fcart%3Fstep%3D2")).toBe(
			"q=a=b&filter=price=10&next=%2Fcart%3Fstep%3D2",
		);
	});

	test("still linear: nested queries of the longest allowed length take a few milliseconds", () => {
		for (const hostile of [
			`x=${"a=b&".repeat(1999)}`,
			`x=${"%3Fa%3Db".repeat(999)}`,
			`x=${"?=".repeat(3999)}`,
			`x=${"%253D%2526".repeat(799)}`,
		]) {
			expect(hostile.length).toBeLessThanOrEqual(8000);
			const start = performance.now();
			keptQuery(hostile);
			expect(performance.now() - start).toBeLessThan(50);
		}
	});
});
