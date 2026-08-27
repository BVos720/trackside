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
import {
  REMOTE_GLYPHS_URL,
  TERRAIN_SOURCE,
  VENUE_VIEW,
  buildMapStyle,
  type VenueKey,
} from '../map/style';
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

/**
 * The style document, as a string, for the venue actually shown.
 *
 * Scenery is off. The woodland scatter is 1.26MB of the 2.4MB total and it is
 * the least of what Branco asked for — circuit, paths, buildings — so it stays
 * out until the rest is proven. Turning it back on is one argument.
 */
function buildStyleJson(venue: VenueKey): string {
  const shown = (FLAT_VENUES.has(venue) ? 'nordschleife' : venue) as VenueKey;
  return JSON.stringify(
    buildMapStyle('bundled', shown, undefined, false, true, REMOTE_GLYPHS_URL, false),
  );
}

function buildHtml(venue: VenueKey, archiveUrl: string): string {
  const useVenue = !FLAT_VENUES.has(venue);
  const shown = (useVenue ? venue : 'nordschleife') as VenueKey;
  const view = VENUE_VIEW[shown];
  const [lon, lat] = view.centre;
  // Close enough to read the circuit, far enough that relief still shows.
  const zoom = 13.2;

  /*
   * The whole style, serialised into the page.
   *
   * 'bundled' is the pmtiles key registered on the page, so the style's own
   * `pmtiles://bundled` resolves to the in-memory archive. Glyphs come over
   * the network for now — bundling them is the same job as the native app's
   * `npm run glyphs` and is not what this is testing.
   *
   * `omitSpots` is false: the spots source belongs in the document here,
   * because there is no native <GeoJSONSource> to declare it separately.
   * `terrain3d` is true so the 3D layers exist to be switched on.
   */
  // Computed by the caller now and sent in chunks — see buildStyleJson.

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

      /*
       * Straight to the bridge.
       *
       * The fetch-off-disk attempt is gone with the props that were meant to
       * permit it. It was the cheaper route, not the necessary one, and it is
       * worth re-trying only once there is a working map to compare against.
       */
      function loadArchive() {
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
      }

      /*
       * The real style, not a stand-in.
       *
       * 'buildMapStyle' already produces the whole document — circuit, paths,
       * buildings, the corridor mask, the woodland scatter — and the web build
       * hands exactly this to maplibre-gl. So the spike does too, rather than
       * approximating it: anything else would test something we are not going
       * to ship.
       *
       * Two substitutions. The tile URL is 'bundled', which is the key the
       * pmtiles protocol was registered under above, so the style's
       * 'pmtiles://bundled' resolves to the archive in memory. And terrain is
       * attached after load with setTerrain rather than through the style,
       * because the 'terrain' key was removed from buildMapStyle — native
       * cannot read it, and here it is set imperatively exactly as
       * MapScreen.web.tsx does.
       */
      /*
       * The style arrives after the page is alive, in pieces.
       *
       * It used to be baked into this HTML, and that was the reason nothing
       * happened at all: buildMapStyle inlines every GeoJSON the map needs —
       * 1.26MB of tree points, 430KB of paths, 320KB of buildings — so the
       * document handed to loadHTMLString was about 2.5MB. Thirty seconds
       * later the page had still not run its first line.
       *
       * Bulk data does not belong in a document. It comes across in chunks
       * now, which also means the page can report that it is alive *before*
       * any of it arrives — the thing that was missing when this hung.
       */
      var styleParts = [];
      window.__stylePart = function (part) { styleParts.push(part); };
      window.__styleDone = function () {
        var began = Date.now();
        var text = styleParts.join('');
        styleParts = [];
        var style;
        try {
          style = JSON.parse(text);
        } catch (e) {
          return fail('style-parse', e);
        }
        post({ stage: 'style-received', bytes: text.length, ms: Date.now() - began });
        buildMapWithStyle(style);
      };

      post({ stage: 'awaiting-style' });

      function buildMapWithStyle(style) {
      var map = new maplibregl.Map({
        container: 'map',
        style: style,
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
          /*
           * The style already declares the DEM source, so this only attaches
           * the mesh — and it is the same call, on the same source, that the
           * web build makes.
           *
           * 1.4, not the spike's earlier 2.0: this is meant to look like the
           * map now rather than prove a point, and the web build's own
           * exaggeration is the value that has already been judged by eye.
           */
          map.setTerrain({ source: '${TERRAIN_SOURCE}', exaggeration: 1.4 });
          post({ stage: 'terrain-set' });

          // The 3D layers are hidden by default in the style — the same
          // visibility switch the native screen drives from its 2D/3D button.
          ['terrain-hillshade', 'buildings-3d', 'trees', 'ground-detail'].forEach(function (id) {
            try { map.setLayoutProperty(id, 'visibility', 'visible'); } catch (e) {}
          });
          post({ stage: '3d-layers-shown' });
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
      } // end buildMapWithStyle
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

  /*
   * Say something if the page says nothing.
   *
   * Twice now the answer has been an empty panel, which is the least useful
   * result there is — it cannot be told apart from a screen that has not
   * finished starting. Eight seconds of silence is a finding, and it should
   * read as one.
   */
  useEffect(() => {
    const id = setTimeout(() => {
      setLog((prev) =>
        prev.length === 0
          ? ['no message from the page after 8s — it is not running at all']
          : prev,
      );
    }, 8000);
    return () => clearTimeout(id);
  }, []);

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
  /**
   * Push the style across in chunks.
   *
   * 64KB at a time: one injectJavaScript call carrying a megabyte of string
   * is the same mistake as putting it in the document, just later. Chunking
   * also means a failure part-way is visible in the log rather than silent.
   */
  const sendStyle = () => {
    try {
      const json = buildStyleJson(venue);
      const CHUNK = 64 * 1024;
      note(`style: ${Math.round(json.length / 1024)}KB in ${Math.ceil(json.length / CHUNK)} chunks`);

      for (let i = 0; i < json.length; i += CHUNK) {
        const part = json
          .slice(i, i + CHUNK)
          // The chunk is injected inside a JS string literal, so anything that
          // could close it early has to go — including the line separators
          // JSON leaves alone but JavaScript treats as newlines.
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\u2028/g, '\\u2028')
          .replace(/\u2029/g, '\\u2029');
        webRef.current?.injectJavaScript(`window.__stylePart("${part}"); true;`);
      }
      webRef.current?.injectJavaScript('window.__styleDone(); true;');
    } catch (e) {
      note(`style send failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  };

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
         * No file-access props, and `allowingReadAccessToURL` in particular.
         *
         * They were added for the fetch-off-disk path and the page stopped
         * loading entirely at the same moment — thirty seconds with not one
         * message, before *and* after the document shrank from 2.4MB to 10KB,
         * which rules the payload out. On iOS that prop changes which
         * WKWebView load method is used, and combining it with an `html`
         * source is the kind of thing that quietly loads nothing.
         *
         * They are not needed anyway. Reading the archive off disk was only
         * ever the cheaper of two routes, and the bridge is the one that is
         * certain to work.
         */
        onLoadStart={() => note('webview: load started')}
        onLoad={() => note('webview: loaded')}
        onHttpError={(e: { nativeEvent: { statusCode?: number } }) =>
          note(`webview: HTTP ${e.nativeEvent.statusCode ?? '?'}`)
        }
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
            if (m.stage === 'awaiting-style') sendStyle();
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
