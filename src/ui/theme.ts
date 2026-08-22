import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

import { DEFAULT_ACCENT_HUE, deriveAccent } from '../core/logic/accentColor';
import {
  getThemeAccentHue,
  getThemePreference,
  setThemeAccentHue,
  setThemePreference,
  type ThemePreference,
} from '../storage-local/preferences';

export type { ThemePreference };

/**
 * Design tokens — spec §5.13, §5.14.
 *
 * Milestone 1 targets *trackside* mode, not planning mode: opaque surfaces,
 * high contrast, large touch targets. §5.14 is explicit that this is a hard
 * requirement rather than a preference — translucency reduces contrast by
 * design, and glass over a bright map at midday is unreadable at exactly the
 * moment it has to be read, while wearing gloves.
 *
 * The quiet part does most of the work (§5.13): a 4pt spacing scale used
 * without exception, two font weights rather than five, one accent colour.
 *
 * ── Light mode and §5.14, resolved ──────────────────────────────────────
 * §5.14's own words used to read as requiring *dark* surfaces specifically,
 * because at the time "opaque and high-contrast" and "dark" were the same
 * palette — the only one that existed. They are not the same constraint.
 * Opacity, contrast against the map, and HIT_SIZE touch targets are the hard
 * requirement; darkness was an implementation of it, not the requirement
 * itself. A bright theme can hold that same bar — a white sky over Spa in
 * July can make a dark panel harder to read at a glance than a light one at
 * an equal contrast ratio — so a light palette is not automatically a §5.14
 * violation, provided it stays opaque and meets the same contrast and
 * touch-target floor the dark palette does. What §5.14 still rules out,
 * regardless of palette, is translucency and undersized targets.
 *
 * `color` below is the dark palette, unchanged from before this file grew a
 * second one; `lightColor` is the new light palette (TASKS-profile.md B2).
 * See `ThemeProvider`/`useTheme` at the bottom of this file, which resolve a
 * three-state preference (system/light/dark, B3) to whichever of the two a
 * component should actually render with.
 */

/** 4pt scale. Every margin and padding in the app comes from here. */
export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
} as const;

/**
 * Two weights. Not five.
 *
 * Inter rather than SF Pro — spec §5.13: SF is licensed for Apple platforms
 * only and this codebase ships Android. The family is left unset here until
 * Inter is actually bundled, so the platform default is used rather than a
 * font that silently falls back and shifts every metric.
 */
export const weight = {
  regular: '400',
  bold: '700',
} as const;

export const type = {
  display: 44,
  title: 24,
  body: 16,
  label: 13,
  mono: 15,
} as const;

/**
 * The shape both palettes below share.
 *
 * Widened to plain `string` (rather than each palette's own literal-typed
 * `as const` shape) so `color` and `lightColor` are interchangeable wherever
 * a `Theme` is consumed — a call site reading `useTheme().color.background`
 * should not care, or be able to tell, which palette it got.
 */
export interface ColorTokens {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;

  text: string;
  textMuted: string;
  textFaint: string;

  accent: string;
  onAccent: string;

  undocumented: string;
  danger: string;
}

export const color: ColorTokens = {
  /** Opaque, not translucent. See the §5.14 note above. */
  background: '#0B0D10',
  surface: '#161A20',
  surfaceRaised: '#1F242C',
  border: '#2A313B',

  text: '#F2F5F8',
  textMuted: '#9AA5B1',
  textFaint: '#5E6874',

  /** One accent colour. */
  accent: '#2E7DF6',
  /**
   * Text and glyphs drawn *on* the accent.
   *
   * A named token rather than the background hex repeated at each call site:
   * accent and its contrast colour have to change together, and the previous
   * orange had '#0B0D10' hardcoded in eight files. Anything filled with
   * `accent` uses this for its label.
   */
  onAccent: '#08111F',

  /** Undocumented data reads as absent, never as a plausible default (§0.2). */
  undocumented: '#5E6874',

  /**
   * Destructive actions, and plans that do not hold.
   *
   * Named once it earned a second use: delete controls and the planner's
   * "you cannot make this stop in time" warning are the same signal — this is
   * the thing that costs you something.
   */
  danger: '#E5675C',
};

