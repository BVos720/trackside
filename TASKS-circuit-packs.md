# Circuit packs — adding a circuit without shipping an app

> "We prepare the way the circuit is identified, and when you download the
> circuit you download it the way it was prepared before."

Branco's design, and it is the right one. This document is the plan, not the
build. **Nothing here is implemented.**

**Checkboxes mean "an agent may take this".**

---

## The idea

All the hard work happens **once, on a workstation**, and produces a finished
pack. The phone downloads that pack and unpacks it. The phone never extracts
anything, never queries OSM, never derives a kerb.

That split is what makes the whole thing tractable, and it solves a problem the
naive version cannot:

**Street circuits.** The extractor finds `highway=raceway`. Le Mans' Mulsanne
is public road, so it cannot be found that way — which is why `CircuitScreen`
already carries a note calling Le Mans partial. If preparation is a human step
on a workstation, the answer is simply *to draw it*, by hand, once. The pack
that results is indistinguishable from an automatic one. An app doing its own
extraction could never do this.

The same applies to anything else OSM gets wrong or omits: a circuit mid-
rebuild, a layout variant, a venue nobody has mapped properly. Preparation is
where judgement goes.

---

## Why it is worth doing

**Today a new circuit is an app release.** Add a venue and it needs a rebuild,
a signing key, a store review and a version bump before anyone can use it. For
an app whose adoption question is literally *"does it have my circuit?"*, that
is the wrong shape.

With packs, adding a circuit is uploading a file. That also means:

- Circuits can be added between releases, including during a season
- A fix to one circuit's geometry does not wait for a build
- The app download stays small — 23MB of tiles today, growing with every venue
- **No signing key is spent** to add a circuit, which matters while builds are
  sideloaded and rationed

---

## What a pack contains

Everything `assets/circuits/` and `assets/tiles/` hold for one venue today,
plus the metadata that currently lives in code:

| File | What it is | Rough size |
|---|---|---|
| `manifest.json` | label, country, centre, bounds, circuitBounds, min/max zoom | < 1 KB |
| `basemap.pmtiles` | the offline map | 1–7 MB |
| `circuit.json` | racing surface | 100–400 KB |
| `mask.json` | 300m corridor | small |
| `kerbs.json` | corner segments | small |
| `paths.json` | walkable network | varies |
| `buildings.json` | footprints | small |
| `trees.json` / `woodland.json` | scenery scatter | up to a few MB |
| `terrain/` | 20–70 Terrarium DEM tiles | 2–6 MB |

Call it **5–15 MB per circuit**. The terrain half already works — see
`storage-local/terrainCache.ts`, which downloads, caches, resumes and serves
locally. That was built as the small version of this, deliberately.

---

## The one hard part

`VenueKey` is `keyof typeof WEB_TILES`. **The venue set is a compile-time
fact**, and eight maps are exhaustive by construction:

- `CIRCUIT_GEOJSON`, `PATHS_GEOJSON`, `MASK_GEOJSON`, `BUILDINGS_GEOJSON`,
  `TREES_GEOJSON`, `KERBS_GEOJSON`, `WEB_TILES`, `VENUE_VIEW` (`ui/map/style.ts`)
- `TILE_ASSETS` (`ui/screens/MapScreen.tsx`)

Nine files reference `VenueKey` or `VENUE_VIEW`. Making venues a runtime set
means `VenueKey` becomes `string`, every one of those lookups can miss, and a
type that currently makes "unknown venue" unrepresentable stops doing so.

**Do not do that as one change.** The bundled circuits work; a big-bang refactor
risks them for no immediate gain.

### Do it in two lanes instead

- [ ] **C1. A venue *resolver*, not a venue *map*.** One function answers
      "give me everything for this venue" and every call site goes through it.
      Bundled venues answer from the existing static maps, unchanged and still
      exhaustive. This is a pure refactor with no behaviour change and no new
      capability — land it on its own, verify nothing moved, and the risky part
      is over before any pack exists.

- [ ] **C2. Downloaded venues as a second source behind the same resolver.**
      Only now does `VenueKey` widen to `string`, and only the resolver has to
      care. A missing pack becomes one failure, in one place, with one message
      — rather than nine call sites each finding `undefined`.

---

## The rest

- [ ] **C3. `npm run pack -- <venue>`.** Produces the directory above from what
      the existing scripts already generate. Mostly assembly and a manifest;
      the extraction work is done.

- [ ] **C4. Somewhere to host them.** No backend exists and none should be
      introduced for this. Two options that need no server:
      **Cloudflare R2** (10GB free, no egress charges) or **GitHub Releases**
      (release assets are an explicitly supported use, unlike Pages —
      see the note in `ui/map/style.ts` about why the sprite was removed).
      A static `index.json` lists what is available.

- [ ] **C5. Download, with §1.4 taken seriously.** The rule does not bend: at a
      circuit the app works with no signal. A downloaded circuit satisfies that
      **only if it was fetched beforehand**, so the UI must show that state
      rather than let it be discovered in the Eifel. Follow what
      `terrainCache.ts` already does — resumable, counts real files rather than
      trusting a flag, never downloads on its own initiative.

- [ ] **C6. Refuse to activate an event for a circuit that is not downloaded**,
      or warn loudly enough that nobody travels on the assumption. This is the
      failure mode that turns a planning tool into a liability.

- [ ] **C7. Storage management.** 5–15MB each adds up, and a phone that fills
      up is a phone that stops taking photographs. Show what is stored, let it
      be deleted, never delete silently.

- [ ] **C8. Versioning in the manifest.** A circuit gets re-surveyed, a layout
      changes, a mistake is fixed. The app should notice a newer pack exists and
      offer it — while online, never at the circuit.

---

## Deliberately not in scope

**Packs do not carry anyone's spots.** A pack is circuit data — surface,
terrain, paths, buildings. Waypoints are the user's own records and travel by
the separate sharing route (see the map-layouts work). Mixing them would mean a
pack update could touch someone's data, which must never happen.

---

## Done means

- Adding a circuit requires uploading a file, not building an app.
- A street circuit can be added by drawing it, and the app cannot tell.
- No call site outside the resolver knows whether a venue is bundled or
  downloaded.
- The app refuses to let someone travel to a circuit it has not downloaded
  without having said so plainly, while they still had signal.
