---
type: design
title: "Images a person adds to a mark"
description: >-
  Design, not built, for pictures a person pastes, chooses or drops onto a mark. It covers
  the data model and case file, the service's API and storage, sync, the side panel's
  dialog, limits and re-encoding, privacy, and the order of the pull requests. Written on
  22 November 2026 against both main checkouts and put on the backlog the same day.
tags:
  - design
  - backlog
timestamp: 2026-11-22T19:00:00+01:00
---

# Images a person adds to a mark: design

Read against both main checkouts, 2026-11-22. Code word: **image** (`MarkImage`, `Mark.images`);
"screenshot" stays the case's own capture (`Shot`), which adds a page to the case.

## 1. Data model in the extension and the case file

- `src/lib/case.ts`: `interface MarkImage { id: string; image: string; added: Stamp }`, and
  `Mark.images?: MarkImage[]` (absent when none, as `findings`). `id` is `newId("i")`, the same
  here, on the wire and in the file: images are only added or removed, never changed, so no
  book mapping (as finding and comment ids). Path `addedImage(id) = "images/<id>.webp"`: by the
  image's id, not the mark's number, so `renumber` (`cloud/wire.ts`, which moves `crops/m3` to
  `crops/m4`) never moves one. `MAX_MARK_IMAGES = 6`.
