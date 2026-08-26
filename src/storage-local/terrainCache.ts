/**
 * Elevation tiles, downloaded once and kept — native.
 *
 * ── Why these are fetched rather than bundled ─────────────────────────────
 * Every other map asset in this app ships inside the binary: the basemap
 * (`assets/tiles`), the label fonts (`assets/glyphs`), the circuit geometry.
 * Terrain deliberately does not, and the reason is not size — a venue's DEM is
 * only 20–70 tiles, a few megabytes, less than its basemap.
 *
 * It is that **bundling makes a new circuit an app release.** Every venue added
 * to `VENUE_VIEW` today needs a rebuild, a signing key and a store round trip
 * before anybody can use it. For an app whose adoption question is "does it
 * have my circuit", that is the wrong shape: the answer should be a file
 * somebody uploads, not a version somebody ships.
 *
 * This module is the small version of that idea. It gets the plumbing right —
 * download, cache, serve locally, survive being interrupted — against an asset
 * that already exists on a public endpoint. Circuit packs later reuse it.
 *
 * ── §1.4 is not weakened by this, but it is now conditional ───────────────
 * The rule stands: at the circuit the app must work with no signal. Terrain now
 * meets that rule only if it was fetched beforehand, so "have you downloaded
 * this circuit" becomes a state the UI has to *show*, not something the user is
 * left to discover in the Eifel. `terrainStatus` exists for that, and nothing
 * here ever downloads on its own — it is always something the user asked for,
 * while they still had a connection to ask on.
 *
 * The basemap is untouched by any of this and remains bundled. Losing the map
 * is not survivable; losing hillshading is.
 */
import { Directory, File, Paths } from 'expo-file-system';

/** Where the DEM comes from. Public, free, no key — see PRIVACY.md. */
const TERRAIN_ENDPOINT = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium';

/** Under the document directory, one folder per venue. */
const FOLDER = 'terrain';

/**
 * The zoom range worth storing.
 *
 * The style declares the DEM source at `maxzoom: 14`, so nothing above that is
 * ever requested. The floor is 8 rather than 0 because the venue bounds confine
 * the mesh anyway: below 8 a single tile spans most of a country, and the few
 * bytes saved by skipping it cost a visible seam when the camera pulls back.
 */
const MIN_ZOOM = 8;
const MAX_ZOOM = 14;

export interface TerrainStatus {
  /** Tiles present on disk. */
  readonly have: number;
  /** Tiles this venue needs in total. */
  readonly need: number;
  /** True when every tile is present, so 3D works with no signal. */
  readonly complete: boolean;
}

export interface LatLonBounds {
  /** `[[west, south], [east, north]]` — the shape `VenueView.bounds` uses. */
  readonly bounds: readonly [readonly [number, number], readonly [number, number]];
}

const lonToX = (lon: number, z: number): number =>
  Math.floor(((lon + 180) / 360) * 2 ** z);

const latToY = (lat: number, z: number): number => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
  );
};

/** Every `{z, x, y}` covering `bounds` between MIN_ZOOM and MAX_ZOOM. */
function tilesFor(
  bounds: LatLonBounds['bounds'],
): { z: number; x: number; y: number }[] {
  const [[west, south], [east, north]] = bounds;
  const out: { z: number; x: number; y: number }[] = [];

  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    const x0 = lonToX(west, z);
    const x1 = lonToX(east, z);
    // y is inverted: north is the smaller index.
    const y0 = latToY(north, z);
    const y1 = latToY(south, z);

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) out.push({ z, x, y });
    }
  }

  return out;
}

function venueDirectory(venue: string): Directory {
  return new Directory(Paths.document, FOLDER, venue);
}

/**
 * How much of this venue's terrain is on the device.
 *
 * Counts files rather than trusting a "downloaded" flag: a run interrupted
 * halfway leaves a directory that exists and is useless, and a flag would call
 * that done. The count is what the UI shows, and it is the truth.
 */
