---
type: iteration
title: "Iteration 17: one coherent flow for tester, developer and tester again; a new look; Verify; sync without missed prompts"
status: completed
description: "Overnight plan of 2026-11-12/13 (the owner): a Fable UX review of the whole extension from the three roles, then a reworked flow (marking only inside an open case; All cases closes it), a new visual design with real contrast, a Verify step for the tester, and folder sync that does not depend on a missed Allow click (a Downloads subfolder as default, any folder as an option)."
timestamp: 2026-11-13T00:30:00+01:00
tags: [iteration, ui, ux, design, sync, verify]
---
# Iteration 17: UX rework, new look, Verify, sync

Written at the end of the tab-mcp-directory session of 2026-11-12 so that a new session
in this directory can pick it up. Everything below is the owner's, from the chat that
night, unless marked as a proposal.

## Goal (the owner)

"The goal is to have a tested, user friendly experience to annotate a page and then
fixing it." Check it from three roles:

1. **A tester** (QA, PM, PO) who wants something changed on a page: marks, writes
   comments, hands the case over (file, sync folder, or an AI app through tab-mcp).
2. **A developer** who fixes or changes the things: opens the case on their build
   (localhost, dev), sees each mark found on it, fixes, sets statuses / AI findings.
3. **The tester again**, who verifies on the new build that each fix really is one.

## Decisions taken (the owner, 2026-11-12, answered in chat)

- **Merging overnight:** merge each PR after the review (one pass, every finding fixed
  or answered) and green CI, `gh pr merge <n> --merge --delete-branch --author-email
  james@ractive.ch`. Rebuild `~/overmark-extension` from main afterwards
  (`bun run build --outdir ~/overmark-extension`). Nothing is released.
- **Redesign: free hand.** New look (palette, type, contrast, spacing) and restructured
  views and flows for tester → developer → tester. Features and the AI tools keep
  working; every step tested (unit + e2e).
- **Verify: build it.** After a developer marks something fixed, the tester on the new
  build gets **Verified** or **Reopen** (with a comment) per mark; the case shows open /
  fixed, to verify / verified. Designed together with the UX review. The AI tools
  (`set_mark_status` etc., kb/design/overview.md) need the new state too.
