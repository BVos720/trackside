# Profile — settings, appearance and gear

> "Something called the user profile. It's kind of like an account, but you
> don't have to make an account. It's in the menu where you can just click
> settings and profile."

Four objectives that share one new screen: **performance toggles**, **light and
dark mode**, **an accent colour you pick**, and **your gear**, which then feeds
a searchable dropdown when planning an event.

Nothing here is built yet. **Read "What already exists" before designing
anything** — three of the four have foundations in the codebase already, and
two of them have a trap that will cost a day if you meet it by surprise.

**Checkboxes mean "an agent may take this".**

---

## Rules for every agent

Same as `TASKS-map-sky.md` — worktrees, commit your own files by name, the
9 known `entryList.fixtures.test.ts` failures are not yours, `npx tsc --noEmit`
clean before committing, verify on the emulator. Read that file's rules section
rather than repeating it here.

## Collision map

| File | Wanted by |
|---|---|
| `src/ui/theme.ts` | **B and C rewrite it**, and `TASKS-map-sky.md` D4 reads it |
| `src/ui/MainMenu.tsx` | A1 adds the menu entry |
| `src/storage-local/preferences.ts` | A2 persistence |
| `src/ui/map/style.ts`, `MapScreen.tsx` | D performance toggles, and all of map-sky |
| `App.tsx` | wiring, as always |

**This plan and `TASKS-map-sky.md` collide in two places.** `theme.ts` is the
serious one: section B here makes the colour tokens dynamic, and map-sky's D4
styles new controls against them. Do them in either order, but **not at the same
time**. The map performance toggles (D) touch `MapScreen.tsx`, which map-sky
also rewires — same rule.

---

## What already exists

- **`src/ui/theme.ts`** — `color`, `space`, `radius`, `type`, `weight`,
  `lightQualityColor`, `MENU_*`, `HIT_SIZE`. All plain `const` objects.
- **`src/storage-local/preferences.ts`** — already the home for stored
  preferences. Settings belong here, not in a new store.
- **`UserGearItemId` is already in `src/core/domain/ids.ts`.** The domain
  anticipated gear and never got it. Use that brand; do not mint a second one.
- **`Spot.shotSettings`** carries `focalMinMm` / `focalMaxMm` as *full-frame
  equivalent* plus the `cropFactorBasis` they were derived from — read the long
  comment in `src/core/domain/spot.ts` (§5.6). This is the reason gear is worth
  more than a list of names; see D3.
- **`LOCAL_USER_ID`** already exists and is attached to every spot, note and
  media row. The profile is that user, finally given a face.
- **`MainMenu.tsx`** has an `ITEMS` array and a deliberate comment explaining
  which destinations are *not* in it and why. Read it before adding a row.

---

## The trap, before you plan B or C

**Every `StyleSheet.create` in this app runs once, at module import, and
captures the colour values as they were then.** There are dozens of them. A
theme you change at runtime will not reach a single one — the app will keep its
old colours until it is force-quit, and worse, it will *half* update wherever a
style happens to be built inside a render.

So B and C are not "add a setting". They are "make colour a runtime value", and
that is a mechanical change across most of `src/ui/`. Decide the mechanism
first — a React context with a `useTheme()` hook is the obvious candidate — and
land it as its own commit that changes no colours at all, before either feature
is built on top. **Do not start by adding a colour picker.**

---

## A — The profile screen

**A1–A3 done — 22 August.** `ProfileScreen.tsx` exists with Appearance,
Performance, Gear sections in that order (each a placeholder pending B/C/D's
own content), wired into `MainMenu.tsx`'s `ITEMS`/`Destination` and
`App.tsx`'s navigation following the existing `'circuit'` destination's exact
pattern. A minimal display-name field is the only real content so far,
persisted through `preferences.ts`'s `getProfileName`/`setProfileName`.
`LOCAL_USER_ID` deliberately left implicit — there is one local profile per
device, so no second id was minted. `npx tsc --noEmit` clean,
`npx vitest run --exclude "**/entryList.fixtures.test.ts"` green at the time.
Not yet verified live on an emulator (the agent that built it had no `adb`
available) — worth a quick look before calling it fully done.

- [x] **A1. A destination in the menu.** New screen, reached from `MainMenu`.
      That file's `ITEMS` comment explains why `plan` and `times` are absent —
      profile is genuinely top-level, so it belongs there, but read the
      reasoning before adding to the list.

- [x] **A2. Local, and not an account.** No sign-in, no email, no password —
      "you don't have to make an account". Store through
      `src/storage-local/preferences.ts`. Attach the profile to the existing
      `LOCAL_USER_ID` rather than inventing a second identity; §0.1 means a
      backend arrives in Milestone 3 and a profile keyed to something else will
      not reconcile with the rows that already carry that id.

- [x] **A3. Sections, in the order they get used.** Appearance, Performance,
      Gear. Gear is the one with real content and should not be third on a
      screen that scrolls.

---

## B — Light and dark mode

