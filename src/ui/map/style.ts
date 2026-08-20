/**
 * MapLibre style construction — spec §3.1, §5.14.
 *
 * One style definition shared by the native and web map screens, so the two
 * cannot drift into rendering different maps.
 *
 * The basemap is a self-hosted PMTiles archive (see scripts/extract-tiles.mjs).
 * Spec §3.1 forbids using OpenStreetMap's public tile servers in an
 * application, and §1.4 requires the map to work with no signal at all, so
 * every tile the app draws comes from a file that shipped with it.
 */
import { layers, namedFlavor } from '@protomaps/basemaps';

import nordschleifeCircuit from '../../../assets/circuits/nordschleife.json';
import nordschleifeMask from '../../../assets/circuits/nordschleife.mask.json';
import nordschleifeKerbs from '../../../assets/circuits/nordschleife.kerbs.json';
import nordschleifeBuildings from '../../../assets/circuits/nordschleife.buildings.json';
import nordschleifeTrees from '../../../assets/circuits/nordschleife.trees.json';
import nordschleifePaths from '../../../assets/circuits/nordschleife.paths.json';

import spaCircuit from '../../../assets/circuits/spa-francorchamps.json';
import spaMask from '../../../assets/circuits/spa-francorchamps.mask.json';
import spaKerbs from '../../../assets/circuits/spa-francorchamps.kerbs.json';
import spaBuildings from '../../../assets/circuits/spa-francorchamps.buildings.json';
import spaTrees from '../../../assets/circuits/spa-francorchamps.trees.json';
import spaPaths from '../../../assets/circuits/spa-francorchamps.paths.json';

import zandvoortCircuit from '../../../assets/circuits/zandvoort.json';
import zandvoortMask from '../../../assets/circuits/zandvoort.mask.json';
import zandvoortKerbs from '../../../assets/circuits/zandvoort.kerbs.json';
import zandvoortBuildings from '../../../assets/circuits/zandvoort.buildings.json';
import zandvoortTrees from '../../../assets/circuits/zandvoort.trees.json';
import zandvoortPaths from '../../../assets/circuits/zandvoort.paths.json';

import leMansCircuit from '../../../assets/circuits/le-mans.json';
import leMansMask from '../../../assets/circuits/le-mans.mask.json';
import leMansKerbs from '../../../assets/circuits/le-mans.kerbs.json';
import leMansBuildings from '../../../assets/circuits/le-mans.buildings.json';
import leMansTrees from '../../../assets/circuits/le-mans.trees.json';
import leMansPaths from '../../../assets/circuits/le-mans.paths.json';

import zolderCircuit from '../../../assets/circuits/zolder.json';
import zolderMask from '../../../assets/circuits/zolder.mask.json';
import zolderKerbs from '../../../assets/circuits/zolder.kerbs.json';
import zolderBuildings from '../../../assets/circuits/zolder.buildings.json';
import zolderTrees from '../../../assets/circuits/zolder.trees.json';
import zolderPaths from '../../../assets/circuits/zolder.paths.json';

import suzukaCircuit from '../../../assets/circuits/suzuka.json';
import suzukaMask from '../../../assets/circuits/suzuka.mask.json';
import suzukaKerbs from '../../../assets/circuits/suzuka.kerbs.json';
import suzukaBuildings from '../../../assets/circuits/suzuka.buildings.json';
import suzukaTrees from '../../../assets/circuits/suzuka.trees.json';
import suzukaPaths from '../../../assets/circuits/suzuka.paths.json';

import fujiCircuit from '../../../assets/circuits/fuji.json';
import fujiMask from '../../../assets/circuits/fuji.mask.json';
import fujiKerbs from '../../../assets/circuits/fuji.kerbs.json';
import fujiBuildings from '../../../assets/circuits/fuji.buildings.json';
import fujiTrees from '../../../assets/circuits/fuji.trees.json';
import fujiPaths from '../../../assets/circuits/fuji.paths.json';

/** Logical name of the vector source. Referenced by the generated layers. */
export const BASEMAP_SOURCE = 'protomaps';

/** GeoJSON source holding the circuit centreline (see scripts/extract-circuits.mjs). */
export const CIRCUIT_SOURCE = 'circuit';

/** Elevation source backing 3D terrain and hillshade — spec §3.2. */
export const TERRAIN_SOURCE = 'terrain';

/** Inverted corridor polygon — everything beyond 300m of the circuit. */
export const MASK_SOURCE = 'corridor-mask';
export const BUILDINGS_SOURCE = 'buildings';
export const TREES_SOURCE = 'trees';
export const KERBS_SOURCE = 'kerbs';

/** User-created photography spots — spec §5.1. */
export const SPOTS_SOURCE = 'spots';

/**
 * Spot pin colour.
 *
 * Kept in step with `color.accent` in ../theme.ts by hand — the style module
 * is deliberately free of UI imports so it can be built without React, which
 * is what lets the same file serve the native and web map screens.
 */
const SPOT_ACCENT = '#2E7DF6';

/** Hidden spots stay on the map but recede — see Spot.isHidden. */
const SPOT_HIDDEN = '#59636F';

/** Pin colour by hidden state. */
const SPOT_COLOUR = [
  'case',
  ['==', ['coalesce', ['get', 'hidden'], 0], 1],
  SPOT_HIDDEN,
  SPOT_ACCENT,
];

