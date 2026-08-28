# Remaining work — excluding the database and backend

Written 20 August 2026. Backend, hosting and the move off the KV document store
are deliberately absent — they are blocked on the data model settling.

**Checkboxes mean "an agent may take this".** Items further down without a
checkbox need a human or are blocked; they are listed so nobody re-discovers
them, not so they get picked up.

---

## Three coders — first wave

One task each, chosen so no two touch the same file.

| Coder | Task | Owns |
|---|---|---|
| 1 | **A1** finish photos on device | `App.tsx` (`onPickPhoto` only), native rebuild |
| 2 | **A4** MapLibre `style` → `paint`/`layout` | `MapScreen.tsx`, `MapScreen.web.tsx` |
| 3 | **B1-1** event lifecycle logic | `core/domain/event.ts`, new `core/logic/eventLifecycle.ts` |

Second wave, once those land: **A2** (EXIF), **A6** (kerbs), **B3-1** (weather).
Keep **A5** back until `documentRepositories.ts` is quiet — another session is in
it.

### Rules for every coder

- **Work in your own worktree.** Three sessions shared this checkout yesterday
  and survived on care, not safety. `git worktree add ../trackside-<task> -b <task>`,
  then `npm install` in it (`node_modules` is gitignored). Metro binds 8081, so a
  second one needs `--port 8082`.
- **The suite is fully green — run it without exclusions.**
  `npx vitest run` (554 passing). The 9 `entryList.fixtures.test.ts`
  failures that earlier revisions of this file told you to skip were stale
  assertions pinning parser bugs that have since been fixed; the tests were
  rewritten on 22 August. **Do not re-add `--exclude`** — that file is the
  only thing checking the parser against real entry lists.
- **Commit your own files by name.** `git add -A` will sweep up three other
  people's half-finished work.
- **Do not touch** anything listed under "Owned or excluded" at the bottom.
- Device verification has to be serialised regardless of how the code is split —
  only one app can be installed per package name.

---

## The collision map

Contended files. Check `git status` and `git diff` on these before editing.

| File | Wanted by |
|---|---|
| `App.tsx` (~1200 lines, wires everything) | photos, event lifecycle, equipment, weather, entry-list UI |
| `src/ui/screens/EventScreen.tsx` | equipment, weather, entry-list UI |
| `src/storage-local/repositories/documentRepositories.ts` | spot defaults, event lifecycle, equipment, entry lists |
| `src/core/logic/eventBundle.ts`, `importBundle.ts` | equipment, weather cache, entry lists |
| `src/ui/theme.ts` | anything adding styles |

**So every feature splits in two.** Phase 1 is new files only — domain type, core
logic, tests — and is genuinely parallel. Phase 2 is the wiring and wants one
agent at a time. Most of the work is phase 1; the wiring is usually twenty lines.

---

## Lane A — free-standing, any number in parallel

- [x] **A1. Finish photos on device.** The last step of adding a spot is now
      Photos, and `src/storage-local/pickImage.ts` (native, downscales to 1600px)
      and `mediaStore.ts` (writes to `Paths.document/media/`) are both written.
      **Nothing imports `pickImage` yet** — `onPickPhoto` in `App.tsx` still
      builds a DOM `<input type="file">`, so the step does nothing on a phone.
      Replace that body with `pickImage()`, feeding the existing `addPhoto` /
      `pendingPhotos` branches; the shapes already line up. Then
      `npx expo run:android` — expo-image-picker and expo-image-manipulator are
      native modules and are not in the installed dev build. **Needs JDK 17**;
      Android Studio ships 25 and it dies at the CMake step (JEP 472).
      Verify: add spot → Photos → pick → save → reopen → force-stop → relaunch.
      The whole point is that bytes survive a restart.


      **Done — 22 August.** `App.tsx` imports `pickImage` and `onPickPhoto`
      calls it; the DOM `<input>` body is gone. Still unverified on hardware —
      no device or emulator was attached — so the "survives a force-stop"
      check at the end of this item has not been run.