- **Sync: offer both.** Default: a subfolder of Downloads written through
  `chrome.downloads` (`conflictAction: "overwrite"`), which never asks again and works
  with the side panel closed (limits: only inside Downloads; each write shows in
  Chrome's download list; the optional `downloads` permission is asked once). Option:
  any folder through the File System Access API as now (DEC-021), with an Allow access
  that cannot be missed (banner at the top of the panel, "!" on the toolbar icon). The
  owner missed the current Allow access: "It was not obvious."
- Accepted from PR 42 (iteration 16, DEC-022) by using it ("It works much nicer! I open
  a case and it immediately loads"): the cases list without its Load button.

## The owner's feedback to act on

- **"← All cases" is too small**: "I missed it at first glance." Make it larger.
- **The case header is dark on dark without much contrast** (screenshot: the case's
  title, address/size/date chips, Hide marks, Add marks, Export, Delete, the found line
  and "Summary for the developer" on the navy panel). Fix in the new design.
- **"Continue annotating" outside a case is wrong**: on the home view (no case open)
  the button continues the case opened before. The owner: "I'd expect that you open a
  case, you can annotate and add marks, stop annotating etc. When you go back to
  '← All cases', the current case should be 'closed' and the annotations be removed and
  you shouldn't be able to 'Continue annotating'." So: marking only inside an open
  case (or "Annotate this page" starting a new one); All cases closes the case, takes
  the toolbar and its marks off the page.
- **The Allow button for sync was missed** (see Sync above).
- Earlier the same day (already in PR 42 or merged): the "on" badge became a green spark
  (#39); "This tab"/"This page" duplicate heading (PR 42); the no-access notice with
  "Allow on all sites" (PR 42).

## Still open from iteration 16 (PR 42)

[overmark#42](https://github.com/ractive/overmark/pull/42), branch `feat/auto-show`,
worktree `~/devel/overmark-wt/auto-show`. The review (claude) returned 5
findings; the agent that built it was asked to fix them when the session ended. Check
the branch's commits after 884a080 for what is done, and finish the rest before merging:

1. medium `src/sidepanel/main.ts` ~308: `follow()` has no staleness guard; A → B (busy) →
   A quickly leaves tab A in front without marks. Own `Latest` for follow; re-check the
   tab in front after the awaits.
2. medium main.ts ~1421: Hide on the page's own bar does not stop the `loadOnLoaded`
   retries; marks come back 1–3 s later. `stopLoads()` there; retries return when
   `hiddenOn.has(tabId)`.
3. medium main.ts ~1478: any URL change (hash, pushState) counts as a reload and redraws,
   dropping chosen candidates. Reload only on `complete` after `loading`, or a URL change
   other than the hash; same-document changes leave the marks.
4. low main.ts ~221: `loadInto`'s error paths write the hint before `work.current()`.
5. low `src/sidepanel/view.ts` ~127: `access()` says Chrome's own pages for a `file://`
   page with "Allow access to file URLs" off; use `chrome.extension.isAllowedFileSchemeAccess()`.

Open questions from PR 42, not answered by the owner; the UX review should settle them
(defaults in brackets): Hide holds through a reload of that tab [yes]; closing the side
panel leaves the marks on the page [yes, as before]. One unexplained e2e race: a click on
the element tool right after Add marks, while the automatic draw runs, was sometimes
lost under full-suite load (the test now waits for the draw).

Merge PR 42 first; iteration 17 builds on it.

## Plan

1. **UX review by a Fable agent** (the owner asked for "a fable … agent";
   `model: "fable"` in the Agent tool). Read-only on the code; it walks the three roles
   through the real extension (build, load it in Chrome for Testing as the e2e harness
   does, screenshots of each view and the on-page toolbar/overlay), and writes
   `kb/design/ux-review-2026-11.md`: what each role does step by step today, where it
   breaks or confuses, and a proposed flow and information architecture (views, states,
   what is primary on each), plus the Verify flow and the sync UI. Then a visual
   direction for the new look (tokens: colours with real contrast in light and dark,
   type scale, spacing, components), following the frontend-design guidance (no generic
   defaults; the side panel is narrow, ~360–420 px).
2. Record the decisions as DEC-023 (flow + Verify), DEC-024 (look), DEC-025 (sync both
   ways) in `kb/decision-log.md`, each with the owner's words above.
3. **Build in PRs**, each reviewed (`/review-pr`, claude reviewer in a background
   general-purpose agent, read-only, JSON findings), fixed, CI green, merged:
   - a. Flow: marking only in an open case; All cases closes it (toolbar and marks
     off the page); no "Continue annotating" on the home view; larger All cases.
   - b. Verify: the new mark state(s), the panel's Verified / Reopen with comment, the
     case's counts and bar, the AI tools and `case.md` export, import of older cases.
   - c. Sync: Downloads subfolder (default) + any folder (option) with the loud Allow.
   - d. The new look across the side panel and the on-page toolbar/overlay (shadow DOM
     CSS in `src/content/`), light and dark.
4. After each merge rebuild `~/overmark-extension`; in the morning report to the owner:
   what changed per role, the PRs, what to try, and anything left open.

## Working rules (from the owner and this repo)

- Bun; `bun run verify` before every commit, checking its exit code. Local Chrome e2e is
  unreliable when several runs compete or the display sleeps: run one e2e suite at a
  time; CI decides for e2e timeouts (re-run a failed job once if the failure is in code
  the PR did not touch).
- Worktrees under `~/devel/overmark-wt/<name>`, `node_modules` as a symlink to
  the main checkout's or its own install; never commit the symlink (`git add` explicit
  paths). A worktree on another client version needs its own `bun install`.
- Commits: `git -c user.email=james@ractive.ch commit`, trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`; no review section in
  PR bodies (the reconciliation goes to the owner in chat). Scan added lines for
  secrets before each commit.
- kb/ through hyalo (`hyalo lint`, `hyalo okf index`); a `kb/log.md` entry per change;
  keep both sides of `kb/log.md` merge conflicts.
- Coordination: message the master session only for NEEDS <project> or
  WAITING-ON-USER (`cmux agent message master --from overmark "…"`).
- Links to PRs and issues always as markdown links, never a bare `#N`.

## Status

- [x] PR 42 review findings fixed, CI green, merged
- [x] UX review written (`kb/design/ux-review-2026-11.md`)
- [x] DEC-023..025 recorded
- [x] Flow PR merged
- [x] Verify PR merged
- [x] Sync PR merged
- [x] New look PR merged
- [x] `~/overmark-extension` rebuilt from main; morning report

## Result (2026-11-13, 07:15)

Built overnight by one session directing builder and reviewer agents; every pull
request but two small ones (the documents, a ten-line test fix) had an independent
review whose findings were all fixed before the merge. Merged, in order:
[#42](https://github.com/ractive/overmark/pull/42) (iteration 16's review findings),
[#43](https://github.com/ractive/overmark/pull/43) (the UX review, DEC-023 to DEC-025),
[#44](https://github.com/ractive/overmark/pull/44) (tab-mcp client 0.15.0),
[#45](https://github.com/ractive/overmark/pull/45) (the code review and its first fixes),
[#47](https://github.com/ractive/overmark/pull/47) (Verify),
[#48](https://github.com/ractive/overmark/pull/48) (Sync),
[#49](https://github.com/ractive/overmark/pull/49) (`case.md`, the store listing),
[#46](https://github.com/ractive/overmark/pull/46) (Flow),
[#50](https://github.com/ractive/overmark/pull/50) (a test),
[#51](https://github.com/ractive/overmark/pull/51) (the look),
[#52](https://github.com/ractive/overmark/pull/52) (a load race the Flow change brought,
found by main's CI and by the look's builder, fixed the same night). Nothing is
released. `~/overmark-extension` is built from main at `dd2d0e2`.

The owner also asked that night for a code review of the whole extension
([the review](../research/code-review-2026-11.md)): CR-01, CR-03, CR-07, CR-08, CR-09
and CR-13 are fixed; what is left is in
[the open questions](../open-questions.md), with what only the owner can try or decide.
