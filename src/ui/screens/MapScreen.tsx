/**
 * Map — native implementation (@maplibre/maplibre-react-native).
 *
 * The real target. Metro picks `MapScreen.web.tsx` for web and this file for
 * iOS/Android; both build their basemap from the same `../map/style` module and
 * read the same PMTiles archive, so the two cannot drift apart visually.
 *
 * ── Where this necessarily differs from web ────────────────────────────────
 * The web screen positions HTML callouts absolutely over the canvas and reads
 * taps with `queryRenderedFeatures`. Neither exists here: there is no DOM to
 * position, and MapLibre RN exposes taps as component props rather than map
 * events. So spots are a `<GeoJSONSource>` with `<Layer>` children, and each
 * callout is a `<ViewAnnotation>` — a real React Native view pinned to a
 * coordinate, which the native renderer keeps anchored as the camera moves.
 *
 * ── Requires a development build ───────────────────────────────────────────
 * MapLibre RN ships native code, so this screen cannot run in Expo Go. See
 * EAS.md.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Asset } from 'expo-asset';
import { prepareGlyphs } from '../../storage-local/glyphs';
import { localTerrainTemplate } from '../../storage-local/terrainCache';
import TerrainSpike from './TerrainSpike';
import {
  getMapHillshadeEnabled,
  getMapRainEnabled,
  getMapSceneryDistance,
  getMapSceneryEnabled,
  getMapShadowsEnabled,
  getMapStarsEnabled,
} from '../../storage-local/preferences';
import { sceneryRadiusDegrees } from '../../core/logic/graphicsPreset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  type GeoJSONSourceRef,
  Images,
  Layer,
  Map,
  ViewAnnotation,
} from '@maplibre/maplibre-react-native';

import { safeFeatureCollection } from '../../core/logic/geojsonSafety';
import {
  MENU_CLEARANCE,
  MENU_TOP,
  radius,
  space,
  type,
  useTheme,
  weight,
  type Theme,
} from '../theme';
import CircuitRuler from '../map/CircuitRuler';
import SunDial from '../map/SunDial';
import { useVenueConditions } from '../state/useVenueConditions';
import SkyControl from '../map/SkyControl';
import { useMapClock } from '../state/useMapClock';
import { useHeading } from '../state/useHeading';
import type { LatLon } from '../../core/domain/common';
import {
  REMOTE_GLYPHS_URL,
  TERRAIN_TILES,
  SCENERY_SPRITES,
  SPOTS_SOURCE,
  VENUE_VIEW,
  type VenueKey,
  buildMapStyle,
} from '../map/style';

/**
 * Bundled tile archives.
 *
 * `require` at module scope so Metro sees a static path and includes the file
 * in the bundle — a computed path would resolve at runtime and silently ship
 * no tiles. `metro.config.js` adds `pmtiles` to `assetExts`; without that the
 * require fails outright.
 */
/**
 * The bundled basemap archive per venue.
 *
 * Exported so the terrain spike can reach the same file the map uses — see
 * TerrainSpike.tsx. Nothing else should import it; the map screen owns how
 * these are unpacked.
 */
export const TILE_ASSETS: Record<VenueKey, number> = {
  nordschleife: require('../../../assets/tiles/nordschleife.pmtiles'),
  'le-mans': require('../../../assets/tiles/le-mans.pmtiles'),
  zolder: require('../../../assets/tiles/zolder.pmtiles'),
  'spa-francorchamps': require('../../../assets/tiles/spa-francorchamps.pmtiles'),
  zandvoort: require('../../../assets/tiles/zandvoort.pmtiles'),
  suzuka: require('../../../assets/tiles/suzuka.pmtiles'),
  fuji: require('../../../assets/tiles/fuji.pmtiles'),
};

/** Matches the web screen — below this, callouts would overlap unreadably. */
const CALLOUT_MIN_ZOOM = 13;
const MAX_CALLOUTS = 40;

/**
 * `SunDial` shares `CircuitRuler`'s corner (right edge, below the menu), so it
 * stacks underneath rather than overlapping it. `CircuitRuler` has no fixed
 * height of its own — it grows with the venue's metrics text — but in
 * practice it settles around this, the same approximation
 * `MapScreen.web.tsx` already uses when keeping callouts clear of it.
 */
const CIRCUIT_RULER_CLEARANCE = 172;

/**
 * `SkyControl` is bottom-anchored, the same corner the shell's own "Spots /
 * + Spot" row uses (`App.tsx`'s `bottomBar`: `bottom: insets.bottom +
 * space.md`, 52px tall) — found by putting the two on screen together and
 * watching that row paint over `SkyControl`'s date row, since `App.tsx`
 * renders it after `MapScreen` and both shared the same anchor. `MapScreen`
 * has no visibility into whether that row is currently showing (it depends
 * on `where`/`sheetOpen`/`navStop`, all owned by `App.tsx`), so this clears
 * its full height unconditionally rather than reading through it — the same
 * approximation `CIRCUIT_RULER_CLEARANCE` makes for its neighbour.
 */
const BOTTOM_BAR_CLEARANCE = space.md + 52 + space.md;

interface SpotFeature {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: [number, number] };
}

