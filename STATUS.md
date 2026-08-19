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
- One event page holds timetable, plan, map and backup.
- Active event and selected circuit both survive a restart.

### Timetable
- Deterministic parser, built against three real Spa PDFs.
- Paste text, or add sessions by hand. Sessions belong to an **event**.
- Day headings resolve to real dates when unambiguous, else kept verbatim.
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

### Next up
1. **Import a bundle back.** Saving works; reading one in does not.
2. **Sessions grouped by day**, with a dropdown per day.

### Known gaps
3. **Labels need network.** Glyphs load from `protomaps.github.io`, so corner
   names will not render in the Eifel. This is the biggest hole in the offline
   promise. Fix: bundle a latin glyph set and point `glyphs` at a local URI.
4. **PDF text extraction on device.** The picker works; pdfjs needs a DOM and a
   worker bundle Metro will not produce. Pasted text goes through the identical
   parser. Route: a native text-extraction module, not pdfjs.
5. **Photos on device.** `mediaStore` throws on native. Needs expo-file-system
   storage, expo-image-picker, and the §5.1 EXIF strip.
6. **Never run on a real phone.** Emulator only. The Huawei P30 Lite is locked
   by FRP after a factory reset with a deleted account.
7. **iOS** needs a paid Apple account to build from Windows.

### Cleanups
8. `@maplibre/maplibre-react-native` deprecates the `style` prop; removed in
   v12. Migrate to `paint`/`layout`.
9. ESLint rule to enforce layer boundaries (`core/` must not import `ui/`).
10. Repositories still sit on the KV document store. The Drizzle tables exist
    and are migrated; moving over is confined to `storage-local/`.
11. Kerbs are generated but disabled (`SHOW_KERBS = false`).

### Reserved for a human (§0.2)
12. **Le Mans is partial.** The Mulsanne is public road (D338) with no route
    relation; which ways form the lap is a judgement call, not an extraction.
    Labelled "(WIP)" in the UI.
13. Circuit presets — timezone, layout variants, marshal post numbering — are
    seed data to be sourced from official documents, not inferred.

---

## Decisions worth not re-opening

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
- **Direct route legs are drawn dashed** and never styled like a path. They are
  a bearing, not a way — the same honesty rule as never inferring access.
- **Estimates round up and are labelled "about".** Five minutes early costs
  five minutes; five minutes late costs the session.
