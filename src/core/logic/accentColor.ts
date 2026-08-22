/**
 * Deriving `accent`/`onAccent` from a user-chosen hue — TASKS-profile.md C1/C2.
 *
 * The profile screen's slider (`ProfileScreen.tsx`, Appearance section) only
 * ever produces one number: a hue, 0-360. It does not expose saturation or
 * lightness, and nothing here accepts them from a caller — that is the
 * mechanism behind C2's "being unable to make the app unreadable is a
 * feature." Saturation is fixed per `scheme`; lightness is *solved*, not
 * clamped from a slider value, so it comes out different for every hue by
 * construction — see "Why lightness is solved, not clamped" below.
 *
 * ── Why lightness is solved, not clamped ──────────────────────────────────
 * HSL lightness does not track perceived brightness across hues: a pure
 * yellow (`hue` 60) at L 50% is far brighter than a pure blue (`hue` 240) at
 * the same L, because WCAG relative luminance weights green heavily (0.7152)
 * and blue barely (0.0722) — see `relativeLuminance` below. A single fixed
 * lightness clamp (e.g. "L between 40% and 60%") would therefore hold
 * contrast for some hues and fail it for others; TASKS-profile.md C2 asks for
 * a range that holds for *every* hue the slider can produce, not most of
 * them.
 *
 * So `deriveAccent` fixes a target WCAG relative luminance per `scheme`
 * instead of a target lightness, and binary-searches `l` (`solveLightness`)
 * until the resulting colour's actual luminance reaches it. The lightness
 * that comes out varies by hue — yellow lands at a much lower `l` than blue
 * for the same luminance — which is exactly the point: luminance, not
 * lightness, is what the WCAG contrast formula (`contrastRatio`) actually
 * consumes, so normalising it is what makes the contrast promise hue-
 * independent.
 *
 * ── The two targets, and how they were picked ─────────────────────────────
 * `ACCENT_PROFILE.dark`/`.light` below hold the fixed saturation and target
 * luminance used for each `scheme`. They were chosen by sweeping all 360
 * integer hues against the real palette surfaces in `theme.ts`
 * (`background`/`surface`/`surfaceRaised`, both palettes) and the WCAG 4.5:1
 * text floor this codebase already holds itself to (B2's palette work, see
 * `theme.ts`'s `lightColor` comment):
 *
 *   - dark scheme: S 65%, target luminance 0.32. `surfaceRaised` (`#1F242C`,
 *     the *lightest* of the three dark surfaces, so the hardest case for a
 *     light-on-dark accent) sets the binding constraint — target luminance
 *     has to clear ~0.253 to hold 4.5:1 there, and 0.32 leaves comfortable
 *     margin. Swept minimum contrast across all 360 hues: 5.44:1 (surfaces),
 *     6.60:1 (`onAccent` on the accent fill).
 *   - light scheme: S 70%, target luminance 0.09. `background` (`#D8DEE5`,
 *     the *darkest* of the three light surfaces despite being the "floor" —
 *     see `theme.ts`'s light-palette comment — so the hardest case for a
 *     dark-on-light accent) sets the binding constraint — target luminance
 *     has to stay under ~0.122 to hold 4.5:1 there, and 0.09 leaves
 *     comfortable margin. Swept minimum contrast: 5.47:1 (surfaces), 7.41:1
 *     (`onAccent`).
 *
 * Both numbers were re-derived from the actual current hex values in
 * `theme.ts`, not eyeballed — see `accentColor.test.ts`'s exhaustive sweep,
 * which re-checks all 360 hues against both schemes' three real surfaces on
 * every test run rather than trusting these two numbers to stay correct if
 * the palette ever moves.
 *
 * ── `onAccent` ─────────────────────────────────────────────────────────────
 * Picked per accent, not fixed per scheme: `pickReadableText` compares the
 * WCAG contrast ratio the accent gets against white versus against a
 * near-black (`#08111F`, the dark palette's existing `onAccent` value, reused
 * rather than inventing a second near-black) and returns whichever wins. In
 * practice this always resolves to near-black for the dark scheme's lighter
 * accents and white for the light scheme's darker ones (matching each
 * palette's original fixed `onAccent`), but it is computed rather than
 * assumed so a change to either target luminance above cannot silently break
 * it.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Wrap any real number to the `[0, 360)` hue circle. */