- Same file: `caseImages` adds `a.images[].image` (export, import, the panel's object URLs
  follow); `withoutMark` returns the mark's images with its crop; new `withImages(c, markId,
  images, now)` and `withoutImage(c, markId, imageId, now)` refuse past the limit and a taken
  id. `fixedOf` and `markSignature` leave `images` out: an added image must not read as
  another drawing (the `ends` lesson of DEC-047).
- Store: unchanged. Files go under `<caseId>/images/<id>.webp` through `store.change`
  (`{ value, images, deleteImages }`), the case and its files in one transaction.
- `sitegloss/2` gains optional `marks[].images: [{ id, image, added: { at, user? } }]` and zip
  entries `images/<id>.webp`. `validateCase`: at most 6, `id` of `[A-Za-z0-9_-]{1,64}` unique in
  the case, `image` exactly `images/<id>.webp`, `added.at` a timestamp; `readImages` requires
  each file as it does crops ("The export lacks images/….webp."). A reader of `sitegloss/2`
  from before (main today) builds marks from the fields it knows and reads only the files
  `caseImages` names: it drops the images silently and imports the rest. Unreleased format,
  so no bump.
- case.md (`markdown.ts`, after the crop): `- Images added: 2`, then `![Mark 3, added image 1](images/….webp)` each.

## 2. The service

- **Contract** (`packages/api/src/v1`, additive): `LIMITS.markImages: 6`. `model.ts`:
  `MarkImage = { id: Id, image: ImageRef, added: Stamp }`; `Mark.images` declared optional,
  described "always sent by a server that keeps images, `[]` for none; absent from a server
  before this". `ops.ts`: `NewMarkImage = { id, image: ImageRef, at?: Timestamp }`;
  `NewMark.images?` (an offline mark, an import); `MarkPatch.images?: { add?: NewMarkImage[],
  remove?: Id[] }`, the shape of `findings`. No new operation type: a server refuses a whole
  request for an unknown type but strips an unknown field. Then the `openapi` script.
- **Bytes** as crops (DEC-007): WebP named by SHA-256, `PUT …/blobs/{sha256}` before the
  operation, `putBlob` unchanged (WebP, 30 MB, 5 GB team quota). The blob route asks
  `mark:create` today; it takes `mark:create` or `mark:update` (permissions, no role name).
- **Database** (`db/schema/app.ts`): JSON column `marks.images` of `{ id, sha256, width,
  height, bytes, added: v1.Stamp }[]`, like `findings`; `db:generate`. No table: small, dies with its mark.
- **`applyOps`** (`server/store.ts`): `mark.create` stores `op.mark.images` after
  `needBlob(ctx, ref, "image")` each; `mark.patch` applies `remove` (unknown id ignored), then
  `add` (an id it has stays as stored; else `needBlob`, `added = stampOf(ctx, op.via)`, a
  client's `at` believed only in an imported case, as `stampFinding`); over the limit:
  `Refusal("limit", "A mark holds at most 6 images.")`. Permission `mark:update`, by team, as
  every patch; the new revision reaches everyone through `changes`/`events`. `toMark` always
  sends `images`.
- **Sweep** (`sweepBlobs` in `server/blobs.ts`): a third `not exists` over `marks,
  json_each(marks.images)` of the team's live marks. Removed images and a deleted mark's go at
  the first sweep a day on, as crops (DEC-011). No index on a JSON value; revisit only if
  DEC-027's measurement says so.
- **Web app** (`case-view.tsx`): thumbnails under the crop, each a button "Image 1 of mark 3,
  added by Dana" opening the existing `Lightbox` (crop and images as `media`). Read only.
- **Share** (`server/shares.ts`): `publicCase` copies `images` with `publicStamp`;
  `imageOfShare` also accepts a live mark's image of that case. Its download follows (Q3).
- **Download** (`case-file.ts`, `case-markdown.ts`): the extension's format ported; an image
  gone during a download is left out and named in `MISSING.txt`, its mark stays. A mark in
  `packages/api/vectors/case-file.json` gets an image; the extension copies the vector.
- **MCP** (`server/mcp.ts`): `get_case` lists per mark `images` (path `images/<id>.webp`, size,
  who added it) and sends their bytes after all crops within `IMAGE_BUDGET`, listing the rest
  for `get_image`, whose regex becomes `^(shots|crops|images)\/…`. Descriptions and the
  instructions: "images a person added to a mark (a menu that closes, another state of the
  page); they may show anything that was on their screen". No tool to add one.

## 3. Sync

- **Up** (`cloud/wire.ts`): `markContent` gains `images` (ids, and the hash the shadow knows);
  `markPatch` sends `add` for ids here not in the shadow, `remove` for the reverse; `newMarkOf`
  sends a new mark's images; `deriveOps`' `image(path)` resolves them as crops (a missing file
  leaves that image out, named in `missing`); `opKey` nulls each `add[].image` as it nulls a
  crop; the shadow update after a send applies `add`/`remove`.
- **Order** (`cloud/engine.ts`): `wanted` takes the images of `mark.create` and of
  `mark.patch.images.add`; uploaded before the operation, as now. The `blob_missing` retry
  takes every image an operation names, not only `shot.image`/`mark.crop`. `mayUpload` is
  `mark.create` or `mark.update`. A refused image (quota, size) gets the existing
  `blob:<sha>` rejected text and is not retried each run.
- **Down**: an image not here is fetched by `api.getBlob` with the crops' checks (WebP,
  30 MB, hash) and stored. Merge as findings (`wire.ts`): the server's order; removed here
  since stays away and the remove is sent; added here and unknown there stays; in the shadow
  and no longer at the server goes. **A server mark without `images`** (an older server) is
  "not told": no local image is removed for it. Teammates then miss the images and a shadow
  that believes it sent them does not resend, so the server ships first, on dev and prod.
- **Offline** adding works; the next run sends it. Two devices adding at once keep both (ids
  differ); past 6 the later patch is refused `limit`, its images stay here and that is said.
- **Delete**: `images.remove` plus the local file in one `store.change`; a mark's or case's
  delete takes its images.

## 4. The user interface in the extension

- **The side panel first.** The open mark (`markItem`, `src/sidepanel/view.ts`) gets
  "Add image…" in `markActions` after "Edit comment". Not the page's popover first: (1) the
  page's own scripts see `paste` and `drop` in their capture phase on `window` before the
  overlay's shadow root, so the picture (maybe another app's window) would go to the site
  being marked; (2) its bytes would cross from content script to panel as text; (3) DEC-027:
  the page asks, the panel changes and owns the store; (4) the owner's dropdown is on the page,
  the panel beside it. Later the popover gets "Add image…" that only asks the panel to open
  the dialog for that mark (E5); no picture ever touches the page.
- **Dialog** (new `src/sidepanel/add-images.ts`, a `<dialog>` with `showModal` as `ai.ts`):
  "Add images to mark 3". One area: "Paste an image (⌘V), drop one here, or choose a file",
  with "To capture a menu that closes: ⌘⇧⌃4 on a Mac, Windows+Shift+S on Windows, then paste."
  "Choose files…" (`<input type=file multiple accept="image/png,image/jpeg,image/webp,
  image/gif,image/avif">`; not "Upload…": nothing uploads unless the case syncs). `paste` reads
  `clipboardData.items` of kind file: no `clipboardRead` permission, no install warning.
  Each picture is re-encoded at once (section 5) and previewed with its size ("1440 × 900") and
  "Remove"; footer "Add 2 images" and "Cancel"; several at once, up to the free places.
