/**
 * The case format and what is done with it, in four parts under `case/`:
 * the format itself, which page an address is, reading a case from outside,
 * and changes to a case. Everything is imported from here; what the parts
 * share among themselves only (`case/internal.ts`) is not exported.
 */

export * from "./case/edits.ts";
export * from "./case/format.ts";
export * from "./case/pages.ts";
export * from "./case/validation.ts";
