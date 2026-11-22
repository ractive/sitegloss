---
type: iteration
title: "Iteration 4: AI apps through tab-mcp"
status: in-progress
description: "TabMcp in the side panel with a relay setting and the connect dialog, and the tools list_cases, get_case, get_image, load_case, highlight, capture, add_mark, set_verdict and delete_case."
timestamp: 2026-11-04T17:00:00+01:00
tags: [iteration, mcp]
---
# Iteration 4: AI apps through tab-mcp

## Scope

- `@ractive-ch/tab-mcp-client` in the side panel: the relay's address is a setting
  (default `http://localhost:8080`); Connect opens the library's dialog; "Keep AI access
  on" connects again when the side panel opens.
- Tools as in the [design](../design/overview.md#tools-for-the-ai-app), built by a
  factory over a store, the tab in front and image functions, so they are tested in Bun
  against fakes and through a real relay (`startTestRelay`, `tokenFor`) with the MCP
  client.
- Images in results: WebP, scaled to at most 1568 px, and a result stays well under the
  relay's 1 MiB message limit (`get_image` for the rest).
- README: running a relay that allows Overmark's extension ID, and connecting Claude
  Code.

## Tasks

- [x] `src/sidepanel/tools.ts` (factory) with tests
- [x] `src/sidepanel/mcp.ts` and the side panel's AI section
- [x] Test through `startTestRelay` and the MCP client
- [x] README: relay and Claude Code
- [x] Review, PR
