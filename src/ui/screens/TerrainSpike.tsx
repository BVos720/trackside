/**
 * A throwaway: does a WebView render a terrain map on this phone?
 *
 * ── What this is for ──────────────────────────────────────────────────────
 * `maplibre-react-native` cannot draw a terrain mesh, but `maplibre-gl` — the
 * web library — can, and the web build already uses it (`MapScreen.web.tsx`
 * calls `setTerrain()`). The idea under test is whether that same library,
 * hosted in a WebView, can give the phone a real landscape.
 *
 * Before any of that is worth building, one thing has to be true: a WebView on
 * this device must load a remote script, get a WebGL context, and pan at a
 * usable frame rate. That is not obvious here — the PDF bridge in
 * `storage-local/pdfBridge.tsx` is a WebView and it has never worked on this
 * iPhone across two attempts, for reasons still unproven. If WebView is broken
 * in this build, the whole approach dies, and it should die in an afternoon
 * rather than on day three.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 * Nothing offline. The library comes from a CDN and the elevation from AWS,
 * because this is testing whether the *renderer* works, not whether assets can
 * be delivered. Getting a 5MB pmtiles archive into a WebView with no signal is
 * the real engineering, and there is no point starting it until this answers.
 *
 * So: needs a connection, proves nothing about §1.4, and is reached only from
 * the developer section. If the approach is adopted this file is replaced; if
 * it is not, this file is deleted. Either way it does not survive.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PDF_BRIDGE_SUPPORTED } from '../../storage-local/pdfBridge';
import { VENUE_VIEW, type VenueKey } from '../map/style';

/*
 * The same lazy require the PDF bridge uses.
 *
 * A top-level import of react-native-webview once killed the app at launch —
 * `TurboModuleRegistry.getEnforcing('RNCWebViewModule')` throws at module load
 * when the native module is absent, which takes the whole bundle with it. That
 * is exactly the failure this screen exists to detect, so it must not be the
 * failure this screen causes.
 */
let WebViewComponent: React.ComponentType<Record<string, unknown>> | null = null;
try {
  const mod = require('react-native-webview') as {
    WebView: React.ComponentType<Record<string, unknown>>;
  };
  WebViewComponent = mod.WebView;
} catch {
  WebViewComponent = null;
}

/** Terrarium DEM, the same endpoint the hillshading and terrainCache use. */
const TERRAIN_TILES =
  'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';

/**
 * Where to point the test.
 *
 * The venue, unless the venue is flat. Zolder has about forty metres of relief
 * and Zandvoort is dunes — at either, a perfectly working mesh looks like
 * nothing at all, which is exactly how the first run wasted a build.
 *
 * The Nordschleife is the honest local test: three hundred metres of Eifel,
 * and the circuit Branco actually knows, so "does that look right" is a
 * question he can answer rather than guess at.
 */
const FLAT_VENUES = new Set<VenueKey>(['zolder', 'zandvoort', 'suzuka', 'le-mans']);

function buildHtml(venue: VenueKey): string {
  const useVenue = !FLAT_VENUES.has(venue);
  const view = VENUE_VIEW[useVenue ? venue : ('nordschleife' as VenueKey)];
  const [lon, lat] = view.centre;
  // Pulled back a little: relief reads at a distance, not from inside a corner.
  const zoom = 12.5;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link href="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    html, body, #map { margin: 0; padding: 0; height: 100%; background: #0B0D10; }
    #err {
      position: absolute; left: 0; right: 0; top: 0; padding: 12px;
      font: 12px/1.4 -apple-system, sans-serif; color: #F2F5F8;
      background: rgba(180,60,60,0.95); display: none; white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="err"></div>
  <script src="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js"></script>
  <script>
    var post = function (payload) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    };

    var fail = function (stage, e) {
      var msg = String((e && (e.message || e)) || 'unknown');
      document.getElementById('err').style.display = 'block';
      document.getElementById('err').textContent = stage + ': ' + msg;
      post({ stage: stage, error: msg });
    };

    window.onerror = function (m) { fail('window.onerror', m); };

    try {
      post({ stage: 'script-ran' });

      if (!window.maplibregl) throw new Error('maplibre-gl did not load from the CDN');
      post({ stage: 'library-loaded', version: maplibregl.getVersion ? maplibregl.getVersion() : '?' });

      // v5 removed maplibregl.supported(), so its absence says nothing. Ask
      // the browser directly instead — the first run reported
      // "webgl-unsupported" purely because the helper had been deleted, while
      // the map rendered fine at 38fps.
      var probe = document.createElement('canvas');
      var gl = probe.getContext('webgl2') || probe.getContext('webgl');
      post({ stage: gl ? 'webgl-ok' : 'webgl-MISSING' });

      /*
       * An empty style plus hillshading, rather than a basemap.
       *
       * The first run used MapLibre's demotiles, which is a country-outline
       * demo with nothing at all at zoom 13 — so the screen was a flat beige
       * field and the terrain could have been working perfectly without
       * showing it. Zolder did not help either: forty metres of relief in
       * Belgium is invisible however good the mesh is.
       *
       * Hillshading from the same DEM makes the landform itself the picture,
       * so there is nothing to confuse a working mesh with a missing basemap.
       */
      var map = new maplibregl.Map({
        container: 'map',
        style: {
          version: 8,
          sources: {
            dem: {
              type: 'raster-dem',
              tiles: ['${TERRAIN_TILES}'],
              encoding: 'terrarium',
              tileSize: 256,
              maxzoom: 14
            }
          },
          layers: [
            { id: 'sky-bg', type: 'background', paint: { 'background-color': '#0B0D10' } },
            {
              id: 'shade',
              type: 'hillshade',
              source: 'dem',
              paint: {
                'hillshade-exaggeration': 0.9,
                'hillshade-shadow-color': '#05070A',
                'hillshade-highlight-color': '#8FA3B8',
                'hillshade-accent-color': '#1A222C'
              }
            }
          ]
        },
        center: [${lon}, ${lat}],
        zoom: ${zoom},
        pitch: 70,
        bearing: 20,
        attributionControl: false
      });

      map.on('error', function (e) { fail('map.error', e && e.error); });

      map.on('load', function () {
        post({ stage: 'map-loaded' });
        try {
          // The source is declared in the style above, so this only attaches
          // the mesh. Exaggeration is high on purpose: this is a yes/no test,
          // not a finished look.
          map.setTerrain({ source: 'dem', exaggeration: 2.0 });
          post({ stage: 'terrain-set' });
        } catch (e) { fail('setTerrain', e); }
      });

      // One frame after the first idle is the honest moment to say it works:
      // the style is loaded, the terrain is attached, and something is on screen.
      map.on('idle', function () { post({ stage: 'idle' }); });

      // Rough frame timing while the user drags, which is the question that
      // decides whether this is usable rather than merely possible.
      var frames = 0, since = Date.now();
      map.on('move', function () {
        frames++;
        var elapsed = Date.now() - since;
        if (elapsed >= 1000) {
          post({ stage: 'fps', fps: Math.round((frames * 1000) / elapsed) });
          frames = 0; since = Date.now();
        }
      });
    } catch (e) {
      fail('setup', e);
    }
  </script>
