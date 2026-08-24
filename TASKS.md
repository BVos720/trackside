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

- [ ] **A1. Finish photos on device.** The last step of adding a spot is now
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

- [ ] **A2. EXIF stripping.** Required by §5.1 and §9.4 before any sharing path
      exists. Re-encoding through the manipulator drops the EXIF block today, but
      only for images large enough to be resized — anything already under 1600px
      keeps its metadata untouched, so that is a side effect and not a control.
      Reference photos are the worst case: known place, known time, coordinates
      in the file. Easier to test once A1 has landed.

- [ ] **A3. ESLint layer-boundary rule.** `core/` must not import from `ui/` or
      `storage-local/`. The architecture already holds; this stops it drifting.
      Owns `eslint.config.*` and devDependencies. Collides with nothing.

- [ ] **A4. MapLibre `style` prop migration.** `@maplibre/maplibre-react-native`
      deprecates `style` on layer components and removes it in v12. Split into
      `paint` and `layout`. Mechanical, but touches every layer, and
      `MapScreen.web.tsx` builds from the same style module — do not regress web.

- [ ] **A5. Spot `uses` default at the read boundary.** Spots now carry
      `uses: SpotUse[]`. Reads go through `normaliseUses` in the logic and the
      editor, so old rows already behave — but the `Spot` type says the field is
      always an array and for pre-existing rows it is `undefined`. Add
      `uses: normaliseUses(row.uses)` beside the other defaults in
      `normaliseSpot`. One line plus a test. **Hold until
      `documentRepositories.ts` is quiet.**

- [ ] **A6. Re-enable kerbs.** `SHOW_KERBS = false` in `src/ui/map/style.ts`.
      They are generated and disabled. Either make them look right at the zooms
      people actually use, or delete the generator and record why.

---

## Lane B — phase 1 parallel, phase 2 serialised

Phase 1 is new files only. **Do not wire into `App.tsx` or `EventScreen.tsx`** —
hand that back for a serialised pass.

- [ ] **B1-1. Event lifecycle, logic.** An event is finished once `endDate` has
      passed. Derive it, never store it — a stored flag needs a background job
      and goes stale in a drawer. Finished events drop out of the list behind a
      "show finished" toggle. Second half: each event gets a tag applicable to
      photos, so a weekend's shots can be filtered afterwards; the tag must
      outlive the event being hidden. Owns `core/domain/event.ts` and a new
      `core/logic/eventLifecycle.ts` + test.

- [ ] **B2-1. Equipment checklist, logic.** Bodies, lenses, batteries, cards, wet
      gear, ear protection — tickable. Seeds from the previous event rather than
      starting empty; the kit barely changes between weekends, and re-typing it
      is why checklists get abandoned. New domain type + `core/logic/equipment.ts`
      + test.

- [ ] **B3-1. Weather, logic.** Open-Meteo: free, no API key, hourly cloud cover
      and precipitation — which matter far more to a photographer than a daily
      summary. The hard part is offline-first (§1.4): fetch when there is signal,
      cache with the event, **and always display the age**, because a three-day-old
      forecast shown as current is worse than none. Forecasts do not exist beyond
      ~16 days, so an event planned in winter must say so rather than render an
      empty panel. New `storage-local/weather.ts` + `core/logic/forecast.ts` + test.

- [ ] **B-2. Wiring pass (one agent, after the above).** Take the landed phase-1
      modules and wire them: `eventBundle.ts` so they back up, `importBundle.ts`
      so copy-mode remaps them (read how spots and sessions are handled — the same
      reference rewriting applies), then `EventScreen.tsx` and `App.tsx`.

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