/**
 * AWS Terrain Tiles, Terrarium-encoded — spec §3.2's "easy global option".
 *
 * Free, no API key, and drops straight into MapLibre as a `raster-dem` source.
 *
 * ── This is network-dependent and therefore NOT offline-capable. ───────────
 * Spec §1.4 makes offline the baseline, and these tiles are fetched over HTTP,
 * so 3D terrain will not work in the Eifel dead zones. Acceptable for a first
 * pass because terrain is a planning-mode feature (§5.14) used at home, while
 * trackside mode stays flat 2D — but it is not the finished answer.
 *
 * The finished answer is §3.2's per-venue option: national LiDAR (DGM1 for
 * Rheinland-Pfalz, Wallonia 1m for Spa, AHN4 for Zandvoort) processed through
 * GDAL into Terrarium-encoded PMTiles and shipped with the app. That is also
 * what makes the viewshed (§3.4) and terrain shadowing (§5.2) possible, since
 * both need the surface model rather than a global 30m approximation.
 */
export const TERRAIN_TILES =
  'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';

export const TERRAIN_ATTRIBUTION = 'Elevation: AWS Terrain Tiles / NASA SRTM';

/** Used before a real sun position is known, and at night. */
export const DEFAULT_ILLUMINATION = 315;

/**
 * Terrain exaggeration.
 *
 * 1.0 is truthful but reads as flat on a phone at circuit scale, because the
 * elevation change across the Nordschleife (~300m over 20km) is small next to
 * the horizontal extent. Mild exaggeration makes Fuchsröhre and the climb to
 * Hohe Acht legible without turning the Eifel into the Alps.
 */
export const TERRAIN_EXAGGERATION = 1.4;

/** Layers that only make sense once the camera is tilted. */
/**
 * Visibility for a layer that only exists in 3D.
 *
 * The web screen flips these imperatively with `setLayoutProperty` once
 * terrain is on. MapLibre React Native has no equivalent, so native bakes the
 * answer into the style — and both need the *same* four layers, or 3D means
 * something different on each platform. That is why this is one helper rather
 * than a literal repeated at each layer.
 */
export const threeDVisibility = (on: boolean) =>
  ({ visibility: on ? ('visible' as const) : ('none' as const) });

export const THREE_D_LAYERS = [
  'terrain-hillshade',
  'buildings-3d',
  'trees',
  'ground-detail',
] as const;

/**
 * Bearing the light arrives from, for terrain shading — spec §5.12.
 *
 * Solar azimuth already means "where the sun is", which is where the light
 * comes from, so it maps directly onto MapLibre's illumination direction.
 *
 * Below the horizon there is no sun to light the terrain, so shading falls
 * back to a conventional north-west key light rather than illuminating the
 * hills from underneath — which would render ridges inverted.
 */
export function illuminationFromSun(altitude: number, azimuth: number): number {
  return altitude > 0 ? azimuth : DEFAULT_ILLUMINATION;
}

/**
 * ODbL attribution — spec §8.
 *
 * Required to be *visible*, not merely present in the archive metadata. The
 * tiles carry it internally, but the licence obliges the application to show
 * it, so the map screens render it over the canvas.
 */
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/**
 * Where label glyphs come from — §1.4.
 *
 * Bundled, not fetched. Labels used to come from protomaps.github.io, which
 * meant that in the Eifel — the one place this app is built for — the basemap
 * drew every road and named none of them. `npm run glyphs` downloads the Latin
 * ranges into the repo; web serves them from `public/`, and native copies them
 * out of the bundle on first run (storage-local/glyphs.ts).
 *
 * The remote URL is kept as a fallback for the case where the native copy
 * fails: remote labels beat no labels, and this must never be the reason a
 * basemap does not load.
 *
 * Non-Latin is not bundled. Japanese labels at Suzuka and Fuji need most of the
 * CJK ranges — tens of megabytes — so they fall back to Latin script or stay
 * unnamed. Documented rather than silently broken.
 */
export const GLYPHS_URL = '/fonts/{fontstack}/{range}.pbf';

/** The stacks `npm run glyphs` bundles. Nothing else may be requested. */
export const BUNDLED_STACKS = [
  'NotoSansRegular',
  'NotoSansMedium',
  'NotoSansItalic',
] as const;

/**
 * Rewrite every layer's `text-font` to a single bundled stack.
 *
 * ── Why this is necessary and not merely tidy ─────────────────────────────
 * The Protomaps basemap ships its own layers with their own fonts, including
 * fallback arrays like `["Noto Sans Regular", "Noto Sans Devanagari"]`. A
 * multi-entry stack is requested as one comma-joined name, which no bundled
 * directory can match — so those labels fail against a local glyph source even
 * though the fonts "look" present.
 *
 * Collapsing to one entry per layer means every request resolves to a folder
 * that exists. Weight and italic are preserved by mapping to the matching
 * bundled stack; anything unrecognised becomes Regular, because an unknown font
 * rendering in the wrong weight beats a label that does not render at all.
 */
function normaliseFontStacks(layers: unknown[]): void {
  for (const layer of layers) {
    const l = layer as { layout?: Record<string, unknown> };
    const font = l.layout?.['text-font'];
    if (!Array.isArray(font) || font.length === 0) continue;

    const joined = font.join(' ');
    l.layout!['text-font'] = [
      /italic/i.test(joined)
        ? 'NotoSansItalic'
        : /medium|bold/i.test(joined)
          ? 'NotoSansMedium'
          : 'NotoSansRegular',
    ];
  }
}