/**
 * The light palette — TASKS-profile.md B2. Same eleven tokens as `color`,
 * same roles, new values; nothing here changes what a token *means*.
 *
 * ── Hierarchy, not three near-identical near-whites ─────────────────────
 * `background` → `surface` → `surfaceRaised` climbs in the same *direction*
 * as the dark palette (each step is a little brighter than the last, reading
 * as "closer to the viewer") rather than inventing a different relationship
 * for light mode — `background` is a visibly grey-blue floor (#D8DEE5, not a
 * near-white), `surface` sits above it, and `surfaceRaised` is the one true
 * white in the palette, reserved for the most-raised layer the way the dark
 * palette reserves its lightest tone for the same role.
 *
 * ── Contrast, checked against a white sky, not a blank screen ────────────
 * `accent` is a deeper, more saturated blue than the dark palette's
 * (`#1B63D1` vs `#2E7DF6`) rather than the same hex reused: the dark
 * palette's brighter blue reads at ~3.9:1 against white, under the 4.5:1
 * floor for normal text — legible as a border or a fill, not reliably as
 * text. `#1B63D1` holds ~5.6:1 against both `surfaceRaised` (white) and
 * `onAccent` (also white, so the label on a filled accent button holds the
 * same ratio in reverse). `danger` is deepened the same way for the same
 * reason (`#E5675C` is ~3.3:1 on white; `#C13B30` is ~5.3:1). `text` and
 * `textMuted` clear 13:1 and 6:1 against `background`, the darkest of the
 * three surfaces and so the hardest case. `textFaint` (and `undocumented`,
 * which — like the dark palette — is deliberately the same value as
 * `textFaint` rather than a fourth grey) sits around 4.3:1 against
 * `surfaceRaised`: short of the 4.5:1 text floor, but consistent with the
 * dark palette's own `textFaint`, which is ~2.75:1 against its raised
 * surface. Both palettes treat "faint" as a deliberately de-emphasised tier,
 * never used for anything that has to be read rather than skimmed — the
 * light palette actually holds a higher floor there than the dark one does.
 *
 * These are the same panel-over-map surfaces `SunDial.tsx`/`SkyControl.tsx`
 * were built against (no fill, a text shadow, or a single opaque backdrop
 * disc) — the map itself stays the dark basemap in `src/ui/map/style.ts`
 * regardless of this palette, so nothing here recolours it, and any control
 * resting directly on map pixels still needs its own fixed, theme-independent
 * treatment the way those two files already have (see `MainMenu.tsx`'s
 * floating trigger for the one place that needed a matching fix once this
 * palette existed to expose it).
 */
export const lightColor: ColorTokens = {
  background: '#D8DEE5',
  surface: '#EDF0F3',
  surfaceRaised: '#FFFFFF',
  border: '#C3CBD5',

  text: '#12161B',
  textMuted: '#48505B',
  textFaint: '#727B87',

  accent: '#1B63D1',
  onAccent: '#FFFFFF',

  undocumented: '#727B87',

  danger: '#C13B30',
};

/**
 * Colours for the light-quality bands.
 *
 * Spec §5.12: the sky is driven by the SunCalc data, so the visual *is* the
 * information. At solar altitude +2° the strip renders amber because the light
 * genuinely is amber at that moment — aesthetics and function collapse into one
 * thing rather than competing.
 *
 * Data, not decoration (TASKS-profile.md B2.3/C3) — this ramp, and the
 * access-classification colours in `src/core/domain/spot.ts`'s companion UI,
 * do not change between palettes and are never driven by `useTheme()`.
 */
export const lightQualityColor = {
  daylight: '#7FB2E5',
  golden: '#F2A03D',
  blue: '#3C5BA8',
  dark: '#121722',
} as const;

/**
 * The floating menu trigger's size and offset from the safe area.
 *
 * Shared because three files stack against it — the map's mode toggle, the
 * back-to-event button and the map screen's own column all sit below it. Magic
 * numbers repeated in each would drift the moment the trigger changed height.
 */
