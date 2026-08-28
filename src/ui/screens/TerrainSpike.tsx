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
  /*
   * The venue you are on, not a substitute for it.
   *
   * The spike redirected flat circuits to the Nordschleife so a working mesh
   * would be visible while it was still in doubt. That is over — it works —
   * and standing at Zolder while the screen shows the Eifel would now be a
   * bug rather than a diagnostic.
   */
  const shown = venue;
  const view = VENUE_VIEW[shown];
  const [lon, lat] = view.centre;
  // Close enough to read the circuit, far enough that relief still shows.
  const zoom = 13.2;

  /*
   * Straight from VenueView, so the two maps cannot drift apart.
   *
   * `bounds` is the tile extract area — the region the bundled archive
   * actually has data for — which is why it is the right limit rather than
   * a made-up margin around the circuit.
   */
  const minZoom = view.minZoom;
  const maxZoom = view.maxZoom;
  const maxBounds = JSON.stringify([
    [view.bounds[0][0], view.bounds[0][1]],
    [view.bounds[1][0], view.bounds[1][1]],
  ]);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link href="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    html, body, #map { margin: 0; padding: 0; height: 100%; background: #0B0D10; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js"></script>
  <script src="https://unpkg.com/pmtiles@4.5.0/dist/pmtiles.js"></script>
  <script>
    var post = function (p) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(p));
    };
    var fail = function (stage, e) {
      post({ stage: stage, error: String((e && (e.message || e)) || "unknown") });
    };
    window.onerror = function (m, s, l, c) { fail("window.onerror", m + " @" + l + ":" + c); };

    post({ stage: "script-ran" });

    /*
      Spots arrive whenever they change, before or after the map exists.

      Held on window so a set that lands early is picked up when the layer is
      created, and pushed straight to the source when it lands late. Without
      that, editing a spot while the map was still loading would silently do
      nothing.
    */
    var emptySpots = { type: "FeatureCollection", features: [] };

    /*
      Where you are, and where you are going.

      Same shape as the spots channel and for the same reason: both change
      constantly — a position fix every second or so, a route on every fix —
      and neither should rebuild the style. Held on window so a value that
      arrives before the map exists is picked up when the layers are made.
    */
    /*
      One spot picked out of a stack.

      Everything else dims rather than disappearing. A spot that vanished
      would be a claim it is not there; dimming says "these too, just not
      the one you asked about", which is what the map actually knows.

      Paint expressions rather than a filter, for the same reason.
    */
    window.__highlight = null;
    window.__setHighlight = function (id) {
      window.__highlight = id || null;
      if (!window.__map || !window.__map.getLayer("spot-pin")) return;
      var m = window.__map;
      var lit = window.__highlight;

      var dim = lit === null
        ? 1
        : ["case", ["==", ["get", "id"], lit], 1, 0.25];
      var ring = lit === null
        ? "#0B0D10"
        : ["case", ["==", ["get", "id"], lit], "#F2F5F8", "#0B0D10"];
      var size = lit === null
        ? 6
        : ["case", ["==", ["get", "id"], lit], 9, 5];

      m.setPaintProperty("spot-pin", "circle-opacity", dim);
      m.setPaintProperty("spot-pin", "circle-stroke-color", ring);
      m.setPaintProperty("spot-pin", "circle-radius", size);
      m.setPaintProperty("spot-halo", "circle-opacity",
        lit === null ? 0.22 : ["case", ["==", ["get", "id"], lit], 0.35, 0.06]);
    };

    window.__here = emptySpots;
    window.__route = emptySpots;
    window.__setNav = function (json) {
      try {
        var nav = JSON.parse(json);
        window.__here = nav.here || emptySpots;
        window.__route = nav.route || emptySpots;
        if (window.__map) {
          var h = window.__map.getSource("nav-here");
          var r = window.__map.getSource("nav-route");
          if (h) h.setData(window.__here);
          if (r) r.setData(window.__route);
        }
      } catch (e) { fail("nav-parse", e); }
    };
    window.__spots = emptySpots;
    window.__setSpots = function (json) {
      try {
        window.__spots = JSON.parse(json);
        if (window.__map && window.__map.getSource("spots")) {
          window.__map.getSource("spots").setData(window.__spots);
        }
      } catch (e) { fail("spots-parse", e); }
    };

    /*
      Two things have to arrive before a map can be built: the basemap
      archive and the style. Both come from the native side, independently
      and in no fixed order, so each is a promise and the map waits on both.

      Sequencing them would have been simpler and wrong: whichever went
      second would sit behind the first for no reason, and a failure in one
      would look like silence from the other.
    */
    var archiveReady = new Promise(function (resolve) {
      window.__acceptArchive = function (base64) {
        var began = Date.now();
        var bin = atob(base64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        post({ stage: "archive-received", bytes: bytes.byteLength, ms: Date.now() - began });
        resolve(bytes.buffer);
      };
    });

    var styleParts = [];
    var styleReady = new Promise(function (resolve) {
      window.__stylePart = function (part) { styleParts.push(part); };
      window.__styleDone = function () {
        var began = Date.now();
        var text = styleParts.join("");
        styleParts = [];
        try {
          var parsed = JSON.parse(text);
          post({ stage: "style-received", bytes: text.length, ms: Date.now() - began });
          resolve(parsed);
        } catch (e) {
          fail("style-parse", e);
        }
      };
    });

    try {
      if (!window.maplibregl) throw new Error("maplibre-gl did not load");
      post({ stage: "library-loaded", version: maplibregl.getVersion ? maplibregl.getVersion() : "?" });
      if (!window.pmtiles) throw new Error("pmtiles did not load");
      post({ stage: "pmtiles-loaded" });

      // v5 removed maplibregl.supported(), so ask the browser directly.
      var probe = document.createElement("canvas");
      post({ stage: (probe.getContext("webgl2") || probe.getContext("webgl")) ? "webgl-ok" : "webgl-MISSING" });

      post({ stage: "awaiting-archive" });
      post({ stage: "awaiting-style" });

      Promise.all([archiveReady, styleReady]).then(function (both) {
        var buffer = both[0];
        var style = both[1];

        /*
          pmtiles from a buffer, not a URL.

          Its Source interface is two methods, so a range request becomes a
          slice of an ArrayBuffer. That sidesteps the whole problem: the
          archive is a bundled file, and file:// has no range semantics for
          the usual HTTP path to use.
        */
        var archive = new pmtiles.PMTiles({
          getKey: function () { return "bundled"; },
          getBytes: function (offset, length) {
            return Promise.resolve({ data: buffer.slice(offset, offset + length) });
          }
        });
        var protocol = new pmtiles.Protocol();
        protocol.add(archive);
        maplibregl.addProtocol("pmtiles", protocol.tile);
        post({ stage: "protocol-registered" });

        var map = new maplibregl.Map({
          container: "map",
          style: style,
          center: [${lon}, ${lat}],
          zoom: ${zoom},
          pitch: 70,
          bearing: 20,
          attributionControl: false,
          /*
            The same limits the native map keeps, from the same venue data.

            Not tidiness. The basemap is a per-venue archive covering a few
            kilometres, so panning past its edge shows nothing at all and
            zooming out shows a circuit-sized hole in a black world. Worse,
            getting back is hard on a tilted map — the gesture that got you
            lost is not obviously reversible.

            maxBounds is the extract area, which is exactly the region the
            archive has tiles for, so the camera cannot reach anywhere the
            map is empty.
          */
          minZoom: ${minZoom},
          maxZoom: ${maxZoom},
          maxBounds: ${maxBounds}
        });

        window.__map = map;
        map.on("error", function (e) { fail("map.error", e && e.error); });

        map.on("load", function () {
          post({ stage: "map-loaded" });
          try {
            // Same call, same source, same exaggeration the web build uses.
            map.setTerrain({ source: "${TERRAIN_SOURCE}", exaggeration: 1.4 });
            post({ stage: "terrain-set" });
          } catch (e) { fail("setTerrain", e); }

          // The style hides these until 3D is asked for, which is the same
          // switch the native screen drives from its 2D/3D button.
          ["terrain-hillshade", "buildings-3d", "trees", "ground-detail"].forEach(function (id) {
            try { map.setLayoutProperty(id, "visibility", "visible"); } catch (e) {}
          });
          post({ stage: "3d-layers-shown" });

          /*
            Spots, added after load rather than baked into the style.

            They change as you edit them and the style carries the whole
            basemap, so rebuilding the document for a rename would be the same
            mistake 'omitSpots' exists to avoid on the native screen.
          */
          try {
            /*
              Overlapping spots stack rather than hide each other.

              Waypoints cluster naturally — three angles on the same corner,
              two sides of the same fence — and drawn flat they sit on top of
              one another, so the pin you tap is whichever happened to be
              drawn last. A count is honest about there being more than one
              and gives you something to zoom into.

              40px radius, which is roughly a fingertip: the threshold for
              "these overlap" should be what a thumb cannot separate, not a
              distance on the ground.
            */
            map.addSource("spots", {
              type: "geojson",
              data: window.__spots || emptySpots,
              cluster: true,
              clusterRadius: 40,
              // Carried onto the cluster so a stack can be listed without
              // a second lookup, and so leaves keep their identity.
              clusterProperties: {},
              // Past this they are far enough apart to tap individually.
              clusterMaxZoom: 17
            });
            // Clusters first, so a stack reads as one object.
            map.addLayer({
              id: "spot-cluster",
              type: "circle",
              source: "spots",
              filter: ["has", "point_count"],
              paint: {
                "circle-radius": ["step", ["get", "point_count"], 14, 5, 18, 10, 22],
                "circle-color": "#2E7DF6",
                "circle-opacity": 0.85,
                "circle-stroke-color": "#0B0D10",
                "circle-stroke-width": 2
              }
            });
            map.addLayer({
              id: "spot-cluster-count",
              type: "symbol",
              source: "spots",
              filter: ["has", "point_count"],
              layout: {
                "text-field": ["get", "point_count_abbreviated"],
                "text-size": 12,
                "text-allow-overlap": true
              },
              paint: { "text-color": "#0B0D10" }
            });

            map.addLayer({
              id: "spot-halo",
              type: "circle",
              source: "spots",
              filter: ["!", ["has", "point_count"]],
              paint: { "circle-radius": 12, "circle-color": "#2E7DF6", "circle-opacity": 0.22 }
            });
            map.addLayer({
              id: "spot-pin",
              type: "circle",
              source: "spots",
              filter: ["!", ["has", "point_count"]],
              paint: {
                "circle-radius": 6,
                "circle-color": "#2E7DF6",
                "circle-stroke-color": "#0B0D10",
                "circle-stroke-width": 2
              }
            });
            post({ stage: "spots-layer-added" });

            /*
              The route, under the spots and over the ground.

              Network legs solid, direct legs dashed — the same distinction
              the native map draws, and it is not decoration: a dashed leg
              means "no path here, this is a bearing", and drawing it like a
              footpath would claim knowledge the data does not have.
            */
            map.addSource("nav-route", { type: "geojson", data: window.__route });
            map.addLayer({
              id: "nav-route-network",
              type: "line",
              source: "nav-route",
              filter: ["==", ["get", "kind"], "network"],
              layout: { "line-cap": "round", "line-join": "round" },
              paint: { "line-color": "#2E7DF6", "line-width": 5, "line-opacity": 0.9 }
            }, "spot-halo");
            map.addLayer({
              id: "nav-route-direct",
              type: "line",
              source: "nav-route",
              filter: ["==", ["get", "kind"], "direct"],
              layout: { "line-cap": "round" },
              paint: {
                "line-color": "#2E7DF6",
                "line-width": 4,
                "line-opacity": 0.8,
                "line-dasharray": [1.5, 1.5]
              }
            }, "spot-halo");

            /*
              You, on top of everything.

              The heading arrow is a rotated text glyph rather than a sprite.
              The native map uses a bundled PNG for this; adding a sprite
              sheet to the page would mean another asset to deliver for one
              triangle, and text-rotate does the same job with what the
              glyphs already provide.

              Drawn only when a heading exists — an arrow pointing nowhere in
              particular still looks like an assertion.
            */
            map.addSource("nav-here", { type: "geojson", data: window.__here });
            map.addLayer({
              id: "nav-here-cone",
              type: "symbol",
              source: "nav-here",
              filter: ["has", "heading"],
              layout: {
                "text-field": "\u25B2",
                "text-size": 22,
                "text-rotate": ["get", "heading"],
                "text-rotation-alignment": "map",
                "text-allow-overlap": true,
                "text-ignore-placement": true,
                "text-offset": [0, -0.9]
              },
              paint: { "text-color": "#2E7DF6", "text-opacity": 0.55 }
            });
            map.addLayer({
              id: "nav-here-dot",
              type: "circle",
              source: "nav-here",
              paint: {
                "circle-radius": 7,
                "circle-color": "#F2F5F8",
                "circle-stroke-color": "#2E7DF6",
                "circle-stroke-width": 3
              }
            });
            post({ stage: "nav-layers-added" });
          } catch (e) { fail("spots", e); }

          // Tapping a pin opens it on the native side, which owns the sheet.
          /*
            Tapping a stack opens it rather than doing nothing.

            A cluster has no single spot to show, so the useful response is
            to go to the zoom where it breaks apart — which pmtiles can
            answer directly, and which is what the count was inviting.
          */
          map.on("click", "spot-cluster", function (e) {
            var f = e.features && e.features[0];
            if (!f) return;

            /*
              Ask what is in the stack rather than zooming into it.

              Zooming was the obvious response and the wrong one: it moves
              the camera away from what you were looking at to answer a
              question you could be told the answer to. And at a circuit,
              three spots on one corner may sit within a few metres — the
              zoom that separates them is closer than is useful.

              getClusterLeaves returns the actual features, so the list is
              the spots themselves rather than a count.
            */
            map.getSource("spots").getClusterLeaves(
              f.properties.cluster_id,
              // Enough for any real stack; beyond that the list stops being
              // readable and zooming genuinely is the better answer.
              25,
              0
            ).then(function (leaves) {
              post({
                stack: leaves.map(function (l) {
                  return {
                    id: String(l.properties.id),
                    name: String(l.properties.name || "Unnamed spot")
                  };
                }),
                // The centroid the cluster is drawn at, so the native list
                // can be placed against the thing it describes.
                at: f.geometry.coordinates
              });
            }).catch(function (err) { fail("cluster-leaves", err); });
          });

          map.on("click", "spot-pin", function (e) {
            var f = e.features && e.features[0];
            var id = f && f.properties && f.properties.id;
            if (id) post({ tapSpot: String(id) });
          });

          /*
            A tap on open ground, for placing a spot.

            Checked against the pin and cluster layers first so this only
            fires on genuinely empty map — otherwise every attempt to open a
            waypoint would also try to create one underneath it.
          */
          map.on("click", function (e) {
            var hits = map.queryRenderedFeatures(e.point, {
              layers: ["spot-pin", "spot-cluster"]
            });
            if (hits && hits.length > 0) return;
            post({ tapMap: { lon: e.lngLat.lng, lat: e.lngLat.lat } });
          });

          map.on("mouseenter", "spot-pin", function () { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", "spot-pin", function () { map.getCanvas().style.cursor = ""; });
        });

        var probed = false;
        map.on("idle", function () {
          if (probed) return;
          probed = true;
          post({ stage: "idle" });
          try {
            var m = map.queryTerrainElevation(map.getCenter());
            post({ stage: "elevation", metres: (m === null || m === undefined) ? null : Math.round(m) });
          } catch (e) { post({ stage: "elevation", error: String(e && e.message || e) }); }
          post({ stage: "pitch", pitch: Math.round(map.getPitch()) });
        });

        // Frame timing while dragging: the question is whether this is
        // usable, not merely possible.
        var frames = 0, since = Date.now();
        map.on("move", function () {
          frames++;
          var elapsed = Date.now() - since;
          if (elapsed >= 1000) {
            post({ stage: "fps", fps: Math.round((frames * 1000) / elapsed) });
            frames = 0; since = Date.now();
          }
        });
      }).catch(function (e) { fail("build", e); });
    } catch (e) {
      fail("setup", e);
    }
  </script>
</body>
</html>`;
}

export default function TerrainSpike({
  venue,
  spots,
  here,
  heading,
  route,
  onOpenSpot,
  onMapTap,
  onClose,
}: {
  venue: VenueKey;
  /** The same GeoJSON the native map draws. */
  spots?: unknown;
  /** Where you are, or null with no fix. */
  here?: { latitude: number; longitude: number } | null;
  /** Compass bearing in degrees from north, or null when unknown. */
  heading?: number | null;
  /** The walking route, as the native map draws it. */
  route?: unknown;
  /** Tapping a pin opens it — the sheet stays on the native side. */
  onOpenSpot?: (id: string) => void;
  /** Tapping open ground, for placing a spot. Latitude first, as elsewhere. */
  onMapTap?: (latitude: number, longitude: number) => void;
  /**
   * Shown as a Back button when present.
   *
   * Absent when embedded in MapScreen, where the 2D/3D control is already
   * the way out and a second one would be clutter over a map.
   */
  onClose?: () => void;
}) {
  const [log, setLog] = useState<string[]>([]);
  const [fps, setFps] = useState<number | null>(null);

  /**
   * The map is up and the diagnostics can go away.
   *
   * This started as a test screen and the log was the whole point of it. It is
   * a feature now, and a wall of stage names over a landscape is the wrong
   * thing to hand somebody who pressed 3D. The log stays while it is loading,
   * because that is when something might go wrong and the last stage names
   * where — then it gets out of the way.
   */
  const [ready, setReady] = useState(false);

  /**
   * The spots inside a tapped stack, and which of them is lit.
   *
   * ── Why a list rather than zooming in ─────────────────────────────────
   * Zooming was the first answer and the wrong one: it moves the camera
   * away from what you were looking at, to tell you something you could
   * simply be told. Three spots on one corner can sit within a few metres,
   * and the zoom that separates them is closer than is useful.
   *
   * ── Why picking one only highlights it ────────────────────────────────
   * Tapping a name lights that spot on the map and dims the rest; opening
   * it is a second, deliberate tap on the pin itself. The list answers
   * "which of these is which", which is a different question from "show me
   * this one", and answering both at once would mean you could not look
   * without committing.
   */
  const [stack, setStack] = useState<{ id: string; name: string }[] | null>(null);
  const [lit, setLit] = useState<string | null>(null);

  const highlight = (id: string | null) => {
    setLit(id);
    webRef.current?.injectJavaScript(
      `window.__setHighlight && window.__setHighlight(${id === null ? 'null' : JSON.stringify(id)}); true;`,
    );
  };

  const clearStack = () => {
    setStack(null);
    highlight(null);
  };

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

  /**
   * Push the spots into the page.
   *
   * Small enough to go in one call — a few hundred waypoints is kilobytes,
   * not the megabyte the style needed — so no chunking. The page holds them
   * on 'window' whether or not the map exists yet, so this is safe to call
   * before it has loaded.
   */
  /**
   * Everything the page needs, sent again once it exists.
   *
   * ── Why once was not enough ───────────────────────────────────────────
   * These effects run on mount, which is before the WebView has loaded its
   * document — so `window.__setSpots` was undefined and the `&&` guard threw
   * the payload away without a word. If the spots then never changed, and on a
   * saved map they do not, they were never sent at all. Hence a map with
   * "Spots · 2" in the bar and nothing on it.
   *
   * Bumping this when the page reports its layers exist re-runs every sender
   * below. Cheap — a point, a line and a few waypoints — and it removes the
   * ordering assumption entirely rather than papering over it.
   */
  const [pageEpoch, setPageEpoch] = useState(0);

  useEffect(() => {
    if (spots === undefined) return;
    const json = JSON.stringify(spots)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    webRef.current?.injectJavaScript(`window.__setSpots && window.__setSpots("${json}"); true;`);
  }, [spots, pageEpoch]);

  /**
   * Push position and route into the page.
   *
   * Both change constantly — a fix every second or so, and the route is
   * recomputed on each one — so they go over the same live channel the
   * spots use rather than through the style. Tiny payloads: a point and a
   * line, against the megabyte the style needed.
   *
   * `heading` rides on the point as a property so the arrow can rotate
   * without a second source, and is simply absent when unknown — the layer
   * filters on `has`, so no heading means no arrow rather than an arrow
   * pointing north by default.
   */
  useEffect(() => {
    const point =
      here == null
        ? { type: 'FeatureCollection', features: [] }
        : {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: heading == null ? {} : { heading },
                geometry: {
                  type: 'Point',
                  coordinates: [here.longitude, here.latitude],
                },
              },
            ],
          };

    const json = JSON.stringify({
      here: point,
      route: route ?? { type: 'FeatureCollection', features: [] },
    })
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    webRef.current?.injectJavaScript(`window.__setNav && window.__setNav("${json}"); true;`);
  }, [here, heading, route, pageEpoch]);

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
          <Text style={styles.buttonLabel}>Back to map</Text>
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
         * No file-access props, and 'allowingReadAccessToURL' in particular.
         *
         * They were added for the fetch-off-disk path and the page stopped
         * loading entirely at the same moment — thirty seconds with not one
         * message, before *and* after the document shrank from 2.4MB to 10KB,
         * which rules the payload out. On iOS that prop changes which
         * WKWebView load method is used, and combining it with an 'html'
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
              tapSpot?: string;
              stack?: { id: string; name: string }[];
              tapMap?: { lon: number; lat: number };
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
            // A pin was tapped. The sheet belongs to the native side, so
            // this is handed straight back out rather than handled here.
            // Open ground was tapped. The shell decides whether that means
            // anything — it only does while placing.
            if (m.tapMap) {
              onMapTap?.(m.tapMap.lat, m.tapMap.lon);
              return;
            }

            // A stack was tapped: list what is in it.
            if (Array.isArray(m.stack)) {
              setStack(m.stack);
              highlight(null);
              return;
            }

            if (typeof m.tapSpot === 'string') {
              // Opening one ends the question the list was asking.
              clearStack();
              onOpenSpot?.(m.tapSpot);
              return;
            }

            if (m.stage === '3d-layers-shown') {
              setReady(true);
              // The page is listening now, so send what it missed.
              setPageEpoch((n) => n + 1);
            }

            /*
              The log goes as soon as there is a map to look at.

              It waited for the layers, which arrive a moment later and
              sometimes not at all if one of them fails — leaving a wall of
              stage names over a perfectly good landscape. A visible map is
              the honest signal that loading is over.
            */
            if (m.stage === 'map-loaded') setReady(true);
            if (m.stage === 'awaiting-archive') void sendArchiveOverBridge();
            if (m.stage === 'awaiting-style') sendStyle();
          } catch {
            note('unreadable message');
          }
        }}
        onError={(e: { nativeEvent: { description?: string } }) =>
          note(`webview error — ${e.nativeEvent.description ?? 'unknown'}`)
        }
      />

      {stack !== null && (
        <View style={styles.stackPanel}>
          <View style={styles.stackHead}>
            <Text style={styles.stackTitle}>
              {stack.length} SPOTS HERE
            </Text>
            <Pressable onPress={clearStack} hitSlop={10}>
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
                onPress={() => highlight(on ? null : s.id)}
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

      <View style={styles.overlay} pointerEvents="box-none">
        {!ready && (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>
            LOADING TERRAIN{fps !== null ? ` · ${fps} fps` : ''}
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
        )}

        {onClose !== undefined && (
          <Pressable onPress={onClose} style={styles.button}>
            <Text style={styles.buttonLabel}>Back to map</Text>
          </Pressable>
        )}
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
  /*
   * Loading chrome only.
   *
   * Embedded, this sits over the map inside MapScreen, so it is kept clear
   * of the bottom bar the shell already puts there — the sky strip and the
   * Spots / + Spot row own that space.
   */
  /*
   * The stack list sits top-left, clear of the map's own chrome.
   *
   * On-map furniture, so fixed dark values rather than theme tokens — the same
   * reasoning as the menu trigger and the sun dial, which float on an
   * always-dark basemap.
   */
  stackPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 120,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(11,13,16,0.94)',
    borderWidth: 1,
    borderColor: '#2A313B',
  },
  pressed: { opacity: 0.7 },
  stackHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stackTitle: { color: '#6C9AE0', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  stackClose: { color: '#F2F5F8', fontSize: 13, fontWeight: '700' },
  stackHint: { color: '#9AA5B1', fontSize: 11, lineHeight: 15, marginTop: 4 },
  stackRow: {
    marginTop: 6,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A313B',
  },
  stackRowOn: { borderColor: '#2E7DF6', backgroundColor: 'rgba(46,125,246,0.12)' },
  stackName: { color: '#9AA5B1', fontSize: 14 },
  stackNameOn: { color: '#F2F5F8', fontWeight: '700' },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 96, padding: 12 },
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