export const REMOTE_GLYPHS_URL =
  'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';

export const SPRITE_URL =
  'https://protomaps.github.io/basemaps-assets/sprites/v4/dark';

/**
 * Circuit geometry, sourced from OSM rather than the basemap.
 *
 * ── Why not filter the basemap's roads layer ───────────────────────────────
 * The obvious approach is to filter `roads` on `kind_detail == "raceway"`, and
 * it looks like it works: it draws a circuit. But querying the real tiles shows
 * those features span only 6.9337–6.9526 E, 50.3236–50.3393 N — a 1.3km box
 * containing the GP-Strecke alone. The whole Nordschleife arrives as unnamed
 * `tertiary` and `track` segments, because it is a public toll road and
 * Protomaps generalises it as ordinary highway.
 *
 * So that filter renders the GP circuit and silently omits the 20.8km loop the
 * app exists for. Raw OSM has all 98 raceway ways; they are extracted at build
 * time into these files.
 */
const CIRCUIT_GEOJSON = {
  nordschleife: nordschleifeCircuit,
  'spa-francorchamps': spaCircuit,
  zandvoort: zandvoortCircuit,
  'le-mans': leMansCircuit,
  zolder: zolderCircuit,
  suzuka: suzukaCircuit,
  fuji: fujiCircuit,
} as const;

/**
 * The walkable network per venue — service roads, walkways, forest tracks.
 *
 * Generated by `npm run paths`. Absent or empty is a supported state, not an
 * error: with no network every route falls back to a straight line, which the
 * navigator draws as a suggestion rather than an instruction.
 */
const PATHS_GEOJSON = {
  nordschleife: nordschleifePaths,
  'spa-francorchamps': spaPaths,
  zandvoort: zandvoortPaths,
  'le-mans': leMansPaths,
  zolder: zolderPaths,
  suzuka: suzukaPaths,
  fuji: fujiPaths,
} as const;

const MASK_GEOJSON = {
  nordschleife: nordschleifeMask,
  'spa-francorchamps': spaMask,
  zandvoort: zandvoortMask,
  'le-mans': leMansMask,
  zolder: zolderMask,
  suzuka: suzukaMask,
  fuji: fujiMask,
} as const;

/** OSM building footprints inside the corridor, with real heights where known. */
const BUILDINGS_GEOJSON = {
  nordschleife: nordschleifeBuildings,
  'spa-francorchamps': spaBuildings,
  zandvoort: zandvoortBuildings,
  'le-mans': leMansBuildings,
  zolder: zolderBuildings,
  suzuka: suzukaBuildings,
  fuji: fujiBuildings,
} as const;

/** Generated scatter inside real OSM woodland. Decorative, not surveyed. */
const TREES_GEOJSON = {
  nordschleife: nordschleifeTrees,
  'spa-francorchamps': spaTrees,
  zandvoort: zandvoortTrees,
  'le-mans': leMansTrees,
  zolder: zolderTrees,
  suzuka: suzukaTrees,
  fuji: fujiTrees,
} as const;

/**
 * Corner segments for kerbing — derived from centreline curvature, not OSM.
 *
 * OSM does not map racetrack kerbs, so unlike everything else on this map these
 * are inferred rather than sourced. See `cornerSegments` in
 * scripts/extract-circuits.mjs. They read the shape of the lap; they are not
 * survey data and nothing may use them as position.
 */
const KERBS_GEOJSON = {
  nordschleife: nordschleifeKerbs,
  'spa-francorchamps': spaKerbs,
  zandvoort: zandvoortKerbs,
  'le-mans': leMansKerbs,
  zolder: zolderKerbs,
  suzuka: suzukaKerbs,
  fuji: fujiKerbs,
} as const;

/**
 * Icon id for the tree sprite.
 *
 * Deliberately the same string as its key in `SCENERY_SPRITES`, so the layer's
 * `icon-image` and the registered image name cannot drift apart — a mismatch
 * renders nothing and only logs a style warning.
 */
export const TREE_ICON = 'tree';

/**
 * Scenery sprites, as bundled PNGs.
 *
 * These were SVG data URIs, which the browser decodes happily and Android
 * cannot decode at all — so the woodland scatter drew nothing on device while
 * looking right in the preview. `npm run sprites` rasterises them from the
 * shapes in scripts/build-sprites.mjs, and both platforms now load the same
 * bitmap rather than each interpreting its own source.
 *
 * Original note follows.
 *
 * Scenery sprites.
 *
 * Only `tree` is currently drawn. The shrub, grass and rock sprites were used
 * by a ground-detail layer that mixed them into the woodland scatter; that was
 * removed because OSM's `landuse=forest` polygons mean forest, and forest is
 * trees. They are kept because they are a few bytes and are the obvious
 * starting point if meadow and grass polygons ever get their own scatter — a
 * different landuse, which is why it would need its own point set rather than
 * borrowing the woodland one.
 *
 * All billboards: symbols, not geometry, so they work identically on web and on
 * the phone. MapLibre has no 3D model primitive and the React Native binding
 * has no custom-layer API, so instanced meshes could never reach the device.
 */
export const SCENERY_SPRITES: Record<string, number> = {
  tree: require('../../../assets/sprites/tree.png'),
  shrub: require('../../../assets/sprites/shrub.png'),
  grass: require('../../../assets/sprites/grass.png'),
  rock: require('../../../assets/sprites/rock.png'),
};