- [x] **A2. EXIF stripping.** Required by §5.1 and §9.4 before any sharing path
      exists. Re-encoding through the manipulator drops the EXIF block today, but
      only for images large enough to be resized — anything already under 1600px
      keeps its metadata untouched, so that is a side effect and not a control.
      Reference photos are the worst case: known place, known time, coordinates
      in the file. Easier to test once A1 has landed.


      **Done — 22 August, with one platform gap recorded rather than hidden.**
      Native forces *every* image through the manipulator re-encode, including
      ones already under 1600px, so the strip is now a control and not a side
      effect of resizing. `PickedImage.metadataStripped` reports whether it
      actually ran, `addPhoto` takes it, and the `Media` row records it
      instead of hard-coding false.

      Two things a reader should know. The native manipulator has a deliberate
      fallback — on failure it returns the original bytes, because a reference
      photo you cannot find again is worse than one carrying EXIF — and that
      path now reports `false` rather than pretending. And **web does not
      strip at all**: `pickImage.web.ts` hands the browser's `File` straight
      through. Safe today only because nothing is served off-device; a canvas
      round trip is the fix when a sharing path is built. The flag is never
      optimistic, so the failure mode is "refuses to publish", not "publishes
      a geotag".
- [x] **A3. ESLint layer-boundary rule.** `core/` must not import from `ui/` or
      `storage-local/`. The architecture already holds; this stops it drifting.
      Owns `eslint.config.*` and devDependencies. Collides with nothing.


      **Done — 22 August, as a test rather than an ESLint config.**
      `src/core/layers.invariants.test.ts` scans every file under `core/` for
      specifiers reaching into `ui/` or `storage-local/`, covering static
      imports, re-exports, `import()` and `require()`, plus the `@ui` /
      `@storage-local` path aliases.

      Why not ESLint: nothing in this repo lints today, so adding it means
      either a rule nobody runs or a new command every agent has to remember,
      whereas `npx vitest run` is already mandatory before committing. The
      full lint setup is still worth wanting for unused variables and hook
      dependencies — but that is a separate decision from enforcing §2.3, and
      this enforces §2.3 now. The scan currently finds no violations.
- [x] **A4. MapLibre `style` prop migration.** `@maplibre/maplibre-react-native`
      deprecates `style` on layer components and removes it in v12. Split into
      `paint` and `layout`. Mechanical, but touches every layer, and
      `MapScreen.web.tsx` builds from the same style module — do not regress web.


      **Appears done — 22 August.** No layer component in `MapScreen.tsx` or
      `src/ui/map/` still passes `style=`; the remaining hits are React Native
      `View` styles. Worth one confirming grep before deleting this item.
- [x] **A5. Spot `uses` default at the read boundary.** Spots now carry
      `uses: SpotUse[]`. Reads go through `normaliseUses` in the logic and the
      editor, so old rows already behave — but the `Spot` type says the field is
      always an array and for pre-existing rows it is `undefined`. Add
      `uses: normaliseUses(row.uses)` beside the other defaults in
      `normaliseSpot`. One line plus a test. **Hold until
      `documentRepositories.ts` is quiet.**


      **Done — 22 August.** `uses: normaliseUses(row.uses)` added to
      `normaliseSpot`, with `normaliseUses` rather than `?? []` so an empty
      array falls back to `DEFAULT_SPOT_USES` instead of producing a spot that
      is for nothing. Covered by `normaliseSpot.test.ts` (6 tests), which
      writes pre-`uses` rows straight into the store — the only honest way to
      exercise that path, since constructing a `Spot` in TypeScript gives you
      the new shape by definition.
- [x] **A6. Re-enable kerbs.** `SHOW_KERBS = false` in `src/ui/map/style.ts`.
      They are generated and disabled. Either make them look right at the zooms
      people actually use, or delete the generator and record why.


      **Done.** `SHOW_KERBS = true` in `src/ui/map/style.ts`.
---

## Lane B — phase 1 parallel, phase 2 serialised

Phase 1 is new files only. **Do not wire into `App.tsx` or `EventScreen.tsx`** —
hand that back for a serialised pass.

- [x] **B1-1. Event lifecycle, logic.** An event is finished once `endDate` has
      passed. Derive it, never store it — a stored flag needs a background job
      and goes stale in a drawer. Finished events drop out of the list behind a
      "show finished" toggle. Second half: each event gets a tag applicable to
      photos, so a weekend's shots can be filtered afterwards; the tag must
      outlive the event being hidden. Owns `core/domain/event.ts` and a new
      `core/logic/eventLifecycle.ts` + test.


      **Done.** `src/core/logic/eventLifecycle.ts` exists with tests.
- [x] **B2-1. Equipment checklist, logic.** Bodies, lenses, batteries, cards, wet
      gear, ear protection — tickable. Seeds from the previous event rather than
      starting empty; the kit barely changes between weekends, and re-typing it
      is why checklists get abandoned. New domain type + `core/logic/equipment.ts`
      + test.


      **Done.** `src/core/logic/equipment.ts` and a repository with tests.
