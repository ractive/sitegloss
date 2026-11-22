---
type: iteration
title: "Iteration 2: mark and save"
status: in-progress
description: "Drawing tools on the page (element, box, arrow, pen, note) with a comment each, element details, and saving a named case with screenshots with their marks and crops into IndexedDB; the side panel lists and shows cases."
timestamp: 2026-11-04T17:00:00+01:00
tags: [iteration, content-script, storage]
---
# Iteration 2: mark and save

## Scope

- Toolbar in the overlay: Element (hover and click), Box, Arrow, Pen, Note; Undo; Save;
  Close; Esc ends a tool. After each shape a comment field; shapes are numbered.
- Shapes are drawn in document coordinates while marking, so the page can scroll.
- Element details (`src/lib/element.ts`): tag, readable id, test id, role, accessible
  name, text, readable classes, chosen attributes, heading above, landmark, ancestors,
  position and size, a best-effort CSS selector. The element of a box or pen mark is the
  smallest element that mostly covers it; of an arrow, the element at its head; of a
  note, the element under it.
- Saving: the marks are grouped into viewport-sized windows; for each, the page
  scrolls there, the toolbar hides, the service worker captures the visible tab (at most
  two captures a second), converts it to WebP and stores it; shapes are translated into
  that screenshot's coordinates; a crop per mark. An option blurs form fields
  while capturing (password fields always).
- A case has a title; new marks can be added to an existing case.
- Side panel: list of cases (this page first), a case view with the screenshots, the
  marks (crop, comment, element), the verdict field, delete.

## Tasks

- [x] `src/lib/case.ts` (types, validation), `src/lib/classes.ts` (readable classes, generated ids), `src/lib/element.ts` with tests (happy-dom)
- [x] `src/lib/store.ts` (IndexedDB, plus a memory store for tests), `src/lib/images.ts`
- [x] Overlay tools, comment popover, numbering, undo
- [x] Save pipeline and the service worker's capture and crops
- [x] Side panel list and case view
- [x] End-to-end: draw a box and save; the case and its images are in IndexedDB
- [x] Review, PR
