# 3D terrain in two or three days

> "If we succeed it's very good; if we don't we can just revert commits."

That is the right framing, and it is why this is worth attempting. **Nothing
here is implemented.** Review the approach before any of it is built —
especially §"What this will not be", because agreeing on that is what decides
whether the result counts as success.

**Checkboxes mean "an agent may take this".**

---

## The situation

`maplibre-react-native` has no terrain-mesh support: no `terrain` key handling
in either native bridge, nothing exposed in its JS. Upstream MapLibre Native is
building it, but that has to ship *and then* reach the React Native binding.
Not this week, and not on any date we can plan against.

So a real DEM-driven mesh is off the table. The question is what else gets you a
landscape you can read.

---

## Two ways, and only one of them is sane in three days

### A. Host maplibre-gl in a WebView

The web build already has terrain — `MapScreen.web.tsx` calls `setTerrain()` and
it works. Put that same library in a WebView and the phone gets it too.

**Rejected**, for reasons that are specific rather than squeamish:

- It replaces the entire map screen. Every gesture, every layer, every spot tap,
  the sun dial overlay, the navigator — all of it currently native, all of it
  through a bridge instead.
- The pmtiles archive has to reach the WebView, offline. Possible, but it is a
  second delivery mechanism for the app's largest asset.
- **We already have a WebView on iOS that does not work.** The PDF bridge is
  still broken on the phone after two attempts, for reasons that remain
  unproven. Betting the map on the same component this week is not a risk, it is
  a repeat.
- 14k tree points render natively today. Through a WebView they will not.

Three days is not enough to do this and find out it was wrong.

### B. Terraced terrain from extruded contour bands — **recommended**

Convert the elevation data into contour bands, and draw each band as a
`fill-extrusion` polygon whose base and height are its elevation range. The
result is a stepped landscape: a contour model, like a laser-cut hill.

Why this is the tractable one:

- **The renderer already does it.** `fill-extrusion` with a data-driven
  `fill-extrusion-height` is what draws the buildings visible in the 3D
  screenshot on the phone right now. No new capability is needed from MapLibre,
  the binding, or iOS.
- **The data already downloads.** `storage-local/terrainCache.ts` fetches the
  Terrarium DEM tiles per venue, resumably, offline-first. Written last week for
  hillshading; it is exactly the input this needs.
- **It is build-time work.** Contours are generated on a workstation and shipped
  as GeoJSON, like `trees.json` and `buildings.json` already are. Nothing heavy
  happens on the phone.
- **It fails safely.** If it looks wrong, one flag turns the layer off, exactly
  as `SHOW_KERBS` does now.

---

## What this will not be

Agree on this first, because it is the difference between a success and a
disappointment:

- **Not smooth.** Terraces, not a mesh. At a 10m contour interval the Eifel
  reads as roughly 30 steps.
- **Not draped.** The basemap does not deform. Roads, the circuit and spots stay
  flat on the ground plane, with the terrain rising *around* them. The circuit
  will not climb Eau Rouge.
- **Not a substitute for the real thing** when MapLibre ships it.

What it *is*: you can see that Raidillon goes up, that Brünnchen sits in a
bowl, that a spot is below an embankment. Which is the actual question this
feature exists to answer.

---

## Day 1 — prove the riskiest thing first

- [ ] **T1. Verify data-driven `fill-extrusion-base` on the device.** Buildings
      use a constant `base: 0`. Terracing needs base *and* height driven by a
      property. If the native SDK only honours a constant base, the fallback is
      one layer per band (~30 layers) — workable, but it changes the shape of
      everything after this. **Half a day, and everything else depends on it.**
      Test with a hand-written GeoJSON of three boxes at different bases before
      writing any pipeline.

- [ ] **T2. Decode a Terrarium tile to an elevation grid.** Terrarium encodes
      height as `(R * 256 + G + B / 256) - 32768` metres. Needs a PNG decoder;
      `pngjs` as a **devDependency** — build-time only, so no pod, no app size,
      no rebuild risk. (`scripts/build-sprites.mjs` hand-rolls a PNG *encoder*
      with `zlib`; a decoder is the same trick backwards if adding the dep is
      unwanted.)

- [ ] **T3. Contours from the grid.** `d3-contour` is pure JS and does marching
      squares properly. Output is GeoJSON MultiPolygons per threshold, which is
      already the shape needed.

**End of day 1: a `nordschleife.terrain.json` on disk, and certainty about T1.**

---

## Day 2 — get it on the map

- [ ] **T4. `npm run terrain -- <venue>`**, alongside the other extract scripts.
      Reads the DEM, writes `<venue>.terrain.json`. Bands at 10m; make the
      interval an argument, because the right value differs between the Eifel
      and Zandvoort and will only be found by looking.

- [ ] **T5. A `terrain-bands` fill-extrusion layer**, visible only in 3D like
      the hillshade and buildings, driven off `terrain3d` through
      `threeDVisibility`.

- [ ] **T6. Make it look like ground rather than a bar chart.** Below the
      circuit in draw order, muted, low opacity, colour ramped by elevation.
      This is where it either reads as a landscape or as clutter, and it is
      worth more of the day than it sounds.

- [ ] **T7. Watch the size.** 14k tree points already make style rebuilds
      expensive, and a 3D toggle rebuilds the whole document. If the bands push
      it too far, drop to a coarser interval before doing anything cleverer.

**End of day 2: relief on the phone, at one venue.**

---

## Day 3 — all venues, or revert

- [ ] **T8. Generate for all seven.** Cheap once the script exists.
- [ ] **T9. Verify offline.** The bands ship in the bundle, so this should be
      free — but "should be" is what has cost us most of this week.
- [ ] **T10. Check it against reality at a circuit you know.** Does Eau Rouge
      rise? Is Brünnchen in a bowl? If the answer is no, the interval or the
      exaggeration is wrong, not the approach.
- [ ] **T11. A flag to switch it off**, like `SHOW_KERBS`.

---

## When to stop

Revert if any of these is true at the end of day 2:

- `fill-extrusion-base` cannot be data-driven **and** 30 layers per venue is too
  slow on the phone.
- The bands cost more than roughly 500KB per venue, or make the 3D toggle
  visibly slower than it already is.
- It reads as clutter rather than landscape, and one afternoon of tuning has not
  fixed it.

Reverting is genuinely cheap here: the layer is additive, the generated files
are new, and nothing existing changes except a few lines of style composition.
That is the main argument for doing it this way rather than the WebView.

---

## Done means

- Tilting the map at the Nürburgring shows the Eifel rising around the circuit.
- It works with no signal.
- It can be switched off in one line if it turns out to be a bad idea.
- Nobody is told it is a terrain mesh, because it is not one.
