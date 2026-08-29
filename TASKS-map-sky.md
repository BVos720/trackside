# Map sky — sun on the map, and weather you can scrub

Two objectives, both partly built already by a single session on 21 August.
**Read "State on disk" before planning anything** — most of the structure
exists, and the work left is finishing, verifying and making it look right,
not starting over.

**Checkboxes mean "an agent may take this".**

---

## Changed on 22 August — read before picking anything up

Branco revised the objectives after seeing it running. Three things moved:

1. **The weather overlay on the map is cancelled and must be removed.** It was
   a mistake — it does not earn the space it takes over the track. Section B
   below has been rewritten from "build it" to "take it out". The forecast
   *logic* and **the weather in the event planner stay exactly as they are** —
   only the map overlay goes.
2. **The sundial and the user dot must turn with the phone.** Turn left and the
   dial turns with you. New section C.
3. **The sundial and the time slider must feel part of the map, not floating on
   top of it.** The word used was "cluttered". New section D.

Section A is unchanged and still wanted. If you are mid-flight on B, stop and
read B again — the work is now deletion.

**A fifth objective landed the same day and lives in `TASKS-profile.md`** —
profile, settings, theming and gear. It collides with this plan twice and the
two must not run concurrently:

- **`src/ui/theme.ts`.** Profile section B makes the colour tokens a runtime
  value, which is a mechanical change across most of `src/ui/`. Section D4 here
  styles new controls against those same tokens. Land one, then the other.
- **`MapScreen.tsx` / `src/ui/map/style.ts`.** Profile section D adds map
  detail toggles (turning the trees off for performance); every wiring task
  here touches the same files.

---

## Rules for every agent

- **Work in your own worktree.** `git worktree add ../trackside-<task> -b <task>`,
  then `npm install` in it (`node_modules` is gitignored). Metro binds 8081, so
  a second one needs `--port 8082`.
- **Commit your own files by name.** `git add -A` will sweep up other agents'
  half-finished work. This has bitten this repo before.
- **The suite is fully green — run it without exclusions.**
  `npx vitest run` (554 passing). The 9 `entryList.fixtures.test.ts`
  failures that earlier revisions of this file told you to skip were stale
  assertions pinning parser bugs that have since been fixed; the tests were
  rewritten on 22 August. **Do not re-add `--exclude`** — that file is the
  only thing checking the parser against real entry lists.
- **`npx tsc --noEmit` must be clean before you commit.** No exceptions.
- **Verify on the emulator, not just in tests.** This is all visual work and a
  passing test proves nothing about whether it looks right. Launch with:
  `adb reverse tcp:8081 tcp:8081` then
  `adb shell am start -a android.intent.action.VIEW -d "exp+trackside://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"`.
  The app icon on the emulator does **not** work — the dev client falls back to
  `ws://10.0.2.2:8081`, which is blocked on this machine.
- If the emulator ever renders black while the app is clearly running, its GPU
  compositing has wedged. Cold-restart the emulator; do not debug the code.

## Collision map

| File | Wanted by |
|---|---|
| `src/ui/screens/MapScreen.tsx` | sun marker, overlay removal, control placement, heading |
| `App.tsx` | wiring for every objective |
| `src/ui/map/SkyControl.tsx` | time scrubber, date row, light strip, D2 |
| `src/ui/map/SunDial.tsx` | A2, C2, D1 |
| `src/ui/state/useMapClock.ts` | A3 reads the clock |
| `src/ui/state/useHeading.ts` (new) | C1, consumed by C2 and C3 |

**So both objectives split the same way as last time.** Phase 1 is logic and
self-contained components — genuinely parallel. Phase 2 is the wiring into
`MapScreen.tsx` / `App.tsx` and wants **one agent at a time**. Most of the work
is phase 1; the wiring is usually twenty lines.

`useMapClock` is the shared contract between the two objectives. Agree on its
shape before either side changes it — the sun and the weather must be reading
the *same instant* or scrubbing desynchronises them, which is the one bug that
makes the whole feature feel broken.

---

## State on disk

Already written, uncommitted:

- `src/ui/state/useMapClock.ts` — the scrub clock both objectives follow.
- `src/ui/map/SkyControl.tsx` — 24-hour light-quality strip you drag on the
  right, date row underneath, "Now" snaps back to the real clock.
- `src/ui/map/SunDial.tsx` — the sun marker itself.
- `src/ui/map/WeatherOverlay.tsx` — ambient cloud/rain over the map. Per-
  condition densities and opacities (`cloudy: 4`, `overcast: 6`, `rain: 5`)
  and a fixed scatter so it does not reshuffle every render.
