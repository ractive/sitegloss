/**
 * 0.3.0's database as this build's store opens it: its upgrade to version 2
 * (DEC-051) brings every case to `sitegloss/2` before anything reads one.
 * `IdbStore` does it in IndexedDB's upgrade (`test/e2e/store.test.ts`); this
 * is the same for 0.3.0's `MemoryStore`, which the sync's tests use.
 */

import { upgradeStoredCase } from "../src/lib/store.ts";
import type { Case as Case030 } from "./compat/v0.3.0/src/lib/case.ts";
import type { MemoryStore as MemoryStore030 } from "./compat/v0.3.0/src/lib/store.ts";

export function openedByThisBuild(store: MemoryStore030): MemoryStore030 {
	for (const [id, c] of store.cases)
		store.cases.set(id, upgradeStoredCase(c) as Case030);
	return store;
}