export function normalizeHue(hue: number): number {
  const wrapped = hue % 360;
  // `-0 % 360 === -0` in JS (e.g. hue === -360), which is < 0 is false, so it
  // would otherwise pass through unchanged — `+ 0` folds it back to `0`.
  return (wrapped < 0 ? wrapped + 360 : wrapped) + 0;
}

function hueToChannel(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

/**
 * HSL to RGB. `hue` is any real number (wrapped via `normalizeHue`);
 * `saturation`/`lightness` are `0-1` and clamped defensively.
 */
export function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const h = normalizeHue(hue) / 360;
  const s = Math.max(0, Math.min(1, saturation));
  const l = Math.max(0, Math.min(1, lightness));

  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hueToChannel(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToChannel(p, q, h) * 255),
    b: Math.round(hueToChannel(p, q, h - 1 / 3) * 255),
  };
}

function toHexByte(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`.toUpperCase();
}

/** HSL to a `#RRGGBB` hex string, in one call. */
export function hslToHex(hue: number, saturation: number, lightness: number): string {
  return rgbToHex(hslToRgb(hue, saturation, lightness));
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

/** sRGB 0-255 channel to its linear-light 0-1 value — the WCAG formula's own step. */
function linearizeChannel(channel255: number): number {
  const c = channel255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminanceOfRgb({ r, g, b }: Rgb): number {
  return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
}

/**
 * WCAG relative luminance, `0` (black) to `1` (white) — the same formula
 * behind the 4.5:1 text floor this codebase already holds itself to
 * (`theme.ts`'s `lightColor` comment, B2).
 */
export function relativeLuminance(hex: string): number {
  return relativeLuminanceOfRgb(hexToRgb(hex));
}

/** WCAG contrast ratio between two colours, `1` (identical) to `21` (black on white). */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The dark palette's existing `onAccent` value (`theme.ts`) — reused rather than a second near-black. */
const NEAR_BLACK = '#08111F';
const WHITE = '#FFFFFF';

/**
 * White or `NEAR_BLACK`, whichever holds the higher contrast ratio against
 * `hex` — the label drawn on an accent-filled control (C2.1).
 */
export function pickReadableText(hex: string): string {
  const white = contrastRatio(hex, WHITE);
  const black = contrastRatio(hex, NEAR_BLACK);
  return white >= black ? WHITE : NEAR_BLACK;
}

/**
 * Binary-search the `l` (0-1) that makes `hslToRgb(hue, saturation, l)`'s
 * relative luminance reach `targetLuminance`. Luminance rises monotonically
 * with `l` at fixed hue/saturation, so bisection converges cleanly; 32
 * iterations resolves `l` to well beyond 8-bit-per-channel precision.
 */
function solveLightnessForLuminance(
  hue: number,
  saturation: number,
  targetLuminance: number,
): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const luminance = relativeLuminanceOfRgb(hslToRgb(hue, saturation, mid));
    if (luminance < targetLuminance) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Fixed saturation and target WCAG luminance per `scheme` — see the file
 * comment above for how these were picked and what they guarantee.
 */
const ACCENT_PROFILE: Record<'light' | 'dark', { saturation: number; targetLuminance: number }> = {
  dark: { saturation: 0.65, targetLuminance: 0.32 },
  light: { saturation: 0.7, targetLuminance: 0.09 },
};

export interface AccentColors {
  readonly accent: string;
  readonly onAccent: string;
}

/**
 * Derive `accent`/`onAccent` from a stored hue (any real number; wrapped) and
 * the active `scheme`. Pure and deterministic — same inputs, same colours,
 * every render; `theme.ts`'s `ThemeProvider` is the only caller, memoised
 * there on `[hue, scheme]`.
 */
export function deriveAccent(hue: number, scheme: 'light' | 'dark'): AccentColors {
  const { saturation, targetLuminance } = ACCENT_PROFILE[scheme];
  const lightness = solveLightnessForLuminance(hue, saturation, targetLuminance);
  const accent = hslToHex(hue, saturation, lightness);
  return { accent, onAccent: pickReadableText(accent) };
}

/**
 * The hue a fresh install (or any stored value this store has never written)
 * resolves to — TASKS-profile.md's own original fixed accent, `#2E7DF6`
 * (dark) / `#1B63D1` (light), both ~216° on the hue circle. A new user's
 * first launch keeps the app's original blue rather than jumping to an
 * arbitrary default hue nobody chose.
 */
export const DEFAULT_ACCENT_HUE = 216;