- `App.tsx`, `src/ui/MainMenu.tsx` — modified; the `LightScreen` import and
  the Light menu entry are already gone.

Already committed: `src/core/logic/sun.ts` (solar position and light quality).

---

## Job 0 — tidy the tree first, one agent, before anything else

**Done — verified 22 August**, before this session's workers were dispatched.
Commit `a22aacf` ("Job 0: tidy tree — remove junk files and stale worktrees")
already did this work in a prior session. Re-checked on disk just now:

- [x] **Two junk files** — absent from the repo root (`git status`, `ls -la`,
      and a PowerShell `Get-ChildItem -Force` all agree; not tracked either).
- [x] **`src/ui/screens/LightScreen.tsx`** — absent from disk, and nothing in
      `src/` or `App.tsx` references `LightScreen` (grepped clean).
- [x] **Stale worktrees** — `.claude/worktrees/` does not exist, and
      `git worktree list` shows only the main worktree. Nothing to remove.

`npx tsc --noEmit` is clean on `master` as of this check.

---

## A — Sun on the map

> Implement light directly into the map: something that shows on the map where
> the sun is, a slider to adjust time, the sun rotating based on location, date
> and time, and something to adjust the date. Once done, remove the Light
> option from the menu. Make it look aesthetic.

**A1–A4 done — verified 22 August**, both statically (a worker read the code
against each item's spec) and live on a real Android emulator (scrubbed the
strip, watched the marker/label update, confirmed "Now" resumes live
following, watched the frame-drop counter hold steady through a scrub —
352 dropped, no spike). Two small housekeeping notes surfaced during
verification and were fixed: `useMapClock.test.tsx` (and the new
`useHeading.test.tsx`, see C1) existed but were never actually run by
`npx vitest run` — `vitest.config.mts`'s `include` only covered `core/` and
`storage-local/`; widened to also cover `src/ui/state/**`, deliberately not
all of `src/ui/`, so a real component-render test still correctly needs
jest-expo. Still owed, noted rather than blocking: on-device confirmation of
`SunDial`'s contrast at both light-quality extremes over live map tiles
(static reasoning + a mid-scrub screenshot look right; not exhaustively
checked at every hour).

- [x] **A1. Sun position, logic.** `src/core/logic/sun.ts` already computes
      solar position and light quality via `suncalc` (already a dependency —
      do not add another). Confirm it exposes azimuth *and* altitude for an
      arbitrary instant and position, and that it is driven by the passed-in
      date rather than the system clock — scrubbing to 05:00 tomorrow has to
      work. Add tests for the cases that matter at a circuit: sunrise, solar
      noon, sunset, and a winter day where the sun barely clears the trees.
      New/edited logic file plus its test only. No UI.

- [x] **A2. The sun marker.** `SunDial.tsx`. It has to read as a *direction*,
      not a decoration — the entire point is standing at a corner and knowing
      where the light will come from. Azimuth drives its bearing; altitude
      should be legible too (a low sun and a high sun must not look the same).
      Owns `SunDial.tsx` only.

- [x] **A3. Time and date scrubbing.** `SkyControl.tsx`. The 24-hour strip and
      date row exist; finish them and make them feel good under a thumb.
      Dragging must be smooth at 60fps — the light strip re-samples on every
      frame, so memoise rather than recomputing `suncalc` per drag frame.
      "Now" must snap back to the real clock *and resume following it*.
      Owns `SkyControl.tsx` and `useMapClock.ts`.

- [x] **A4. Aesthetics pass, after A2 and A3 land.** The objective asks for
      this explicitly and it is not decoration — this control sits over a dark
      map and competes with the track. Use `src/ui/theme.ts` tokens; the
      `lightQualityColor` ramp already exists and the strip should read as the
      sky's actual colour at that hour, the way `LightScreen` did. Do not
      invent a second palette.

---

## B — Take the weather overlay off the map

> Cancelled. "It doesn't need to be there anymore — it's kind of a mistake, but
> the weather thing in the event planner needs to be there still."

The overlay competes with the track, and the map is the tool. This is a
deletion, and the only real risk in it is deleting one thing too many: the
planner's weather is *staying*, and it shares logic with what is going.

**B1–B4 done — verified 22 August.** Importer list below; deletion done;
confirmed live on the emulator, including a second venue (Spa-Francorchamps)
to make sure the removal wasn't Nürburgring-specific.

