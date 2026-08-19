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

/** Minimum touch target. Assume gloves (§5.14). */
export const HIT_SIZE = 56;