export default function MapScreen({
  venue = 'nordschleife' as VenueKey,
  spots,
  mediaUris = {},
  mediaFocal = {},
  onMapTap,
  onSpotTap,
  onOpenTerrainView,
  placing = false,
  route,
  here,
  heading = null,
  controlsTop = 0,
  position,
}: {
  venue?: VenueKey;
  spots?: unknown;
  mediaUris?: Record<string, string>;
  /** Which part of each photo to keep, by storage key. */
  mediaFocal?: Record<string, { x: number; y: number }>;
  onMapTap?: (lngLat: { latitude: number; longitude: number }) => void;
  onSpotTap?: (id: string) => void;
  /** Open the terrain map. This is what the 3D button does now. */
  onOpenTerrainView?: () => void;
  placing?: boolean;
  /**
   * The navigation route, as a FeatureCollection of legs.
   *
   * Each feature carries `kind`: 'network' for extracted ways, 'direct' for a
   * straight line across ground we have no path for.
   */
  route?: unknown;
  /** Live position, whenever there is a fix. */
  here?: { latitude: number; longitude: number } | null;
  /** Compass bearing in degrees from north, or null when unknown. */
  heading?: number | null;
  /**
   * Extra space above the map's own controls.
   *
   * The shell stacks its navigation down the left edge — menu trigger, then the
   * back-to-event button when an event is open — and the mode toggle has to
   * start below whatever is there. The shell owns that stack, so it passes the
   * height rather than the map guessing at it.
   */
  controlsTop?: number;
  /** The circuit's own coordinates — what `SunDial`/`SkyControl` compute the sun against. */
  position: LatLon;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  /**
   * One clock, shared by the sun and the weather.
   *
   * `useMapClock()` is called exactly once, here — `SkyControl` used to call
   * it itself, which would have created a second, independent clock the
   * moment `SunDial` needed one too. See `SkyControl`'s file header and the
   * task file's note on the shared-clock desync bug.
   */
  const clock = useMapClock();

  /*
   * The sky's own conditions, for the 3D view.
   *
   * Venue-scoped rather than event-scoped: the map is most often open with no
   * event at all, and useWeather reports nothing in that case. Fails silently
   * offline — see the hook.
   */
  const conditions = useVenueConditions(
    { latitude: VENUE_VIEW[venue].centre[1], longitude: VENUE_VIEW[venue].centre[0] },
    VENUE_VIEW[venue].timezone,
    clock.now,
  );
  /**
   * C2: which way the phone is pointing, for `SunDial`'s rotation.
   *
   * Enabled unconditionally rather than tracking screen focus explicitly —
   * `MapScreen` itself only mounts while `App.tsx`'s `where` is `'map'` or
   * `'list'` (see that file), so the hook's own subscription already stops
   * the moment this component unmounts, which is the same "stop watching
   * when the map is not on screen" the task file (C1) asks for. True heading
   * only (never `usePosition`'s magnetic fallback below) — this value gets
   * subtracted from an astronomically-computed azimuth in `SunDial`, and a
   * magnetic reading would put the sun mark a few degrees off in a way
   * nobody could explain by looking at it.
   */
  const { heading: dialHeading } = useHeading(true);
  const [tilesUri, setTilesUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(VENUE_VIEW[venue].zoom);

  /*
   * The live zoom, for the camera effect.
   *
   * Through a ref so that effect depends on `is3D` alone. Depending on `zoom`
   * would re-run it on every pinch, which would fight the user for control of
   * the pitch on a gesture that has nothing to do with it.
   */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  /**
   * The terrain map is showing instead of the native one.
   *
   * ── Why it swaps the map rather than covering it ──────────────────────
   * Everything that makes this screen useful — the sky strip, the sun dial,
   * the circuit ruler, the menu, Spots, + Spot — is a sibling of the map,
   * not a child of it. Replacing only the map leaves all of it in place and
   * working, so the terrain view inherits the whole app rather than being a
   * bare canvas with a Back button.
   *
   * It also makes the 2D/3D control a real mode switch again.
   */
  const [is3D, setIs3D] = useState(false);

  const [terrain3d, setTerrain3d] = useState(false);

  /**
   * The spots inside a tapped stack, and which of them is lit.
   *
   * Mirrors the terrain map deliberately: the same gesture should mean the
   * same thing on both, and a stack that behaved differently depending on
   * which map you were looking at would be worse than one that did not
   * stack at all.
   */
  const [stack, setStack] = useState<{ id: string; name: string }[] | null>(null);
  const [lit, setLit] = useState<string | null>(null);

  // Needed for getClusterLeaves, which is a method on the source itself.
  const spotsSourceRef = useRef<GeoJSONSourceRef>(null);
  /**
   * Performance toggle — TASKS-profile.md D1. Defaults to `true` (matching
   * `buildMapStyle`'s own default) so the map looks unchanged before this
   * loads or for anyone who never visits the new setting. This screen is
   * conditionally rendered rather than kept mounted behind a navigator (see
   * `App.tsx`), so remounting on every visit to the map is enough to pick up
   * a change made on the profile screen — no subscription needed.
   */
  const [sceneryEnabled, setSceneryEnabled] = useState(true);
  /**
   * The graphics switches, all settled before the style is built.
   *
   * Every one of these is a style input, so the same rule applies as for
   * glyphs: settle first, build once. A switch arriving late would rebuild the
   * style under live sources, which is the crash in commit 7c1fbd8.
   */
  const [hillshadeEnabled, setHillshadeEnabled] = useState(true);
  const [starsEnabled, setStarsEnabled] = useState(true);
  const [shadowsEnabled, setShadowsEnabled] = useState(true);
  const [sceneryRadius, setSceneryRadius] = useState(1);
  const [scenerySettled, setScenerySettled] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        setSceneryEnabled(await getMapSceneryEnabled());
        setHillshadeEnabled(await getMapHillshadeEnabled());
        setStarsEnabled(await getMapStarsEnabled());
        setShadowsEnabled(await getMapShadowsEnabled());
        setSceneryRadius(sceneryRadiusDegrees(await getMapSceneryDistance()));
      } finally {
        setScenerySettled(true);
      }
    })();
  }, []);

  /** Same reasoning as the scenery flag above: read on mount, no subscription. */
  const [rainEnabled, setRainEnabled] = useState(true);
  useEffect(() => {
    void (async () => setRainEnabled(await getMapRainEnabled()))();
  }, []);

  /**
   * When the terrain map is allowed to start building itself.
   *
   * It is still built before it is asked for — that is the whole point, and
   * pressing 3D should not be a wait. But building it *at the same instant*
   * as this screen mounts means a second MapLibre instance, a second WebGL
   * context and a multi-megabyte archive all being allocated while the flat
   * map is doing exactly the same thing. That spike lands precisely when you
   * arrive here from somewhere else — which is the moment "navigate" and
   * "start event" both reported as a crash.
   *
   * So the flat map gets the device to itself until it has settled, and the
   * terrain map starts a couple of seconds later. Pressing 3D inside that
   * window mounts it immediately rather than making you wait out the timer:
   * the delay is there to stagger the work, not to withhold it.
   */
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setWarm(true), 2500);
    return () => clearTimeout(id);
  }, []);
  /**
   * Local glyph template, once the ranges are on disk.
   *
   * Null until ready, and null forever if the copy fails — the style then keeps
   * the remote URL, so labels degrade to needing signal rather than vanishing.
   */
  /**
   * A `file://` template for this venue's downloaded elevation tiles, or null.
   *
   * Re-resolved per venue rather than once, because a download that finishes
   * while the app is open should take effect on the next style rebuild — and
   * toggling 3D rebuilds the style anyway, so the next tilt picks it up without
   * any explicit invalidation.
   */
  const terrainTiles = useMemo(
    () => localTerrainTemplate(venue) ?? TERRAIN_TILES,
    [venue],
  );

  const [glyphsUrl, setGlyphsUrl] = useState<string | null>(null);
  /**
   * Whether the glyph question has been answered, either way.
   *
   * ── Why the style must be settled before the map exists ──────────────────
   * `glyphsUrl` is a dependency of `mapStyle`, and it always changes once:
   * null while the ranges are being copied, then a URL. That rebuilt the style
   * a moment *after* the map had mounted, and a style swap makes MapLibre tear
   * down and recreate every source underneath the React components that own
   * them. Those components survive the swap and keep pushing props, so the
   * next `setShape:` lands on a source that is no longer in the style —
   * MapLibre throws from C++, nothing catches it, and the process aborts.
   *
   * That is the crash reported as "navigation crashes the app": arriving at
   * the map from another screen mounts it fresh, so the swap and the first
   * route and position updates all land in the same instant.
   *
   * Separate from the URL because null is a real answer — the copy can fail,
   * and the style then keeps the remote URL. Waiting on `glyphsUrl !== null`
   * would hang forever in exactly that case.
   */
  const [glyphsSettled, setGlyphsSettled] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        setGlyphsUrl(await prepareGlyphs());
      } finally {
        setGlyphsSettled(true);
      }
    })();
  }, []);
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);

  /**
   * Square the camera up *after* the style change, not during it.
   *
   * ── Why this is an effect and not part of the button ──────────────────
   * Toggling 3D rebuilds the whole style document — `is3D` is a dependency of
   * `mapStyle` below, and that document carries up to 14k tree points. Calling
   * the camera from the button's own handler ran it *before* that rebuild
   * reached MapLibre:
   *
   *   1. setIs3D schedules a render
   *   2. the camera animation starts, 700ms
   *   3. the render commits and MapLibre is handed a brand-new style
   *   4. loading it discards the animation, part-way
   *
   * Which is exactly the reported symptom: leaving 3D left the map still
   * tilted. Entering looked fine only because an interrupted tilt is still a
   * tilt — the failure was always there, just invisible in that direction.
   *
   * An effect runs after commit, so the style is already MapLibre's problem by
   * the time the camera is asked to move.
   *
   * ── And the reset does not animate ────────────────────────────────────
   * `duration: 0` going back to 2D. Partly belt and braces — an instant change
   * has no in-flight animation left to interrupt — and partly because it is
   * the better behaviour anyway: this is a mode switch, not a journey, and
   * flattening should feel like a switch being thrown.
   */
  const firstRender = useRef(true);

  useEffect(() => {
    // Skip the mount. The camera starts from `initialViewState`'s bounds, and
    // overriding that on the first frame would throw away the framing that
    // puts the whole circuit on screen.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    cameraRef.current?.zoomTo(zoomRef.current, {
      // 60, not MapLibre's 85: past roughly 70 the camera ends up looking
      // through a hillside rather than over it.
      pitch: is3D ? 60 : 0,
      // Rotation is only reachable by gesture while tilted, so leaving 3D has
      // to put it straight — there is no other control that would. Entering
      // says nothing about bearing, deliberately: the key is omitted rather
      // than sent as undefined, which is a property that still crosses the
      // bridge.
      ...(is3D ? {} : { bearing: 0 }),
      duration: is3D ? 900 : 0,
    });
  }, [is3D]);

  /**
   * Resolve the bundled archive to a local file URI.
   *
   * On Android a bundled asset is not a plain filesystem path until it has been
   * unpacked, so `downloadAsync()` is required even though nothing is fetched
   * over the network — it copies out of the APK into the cache directory.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const asset = Asset.fromModule(TILE_ASSETS[venue]);
        await asset.downloadAsync();
        if (cancelled) return;

        const uri = asset.localUri ?? asset.uri;
        if (!uri) {
          setError('Tile archive resolved to no local URI.');
          return;
        }
        setTilesUri(uri);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [venue]);

  const view = VENUE_VIEW[venue];
  const features = useMemo(
    () => (spots as { features?: SpotFeature[] } | undefined)?.features ?? [],
    [spots],
  );

  /*
    Sieved before it reaches MapLibre.

    A coordinate that is NaN or missing is not a rendering glitch here — the
    parser is C++, it throws, nothing on the JS side can catch it, and the
    process takes SIGABRT with no stack to read. One unusable row is enough.
    See core/logic/geojsonSafety.ts.
  */
  const shape = useMemo(
    () =>
      safeFeatureCollection(
        spots ?? { type: 'FeatureCollection', features: [] },
        (reason, feature) =>
          console.warn('[map] dropped a spot before drawing:', reason, feature),
      ),
    [spots],
  );

  /**
   * What a source shows when it has nothing to show.
   *
   * Constant, so React sees the same object every render and the source is
   * not re-set on each pass.
   */
  const EMPTY = useMemo(
    () => ({ type: 'FeatureCollection' as const, features: [] }),
    [],
  );

  /** The route, sieved for the same reason and with the same consequence. */
  const safeRoute = useMemo(
    () =>
      route == null
        ? null
        : safeFeatureCollection(route, (reason, feature) =>
            console.warn('[map] dropped a route leg:', reason, feature),
          ),
    [route],
  );

  /*
    A fix is only drawable if it is actually a pair of numbers.

    CoreLocation is not supposed to hand back a non-finite coordinate, and the
    cost of it doing so once is the whole app rather than a missing dot.
  */
  const drawableHere =
    here && Number.isFinite(here.longitude) && Number.isFinite(here.latitude)
      ? here
      : null;

  /**
   * Style is built once per venue and per tile URI.
   *
   * `omitSpots` keeps the spot source out of the style document so editing a
   * waypoint does not hand MapLibre a whole new style — the style carries 14k
   * tree points, and reloading it on every rename would be brutal on a phone.
   */
  const mapStyle = useMemo(
    () =>
      tilesUri === null
        ? null
        : (buildMapStyle(
            `file://${tilesUri.replace(/^file:\/\//, '')}`,
            venue,
            undefined,
            true,
            is3D,
            glyphsUrl ?? REMOTE_GLYPHS_URL,
            sceneryEnabled,
            hillshadeEnabled,
            sceneryRadius,
            terrainTiles,
          ) as never),
    [
      tilesUri,
      venue,
      is3D,
      glyphsUrl,
      sceneryEnabled,
      terrainTiles,
      hillshadeEnabled,
      sceneryRadius,
    ],
  );

  if (error !== null) {
    return (
      <View style={styles.centre}>
        <Text style={styles.errorTitle}>Map failed to load</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Text style={styles.errorHint}>
          Check that `npm run tiles` has been run and the app was rebuilt —
          adding an asset requires a new native build, not just a reload.
        </Text>
      </View>
    );
  }

  /*
    Nothing is drawn until every input to the style is known.

    The wait is a fraction of a second and it buys the one guarantee that
    matters: the style is built once and never replaced while sources are
    live. See the note on glyphsSettled.
  */
  if (tilesUri === null || mapStyle === null || !glyphsSettled || !scenerySettled) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={color.accent} />
        <Text style={styles.loading}>Opening offline basemap…</Text>
      </View>
    );
  }

  const showCallouts = zoom >= CALLOUT_MIN_ZOOM;

  return (
    <View style={styles.root}>
      {/*
        The flat map, mounted only while it is the one in use.
      */}
      {!terrain3d && (
      <Map
        /*
          Keyed on what legitimately changes the style.

          Belt and braces for the same failure: if the style is ever replaced
          under a live map again, this remounts the sources with it rather than
          leaving them pointing at a style that has gone. Changing venue or
          dimension already re-frames everything, so a remount costs nothing
          anybody would notice.
        */
        key={`${venue}:${is3D ? '3d' : '2d'}`}
        style={styles.map}
        mapStyle={mapStyle}
        /*
         * MapLibre's own attribution control satisfies §8 — but only where it
         * can actually be seen. Its default bottom-right corner is where the
         * "+ Spot" button lives, and a covered attribution is not attribution:
         * ODbL asks for it to be visible, not merely present in the tree.
         *
         * Tucked directly under the site ruler's bottom corner, on the right —
         * the one part of the screen nothing else claims. 140dp is just past
         * the ruler's own extent (safe-area top, 12dp gap, then the card), so
         * it reads as attached to the ruler rather than floating.
         */
        attribution
        attributionPosition={{ top: 140, right: 8 }}
        logo={false}
        /*
         * Rotation and pitch only exist in 3D.
         *
         * In 2D a gloved hand knocks the map into a tilted state with no
         * obvious way back, which is why these stay off until 3D is asked for
         * — and why leaving 3D snaps the camera flat rather than leaving you
         * somewhere you cannot undo.
         */
        touchRotate={is3D}
        touchPitch={is3D}
        onPress={(e) => {
          if (!placing) return;
          /*
           * `lngLat`, not `coordinates`.
           *
           * This read `e.nativeEvent.coordinates` — a field MapLibre RN has
           * never emitted — so it was always undefined and every tap returned
           * early. Placing mode looked live and silently did nothing.
           *
           * It typechecked because the event was cast to an invented shape,
           * which is exactly what a cast does: replaces what the library says
           * with what the author assumed. The library's own `PressEvent` is
           * `{ lngLat: [lng, lat], point }`, so it is used unmodified here.
           */
          const [longitude, latitude] = e.nativeEvent.lngLat;
          // Snapping to the verge happens in the shell, which owns the circuit
          // geometry — the same path the web screen takes.
          onMapTap?.({ longitude, latitude });
        }}
        // Fires once the camera settles. Zoom gates the callouts, and reading
        // it on every intermediate frame would re-render the whole set mid-pan.
        /*
         * Frame the circuit once the map actually has a size.
         *
         * `initialViewState` is applied at mount, when the view is often still
         * zero-sized, so the bounds fit against nothing and the circuit ends up
         * off-centre and clipped — which is exactly how it first rendered on a
         * 1280x2856 phone. Re-fitting on load costs one camera move and makes
         * the framing correct on any aspect ratio.
         */
        onDidFinishLoadingMap={() => {
          cameraRef.current?.fitBounds(
            [
              view.circuitBounds[0][0],
              view.circuitBounds[0][1],
              view.circuitBounds[1][0],
              view.circuitBounds[1][1],
            ],
            {
              // Asymmetric on purpose: the menu sits over the top and the two
              // controls over the bottom, so an evenly padded fit puts the
              // circuit's ends underneath them.
              padding: { top: 96, right: 24, bottom: 140, left: 24 },
              duration: 0,
            },
          );
        }}
        onRegionDidChange={(e) => {
          const z = e.nativeEvent?.zoom;
          if (typeof z === 'number') setZoom(z);
        }}
      >
        {/*
          The scatter's icons.

          A symbol layer whose `icon-image` is not registered renders nothing
          and reports nothing — which is exactly how the trees went missing on
          device while the same style drew them on web.
        */}
        <Images images={SCENERY_SPRITES} />

        <Camera
          ref={cameraRef}
          initialViewState={{
            bounds: [
              view.circuitBounds[0][0],
              view.circuitBounds[0][1],
              view.circuitBounds[1][0],
              view.circuitBounds[1][1],
            ],
            padding: { top: 28, right: 28, bottom: 28, left: 28 },
          }}
          minZoom={view.minZoom}
          maxZoom={view.maxZoom}
          maxBounds={[
            view.bounds[0][0],
            view.bounds[0][1],
            view.bounds[1][0],
            view.bounds[1][1],
          ]}
        />

        {/*
          Spots as a component-owned source, so an edit re-renders only this.
          Tapping the pin layer reports the feature, which is how a waypoint is
          opened — there is no queryRenderedFeatures here.
        */}
        {/*
          The three sources below are siblings of the same type, and two of
          them are conditional — so all three carry a `key` for the same
          reason the nav-here layers do. Without one, a route appearing while
          the position marker is already on screen makes React reuse the
          marker's fiber for the route, and MapLibre throws
          "\`id\` cannot be changed" the moment the ids disagree.

          That path is reached by starting navigation to a spot, so it is not
          an edge case.
        */}
        <GeoJSONSource
          key="spots"
          ref={spotsSourceRef}
          id={SPOTS_SOURCE}
          data={shape as never}
          /*
            Overlapping spots stack, as they do on the terrain map.

            Three angles on one corner is normal, and drawn flat they hide each
            other — the pin you tap is whichever happened to be drawn last.
            40px is roughly a fingertip: "these overlap" should mean what a
            thumb cannot separate, not a distance on the ground.
          */
          cluster
          clusterRadius={40}
          clusterMaxZoom={17}
          onPress={(e) => {
            // Same mistake as the map tap: features arrive on `nativeEvent`,
            // not on the event object, so tapping a pin never opened it.
            const f = e.nativeEvent.features?.[0] as SpotFeature | undefined;

            /*
              A stack asks which one, rather than opening whichever was on top.

              getClusterLeaves gives the spots themselves, so the list names
              them instead of counting them. Picking one lights it; opening it
              is a second tap on the pin — the same two steps the terrain map
              uses, because they answer two different questions.
            */
            const clusterId = (f?.properties as { cluster_id?: number } | undefined)
              ?.cluster_id;
            if (typeof clusterId === 'number') {
              void (async () => {
                try {
                  const leaves = await spotsSourceRef.current?.getClusterLeaves(
                    clusterId,
                    // Past this a list stops being readable and zooming really
                    // is the better answer.
                    25,
                    0,
                  );
                  setStack(
                    (leaves ?? []).map((l) => {
                      const p = (l.properties ?? {}) as { id?: string; name?: string };
                      return {
                        id: String(p.id ?? ''),
                        name: String(p.name ?? 'Unnamed spot'),
                      };
                    }),
                  );
                  setLit(null);
                } catch {
                  // A stack we cannot enumerate is better left alone than
                  // reported as empty.
                }
              })();
              return;
            }

            const id = f?.properties?.id;
            if (typeof id === 'string') {
              setStack(null);
              setLit(null);
              onSpotTap?.(id);
            }
          }}
        >
          <Layer
            key="spot-cluster"
            id="spot-cluster"
            type="circle"
            filter={['has', 'point_count'] as never}
            paint={{
              'circle-radius': ['step', ['get', 'point_count'], 14, 5, 18, 10, 22] as never,
              'circle-color': color.accent,
              'circle-opacity': 0.85,
              'circle-stroke-color': color.background,
              'circle-stroke-width': 2,
            }}
          />
          <Layer
            key="spot-cluster-count"
            id="spot-cluster-count"
            type="symbol"
            filter={['has', 'point_count'] as never}
            layout={{
              'text-field': ['get', 'point_count_abbreviated'] as never,
              'text-size': 12,
              'text-allow-overlap': true,
            }}
            paint={{ 'text-color': color.background }}
          />

          <Layer
            key="spot-halo"
            id="spot-halo"
            type="circle"
            filter={['!', ['has', 'point_count']] as never}
            paint={{
              'circle-radius': 12,
              'circle-color': color.accent,
              /*
                Dimmed when something else in the stack is picked.

                The others fade rather than disappearing: a spot that vanished
                would be a claim it is not there, and dimming says "these too,
                just not the one you asked about".
              */
              'circle-opacity': (lit === null
                ? 0.22
                : ['case', ['==', ['get', 'id'], lit], 0.35, 0.06]) as never,
            }}
          />
          <Layer
            key="spot-pin"
            id="spot-pin"
            type="circle"
            filter={['!', ['has', 'point_count']] as never}
            paint={{
              'circle-radius': (lit === null
                ? 6
                : ['case', ['==', ['get', 'id'], lit], 9, 5]) as never,
              'circle-color': color.accent,
              'circle-opacity': (lit === null
                ? 1
                : ['case', ['==', ['get', 'id'], lit], 1, 0.25]) as never,
              // A light ring makes the picked one findable among pins that are
              // all the same colour by design.
              'circle-stroke-color': (lit === null
                ? color.background
                : ['case', ['==', ['get', 'id'], lit], color.text, color.background]) as never,
              'circle-stroke-width': 2,
            }}
          />
        </GeoJSONSource>

        {/*
          The route, drawn above the spots so the line reads over the pins it
          connects. Network legs solid, direct legs dashed: a dashed line means
          "no path here, this is a bearing", and drawing it like a footpath
          would claim knowledge the data does not have.
        */}
        {/*
          Always mounted, empty when there is no route.

          These used to appear and disappear with the navigation state, which
          means a GeoJSONSource being created and destroyed inside a mounting
          transaction — the same situation that produced MapLibre's
          "`id` cannot be changed" throw documented above, and the same one
          the SIGABRT in setShape: comes out of. A source that is always there
          and sometimes empty cannot be caught mid-mount, and an empty
          FeatureCollection draws exactly nothing.
        */}
                  <GeoJSONSource
            key="nav-route"
            id="nav-route"
            data={(safeRoute ?? EMPTY) as never}
          >
            <Layer
              id="nav-route-network"
              type="line"
              filter={['==', ['get', 'kind'], 'network'] as never}
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
              paint={{
                'line-color': color.accent,
                'line-width': 5,
                'line-opacity': 0.9,
              }}
            />
            <Layer
              id="nav-route-direct"
              type="line"
              filter={['==', ['get', 'kind'], 'direct'] as never}
              layout={{
                'line-cap': 'round',
              }}
              paint={{
                'line-color': color.accent,
                'line-width': 4,
                'line-opacity': 0.8,
                'line-dasharray': [1.5, 1.5],
              }}
            />
          </GeoJSONSource>

        {/*
          You are here, and which way you are facing.

          The cone is drawn under the dot and only when a compass reading
          exists — an arrow pointing nowhere in particular is worse than no
          arrow, because it still looks like an assertion.
        */}
        {/* Same reasoning as the route source above. */}
                  <GeoJSONSource
            key="nav-here"
            id="nav-here"
            data={
              {
                type: 'FeatureCollection',
                features: drawableHere
                  ? [
                      {
                        type: 'Feature',
                        properties: { heading: heading ?? 0 },
                        geometry: {
                          type: 'Point',
                          coordinates: [
                            drawableHere.longitude,
                            drawableHere.latitude,
                          ],
                        },
                      },
                    ]
                  : [],
              } as never
            }
          >
            {/*
              Both layers carry a `key`, and removing either one crashes the
              app.

              The cone is conditional and the dot is not, and they are siblings
              of the same type. React reconciles keyless siblings positionally
              over the *rendered fiber list*, not over the JSX — and a condition
              that renders nothing collapses that list. So while `heading` is
              null there is exactly one fiber here, the dot's. The moment a
              compass reading arrives the children become [cone, dot], React
              lines the cone up against the fiber the dot has been using, and
              hands it that fiber's hook state.

              MapLibre's `useFrozenId` freezes a layer's id in `useState` on
              first render and throws "\`id\` cannot be changed" if it ever sees
              a different one — which is precisely what it then sees. That
              throw is fatal, and in a release build it takes the whole app
              down.

              Keys make React match these by identity instead of position, so
              the cone mounts as its own fiber and the dot keeps its own.

              Why this survived every previous test: it needs a real compass.
              Emulators and browsers report no heading, `heading` stays null
              forever, the cone never renders and the list never changes shape.
              It fired within seconds of the first run on a physical iPhone.

              The cone must also stay *before* the dot — MapLibre draws in JSX
              order and an arrow over the dot reads as a separate object — so
              reordering was not an option here.
            */}
            {heading !== null && (
              <Layer
                key="nav-here-cone"
                id="nav-here-cone"
                type="symbol"
                layout={{
                  'icon-image': 'heading',
                  // The sprite points up, and icon-rotate is clockwise from
                  // north, so the compass bearing goes in unmodified.
                  'icon-rotate': ['get', 'heading'] as never,
                  'icon-rotation-alignment': 'map',
                  'icon-allow-overlap': true,
                  'icon-ignore-placement': true,
                  'icon-size': 0.6,
                }}
                paint={{
                  'icon-opacity': 0.55,
                }}
              />
            )}
            <Layer
              key="nav-here-dot"
              id="nav-here-dot"
              type="circle"
              paint={{
                'circle-radius': 7,
                'circle-color': color.text,
                'circle-stroke-color': color.accent,
                'circle-stroke-width': 3,
              }}
            />
          </GeoJSONSource>

        {/*
          Callouts. `ViewAnnotation` anchors a real RN view to a coordinate and
          the native side keeps it pinned as the camera moves, which is the
          equivalent of the web screen re-projecting on every frame.

          Capped and zoom-gated for the same reason as web: §12.3 budgets
          against 400 spots, and 400 anchored views would not pan.
        */}
        {showCallouts &&
          features.slice(0, MAX_CALLOUTS).map((feat) => {
            const c = feat.geometry?.coordinates;
            if (!c) return null;
            const props = feat.properties ?? {};
            const imageKey = String(props.keyImageKey ?? '');
            const uri = imageKey ? mediaUris[imageKey] : undefined;
            const dimmed = Number(props.hidden ?? 0) === 1;

            return (
              <ViewAnnotation
                key={String(props.id)}
                lngLat={c}
                anchor="bottom"
                offset={[0, -14]}
              >
                <Pressable
                  onPress={() => onSpotTap?.(String(props.id))}
                  style={[styles.callout, dimmed && styles.calloutDimmed]}
                >
                  {uri ? (
                    <Image
                      source={{ uri }}
                      style={styles.calloutImage}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={[styles.calloutImage, styles.calloutEmpty]}>
                      <Text style={styles.calloutEmptyText}>no photo</Text>
                    </View>
                  )}
                  <Text style={styles.calloutName} numberOfLines={1}>
                    {String(props.name ?? '')}
                  </Text>
                </Pressable>
              </ViewAnnotation>
            );
          })}
      </Map>
      )}

      {/*
        The terrain map, mounted from the start and simply hidden.

        ── Why it is not created on demand ─────────────────────────────
        It has a great deal to do before it can draw anything: load
        maplibre and pmtiles, take the whole basemap archive across the
        bridge, parse a 1.8MB style, build a mesh. Created when the button
        is pressed, all of that happens while you are looking at a blank
        rectangle wondering whether it worked.

        Mounted up front it does that work once, early, while you are still
        reading the flat map — and pressing 3D becomes a visibility change.
        That is the alternative to a loading screen: not a faster load, but
        one that has already happened by the time it is wanted.

        It stays mounted rather than unmounting on the way back, because
        tearing it down would mean paying the whole cost again the next
        time. A settled MapLibre map renders only when something changes,
        so an idle hidden one is close to free.

        pointerEvents is what keeps it honest while hidden: without it an
        invisible full-screen layer would swallow every tap meant for the
        flat map underneath.
      */}
      {(warm || terrain3d) && (
      <View
        style={[styles.terrainLayer, !terrain3d && styles.terrainWarming]}
        pointerEvents={terrain3d ? "auto" : "none"}
      >
          <TerrainSpike
            venue={venue}
            spots={shape}
            here={here}
            heading={heading}
            route={route}
            onOpenSpot={onSpotTap}
            // The page cannot read the device's files, so the photos stay here.
            mediaUris={mediaUris}
          mediaFocal={mediaFocal}
            // The same clock the dial and the sky strip use, so scrubbing the
            // time re-lights the terrain instead of only moving a dial.
            sunAt={clock.now}
          // Stars are a graphics setting; the moon is not, because it is
          // information rather than atmosphere.
          stars={starsEnabled}
          shadows={shadowsEnabled}
          // Real cover and rainfall for this circuit and this hour.
          /*
            Rain zeroed rather than the forecast withheld.

            Cover still comes through when rain is off — the setting is about
            falling rain on the screen, not about pretending the sky is clear.
            Zeroing is also what stops the page's animation loop, since that
            runs only while there is cloud or rain to move.
          */
          weather={
            rainEnabled ? conditions : { cover: conditions.cover, rain: 0 }
          }
            /*
              Placing works in 3D too.

              Gated on `placing` here rather than in the page, so the rule about
              when a tap means "put a spot there" lives in one place and cannot
              drift between the two maps.
            */
            onMapTap={(latitude, longitude) => {
              if (!placing) return;
              onMapTap?.({ longitude, latitude });
            }}
          />
      </View>
      )}

      {stack !== null && (
        <View style={[styles.stackPanel, { top: insets.top + MENU_CLEARANCE + controlsTop }]}>
          <View style={styles.stackHead}>
            <Text style={styles.stackTitle}>{stack.length} SPOTS HERE</Text>
            <Pressable
              onPress={() => {
                setStack(null);
                setLit(null);
              }}
              hitSlop={10}
            >
              <Text style={styles.stackClose}>Done</Text>
            </Pressable>
          </View>

          <Text style={styles.stackHint}>
            Tap a name to pick it out, then tap it on the map to open it.
          </Text>

          {stack.map((s) => {
            const on = s.id === lit;
            return (
              <Pressable
                key={s.id}
                onPress={() => setLit(on ? null : s.id)}
                style={({ pressed }) => [
                  styles.stackRow,
                  on && styles.stackRowOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[styles.stackName, on && styles.stackNameOn]}
                  numberOfLines={1}
                >
                  {s.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/*
        2D ⇄ 3D — spec §5.10, §5.11.

        Leaving 3D returns the camera to flat *and* north-up. Pitch and bearing
        are only reachable by gesture while tilted, so without the reset you can
        land back in 2D rotated 40° with no control that puts it straight.

        ── Two things this deliberately does not do ────────────────────────
        It does not pass `center`. It used to, and that meant every toggle
        threw the camera back to the circuit's default centre — so glancing at
        a corner in 3D and returning to 2D lost wherever you had panned to.
        Tilting is not navigating; the view should stay put.

        It does not pass `bearing` at all when entering 3D, rather than
        passing `undefined`. The intent was "leave the rotation alone", but an
        explicit `undefined` is a property that still exists on the object
        crossing the bridge, and a camera stop is not the place to find out how
        each platform reads that. Omitting the key says the same thing without
        the question.
      */}
      <Pressable
        // Only the state. The camera follows in an effect below, and the
        // reason is worth reading before moving it back here.
        /*
          3D is the terrain map now.

          What this button used to do was tilt the camera and switch on
          hillshading and extruded buildings — and on iOS that is all it could
          ever do, because maplibre-react-native has no terrain mesh. The
          result was a tilted 2D map: a button that looked like a feature and
          was not one.

          So it opens the real thing instead. 2D stays the native map, where
          placing, editing, the navigator and the sun dial all live and all
          work; 3D is where you go to see whether a corner sits below an
          embankment.

          The honest cost, stated because it is real: the terrain map is a
          WebView and currently needs signal for its libraries. At a circuit
          with none, 3D will not open. That is a worse trade than it sounds
          only if you expected 3D to work there — and until today it did not
          work anywhere.
        */
        onPress={() => setTerrain3d((on) => !on)}
        style={({ pressed }) => [
          styles.modeButton,
          // Beneath the menu, sharing its left edge: both are things you press
          // deliberately, and the right side belongs to the ruler. controlsTop
          // pushes it further down when the shell has stacked something else
          // there, such as the back-to-event button.
          { top: insets.top + MENU_CLEARANCE + controlsTop },
          /*
            terrain3d, not is3D.

            The label already switched on terrain3d while the background
            switched on is3D — the older native-3D flag, which the terrain view
            never sets. So in 3D the text turned its on-accent colour, meant to
            sit on a bright button, while the button stayed dark: dark on dark,
            and the control read as disabled exactly when it was active.
          */
          terrain3d && styles.modeButtonActive,
          pressed && styles.pressed,
        ]}
      >
        {/*
          Names the mode you are in, as a mode switch should.

          It briefly read "3D" always, while the terrain view was a separate
          screen and the button was a door. It swaps the map in place now, so
          it is a switch again and should say which side it is on.
        */}
        <Text style={[styles.modeLabel, terrain3d && styles.modeLabelActive]}>
          {terrain3d ? '3D' : '2D'}
        </Text>
      </Pressable>

      {is3D && (
        <View
          style={[
            styles.terrainNote,
            { top: insets.top + MENU_CLEARANCE + controlsTop + 64 },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.terrainNoteText}>
            Relief shading streams over the network until this circuit is
            downloaded. There is no 3D landscape on iPhone — see the note in
            map/style.ts.
          </Text>
        </View>
      )}

      <CircuitRuler venue={venue} top={insets.top + MENU_TOP} />

      {/* No venue badge: the top-left menu trigger carries the circuit and
          active event, and both sat in the same corner. */}

      {/*
        The sun, stacked below the ruler rather than sharing its exact corner
        — see `CIRCUIT_RULER_CLEARANCE`.
      */}
      <SunDial
        at={clock.now}
        position={position}
        top={insets.top + MENU_TOP + CIRCUIT_RULER_CLEARANCE}
        heading={dialHeading}
      />

      {/*
        Bottom-anchored rather than competing with the menu/ruler/sun cluster
        at the top of the screen — a full-width strip reads better clear of
        that corner.
      */}
      <SkyControl
        clock={clock}
        position={position}
        // The circuit's clock, not the phone's. See formatClock in SkyControl.
        timeZone={view.timezone}
        // The day's forecast, so the strip can say what the sky will be doing
        // as well as what the light will be.
        forecast={conditions.series}
        bottom={insets.bottom + BOTTOM_BAR_CLEARANCE}
      />

    </View>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    /*
     * The stack list, matching the terrain map's.
     *
     * On-map furniture, so fixed dark values rather than theme tokens — the
     * same reasoning as the menu trigger and the sun dial, which float on an
     * always-dark basemap and would go near-invisible in a light theme.
     */
    stackPanel: {
      position: 'absolute',
      left: space.md,
      right: space.md,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: 'rgba(11,13,16,0.94)',
      borderWidth: 1,
      borderColor: color.border,
    },
    stackHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    stackTitle: {
      color: color.accent,
      fontSize: type.label,
      fontWeight: weight.bold,
      letterSpacing: 1.2,
    },
    stackClose: { color: color.text, fontSize: type.label, fontWeight: weight.bold },
    stackHint: { color: color.textMuted, fontSize: 11, lineHeight: 15, marginTop: 4 },
    stackRow: {
      marginTop: 6,
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: color.border,
    },
    stackRowOn: { borderColor: color.accent },
    stackName: { color: color.textMuted, fontSize: type.label },
    stackNameOn: { color: color.text, fontWeight: weight.bold },
    modeButton: {
      position: 'absolute',
      left: space.md,
      width: 56,
      height: 56,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: 'rgba(11,13,16,0.92)',
      borderWidth: 1,
      borderColor: color.border,
    },
    modeButtonActive: { backgroundColor: color.accent, borderColor: color.accent },
    pressed: { opacity: 0.7 },
    modeLabel: { color: color.text, fontSize: type.body, fontWeight: weight.bold },
    modeLabelActive: { color: color.onAccent },

    /**
     * The one honest caveat on this screen.
     *
     * Everything else works with no signal; the DEM does not. Saying so where the
     * feature is used beats discovering it in the Eifel, which is exactly where
     * there is no coverage and exactly where the relief matters most.
     */
    terrainNote: {
      position: 'absolute',
      left: space.md,
      maxWidth: 190,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: 'rgba(11,13,16,0.92)',
      borderWidth: 1,
      borderColor: color.border,
    },
    terrainNoteText: { color: color.textMuted, fontSize: 10, lineHeight: 14 },

    root: { flex: 1, backgroundColor: color.background },
    map: { flex: 1 },

    /*
     * The terrain map's layer.
     *
     * Absolute so it can sit over the flat map without either of them having
     * to know the other exists, and so hiding it changes nothing about the
     * layout of the controls stacked above.
     */
    terrainLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    /*
     * Hidden, not unmounted — see the note at the mount site.
     *
     * Zero opacity rather than display:none: a WebView that has been given no
     * size never lays out its page, so the map inside would size itself to
     * nothing and have to rebuild when shown, which is the delay this exists
     * to remove.
     */
    terrainWarming: { opacity: 0 },

    centre: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: space.lg,
      backgroundColor: color.background,
    },
    loading: { color: color.textMuted, fontSize: type.body, marginTop: space.md },

    errorTitle: {
      color: color.accent,
      fontSize: type.title,
      fontWeight: weight.bold,
    },
    errorBody: {
      color: color.text,
      fontSize: type.body,
      marginTop: space.sm,
      textAlign: 'center',
    },
    errorHint: {
      color: color.textFaint,
      fontSize: type.label,
      marginTop: space.md,
      textAlign: 'center',
    },

    callout: {
      width: 124,
      borderRadius: radius.md,
      backgroundColor: 'rgba(11,13,16,0.96)',
      borderWidth: 1,
      borderColor: color.border,
      overflow: 'hidden',
    },
    calloutDimmed: { opacity: 0.45 },
    calloutImage: { width: '100%', height: 54 },
    calloutEmpty: {
      backgroundColor: color.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    calloutEmptyText: { color: color.textFaint, fontSize: 10 },
    calloutName: {
      color: color.text,
      fontSize: 11,
      fontWeight: weight.bold,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
    },

    badge: {
      position: 'absolute',
      top: space.md,
      left: space.md,
      backgroundColor: color.surface,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
    },
    badgeLabel: {
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    badgeSub: { color: color.textFaint, fontSize: type.label },
  });
}