- [x] **B1. Establish what the planner uses, before deleting anything.**
      `src/core/logic/forecast.ts` and its tests are **staying** —
      `skyCondition` and everything around it. Grep for every importer of
      `forecast.ts` and write the list into the PR description. Anything
      imported only by `WeatherOverlay.tsx` may go; anything the planner
      touches may not. Do this first and separately — the mistake this guards
      against is a tidy-up that silently removes the forecast from the event
      planner, which nobody would notice until a race weekend.

      **Importers, as found:** stays (planner-side) —
      `src/ui/state/useWeather.ts`, `src/ui/screens/WeatherScreen.tsx`,
      `src/ui/screens/EventScreen.tsx`, `src/ui/WeatherGlyph.tsx`,
      `src/storage-local/weather.ts`, `src/core/logic/forecast.test.ts`.
      Deleted (map-overlay-only) — `src/ui/map/WeatherOverlay.tsx` and
      `src/core/logic/skyAtInstant.ts` (+ test), a thin `skyConditionAt`
      wrapper whose only importer anywhere was `MapScreen.tsx`. Also found
      and removed a dangling `import type { HourlyForecastPoint }` in
      `MapScreen.tsx` that the original grep missed because it didn't route
      through either of the above.

- [x] **B2. Delete `src/ui/map/WeatherOverlay.tsx`** and its wiring out of
      `MapScreen.tsx` and `App.tsx`. Check `MapScreen.web.tsx` for a parallel
      mount — it is a separate implementation, and it will not fail the build
      just because the native side stopped rendering something.

      **Checked:** `MapScreen.web.tsx` had zero `WeatherOverlay` references —
      nothing to remove there.

- [x] **B3. Drop whatever only the overlay needed.** If `useMapClock` grew a
      weather field, take it out — the clock now drives the sun alone. Leave
      the clock itself; section A still needs it.

      **Checked:** `MapClock` was always just `now`/`isLive`/`scrubTo`/
      `resumeNow` — no weather field ever landed on it. Nothing to remove.

- [x] **B4. Confirm the planner still shows its weather** on the emulator, not
      just in tests. This is the acceptance criterion for the whole section:
      the map is clean *and* the planner is untouched.

      **Verified live:** opened "4 uur van Spa" → Weather row → full forecast
      card renders (condition, cloud-cover/rain charts, day tabs, "Fresh —
      just now", Refresh), unchanged. Map itself has no weather overlay on
      either venue.

---

## C — The dial and the user dot turn with the phone

> "The sundial and the user indicator — where the user is on the map, sort of a
> dot — need to turn with the user. So if you turn with your phone to the left,
> the sundial needs to be in the same orientation as you."

This is what makes the dial usable standing at a corner: you hold the phone up,
and where the sun sits on the dial is where the sun is in front of you.

- [x] **C0. Decide the rotation model first — one decision, before any code.**
      Two readings of the ask, and they produce different apps:

      **(a) Egocentric markers, north-up map.** The map keeps its orientation.
      The user dot grows a facing cone, and the dial rotates so its top is
      where the phone is pointing — the sun mark sits at
      `sunAzimuth − heading`.

      **(b) Heading-up map.** The whole map rotates under a fixed dial, the way
      car navigation does. MapLibre supports a camera bearing, so this is not
      much more code.

      **Recommendation: (a).** The map is read as a *plan* of the circuit —
      Branco knows the Nordschleife's shape by heart, and a map that spins
      makes a memorised shape unrecognisable. It is also the cheaper mistake to
      undo. But (b) is a fair reading of "turn with the user", so confirm
      before building, and write the answer into this file.

      **Decided, 22 August: (a), egocentric markers, north-up map.** Confirmed
      by Branco. `SunDial` rotates on `sunAzimuth − heading`; the map's own
      orientation is untouched by C. Do not build (b).

- [x] **C1. Heading, as a hook.** New `src/ui/state/useHeading.ts`.
      `expo-location` is already a dependency and exposes `watchHeadingAsync` —
      **do not add a sensor library**. Three things that will otherwise bite:

      - **True north, not magnetic.** `suncalc` gives azimuth from *true*
        north; the compass reports magnetic by default. expo-location returns
        both `trueHeading` and `magHeading` — use `trueHeading`, and when it is
        unavailable (it reads −1 before calibration) show no rotation rather
        than a wrong one. The gap is only a couple of degrees in the Ardennes
        and the Eifel, which is exactly the size of error nobody notices and
        that quietly makes the dial a liar.
      - **Smoothing.** Raw compass output jitters several degrees a second and
        needs a low-pass filter. It has to wrap correctly at 360°: naive
        averaging across the 359°/0° boundary swings the dial through a whole
        turn. Filter the angle, not the number.
      - **Stop the subscription when the map is not on screen.** A compass
        watch left running is a background drain on a device that also has to
        last a race weekend.

      **Done — verified 22 August.** Built and tested in isolation, NOT wired
      into `SunDial`/`MapScreen`/`App.tsx` yet (that's C2/C3, deliberately
      separate to avoid touching those files while B's removal was landing in
      parallel). Exported shape:
      ```ts
      type HeadingStatus = 'idle' | 'requesting' | 'watching' | 'denied' | 'unavailable';
      interface UseHeadingResult { heading: number | null; status: HeadingStatus }
      function useHeading(enabled?: boolean): UseHeadingResult; // default true
      function smoothHeading(previous: number | null, next: number, alpha: number): number; // pure
      ```
      `heading: null` is the unambiguous "unavailable" signal — never coerced
      from `-1`/uncalibrated to `0`. `smoothHeading` takes the shortest signed
      angular path and is exported standalone so the wrap-around math is
      tested without mocking `expo-location`. Permission handling follows
      `usePosition.ts`'s existing convention. 14 tests, all passing (now
      actually executed — see the vitest-config note above A1).

