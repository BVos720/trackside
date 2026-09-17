# Trackside

A motorsport field guide for photographers and spectators: find a place to stand, plan a race weekend, follow the light, and keep your circuit notes with you.

Trackside is an Expo / React Native application for Android and iOS, with a browser preview. Its core workflow runs on local data: bundled circuit maps, saved spots, event timetables, entry lists, gear, and walking plans. There is no application account, hosted backend, or cloud sync implementation.

**Project status:** active development. The current source includes the UI overhaul and the map lighting work described below. Automated tests and production JavaScript/Hermes exports pass; that does not establish that every feature has been verified on every device.

## Contents

- [What you can do](#what-you-can-do)
- [Circuits](#circuits)
- [Map visuals and lighting](#map-visuals-and-lighting)
- [Offline behavior and platform differences](#offline-behavior-and-platform-differences)
- [Getting started](#getting-started)
- [Development commands](#development-commands)
- [Architecture](#architecture)
- [Data, backups, and imports](#data-backups-and-imports)
- [Preparing circuit assets](#preparing-circuit-assets)
- [Validation](#validation)
- [Known limitations and planned work](#known-limitations-and-planned-work)
- [Project documents](#project-documents)
- [Attribution and licensing](#attribution-and-licensing)

## What you can do

### Keep a circuit notebook

- Browse bundled maps and switch between supported venues.
- Create, rename, edit, move, hide, and delete spots.
- Save notes, access classifications, tags, preferred times, shooting direction, and shot settings.
- Attach reference photos, select a key image, and adjust its focal point and crop.
- Store focal lengths as full-frame equivalents with their crop-factor basis.
- Open a spot list over the map, filter the collection, and inspect overlapping map callouts through grouped cards.

The safety acknowledgement and navigation warnings are part of the app. A saved spot, mapped path, or estimated route is not permission to enter an area; access is recorded explicitly rather than inferred from scenery.

### Organize an event

- Create an event with a circuit, name, and date range.
- Start from copies of your permanent circuit spots, keeping the event collection separate.
- Keep an event's timetable, entry list, plan, weather, gear, and backup controls on one page.
- Select an active event and return to it from the map or navigation drawer.
- Export an event and import it later as a restore/replacement or a separate copy, with a preview of the consequences.

### Read timetables and entry lists

- Pick a PDF, paste text, or enter sessions manually.
- Use deterministic parsing first, then map columns when a document needs help.
- Review and edit extracted rows before saving them.
- Save reusable column-mapping templates.
- Group sessions by day and edit their titles and times.
- Track cars, teams, drivers, classes, and photographed status in event entry lists.

PDF text extraction uses bundled PDF.js. Native extraction runs inside a hidden WebView; web uses its browser implementation. The main import UI does not require a hosted AI service or Ollama.

### Plan a route through your day

- Add ordered stops with arrival times and free-text purposes.
- Select a matching timetable session from the stop editor.
- Reorder or remove stops and start navigation from a stop.
- See walking estimates, leave-by times, and warnings when consecutive stops do not fit.
- Switch days using the event's date range.

Walking calculations use an extracted path network, prefer walkable paths, and treat the racing surface as a barrier. The current estimate uses 75 metres/minute, double cost for off-network distance, setup time, and a safety margin. Estimates are rounded up; gates, crowding, closures, and staff instructions can still make a route unusable.

The navigator combines live location, available compass heading, route geometry, and persistent safety guidance. Location accuracy affects whether the app can confidently choose the correct side of a track.

### Pack gear and personalize the app

- Maintain camera bodies and lenses in the profile's gear locker.
- Record camera crop factors and choose which items to bring to an event.
- Choose light, dark, or system appearance and a custom accent hue.
- Use the photography/spectating modes and map graphics controls.
- Adjust available scenery, rain, stars, shading, shadows, and scenery-distance preferences.

The UI uses bundled Inter for reading and controls, Barlow Condensed for display headings, opaque surfaces, and a shared spacing system. Current planning, weather, and gear panels use larger touch targets, wrapping content, and explicit empty states. Entrance/disclosure motion observes reduced-motion preferences.

## Circuits

| Venue key | Circuit |
| --- | --- |
| `nordschleife` | Nürburgring Nordschleife |
| `spa-francorchamps` | Spa-Francorchamps |
| `zandvoort` | Zandvoort |
| `le-mans` | Le Mans — partial circuit geometry |
| `zolder` | Zolder |
| `suzuka` | Suzuka |
| `fuji` | Fuji Speedway |

Each venue has committed map/circuit assets. Circuit geometry, paths, buildings, woodland scatter, and basemap extracts have different sources and levels of completeness. Le Mans' public-road sections require additional preparation; a map covering the area does not mean the extracted lap is complete.

## Map visuals and lighting

The map has three rendering paths:

| Path | Renderer |
| --- | --- |
| Native 2D | `@maplibre/maplibre-react-native` |
| Native 3D | MapLibre GL inside the `TerrainSpike.tsx` WebView |
| Web | MapLibre GL directly in the browser |

`TerrainSpike.tsx` retains its historical filename, but it is the native terrain renderer. Native 3D now uses the selected venue's scenery, including flat circuits; the old Nürburgring substitution has been removed.

### Light and weather

- A shared time slider controls the scene timestamp, solar/lunar calculations, and forecast hour.
- Solar direction controls hillshading, extruded-building light, and cast-shadow direction.
- Daylight, sunset, twilight, and night change the sky and atmosphere.
- Rain uses world-space streaks with terrain depth testing and forecast-driven intensity.
- Clouds use a layered density field with lit edges, darker interiors, and sunset tint.
- Native and web include mist effects. Mist is illustrative; it is not a measured fog forecast, and the two renderers use different ground sampling.
- Native includes its existing star/moon sky. Web adds a depth-tested star field and an enlarged moon using the current lunar direction and solar illumination direction.

### Shadows

- **Terrain:** a sampled elevation-grid horizon test detects where terrain blocks direct sunlight. Shadows weaken near the horizon and under cloud cover.
- **Buildings:** footprint silhouettes are projected away from the sun using the rendered building height; the existing 6-metre visual fallback is used where height is absent.
- **Trees:** visible woodland sprites receive projected canopy silhouettes. The underlying scatter, canopy size, and 10-metre tree height are illustrative.
- **Clouds:** the ground-shadow shader samples the same density field and drift as the visible cloud volume along the sun direction. A small image is draped onto terrain and refreshed at most every two seconds during continuous motion; direct state changes can refresh it sooner.

Clouds have a stable modelled height above the venue instead of being lifted whenever the camera zooms out. Their visible volume fades as the camera rises through it, while their ground projection stays fixed. Daily drift is periodic, avoiding a discontinuity at midnight.

These effects are visual approximations, not a surveyed visibility or exposure model. Building silhouettes simplify concave roofs and use a local ground-plane projection; cloud shadows also use a reference ground height before being draped onto terrain. They do not compute exact intersections with every slope, roof, or tree. The cloud arrangement is generated, not an observation of actual clouds. The star field is illustrative, not a labelled astronomical catalogue.

Continuous weather rendering is limited to approximately 30 fps. Cloud-shadow updates are much less frequent. Hidden/inactive views and reduced-motion settings stop continuous effect work, and cleanup releases timers, layers, sources, and allocated graphics resources. Tree-shadow generation is capped at 1,500 visible unique symbols per update.

### Shared renderer development

`src/ui/map/sceneLighting.ts` is the shared scenery/cloud-shadow implementation. Web imports it directly. Native embeds a generated copy, because Hermes release bytecode cannot reliably supply function source at runtime.

After changing that module, its shadow helpers, or its shared shaders, run:

```sh
node scripts/build-scene-lighting.mjs
node scripts/check-map-renderer.mjs
```

Commit `src/ui/map/sceneLightingSource.ts` with the source change. Do not edit it by hand. The renderer check rejects a stale generated copy and syntax-checks the JavaScript actually emitted by the native HTML builder.

## Offline behavior and platform differences

| Capability | Android / iOS | Browser preview |
| --- | --- | --- |
| Basemap and circuit geometry | PMTiles and geometry bundled in the app | Requires the matching files under `public/tiles/` and a running/static server |
| Map label fonts | Bundled Latin glyphs; remote fallback if local setup fails | Local public glyph files |
| Events, spots, sessions, entries, preferences | Local SQLite-backed key/value records | `localStorage`; browser storage limits apply |
| Reference photo bytes | App document storage; durable across restarts | In-memory blobs; lost on page reload |
| Event bundle files | App document directory plus file-picking/import workflow | Download/upload workflow |
| PDF extraction | Bundled PDF.js and worker in a WebView | Local PDF.js worker |
| Event weather | Cached forecast with fresh/stale status | Same forecast logic, backed by browser storage |
| Map weather | Venue forecast held in memory; missing/out-of-range data produces no rain/cloud effect | Same behavior |
| Elevation tiles | Explicit terrain download/cache support exists | Remote terrain with ordinary browser HTTP caching |
| Native 3D runtime | The embedded renderer still loads MapLibre GL from a CDN and uses remote terrain requests | Not applicable; web bundles MapLibre GL |

The bundled native 2D map is the offline foundation. Do not assume that downloading elevation tiles makes the WebView's entire 3D path offline: its runtime and tile dependencies still need separate verification. A web export is not an installed offline PWA; there is no service-worker offline guarantee.

Fresh weather requires network access to MET Norway. Elevation, the native terrain runtime, and fallback fonts can make external requests. Venue weather uses circuit coordinates, not a live-location feed to an application server. See the source and [PRIVACY.md](PRIVACY.md); that policy remains a draft with placeholders and some historical descriptions that need updating before publication.

## Getting started

### Requirements

- Node.js 22.13 or newer for this Expo SDK generation.
- npm. This repository's lockfile workflow uses npm 10 to match its existing build setup.
- Android Studio/SDK and a compatible JDK for local Android builds. This repository's Windows build notes use JDK 17.
- macOS and Xcode for local iOS builds. EAS can build iOS remotely from Windows or other platforms; signing/distribution has its own requirements.
- A development build for native testing. **Expo Go does not contain the required native MapLibre module.**

Read the exact [Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/) before changing Expo-dependent code, as required by [AGENTS.md](AGENTS.md). Do not substitute instructions for an older SDK.

### Install and check

From the repository root:

```sh
npx npm@10 ci
npm run typecheck
npm test
node scripts/check-map-renderer.mjs
```

The `postinstall` script copies PDF.js assets from dependencies. If install scripts were intentionally disabled, run `npm run pdfjsassets` before using PDF import or building the app.

Existing machine-specific npm configuration may reject an `allow-scripts` setting under newer npm versions. Resolve that in the install invocation/configuration; do not solve it by deleting the lockfile or silently upgrading the SDK. After dependency changes, regenerate the lockfile with the repository's npm version and verify a clean install.

### Android

```sh
npm run android
```

This invokes `expo run:android`. For an existing development build, start Metro with `npm start` and connect the device to it. Native dependency or Expo config-plugin changes require a native rebuild; ordinary TypeScript edits can hot-reload.

### iOS

On a Mac with the required toolchain:

```sh
npm run ios
```

For EAS, the repository defines these profiles in [eas.json](eas.json):

| Profile | Purpose |
| --- | --- |
| `development` | Internal development client; Android APK and physical iOS device configuration |
| `preview` | Internal app distribution; Android APK |
| `production` | Store-oriented build; Android app bundle and automatic version increment |
| `ios-simulator` | iOS simulator build |

For example, `npx eas-cli build --platform android --profile development` requests an Android development build. Read [EAS.md](EAS.md) as historical setup context and verify current signing requirements before distributing. No build or deployment happens merely by cloning the project.

### Browser preview

The committed PMTiles files must also be available at web URLs. Copy the existing assets; re-extraction is unnecessary for a normal checkout.

PowerShell:

```powershell
New-Item -ItemType Directory -Force public/tiles
Copy-Item assets/tiles/*.pmtiles public/tiles/
npm run web
```

macOS/Linux:

```sh
mkdir -p public/tiles
cp assets/tiles/*.pmtiles public/tiles/
npm run web
```

The browser is useful for layout iteration but is not equivalent to native persistence, permissions, or GPU behavior. Keep important reference photos on the native app or separately; the web media store does not survive a reload.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the Expo development server |
| `npm run android` | Build/run Android locally |
| `npm run ios` | Build/run iOS locally |
| `npm run web` | Start the browser preview |
| `npm run typecheck` | TypeScript without emitting files |
| `npm test` | Run Vitest |
| `npm run test:watch` | Watch the test suite |
| `npm run tiles` | Extract/download per-venue PMTiles; also writes web copies |
| `npm run circuits` | Extract circuit geometry |
| `npm run scenery` | Extract buildings and generate woodland/field detail |
| `npm run paths` | Extract walking networks |
| `npm run sprites` | Build map sprite assets |
| `npm run glyphs` | Prepare bundled glyph ranges |
| `npm run pdfjsassets` | Copy PDF.js/worker assets |
| `npm run build-info` | Refresh build metadata |
| `node scripts/build-scene-lighting.mjs` | Generate the native lighting bridge |
| `node scripts/build-scene-lighting.mjs --check` | Check generated bridge freshness |
| `node scripts/check-map-renderer.mjs` | Check native emitted JS and shared renderer embedding |
| `npx expo export --platform all --output-dir dist-ui-review` | Compile production web JS and Android/iOS Hermes bundles |

Exporting bundles is not an APK/IPA build, store submission, or deployment. The `dist-ui-review/` output is ignored by Git.

## Architecture

| Area | Responsibility |
| --- | --- |
| `App.tsx` | Application composition, screen/navigation state, repositories, and feature wiring |
| `src/core/domain/` | Events, spots, entries, gear, media, branded IDs, planning types |
| `src/core/logic/` | Parsing, mapping, routes, walking estimates, astronomy, forecasts, shadows, filtering, bundles, and import planning |
| `src/core/repositories/` | Persistence interfaces used by the app |
| `src/storage-local/` | Device/browser adapters, document repositories, SQLite KV, media, files, PDF bridge, forecasts, preferences |
| `src/storage-local/db/` and `drizzle/` | Relational schema and migration history |
| `src/ui/screens/` | Feature screens, sheets, navigator, native/web maps, and embedded terrain renderer |
| `src/ui/state/` | Hooks connecting repositories, location, clock, and weather to screens |
| `src/ui/map/` | Map style, controls, scenery sprites, atmosphere shaders, shared lighting, generated native bridge |
| `src/ui/theme.ts`, `Typography.tsx`, `Motion.tsx` | Appearance, bundled font selection, and motion behavior |
| `assets/circuits/` | Venue geometry, walking/scenery data |
| `assets/tiles/`, `assets/glyphs/`, `assets/sprites/` | Bundled map resources |
| `assets/pdfjs/`, `public/pdf.worker.min.mjs` | Native/browser PDF runtime resources |
| `public/fonts/`, `public/tiles/` | Resources served to the browser |
| `scripts/` | Asset preparation, PDF diagnostics, renderer generation/validation, build metadata |

The core is independent of React Native and storage implementations. Platform-specific `.web.ts`/`.web.tsx` adapters are selected by Metro. Repository interfaces isolate the UI from storage details.

The checked-in Drizzle schema is not a claim that every repository uses relational tables today: the current document repositories store versioned collections through the key/value adapter. On native that adapter uses Expo SQLite; on web it uses `localStorage`.

`src/storage-local/ollama.ts` contains an optional local model client and extraction support. Its current defaults point at `http://localhost:11434` and `gemma3:4b`. It is not wired into the current main timetable import screen, and an Ollama installation is not required to run Trackside.

## Data, backups, and imports

Domain entities use UUID v7/branded IDs and soft-delete tombstones. Deleting domain data and the developer reset operation are different: the latter clears records and photos outright and is intended for disposable test state.

Events own copies of their spots. Editing or removing an event copy should not modify the permanent circuit collection. Entry-list car numbers remain strings so values such as `07` and `24A` are preserved.

Event backups use the versioned `trackside.event.v1` JSON format. They contain the event, event spots, sessions/day headings, and entries including photographed status. The event carries its ordered stops and gear references.

**A bundle is not a full device backup.** It does not embed photo bytes or the entire profile gear inventory, preferences, terrain cache, and application state. References to local-only resources may not resolve on another installation; import previews explain applicable losses/conflicts.

- **Restore/replace** retains the event's identity and can replace matching local state.
- **Import a copy** remints identities and rewrites relationships to avoid sharing one event's records with another.
- Import planning and validation happen before applying mutations.
- The KV-backed import spans multiple records; it is not a database-wide transaction.

Native bundle files are kept in the app's document area, with auto-save/manual save behavior. Web offers downloads. Keep exported files somewhere outside the app sandbox if they need to survive uninstalling it.

## Preparing circuit assets

Normal development uses committed assets. The preparation scripts are for refreshing data or adding a venue; they can download data and require network access.

1. Add/review the extraction rectangle in `scripts/venues.json`. These rectangles are extraction bounds, not authoritative circuit/access metadata.
2. Install the PMTiles CLI at `tools/pmtiles/pmtiles` or `tools/pmtiles/pmtiles.exe` when running tile extraction. The script points to the upstream release location if it is missing.
3. Run the relevant `tiles`, `circuits`, `scenery`, and `paths` scripts. They support per-venue usage such as `npm run tiles -- nordschleife`; consult each script's header for its inputs.
4. Register the assets and venue metadata in `src/ui/map/style.ts` and review the geometry, labels, route barriers, and venue bounds.
5. Check both renderers and regenerate any affected sprite/glyph resources.

OSM-derived building footprints and mapped woodland boundaries are distinct from generated tree/plant scatter. Do not use illustrative scatter as surveyed vegetation or derive access permission from it. Public-road circuits and incomplete source data need human review.

Circuit-pack distribution is a documented plan, not an implemented download catalogue. Adding a bundled venue still requires code/asset changes and a new app build.

## Validation

Verified during the September 17, 2026 work:

- TypeScript checks pass.
- **908 tests across 58 files pass.**
- Native emitted JavaScript parses and the generated lighting bridge matches its web source.
- Production exports succeed for web, Android, and iOS, including Hermes bytecode.

Tests cover core calculations and invariants, real timetable/entry-list fixtures, import/export behavior, repositories, state hooks, and mocked map-lighting lifecycle behavior. The lighting tests exercise both the direct web implementation and the generated native implementation.

They do **not** compile shaders in a physical GPU context or establish touch layout, frame rate, thermal behavior, or photo/PDF behavior on a particular phone. This session had no available browser surface or connected device for visual review.

Before treating the latest visuals as device-verified, check daylight/sunset/night, clear/overcast/rain, midnight scrubbing, camera pitch/zoom, scenery/shadow switches, all venues, reduced motion, backgrounding, and repeated 2D/3D transitions. Inspect long names, 320–390px widths, large text, safe areas, and the keyboard with planner suggestions. Exercise local data and photo persistence after a restart, and test offline behavior on a release build with Metro disconnected.

On a restricted Windows environment, Vitest or Hermes can fail with `spawn EPERM` before the app is tested. Use an approved execution environment for those tools; a process-launch restriction is not a test result.

## Known limitations and planned work

- The latest visual effects still need GPU/device review; the projected shadow models have the approximations described above.
- Native and web mist/sky implementations are not pixel-identical. Graphics capabilities and browser media persistence differ.
- Native 3D retains CDN/runtime and remote terrain dependencies; full offline 3D is not established by an elevation download alone.
- Le Mans circuit extraction is partial, and bundled glyph coverage is Latin rather than a complete CJK set.
- Scanned/image-only PDFs without usable text may require a different workflow; there is no general OCR import implementation.
- Document import is not a multi-key atomic transaction. Web storage can be restricted or exhausted, and browser photo blobs are temporary.
- Cloud synchronization, accounts, premium billing, circuit-pack distribution, and a surveyed DSM viewshed are not implemented features.
- Existing privacy/terms and build handoff documents contain placeholders or historical statements. Review them before distribution; the weather client's contact identifier also has a documented release-readiness issue.

## Project documents

| Document | Use |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Repository instructions, including versioned Expo docs |
| [UI_CONTEXT.md](UI_CONTEXT.md) | Current UI/map rendering handoff and visual validation notes |
| [STATUS.md](STATUS.md) | Historical implementation/build status; some entries are superseded |
| [TASKS.md](TASKS.md) | Broad task history and development backlog |
| [TASKS-profile.md](TASKS-profile.md) | Profile, theme, gear, and graphics work |
| [TASKS-pdf-mapping.md](TASKS-pdf-mapping.md) | PDF column-mapping work |
| [TASKS-map-sky.md](TASKS-map-sky.md) | Map/sky planning context |
| [TASKS-3d-terrain.md](TASKS-3d-terrain.md) | Terrain work and historical experiments |
| [TASKS-circuit-packs.md](TASKS-circuit-packs.md) | Proposed downloadable circuit architecture |
| [TASKS-premium.md](TASKS-premium.md) | Proposed premium model; not a shipped paywall |
| [HANDOFF.md](HANDOFF.md), [HANDOFF-entry-lists.md](HANDOFF-entry-lists.md) | Earlier feature handoffs |
| [QUESTIONS-for-branco.md](QUESTIONS-for-branco.md) | Product decisions requiring context |
| [EAS.md](EAS.md), [eas.json](eas.json) | Build notes and actual EAS profile configuration |
| [PRIVACY.md](PRIVACY.md), [TERMS.md](TERMS.md) | Draft distribution documents |

Use current source and checks to resolve contradictions with old handoffs. A task document's proposal or checkbox is not evidence that a feature is available in the app.

## Attribution and licensing

The repository includes an [MIT license file](LICENSE), retaining its Expo copyright notice. Third-party code, fonts, map data, and optional model weights have their own licenses and attribution requirements.

Trackside uses OpenStreetMap-derived geography and displays **© OpenStreetMap contributors** in the map UI. Protomaps supplies the basemap tooling/style foundation; MapLibre supplies rendering; MET Norway supplies forecast data; terrain comes from the configured Terrarium elevation endpoint. PDF.js provides document text extraction, and SunCalc supplies solar/lunar calculations.

Keep map and weather credits visible. Review the existing distribution documents, asset notices, and any optional model terms before packaging a public release.
