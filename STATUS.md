# Trackside — status

Written 19 August 2026. A snapshot of what exists, what does not, and the
decisions worth not re-litigating.

Everything below runs: **207 tests passing, `tsc --noEmit` clean**, and the app
builds and runs on an Android emulator (Pixel 10 Pro, API 37 preview).

---

## Done

### Foundations
- Expo SDK 57, React Native 0.86, TypeScript 6, Metro.
- `core/` domain under the §0.1 constraints: UUID v7 branded ids, `Utc` brand,
  soft-delete tombstones everywhere, no hard deletes.
- Drizzle schema with 8 migrations checked in; invariants enforced by test
  (no `AUTOINCREMENT`, every primary key text).
- vitest suite, 207 tests.

### Map
- **7 circuits**, full pipeline each: Nürburgring, Spa-Francorchamps,
  Zandvoort, Le Mans, Zolder, Suzuka, Fuji.
- Offline PMTiles basemaps bundled (~26 MB total) — works with no signal.
- Circuit geometry from OSM (`highway=raceway`, karting excluded).
- 300 m corridor mask; hard cut-off in 2D, drop to void in 3D.
- Buildings extruded at real OSM heights; woodland tree scatter; field grass.
- 3D terrain: raster-dem, sun-driven hillshade, pitch camera. Web and native.
- Circuit ruler — site width/height and total surface.
- Callout stacking: overlapping labels collapse to one card at the midpoint,
  with leader lines to each pin, a count badge, and tap-to-isolate.
- Web (`maplibre-gl` v5) and native (`@maplibre/maplibre-react-native` v11)
  build from the same style module.

### Offline labels
- Latin glyph ranges (0-255, 256-511) bundled for three stacks — Regular,
  Medium, Italic — 590 KB total. `npm run glyphs` fetches them into the repo,
  alongside the `.pmtiles` archives and for the same reason.
- `normaliseFontStacks` rewrites every layer to exactly one bundled stack. The
  Protomaps basemap ships fallback arrays such as
  `["Noto Sans Regular", "Noto Sans Devanagari"]`, and a multi-entry stack is
  requested as one comma-joined name that no bundled folder can match.
- Native copies the ranges out of the bundle on first run into
  `files/glyphs/<stack>/`; falls back to the remote URL if that ever fails,
  because remote labels beat no labels.
- **Not bundled:** CJK. Japanese labels at Suzuka and Fuji fall back to Latin
  script or stay unnamed — tens of megabytes to name two circuits.

### Spots
- Create, edit, move, delete, hide. Key picture, photos (web only — see below).
- Key times, free tags, shot settings (focal length stored as **full-frame
  equivalent** plus `cropFactorBasis`, per §5.6).
- Access classification is never inferred — §0.2.
- Tapping the map snaps a spot to the verge, never onto the racing surface.
- Spot list is a bottom panel over the map, not a separate page.

### Events
- Events span circuits; the list shows all of them grouped by venue.
- Creating one picks its circuit up front and takes a date **range** from a
  calendar (no native module — see decisions).
- "Start from my spots" **clones** them (see decisions).
- One event page holds timetable, plan, map and backup, each folded into a
  collapsible section — closed by default, with a count and a one-line hint so
  a shut section still tells you whether it has anything in it.
- Active event and selected circuit both survive a restart.

### Timetable
- Deterministic parser, built against three real Spa PDFs.
- Paste text, or add sessions by hand. Sessions belong to an **event**.
- Manual entry picks the day from the event's own dates, written in full
  ("Saturday 22 August 2026") so it resolves through the same matcher an
  imported heading does.
- Saved sessions are **grouped by day**, each day collapsible, in the order the
  timetable gave them — sorting by a parsed date would reorder days whose
  headings never resolved to one.
- PDF picker opens the real file system on device.