- [x] **C2. Rotate the dial.** `SunDial.tsx` takes heading as a prop and
      rotates. Keep the component pure — same render for the same
      `(sun, heading)` pair, with the subscription living in the hook — so it
      stays testable and a screenshot stays reproducible.
      **Degrade honestly:** no compass, no permission, or an uncalibrated
      sensor means the dial falls back to north-up and *says so*, rather than
      silently pointing somewhere wrong. Web has no heading at all;
      `MapScreen.web.tsx` must keep working, north-up.

      **Done — verified 22 August.** `MapScreen.tsx` wires `SunDial` to
      `useHeading(true)` as `dialHeading` (a separate call from the
      `heading` prop that feeds C3's facing cone — see below). Re-confirmed
      on a fresh emulator cold boot: the emulator has no compass, so
      `useHeading()` reports `heading: null`, and the dial renders north-up
      with the explicit "NORTH-UP" caption every time, never silently wrong.
      The rotation transform itself (non-null heading) is implemented but not
      exercisable here — no magnetometer to feed it — that's C4.

- [x] **C3. The user dot gets a facing cone.** The dot says where you are; the
      cone says which way you are looking, which is the half that matters when
      you are deciding whether a spot faces the light. Check what
      `@maplibre/maplibre-react-native` already provides for the location puck
      before drawing one — it may carry a heading indicator already, and a
      hand-rolled one that drifts out of sync with the library's is worse than
      either alone.

      **Verified 22 August — pre-existing, not built this pass.**
      `MapScreen.tsx`'s `nav-here-cone`/`nav-here-dot` layers (grepped, still
      the only `nav-here*` block in the file) predate this task and are fed by
      `usePosition.ts`'s own `heading`, which falls back `trueHeading` →
      `magHeading` — that file's own comment calls this deliberate, "the cone
      is a rough indicator by design," a different precision tier from
      `SunDial`'s strict `trueHeading`-only `useHeading()`, and correctly so.
      `App.tsx` reads `usePosition`'s `heading` and passes it into
      `MapScreen`'s `heading` prop, which is what `nav-here-cone` renders from
      — confirmed a clean, separate data path from `dialHeading` above.
      Grepped `UserLocation` across all of `src/`: zero matches, so there is
      no `@maplibre/maplibre-react-native` location puck anywhere to
      duplicate. The "no duplicate" conclusion stands.

- [ ] **C4. Verify by walking, not by reading.** Rotation bugs are invisible in
      a test and obvious in the hand. Point the phone at a known landmark and
      check the dial agrees with the real sun. An emulator can fake a heading
      but not a magnetic field — this one needs a real device.

      **Still open.** Needs a real device with a magnetometer — an emulator
      cannot fake one. Not attempted here; do not check this off without one.

---

## D — Make the dial and the slider part of the map

> "The sundial needs to be more integrated. The slider also needs to be more
> integrated, so it doesn't feel like it's all cluttered. It just needs to be
> more integrated into the map."

These currently read as two panels parked on top of a map. The objective is one
surface, not three. This is a design task before it is a coding task: sketch
it, look at it on the emulator, then build.