- **Errors**, in a `role="status"` line: "The clipboard holds no image. Copy a screenshot
  first." · "This file is not an image Sitegloss can read: PNG, JPEG, WebP, GIF or AVIF." ·
  "This image is larger than 30 MB." · "This image has more than 64 million pixels." ·
  "Mark 3 holds at most 6 images; 2 more fit." · "This image is on the mark already." (same
  SHA-256). A failed save says the store's sentence and the dialog stays.
- **On the mark**: under the crop, `imagesView` shows thumbnails as `cropView` does (a
  button, `aria-pressed`, a click panel-wide and back), `aria-label="Image 1 of mark 3, shown
  large"`, tooltip "Added by Dana, 22 Nov"; beside each "Remove image 1" with Delete's two
  clicks. The head's subline says "2 images" on a closed mark; "Delete mark"'s tooltip names
  the images. `main.ts`: `addImages(c, a, images)`, `removeImage(c, a, id)`; the object URLs
  come from `caseImages`.
- **Keyboard**: focus on "Choose files…" at open, back on "Add image…" at close; Escape
  cancels; every control a button, so the drop area is never the only way.
- **Paste without the dialog**: worth it, as a shortcut into the dialog: Cmd-V with focus in
  an open mark (not a text field) opens it with that image; nothing is added without "Add".

## 5. Limits and re-encoding

- Accepted: what `createImageBitmap` decodes, offered as PNG, JPEG, WebP, GIF (first frame,
  said in the preview), AVIF; no SVG. At most 30 MB and 64 MP (`MAX_IMAGE_BYTES`,
  `MAX_IMAGE_PIXELS` of `export.ts`), checked before encoding. At most 6 per mark; no case
  limit beyond the team quota and the import's 150 MB.
- Always re-encoded in the panel: `toAddedImage(blob)` in `src/lib/images.ts` through
  `render`, WebP 0.85 like crops, longest side `ADDED_MAX_SIDE = 2048`, `imageOrientation:
  "from-image"`. The canvas writes no EXIF, XMP or GPS: re-encoding is the metadata strip (and
  the server takes WebP only). No file name is kept.

## 6. Privacy

- `PRIVACY.md`: "Images you add to a mark (pasted, chosen or dropped) are kept with the case
  like its screenshots, re-encoded, which removes their metadata (camera, place, time) and
  file name. They show whatever you captured, other windows or apps too: check the preview.
  Sitegloss reads the clipboard only when you paste into its dialog and asks for no clipboard
  permission; the page being marked never sees them." The AI-app and team paragraphs name
  added images beside crops; deleting a mark or case deletes them.