/** Sprite ids, used to register images and to filter the layers. */
export const SCENERY_KINDS = ['tree', 'shrub', 'grass', 'rock'] as const;

/**
 * A conifer, as an SVG data URI.
 *
 * Registered with `addImage` on web and via `Images` on native, then drawn by a
 * symbol layer with viewport pitch alignment so each tree stays upright and
 * facing the camera as the map tilts — the billboard-impostor trick.
 *
 * This is what makes trees possible at all: MapLibre has no 3D model
 * primitive, and the React Native binding has no custom-layer API, so instanced
 * meshes could never reach the phone. A billboard is core MapLibre and works on
 * both targets.
 */
export const TREE_SVG =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">` +
      `<path d="M12 1 L18 13 L14.5 13 L20 24 L4 24 L9.5 13 L6 13 Z" fill="#26543A"/>` +
      `<path d="M12 1 L18 13 L14.5 13 L20 24 L12 24 Z" fill="#1B3E2A"/>` +
      `<rect x="10.5" y="24" width="3" height="10" fill="#3A2A1E"/>` +
      `</svg>`,
  );

/**
 * Track width by zoom.
 *
 * Deliberately far heavier than a normal road. The circuit is the subject of
 * this map, not one feature among many — at a glance it should be obvious
 * where the track goes and everything else should read as context.
 */
const TRACK_WIDTH = [
  'interpolate',
  ['exponential', 1.6],
  ['zoom'],
  10, 2.5,
  12, 5,
  14, 11,
  16, 26,
  18, 60,
];

const TRACK_CASING_WIDTH = [
  'interpolate',
  ['exponential', 1.6],
  ['zoom'],
  10, 4.5,
  12, 8,
  14, 15,
  16, 32,
  18, 70,
];

/**
 * Signed kerb offset per side.
 *
 * Built as a whole interpolate expression per side rather than multiplying one
 * by ±1: MapLibre requires `["zoom"]` to sit directly under a top-level `step`
 * or `interpolate`, so `["*", -1, ["interpolate", … ["zoom"] …]]` is rejected
 * outright and the entire style fails to load.
 */
const kerbOffset = (sign: 1 | -1) => [
  'interpolate',
  ['exponential', 1.6],
  ['zoom'],
  12, 2.4 * sign,
  14, 5.2 * sign,
  16, 12.5 * sign,
  18, 29 * sign,
];

const KERB_WIDTH = [
  'interpolate',
  ['exponential', 1.6],
  ['zoom'],
  12, 1.2,
  14, 2.6,
  16, 6,
  18, 14,
];

/** Alternating blocks. */
const KERB_DASH = [1.4, 1.4];
const KERB_LIGHT = '#E8E8E8';
const KERB_DARK = '#C4342B';

/** Near-black asphalt. */
const TRACK_COLOUR = '#08090B';
/** A light edge so the dark ribbon stays legible against dark terrain. */
const TRACK_EDGE_COLOUR = '#59636F';

/**
 * Build a complete MapLibre style document.
 *
 * `tilesUrl` differs by platform: an `http(s)://` URL on web, a `file://` URI
 * resolved from the bundled asset on native. Both are wrapped in the
 * `pmtiles://` protocol prefix, which tells MapLibre to range-request inside
 * the single archive rather than expecting a {z}/{x}/{y} tile server.
 *
 * `spots` is the user's own waypoints, passed in as GeoJSON because they change
 * as the user edits them — everything else here is static build output.
 */
