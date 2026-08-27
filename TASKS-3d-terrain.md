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

## Day 1 — DONE. The spike passed.

Ran on the phone, 27 August:

    terrain-attached  yes
    elevation         1201 m
    pitch             59°
    56 fps

1201m is 600m of Eifel times the 2.0 exaggeration the spike sets, so the number
is not merely non-zero, it is *right*. Real relief on screen, ridges and
valleys, at a frame rate better than the first attempt's 38.

That settles every question the WebView route could have died on: the component
works on this device despite the PDF bridge's troubles, WebGL is available,
maplibre-gl loads from a CDN, the DEM endpoint is reachable from a page on a
made-up origin, and `setTerrain` produces a mesh rather than merely being
accepted.

**The approach is viable.** The contour-band fallback in the section above is
no longer needed and should not be built.

Two false starts worth remembering, both mine: `webgl-unsupported` was my own
check firing because maplibre-gl v5 deleted the helper it called, and the first
run's flat beige screen was demotiles at zoom 13 over Zolder — a demo style
with no detail, at a venue with forty metres of relief. Neither was the app's
fault, and both cost a build.

---

## What is actually left, and the one hard part

The renderer is proven. Everything remaining is **delivery and integration**,
and one piece of it is genuinely hard.

### Day 2 — offline pmtiles into the WebView

**This is the risk now.** The basemap is a 3–7MB `.pmtiles` archive in the app
bundle, and the page has to read it with no signal.

The obvious route does not work: pmtiles normally reads with HTTP **range
requests**, and `file://` has no range semantics. Giving the WebView file
access does not solve it.

- [ ] **T1. Whole-archive in memory.** pmtiles' JS exposes a `Source`
      interface, so a source backed by an in-memory ArrayBuffer sidesteps
      ranges completely. The archives are 3–7MB — large for a message, but a
      once-per-venue cost, and `MapScreen.tsx` already unpacks the file to a
      `file://` path that `expo-file-system` can read.
      **Try this first: it needs no new native dependency.**

- [ ] **T2. If that is too slow or too big, a local HTTP server.** Serving
      `http://localhost:PORT/` from inside the app restores real range
      requests and is the clean answer — at the cost of another native module,
      which is exactly the sort of thing that has broken builds this week.

- [ ] **T3. Measure honestly.** 56 fps is a bare hillshade. The real style
      carries the circuit, the corridor mask, buildings and up to 14k tree
      points. Re-measure with all of it before believing the number.

### Day 3 — integration

The overlays stay native and do not move: sun dial, sky strip, ruler, menu,
navigator, spot sheet. Only the map itself goes into the WebView, so the bridge
is small but real:

- [ ] **T4. Spots in** — the GeoJSON the map already builds, passed through.
- [ ] **T5. Taps out** — tapping a spot must open it; tapping the map must
      place one. Both need coordinates back on the native side.
- [ ] **T6. Camera out** — zoom drives callout visibility, and the ruler reads
      the viewport.
- [ ] **T7. Camera in** — venue switch, and the 2D/3D toggle.
- [ ] **T8. Keep the native map.** Ship both behind a setting rather than
      replacing MapScreen outright. The native one works, is fast, and is what
      the app has been tested on; the WebView one is new and has a WebView's
      failure modes. Choosing is cheap, and being wrong about this in the field
      is not.

---

## When to stop

Revert if, at the end of day 2:

- The archive cannot reach the page without a native HTTP server **and** adding
  one destabilises the build.
- The frame rate with the real style drops below roughly 25fps on this phone.
- Touch through the WebView feels worse than the native map in a way tuning
  does not fix.

Reverting stays cheap: the WebView map is additive, behind a setting, and the
native map is untouched.

---

## Done means

- Tilting at the Nürburgring shows the Eifel rising around the circuit.
- It works with no signal.
- The native map is still there and still the default until the new one earns
  its place.
- Nobody has to choose between "3D" and "works at a circuit".