- [x] **B3-1. Weather, logic.** MET Norway: free for commercial use, no API
      key, hourly cloud cover
      and precipitation — which matter far more to a photographer than a daily
      summary. The hard part is offline-first (§1.4): fetch when there is signal,
      cache with the event, **and always display the age**, because a three-day-old
      forecast shown as current is worse than none. Forecasts do not exist beyond
      ~9 days, so an event planned in winter must say so rather than render an
      empty panel. New `storage-local/weather.ts` + `core/logic/forecast.ts` + test.


      **Done.** `src/core/logic/forecast.ts` and `src/storage-local/weather.ts`
      exist with tests.
- [x] **B-2. Wiring pass (one agent, after the above).** Take the landed phase-1
      modules and wire them: `eventBundle.ts` so they back up, `importBundle.ts`
      so copy-mode remaps them (read how spots and sessions are handled — the same
      reference rewriting applies), then `EventScreen.tsx` and `App.tsx`.


      **Done.** `eventBundle.ts` carries `equipment` and `entries`, both
      defaulted at the read boundary so a bundle written before either existed
      still opens. `importBundle.ts` remaps equipment in copy mode the same way
      it remaps spots and sessions. On the UI side `EquipmentScreen.tsx`,
      `WeatherScreen.tsx`, `EntryListScreen.tsx` and their hooks are wired
      through `EventScreen.tsx` and `App.tsx`.
---

## Owned or excluded — do not pick up

- **Entry list parsing.** Another session owns it and is mid-repair. Its files
  are uncommitted on disk (`core/domain/entry.ts`, `core/logic/entryList.ts`,
  `core/logic/entry-lists/`, `core/repositories/entryRepository.ts`,
  `storage-local/repositories/entries.test.ts`, `ui/state/useEntries.ts`, plus
  additions to `eventBundle.ts`, `importBundle.ts`, `importEvent.ts`). It is also
  why the suite is red. The entry-list **UI** in `EventScreen.tsx` is free once
  that session says so.
- **Backend, database, hosting** — excluded by instruction.
- **Moving repositories onto Drizzle** — excluded by instruction; it is the DB work.

## Needs a human, not an agent

- **Le Mans is partial.** The Mulsanne is public road (D338) with no route
  relation; which ways form the lap is a judgement call, not an extraction.
  Labelled "(WIP)" in the UI. §0.2 reserves this.
- **Circuit presets** — timezone, layout variants, marshal post numbering. Seed
  data sourced from official documents, never inferred. §0.2.
- **Logo.** Waiting on the source file; only a screenshot of the presentation
  board exists and it is too soft for an icon. When it lands: the **mark alone**
  goes to `icon.png` (1024²), adaptive foreground (512²), favicon and monochrome
  — the wordmark is illegible at launcher size and Android's adaptive mask crops
  the outer third. The **wordmark version** goes to `splash-icon.png`.
  `scripts/build-sprites.mjs` has a dependency-free PNG encoder.
- **Offline verification** needs `eas build --profile preview` and an Expo
  account. A dev build cannot be tested offline: Metro serves the JS bundle, so
  airplane mode stops it starting at all.
- **PDF/PNG timetable text extraction on device.** The picker works and reports
  honestly that reading is unsupported; pdfjs needs a DOM and a worker bundle
  Metro will not produce. Wants a native text module, or OCR from a screenshot —
  which suits a phone better anyway. Open because there is no clean answer, not
  because nobody has tried.
- **iOS** needs a paid Apple developer account to build from Windows.
- **Run on a real phone.** Everything so far is emulator-only.

---

## Added 29 August 2026 — waypoint photos, filtering, and graphics

### BUGS

#### B1. Map goes black at a flat angle in 3D — FIXED 29 Aug (d2a2975)

When switching from 2D to 3D mode (or vice versa), the map briefly goes fully black. Probably a layer visibility or rendering order issue in the transition.

- [ ] Reproduce and capture the timing of the flash.
- [ ] Check if it is a terrain render blocking the flat map, or the flat map blocking the terrain render.

#### B2. Navigation crashes the app — MITIGATED 29 Aug (9e10320), NOT confirmed

Something about navigation functionality causes a complete app crash.

- [ ] Narrow down: which navigation? Back button? Route navigation? Event start navigation?

#### B3. Starting an event crashes the app — same cause as B2, same mitigation

Clicking "start event" crashes the whole application.