export function buildMapStyle(
  tilesUrl: string,
  venue: VenueKey,
  spots: unknown = { type: 'FeatureCollection', features: [] },
  /**
   * Omit the spot source and layers from the style document.
   *
   * The native screen declares them as <GeoJSONSource>/<Layer> components
   * instead. Editing a spot then updates only that source, rather than handing
   * MapLibre a whole new style — which carries 14k tree points and would make
   * every rename reload the map.
   */
  omitSpots = false,
  /**
   * Bake 3D terrain into the style document.
   *
   * The web screen turns terrain on imperatively with `map.setTerrain()`,
   * because maplibre-gl exposes it. MapLibre React Native does not — the only
   * way in is the style's own `terrain` key, so native rebuilds the style when
   * the user toggles 3D.
   *
   * That rebuild is not free: the document carries up to 14k tree points. It is
   * acceptable here only because toggling 3D is a deliberate, occasional act,
   * unlike renaming a spot — which is why `omitSpots` exists directly above.
   */
  terrain3d = false,
  /**
   * Override the glyph URL template.
   *
   * Native passes a `file://` template once the ranges have been copied out of
   * the bundle; web uses the default, which its dev server already serves.
   */
  glyphsUrl: string = GLYPHS_URL,
): unknown {
  const generated = layers(BASEMAP_SOURCE, namedFlavor('dark'), {
    lang: 'en',
  }) as { id: string; type: string }[];

  /**
   * Keep road geometry, drop every label.
   *
   * Roads inside the corridor are how you actually get between spots — the
   * access lanes, the tunnels under the track, the car park aisles. They need
   * no spatial filtering: the corridor mask is drawn last and roads are flat 2D
   * lines, so everything beyond 300m is painted over anyway.
   *
   * Labels stay gone. Village names, POIs, water names and road names are all
   * dropped so the only basemap text is the circuit's own corner names.
   */
  const keep = generated.filter(
    (l) =>
      !l.id.startsWith('places_') &&
      l.id !== 'pois' &&
      l.id !== 'roads_oneway' &&
      l.id !== 'roads_shields' &&
      !l.id.startsWith('roads_labels') &&
      !l.id.includes('_label_'),
  );

  const hillshade = {
    id: 'terrain-hillshade',
    type: 'hillshade',
    source: TERRAIN_SOURCE,
    // Hidden in 2D: relief shading on a flat map reads as smudged texture and
    // costs DEM tiles nobody asked for.
    layout: threeDVisibility(terrain3d),
    paint: {
      'hillshade-exaggeration': 0.55,
      'hillshade-shadow-color': '#05070A',
      'hillshade-highlight-color': '#6E7C8A',
      'hillshade-accent-color': '#1A222C',
      'hillshade-illumination-direction': DEFAULT_ILLUMINATION,
      'hillshade-illumination-anchor': 'map',
    },
  };

  /**
   * Buildings as extruded blocks — spec §3.3.
   *
   * Real OSM height where it exists, a modest default where it does not.
   * Coverage is thin: 19 of 1134 buildings at the Nürburgring, 0 of 158 at Spa,
   * 3 of 520 at Zandvoort. The fallback is a placeholder for "a building is
   * here", not a measurement — the viewshed (§3.4) must come from the DSM.
   */
  const buildings = {
    id: 'buildings-3d',
    type: 'fill-extrusion',
    source: BUILDINGS_SOURCE,
    layout: threeDVisibility(terrain3d),
    paint: {
      'fill-extrusion-color': '#2C333C',
      'fill-extrusion-height': ['coalesce', ['get', 'heightMetres'], 6],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-vertical-gradient': true,
    },
  };

  const trackLayers = [
    {
      id: 'track-casing',
      type: 'line',
      source: CIRCUIT_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': TRACK_EDGE_COLOUR,
        'line-width': TRACK_CASING_WIDTH,
      },
    },
    {
      id: 'track',
      type: 'line',
      source: CIRCUIT_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': TRACK_COLOUR, 'line-width': TRACK_WIDTH },
    },
  ];

  /**
   * Kerbs, as a white base with red blocks dashed over it.
   *
   * Two layers per side rather than one: MapLibre's `line-dasharray` alternates
   * a colour with transparency, not with a second colour, so alternating
   * red/white means painting the white run solid and dashing red on top.
   */
  const kerbSide = (side: 'left' | 'right') => {
    const offset = kerbOffset(side === 'left' ? -1 : 1);
    return [
      {
        id: `kerb-${side}-base`,
        type: 'line',
        source: KERBS_SOURCE,
        minzoom: 14,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': KERB_LIGHT,
          'line-width': KERB_WIDTH,
          'line-offset': offset,
        },
      },
      {
        id: `kerb-${side}-dash`,
        type: 'line',
        source: KERBS_SOURCE,
        minzoom: 14,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': KERB_DARK,
          'line-width': KERB_WIDTH,
          'line-offset': offset,
          'line-dasharray': KERB_DASH,
        },
      },
    ];
  };

  /**
   * Kerbing is drawn from zoom 14 up — spec §5.14, corner-level detail for
   * walking a circuit, not lap-overview scale.
   *
   * The original concern was `line-offset` folding through itself on corners
   * tighter than the offset distance: at z18 (the closest zoom any venue
   * allows) `kerbOffset` reaches 29m, and a corner near that radius offsets
   * into a tangle of loops spilling outside the track. `cornerSegments` in
   * scripts/extract-circuits.mjs now drops any corner under 40m of radius —
   * comfortable margin over the 29m worst case, not just clearance — which
   * removes the tightest 10-20% of corners per venue (the Karussell,
   * Hatzenbach) rather than rendering them broken. The offset is still a paint
   * property in screen pixels rather than real geometry, so it will drift
   * against the asphalt at zooms far from where `kerbOffset`'s stops were
   * tuned; doing that properly means mitred offset polygons generated at build
   * time. Re-run `npm run circuits` after changing `kerbOffset` or
   * `MIN_CORNER_RADIUS_M` so the two stay matched — see the margin comment on
   * the latter.
   */
  const SHOW_KERBS = true;
  const kerbLayers = SHOW_KERBS
    ? [...kerbSide('left'), ...kerbSide('right')]
    : [];

  /**
   * Trees as upright billboards.
   *
   * `icon-pitch-alignment: viewport` keeps each sprite facing the camera as the
   * map tilts, and `icon-anchor: bottom` plants it on the ground rather than
   * centring it in the air.
   */
  const billboard = {
    'icon-anchor': 'bottom',
    'icon-pitch-alignment': 'viewport',
    'icon-rotation-alignment': 'viewport',
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
  } as const;

  const trees = {
    id: 'trees',
    type: 'symbol',
    source: TREES_SOURCE,
    // Zoom-gated as well as mode-gated: 14k billboards at lap-overview zoom is
    // a green smear that costs frames and says nothing.
    minzoom: 14,
    layout: {
      ...threeDVisibility(terrain3d),
      ...billboard,
      'icon-image': TREE_ICON,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.18, 16, 0.42, 18, 0.72],
    },
  };

  /**
   * Grass and low plants in open fields.
   *
   * Same scatter source as the trees, split by `kind`. The build clips each
   * kind to its own landuse: trees only inside `landuse=forest` /
   * `natural=wood`, grass and plants only inside meadow, grassland and
   * farmland. Forest is trees; a meadow full of conifers would be as wrong as
   * a wood made of grass tufts.
   *
   * Held back to zoom 15. This is close-range ground texture — at circuit
   * overview zooms it would be a few pixels of noise across the whole lap,
   * costing draw calls for something nobody can see.
   */
  const groundDetail = {
    id: 'ground-detail',
    type: 'symbol',
    source: TREES_SOURCE,
    minzoom: 15,
    filter: ['!=', ['coalesce', ['get', 'kind'], 'tree'], 'tree'] as unknown,
    layout: {
      ...threeDVisibility(terrain3d),
      ...billboard,
      'icon-image': ['coalesce', ['get', 'kind'], 'grass'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.3, 18, 0.85],
    },
  };

  /**
   * Corner names only.
   *
   * OSM tags trackside corner names as `place=locality`, which reaches the
   * tiles as `kind_detail: "locality"` — Hatzenbach, Hocheichen, Flugplatz,
   * Antoniusbuche. Villages and hamlets carry `village` / `hamlet` /
   * `isolated_dwelling` instead, so one predicate separates them cleanly.
   */
  const cornerLabels = {
    id: 'corner-labels',
    type: 'symbol',
    source: BASEMAP_SOURCE,
    'source-layer': 'places',
    filter: ['==', ['get', 'kind_detail'], 'locality'],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['NotoSansMedium'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 15, 14],
      'text-max-width': 8,
      'text-padding': 4,
    },
    paint: {
      'text-color': '#E4EAF0',
      'text-halo-color': '#08090B',
      'text-halo-width': 1.6,
    },
  };

  /**
   * Everything beyond 300m of the circuit, painted out.
   *
   * Drawn over the basemap with the corridor punched out as holes. That single
   * fill does the whole job: surrounding terrain, landuse and — the part that
   * would otherwise need point-in-polygon filtering — every place label outside
   * the corridor disappears under it.
   *
   * In 2D this is an exact cut-off. In 3D it drapes onto the terrain rather
   * than slicing it, because MapLibre renders a continuous DEM surface and
   * offers no way to clip the terrain mesh to a polygon.
   */
  const corridorMask = {
    id: 'corridor-mask',
    type: 'fill',
    source: MASK_SOURCE,
    paint: {
      // Matches color.background in ../theme.ts so the masked world reads as
      // the app's own ground rather than as a grey rendering failure.
      'fill-color': '#0B0D10',
      'fill-opacity': 1,
    },
  };

  /**
   * User waypoints — spec §5.1.
   *
   * Above the corridor mask on purpose. A spot the user placed is theirs and
   * must stay visible even if it sits outside the 300m corridor; masking away
   * someone's own pin because it fell a few metres beyond an arbitrary cutoff
   * would look like data loss.
   */
  const spotLayers = [
    {
      id: 'spot-halo',
      type: 'circle',
      source: SPOTS_SOURCE,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 7, 16, 14],
        'circle-color': SPOT_COLOUR,
        'circle-opacity': 0.22,
        'circle-stroke-width': 0,
      },
    },
    {
      id: 'spot-pin',
      type: 'circle',
      source: SPOTS_SOURCE,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 16, 7],
        'circle-color': SPOT_COLOUR,
        'circle-stroke-color': '#0B0D10',
        'circle-stroke-width': 2,
      },
    },
    {
      id: 'spot-label',
      type: 'symbol',
      source: SPOTS_SOURCE,
      // Only below the callout threshold. Above it the HTML callout carries the
      // name, and drawing both prints it twice under every pin.
      maxzoom: 13,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['NotoSansMedium'],
        'text-size': 12,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-max-width': 9,
      },
      paint: {
        'text-color': [
          'case',
          ['==', ['coalesce', ['get', 'hidden'], 0], 1],
          '#7A838E',
          '#CFE0FF',
        ],
        'text-halo-color': '#0B0D10',
        'text-halo-width': 1.6,
      },
    },
  ];

  const style = {
    version: 8,
    glyphs: glyphsUrl,
    sprite: SPRITE_URL,
    sources: {
      [BASEMAP_SOURCE]: {
        type: 'vector',
        url: `pmtiles://${tilesUrl}`,
        attribution: OSM_ATTRIBUTION,
      },
      [CIRCUIT_SOURCE]: { type: 'geojson', data: CIRCUIT_GEOJSON[venue] },
      [MASK_SOURCE]: { type: 'geojson', data: MASK_GEOJSON[venue] },
      [KERBS_SOURCE]: { type: 'geojson', data: KERBS_GEOJSON[venue] },
      [BUILDINGS_SOURCE]: { type: 'geojson', data: BUILDINGS_GEOJSON[venue] },
      [TREES_SOURCE]: { type: 'geojson', data: TREES_GEOJSON[venue] },
      ...(omitSpots ? {} : { [SPOTS_SOURCE]: { type: 'geojson', data: spots } }),
      [TERRAIN_SOURCE]: {
        type: 'raster-dem',
        tiles: [TERRAIN_TILES],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 14,
        attribution: TERRAIN_ATTRIBUTION,
        /**
         * Confine elevation to the venue.
         *
         * The DEM endpoint is global, so without this the terrain mesh keeps
         * going to the horizon and relief stays visible past the corridor mask
         * when tilted. Bounded, everything outside falls to zero elevation and
         * reads as flat void beneath the mask.
         */
        bounds: [
          VENUE_VIEW[venue].bounds[0][0],
          VENUE_VIEW[venue].bounds[0][1],
          VENUE_VIEW[venue].bounds[1][0],
          VENUE_VIEW[venue].bounds[1][1],
        ],
      },
    },
    /**
     * 3D terrain, when asked for.
     *
     * Exaggeration is deliberately mild. The Eifel's real relief is what makes
     * a spot work or not — a corner that looks flat on the map but sits below
     * an embankment — so overstating it would turn a planning tool into a
     * cartoon and make sightline judgements worse, not better.
     */
    ...(terrain3d
      ? { terrain: { source: TERRAIN_SOURCE, exaggeration: 1.2 } }
      : {}),
    layers: [
      ...keep,
      hillshade,
      buildings,
      ...trackLayers,
      // On top of the asphalt, under the trees — a tree at the edge of a corner
      // should occlude the kerb, not the other way round.
      ...kerbLayers,
      trees,
      groundDetail,
      cornerLabels,
      corridorMask,
      // Above the mask: the user's own spots are never masked away.
      ...(omitSpots ? [] : spotLayers),
    ],
  };

  // Must run on the finished document: the basemap layers are merged in above.
  normaliseFontStacks(style.layers as unknown[]);
  return style;
}

