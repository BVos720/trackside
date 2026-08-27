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
 *
 * ── Day 2: can the page read our own basemap? ─────────────────────────────
 * Day 1 passed — 56fps, a real mesh, elevation 1201m at the Nordschleife. The
 * question now is delivery, and it is the harder one.
 *
 * The basemap is a 3–7MB `.pmtiles` archive in the app bundle. pmtiles is
 * normally read with HTTP **range requests**, and `file://` has no range
 * semantics — so the usual route is closed before it starts. Two ways round it,
 * tried in order because the first is dramatically better if it works:
 *
 *   1. Fetch the whole archive once, as a plain GET with no Range header, and
 *      serve pmtiles from an in-memory buffer. Its `Source` interface is two
 *      methods, so a buffer-backed source is a handful of lines. Nothing
 *      crosses the React Native bridge.
 *
 *   2. Read the file on the native side and hand the bytes over as base64.
 *      Certain to work, but 4.5MB becomes a 6MB string through a bridge that
 *      was not built for it.
 *
 * Whichever succeeds, the page then renders the *real* style rather than a
 * demo one — which is also the honest performance test, since 56fps was a bare
 * hillshade and the real document carries the circuit, the corridor mask,
 * buildings and up to 14k tree points.
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PDF_BRIDGE_SUPPORTED } from '../../storage-local/pdfBridge';
import { VENUE_VIEW, type VenueKey } from '../map/style';
import { TILE_ASSETS } from './MapScreen';

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