- [x] **D1. The dial belongs to the map, not to the screen.** The strongest
      version of "integrated" is that it stops being chrome — anchor it to the
      user's position so it reads as a compass rose drawn *on* the map, which
      also inherits C2's rotation for free. Second best is a corner element
      that shares the map's visual language: no panel edges, no competing
      background fill.

      **Done — second-best, deliberately, 22 August.** The strongest version
      (relocate the dial to a map layer at the user's position) was
      considered and set aside: `SunDial`'s rich readout (ring, halo, bearing/
      altitude/quality text) would need rebuilding as MapLibre symbol/text
      layers, a much larger rewrite for a corner-panel problem, not a
      positioning one. Built the second-best version instead: both `SunDial`
      and `SkyControl` lost their bordered rectangular card. `SunDial` keeps
      one solid shape — a disc backdrop sized to the ring itself, so it reads
      as a compass rose resting on the map rather than a panel that happens
      to contain one. Loose text everywhere (both files) gets a drop shadow
      (`textShadowColor: '#000'`, matching `PlannerScreen.tsx`'s one existing
      shadow convention) instead of a background box.

- [x] **D2. The slider should be quiet until touched.** A full-height strip is
      permanent furniture for something used a few seconds at a time. Consider
      a thin edge affordance that expands to the full light strip while a thumb
      is down and recedes after. Keep "Now" reachable *without* expanding —
      snapping back to the real clock is the most-used action on the control.

      **Done — verified 22 August.** `SkyControl`'s strip is a 10px hint of
      the day's gradient by default, expands to the full interactive height
      (with hour ticks and the date row) only while a thumb is down —
      `PanResponder`'s `Grant`/`Release`/`Terminate` toggle an `expanded`
      state — and recedes immediately on release. The header (time, quality,
      Now/Live) is a permanent sibling, not inside the collapsible part, so
      "Now" never requires expanding anything. Verified live: mid-drag
      screenshot shows the full strip with ticks/knob/date row; a screenshot
      taken right after release shows it back to the thin hint.

- [x] **D3. Respect the space already spoken for.** `MENU_CLEARANCE` in
      `src/ui/theme.ts` exists because the floating menu trigger overlaps
      anything near the top — add `insets.top + MENU_CLEARANCE`, never a
      hard-coded number. The spot list sits bottom-left. Whatever you build has
      to coexist with both, one-handed, in gloves (§5.14).

      **Already satisfied, confirmed 22 August — no new work needed.**
      `SunDial`/`SkyControl`'s `top`/`bottom` anchors were untouched by this
      pass: `insets.top + MENU_TOP + CIRCUIT_RULER_CLEARANCE` and
      `insets.bottom + BOTTOM_BAR_CLEARANCE` respectively, both already
      routing through the safe-area insets rather than a hard-coded number,
      established before C/D began. `SunDial` sits on the right edge (the
      menu trigger is top-left), so it clears via `MENU_TOP` rather than the
      full `MENU_CLEARANCE` — deliberate, matching `CircuitRuler`'s
      pre-existing precedent in the same corner, not a gap. D2's `hitSlop`
      addition to the strip did need its own fix here (see D4) so it
      wouldn't invade the Now button's own space, three lines above it.

- [x] **D4. Contrast over a moving map, not over a screenshot.** The map moves
      under these controls and its brightness changes as it moves. Use
      `src/ui/theme.ts` tokens and the existing `lightQualityColor` ramp; do
      not introduce a second palette. Removing the overlay in B gives this
      section back the room it needs — do B first.

      **Done — verified 22 August, after B.** Contrast comes from the text
      shadow described under D1 rather than a fill, plus one solid backdrop
      disc behind `SunDial`'s ring specifically (the one place a thin 1.5px
      border genuinely needed opaque backing against a busy map). One real
      bug found and fixed in the same pass: `SkyControl`'s "Now"/"Live"
      control was a `Text` with `onPress`, which has no `hitSlop` of its own —
      D2's new `hitSlop` on the strip below it (added so the thin collapsed
      strip stays glove-sized, §5.14) sat only `space.sm` away and could
      reach up and steal taps meant for the button. Fixed by converting the
      control to a `Pressable` with its own `hitSlop`, and shrinking the
      strip's `top` hitSlop specifically (the side facing the button) from 22
      to 6, keeping the other three sides generous. Confirmed on-device via
      `adb shell uiautomator dump` for the button's exact element bounds
      (manual pixel estimates from screenshots had been missing it
      repeatedly, off by roughly 700px in Y at one point — the dump gave a
      center of (1168, 2455) against guesses clustered around (1160, 1780)):
      scrubbed away from live, tapped the dumped bounds' centre, the clock
      snapped back to the real time and the button flipped to the blue
      "LIVE" state.