/**
 * The circuit centreline as plain coordinate lists.
 *
 * Exposed so spot placement can snap to the verge (see core/logic/track.ts)
 * without the UI reaching into the GeoJSON shape itself.
 */
/**
 * Walkable ways as plain coordinate lists, for the router.
 *
 * Same shape and axis order as `trackLinesFor` — [lon, lat] — so both feed
 * `buildWalkNetwork` without a transform that could silently swap them.
 */
/**
 * Walkable ways with their OSM classification.
 *
 * The router weights a metre of secondary road far worse than a metre of
 * footpath (see core/logic/route.ts), which it can only do if the class comes
 * along with the geometry. `pathLinesFor` remains for callers that only need
 * the shapes.
 */
export function pathWaysFor(
  venue: VenueKey,
): { coordinates: [number, number][]; highway?: string }[] {
  const fc = PATHS_GEOJSON[venue] as {
    features?: {
      properties?: { highway?: string };
      geometry?: { type?: string; coordinates?: unknown };
    }[];
  };
  const out: { coordinates: [number, number][]; highway?: string }[] = [];
  for (const feat of fc.features ?? []) {
    if (feat.geometry?.type !== 'LineString') continue;
    out.push({
      coordinates: feat.geometry.coordinates as [number, number][],
      highway: feat.properties?.highway,
    });
  }
  return out;
}