</body>
</html>`;
}

export default function TerrainSpike({
  venue,
  onClose,
}: {
  venue: VenueKey;
  onClose: () => void;
}) {
  const [log, setLog] = useState<string[]>([]);
  const [fps, setFps] = useState<number | null>(null);

  const note = (line: string) =>
    setLog((prev) => (prev.length > 12 ? [...prev.slice(1), line] : [...prev, line]));

  if (!PDF_BRIDGE_SUPPORTED || WebViewComponent === null) {
    return (
      <View style={styles.centre}>
        <Text style={styles.title}>No WebView in this build</Text>
        <Text style={styles.body}>
          react-native-webview&apos;s native module is not present, so this
          approach cannot work at all here. That is the answer — no further
          testing needed.
        </Text>
        <Pressable onPress={onClose} style={styles.button}>
          <Text style={styles.buttonLabel}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const WebView = WebViewComponent;

  return (
    <View style={styles.root}>
      <WebView
        source={{ html: buildHtml(venue), baseUrl: 'https://trackside.invalid/' }}
        originWhitelist={['*']}
        style={styles.web}
        // The library and the DEM both come over the network here. See the
        // header: this tests the renderer, not offline delivery.
        javaScriptEnabled
        domStorageEnabled
        onMessage={(e: { nativeEvent: { data: string } }) => {
          try {
            const m = JSON.parse(e.nativeEvent.data) as {
              stage?: string;
              error?: string;
              fps?: number;
              version?: string;
            };
            if (typeof m.fps === 'number') {
              setFps(m.fps);
              return;
            }
            note(
              `${m.stage ?? '?'}${m.version ? ' v' + m.version : ''}` +
                (m.error ? ` — ${m.error}` : ''),
            );
          } catch {
            note('unreadable message');
          }
        }}
        onError={(e: { nativeEvent: { description?: string } }) =>
          note(`webview error — ${e.nativeEvent.description ?? 'unknown'}`)
        }
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>
            TERRAIN SPIKE{fps !== null ? ` · ${fps} fps` : ''}
          </Text>
          {log.length === 0 ? (
            <View style={styles.waiting}>
              <ActivityIndicator color="#F2F5F8" />
              <Text style={styles.body}>Waiting for the page…</Text>
            </View>
          ) : (
            log.map((l, i) => (
              <Text key={i} style={styles.logLine} selectable>
                {l}
              </Text>
            ))
          )}
        </View>

        <Pressable onPress={onClose} style={styles.button}>
          <Text style={styles.buttonLabel}>Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* Fixed colours: this is a diagnostic, and it must render even if the theme is
   part of what is broken. Same reasoning as ErrorBoundary. */
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0D10' },
  web: { flex: 1, backgroundColor: '#0B0D10' },
  centre: { flex: 1, backgroundColor: '#0B0D10', padding: 24, justifyContent: 'center' },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12 },
  panel: {
    backgroundColor: 'rgba(11,13,16,0.92)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A313B',
    padding: 10,
  },
  panelTitle: {
    color: '#6C9AE0',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logLine: { color: '#F2F5F8', fontFamily: 'Courier', fontSize: 11, lineHeight: 15 },
  title: { color: '#F2F5F8', fontSize: 20, fontWeight: '700' },
  body: { color: '#9AA5B1', fontSize: 13, lineHeight: 19, marginTop: 8 },
  button: {
    marginTop: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A313B',
    backgroundColor: 'rgba(11,13,16,0.92)',
  },
  buttonLabel: { color: '#F2F5F8', fontSize: 15, fontWeight: '700' },
});
