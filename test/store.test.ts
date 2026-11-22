import { describe, test } from "bun:test";
import { MemoryStore } from "../src/lib/store.ts";
import { storeContract } from "./store-contract.ts";

describe("MemoryStore", () => {
	for (const [name, run] of Object.entries(storeContract))
		test(name, () => run(new MemoryStore()));
});