---

## Done means

- `npx tsc --noEmit` clean.
- `npx vitest run` green, no exclusions.
- Verified **on the emulator**, scrubbing the slider, with the sun moving and
  the frame counter not climbing.
- **No weather anywhere on the map** — and the event planner's weather still
  works, checked on the emulator.
- **Turning the phone turns the dial and the user cone**, checked on a real
  device against a real landmark, reading true north.
- The dial and the slider read as part of the map. Branco's word was
  "cluttered"; the test is whether it still feels that way to him.
- Light is gone from the menu and `LightScreen.tsx` is resolved.
- No stray files, no stale worktrees.
---

## Added 28 August 2026 — the 3D sky, and what is still wanted

The 3D terrain view now has a sky driven by real data: solar position from
`solarPosition()`, moon position and phase from `moonState()`, and cloud cover
and rainfall from a venue-scoped MET Norway fetch (`useVenueConditions`). All
of it hangs off the shared map clock, so the time slider moves the sky.

Everything below is Branco's list from seeing it running, in his order. None
of it is started. **Read the feasibility note on each before planning** — two
of these are cheap and two are a different kind of project.

### D1. Valley mist — mist pooling in the hollows, hilltops clear

The one with the best effect-to-effort ratio, and worth doing first.

The trick that avoids custom WebGL: a **semi-transparent horizontal slab** at
a chosen elevation, drawn as a `fill-extrusion` covering the venue with its
base at ground level and its top at, say, 450m. Terrain above that height
pokes through it; ground below is seen through the slab. That is exactly the
inversion look — clear tops, filled crevasses — without a shader.

Density should come from the forecast: high humidity and a still, cold dawn is
when it actually happens, and faking it at 2pm in July would be a lie.

- [ ] Slab layer, height configurable per venue.
- [ ] Density and height from forecast conditions, not a constant.
- [ ] Off entirely when the conditions do not call for it.

### D2. Rain as a toggle

Currently rain draws whenever the forecast says it is raining. It should be a
setting, off-able. Belongs with the other map settings rather than as a
control on the map.

- [ ] Setting, persisted.
- [ ] Applies to the world-space rain of D3 too, when that lands.

### D3. Cloud and rain rendered in the world, not on the screen

The present cloud and rain are canvas overlays. Cloud is projected from
azimuth and altitude, so it holds station against the compass — that part is
right. Rain is deliberately screen-space, which reads fine but means it cannot
be occluded by a hill, and gusts cannot exist at a place.

What is wanted is both in world coordinates: rain falling *over there* on that
ridge and not here, and **wind gusts as movement in the sky itself** rather
than a pattern on the glass.

Feasible with the existing projection helper — particles carry a lat/lon and
an altitude and are projected per frame — but the cost is real and it needs a
particle budget measured on a phone, not assumed.

- [ ] Particles anchored to coordinates, not to the viewport.
- [ ] Gusts as sky movement, visible as drift and shear rather than a screen effect.
- [ ] Frame cost measured on a real device before this is called done.

### D4. Cloud density should be the actual density

Cover currently reveals N of a fixed set of cloud blobs, so 85% looks busier
than 20% but is not *shaped* like real 85% cover — which is closer to an
unbroken sheet with gaps than to many separate clouds.

- [ ] Overcast should read as a layer, not as a crowd of individual clouds.
- [ ] Broken and scattered should still read as separate clouds.

### D5. Volumetric clouds

Named as a wish, and honestly out of reach in this renderer without a
substantial custom-WebGL project: MapLibre GL JS has no volumetric anything,
so this means a custom layer raymarching a noise field, depth-tested against
the terrain, on a phone GPU.

Not a reason to say no forever — but it should be picked up as its own piece
of work with its own performance budget, not folded into a session about
anything else.

### D6. Dynamic cast shadows from the sun

Also asked for, also a real project. What exists today is **hillshade**, whose
illumination direction follows the true solar azimuth: slopes facing away from
the sun darken, and that turns through the day. What it cannot do is cast — a
hill throwing a shadow across the valley at six in the evening, which is
precisely the thing a photographer wants to see.