export async function terrainStatus(
  venue: string,
  bounds: LatLonBounds['bounds'],
): Promise<TerrainStatus> {
  const tiles = tilesFor(bounds);

  try {
    const dir = venueDirectory(venue);
    if (!dir.exists) return { have: 0, need: tiles.length, complete: false };

    let have = 0;
    for (const t of tiles) {
      if (new File(dir, `${t.z}-${t.x}-${t.y}.png`).exists) have++;
    }
    return { have, need: tiles.length, complete: have === tiles.length };
  } catch {
    return { have: 0, need: tiles.length, complete: false };
  }
}

/**
 * Fetch whatever is missing.
 *
 * Resumable by construction: an existing tile is skipped, so a run cut off by a
 * lost connection or a backgrounded app picks up where it stopped rather than
 * starting again. `onProgress` fires per tile so the caller can show something
 * moving — this is a few dozen requests and it is worth being visibly finite.
 *
 * Serial, not parallel. This is tens of tiles against a public bucket that costs
 * nobody anything to be polite to, the whole job is seconds either way, and a
 * burst of concurrent requests on a weak connection is how you get a handful of
 * partial writes instead of a clean stop.
 *
 * Returns the status after the attempt. It does not throw: a partial download is
 * a real outcome that `terrainStatus` already describes, and the caller's job is
 * to report it, not to handle an exception.
 */
export async function downloadTerrain(
  venue: string,
  bounds: LatLonBounds['bounds'],
  onProgress?: (have: number, need: number) => void,
): Promise<TerrainStatus> {
  const tiles = tilesFor(bounds);

  let dir: Directory;
  try {
    dir = venueDirectory(venue);
    if (!dir.exists) dir.create({ intermediates: true });
  } catch {
    return { have: 0, need: tiles.length, complete: false };
  }

  let have = 0;

  for (const t of tiles) {
    const target = new File(dir, `${t.z}-${t.x}-${t.y}.png`);

    if (target.exists) {
      have++;
      onProgress?.(have, tiles.length);
      continue;
    }

    try {
      const response = await fetch(`${TERRAIN_ENDPOINT}/${t.z}/${t.x}/${t.y}.png`);
      if (!response.ok) continue;

      const bytes = new Uint8Array(await response.arrayBuffer());
      // A zero-length body would create a file that `terrainStatus` counts as
      // present and MapLibre cannot decode — worse than a missing tile, which
      // simply falls back to flat ground.
      if (bytes.byteLength === 0) continue;

      target.create();
      target.write(bytes);
      have++;
    } catch {
      // Offline partway through, or one bad tile. Both are survivable: the
      // next run resumes, and terrain degrades to flat where a tile is absent.
    }

    onProgress?.(have, tiles.length);
  }

  return { have, need: tiles.length, complete: have === tiles.length };
}

/**
 * The URL template for locally stored tiles, or null when none are stored.
 *
 * Flat filenames (`14-8452-5478.png`) rather than nested `{z}/{x}/{y}`
 * directories, because MapLibre substitutes into the template as plain text and
 * a flat folder is one `exists` check per tile instead of walking a tree — the
 * same reason the glyph cache keeps its stacks shallow.
 *
 * Null rather than an empty template when nothing is downloaded: the caller
 * falls back to the network endpoint, which is the correct behaviour at home
 * and the honest one at a circuit, where it simply will not resolve and the
 * ground stays flat.
 */
export function localTerrainTemplate(venue: string): string | null {
  try {
    const dir = venueDirectory(venue);
    if (!dir.exists) return null;
    const base = dir.uri.replace(/\/$/, '');
    return `${base}/{z}-{x}-{y}.png`;
  } catch {
    return null;
  }
}

/** Remove a venue's stored terrain. Storage is finite and this is the largest thing in it. */
export async function clearTerrain(venue: string): Promise<void> {
  try {
    const dir = venueDirectory(venue);
    if (dir.exists) dir.delete();
  } catch {
    // Already gone is the outcome we wanted.
  }
}
