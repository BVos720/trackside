# Trackside: UI and map atmosphere handoff

Updated 2026-09-16. Read this alongside `AGENTS.md` before continuing this work.

## User intent and authority

The user requested a creative frontend redesign across menus, fonts, layouts and animations while preserving working functionality. Follow-up requirements: improve the map's existing night/sunset/weather visuals; dynamic volumetric rain and clouds driven by real weather and the existing time slider; sun-driven terrain shadows; careful overlap and spacing; this local context file for subsequent models. No deployment, release, commit or account/data changes were requested.

`AGENTS.md` requires reading **https://docs.expo.dev/versions/v57.0.0/** before writing code. This app is Expo SDK 57, React Native 0.86, React 19.2.3. Do not apply old Expo assumptions. Native MapLibre requires a development build, not Expo Go. Preserve the safety acknowledgement and all existing local storage/import/export behavior.

## Design direction

A motorsport field guide: warm off-white in light mode, graphite surfaces in dark mode, restrained user-selected accent color, generous space and clear hierarchy. Inter regular/semibold is used for reading and controls; Barlow Condensed semibold is used for larger display headings. Fonts are bundled through `@expo-google-fonts/*` and loaded by `expo-font`; no runtime font CDN. `Typography.tsx` wraps native Text/TextInput, preserves explicit font families, selects real font faces, and falls back to platform fonts if loading fails. ErrorBoundary intentionally remains independent.

- `src/ui/theme.ts`: common colors, radii, spacing and type scale. Existing light/dark/system and accent preferences remain.
- `src/ui/MainMenu.tsx`: branded side drawer, current-location context, stable navigation order, selected destination, photography/spectating modes and quick return to the active event.
- `src/ui/PageHeader.tsx`: shared editorial heading and supporting copy.
- `src/ui/Motion.tsx`: interruptible entrance animations using core Animated; observes reduced-motion preferences.
- `src/ui/Collapsible.tsx`: spacious disclosure rows, explicit expanded accessibility state, quieter badges and animated content.
- Events, Event, Circuit and Profile screens use readable centered content (maximum 760px). Circuit terrain downloads are grouped under a disclosure. Spot row actions are behind an overflow toggle so they do not squeeze names and images.

## Layout and overlap rules

The map remains edge-to-edge. Safe-area insets apply to controls, not to the map itself. `MENU_TOP`, `MENU_HEIGHT` and `MENU_CLEARANCE` remain shared.

`App.tsx` measures the bottom action row and sends `controlsBottom` to MapScreen. SkyControl reports its actual height with `onHeightChange`; map screens suppress the optional sun dial when insufficient vertical room remains. Map chrome is hidden while the spot sheet, list or navigator is active. The full list sheet clears the top navigation and respects the bottom safe area. Circuit measurements now open from a compact button into a modal instead of permanently occupying a large block of the map. Short-screen web camera controls yield to the timeline; map gestures remain available.

Always check 320–390px widths, large text, notches/home indicators, a long circuit/event name, an expanded timeline, active-event navigation, placing a spot, and both sheet heights. Do not place new controls using isolated absolute offsets without checking these stacks.

## Map rendering architecture

Native: `src/ui/screens/MapScreen.tsx` owns one `useMapClock`, `useVenueConditions`, the sun dial and SkyControl. 2D uses MapLibre Native. 3D uses `TerrainSpike.tsx` (despite its historical name, it is the working embedded terrain renderer). That file builds a large HTML/JS page in a WebView, with MapLibre GL 5.6 loaded from a CDN and a bridge for local tiles, spots, route, weather and sun. Do not replace its bridge casually. The existing 3D network requirement remains.

Web: `MapScreen.web.tsx` uses MapLibre GL directly. It now has the same clock/timeline and forecast source. `src/ui/map/webAtmosphere.ts` manages the weather layers, terrain shadow raster and GPU/animation cleanup.

Shared visual kernels:

- `src/ui/map/atmosphereShaders.ts`: world-space rain quads with tapered translucent streaks, perspective length, gentle illustrative drift and rainfall-dependent particle count. Cloud volume uses 16 back-to-front slices of a 3D density field, sun-direction self-shading, dark undersides and sunset tint. Depth testing lets terrain occlude these effects.
- `src/core/logic/terrainShadow.ts`: sampled DEM horizon tracing. Sun direction is converted into metre-correct steps for rectangular grids; missing heights do not become fabricated zero elevations. Shadows shorten with higher sun and fade at the horizon or with cloud cover.
- `TERRAIN_SHADOW_FUNCTION`: explicit source string for the native WebView, tested for parity with the typed kernel. **Never replace this with `function.toString()` at runtime: Hermes bytecode does not retain reliable function source.**
- Both weather renderers cap continuous repaints near 30fps and respect reduced motion. Native warming passes `active={terrain3d}` to stop weather animation while 3D is hidden. GPU buffers/programs are released on layer removal.

The native bridge sends the selected timestamp (`epoch`) alongside solar/lunar positions. Clouds use a fixed venue origin, not the moving camera centre. The forecast controls cloud cover and hourly rainfall; sun calculations control lighting and terrain shadows. Particle/cloud arrangement, drift and cloud altitude are illustrative, not meteorological measurements. Cloud height is kept above the camera to preserve map legibility. These are layered volumetric effects, not a full ray-traced atmosphere. Terrain shadows are DEM-derived; building/tree shadow maps and exact cloud-shadow matching are not implemented. Missing/out-of-range forecast data still yields no precipitation/cloud effect through the existing hook.

## Validation and environment

- `npm run typecheck`
- `npm test -- --reporter=dot`
- `node scripts/check-map-renderer.mjs`: extracts the actual native HTML builder, checks its emitted JavaScript parses, verifies shared shader embedding and the standalone shadow source. TS checking alone cannot validate JavaScript inside HTML strings.
- `npx expo export --platform all --output-dir dist-ui-review`: production JS/Hermes compilation for all targets. The generated review directory is ignored.

This session could not open a browser: both browser discovery and the in-app browser reported unavailable. No physical phone/simulator was connected. Do not claim screenshots, GPU shader compilation on a real graphics context, visual approval or device performance measurements from this session. Production bundle checks do not prove GPU rendering or touch layout. On-device checks should cover clear/rainy/overcast forecasts, daytime/sunset/night, scrubbing across midnight and back, both hemispheric compass directions, steep and flat venues, panning, 2D/3D toggling, and reduced motion.

On this Windows environment Vitest/Hermes may fail with `spawn EPERM` inside the sandbox; approved execution outside the sandbox works. The user's npm configuration contains an `allow-scripts` setting rejected by npm 12 for project installs. Font installation used `npm install ... --ignore-scripts --userconfig=NUL`; no user/global configuration was edited. Existing audit vulnerabilities were reported by npm; dependency upgrades outside the font addition are not part of this task.

Final check results are recorded below after verification completes.