Doing it properly means rendering the DEM from the sun's point of view into a
depth texture and sampling it in a custom layer. Everything needed is present
(the DEM is already loaded, the sun vector is already computed); the work is
the shader and making it cheap enough.

- [ ] Decide against approximations that look like shadows but are not — a
      shadow in the wrong place is worse than no shadow, because it will be
      trusted.

### Done on 28 August, for context

- Sun-driven sky, ground tone and hillshade direction, continuous through dusk.
- Stars and a real moon (position, phase, illuminated fraction).
- Cloud and rain from the venue forecast.
- Terrain to the horizon with no roads or names on it, camera still locked.
- Hillshade restored over the ground, translucent, so hills have depth again.

### D7. The tree line stops at the corridor, and now you can see it

Reported as "trees are hidden in terrain a little bit far away and downhill".
Diagnosed 28 August; it is not a rendering fault and not terrain occlusion —
that was checked by toggling `setTerrain(null)` with the camera still, which
rendered exactly the same 245 tree symbols.

`extract-scenery.mjs` clips the scatter **to the circuit corridor** (its line
16). So the trees genuinely stop about 300m from the track: bbox
`6.916,50.321 → 7.010,50.383` against a venue box of `6.88,50.30 → 7.04,50.41`
and a DEM that now reaches ~28km. The edge was invisible for as long as the
corridor mask painted everything beyond it black. Removing that mask in 3D —
which is what made the surrounding hills visible at all — exposed the tree line
as a hard border.

Three ways out, and the choice is a real trade:

- **Widen the scenery clip.** Honest and simple, but the scatter is already
  ~10k features per venue and the style's own notes flag 13k as the point
  where it costs frames. The venue box is around three times the corridor's
  area.
- **Fade the trees out with distance** so there is no line to see. Needs a
  distance-aware expression; confirm MapLibre 5.6 has one before planning
  around it, because Mapbox's `distance-from-center` may not exist here.
- **Leave it.** The bare far landscape is what was asked for — no roads, no
  names, just landform. An abrupt tree line is the one part that reads as a
  mistake rather than as distance.

- [ ] Decide which, then do it. Do not widen the clip without measuring frames
      on a phone first.

#### Correction to D1, 28 August — the slab trick does not work

The note above proposed a level `fill-extrusion` slab as a way to get valley
mist without a shader. That was wrong, and checked afterwards rather than
before: maplibre-gl 5.6 exposes only `fill-extrusion-base`, `-height`,
`-color`, `-opacity`, `-pattern`, `-translate`, `-translate-anchor` and
`-vertical-gradient`. There is no `base-alignment` or `height-alignment`, so
base and height are measured **from the terrain surface**. An extrusion
therefore hugs the ground and rises and falls with it — the one thing a mist
ceiling must not do.

D1 is consequently not the cheap item it was billed as. Three real options:

- **A custom WebGL layer** drawing one translucent quad at a fixed elevation,
  depth-tested against the terrain. Small in principle — a quad and a shader —
  but custom layers and terrain interact awkwardly and that needs proving
  before it is planned around. Same class of work as D5.
- **A scatter of soft translucent billboards** placed only below a chosen
  elevation, reusing exactly the machinery the trees already use. They would
  pool in the hollows and be absent on the tops, and being symbols they stand
  up rather than lying flat. Cheapest of the three and the most likely to look
  right; the risk is particle count on a phone.
- **Precomputed "below N metres" polygons** drawn as draped translucent fills.
  Works today with no new machinery, but a draped fill lies flat on the ground:
  from a low camera it reads as white paint in the valleys, not as fog.

- [ ] Try the billboard scatter first. It is the only one of the three that is
      both cheap and volumetric-looking.

### D8. The archive edge is a hard line (reported as "Suzuka 3D is glitchy")

Reproduced 29 August at Suzuka, pitch 70: a straight horizontal seam runs
across the view. Below it is the vector archive — roads, fields, the river.
Above it is bare terrain with no detail at all.