function buildHtml(venue: VenueKey, archiveUrl: string): string {
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
  <script src="https://unpkg.com/pmtiles@4.5.0/dist/pmtiles.js"></script>
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
       * Load our own archive before building the map.
       *
       * Reported either way: which route worked, how long it took, and how
       * many bytes arrived. A silent fallback would hide the answer this whole
       * screen exists to produce.
       */
      var ARCHIVE_URL = '${archiveUrl}';

      function bufferSource(buffer) {
        // pmtiles' Source is two methods. Ranges become slices, which is the
        // entire trick: no HTTP, no partial requests, no file:// semantics.
        return {
          getKey: function () { return 'bundled'; },
          getBytes: function (offset, length) {
            return Promise.resolve({ data: buffer.slice(offset, offset + length) });
          }
        };
      }

      function loadArchive() {
        var started = Date.now();
        return fetch(ARCHIVE_URL)
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.arrayBuffer();
          })
          .then(function (buf) {
            post({
              stage: 'archive-via-fetch',
              bytes: buf.byteLength,
              ms: Date.now() - started
            });
            return buf;
          })
          .catch(function (e) {
            post({ stage: 'archive-fetch-failed', error: String(e && e.message || e) });
            // The native side is watching for this and will inject the bytes.
            return new Promise(function (resolve) {
              window.__acceptArchive = function (base64) {
                var began = Date.now();
                var bin = atob(base64);
                var bytes = new Uint8Array(bin.length);
                for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                post({
                  stage: 'archive-via-bridge',
                  bytes: bytes.byteLength,
                  ms: Date.now() - began
                });
                resolve(bytes.buffer);
              };
              post({ stage: 'awaiting-bridge' });
            });
          });
      }

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
      if (!window.pmtiles) throw new Error('pmtiles did not load from the CDN');
      post({ stage: 'pmtiles-loaded' });

      loadArchive().then(function (buffer) {
        buildMap(buffer);
      }).catch(function (e) { fail('archive', e); });

      function buildMap(buffer) {
      var archive = new pmtiles.PMTiles(bufferSource(buffer));
      var protocol = new pmtiles.Protocol();
      protocol.add(archive);
      maplibregl.addProtocol('pmtiles', protocol.tile);
      post({ stage: 'protocol-registered' });

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
            },
            // Our own archive, read from memory. If this draws, the offline
            // half of the problem is solved.
            base: { type: 'vector', url: 'pmtiles://bundled' }
          },
          layers: [
            { id: 'sky-bg', type: 'background', paint: { 'background-color': '#0B0D10' } },
            {
              id: 'land',
              type: 'fill',
              source: 'base',
              'source-layer': 'landuse',
              paint: { 'fill-color': '#16241C', 'fill-opacity': 0.7 }
            },
            {
              id: 'roads',
              type: 'line',
              source: 'base',
              'source-layer': 'roads',
              paint: { 'line-color': '#4A5361', 'line-width': 1.2 }
            },
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

      /*
       * Is the elevation data actually arriving?
       *
       * "terrain-set" only means setTerrain() did not throw. The Nordschleife
       * came back flat with that stage reported, so the call being accepted
       * says nothing about whether a mesh exists. These three probes separate
       * the possibilities, and they answer different questions:
       *
       *   dem-fetch    can this page reach the DEM endpoint at all? A WebView
       *                on a made-up origin (trackside.invalid) has to satisfy
       *                CORS like anything else, and a blocked fetch here would
       *                leave both the mesh and the hillshading empty — which
       *                is exactly what a flat dark screen looks like.
       *
       *   terrain-attached  does the map agree it has terrain, a moment later?
       *
       *   elevation    the decisive one. queryTerrainElevation returns metres
       *                at a point. The Nordschleife sits around 600m, so a
       *                number near that means the mesh has real data and the
       *                problem is how it is being drawn. Null or zero means
       *                the data never arrived, which is a different bug
       *                entirely.
       */
      fetch('https://elevation-tiles-prod.s3.amazonaws.com/terrarium/12/2133/1377.png')
        .then(function (r) { return r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (b) { post({ stage: 'dem-fetch', bytes: b.byteLength }); })
        .catch(function (e) { post({ stage: 'dem-fetch', error: String(e && e.message || e) }); });

      var probed = false;
      map.on('idle', function () {
        post({ stage: 'idle' });
        if (probed) return;
        probed = true;

        try {
          post({ stage: 'terrain-attached', attached: !!map.getTerrain() });
        } catch (e) {
          post({ stage: 'terrain-attached', error: String(e && e.message || e) });
        }

        try {
          if (typeof map.queryTerrainElevation === 'function') {
            var m = map.queryTerrainElevation(map.getCenter());
            post({ stage: 'elevation', metres: m === null || m === undefined ? null : Math.round(m) });
          } else {
            post({ stage: 'elevation', error: 'queryTerrainElevation missing' });
          }
        } catch (e) {
          post({ stage: 'elevation', error: String(e && e.message || e) });
        }

        post({ stage: 'pitch', pitch: Math.round(map.getPitch()) });
      });
      } // end buildMap

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

  /**
   * Where the bundled archive lives on disk, once unpacked.
   *
   * Null until it is known, and the WebView is not rendered before then —
   * building the page without a URL would only test the fallback.
   */
  const [archiveUrl, setArchiveUrl] = useState<string | null>(null);
  const webRef = useRef<{ injectJavaScript: (js: string) => void } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const asset = Asset.fromModule(TILE_ASSETS[venue]);
        await asset.downloadAsync();
        setArchiveUrl(asset.localUri ?? asset.uri ?? '');
      } catch {
        // An empty URL still builds a page; its fetch fails and the bridge
        // path takes over, which is a result rather than a dead end.
        setArchiveUrl('');
      }
    })();
  }, [venue]);

  /**
   * Hand the archive over as base64, when the page could not read it itself.
   *
   * The expensive path, and the one that is certain to work: 4.5MB of
   * Nordschleife becomes about 6MB of string crossing a bridge not built for
   * it. Worth measuring rather than assuming — if this is the only route that
   * works, how long it takes decides whether the whole approach is usable.
   */
  const sendArchiveOverBridge = async () => {
    if (archiveUrl === null || archiveUrl === '') {
      note('bridge: no archive path to read');
      return;
    }
    try {
      const began = Date.now();
      const base64 = await new File(archiveUrl).base64();
      note(`bridge: read ${Math.round(base64.length / 1024)}KB in ${Date.now() - began}ms`);
      webRef.current?.injectJavaScript(
        `window.__acceptArchive && window.__acceptArchive("${base64}"); true;`,
      );
    } catch (e) {
      note(`bridge read failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  };

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

  if (archiveUrl === null) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color="#F2F5F8" />
        <Text style={styles.body}>Unpacking the basemap…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <WebView
        ref={webRef as never}
        source={{ html: buildHtml(venue, archiveUrl), baseUrl: 'https://trackside.invalid/' }}
        /*
         * File access, for the good path.
         *
         * The page tries to fetch the archive off disk before falling back to
         * the bridge. Whether a page on an https origin may read a file:// URL
         * is exactly what is being tested — these props are what make it
         * possible at all, not what make it certain.
         */
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        allowingReadAccessToURL={archiveUrl}
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
              bytes?: number;
              attached?: boolean;
              metres?: number | null;
              pitch?: number;
            };
            if (typeof m.fps === 'number') {
              setFps(m.fps);
              return;
            }
            const extra = [
              m.version ? 'v' + m.version : null,
              typeof m.bytes === 'number' ? m.bytes + ' bytes' : null,
              typeof m.attached === 'boolean' ? (m.attached ? 'yes' : 'NO') : null,
              m.metres !== undefined ? (m.metres === null ? 'null' : m.metres + ' m') : null,
              typeof m.pitch === 'number' ? m.pitch + '°' : null,
            ]
              .filter(Boolean)
              .join(' ');

            note(
              `${m.stage ?? '?'}${extra ? ' ' + extra : ''}` +
                (m.error ? ` — ${m.error}` : ''),
            );

            // The page could not read the file itself. Send it across.
            if (m.stage === 'awaiting-bridge') void sendArchiveOverBridge();
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
