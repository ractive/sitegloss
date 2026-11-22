---
type: iteration
title: "Iteration 3: export, import and loading onto another build"
status: in-progress
description: "Export a case as a zip with case.json, case.md and WebP images; import it; load a case onto the tab in front, find each mark's element by a weighted similarity score, and highlight it with its confidence."
timestamp: 2026-11-04T17:00:00+01:00
tags: [iteration, matching, export]
---
# Iteration 3: export, import and loading onto another build

## Scope

- Export: `<title>.overmark.zip` with `case.json`, `case.md` and the images, written with
  the iteration 1 zip writer; downloaded from the side panel.
- `case.md`: title, page, date, window size, verdict, and per mark its number,
  kind, comment, element summary and image links; what a dev or an AI app reads without
  the extension.
- Import: a zip from the side panel; the case is validated; an existing case with the same
  id is replaced.
- Matching (`src/lib/match.ts`): weighted similarity over the element details as in the
  [design](../design/overview.md#finding-an-element-again); results found, probable,
  ambiguous (with candidates) and not found.
- Loading onto the tab in front: numbered outlines in the page (colour by confidence);
  the side panel lists each mark's result, shows and steps through candidates,
  and keeps not-found marks with their crop.

## Tasks

- [x] `src/lib/export.ts` and `src/lib/markdown.ts` with tests (round trip through the zip)
- [x] `src/lib/match.ts` with tests: changed CSS module hashes, generated ids, reordered layout, changed text, missing element
- [x] Content script: describe candidates, highlight, step through candidates
- [x] Side panel: export, import, load onto this tab, results
- [x] End-to-end: a case from test page v1 loads onto v2 (other classes, ids, order) and finds its element
- [x] Review, PR
