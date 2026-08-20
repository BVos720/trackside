# Handoff — 20 August 2026

A working note for a session picking this up, not a status doc. `STATUS.md` is
the durable one. **Delete this file once it has been consumed.**

State at the time of writing: `npx tsc --noEmit` clean, `npx vitest run` 335
passing, HEAD at `cd96baf`.

---

## Read this first: three sessions share one working tree

There is no worktree isolation. At the time of writing, uncommitted changes in
this repo come from **three different places**:

1. **This session** — photos (see below).
2. **Another chat** — entry lists: `src/core/domain/entry.ts`,
   `src/core/logic/entryList.ts`, `src/core/logic/entry-lists/`,
   `src/core/repositories/entryRepository.ts`,
   `src/storage-local/repositories/entries.test.ts`, plus additions to
   `eventBundle.ts` and `importBundle.ts`.
3. **Branco / a background task** — `MENU_CLEARANCE` padding fixes across
   `CircuitScreen`, `EventScreen`, `EventsScreen`, `LightScreen`, `MapScreen`,
   `PlannerScreen`, `theme.ts`; and the event soft-delete cascade in
   `documentRepositories.ts` / `eventRepository.ts` / `eventDeletion.test.ts`.

**Before editing a shared file, check `git status` and `git diff` on it.** Commit
your own files by name — `git add -A` will sweep up work that is not yours and
is possibly half-finished. Creating a worktree
(`git worktree add ../trackside-<task> -b <branch>`) is the better answer if you
are doing anything substantial; note that `node_modules` does not come with it
and Metro will need `--port 8082`.

---

## The immediate job: finish photos on device

The ask was "when adding a waypoint the last option is to add images". The UI
half is done. The device half is **written but not connected**, and the app has
not been rebuilt, so none of it runs on a phone yet.

### Done, uncommitted

- **`src/ui/screens/SpotSheet.tsx`** — the add-spot form is now five steps
  (What / Access / When / Detail / **Photos**) instead of one long scroll.
  Photos is last and is reachable *while creating*, which it never was before:
  it used to say "save the spot first". `pendingPhotos` in `App.tsx` already
  existed for exactly this and had simply never been offered a picker.
  Save sits beside Next on every step — the later steps are optional and the
  common case is "name it now, describe it later".
- **`src/storage-local/mediaStore.ts`** — was a stub that threw
  `NOT_IMPLEMENTED`; now writes bytes into `Paths.document/media/` under a
  minted key. Read the comments before changing it: the row must hold a key and
  never the picker's URI (that path is in the cache directory, which Android
  reclaims — the gallery works for a fortnight and then silently empties).
- **`src/storage-local/pickImage.ts` + `.web.ts`** — new. Native uses
  expo-image-picker, then downscales to 1600px on the long edge at quality 0.7
  via expo-image-manipulator.
- **`package.json`** — `expo-image-picker` and `expo-image-manipulator` added.

### Not done — start here

1. **Wire it up.** `onPickPhoto` in `App.tsx` (~line 655) still builds a DOM
   `<input type="file">`, so it is web-only and `pickImage` is imported by
   nothing. Replace the body with a call to `pickImage()` and feed the result
   into the existing `addPhoto` / `pendingPhotos` branches. The shapes already
   line up: `pickImage` returns `{ blob, contentType, previewUri }` and
   `pendingPhotos` entries want `{ file, kind, isKey, previewUri }`.
2. **Rebuild the native app.** Both new packages are native modules, so the
   installed dev build does not contain them — `npx expo run:android`. Needs
   **JDK 17**; Android Studio ships 25 and it fails at the CMake step (JEP 472).
   An emulator was running at `emulator-5554`.
3. **Verify on device.** Add a spot → step through to Photos → pick an image →
   save → reopen and confirm the picture is still there. Then force-stop and
   relaunch: the point of the media store is that bytes survive, and the old
   web implementation's blobs did not.

### Decision recorded while building this

Branco asked for local photos to be **downgraded** — full resolution is deferred
to the backend, possibly behind a paid tier. Hence the 1600px / 0.7 downscale.
This deliberately reverses part of §5.1, which asks for the untouched original
to be kept local-only; the reasoning is written out at the top of `pickImage.ts`
and should be read before anyone "fixes" it back.

Related and **still outstanding**: EXIF stripping. Re-encoding through the
manipulator happens to drop the EXIF block, but that is a side effect of
resizing, not a control — images already under 1600px skip the resize entirely
and keep their metadata. A real strip **must exist before the first sharing
path does** (§5.1, §9.4). Reference photos are the largest privacy surface in
this app: a known place, a known time, coordinates in the file.

---

## Also outstanding

- **`normaliseSpot` in `documentRepositories.ts` needs a `uses` default.** Spots
  now carry `uses: SpotUse[]` (photography / spectating). Reads go through
  `normaliseUses` in the logic and the editor, so legacy rows already behave
  correctly — but the `Spot` type claims the field is always an array and for
  old rows it is `undefined`. Add `uses: normaliseUses(row.uses)` alongside the
  other defaults. I stayed off that file all session because another session was
  rewriting it; check it is free first.
- **Logo.** Branco has a new one — a road/pin/shutter mark with a TRACKSIDE
  wordmark. Only a screenshot of the presentation board has been supplied so
  far, which is too soft for an icon; he is getting the source file. When it
  arrives: the **mark alone** goes to `icon.png` (1024²), the adaptive
  foreground (512²), favicon and monochrome — the wordmark is illegible at
  launcher size and Android's adaptive mask crops the outer third. The
  **wordmark version** goes to `splash-icon.png`, where there is room.
  `scripts/build-sprites.mjs` has a dependency-free PNG encoder if resizing is
  needed without adding a dependency.
- Tasks #24 (PDF/PNG text extraction on device), #25 (offline verification via
  `eas build --profile preview`), #26 (MapLibre `style` prop → `paint`/`layout`
  before v12), #28 (finish events after their end date), #29 (equipment
  checklist), #30 (weather via Open-Meteo), #32 (backend).

## On the backend

Deferred deliberately, and #32 records why. The app is offline-first (§1.4), so
a server is a sync target and never a dependency, and the domain already carries
what sync needs — UUID v7 ids, tombstones, `syncState`. The blocker is that the
data model is still moving: spot uses, entry lists, equipment, event tags and
cached forecasts all add or change tables, so a schema designed now gets
migrated within a fortnight. On hosting: Oracle Cloud's Always Free tier is
genuinely generous but has a reputation for reclaiming idle instances, which is
a poor property for the only copy of anything. Hetzner is a few euros a month
and boring.
