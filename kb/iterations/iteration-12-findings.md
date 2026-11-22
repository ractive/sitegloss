---
type: iteration
title: "Iteration 12: AI findings on marks, and the summary for the developer"
status: completed
description: "An AI app adds findings of its own to a mark, apart from the user's comment, and edits or deletes only its own (by its client id); the user deletes any in the side panel; the case's Verdict becomes the Summary for the developer, set_verdict becomes set_summary, the stored field stays verdict (DEC-019)."
timestamp: 2026-11-11T12:00:00+01:00
tags: [iteration, mcp, ui]
---
# Iteration 12: AI findings on marks, and the summary for the developer

The owner decided on 2026-11-10 that an AI app records what it finds out about a mark as
findings of its own, kept apart from the user's comment, and that the case's "Verdict"
becomes the "Summary for the developer". The decision is DEC-019.

## Scope

- `src/lib/case.ts`: `Finding` and `FindingApp` on `Mark.findings`, their
  validation and limits (`MAX_FINDING`, `MAX_FINDINGS`, `MAX_FINDINGS_TEXT` per case),
  `withFinding`, `withFindingText`, `withoutFinding`, `isOwnFinding`, `appLabel`;
  lengths in code points (`textLength`, `cutText`).
- Tools: `add_finding`, `edit_finding`, `delete_finding` (own findings only, by the
  caller's client id); get_case's findings with `own`; `set_verdict` becomes
  `set_summary`, and `verdict` becomes `summary` in list_cases and get_case; the
  instructions; the questions name the mark and the finding; a large case's get_case
  shows each finding as a 200-character preview (`cut: true`).
- Side panel: a mark's AI findings under its comment with the app and the time, Delete
  asking once more, the count in the mark's head; "Summary for the developer" with its
  placeholder, "Save summary", the case list's preview.
- Export and import: findings round-trip, an import marks them as from the file; case.md
  lists them under their mark and has "Summary for the developer".
- README, PRIVACY.md, the design overview, the store listing notes, DEC-019, the log.

## Tasks

- [x] The model, its validation and changes, with unit tests
- [x] The findings tools and set_summary, with unit tests (own, another app's, from a
      file, limits, the questions)
- [x] The side panel: findings under the mark, Delete twice, the summary's wording
- [x] Export and import: round trip, old files, findings from a file
- [x] End-to-end: the AI app adds a finding after Allow, the panel shows it with the
      app, another app's edit and delete are refused, the user deletes it
- [x] Tests that called set_verdict updated
- [x] Docs
- [x] Review of PR 33: deleting a finding keeps the mark's unsaved form; the panel's
      Delete state per mark and finding; lengths in code points; at most 200,000
      characters of findings per case, and previews in a large get_case

## Left open

- The page's mark popover does not show findings; only the side panel and case.md do.
- The user cannot edit a finding: it is the app's text. They can delete it, or write in
  the comment.
- A question for another app's finding is still asked, though the tool refuses it
  (DEC-019).

# Citations

- [tab-mcp-client: ToolExecuteOptions and ToolCallClient (the caller's client id)](https://github.com/ractive/tab-mcp/tree/main/packages/tab-mcp-client)