### Planner
- Ordered stops per day, arrival times, free-text labels ("Racing legends
  race 1").
- Walking estimates: 75 m/min, off-network metres charged double, 3 min setup,
  **+5 min safety margin**. Rounded up, always.
- Leave-by times computed backwards from arrival; flags a plan that cannot hold.

### Navigator
- Live position and a compass **facing cone** (magnetometer, works stationary).
- Routing over extracted walkable networks (7 circuits, junction-preserving
  simplification, Dijkstra with a binary heap).
- **The racing surface is a barrier.** Straight lines across it are refused, and
  the detour limit is waived so tunnels and bridges get used.
- Side-aware joins: each end may only join the network on its own side.
- **Fix accuracy respected** — within 20 m (or the reported accuracy) of the
  track the app declines to assert which side you are on, instead of refusing
  to navigate.
- **Paths preferred over roads** by cost weighting (footway 1.0 → secondary
  3.2). Roads still used when they are the only way.
- Blocked routes draw **nothing** on the map and say they are still looking.
- A standing safety warning shows the whole time you navigate.

### Files
- Event bundle format `trackside.event.v1`: one JSON file per event holding the
  event, its spot copies, its sessions and its plan. Self-contained.
- Auto-saved (debounced) to the app's document directory; manual "Save now".
- Web has no app folder, so it offers a download and says so.

### Android
Runs on the emulator. Getting there needed: JDK 17 (Studio ships 25, which
breaks the CMake step), a `crypto.getRandomValues` polyfill (Hermes has none —
**nothing could be saved** without it), real safe-area insets, and rasterising
the SVG sprites to PNG (Android cannot decode SVG in that path).

---

## Not done

> **Offline verified end to end — 25 August.** On the emulator, with the
> network genuinely unreachable (`svc wifi disable`, `svc data disable`,
> airplane mode, `ping 8.8.8.8` → *Network is unreachable*) and Metro killed.
>
> The build was a **local release APK** — `npx expo run:android --variant release`
> — not EAS. Release is signed with the debug keystore here, so no account and
> no cloud build are needed, and `--variant release` embeds the JS bundle, which
> is the whole point: a dev build cannot be tested this way because airplane
> mode also cuts it off from Metro and it fails for the wrong reason.
>
> What ran with no network: the app started from the embedded bundle; the
> basemap rendered from the bundled `.pmtiles` (Nordschleife geometry, terrain,
> forest, roads); circuit metrics resolved (6.08 × 6.34 km, 29.19 km surface);
> stored spots loaded from the KV store; the sun dial and the sky scrubber both
> worked. No glyph errors, no tile failures, no *Unable to load script*.
>
> Labels render too, checked by zooming in: "Antoniusbuche" and "Tiergarten"
> drawn from the bundled glyph stacks with no network.
>
> **Untested offline:** the PDF
> bridge, which needs a file picked by hand. Its assets ship in the APK
> (`res/hz.pdfjs`, `res/xA.pdfjs`) and it fetches nothing by design, but that is
> an argument rather than an observation.
>
> Note this build is **minified with ProGuard**, unlike debug. Anything that
> breaks only here is a real finding about what ships.

### Next up
1. **Import a bundle back.** Saving works; reading one in does not.
2. **PDF text extraction on device.** The picker works and reports honestly that
   reading is unsupported. pdfjs needs a DOM and a worker bundle Metro will not
   produce. Route: a native text module — or OCR from a screenshot, which suits
   a phone better anyway.
3. **Photos on device.** `mediaStore` throws on native. Needs expo-file-system
   storage, expo-image-picker, and the §5.1 EXIF strip.

### Known gaps
4. **Never run on a real phone.** Emulator only. The Huawei P30 Lite is locked
   by FRP after a factory reset with a deleted account.
5. **iOS compiles — 26 August.** The app itself is fine on iOS: MapLibre,
   react-native-webview, expo-image-picker and the managed prebuild all built
   clean on EAS in five minutes. Proved with
   `eas build --platform ios --profile ios-simulator`, which needs **no Apple
   account at all** because simulator builds are unsigned — worth knowing as a
   way to check the iOS target for free before paying for anything.

   What still needs the $99 Apple Developer membership is **signing**, and only
   signing. After that, `eas build --platform ios --profile preview` produces
   an ad-hoc build installable from a link (100 device registrations a year, no
   Apple review). TestFlight is included in the same membership at no extra
   cost, but for a single phone ad-hoc is fewer steps — no App Store Connect
   record, no processing wait, and no 90-day build expiry.

   The free 7-day sideload route is real but needs a Mac: the certificate is
   issued through Xcode, so Windows cannot mint one and there is nothing for
   Sideloadly to install.

   Three build attempts were needed, and two of them were my own bugs rather
   than the app's — see the note on `npm ci` below.

### Cleanups
6. `@maplibre/maplibre-react-native` deprecates the `style` prop; removed in
   v12. Migrate to `paint`/`layout`.
7. ESLint rule to enforce layer boundaries (`core/` must not import `ui/`).
8. Repositories still sit on the KV document store. The Drizzle tables exist and
   are migrated; moving over is confined to `storage-local/`.
9. Kerbs are generated but disabled (`SHOW_KERBS = false`).

### Reserved for a human (§0.2)
10. **Le Mans is partial.** The Mulsanne is public road (D338) with no route
    relation; which ways form the lap is a judgement call, not an extraction.
    Labelled "(WIP)" in the UI.
11. Circuit presets — timezone, layout variants, marshal post numbering — are
    seed data to be sourced from official documents, not inferred.

---

## Decisions worth not re-opening

- **`package-lock.json` must be generated with npm 10, not 11.** EAS builders
  run npm 10, and the two hoist differently: npm 11.17 nests every
  `@esbuild/*` platform package under `node_modules/tsx/node_modules`, npm 10
  hoists 26 of them to the top level. `npm ci` refuses to reconcile the two and
  fails the build at "Install dependencies" claiming the packages are missing
  from the lock — they are not, they are in the wrong place. Regenerate with
  `npx npm@10 install --package-lock-only` after any dependency change.

  And **`npm ci --dry-run` does not catch this.** It validates against the
  `node_modules` already on disk rather than doing the strict lock-versus-
  manifest check, so it reports "up to date" on a lock that fails for real.
  Verify with an actual `npm ci --include=dev`.

- **Events clone spots, they do not reference them.** This inverts §4.2's
  reference model, deliberately. §4.2 exists to stop duplicate pins on a
  *shared* map; copies inside one person's event are never published. The
  failure it prevents is real: with references, tidying a race-weekend map
  deleted spots from the permanent collection. `Spot.eventId` keeps the two
  apart.
- **suncalc 2.x returns degrees from north**, not radians from south as the
  spec documents. Both are `number`, so the wrong convention typechecked and
  was 57× and 180° wrong. A unit test pins it.
- **maplibre-gl is pinned to v5.** v6 is chunked ESM with a worker and does not
  bundle under Metro.
- **Glyph stacks are renamed without spaces.** MapLibre substitutes the stack
  name into the URL, and `%20` is decoded by some file URI handlers and not
  others. The name is only a lookup key.
- **Direct route legs are drawn dashed** and never styled like a path. They are
  a bearing, not a way — the same honesty rule as never inferring access.
- **Estimates round up and are labelled "about".** Five minutes early costs
  five minutes; five minutes late costs the session.
- **Bundle filenames use the id's *tail*.** UUID v7 begins with a millisecond
  timestamp, so two events created in the same millisecond shared a filename
  and one silently overwrote the other. Caught by a test.
