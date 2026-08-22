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
- **The suite has 9 known failures that are not yours.** They are all in
  `src/core/logic/entryList.fixtures.test.ts`, which pins old parser behaviour
  the parser has since outgrown. Run
  `npx vitest run --exclude "**/entryList.fixtures.test.ts"`. Do not fix them.
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
- `npx vitest run --exclude "**/entryList.fixtures.test.ts"` green.
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