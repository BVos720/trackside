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
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Asset } from 'expo-asset';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  ViewAnnotation,
} from '@maplibre/maplibre-react-native';

import { color, radius, space, type, weight } from '../theme';
import CircuitRuler from '../map/CircuitRuler';
import {
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
const TILE_ASSETS: Record<VenueKey, number> = {
  nordschleife: require('../../../assets/tiles/nordschleife.pmtiles'),
  'le-mans': require('../../../assets/tiles/le-mans.pmtiles'),
  zolder: require('../../../assets/tiles/zolder.pmtiles'),
  'spa-francorchamps': require('../../../assets/tiles/spa-francorchamps.pmtiles'),
  zandvoort: require('../../../assets/tiles/zandvoort.pmtiles'),
};

/** Matches the web screen — below this, callouts would overlap unreadably. */
const CALLOUT_MIN_ZOOM = 13;
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
}: {
  venue?: VenueKey;
  spots?: unknown;
  mediaUris?: Record<string, string>;
  onMapTap?: (lngLat: { latitude: number; longitude: number }) => void;
  onSpotTap?: (id: string) => void;
  placing?: boolean;
  /**
   * The navigation route, as a FeatureCollection of legs.
   *
   * Each feature carries `kind`: 'network' for extracted ways, 'direct' for a
   * straight line across ground we have no path for.
   */
  route?: unknown;
  /** Live position, when navigating. */
  here?: { latitude: number; longitude: number } | null;
}) {
  const [tilesUri, setTilesUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(VENUE_VIEW[venue].zoom);

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

  const shape = useMemo(
    () => spots ?? { type: 'FeatureCollection', features: [] },
    [spots],
  );

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
          ) as never),
    [tilesUri, venue],
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

  if (tilesUri === null || mapStyle === null) {
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
      <Map
        style={styles.map}
        mapStyle={mapStyle}
        // MapLibre's own attribution control satisfies the visible-attribution
        // obligation in spec §8 without hand-rolling one.
        attribution
        logo={false}
        // Milestone 1 is flat 2D (spec §6). Rotation and pitch belong to the
        // §5.10 camera modes, and leaving them on now means a gloved hand can
        // knock the map into a tilted state with no way back.
        touchRotate={false}
        touchPitch={false}
        onPress={(e) => {
          if (!placing) return;
          const c = (e.nativeEvent as { coordinates?: [number, number] })
            .coordinates;
          if (!c) return;
          // Snapping to the verge happens in the shell, which owns the circuit
          // geometry — the same path the web screen takes.
          onMapTap?.({ longitude: c[0], latitude: c[1] });
        }}
        // Fires once the camera settles. Zoom gates the callouts, and reading
        // it on every intermediate frame would re-render the whole set mid-pan.
        onRegionDidChange={(e) => {
          const z = e.nativeEvent?.zoom;
          if (typeof z === 'number') setZoom(z);
        }}
      >
        <Camera
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
        <GeoJSONSource
          id={SPOTS_SOURCE}
          data={shape as never}
          onPress={(e) => {
            const f = (e as { features?: SpotFeature[] }).features?.[0];
            const id = f?.properties?.id;
            if (typeof id === 'string') onSpotTap?.(id);
          }}
        >
          <Layer
            id="spot-halo"
            type="circle"
            style={{
              circleRadius: 12,
              circleColor: color.accent,
              circleOpacity: 0.22,
            }}
          />
          <Layer
            id="spot-pin"
            type="circle"
            style={{
              circleRadius: 6,
              circleColor: color.accent,
              circleStrokeColor: color.background,
              circleStrokeWidth: 2,
            }}
          />
        </GeoJSONSource>

        {/*
          The route, drawn above the spots so the line reads over the pins it
          connects. Network legs solid, direct legs dashed: a dashed line means
          "no path here, this is a bearing", and drawing it like a footpath
          would claim knowledge the data does not have.
        */}
        {route != null && (
          <GeoJSONSource id="nav-route" data={route as never}>
            <Layer
              id="nav-route-network"
              type="line"
              filter={['==', ['get', 'kind'], 'network'] as never}
              style={{
                lineColor: color.accent,
                lineWidth: 5,
                lineOpacity: 0.9,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <Layer
              id="nav-route-direct"
              type="line"
              filter={['==', ['get', 'kind'], 'direct'] as never}
              style={{
                lineColor: color.accent,
                lineWidth: 4,
                lineOpacity: 0.8,
                lineDasharray: [1.5, 1.5],
                lineCap: 'round',
              }}
            />
          </GeoJSONSource>
        )}

        {here && (
          <GeoJSONSource
            id="nav-here"
            data={
              {
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    properties: {},
                    geometry: {
                      type: 'Point',
                      coordinates: [here.longitude, here.latitude],
                    },
                  },
                ],
              } as never
            }
          >
            <Layer
              id="nav-here-dot"
              type="circle"
              style={{
                circleRadius: 7,
                circleColor: color.text,
                circleStrokeColor: color.accent,
                circleStrokeWidth: 3,
              }}
            />
          </GeoJSONSource>
        )}

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
                    <Image source={{ uri }} style={styles.calloutImage} />
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

      <CircuitRuler venue={venue} />

      {/* No venue badge: the top-left menu trigger carries the circuit and
          active event, and both sat in the same corner. */}

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  map: { flex: 1 },

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