Same root cause as D7. The seam is the extract's own rectangular boundary, and
it was invisible for as long as the corridor mask painted over everything
outside the corridor. It is not a Suzuka bug: it shows there first because that
extract is small (0.045° x 0.037°, against the Nordschleife's 0.16° x 0.11°),
so the edge falls inside the visible frame instead of miles away.

Two things make it read as a fault rather than as distance:

- The boundary is **straight**, and nothing in real terrain is. A rectangular
  edge is unmistakably an artifact.
- The colours either side are far apart — inside is grey-green urban and field
  fills, outside is forest green — so the line has high contrast at Suzuka in
  a way it does not at the Ring.

- [ ] Decide together with D7; they are one question, not two. Any fix that
      softens the tree line (fade with distance, or widen the data) applies
      here unchanged.

---

## 29 August 2026 — D1, D3, D5 and D6 are done

All four were previously marked as custom-WebGL projects and out of reach.
Three of the four were, and I was wrong about the fourth twice.

The fact that unlocked everything: **MapLibre custom layers are depth-tested
against the terrain mesh.** Checked before building anything, by drawing an
opaque quad at 50m over the Eifel and confirming the hills hid it. Geometry
placed in mercator coordinates with a real altitude is therefore occluded by
the landscape, which is what separates weather in the scene from weather on
the glass.

- **D1 mist** — a stack of 14 sheets with levels read from the terrain, so it
  fills valleys and leaves peaks clear at any venue. `a93339a`
- **D3 world-space rain** — drops at real coordinates falling through real
  altitudes, in a box that follows the camera. The canvas rain is deleted, not
  kept as a fallback: it was a different claim about where the rain is. `6ff607a`
- **D5 volumetric cloud** — 26 sheets through a noise field. Carries the one
  deliberate lie in this sky, documented at the call site: the deck is kept
  above the camera, because the camera sits above any real cloud base and a
  physically-placed deck spends its life between you and the circuit. `5da8799`
- **D6 cast shadows** — a 128x128 height grid sampled once from
  `queryTerrainElevation`, then a horizon walk toward the sun per cell. Not an
  approximation of a shadow; the definition of one. `76f9d77`

### Two bugs worth remembering

**Shader noise needs a local origin.** Mercator coordinates are ~0.5, and
scaling by thousands puts the hash on `sin()` of ~1e6 where a float has no
precision left. The noise silently becomes a constant and whole sheets show or
discard as one. Subtract the venue origin first.

**Never trust one `idle` for terrain data.** `queryTerrainElevation` reads
tiles that arrive over the network and `idle` usually fires before they land.
A listener that gave up on the first empty answer disabled mist, cloud and
rain together, for the whole session. It retries now.

### Still open

- Wind gusts as world-space movement (part of D3) — the rain drifts, but there
  is no gusting.
- D7 / D8, the tree line and archive edge, unchanged and still one decision.

### D9. First person — built, could not reach eye height, removed

Asked for: stand at a spot, about 2m off the ground, and look around. Built,
and it does not hold on sloping ground. Reported as "the camera can't go
through the ground so it stays stuck on the ground near hills", which is
exactly right.

**MapLibre will not let the camera near the terrain, and enforces it by
cutting the pitch.** Measured at the Nordschleife, entering at a spot with a
rise behind it:

| requested | result |
|---|---|
| zoom 22.0, pitch 85 (≈2m) | pitch clamped to 8, screen black |
| zoom 21.6, pitch 75 (≈8m) | pitch clamped to 8, looking at the ground |
| zoom 18.5, pitch 85 (≈24m) | holds on open ground, clamps to 52 on a slope |

Three approaches were tried and all fail for the same reason:

1. **Raise the camera.** Does not help. At pitch 85 the camera trails about
   11x its own height behind the point it looks at, so the slope it must clear
   grows with the height.
2. **Lower the pitch** so the back-line rises more steeply. Clamped anyway.
3. **Offset the centre** so the camera lands exactly on the spot rather than
   behind it. Worse — the collision fires every frame and the view collapses.

There is no free camera in maplibre-gl (`getFreeCameraOptions` is a Mapbox
API), so the camera cannot simply be placed.

**What is shipped** is the configuration that holds where it can: centred on
the spot, pitch 85, about 24m up. A gantry rather than a person. It still
answers what the view is for — which way the corner lies, what is between you
and it, and where the sun and shadows fall from that position.

- [ ] **Open question for Branco.** Terrain could be switched off for the
      duration of the first-person view, which removes the collision entirely
      and allows a true 2m camera anywhere. The cost is that the hills go
      flat, and the hills are half the reason to stand somewhere. Worth it?

**Removed 29 August.** Branco's call, and the right one: offered the choice
between a 24m camera that behaves like a drone or switching terrain off to
get a true 2m camera over flat ground, and neither is the thing that was
asked for. A view that is nearly what you wanted is worse than no view,
because it still occupies the button and still has to be explained.

The measurements above are kept because they are the useful part. If a free
camera ever lands in maplibre-gl — or if the app ever renders terrain itself
— this becomes straightforward and the groundwork is written down.