export function pathLinesFor(
  venue: VenueKey,
): readonly (readonly (readonly [number, number])[])[] {
  const fc = PATHS_GEOJSON[venue] as {
    features?: { geometry?: { type?: string; coordinates?: unknown } }[];
  };
  const out: (readonly [number, number])[][] = [];
  for (const feat of fc.features ?? []) {
    if (feat.geometry?.type !== 'LineString') continue;
    out.push(feat.geometry.coordinates as [number, number][]);
  }
  return out;
}

export function trackLinesFor(
  venue: VenueKey,
): readonly (readonly (readonly [number, number])[])[] {
  const fc = CIRCUIT_GEOJSON[venue] as {
    features?: { geometry?: { type?: string; coordinates?: unknown } }[];
  };
  const out: (readonly [number, number])[][] = [];
  for (const feat of fc.features ?? []) {
    if (feat.geometry?.type !== 'LineString') continue;
    out.push(feat.geometry.coordinates as [number, number][]);
  }
  return out;
}

/** Where each venue's archive lives, relative to the web site root. */
export const WEB_TILES = {
  nordschleife: '/tiles/nordschleife.pmtiles',
  'spa-francorchamps': '/tiles/spa-francorchamps.pmtiles',
  zandvoort: '/tiles/zandvoort.pmtiles',
  'le-mans': '/tiles/le-mans.pmtiles',
  zolder: '/tiles/zolder.pmtiles',
  suzuka: '/tiles/suzuka.pmtiles',
  fuji: '/tiles/fuji.pmtiles',
} as const;

export type VenueKey = keyof typeof WEB_TILES;

export interface VenueView {
  label: string;
  /** Short label for the dropdown trigger. */
  country: string;
  centre: [number, number];
  zoom: number;
  /** Camera limit, [[west, south], [east, north]] — the tile extract area. */
  bounds: [[number, number], [number, number]];
  /**
   * Extent of the circuit itself, from the extracted OSM geometry.
   *
   * The opening view is fitted to this rather than to a hardcoded zoom, so the
   * whole lap is on screen on any display. A fixed zoom that frames the
   * Nordschleife on a desktop clips Hohe Acht off the top of a phone.
   */
  circuitBounds: [[number, number], [number, number]];
  /** Zoomed all the way out, the whole circuit plus a margin is visible. */
  minZoom: number;
  maxZoom: number;
}

/**
 * Initial camera and camera limits per venue.
 *
 * These are map-centring hints only — deliberately *not* the `Circuit` preset
 * records described in spec §4.1. Those carry timezone, layout variants and
 * bounding box, are seeded from JSON per §7, and are reserved for human
 * sourcing under §0.2. Nothing here should be promoted into that.
 *
 * ── Why the camera is bounded ──────────────────────────────────────────────
 * `bounds` matches the bbox each archive was extracted with, so the constraint
 * is honest: outside that rectangle the tiles do not exist. It must also be
 * comfortably wider than the circuit, or the camera cannot zoom out far enough
 * to frame the whole lap and the north end gets clipped.
 */
