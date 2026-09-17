import { Text } from '../Typography';
/**
 * Map — web implementation (maplibre-gl).
 *
 * `@maplibre/maplibre-react-native` is Android/iOS only, so the web target
 * needs its own renderer. Metro resolves `.web.tsx` ahead of `.tsx`
 * automatically, so nothing imports this file explicitly.
 *
 * This exists purely so the map can be iterated on with hot reload instead of
 * a 15-minute native rebuild per change. The phone is the real target; both
 * screens read the same PMTiles archive and the same style module, so what you
 * see here is the same basemap the device draws.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// maplibre-gl 6.x is ESM with named exports and no default export — importing
// it as `import maplibregl from 'maplibre-gl'` yields undefined at runtime.
import { Map as MlMap, addProtocol } from 'maplibre-gl';
import { Protocol } from 'pmtiles';

// maplibre-gl's stylesheet is deliberately NOT imported. Metro will not resolve
// a CSS file out of node_modules, and it is not needed here: that stylesheet
// styles MapLibre's own controls (attribution button, zoom buttons, popups),
// none of which are enabled. The WebGL canvas renders without it, and this
// screen draws its own chrome to match the trackside theme.

import { clusterCallouts } from '../../core/logic/callouts';
import { MENU_CLEARANCE, radius, space, type, useTheme, weight, type Theme } from '../theme';
import CircuitRuler from '../map/CircuitRuler';
import SkyControl from '../map/SkyControl';
import SunDial from '../map/SunDial';
import { useMapClock } from '../state/useMapClock';
import { useVenueConditions } from '../state/useVenueConditions';
import { useReducedMotion } from '../Motion';
import { installWebAtmosphere } from '../map/webAtmosphere';
import {
  OSM_ATTRIBUTION,
  TERRAIN_EXAGGERATION,
  TERRAIN_SOURCE,
  SCENERY_SPRITES,
  SPOTS_SOURCE,
  THREE_D_LAYERS,
  VENUE_VIEW,
  WEB_TILES,
  type VenueKey,
  buildMapStyle,
  illuminationFromSun,
  circuitMetricsFor,
} from '../map/style';
import { solarPosition, moonState } from '../../core/logic/sun';
import { getMapRainEnabled, getMapShadowsEnabled, getMapStarsEnabled } from '../../storage-local/preferences';

/**
 * Teach maplibre-gl to read `pmtiles://` URLs.
 *
 * Registered once per page rather than per component: re-registering on every
 * mount leaks handlers and makes hot reload progressively slower.
 */
let protocolRegistered = false;
function registerPmtilesProtocol() {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

/**
 * Zoom at or above which callouts are drawn.
 *
 * Below this the pins are close enough together that cards would overlap into
 * an unreadable stack, and the `spot-label` symbol layer covers naming
 * instead — it is GPU-drawn and collision-managed, which HTML is not.
 */
const CALLOUT_MIN_ZOOM = 13;

/** Hard cap, so a dense circuit cannot stall panning (§12.3). */
const MAX_CALLOUTS = 40;

interface SpotFeature {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: [number, number] };
}