- [ ] Reproduce and capture the error.
- [ ] Check event lifecycle and state mutations for null/undefined.

#### B4. Place names render out of bounds — FIXED 29 Aug (b86e08e)

Labels for place names (towns, etc.) appear outside the circuit area on the map.

- [ ] Likely a label-placement expression issue; revisit max-width and text-allow-overlap.

#### B5. Suzuka 3D rendering glitch — DIAGNOSED 29 Aug, see D8 in TASKS-map-sky.md

Minor priority. The 3D view of Suzuka has a visual glitch.

- [ ] Specify what the glitch is (terrain mesh, tree rendering, label placement, etc.).

### FUNCTIONS

#### F1. Waypoint photo carousel

Each waypoint should support multiple photos. Add a `+` button to add more photos; navigate with arrow buttons; show a carousel. Each photo is internally a new spot with all settings, grouped under the waypoint.

- [ ] Design and implement photo carousel UI.
- [ ] Store photos as a collection on the waypoint rather than independent spots.
- [ ] Implement add/remove/reorder with proper data model.

#### F2. Waypoint photo rating and filtering

- Add a starring/rating system to each photo in the carousel.
- Implement a filtering system for both spot view and the list view (F5 below):
  - Filter by date created.
  - Filter by name.
  - Filter by star rating.
  - Make everything more searchable.

- [ ] Add a rating field to the photo model (e.g., 0–5 stars).
- [ ] Build filter UI for the list view.
- [ ] Add filter controls to the spot view (if photos are grouped on a waypoint).

#### F3. Image center definition

When choosing an image for a waypoint, allow the user to define the center point. The image fills the square with the defined center in the center of the display.

- [ ] Add a center-point picker to the image upload/selection flow.
- [ ] Store the center coordinates on the image.
- [ ] Render the image with the defined center positioned centrally.

#### F4. Time slider enhancements

- Add a gradient to the time slider to show the day/night cycle visually.
- Show weather status on the slider: small clouds and rain icons at appropriate times.

- [ ] Implement gradient background on the slider (currently it is linear).
- [ ] Fetch or derive weather status for the time range and render icons inline.

#### F5. Spot list view with filtering

A separate list view showing all waypoints, with filters by date, name, and rating.

- [ ] Design and implement list view.
- [ ] Wire filters to the data model.
- [ ] Make it the secondary view alongside the spot carousel (F1).

#### F6. Trees always visible with render-distance option

Trees and scenery should be visible from any altitude, but add a setting to decrease render distance for performance.

- [ ] Increase the tree scatter extent beyond the corridor (see D7 in TASKS-map-sky.md).
- [ ] Add a "scenery render distance" or "view distance" setting to Graphics.
- [ ] Implement distance-based fading or LOD for scenery.

#### F7. Hand-drawn circuit from roads

Allow the user to draw lines on the map, and the app snaps to the closest roads, auto-generating a circuit.

- Useful for street circuits where the official route is just the public roads.

- [ ] Design drawing UI (e.g., long-press to draw, snap-to-roads algorithm).
- [ ] Integrate with the circuit editor or create a new workflow.

#### F8. Graphics settings and presets

With dynamic lighting (sun, shadows, etc.), add graphics settings:

- Preset options: low, medium, high, ultra.
- Individual toggles: dynamic shadows, dynamic rain, tree LOD, etc.

- [ ] Define a graphics settings object and storage.
- [ ] Build settings UI in the profile screen.
- [ ] Wire each setting to the renderer (shadows, rain toggle already done; extend for others).

#### F9. Visible sun indicator on map

Replace the sun dial with:

- A visible sun in the 3D sky (already rendered as part of the astro scene).
- A small compass rose (without the dial) showing cardinal directions and the sun's azimuth.

- [ ] Move or adapt the sun dial's compass into a minimal compass-only control.
- [ ] Confirm the sun is visually prominent (may already be in the scene as the sky backlight).


### What a device log would settle

B2 and B3 are mitigated on a hypothesis, not diagnosed. The app wraps
everything in an ErrorBoundary, so a JavaScript render error would show an
error screen rather than killing the process — the reported behaviour points
at a native crash, which no JS boundary catches and which source alone cannot
confirm. To settle it, capture the log while reproducing:

```
npx react-native log-ios          # or: npx react-native log-android
```

On iOS the fuller trace is in Console.app, or Xcode > Window > Devices and
Simulators > View Device Logs, filtered to the app. What matters is the few
lines immediately before the process dies.