- Site (`apps/site/src/app/privacy/page.tsx`), under **Screenshots**: "…the crop of each
  mark, and images a member added to a mark"; the screen paragraph: an added image can show
  anything from that person's screen; share links show them (if Q3); gone within a day of
  deletion, as crops.

## 7. Adding from the web app

Later. The server takes WebP only and has no image library (DEC-015, DEC-022); a page's canvas
encodes WebP in Chromium and Firefox but, as far as I know, not in Safari. The contract above
already serves it; only the page is missing once that is settled.

## 8. Second step: a shortcut that freezes the page

Feasible. A second `commands` entry (say Alt+Shift+F, "Mark a still image of this tab") grants
`activeTab` as the icon does; the browser takes the key, so the page sees no keydown and an
open menu usually stays open. The worker calls `captureVisibleTab` first, before injecting or
changing anything, then starts the toolbar in a still mode: that capture is the view's shot
(`save.ts` takes a given shot instead of capturing), shown full-viewport under the overlay;
box, arrow, pen and note draw on it. The element picker cannot work (the menu has closed
underneath): marks on no element (`element: null`, as MCP `add_mark`'s). Cost: manifest,
a handler in `background.ts`, still mode in `adding.ts`/`overlay.ts`, a given shot in
`save.ts`; one full-set e2e calling the handler, save unit tests: one PR the size of DEC-047's
capture work. Worth it only if closing menus stay a pain once images ship.

## 9. Pull requests, in order

1. **S1 contract and store** (sitegloss.dev): `model.ts`, `ops.ts`, OpenAPI, column and
   migration, `store.ts`, blob route, `sweepBlobs`; DEC-029. Tests (`apps/app/test/`): add,
   remove, taken id, limit, `blob_missing`, no permission, the sweep keeps a named image and
   takes it a day after removal. On dev and prod before E3 is released.
2. **E1 format** (extension): `case.ts`, `validateCase`, `export.ts`, `markdown.ts`,
   `toAddedImage`; DEC-057. Tests: `case.test.ts` (path, limit, ids), `export.test.ts` (round
   trip; missing file refused), `markdown.test.ts`.
3. **S2 server readers**: `case-file.ts`, `case-markdown.ts`, vector, `mcp.ts`. Tests: the
   vector, `get_image` of `images/…`, the budget.
4. **E2 panel UI**, after the other agent's `view.ts` work lands: `add-images.ts`, `view.ts`,
   `main.ts`, `style.css`, `PRIVACY.md`, the copied vector. Tests: `view.test.ts` (button,
   names, count), a table for `acceptImage` (type, bytes, pixels, places, duplicate); one
   full-set e2e: a synthetic `paste` of a PNG, Add, thumbnail shown, stored WebP without EXIF.
5. **E3 sync**: `wire.ts`, `engine.ts`, `cloud-fake.ts` (the server's rules). Unit tests: upload before the
   operation; down and stored; two devices add; remove here and there; absent `images` keeps
   local ones; `opKey` stable. `bun run test:server` before the release.
6. **S3 web app and share**: `case-view.tsx`, `shares.ts`, privacy page. Tests: `imageOfShare`
   for the case's image and not another case's; `publicCase` copies `images`.
7. **E4 AI tools** (`src/worker/tools.ts`, after the other agent): `get_case`, `get_image`.
8. **E5 popover**: "Add image…" in `review.ts` asks the panel to open the dialog (unit test).

## 10. Open questions for the owner

1. The word: "Add image…" (recommended; "screenshot" already means the case's own capture,
   which adds a page) or your "Add screenshot…".
2. Limits: 6 per mark, longest side 2048 px, input up to 30 MB. Recommended: 2048 stays
   readable enlarged and mostly fits the MCP byte budget.
3. Does a share link show added images? Recommended yes: they are part of the mark the
   person shared, and both privacy texts say so.
4. Adding from the web app: recommended later, after deciding on a server image library.
5. The freeze shortcut (section 8): recommended as its own decision after images ship.