export default function MapScreen({
  venue = 'nordschleife' as VenueKey,
  spots,
  mediaUris = {},
  onMapTap,
  onSpotTap,
  placing = false,
  route,
  here,
  heading = null,
  controlsTop = 0,
  controlsBottom = 84,
  chromeVisible = true,
}: {
  venue?: VenueKey;
  /** GeoJSON for the spots source; re-applied when it changes. */
  spots?: unknown;
  /** storageKey -> displayable URI, for the hover preview. */
  mediaUris?: Record<string, string>;
  onMapTap?: (lngLat: { latitude: number; longitude: number }) => void;
  onSpotTap?: (id: string) => void;
  /** In placing mode a tap drops a new spot rather than doing nothing. */
  placing?: boolean;
  /**
   * The navigation route, as a FeatureCollection of legs.
   *
   * Each feature carries `kind`: 'network' for extracted ways, 'direct' for a
   * straight line across ground we have no path for. They are drawn
   * differently on purpose — see core/logic/route.ts.
   */
  route?: unknown;
  /** Live position, whenever there is a fix. */
  here?: { latitude: number; longitude: number } | null;
  /** Compass bearing in degrees from north, or null when unknown. */
  heading?: number | null;
  /** Accepted for parity with native; the web chrome does not stack. */
  controlsTop?: number;
  controlsBottom?: number;
  chromeVisible?: boolean;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);
  const insets = useSafeAreaInsets();
  const { height: viewportHeight } = useWindowDimensions();
  const [skyHeight, setSkyHeight] = useState(100);
  const clock = useMapClock();
  const reducedMotion = useReducedMotion();
  const position = useMemo(() => ({ longitude: VENUE_VIEW[venue].centre[0], latitude: VENUE_VIEW[venue].centre[1] }), [venue]);
  const conditions = useVenueConditions(position, VENUE_VIEW[venue].timezone, clock.now);
  const atmosphere = useRef<ReturnType<typeof installWebAtmosphere> | null>(null);
  const [effects, setEffects] = useState({ rainEnabled: true, starsEnabled: true, shadowsEnabled: true });
  useEffect(() => {
    let cancelled = false;
    void Promise.all([getMapRainEnabled(), getMapStarsEnabled(), getMapShadowsEnabled()])
      .then(([rainEnabled, starsEnabled, shadowsEnabled]) => { if (!cancelled) setEffects({ rainEnabled, starsEnabled, shadowsEnabled }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /**
   * The spot singled out from a stack.
   *
   * Picking one from a stack greys everything else so you can see where that
   * one actually is — the whole reason to open a stack is to answer "which of
   * these is which". Tapping the map clears it.
   */
  const [isolatedId, setIsolatedId] = useState<string | null>(null);
  /** The stack currently opened for picking, by its seed id. */
  const [openStackId, setOpenStackId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  /** Set once the user pans/zooms, after which the map stops re-framing itself. */
  const userMovedRef = useRef(false);

  /**
   * Latest tap handlers, read by the map's click listener.
   *
   * The listener is attached once when the map is built. Without this ref it
   * would close over the first render's props and keep calling stale callbacks
   * — placing mode would never appear to turn on.
   */
  const handlersRef = useRef({ onMapTap, onSpotTap, placing, clearIsolate: () => {} });
  handlersRef.current = {
    onMapTap,
    onSpotTap,
    placing,
    clearIsolate: () => {
      setIsolatedId(null);
      setOpenStackId(null);
    },
  };

  const EMPTY_FC = { type: 'FeatureCollection', features: [] } as const;
  /** Latest spots, so the initial style build sees them without a re-init. */
  const spotsRef = useRef<unknown>(spots ?? EMPTY_FC);
  spotsRef.current = spots ?? EMPTY_FC;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [is3d, setIs3d] = useState(false);
  /**
   * Bumped whenever the camera moves.
   *
   * Callouts are HTML positioned in screen space, so they have to be
   * re-projected every time the map moves under them. A counter is enough —
   * the positions themselves are recomputed from the map on render.
   */
  const [viewTick, setViewTick] = useState(0);
  /**
   * Spot under the cursor, if any.
   *
   * Callouts are always visible but compact; the hovered one expands to show
   * its times and notes. Desktop affordance only — on touch every callout stays
   * in its compact form and the full detail is a tap away in the overview, so
   * nothing is reachable by hover alone (§5.10).
   */
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    registerPmtilesProtocol();

    const view = VENUE_VIEW[venue];
    let map: MlMap;
    try {
      map = new MlMap({
        container: containerRef.current,
        style: buildMapStyle(WEB_TILES[venue], venue, spotsRef.current) as never,
        // Open framed on the circuit rather than at a fixed zoom, so the whole
        // lap is visible on a phone and on a desktop alike.
        bounds: view.circuitBounds,
        fitBoundsOptions: { padding: 28, duration: 0 },
        // Constrain the camera to the extracted region. Outside it no tiles
        // exist, and zoomed out past minZoom the circuit is a dot on a world
        // map — every gesture from there is a mistake to undo.
        maxBounds: view.bounds,
        minZoom: view.minZoom,
        maxZoom: view.maxZoom,
        // Milestone 1 is flat 2D (spec §6). 3D orbit and first-person are §5.10,
        // Milestone 2 — deliberately not enabled here.
        pitch: 0,
        bearing: 0,
        attributionControl: false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    mapRef.current = map;

    /**
     * Register the scenery sprites before any layer asks for them.
     *
     * A symbol layer whose `icon-image` is missing renders nothing and only
     * logs a style warning rather than failing, so an unregistered icon looks
     * exactly like "the trees layer is broken".
     */
    map.on('styleimagemissing', (e: { id: string }) => {
      const src = SCENERY_SPRITES[e.id];
      if (src === undefined) return;

      // `Image` in this file is React Native's component; the DOM constructor
      // that MapLibre wants lives on `window`.
      const img = new window.Image();
      img.onload = () => {
        if (!map.hasImage(e.id)) map.addImage(e.id, img);
      };
      /*
       * Metro turns a `require()`d asset into a module id on native and a URL
       * on web. `Image.resolveAssetSource` normalises both, so a single sprite
       * table serves each platform — which is the point of rasterising them to
       * PNG rather than leaving SVG only the browser could read.
       */
      img.src = Image.resolveAssetSource(src).uri;
    });

    // Dev-only handle. Styling a vector basemap means inspecting what is
    // actually in the tiles — `__map.querySourceFeatures('protomaps', {...})`
    // answers "what kind values exist here" far faster than decoding MVT by
    // hand. Stripped from production builds by the __DEV__ guard.
    if (__DEV__) {
      (globalThis as Record<string, unknown>).__map = map;
    }

    map.on('load', () => setReady(true));
    // Surface tile/style failures instead of leaving a blank grey canvas — a
    // missing PMTiles file otherwise looks identical to "still loading".
    map.on('error', (e) => setError(e.error?.message ?? 'map error'));

    /**
     * Keep the drawing buffer — and the framing — matched to the container.
     *
     * maplibre measures its container once at construction. react-native-web
     * lays flex children out after mount, so the map is created against a
     * container that has not reached full size yet: it renders into part of the
     * viewport, and the opening `fitBounds` frames the circuit for a box that
     * is about to change, clipping the north end of the lap.
     *
     * `resize()` alone fixes the canvas but leaves the stale framing, so re-fit
     * too — but only until the user takes control, or every window resize would
     * yank them back out to the full lap mid-inspection.
     */
    const observer = new ResizeObserver(() => {
      map.resize();
      if (!userMovedRef.current) {
        map.fitBounds(view.circuitBounds, { padding: 28, duration: 0 });
      }
    });
    observer.observe(containerRef.current);

    // Only gestures carry an originalEvent; programmatic camera moves do not.
    const onUserMove = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) userMovedRef.current = true;
    };
    map.on('movestart', onUserMove);
    map.on('zoomstart', onUserMove);

    /**
     * Taps: a pin if one is under the cursor, otherwise the map itself.
     *
     * Checked in that order because the pin sits on top — dropping a new spot
     * on top of an existing one when the user meant to open it would be a
     * quietly destructive misread.
     *
     * Handlers are read from a ref so this listener is registered once for the
     * life of the map rather than being torn down and rebuilt on every render.
     */
    // Cursor affordance only — the callouts are always on, so there is no
    // hover state to track.
    map.on('mousemove', (e) => {
      const hits = map.queryRenderedFeatures(e.point, {
        layers: ['spot-pin', 'spot-halo'],
      });
      map.getCanvas().style.cursor = hits.length > 0 ? 'pointer' : '';
      const id = hits[0]?.properties?.id;
      setHoveredId(typeof id === 'string' ? id : null);
    });
    map.on('mouseout', () => setHoveredId(null));

    // Callouts are positioned in screen space, so they follow the camera only
    // if something re-renders them as it moves.
    map.on('move', () => setViewTick((t) => t + 1));

    map.on('click', (e) => {
      const hits = map.queryRenderedFeatures(e.point, {
        layers: ['spot-pin', 'spot-halo'],
      });
      const id = hits[0]?.properties?.id;
      if (typeof id === 'string') {
        handlersRef.current.onSpotTap?.(id);
        return;
      }
      // A tap on open ground ends the isolation — the way out that needs no
      // close button to find while walking.
      handlersRef.current.clearIsolate();
      if (handlersRef.current.placing) {
        handlersRef.current.onMapTap?.({
          latitude: e.lngLat.lat,
          longitude: e.lngLat.lng,
        });
      }
    });

    return () => {
      observer.disconnect();
      atmosphere.current?.dispose();
      atmosphere.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [venue]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    try {
      atmosphere.current ??= installWebAtmosphere(map, VENUE_VIEW[venue].centre, VENUE_VIEW[venue].bounds);
      const sun = solarPosition(clock.now, position);
      atmosphere.current.update({ cover: conditions.cover, rain: conditions.rain, ...sun, ...effects, moon: moonState(clock.now, position), epoch: clock.now.getTime() / 1000, enabled: is3d, reducedMotion });
      if (map.getLayer('terrain-hillshade')) map.setPaintProperty('terrain-hillshade', 'hillshade-illumination-direction', illuminationFromSun(sun.altitude, sun.azimuth));
      const daylight = Math.max(0, Math.min(1, (sun.altitude + 8) / 35));
      const sunset = Math.max(0, 1 - Math.abs(sun.altitude - 2) / 12);
      const tone = (night: number[], day: number[]) => `rgb(${night.map((v, i) => Math.round(v + (day[i]! - v) * daylight)).join(',')})`;
      map.setSky({ 'sky-color': tone([5, 9, 18], [92, 147, 204]), 'horizon-color': tone([14, 19, 34], [168 + sunset * 70, 200 - sunset * 60, 232 - sunset * 135]), 'fog-color': tone([12, 17, 25], [150, 170, 188]), 'sky-horizon-blend': 0.6, 'atmosphere-blend': 0.8 });
    } catch (error) { setError(`Atmosphere unavailable: ${error instanceof Error ? error.message : String(error)}`); }
  }, [ready, venue, clock.now, conditions.cover, conditions.rain, is3d, reducedMotion, position, effects]);

  /**
   * Push spot changes into the existing source.
   *
   * `setData` rather than rebuilding the style: a style reload drops the
   * camera, the registered sprites and the 3D toggle state, so saving a spot
   * would yank the map back to the opening view every time.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource(SPOTS_SOURCE) as
      | { setData?: (d: unknown) => void }
      | undefined;
    src?.setData?.(spots ?? { type: 'FeatureCollection', features: [] });
  }, [spots, ready]);

  /**
   * The route and the "you are here" dot.
   *
   * Added after the style rather than baked into it: both change constantly
   * while walking, and rebuilding the style for each GPS fix would tear down
   * the terrain and re-request tiles every three seconds.
   *
   * Network legs are solid, direct legs dashed. That distinction is the whole
   * honesty of the router — a dashed line says "no path here, this is a
   * bearing", and drawing it like a footpath would be a claim the data cannot
   * support.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const empty = { type: 'FeatureCollection', features: [] };
    const routeData = route ?? empty;
    const hereData = here
      ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { heading: heading ?? 0, hasHeading: heading !== null },
              geometry: {
                type: 'Point',
                coordinates: [here.longitude, here.latitude],
              },
            },
          ],
        }
      : empty;

    const existing = map.getSource('nav-route') as
      | { setData?: (d: unknown) => void }
      | undefined;

    if (existing) {
      existing.setData?.(routeData);
      (
        map.getSource('nav-here') as { setData?: (d: unknown) => void } | undefined
      )?.setData?.(hereData);
      return;
    }

    map.addSource('nav-route', { type: 'geojson', data: routeData } as never);
    map.addSource('nav-here', { type: 'geojson', data: hereData } as never);

    map.addLayer({
      id: 'nav-route-network',
      type: 'line',
      source: 'nav-route',
      filter: ['==', ['get', 'kind'], 'network'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#2E7DF6',
        'line-width': 5,
        'line-opacity': 0.9,
      },
    } as never);

    map.addLayer({
      id: 'nav-route-direct',
      type: 'line',
      source: 'nav-route',
      filter: ['==', ['get', 'kind'], 'direct'],
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': '#2E7DF6',
        'line-width': 4,
        'line-opacity': 0.8,
        // Dashed: a guess, not a path.
        'line-dasharray': [1.5, 1.5],
      },
    } as never);

    // Facing cone under the dot; hidden when there is no compass reading.
    map.addLayer({
      id: 'nav-here-cone',
      type: 'symbol',
      source: 'nav-here',
      filter: ['==', ['get', 'hasHeading'], true],
      layout: {
        'icon-image': 'heading',
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': 0.6,
      },
      paint: { 'icon-opacity': 0.55 },
    } as never);

    map.addLayer({
      id: 'nav-here',
      type: 'circle',
      source: 'nav-here',
      paint: {
        'circle-radius': 7,
        'circle-color': '#F2F5F8',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#2E7DF6',
      },
    } as never);
  }, [route, here, heading, ready]);

  /**
   * 2D ⇄ 3D — spec §5.10, §5.11.
   *
   * `easeTo`, not `flyTo`: flyTo adds a zoom-out arc that suits crossing a map
   * and looks wrong tilting into terrain that is already on screen. easeTo
   * animates pitch and zoom on one curve so they arrive together.
   *
   * Pitch is capped at 65 rather than MapLibre's 85 — past roughly 70 with
   * terrain enabled the camera ends up looking through a hillside.
   */
  const toggle3d = () => {
    const map = mapRef.current;
    if (!map) return;
    const next = !is3d;
    setIs3d(next);

    const view = VENUE_VIEW[venue];
    const centre = map.getCenter();

    if (next) {
      // Light the terrain with the sun as it actually is right now (§5.12).
      const sun = solarPosition(clock.now, {
        latitude: centre.lat,
        longitude: centre.lng,
      });
      map.setPaintProperty(
        'terrain-hillshade',
        'hillshade-illumination-direction',
        illuminationFromSun(sun.altitude, sun.azimuth),
      );
      for (const id of THREE_D_LAYERS) {
        map.setLayoutProperty(id, 'visibility', 'visible');
      }
      map.setTerrain({
        source: TERRAIN_SOURCE,
        exaggeration: TERRAIN_EXAGGERATION,
      });
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
      map.easeTo({ pitch: 65, duration: 1000 });
    } else {
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();
      // Tear terrain down only once the camera is flat again — dropping it
      // mid-tilt collapses the ground under the camera and reads as a glitch.
      window.setTimeout(() => {
        if (!mapRef.current) return;
        mapRef.current.setTerrain(null);
        for (const id of THREE_D_LAYERS) {
          mapRef.current.setLayoutProperty(id, 'visibility', 'none');
        }
      }, 820);
    }

    void view;
  };

  /**
   * Nudge one camera property.
   *
   * Pitch is clamped to 75: MapLibre allows 85, but past roughly 70 with
   * terrain on, the camera ends up looking through a hillside rather than over
   * it. Panning is left to dragging, which works fine even gloved.
   */
  const nudge = ({
    bearing = 0,
    pitch = 0,
    zoom = 0,
  }: {
    bearing?: number;
    pitch?: number;
    zoom?: number;
  }) => {
    const map = mapRef.current;
    if (!map) return;
    userMovedRef.current = true;
    map.easeTo({
      bearing: map.getBearing() + bearing,
      pitch: Math.min(75, Math.max(0, map.getPitch() + pitch)),
      zoom: map.getZoom() + zoom,
      duration: 300,
    });
  };

  /** Back to the opening frame — the whole lap, north up, tilt retained. */
  const resetCamera = () => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ bearing: 0, duration: 400 });
    map.fitBounds(VENUE_VIEW[venue].circuitBounds, {
      padding: 28,
      duration: 400,
    });
  };

  return (
    <View style={styles.root}>
      {/* maplibre-gl needs a real DOM node, which react-native-web renders
          View as anyway — the cast keeps TypeScript honest about that. */}
      <View
        // @ts-expect-error react-native-web renders View to a div; maplibre
        // needs that element directly.
        ref={containerRef}
        style={styles.canvas}
      />

      {chromeVisible && <>
      <CircuitRuler venue={venue} top={insets.top + MENU_CLEARANCE + controlsTop} />

      {/* No venue badge: the top-left menu trigger carries the circuit and
          active event, and both sat in the same corner. */}

      <Pressable
        onPress={toggle3d}
        disabled={!ready}
        style={({ pressed }) => [
          styles.dimButton,
          { top: insets.top + MENU_CLEARANCE + controlsTop },
          is3d && styles.dimButtonActive,
          pressed && styles.dimButtonPressed,
        ]}
      >
        <Text style={[styles.dimLabel, is3d && styles.dimLabelActive]}>
          {is3d ? '3D' : '2D'}
        </Text>
      </Pressable>

      {is3d && insets.top + MENU_CLEARANCE + controlsTop + 260 < viewportHeight - insets.bottom - controlsBottom - skyHeight - 12 && (
        <>
          {/*
            Explicit camera controls. Drag-rotate and touch-pitch are enabled
            too, but gloves and a phone in one hand make precise dragging
            unrealistic — discrete buttons are the reliable path (§5.14).
          */}
          <View style={[styles.controls, { top: insets.top + MENU_CLEARANCE + controlsTop + 64 }]}>
            <ControlRow>
              <ControlButton label="⟲" onPress={() => nudge({ bearing: -30 })} />
              <ControlButton label="⟳" onPress={() => nudge({ bearing: 30 })} />
            </ControlRow>
            <ControlRow>
              <ControlButton label="▲" onPress={() => nudge({ pitch: 10 })} />
              <ControlButton label="▼" onPress={() => nudge({ pitch: -10 })} />
            </ControlRow>
            <ControlRow>
              <ControlButton label="＋" onPress={() => nudge({ zoom: 1 })} />
              <ControlButton label="－" onPress={() => nudge({ zoom: -1 })} />
            </ControlRow>
            <ControlRow>
              <ControlButton label="⌂" onPress={resetCamera} wide />
            </ControlRow>
          </View>

        </>
      )}
      {insets.top + MENU_CLEARANCE + controlsTop + 244 < viewportHeight - insets.bottom - controlsBottom - skyHeight - 12 && <SunDial at={clock.now} position={position} top={insets.top + MENU_CLEARANCE + controlsTop + 64} heading={heading} />}
      <SkyControl clock={clock} position={position} timeZone={VENUE_VIEW[venue].timezone} forecast={conditions.series} bottom={insets.bottom + controlsBottom} onHeightChange={setSkyHeight} />
      </>}

      {(() => {
        const map = mapRef.current;
        const box = containerRef.current;
        if (!map || !ready || !box) return null;

        // viewTick is read so this recomputes as the camera moves.
        void viewTick;

        const width = box.clientWidth;
        const height = box.clientHeight;

        const features =
          (spots as { features?: SpotFeature[] } | undefined)?.features ?? [];

        /**
         * Only draw callouts that are actually on screen, and only when zoomed
         * in enough to read them.
         *
         * Each callout is a DOM node repositioned on every camera frame. §12.3
         * sets the performance budget against realistic volumes — 400 spots at
         * a circuit — and drawing all of them would collapse panning. Below the
         * zoom threshold the map falls back to the `spot-label` symbol layer,
         * which the GPU handles.
         */
        if (map.getZoom() < CALLOUT_MIN_ZOOM) return null;

        /**
         * Two sizes.
         *
         * Compact is the resting state — enough to know which waypoint is
         * which without forty photo cards competing for the map. The hovered
         * one grows and adds its times and notes.
         */
        const COMPACT = 124;
        const EXPANDED = 200;
        /** Roughly a compact card: image, name, padding. Used for collision. */
        const CARD_HEIGHT = 92;
        const STEM = 16;
        const MARGIN = 8;

        /**
         * Project every spot, then let core/logic/callouts.ts decide what is
         * on screen and what collides.
         *
         * Spots at a circuit sit metres apart — Brünnchen alone holds several —
         * so at any zoom that frames the lap their cards land on top of each
         * other. Overlapping cards are worse than useless: neither is readable,
         * and nothing tells you how many are hidden. Colliding cards become one
         * stack with a count instead.
         */
        const projected = [];
        for (const feat of features) {
          const coords = feat.geometry?.coordinates;
          if (!coords) continue;
          const p = map.project(coords);
          projected.push({
            id: String(feat.properties?.id ?? `${p.x}-${p.y}`),
            x: p.x,
            y: p.y,
            feat,
          });
        }

        const clusters = clusterCallouts(projected, {
          width,
          height,
          cardWidth: COMPACT,
          cardHeight: CARD_HEIGHT,
          gap: 6,
          maxClusters: MAX_CALLOUTS,
        });

        return clusters.map(({ x, y, items }) => {
          const stackCount = items.length;
          // While one spot is singled out, its stack shows that spot's card
          // rather than the stack's front — the point of isolating is to see
          // which one you picked.
          const picked =
            isolatedId !== null
              ? (items.find((i) => i.id === isolatedId) ?? null)
              : null;
          const feat = (picked ?? items[0]!).feat;
          const p = { x: picked ? picked.x : x, y: picked ? picked.y : y };
          const seedId = items[0]!.id;
          const stackOpen = openStackId === seedId;
          // Everything except the isolated spot recedes.
          const faded = isolatedId !== null && picked === null;
          const props = feat.properties ?? {};
          const imageKey = String(props.keyImageKey ?? '');
          const uri = imageKey ? mediaUris[imageKey] : undefined;
          const dimmed = Number(props.hidden ?? 0) === 1;

          // A stack expands when any of its members is hovered, since the
          // pin under the cursor may be one of the ones behind.
          const expanded =
            hoveredId !== null && items.some((i) => i.id === hoveredId);
          const CARD = expanded ? EXPANDED : COMPACT;

          const hasMetrics = circuitMetricsFor(venue) != null;
          // Avoid the CircuitRuler (148px) + space.md (16px) + extra margin (8px)
          // Also ensures the stackBadge (sticks out 8px) is never clipped by screen.
          const rightMargin = hasMetrics ? 148 + 16 + 8 : MARGIN + 8;
          const left = Math.max(
            MARGIN,
            Math.min(p.x - CARD / 2, width - CARD - rightMargin),
          );
          const stemLeft = Math.max(0, Math.min(p.x - left - 1, CARD - 2));

          /**
           * A leader line from the card down to each spot it covers.
           *
           * Drawn as a thin box rotated about its own centre: React Native has
           * no transform-origin, so the line is positioned centred on the
           * midpoint of its two endpoints, where a centre rotation lands
           * correctly.
           */
          const leaders =
            stackCount > 1 && !picked
              ? items.map((item) => {
                  const dx = item.x - x;
                  const dy = item.y - y;
                  const length = Math.hypot(dx, dy);
                  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
                  return {
                    id: item.id,
                    left: (x + item.x) / 2 - length / 2,
                    top: (y + item.y) / 2,
                    width: length,
                    angle,
                  };
                })
              : [];

          return (
            <Fragment key={String(props.id ?? `${p.x}-${p.y}`)}>
            {leaders.map((l) => (
              <View
                key={`leader-${l.id}`}
                pointerEvents="none"
                style={[
                  styles.leader,
                  {
                    left: l.left,
                    top: l.top,
                    width: l.width,
                    transform: [{ rotate: `${l.angle}deg` }],
                  },
                ]}
              />
            ))}
            <View
              key={String(props.id ?? `${p.x}-${p.y}`)}
              // A stack is interactive: tap it to pick which spot you meant.
              pointerEvents={stackCount > 1 ? 'box-none' : 'none'}
              style={[
                styles.callout,
                (dimmed || faded) && styles.calloutDimmed,
                {
                  left,
                  width: CARD,
                  bottom: height - p.y + MARGIN,
                  // Lift the expanded card above its neighbours, or it opens
                  // underneath whichever callout happens to render later.
                  zIndex: expanded ? 2 : 1,
                },
              ]}
            >
              {/*
                Depth: two offset plates behind the front card, so a stack
                reads as physical rather than being implied by the number
                alone.
              */}
              {stackCount > 1 && !picked && (
                <>
                  <View style={[styles.stackPlate, styles.stackPlateBack]} />
                  <View style={[styles.stackPlate, styles.stackPlateMid]} />
                </>
              )}

              <Pressable
                disabled={stackCount < 2}
                onPress={() => {
                  setOpenStackId(stackOpen ? null : seedId);
                  setIsolatedId(null);
                }}
                style={styles.calloutCard}
              >
                {uri ? (
                  <Image
                    source={{ uri }}
                    style={[styles.tooltipImage, { height: expanded ? 92 : 54 }]}
                  />
                ) : (
                  <View
                    style={[
                      styles.tooltipImage,
                      styles.tooltipImageEmpty,
                      { height: expanded ? 92 : 54 },
                    ]}
                  >
                    <Text style={styles.tooltipEmptyText}>
                      {expanded ? 'no key picture' : 'no photo'}
                    </Text>
                  </View>
                )}
                <View style={styles.tooltipBody}>
                  <Text
                    style={[styles.tooltipName, !expanded && styles.tooltipNameCompact]}
                    numberOfLines={expanded ? 2 : 1}
                  >
                    {String(props.name ?? '')}
                  </Text>
                  {stackCount > 1 && (
                    <Text style={styles.tooltipStacked} numberOfLines={1}>
                      +{stackCount - 1} more here
                    </Text>
                  )}
                  {/* Detail is for the hovered card only — showing it on every
                      callout is what made the map unreadable. */}
                  {expanded && props.keyTimes ? (
                    <Text style={styles.tooltipTimes} numberOfLines={1}>
                      {String(props.keyTimes)}
                    </Text>
                  ) : null}
                  {expanded && props.notes ? (
                    <Text style={styles.tooltipNotes} numberOfLines={3}>
                      {String(props.notes)}
                    </Text>
                  ) : null}
                </View>
              </Pressable>

              {/*
                Picking one of the stacked spots. Choosing greys everything
                else, so you can see where that one actually is — which is the
                only reason to open a stack.
              */}
              {stackOpen && stackCount > 1 && (
                <View style={styles.stackList}>
                  {items.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => {
                        setIsolatedId(item.id);
                        setOpenStackId(null);
                      }}
                      style={({ pressed }) => [
                        styles.stackListRow,
                        pressed && styles.pressedRow,
                      ]}
                    >
                      <Text style={styles.stackListText} numberOfLines={1}>
                        {String(item.feat.properties?.name ?? 'Untitled spot')}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {/* How many waypoints are under this card. */}
              {stackCount > 1 && (
                <View style={styles.stackBadge}>
                  <Text style={styles.stackBadgeText}>{stackCount}</Text>
                </View>
              )}

              <View style={[styles.calloutStem, { left: stemLeft, height: STEM }]} />
            </View>
            </Fragment>
          );
        });
      })()}

      {/* ODbL requires this to be visible, not just in the file (§8). */}
      <View style={styles.attribution} pointerEvents="none">
        <Text style={styles.attributionText}>{OSM_ATTRIBUTION}</Text>
      </View>

      {error !== null && (
        <View style={styles.error}>
          <Text style={styles.errorTitle}>Map failed to load</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Text style={styles.errorHint}>
            Run `npm run tiles` to regenerate public/tiles/.
          </Text>
        </View>
      )}
    </View>
  );
}

function ControlRow({ children }: { children: React.ReactNode }) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  return <View style={styles.controlRow}>{children}</View>;
}

function ControlButton({
  label,
  onPress,
  wide = false,
}: {
  label: string;
  onPress: () => void;
  wide?: boolean;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        wide && styles.controlWide,
        pressed && styles.controlPressed,
      ]}
    >
      <Text style={styles.controlLabel}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: color.background },
    canvas: { flex: 1, width: '100%', height: '100%' },

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

    attribution: {
      position: 'absolute',
      bottom: space.xs,
      right: space.xs,
      backgroundColor: 'rgba(11,13,16,0.75)',
      borderRadius: radius.sm,
      paddingHorizontal: space.sm,
      paddingVertical: 2,
    },
    attributionText: { color: color.textMuted, fontSize: 11 },

    callout: { position: 'absolute', alignItems: 'flex-start' },
    /** Hidden spots keep their callout but recede — see Spot.isHidden. */
    /**
     * The plates behind a stacked card.
     *
     * Offset down and to the right, and progressively darker, so a stack reads as
     * physical depth. Absolutely positioned so they do not affect the card's own
     * layout.
     */
    stackPlate: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.border,
      backgroundColor: color.surface,
    },
    stackPlateBack: {
      transform: [{ translateX: 8 }, { translateY: 8 }],
      opacity: 0.45,
    },
    stackPlateMid: {
      transform: [{ translateX: 4 }, { translateY: 4 }],
      opacity: 0.75,
    },
    stackBadge: {
      position: 'absolute',
      top: -8,
      right: -8,
      minWidth: 24,
      height: 24,
      paddingHorizontal: 6,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: color.accent,
      borderWidth: 2,
      borderColor: color.background,
    },
    stackBadgeText: {
      color: color.onAccent,
      fontSize: 11,
      fontWeight: weight.bold,
      fontVariant: ['tabular-nums'],
    },
    tooltipStacked: { color: color.accent, fontSize: 10, marginTop: 1 },

    /** A line from a stack's card to one of the spots it stands for. */
    leader: {
      position: 'absolute',
      height: 1,
      backgroundColor: color.accent,
      opacity: 0.65,
    },

    stackList: {
      marginTop: 4,
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
      borderWidth: 1,
      borderColor: color.border,
      overflow: 'hidden',
    },
    stackListRow: {
      minHeight: 34,
      justifyContent: 'center',
      paddingHorizontal: space.sm,
    },
    pressedRow: { backgroundColor: color.accent },
    stackListText: { color: color.text, fontSize: 11, fontWeight: weight.bold },

    calloutDimmed: { opacity: 0.45 },
    calloutCard: {
      width: '100%',
      borderRadius: radius.md,
      backgroundColor: 'rgba(11,13,16,0.96)',
      borderWidth: 1,
      borderColor: color.border,
      overflow: 'hidden',
    },
    /** Connects the card down to the waypoint it describes. */
    calloutStem: {
      position: 'absolute',
      bottom: -18,
      width: 2,
      backgroundColor: color.accent,
    },
    tooltipImage: { width: '100%' },
    tooltipNameCompact: { fontSize: 11 },
    tooltipImageEmpty: {
      backgroundColor: color.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tooltipEmptyText: { color: color.textFaint, fontSize: 11 },
    tooltipBody: { padding: space.sm },
    tooltipName: {
      color: color.text,
      fontSize: type.label,
      fontWeight: weight.bold,
    },
    tooltipTimes: { color: color.accent, fontSize: 11, marginTop: 2 },
    tooltipNotes: {
      color: color.textMuted,
      fontSize: 11,
      marginTop: space.xs,
      lineHeight: 15,
    },

    dimButton: {
      position: 'absolute',
      top: space.md,
      left: space.md,
      width: 52,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
    },
    dimButtonActive: { backgroundColor: color.accent, borderColor: color.accent },
    dimButtonPressed: { opacity: 0.7 },
    dimLabel: {
      color: color.textMuted,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    dimLabelActive: { color: color.onAccent },

    terrainNote: {
      position: 'absolute',
      top: space.md + 60,
      right: space.md,
      maxWidth: 190,
      backgroundColor: 'rgba(11,13,16,0.85)',
      borderRadius: radius.sm,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
    },
    terrainNoteText: { color: color.textFaint, fontSize: 11, lineHeight: 15 },

    controls: {
      position: 'absolute',
      left: space.md,
      gap: space.xs,
    },
    controlRow: { flexDirection: 'row', gap: space.xs },
    control: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      backgroundColor: 'rgba(22,26,32,0.92)',
      borderWidth: 1,
      borderColor: color.border,
    },
    controlWide: { width: 44 * 2 + space.xs },
    controlPressed: { backgroundColor: color.accent },
    controlLabel: {
      color: color.text,
      fontSize: 18,
      fontWeight: weight.bold,
      lineHeight: 22,
    },

    error: {
      position: 'absolute',
      left: space.md,
      right: space.md,
      bottom: space.xl,
      backgroundColor: color.surfaceRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.accent,
      padding: space.md,
    },
    errorTitle: {
      color: color.accent,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    errorBody: { color: color.text, fontSize: type.label, marginTop: space.xs },
    errorHint: {
      color: color.textFaint,
      fontSize: type.label,
      marginTop: space.xs,
    },
  });
}