export const MENU_TOP = 12;
export const MENU_HEIGHT = 56;

/**
 * How far down a screen's own content has to start.
 *
 * Add it to `insets.top`: the trigger hangs at `insets.top + MENU_TOP` and is
 * `MENU_HEIGHT` tall, so anything above that lands underneath it.
 *
 * The pages used to hard-code 96, which clears the trigger only where the
 * status bar is short — 24 + 12 + 56 comes to 92 on Android, four points of
 * luck. On a phone with a 59pt inset the trigger reaches 127 and the first row
 * of the page goes behind it. On the event page that row is "‹ Events", so the
 * way back was covered by the menu that also goes back, and only tappable
 * where it poked out below.
 *
 * The inset is deliberately not folded in here. It is a property of the device
 * and is read at render time; a constant that guessed it would be wrong on the
 * next screen shape, which is exactly how 96 got here.
 */
export const MENU_CLEARANCE = MENU_TOP + MENU_HEIGHT + space.sm;

/** Minimum touch target. Assume gloves (§5.14). */
export const HIT_SIZE = 56;

/**
 * Colour as a runtime value — the mechanism, and now the feature.
 *
 * `StyleSheet.create` runs once at import and freezes whatever `color.*` was
 * at that moment; there are dozens of these calls across `src/ui/`, and none
 * of them would notice a theme changed later. A context is the fix: a
 * component that reads `useTheme()` re-renders (and rebuilds its styles) when
 * the value the provider hands out changes, the way a static import never
 * can.
 *
 * ── The three states (B3) ─────────────────────────────────────────────────
 * `preference` is what the user chose — `'system'` (default), `'light'` or
 * `'dark'` — persisted through `storage-local/preferences.ts`'s
 * `getThemePreference`/`setThemePreference`. `scheme` is what that resolves
 * to *right now*: `'system'` tracks `useColorScheme()`, the other two are
 * fixed. Both are exposed on `Theme` because the profile screen's switch
 * needs to show which of the three is selected, not just which palette is
 * currently active — those differ exactly when the preference is `'system'`.
 *
 * `useColorScheme()` already subscribes to OS appearance changes reactively;
 * this provider's own `useEffect` only loads the *persisted preference* once
 * on mount; the two are independent state, so a `'system'` user's screen
 * updates the instant the OS flips at sunset without waiting on — or being
 * blocked by — the preference load. `setPreference` updates the in-memory
 * state immediately (so the switch feels instant) and persists in the
 * background.
 *
 * ── The accent hue (C1/C2) ─────────────────────────────────────────────────
 * `accentHue` is the other half of `preference`/`scheme` above: a single
 * `0-360` number, persisted through `storage-local/preferences.ts`'s
 * `getThemeAccentHue`/`setThemeAccentHue`, loaded and saved with the exact
 * same fire-and-forget-with-`.catch()` shape as `preference` two paragraphs
 * up (same underlying `kv` cold-start race B2/B3 hit). `color.accent`/
 * `color.onAccent` are *not* read from either palette const below any more —
 * they are computed every time `accentHue` or `scheme` changes, by
 * `core/logic/accentColor.ts`'s `deriveAccent`, which fixes the saturation
 * and solves the lightness per `scheme` so the result stays legible against
 * every real surface regardless of which hue the user picked (C2 — see that
 * file's own comment for the exact numbers and how they were checked). The
 * other nine tokens still come straight from `color`/`lightColor`, unchanged.
 *
 * The static `color`/`lightColor` consts above keep their own original fixed
 * `accent`/`onAccent` — deliberately: `src/ui/` files still on the static
 * `color` import (B1's deferred migration) read those directly, not through
 * `useTheme()`, and must not go stale or shift underneath them just because
 * this file grew a hue. Only values that flow through `useTheme()` pick up
 * the user's chosen hue.
 */