export const VENUE_VIEW: Record<VenueKey, VenueView> = {
  nordschleife: {
    label: 'Nürburgring',
    country: 'DE',
    centre: [6.9628, 50.3523],
    zoom: 12.2,
    bounds: [
      [6.88, 50.3],
      [7.04, 50.41],
    ],
    // Measured from the extracted geometry: 98 raceway ways, 1764 points.
    circuitBounds: [
      [6.92, 50.3236],
      [7.0056, 50.3809],
    ],
    minZoom: 11.5,
    maxZoom: 18,
  },
  'spa-francorchamps': {
    label: 'Spa-Francorchamps',
    country: 'BE',
    centre: [5.9686, 50.437],
    zoom: 13.6,
    bounds: [
      [5.92, 50.41],
      [6.0, 50.47],
    ],
    // Measured from the extracted geometry: 33 raceway ways, 487 points.
    circuitBounds: [
      [5.9596, 50.4277],
      [5.9776, 50.4463],
    ],
    // Higher floor than the Nürburgring because Spa is a far smaller footprint
    // — the same minZoom would leave it a speck in the middle of the screen.
    minZoom: 12.8,
    maxZoom: 18,
  },
  zandvoort: {
    label: 'Zandvoort',
    country: 'NL',
    centre: [4.5459, 52.3881],
    zoom: 14.5,
    bounds: [
      [4.51, 52.37],
      [4.575, 52.405],
    ],
    // Measured from the extracted geometry: 28 raceway ways, 743 points.
    circuitBounds: [
      [4.5387, 52.3844],
      [4.5531, 52.3918],
    ],
    // Smallest of the three at 4.259km, so the tightest floor.
    minZoom: 13.5,
    maxZoom: 18,
  },
  'le-mans': {
    /**
     * ── This is the Bugatti circuit, not the full 24h layout. ──────────────
     *
     * The Circuit de la Sarthe is 13.626km, but roughly two thirds of it — the
     * Mulsanne straight, Indianapolis, Arnage — is the public D338, which OSM
     * therefore does not tag `highway=raceway`. Querying raceway returns only
     * the permanent circuit, and there is no route relation for the full lap
     * either (checked: the 27 relations matching "Sarthe"/"Le Mans" here are
     * trains, buses and cycle routes).
     *
     * Measured extent bears it out: 2.60 x 3.89km, whose diagonal is shorter
     * than the Mulsanne straight alone.
     *
     * Completing it means identifying the public-road ways by hand, which spec
     * §0.2 reserves for human sourcing — inventing the missing two thirds is
     * exactly what that rule forbids. Labelled honestly until then.
     */
    label: 'Le Mans (WIP)',
    country: 'FR',
    centre: [0.2184, 47.9471],
    zoom: 13.4,
    bounds: [
      [0.15, 47.88],
      [0.31, 47.99],
    ],
    // Re-measured after the cluster filter: 1.64 x 3.27km of connected surface.
    circuitBounds: [
      [0.2074, 47.9323],
      [0.2294, 47.9619],
    ],
    minZoom: 12.5,
    maxZoom: 18,
  },
  zolder: {
    label: 'Zolder',
    country: 'BE',
    centre: [5.2576, 50.9904],
    zoom: 14.2,
    bounds: [
      [5.235, 50.975],
      [5.275, 51.005],
    ],
    circuitBounds: [
      [5.2495, 50.9845],
      [5.2657, 50.9963],
    ],
    minZoom: 13.4,
    maxZoom: 18,
  },
  suzuka: {
    label: 'Suzuka',
    country: 'JP',
    centre: [136.5327, 34.8438],
    zoom: 14.2,
    bounds: [
      [136.515, 34.828],
      [136.56, 34.865],
    ],
    // Measured from the extracted geometry: 68 raceway ways, 1337 points.
    circuitBounds: [
      [136.5219, 34.839],
      [136.5434, 34.8485],
    ],
    minZoom: 13.2,
    maxZoom: 18,
  },
  fuji: {
    label: 'Fuji Speedway',
    country: 'JP',
    centre: [138.9294, 35.3712],
    zoom: 14.2,
    bounds: [
      [138.905, 35.355],
      [138.95, 35.39],
    ],
    // Measured from the extracted geometry: 16 raceway ways, 623 points.
    circuitBounds: [
      [138.92, 35.3647],
      [138.9387, 35.3777],
    ],
    minZoom: 13.2,
    maxZoom: 18,
  },
};

/**
 * Circuit measurements, for the on-map readout.
 *
 * `surfaceMetres` is every extracted way summed — pit lanes and layout variants
 * included — so it is an upper bound rather than lap distance. Comparing it to
 * the published lap length is what revealed that Le Mans was missing its
 * public-road sections.
 */
export interface CircuitMetrics {
  surfaceMetres: number;
  widthMetres: number;
  heightMetres: number;
}

export function circuitMetricsFor(venue: VenueKey): CircuitMetrics | null {
  const doc = CIRCUIT_GEOJSON[venue] as { metrics?: CircuitMetrics };
  return doc.metrics ?? null;
}
