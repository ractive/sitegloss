---
type: questions
title: "Open questions for the owner"
description: Decisions the plan needs from the owner, or from the IT of an organisation that tries Sitegloss, before the pilot and the store listing.
tags:
  - questions
timestamp: 2026-11-04T17:00:00+01:00
---

# Open questions for the owner

1. **Relay for POs.** claude.ai and Claude Desktop connect from Anthropic's servers and
   need a relay with a public HTTPS address that allows Sitegloss's extension ID. The
   hosted `tab-mcp.ractive.ch` allows the development build's ID since relay 0.7.1 and is
   the side panel's default; the store build's ID still has to be added there
   (`kb/operations/chrome-web-store.md`, step 5). Open: does an organisation that
   tries Sitegloss accept that relay for POs, or run its own?
2. **An organisation's IT.** Is Developer mode allowed on company machines ("Load unpacked")? Is
   Chrome managed by policy, so IT could install Sitegloss?
3. **Test ids.** Do the frontends it is used on have `data-testid` (or similar) attributes?
   They make finding elements again far more reliable.
4. **Visibility.** The repository was created private. Make it public (MIT, like
   tab-mcp)?
5. **Store account.** Publish under which Chrome Web Store developer account (one-time
   US$5, trader declaration)?
6. **To try by hand after iteration 17** (none of it can be run in the headless test
   browser). (a) In the real build, click "Sync to Downloads" and say yes to Chrome's
   question: are the cases written at once? It is not verified that a service worker
   that is already running gets `chrome.downloads` right after the grant; if it does
   not, the sync says so and starts when Chrome restarts Sitegloss's background
   (DEC-025). (b) Does Chrome's downloads bubble open on each write (changes are
   gathered for 2 s first)? (c) With Chrome's "Ask where to save each file" on, the
   sync fails and says to turn it off or choose a folder: is that acceptable?
7. **Decided overnight without the owner, to confirm or change.** (a) A Chrome
   notification whose question's arguments do not fit offers only "Don't allow" and
   sends the user to the side panel (DEC-018, amended): otherwise text is allowed
   unseen. (b) An AI app changes a verified mark only by reopening it (DEC-023).
   (c) `get_mark_element` refuses `:has()` and `:empty` altogether, and state
   pseudo-classes and value attributes in a selector (DEC-013, amended). (d)
   `PRIVACY.md` now says that computed styles and positions can reflect a field's
   state where the page's own CSS styles it by state, as a screenshot does. (e) "Stop
   syncing" gives the `downloads` permission back when the sync was what asked for it.
   (f) Not done, the stronger option: keeping Allow off until a question's arguments
   were scrolled to their end.
   (g) DEC-027 lets the page's popover change a mark's comment and status and delete
   a mark of the case drawn on that tab, through the panel that has the case open. A compromised renderer
   of that page could do the same; before, it could only add marks and read the case.
   The stricter variant: the pin only shows the mark in the panel, and every change is
   made there.
8. **Left from the code review** ([the review](research/code-review-2026-11.md)).
   Medium: CR-02, a content script orphaned by an update puts its toolbar back and its
   listeners stay (needs one teardown for every listener in `adding.ts`,
   `overlay.ts`, `review.ts`). Low: CR-04, CR-05, CR-06, CR-10, CR-11, CR-12, CR-14,
   CR-15, and the six unverified ones (P-01 to P-06). Its architecture section names
   the cause of most of the bugs the reviews found that night: the page's adding queue
   and the panel's follow variables are a second, untested state beside the one state
   object each side was given (DEC-010, DEC-011).
9. **CI was flaky, about one run in three** (2026-11-13, `fix/e2e-flakes`).
   `shipped.test.ts` timing out after the icon's click had three causes, reproduced in a
   2-CPU Linux container with Chromium 156: a click while the page loads put the script
   into the page on its way out, and Chrome refuses the script now and then right after
   a click (both fixed in the worker: injected again after the load, tried again after
   250 ms); the panel dropped the news that the click let Sitegloss onto the tab when it
   came before the panel had noted that the case waits there (fixed); and the test
   clicked a new tab before its first page had come (fixed in the test, which now
   clicks once the page has loaded and waits for the panel's notice of that tab; the
   early click, which Chrome grants nothing, has a test of its own: nothing goes in,
   the panel asks on that tab, and the click again loads the case). **Still
   open:** the `beforeAll` of the suites that pair an AI app over the test relay hanging
   for its 60 s was not reproduced here (Mac and container, under load). Every setup
   step is now logged on stderr with a time and has its own limit, so the next hang in
   CI names its step (the last `[e2e …]` line without "done"); `putCases`, which could
   wait for ever, no longer can, but there is no evidence it was the cause. Also still
   there: two tests of `test/view.test.ts` fail when its tests run in another order
   (`--randomize`), and an export test's sizes leave about 470 bytes of margin for a
   longer `case.md` preamble.
10. **Dependabot's Biome 2.6.6** pull request fails CI and was not looked at.
10. **Team sync (DEC-039): known limits, and what is the owner's to decide.**
    (a) A mark that takes another number from the server (two people added a mark at
    once) keeps the old number on its pin in the screenshot and in its crop: the image
    is not painted again. The list, the page and the AI tools show the new number.
    Painting it again would need the screenshot without marks, which is not kept.
    (b) Ids are global at a server: a case that synced with one team cannot be shared
    with another team of the same server (another server is no trouble, DEC-041), and a case the team deleted cannot be shared again from a device that
    kept it. The server says "The case's id is taken", and the panel shows that.
    Export and "Keep both" on import make a copy with a new id. Giving such a case a
    new id on "Share with team" would be the fix here.
    (c) Signing out ends the refresh token at the server; the access token is a signed
    one and holds until it runs out (an hour). It is wiped from the browser at once.
    (d) Refresh tokens rotate, and the plan says that a used one, used again, ends the
    grant. A refresh whose answer is lost (the worker stopped between the request and
    the write) would then leave the browser with a used refresh token, and the user
    would have to sign in again; nothing would be lost. The local server of 2026-11-19
    took a used refresh token a second time, so this did not happen there: whichever
    is meant, a short grace period for the previous token is what the extension needs.
    (e) The list of pages is the server's, in the order the pages' first screenshots
    reached it. Marks made offline on two devices can so list the pages in another
    order than either device had, and `page` (the first page) follows the server's.
    (f) The toolbar icon's badge says nothing about the team sync (a sign-in that ran
    out, changes the server refused); the panel's banner and Team section do.
    (g) Mark-level actions are not switched off by permission in the panel (only
    sharing a case and deleting a synced one are): with today's roles everyone may do
    them. A change the role does not allow is not sent, stays here and is said.
    (h) Settled in DEC-045: the account stays on Home, as its own section "Team"
    after the cases; the copy to a folder is "Copy to a folder", under Files, and
    "sync" means only the team's.
11. **tab-mcp client** (settled): 0.19.0 renamed `newAddress()` to `disconnectAll()` (DEC-049) 0.21.0 changed nothing here (DEC-056), and 0.22.0 is in use (DEC-062); nothing is open.
