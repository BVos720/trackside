import { createContext, createElement, useContext, type ReactNode } from 'react';

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
 * `color` below stays the dark palette, unchanged, and is not the only
 * theme forever — see `ThemeProvider`/`useTheme` at the bottom of this file,
 * which exist so a second (light) palette can be selected at runtime rather
 * than requiring every screen to re-import a different constant. For now the
 * provider always hands out this same dark `color`; the light palette itself
 * is a later change, not this one.
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

export const color = {
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
} as const;

/**
 * Colours for the light-quality bands.
 *
 * Spec §5.12: the sky is driven by the SunCalc data, so the visual *is* the
 * information. At solar altitude +2° the strip renders amber because the light
 * genuinely is amber at that moment — aesthetics and function collapse into one
 * thing rather than competing.
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
 * Colour as a runtime value — the mechanism, not the feature.
 *
 * `StyleSheet.create` runs once at import and freezes whatever `color.*` was
 * at that moment; there are dozens of these calls across `src/ui/`, and none
 * of them would notice a theme changed later. A context is the fix: a
 * component that reads `useTheme()` re-renders (and rebuilds its styles) when
 * the value the provider hands out changes, the way a static import never
 * can.
 *
 * `Theme` is deliberately just `{ color }` for now — the smallest shape that
 * proves the mechanism. Whoever adds the light palette and the accent hue
 * (profile sections B2/B3, C) extends this shape and this provider; they
 * should not need to touch call sites that already migrated to `useTheme()`.
 *
 * This provider is intentionally inert: it always hands out the same dark
 * `color` object above, unconditionally. No picker, no persistence, no
 * second palette — that is later work. Landing here is only about proving
 * every `StyleSheet.create` call site *can* read colour at render time
 * instead of at import time, on a small slice of the app, with zero visible
 * change.
 */
export interface Theme {
  color: typeof color;
}

const ThemeContext = createContext<Theme>({ color });

export function ThemeProvider({ children }: { children: ReactNode }) {
  return createElement(ThemeContext.Provider, { value: { color } }, children);
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
