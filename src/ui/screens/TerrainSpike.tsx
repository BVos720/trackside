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
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PDF_BRIDGE_SUPPORTED } from '../../storage-local/pdfBridge';
import {
  REMOTE_GLYPHS_URL,
  TERRAIN_SOURCE,
  VENUE_VIEW,
  buildMapStyle,
  type VenueKey,
} from '../map/style';
import { moonState, solarPosition } from '../../core/logic/sun';
import { SCENERY_DATA_URIS } from '../map/scenerySprites';
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
    // Scenery on: the trailing flag drops TREES_SOURCE from the style
    // altogether, and with it the tree line that makes a circuit legible.
    /*
      omitSpots: true — the page adds its own.

      This was false, so the style arrived carrying spot-halo / spot-pin /
      spot-label, and the page's own 'spots' source then failed to be added at
      all: "Source 'spots' already exists". Every layer that depended on it went
      with it, spot-cluster included.

      The visible result was a map that looked almost right — pins were there,
      because the style's unclustered ones were drawing them — but stacking
      never happened, and every tap logged "the layer 'spot-cluster' does not
      exist and cannot be queried". Clustering had not been broken; it had
      never been added.
    */
    buildMapStyle('bundled', shown, undefined, true, true, REMOTE_GLYPHS_URL, true),
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
  // Inlined into the page: see scenerySprites.ts for why these travel as
  // data URIs rather than as files or a sprite URL.
  const sceneryUris = JSON.stringify(SCENERY_DATA_URIS);

  /*
    Stack once two cards overlap by a quarter of their width.

    Cards are CALLOUT_W wide and centred on their pin, so they are a quarter
    buried once the pins are closer than three quarters of that. Derived here
    rather than written as a number so it cannot drift if the card resizes.
  */
  const stackRadius = Math.round(CALLOUT_W * 0.75);

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

    /*
      The sky, and the direction the light comes from.

      Both are driven by real solar position for this circuit and this
      instant — the same solarPosition() the sun dial uses, so the terrain
      shading and the dial can never disagree. Not decoration: which side of
      a hill is lit at 17:40 is the question the whole app exists to answer,
      and a map lit from a fixed arbitrary angle answers it wrongly.

      The palette is interpolated over altitude rather than switched at
      sunrise, because the interesting hour is the one where it is changing.
    */
    var SUN_STOPS = [
      { alt: -18, sky: [5, 7, 10], horizon: [11, 16, 22], fog: [11, 13, 16] },
      { alt: -6, sky: [16, 26, 42], horizon: [42, 36, 64], fog: [20, 22, 28] },
      { alt: 0, sky: [30, 48, 80], horizon: [224, 138, 74], fog: [58, 46, 42] },
      { alt: 8, sky: [58, 111, 168], horizon: [240, 176, 112], fog: [110, 124, 138] },
      { alt: 35, sky: [92, 147, 204], horizon: [168, 200, 232], fog: [159, 178, 196] }
    ];

    /*
      No sun until the real one arrives.

      This used to hold a placeholder — due south at 25 degrees — so that
      the sky had something to draw before the native side reported the
      true position. That was a mistake: the injection is guarded on
      __setSun existing, so if it ran before this script did, nothing
      replaced the placeholder and the map lit itself from a sun that was
      not anywhere. A fiction that looks like an answer is worse than a
      blank, and this view exists to answer exactly this question.
    */
    window.__sun = null;
    window.__moon = null;

    /*
      What the sky is doing, from the forecast.

      Cover and rainfall are real numbers for this circuit and this hour, so a
      wet weekend looks wet before you get there. The *arrangement* is invented
      — these are not the actual clouds overhead — and the weather screen stays
      the place for figures. This is the difference between "it will be
      overcast at four" as a number and as something you can see.
    */
    // Stars are a graphics setting; the moon is not. See the prop's note.
    window.__stars = true;
    window.__weather = { cover: 0, rain: 0 };
    window.__setWeather = function (json) {
      try {
        var w = JSON.parse(json);
        window.__weather = {
          cover: Math.max(0, Math.min(100, w.cover || 0)),
          rain: Math.max(0, w.rain || 0)
        };
        pumpWeather();
      } catch (e) {}
    };

    window.__setSun = function (json) {
      try {
        var payload = JSON.parse(json);
        window.__sun = payload.sun || payload;
        window.__moon = payload.moon || null;
        applySun();
        drawSky();
      } catch (e) {}
    };

    /*
      The land beyond the archive.

      The DEM is global, so there is real terrain in every direction — but
      the vector archive covers a few kilometres, so out there the mesh has
      landform and nothing else. That is exactly what is wanted: no roads, no
      names, just the ridgeline the sun is going to set behind.

      It only needed a colour. Left as the flavour background it read as a
      void with the circuit floating in it; given a land tone and lit by the
      same hillshade, it reads as the hills that are actually there.

      Dimmed with the sun so it does not glow at midnight.
    */
    /*
      The corridor mask does not belong in this view at all.

      It was faded by pitch, which turned out to be the "map goes dark at a
      certain angle" glitch: anywhere below about 55 degrees it was partly
      opaque, so the entire landscape outside the corridor sat under a
      half-strength black wash. Tilt down to look at the circuit and the
      world dimmed; tilt back up and it returned.

      There is no angle at which it helps here. It exists to stop the
      countryside competing with the corridor on a flat overhead map, and
      this view is *about* the countryside — which ridge the sun goes behind,
      where the ground falls away. The flat map keeps it, unchanged.
    */
    function fadeMask() {
      var map = window.__map;
      if (!map || !map.getLayer("corridor-mask")) return;
      map.setPaintProperty("corridor-mask", "fill-opacity", 0);
    }

    function daylight() {
      // No sun reported yet: treat it as full day rather than inventing a
      // position. Nothing is drawn until the real one lands a frame later.
      var alt = window.__sun ? window.__sun.altitude : 25;
      // Zero at astronomical dusk, one once the sun is properly up, and
      // continuous in between — the transition *is* the interesting part,
      // so nothing here switches.
      return Math.max(0, Math.min(1, (alt + 12) / 30));
    }

    function mixHex(night, day, t) {
      return "rgb(" +
        Math.round(night[0] + (day[0] - night[0]) * t) + "," +
        Math.round(night[1] + (day[1] - night[1]) * t) + "," +
        Math.round(night[2] + (day[2] - night[2]) * t) + ")";
    }

    /*
      The ground, from midnight to midday.

      Every tone is interpolated on the same daylight factor as the sky, so
      dragging the time slider walks the whole map through dusk instead of
      snapping between two palettes. Grass does not stay lit at 2am while
      the sky above it is black.

      "background" is the land beyond the archive: the DEM is global, so
      there is real terrain out there with no roads and no names on it — the
      ridgeline the sun sets behind. It only ever needed a colour.
    */
    var GROUND_TONES = {
      // Forest green, matching landuse_park rather than sitting a shade off
      // it. Out there the mesh has no detail at all, so anything that reads
      // as a *different* surface invites you to look for a meaning that is
      // not there. Continuous woodland is the honest reading of the Eifel.
      background: [[10, 18, 13], [34, 60, 44]],
      earth: [[11, 14, 12], [38, 48, 42]],
      landcover: [[13, 17, 14], [46, 61, 48]],
      landuse_park: [[10, 18, 13], [36, 64, 47]],
      landuse_urban_green: [[10, 18, 13], [36, 64, 47]],
      landuse_zoo: [[12, 17, 13], [42, 58, 44]],
      water: [[9, 16, 22], [29, 58, 78]],
      water_river: [[9, 16, 22], [29, 58, 78]],
      water_stream: [[9, 16, 22], [29, 58, 78]]
    };

    function applyGround() {
      var map = window.__map;
      if (!map) return;
      var t = daylight();
      Object.keys(GROUND_TONES).forEach(function (id) {
        var layer = map.getLayer(id);
        if (!layer) return;
        var pair = GROUND_TONES[id];
        var prop =
          layer.type === "line"
            ? "line-color"
            : layer.type === "background"
              ? "background-color"
              : "fill-color";
        map.setPaintProperty(id, prop, mixHex(pair[0], pair[1], t));
      });
    }

    /*
      Stars and the moon, on a canvas over the map.

      Neither is a map layer, because neither is on the ground — they belong
      to the sky the camera is looking at, so they are projected from the
      camera the same way you would project anything at infinity: relative
      bearing across the horizontal field of view, elevation across the
      vertical one. Turn the map and they swing the other way, which is the
      whole cue that sells them as sky rather than stickers.

      The stars are a fixed random sky, generated once. Their positions are
      not a real catalogue and this does not pretend otherwise — but they
      hold still relative to the compass, which is the part the eye checks.

      The moon is real: position and illuminated fraction come from the same
      moonState() the planner uses, so a crescent on screen is the crescent
      that will be over the circuit.
    */
    var STARS = (function () {
      var out = [];
      var seed = 20260828;
      function rnd() {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      }
      // The visible swath of azimuth is narrow on a phone held upright — a
      // sixteen-degree window out of three hundred and sixty — so a few hundred
      // stars would put barely ten on screen. Culling is two multiplies each.
      for (var i = 0; i < 900; i++) {
        out.push({
          az: rnd() * 360,
          // Biased upward: a uniform spread bunches everything at the
          // horizon once projected.
          alt: Math.pow(rnd(), 0.7) * 88,
          mag: rnd()
        });
      }
      return out;
    })();

    var skyCanvas = null;

    /*
      Where a thing in the sky lands on screen.

      ── Bearing is true, height is compressed, and that is deliberate ────
      A camera pitched at 76 degrees with a 37-degree lens sees elevations
      from about -32 to +4. Project honestly and the entire sky above four
      degrees is off the top of the screen: no moon, and a dozen stars
      clinging to the horizon. Correct, and of no use to anybody.

      So azimuth is exact — turn the map and everything swings the right way
      by the right amount, which is the cue the eye actually checks — while
      altitude is mapped across the strip of sky between the horizon and the
      top of the view. The moon appears in the right direction at a
      plausible height, rather than in the right direction off-screen.

      The dial remains the instrument for reading exact elevation. This is
      the view out of the window.
    */
    function project(az, alt) {
      var map = window.__map;
      var c = map.getCanvas();
      var w = c.clientWidth;
      var h = c.clientHeight;

      var fovV = map.transform.fovInRadians
        ? map.transform.fovInRadians
        : 0.6435011087932844;
      var fovH = 2 * Math.atan(Math.tan(fovV / 2) * (w / h));

      var d = ((az - map.getBearing()) % 360 + 540) % 360 - 180;
      var dr = d * Math.PI / 180;
      if (Math.abs(dr) > fovH / 2) return null;

      // Pitch is measured from straight down, so the view centre sits this
      // far above the horizon — negative while looking downward.
      var centreElev = (map.getPitch() - 90) * Math.PI / 180;
      var horizonY = h * (0.5 + centreElev / fovV);
      // Too flat to show any sky at all.
      if (horizonY < 8) return null;

      var a = Math.max(0, Math.min(90, alt));
      return {
        x: w * (0.5 + dr / fovH),
        y: horizonY * (1 - a / 90)
      };
    }

    /*
      A fixed sky of clouds, revealed in proportion to the cover.

      Generated once and then drawn 0..N of them, so going from broken to
      overcast adds cloud rather than rearranging the sky — the same reason
      the stars are a fixed set.

      They drift in azimuth rather than across the screen, so they hold
      station against the compass while you turn, and only the wind moves
      them.
    */
    var CLOUDS = (function () {
      var out = [];
      var seed = 8112026;
      function rnd() {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      }
      for (var i = 0; i < 26; i++) {
        out.push({
          az: rnd() * 360,
          // Spread across the full sky. Altitude is compressed into the
          // strip above the horizon, so a narrow range up there collapses
          // into a single bright band that reads as haze, not cloud.
          alt: 8 + rnd() * 68,
          w: 90 + rnd() * 190,
          h: 26 + rnd() * 44
        });
      }
      return out;
    })();

    function drawClouds(g, vw, vh, tSec) {
      var cover = window.__weather ? window.__weather.cover : 0;
      if (cover <= 0) return;

      var t = daylight();
      var body = mixHex([26, 30, 38], [206, 214, 226], t);

      /*
        Overcast is a ceiling, not a crowd.

        Revealing more and more separate blobs made 90% cover look like a busy
        sky rather than a closed one — but real overcast is a single sheet with
        the odd thin patch, and the difference is not decoration: "will there
        be any direct light at all" is the question, and a gappy sky says yes
        when the answer is no.

        So above about 55% a sheet fades in across the strip of sky, and the
        blobs keep going underneath it to stop it reading as a flat wash.
        Below that they are genuinely separate clouds and are drawn as such.
      */
      var sheet = Math.max(0, Math.min(1, (cover - 55) / 40));
      if (sheet > 0) {
        var horizon = project(0, 0);
        var top = project(0, 90);
        if (horizon && top) {
          var band = g.createLinearGradient(0, top.y, 0, horizon.y);
          // Thickest aloft and thinning towards the horizon, which is the way
          // a ceiling actually looks from underneath it.
          band.addColorStop(0, body.replace("rgb(", "rgba(").replace(")", "," + (0.62 * sheet).toFixed(3) + ")"));
          band.addColorStop(1, body.replace("rgb(", "rgba(").replace(")", "," + (0.18 * sheet).toFixed(3) + ")"));
          g.fillStyle = band;
          g.fillRect(0, Math.min(top.y, horizon.y), vw, Math.abs(horizon.y - top.y));
        }
      }
      // Bright and grey by day, barely-there shapes at night: clouds are lit
      // by the same sun as the ground.
      var n = Math.round((cover / 100) * CLOUDS.length);

      for (var i = 0; i < n; i++) {
        var c = CLOUDS[i];
        // Slow: a cloud should cross the view in minutes, not seconds.
        var az = (c.az + tSec * 0.22) % 360;
        var p = project(az, c.alt);
        if (!p) continue;

        var grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, c.w / 2);
        grad.addColorStop(0, body.replace("rgb(", "rgba(").replace(")", ",0.55)"));
        grad.addColorStop(1, body.replace("rgb(", "rgba(").replace(")", ",0)"));
        g.fillStyle = grad;
        g.save();
        g.translate(p.x, p.y);
        g.scale(1, c.h / c.w);
        g.beginPath();
        g.arc(0, 0, c.w / 2, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }

    /*
      Rain, in screen space.

      Deliberately not projected: rain is the nearest thing there is, falling
      between you and everything else, so it belongs to the window rather
      than to the sky. Positions come from the index and the clock instead of
      an array of drops, which keeps it stateless and cheap.
    */
    function drawRain(g, vw, vh, tSec) {
      var mm = window.__weather ? window.__weather.rain : 0;
      if (mm <= 0) return;

      // Drizzle and downpour differ by orders of magnitude, so this is
      // compressed hard: 0.1mm still shows, 8mm is not eighty times denser.
      var drops = Math.round(Math.min(1, Math.pow(mm / 6, 0.55)) * 320);
      var t = daylight();
      g.strokeStyle = t > 0.4 ? "rgba(196,214,232,0.42)" : "rgba(150,170,196,0.34)";
      g.lineWidth = 1;
      g.beginPath();

      for (var i = 0; i < drops; i++) {
        /*
          Hashed, not strided.

          Stepping x and y by fixed amounts per drop lays them out on a
          lattice, and falling rain on a regular grid reads as a texture
          rather than as weather. Two cheap hashes scatter them instead.
        */
        var hx = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        var hy = (Math.sin(i * 78.233) * 12345.6789) % 1;
        var speed = 480 + Math.abs(hy) * 420;
        var len = 12 + Math.abs(hx) * 12;
        var x = (Math.abs(hx) * (vw + 120) + tSec * 46) % (vw + 120) - 60;
        var y = (Math.abs(hy) * (vh + 80) + tSec * speed) % (vh + 80) - 40;
        g.moveTo(x, y);
        g.lineTo(x - len * 0.3, y + len);
      }
      g.stroke();
    }

    /*
      One animation loop, running only when there is something moving.

      Stars and the moon are still: they are redrawn when the camera moves
      and cost nothing in between. Cloud and rain are not, so this starts on
      the first forecast that has either and stops the moment both are zero.
      A clear day pays for no frames at all.
    */
    var weatherLoop = null;

    function pumpWeather() {
      var w = window.__weather || { cover: 0, rain: 0 };
      var moving = w.cover > 0 || w.rain > 0;

      if (!moving) {
        if (weatherLoop !== null) {
          cancelAnimationFrame(weatherLoop);
          weatherLoop = null;
        }
        drawSky();
        return;
      }
      if (weatherLoop !== null) return;

      var step = function () {
        drawSky();
        weatherLoop = requestAnimationFrame(step);
      };
      weatherLoop = requestAnimationFrame(step);
    }

    function drawSky() {
      var map = window.__map;
      if (!map) return;

      if (!skyCanvas) {
        skyCanvas = document.createElement("canvas");
        skyCanvas.id = "skyCanvas";
        skyCanvas.style.cssText =
          "position:absolute;inset:0;pointer-events:none;z-index:2";
        map.getContainer().appendChild(skyCanvas);
      }

      var c = map.getCanvas();
      var w = c.clientWidth;
      var h = c.clientHeight;
      var dpr = window.devicePixelRatio || 1;
      if (skyCanvas.width !== Math.round(w * dpr)) {
        skyCanvas.width = Math.round(w * dpr);
        skyCanvas.height = Math.round(h * dpr);
        skyCanvas.style.width = w + "px";
        skyCanvas.style.height = h + "px";
      }

      var g = skyCanvas.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      var tSec = Date.now() / 1000;
      // No sun reported yet: treat it as full day rather than inventing a
      // position. Nothing is drawn until the real one lands a frame later.
      var alt = window.__sun ? window.__sun.altitude : 25;
      var night = Math.max(0, Math.min(1, (-alt - 2) / 10));

      // Stars and moon first: cloud draws over them, which is what cloud does.
      if (night > 0) {

      if (window.__stars !== false) for (var i = 0; i < STARS.length; i++) {
        var st = STARS[i];
        var p = project(st.az, st.alt);
        if (!p || p.y < 0 || p.y > h) continue;
        var r = 0.6 + st.mag * 1.1;
        g.globalAlpha = night * (0.35 + st.mag * 0.65);
        g.fillStyle = "#EAF0FF";
        g.beginPath();
        g.arc(p.x, p.y, r, 0, Math.PI * 2);
        g.fill();
      }

      var moon = window.__moon;
      if (moon && moon.altitude > -2) {
        var mp = project(moon.azimuth, moon.altitude);
        if (mp) drawMoon(g, mp.x, mp.y, 16, moon, night);
      }
      }

      g.globalAlpha = 1;
      // Under the cloud, because cloud covers the sun — that is the single
      // most useful thing an overcast forecast can tell you.
      drawSun(g);
      drawClouds(g, w, h, tSec);
      drawRain(g, w, h, tSec);
    }

    /*
      The sun, which was missing entirely.

      The sky drew stars and a moon at night and nothing at all by day, so the
      one object the whole feature is about — where the sun is, and therefore
      what is lit and what is backlit — could only be read off the dial. Now
      you can look at it.

      Drawn from about -6 degrees, so it is still there through the part of
      twilight where its position is the thing you are planning around. Below
      that it is genuinely gone and drawing it would be a fiction.

      Colour tracks altitude the way the real thing does: deep orange on the
      horizon, pale gold climbing, near-white overhead. Same interpolation the
      ground and the sky gradient use, so the disc agrees with the light it is
      supposedly casting.
    */
    function drawSun(g) {
      var sun = window.__sun;
      if (!sun) return;
      var alt = sun.altitude;
      if (alt < -6) return;

      var p = project(sun.azimuth, alt);
      if (!p) return;

      // 0 on the horizon, 1 by the time it is well up.
      var high = Math.max(0, Math.min(1, (alt + 6) / 26));
      var core = mixHex([255, 138, 46], [255, 246, 214], high);
      var r = 13;

      // The glow is what makes it read as a light source rather than a
      // sticker, and it is what you actually see first when turning the map.
      var glow = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 7);
      glow.addColorStop(0, core.replace("rgb(", "rgba(").replace(")", ",0.55)"));
      glow.addColorStop(0.35, core.replace("rgb(", "rgba(").replace(")", ",0.18)"));
      glow.addColorStop(1, core.replace("rgb(", "rgba(").replace(")", ",0)"));
      g.fillStyle = glow;
      g.beginPath();
      g.arc(p.x, p.y, r * 7, 0, Math.PI * 2);
      g.fill();

      g.fillStyle = core;
      g.beginPath();
      g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.fill();
    }

    function drawMoon(g, cx, cy, r, moon, night) {
      var lit = Math.max(0, Math.min(1, moon.illumination));
      // suncalc phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last.
      var waxing = moon.phase < 0.5;

      g.save();
      g.globalAlpha = night;

      // A little haze around it, which is most of what makes it read as
      // light rather than a pale sticker.
      var glow = g.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 3.4);
      glow.addColorStop(0, "rgba(226,232,245,0.30)");
      glow.addColorStop(1, "rgba(226,232,245,0)");
      g.fillStyle = glow;
      g.beginPath();
      g.arc(cx, cy, r * 3.4, 0, Math.PI * 2);
      g.fill();

      // The unlit disc stays faintly visible — earthshine, and it stops a
      // thin crescent looking like a stray highlight.
      g.fillStyle = "rgba(150,160,180,0.16)";
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();

      /*
        The lit part: the outer limb on one side, closed by the terminator.

        The terminator is a half-ellipse whose width is r*(1-2*lit): positive
        for a crescent, where it curves back over the disc, and negative for
        a gibbous, where it bulges away. Waning is the same shape mirrored,
        so the canvas is flipped rather than the maths duplicated.
      */
      g.translate(cx, cy);
      if (!waxing) g.scale(-1, 1);

      var t = r * (1 - 2 * lit);
      g.fillStyle = "#F2F4FA";
      g.beginPath();
      g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
      g.ellipse(0, 0, Math.abs(t), r, 0, Math.PI / 2, -Math.PI / 2, t > 0);
      g.closePath();
      g.fill();

      g.restore();
    }

    function applySun() {
      var map = window.__map;
      if (!map || !window.__sun) return;

      var alt = window.__sun.altitude;
      var s = SUN_STOPS;
      var lo = s[0];
      var hi = s[s.length - 1];
      var t = 0;
      if (alt <= s[0].alt) { lo = hi = s[0]; }
      else if (alt >= s[s.length - 1].alt) { lo = hi = s[s.length - 1]; }
      else {
        for (var i = 1; i < s.length; i++) {
          if (alt <= s[i].alt) {
            lo = s[i - 1];
            hi = s[i];
            t = (alt - lo.alt) / (hi.alt - lo.alt);
            break;
          }
        }
      }

      function mix(key) {
        var a = lo[key], b = hi[key];
        return "rgb(" +
          Math.round(a[0] + (b[0] - a[0]) * t) + "," +
          Math.round(a[1] + (b[1] - a[1]) * t) + "," +
          Math.round(a[2] + (b[2] - a[2]) * t) + ")";
      }

      try {
        map.setSky({
          "sky-color": mix("sky"),
          "horizon-color": mix("horizon"),
          "fog-color": mix("fog"),
          // Enough haze to read distance, not so much that the far side of
          // the circuit disappears into it.
          "sky-horizon-blend": 0.6,
          "atmosphere-blend": 0.8
        });

        applyGround();
        /*
          Paired with applyGround, and that pairing is the fix for a real bug.

          fadeMask ran in exactly two places: once at load, and on the pitch
          event. Both can miss. At load the style may still be arriving over
          the bridge, so corridor-mask does not exist yet and the call quietly
          no-ops on its own getLayer guard — and if you then look straight
          down without ever tilting, no pitch event ever fires to correct it.
          The mask stays fully opaque and the map is black outside the
          corridor, which is precisely what a flat view in 3D looked like.

          The sun updates on load, on every scrub of the slider and whenever
          the native side pushes a new position, so hanging it here means the
          mask is put right as soon as the layer exists, whatever order things
          arrived in.
        */
        fadeMask();

        // Geographic, because hillshade-illumination-anchor is "map":
        // the shading turns with the sun, not with the camera.
        if (map.getLayer("terrain-hillshade")) {
          map.setPaintProperty(
            "terrain-hillshade",
            "hillshade-illumination-direction",
            Math.round(window.__sun.azimuth) % 360
          );
        }
      } catch (e) {
        post({ stage: "sun-failed", error: String(e) });
      }
    }

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
          /*
            High enough to see the skyline.

            The default cap is 60, which silently clamped the 70 above and kept
            the horizon just off the top of the screen — so there was no sky to
            colour and no ridgeline to read. Which hill the sun goes down behind
            is the question this view answers, and you cannot answer it looking
            down at the ground.

            maxBounds still pins the camera over the circuit, so the far terrain
            is something you look at, never somewhere you can wander off to.
          */
          maxPitch: 82,
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

          /*
            The real sprites, inlined.

            These are the same PNGs the native map registers through
            <Images>, carried in as data URIs by scenerySprites.ts. The page
            has no sprite sheet and cannot read the app's files, so without
            them every scenery layer drew nothing.

            They were briefly flat canvas circles, which did render — as
            green dots. Under two kilobytes buys the actual artwork, at the
            sizes the icon-size ramps in style.ts were tuned against.

            Loading is asynchronous but local, so it finishes in a frame or
            two; MapLibre repaints the layers as each image lands.
          */
          try {
            var SPRITES = ${sceneryUris};
            Object.keys(SPRITES).forEach(function (name) {
              if (map.hasImage(name)) return;
              var img = new Image();
              img.onload = function () {
                if (!map.hasImage(name)) map.addImage(name, img);
              };
              img.onerror = function () {
                post({ stage: "scenery-icon-failed", error: name });
              };
              img.src = SPRITES[name];
            });
            post({ stage: "scenery-icons-added" });
          } catch (e) {
            post({ stage: "scenery-icons-failed", error: String(e) });
          }

          /*
            Ground colour, lifted for the 3D view only.

            The basemap flavour is deliberately near-monochrome — earth is
            #1f1f1f, grassland is rgb(30,41,31), park is #192a24. Flat and
            overhead that reads as a tasteful dark map. Draped over a terrain
            mesh it reads as no map at all: a grey landform with a road on
            it, which is exactly what "no terrain colour" was describing.

            Nothing was being covered up, so nothing could be uncovered.
            The colour has to be put there.

            Done here rather than in buildMapStyle so the flat map keeps the
            palette it was designed with — this is about standing on a hill
            and telling wood from field, which is a question only the 3D
            view asks.
          */
          try {
            applyGround();
            fadeMask();
            post({ stage: "ground-coloured" });
            applySun();
            drawSky();
          } catch (e) {
            post({ stage: "ground-colour-failed", error: String(e) });
          }
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
              /*
                Not clustered any more.

                Clustering hid the waypoints it grouped, replacing several
                pins with one — so a stack told you *that* there were three
                spots on that corner while taking away *where* the three
                were. At a circuit that is the wrong trade: they may be a few
                metres apart and still be three genuinely different shots.

                Every pin now stays where it belongs, and the grouping is
                drawn instead: a hub at the middle of the group with a spoke
                to each member, and the card above the hub. Computed in
                regroup() below, because it depends on screen distance and
                so has to be redone whenever the camera moves.
              */
            });

            // The spokes, under the pins so a line never crosses a target.
            map.addSource("stack-links", { type: "geojson", data: emptySpots });
            map.addLayer({
              id: "stack-link",
              type: "line",
              source: "stack-links",
              paint: {
                "line-color": "#2E7DF6",
                "line-width": 1.4,
                "line-opacity": 0.55
              }
            });

            // The hub each spoke runs to.
            map.addSource("stack-nodes", { type: "geojson", data: emptySpots });
            map.addLayer({
              id: "stack-node",
              type: "circle",
              source: "stack-nodes",
              paint: {
                "circle-radius": ["step", ["get", "count"], 13, 5, 16, 10, 20],
                "circle-color": "#2E7DF6",
                "circle-opacity": 0.9,
                "circle-stroke-color": "#0B0D10",
                "circle-stroke-width": 2
              }
            });
            map.addLayer({
              id: "stack-node-count",
              type: "symbol",
              source: "stack-nodes",
              layout: {
                "text-field": ["to-string", ["get", "count"]],
                "text-font": ["Noto Sans Medium"],
                "text-size": 12,
                "text-allow-overlap": true
              },
              paint: { "text-color": "#0B0D10" }
            });

            map.addLayer({
              id: "spot-halo",
              type: "circle",
              source: "spots",
              paint: { "circle-radius": 12, "circle-color": "#2E7DF6", "circle-opacity": 0.22 }
            });
            map.addLayer({
              id: "spot-pin",
              type: "circle",
              source: "spots",
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
                "text-font": ["Noto Sans Medium"],
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
          map.on("click", "stack-node", function (e) {
            var f = e.features && e.features[0];
            if (!f) return;

            /*
              Ask what is in the stack rather than zooming into it.

              Zooming was the obvious response and the wrong one: it moves
              the camera away from what you were looking at to answer a
              question you could be told the answer to. And at a circuit,
              three spots on one corner may sit within a few metres — the
              zoom that separates them is closer than is useful.

              The members are already known, because this page grouped them
              a frame ago. No second lookup, and nothing asynchronous.
            */
            var g = STACK_GROUPS[f.properties.idx];
            if (!g) return;
            post({
              stack: g.map(function (m) {
                return { id: m.id, name: m.name };
              })
            });
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
            // Only the layers that exist: querying a missing one throws, and
            // an exception here would take the whole tap handler with it.
            var probe = ["spot-pin", "stack-node"].filter(function (id) {
              return !!map.getLayer(id);
            });
            var hits = probe.length ? map.queryRenderedFeatures(e.point, { layers: probe }) : [];
            if (hits && hits.length > 0) return;
            post({ tapMap: { lon: e.lngLat.lng, lat: e.lngLat.lat } });
          });

          /*
            Where each pin is on screen, for the native cards above them.

            The card shows the reference photo, and that photo is a file on
            the device which this page has no way to read. Sending them
            across would mean base64 per spot — hundreds of kilobytes each,
            undoing the whole reason the style is streamed.

            So the page reports where the pins are and the shell draws the
            cards over the top, reusing what the flat map already renders.
            Capped, and skipped when nothing moved, because this runs on
            every frame of a pan.
          */
          var lastMarks = "";
          /*
            Which waypoints are stacked, recomputed as the camera moves.

            Screen distance, not ground distance: two spots a hundred metres
            apart overlap at low zoom and separate at high, so the question
            "do these collide" only has an answer once projected. That is
            also why this cannot live on the native side — it is the page
            that knows where things landed.

            Greedy and single-pass. A proper clustering would be tidier about
            chains of near-neighbours, but for the handful of waypoints on a
            corner the difference is invisible and the cost is not.
          */
          var STACK_GROUPS = [];

          function postMarks() {
            if (!map.getSource("stack-nodes")) return;

            var feats = (window.__spots || emptySpots).features || [];
            var pts = [];
            for (var i = 0; i < feats.length; i++) {
              var ft = feats[i];
              var c = ft.geometry && ft.geometry.coordinates;
              if (!c) continue;
              var pr = map.project(c);
              pts.push({
                id: String(ft.properties.id || ""),
                name: String(ft.properties.name || ""),
                key: String(ft.properties.keyImageKey || ""),
                dim: Number(ft.properties.hidden || 0) === 1 ? 1 : 0,
                lon: c[0],
                lat: c[1],
                x: pr.x,
                y: pr.y,
                taken: false
              });
            }

            var R = ${stackRadius};
            var groups = [];
            for (var a = 0; a < pts.length; a++) {
              if (pts[a].taken) continue;
              pts[a].taken = true;
              var g = [pts[a]];
              for (var b = a + 1; b < pts.length; b++) {
                if (pts[b].taken) continue;
                var dx = pts[b].x - pts[a].x;
                var dy = pts[b].y - pts[a].y;
                if (dx * dx + dy * dy <= R * R) {
                  pts[b].taken = true;
                  g.push(pts[b]);
                }
              }
              groups.push(g);
            }

            STACK_GROUPS = [];
            var links = [];
            var nodes = [];
            var out = [];

            for (var k = 0; k < groups.length; k++) {
              var grp = groups[k];

              if (grp.length === 1) {
                var only = grp[0];
                if (out.length < 12) {
                  out.push({
                    kind: "spot",
                    id: only.id,
                    name: only.name,
                    key: only.key,
                    dim: only.dim,
                    x: Math.round(only.x),
                    y: Math.round(only.y)
                  });
                }
                continue;
              }

              // The hub sits at the average of the members, so it reads as
              // belonging to all of them rather than to whichever happened
              // to seed the group.
              var lon = 0;
              var lat = 0;
              for (var m = 0; m < grp.length; m++) {
                lon += grp[m].lon;
                lat += grp[m].lat;
              }
              lon /= grp.length;
              lat /= grp.length;

              var idx = STACK_GROUPS.length;
              STACK_GROUPS.push(grp);

              nodes.push({
                type: "Feature",
                properties: { idx: idx, count: grp.length },
                geometry: { type: "Point", coordinates: [lon, lat] }
              });

              for (var n = 0; n < grp.length; n++) {
                links.push({
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "LineString",
                    coordinates: [[grp[n].lon, grp[n].lat], [lon, lat]]
                  }
                });
              }

              if (out.length < 12) {
                var hub = map.project([lon, lat]);
                out.push({
                  kind: "stack",
                  id: "stack-" + idx,
                  name: grp.length + " waypoints",
                  key: "",
                  dim: 0,
                  count: grp.length,
                  members: grp.map(function (mm) {
                    return { id: mm.id, name: mm.name };
                  }),
                  x: Math.round(hub.x),
                  y: Math.round(hub.y)
                });
              }
            }

            map.getSource("stack-links").setData({
              type: "FeatureCollection",
              features: links
            });
            map.getSource("stack-nodes").setData({
              type: "FeatureCollection",
              features: nodes
            });

            var json = JSON.stringify(out);
            if (json === lastMarks) return;
            lastMarks = json;
            post({ marks: out, zoom: map.getZoom() });
          }

          map.on("move", postMarks);
          map.on("moveend", postMarks);
          // The sky is drawn from the camera, so it has to be redrawn whenever
          // the camera changes — turning is what makes it read as sky.
          map.on("move", drawSky);
          map.on("rotate", drawSky);
          // So a settings change can ask for a repaint without waiting for
          // the camera to move — turning stars off should be immediate.
          window.__redrawSky = drawSky;
          map.on("pitch", drawSky);
          map.on("pitch", fadeMask);
          window.addEventListener("resize", drawSky);
          // Spots arriving after the first paint would otherwise show a pin
          // with no card until something moved.
          map.on("sourcedata", function (e) {
            if (e.sourceId === "spots" && e.isSourceLoaded) postMarks();
          });
          // Grouping is a function of the projection, so a pitch or a rotation
          // changes it as surely as a pan does.
          map.on("rotate", postMarks);
          map.on("pitch", postMarks);

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
  mediaUris = {},
  sunAt,
  weather,
  stars = true,
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
  /** Local file URIs by media key, for the reference photo on each card. */
  mediaUris?: Record<string, string>;
  /**
   * The instant to light the map for — the shared map clock.
   *
   * Defaults to now so the component still works standalone, but the map
   * screen passes `clock.now`, which is what ties this to the time slider.
   */
  sunAt?: Date;
  /** Cover and rainfall for the hour on screen, from the venue forecast. */
  weather?: { readonly cover: number; readonly rain: number };
  /**
   * Draw the star field — TASKS.md F8.
   *
   * The moon is deliberately not covered by this. Stars are atmosphere;
   * the moon's position and phase are information, and a performance
   * setting should not quietly remove the answer to "will there be any
   * light at midnight".
   */
  stars?: boolean;
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

  /**
   * Where the sun is, for the time the map is showing.
   *
   * Driven by `sunAt` — the shared map clock — rather than by a timer of its
   * own. That is what connects the sky and the terrain shading to the slider:
   * scrub to 19:30 and the hills light from the west, because useMapClock
   * stops ticking the moment you scrub and `now` becomes the chosen time.
   *
   * A private setInterval here would have re-lit the map from the real
   * present a minute later and silently undone the scrub — the second
   * independent clock useMapClock's own notes warn about.
   *
   * The astronomy stays on this side, in the module the dial already uses and
   * that has tests: the page is told an azimuth and an altitude and does
   * nothing but colour with them.
   */
  useEffect(() => {
    const [slon, slat] = VENUE_VIEW[venue].centre;
    // Fallback computed inside the effect, not as a destructuring default:
    // `new Date()` in the parameter list would be a fresh object on every
    // render, so the dependency would always differ and this would re-inject
    // forever.
    const when = sunAt ?? new Date();
    const site = { latitude: slat, longitude: slon };
    const moon = moonState(when, site);
    const payload = {
      sun: solarPosition(when, site),
      // Only what the page draws with. rise/set are Dates and belong to the
      // planner, not to a canvas.
      moon: {
        azimuth: moon.azimuth,
        altitude: moon.altitude,
        phase: moon.phase,
        illumination: moon.illumination,
      },
    };
    webRef.current?.injectJavaScript(
      `window.__setSun && window.__setSun('${JSON.stringify(payload)}'); true;`,
    );
  }, [venue, sunAt, pageEpoch, ready]);

  /** Whether the page draws stars, forwarded like any other setting. */
  useEffect(() => {
    webRef.current?.injectJavaScript(
      `window.__stars = ${stars ? 'true' : 'false'}; window.__redrawSky && window.__redrawSky(); true;`,
    );
  }, [stars, pageEpoch]);

  /** Cover and rainfall, forwarded whenever the forecast or the hour moves. */
  useEffect(() => {
    if (!weather) return;
    webRef.current?.injectJavaScript(
      `window.__setWeather && window.__setWeather('${JSON.stringify(weather)}'); true;`,
    );
  }, [weather, pageEpoch]);

  /** Pin positions in CSS pixels, which are device-independent pixels here. */
  const [marks, setMarks] = useState<Mark[]>([]);
  const [markZoom, setMarkZoom] = useState(0);

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
              marks?: Mark[];
              zoom?: number;
            };
            if (m.marks) {
              setMarks(m.marks);
              setMarkZoom(typeof m.zoom === 'number' ? m.zoom : 0);
              return;
            }
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

      {/*
        The cards above the pins.

        Positioned from coordinates the page projects, so they track the
        terrain: a pin on a hillside sits at its own elevation, and the card
        has to follow it rather than the flat ground beneath.

        Zoom-gated at the same threshold the flat map uses, where cards start
        overlapping into an unreadable pile.
      */}
      {markZoom >= CALLOUT_MIN_ZOOM &&
        marks.map((mk) => {
          const uri = mk.key ? mediaUris[mk.key] : undefined;
          return (
            <Pressable
              key={mk.id}
              onPress={() => {
                // A hub is not a waypoint. It answers "what is under here",
                // which is the list, not one spot's sheet.
                if (mk.kind === "stack") {
                  setStack(mk.members ?? []);
                  highlight(null);
                  return;
                }
                onOpenSpot?.(mk.id);
              }}
              style={[
                styles.callout,
                { left: mk.x - CALLOUT_W / 2, top: mk.y - CALLOUT_H - 16 },
                mk.dim === 1 && styles.calloutDim,
              ]}
            >
              {mk.kind === "stack" ? (
                <View style={[styles.calloutImage, styles.calloutStack]}>
                  <Text style={styles.calloutStackCount}>{mk.count ?? 0}</Text>
                </View>
              ) : uri ? (
                <Image
                  source={{ uri }}
                  style={styles.calloutImage}
                  // contain, not the default cover: a reference photo that
                  // has been re-cropped to fit is no longer the framing the
                  // waypoint is about.
                  resizeMode="contain"
                />
              ) : (
                <View style={[styles.calloutImage, styles.calloutEmpty]}>
                  <Text style={styles.calloutEmptyText}>no photo</Text>
                </View>
              )}
              <Text style={styles.calloutName} numberOfLines={1}>
                {mk.name}
              </Text>
            </Pressable>
          );
        })}

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
        {/*
          Diagnostics belong to the standalone spike, not to the map.

          Embedded there is no onClose, and a wall of stage names over the map
          is just noise on top of somebody's circuit — it was appearing every
          time 3D was opened. Standalone it is still the fastest way to see
          where a load stopped.
        */}
        {!ready && onClose !== undefined && (
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
/** One pin, as the page sees it on screen. */
type Mark = {
  id: string;
  name: string;
  key: string;
  /** 1 when the spot is hidden, matching the flat map's dimmed card. */
  dim: number;
  /**
   * "stack" is the hub standing in for a group, not a waypoint of its own.
   *
   * Read defensively rather than switched on, so a mark from before this
   * existed still renders as the waypoint it is.
   */
  kind?: string;
  count?: number;
  members?: { id: string; name: string }[];
  x: number;
  y: number;
};

/*
 * The card's size, in the code rather than only in the stylesheet.
 *
 * The overlay positions each card by its top-left corner, so it has to know how
 * wide and tall the card is to centre it over the pin and sit it above.
 */
const CALLOUT_W = 124;
const CALLOUT_H = 78;

/** Matches the flat map: below this, cards overlap into an unreadable pile. */
const CALLOUT_MIN_ZOOM = 13;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0D10' },

  /*
   * Map furniture, so fixed dark values rather than theme tokens — the same
   * reasoning as the rest of this screen's chrome, which floats on an
   * always-dark basemap and would go near-invisible in a light theme.
   */
  callout: {
    position: 'absolute',
    width: CALLOUT_W,
    height: CALLOUT_H,
    borderRadius: 8,
    backgroundColor: 'rgba(11,13,16,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  calloutDim: { opacity: 0.45 },
  calloutImage: { width: '100%', height: 54 },
  calloutEmpty: {
    backgroundColor: '#141922',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calloutEmptyText: { color: '#6E7C8A', fontSize: 10 },
  /*
   * A hub shows how many are under it rather than a photo.
   *
   * There is no one photo that would be the right one — picking a member's
   * would claim it represents the group, and the whole reason the hub exists
   * is that the members are different shots of the same corner.
   */
  calloutStack: { backgroundColor: '#16233A' },
  calloutStackCount: { color: '#7FB0FF', fontSize: 26, fontWeight: '700' },
  calloutName: {
    color: '#F2F5F8',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
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
