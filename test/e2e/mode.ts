/**
 * Which end-to-end tests run, set in one place (DEC-053): `SITEGLOSS_E2E=full`
 * runs every one (`bun run test:e2e`, `test:firefox` and `test:server`, the
 * nightly run, a release); without it only the smoke set runs, the tests
 * whose describe is `inBothSets` and that are no `fullTest` (`bun test`,
 * `bun run verify`, CI on a pull request). Every end-to-end test runs in the
 * full set; none runs in neither.
 */

import { describe, test } from "bun:test";

/** The full end-to-end set, not only the smoke set. */
export const E2E_FULL = process.env["SITEGLOSS_E2E"] === "full";

/** In a describe of both sets: a test of the full set only. */
export const fullTest = test.skipIf(!E2E_FULL);

/** In a describe of both sets: a describe of the full set only. */
export const fullDescribe = describe.skipIf(!E2E_FULL);
