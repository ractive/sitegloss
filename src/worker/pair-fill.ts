/**
 * Filling in Sitegloss's pairing code on the relay's pairing page (DEC-044,
 * tab-mcp's DEC-199): the parts the side panel needs too. The rules are the
 * client library's (`CodeFiller` of `@ractive-ch/tab-mcp-client/extension`,
 * tab-mcp's DEC-206); how Sitegloss asks is `fill-question.ts`, the wiring
 * `connection.ts`, the page's script `src/content/pairing.ts`.
 *
 * Only the hosted relay's page (`HOSTED_ORIGIN`): a relay typed into the
 * panel's Relay field gets no fill-in, and Sitegloss asks the browser only
 * for that one site (`PAIR_FILL_SITE`), with the click that turns it on.
 */

import { DEFAULT_RELAY } from "./settings.ts";

/** The hosted relay's origin: the one origin whose page Sitegloss fills in. */
export const HOSTED_ORIGIN = new URL(DEFAULT_RELAY).origin;

/** The optional host access the panel asks for (`permissions.request`). */
export const PAIR_FILL_SITE = { origins: [`${HOSTED_ORIGIN}/*`] };