export interface Theme {
  color: ColorTokens;
  /** Which palette is actually in effect right now, after 'system' resolves. */
  scheme: 'light' | 'dark';
  /** The user's stored choice — 'system' unless they overrode it. */
  preference: ThemePreference;
  /** Persist a new choice and apply it immediately. */
  setPreference: (preference: ThemePreference) => void;
  /** The hue (0-360) `color.accent`/`color.onAccent` are derived from. */
  accentHue: number;
  /** Persist a new hue and apply it immediately. */
  setAccentHue: (hue: number) => void;
}

const ThemeContext = createContext<Theme>({
  color,
  scheme: 'dark',
  preference: 'system',
  setPreference: () => {},
  accentHue: DEFAULT_ACCENT_HUE,
  setAccentHue: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Independent of the preference load below — an OS appearance change
  // reaches a 'system' user immediately regardless of whether the persisted
  // preference has finished loading yet.
  const osScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [accentHue, setAccentHueState] = useState<number>(DEFAULT_ACCENT_HUE);

  useEffect(() => {
    let cancelled = false;
    void getThemePreference()
      .then((stored) => {
        if (!cancelled) setPreferenceState(stored);
      })
      .catch(() => {
        // The store failed to answer (e.g. a cold-start race on the
        // underlying kv table) — 'system' is already the state above, so
        // there is nothing to roll back to. Swallowed rather than an
        // unhandled rejection: a settings read that cannot complete is not
        // worth crashing the app over, and the next successful read (or the
        // next explicit choice, which persists again) corrects it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getThemeAccentHue()
      .then((stored) => {
        if (!cancelled) setAccentHueState(stored);
      })
      .catch(() => {
        // Same reasoning as the preference load above — DEFAULT_ACCENT_HUE
        // is already the state, so there is nothing to roll back to.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    // Update in memory first so the switch flips on the same frame it is
    // tapped; the persisted write can trail behind without the UI waiting on
    // it — a cold start reads it back via the effect above.
    setPreferenceState(next);
    // Same reasoning as the load above: a failed write should not crash the
    // screen the user is actively using it from. The choice still holds for
    // the rest of this session (in-memory state above already changed); it
    // just may not survive a restart if this particular write lost the race.
    void setThemePreference(next).catch(() => {});
  }, []);

  // A drag on the profile screen's hue slider calls setAccentHue on every
  // pointer-move frame (so the live preview updates continuously, the same
  // way `SkyControl`'s time strip scrubs `clock.now` on every move) — but
  // unlike that clock, this value is persisted, and a raw SQLite UPSERT per
  // frame (`storage-local/kv.ts`) would queue dozens of writes a second for a
  // single drag. The state update stays synchronous on every call so the
  // preview never lags; the persisted write is debounced behind it.
  const accentHueSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (accentHueSaveTimeout.current) clearTimeout(accentHueSaveTimeout.current);
    },
    [],
  );

  const setAccentHue = useCallback((next: number) => {
    // Update in memory on every call — same reasoning as setPreference
    // above, just more frequent.
    setAccentHueState(next);
    // Persist only once the drag has been idle for a moment, not on every
    // frame. Same "failed write is not fatal" reasoning as setPreference.
    if (accentHueSaveTimeout.current) clearTimeout(accentHueSaveTimeout.current);
    accentHueSaveTimeout.current = setTimeout(() => {
      accentHueSaveTimeout.current = null;
      void setThemeAccentHue(next).catch(() => {});
    }, 250);
  }, []);

  // Unknown/undetermined OS scheme (web, or a platform that reports null)
  // falls back to dark — the palette's original hard default — rather than
  // guessing light.
  const scheme: 'light' | 'dark' =
    preference === 'system' ? (osScheme === 'light' ? 'light' : 'dark') : preference;

  const value = useMemo<Theme>(() => {
    const base = scheme === 'light' ? lightColor : color;
    return {
      color: { ...base, ...deriveAccent(accentHue, scheme) },
      scheme,
      preference,
      setPreference,
      accentHue,
      setAccentHue,
    };
  }, [scheme, preference, setPreference, accentHue, setAccentHue]);

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