> "Change the theme of the app, so dark and light mode."

- [x] **B0. Read §5.14 first, and resolve the tension in writing.**
      `theme.ts` opens by saying opaque, high-contrast, dark surfaces are a
      *hard requirement* for trackside use, not a preference. A light mode is
      not automatically a violation — a bright theme may well be more legible
      at Spa in July than a dark one — but the current file argues the opposite,
      and shipping a light mode without updating that comment leaves the
      codebase asserting two contradictory things. Whichever way it goes, write
      the reasoning into `theme.ts`.

      **Done — 22 August.** Written into `theme.ts`: the actual hard
      requirement is opacity, contrast against the map, and `HIT_SIZE` touch
      targets — not literally "dark" — so a light palette that holds that same
      bar is not a violation.

- [x] **B1. Make colour a runtime value.** The mechanical change described in
      "The trap" above. Its own commit. No visible change when it lands — that
      is the point, and it is what makes it reviewable.

      **Done — 22 August**, deliberately narrow per this section's own
      instruction ("land it as its own commit that changes no colours at
      all"). `useTheme()`/`ThemeProvider` added to `theme.ts`
      (`ThemeProvider` currently hands out the exact same dark `color` object
      as before — no picker, no persistence, no light palette yet). Proven on
      `App.tsx`'s root plus one migrated file, `MainMenu.tsx`, as a working
      slice — **the rest of `src/ui/` is still on the static `color` import,
      on purpose, not forgotten.** Whoever builds B2/B3 or C1-C3 needs to
      either migrate call sites as they touch them or take on the fuller
      migration explicitly; it was not done here. `npx tsc --noEmit` clean,
      `npx vitest run --exclude "**/entryList.fixtures.test.ts"` green
      (463/463 at the time). Not verified live (no `adb` in that agent's
      environment) — low risk since the commit is designed to be a no-op
      visually, but worth a look.

- [x] **B2. The two palettes.** Dark stays exactly as it is; light is new.
      Check contrast against the map in both, not against a blank screen —
      the map is the background for most of this app.

      **Done — 22 August.** Dark palette untouched. Light palette's
      `accent`/`danger` deepened from the dark palette's own hues rather than
      reused verbatim — the dark values only hold ~3.9:1/~3.3:1 against
      white, under the 4.5:1 text floor; deepened to ~5.6:1/~5.3:1.
      `background`/`surface`/`surfaceRaised` climb with real separation
      rather than three near-white greys. `lightQualityColor` and `spot.ts`'s
      access-classification colours untouched, confirmed — data, not theme.
      One real bug caught along the way: `MainMenu.tsx`'s floating trigger
      sits directly on the (always-dark) map with a fixed opaque backdrop —
      its text/border had been migrated to `useTheme()` by B1's proof slice,
      which would have gone near-invisible in light mode (near-black text on
      a near-black backdrop). Reverted just those three trigger styles to
      fixed on-map constants, matching `SunDial`/`SkyControl`'s convention.

- [x] **B3. Follow the system by default, with an explicit override.** Three
      states, not two: System, Light, Dark. A phone that switches to dark at
      sunset should not fight a user who chose light this morning.

      **Done — 22 August.** `getThemePreference`/`setThemePreference` in
      `preferences.ts` (`'system' | 'light' | 'dark'`, default `'system'`);
      `ThemeProvider` resolves `'system'` against React Native's
      `useColorScheme()` reactively, independent of the async preference
      load, so an OS change reaches a system-following user immediately.
      Real three-option switch wired into `ProfileScreen.tsx`'s Appearance
      section. Verified live, including the specific cold-start scenario
      this item names: set Light, force-stopped, relaunched, confirmed the
      choice was applied from the very first render, not just carried in
      memory. `ProfileScreen.tsx` and `Collapsible.tsx` fully migrated off
      the static `color` import to prove the switch works end-to-end; the
      rest of `src/ui/` remains on the static import, same deferred state
      B1 left it in.

---

## C — Pick the accent colour

> "Now it's dark blue, but you need a slider of color so you can choose, for
> example, the real color needs to be red. So whatever you like."

- [ ] **C1. A hue slider, not a swatch grid.** The ask was a slider. Store the
      hue and derive the accent from it, rather than storing a hex string —
      derived colours can be re-derived correctly when B's light palette needs
      a different lightness for the same hue.

- [ ] **C2. Contrast is not optional.** A freely chosen hue will land on
      combinations that are unreadable on one of the two backgrounds. Clamp
      lightness and saturation to a range that stays legible in both themes
      rather than handing over the raw picker output. Being unable to make the
      app unreadable is a feature.

- [ ] **C3. `lightQualityColor` is data and must not be themed.** That ramp
      encodes the actual colour of the light at a given hour — golden hour is
      gold because the light is gold. It is information, not decoration, and
      the accent must not override it. Same for anything that means something
      by its colour: the access-classification states in `spot.ts` carry a
      physical-safety meaning (§9.1) and are not the user's to recolour.

---

## D — Performance and gear

- [x] **D1. Map detail toggles.** "Turn off the trees on the map and other
      things for more performance." Start by finding what the scenery layers
      actually cost — `scripts/extract-scenery.mjs` produces them and
      `src/ui/map/style.ts` composes the style. Offer toggles for the layers
      that measurably matter and no others; a settings screen full of switches
      that change nothing is worse than three that work. Measure with the
      frame counter the app already shows.

      **Done — 22 August, plumbing only.** `buildMapStyle` gained an
      `includeScenery` parameter (default `true`): when `false`,
      `TREES_SOURCE` is left out of `sources` entirely, not just hidden, so
      the up-to-13k-feature GeoJSON (7000 trees + 6000 field plants, capped in
      `extract-scenery.mjs`) is never parsed. `BUILDINGS_SOURCE` was checked
      and left always-on — real coverage is a few hundred to ~1100 footprints
      per venue, no comparable cost. Persisted via
      `getMapSceneryEnabled`/`setMapSceneryEnabled` in `preferences.ts`;
      `MapScreen.tsx` reads it on mount. **The actual switch UI on this
      screen's Performance section is not built** — A3's placeholder is still
      a placeholder there, this only built what it will call. The
      before/after frame-counter measurement this item explicitly asks for is
      **still owed** for the same reason: nothing in the running app can flip
      the toggle yet to compare against. Smoke-tested only (fresh launch,
      scenery on by default, map renders correctly, no regression).

- [x] **D2. Your gear, as real records.** Bodies and lenses, added by hand.
      Use `UserGearItemId`, follow `src/core/domain/` rules — UUID v7,
      tombstones, `syncState` — and give it a repository beside the others in
      `documentRepositories.ts`. This is a domain entity, not a preference
      string, because it will sync one day and because D3 depends on it.

      **Done — 22 August.** `GearItem` in `src/core/domain/gear.ts`
      (`kind: 'body' | 'lens'`, manufacturer/model as free text — no preset
      catalogue, see the open question below — plus a nullable crop factor),
      repository in `documentRepositories.ts` exported as `gear`, following
      `EquipmentRepository`'s exact shape. No UI built on top yet — that's
      D4/D5.

- [x] **D3. A body knows its crop factor — use it.** `Spot.shotSettings`
      already stores focal lengths as full-frame equivalent *plus* the
      `cropFactorBasis` used to get there, precisely so a reading can be
      rendered against whatever body the reader owns. An R6 Mark II is
      full-frame, so 1.0; an R7 is 1.6. Once gear exists, the app can stop
      asking for a crop factor and start knowing it. Do not skip this — it is
      the reason gear is worth building rather than a note field.

      **Done — 22 August, logic only.** `actualFocalLengthMm`/
      `actualFocalRangeMm` in `src/core/logic/gear.ts` convert a full-frame
      equivalent back to what a given body's crop factor actually shows,
      taking a plain `bodyCropFactor: number` rather than a `GearItem` —
      resolving a possibly-null `GearItem.cropFactor` to a real number is left
      to whoever wires this into a screen. Not wired into any screen yet.

- [ ] **D4. The gear dropdown in the event screen, with search.** "In the event
      menu where you have to add gear, you have a dropdown of all your gear …
      and the dropdown needs to have a search bar." Search matters once the
      list is long, so build the list to be long. Match on manufacturer and
      model together — "r6", "canon r6" and "EOS R6" should all find a Canon
      EOS R6 Mark II — and keep matching offline and local; this is a filter
      over the user's own rows, not a lookup against anything.

- [ ] **D5. One-handed, in gloves.** A dropdown with a search field is the
      fiddliest control in the app so far, and it gets used in a paddock.
      `HIT_SIZE` exists for this. If it cannot be driven with a thumb, it is
      not done (§5.14).

---

## Open questions for Branco

- **Does gear attach to an event, or to a plan stop?** "Add gear" in the event
  menu reads as per-event ("this weekend I am carrying these two bodies"), but
  the useful version at a spot is per-stop ("at Brünnchen, the 500mm"). They are
  different features and the second is much more valuable. Ask before building.

  **Decided, 22 August: per event.** Confirmed by Branco — simpler, matches
  the literal ask, faster to ship. Plan-stop scoping can follow later if it
  turns out to matter. D4/D5 attach gear to the event, not to a `PlanStop`.
- **Is a preset list of bodies and lenses wanted, or is typing them in enough?**
  A bundled catalogue makes onboarding quick and is a licensing and maintenance
  liability. Typing is honest and dull. Default to typing unless he asks.

---

## Done means

- `npx tsc --noEmit` clean.
- `npx vitest run --exclude "**/entryList.fixtures.test.ts"` green.
- Theme switching verified **on the emulator**, including a cold start — the
  failure mode this feature invites is a colour that only updates after a
  restart, and that is invisible in a test.
- Gear added in the profile appears in the event dropdown, and search finds it.
- No colour that carries meaning has become user-configurable.
