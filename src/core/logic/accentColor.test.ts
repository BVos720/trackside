import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  DEFAULT_ACCENT_HUE,
  deriveAccent,
  hslToHex,
  hslToRgb,
  normalizeHue,
  pickReadableText,
  relativeLuminance,
  rgbToHex,
} from './accentColor';

/**
 * The three real surfaces each palette actually renders against
 * (`theme.ts`), by scheme. `accent`/`onAccent` are excluded — they are what
 * this module derives, not a fixed surface to check against.
 */
const DARK_SURFACES = {
  background: '#0B0D10',
  surface: '#161A20',
  surfaceRaised: '#1F242C',
};
const LIGHT_SURFACES = {
  background: '#D8DEE5',
  surface: '#EDF0F3',
  surfaceRaised: '#FFFFFF',
};

const WCAG_TEXT_FLOOR = 4.5;

describe('normalizeHue', () => {
  it('leaves an in-range hue unchanged', () => {
    expect(normalizeHue(0)).toBe(0);
    expect(normalizeHue(180)).toBe(180);
    expect(normalizeHue(359.5)).toBeCloseTo(359.5);
  });

  it('wraps 360 and above', () => {
    expect(normalizeHue(360)).toBe(0);
    expect(normalizeHue(720)).toBe(0);
    expect(normalizeHue(400)).toBeCloseTo(40);
  });

  it('wraps negative hues', () => {
    expect(normalizeHue(-1)).toBeCloseTo(359);
    expect(normalizeHue(-360)).toBe(0);
    expect(normalizeHue(-720)).toBe(0);
  });
});

describe('hslToRgb / rgbToHex / hslToHex', () => {
  it('renders pure red, green, blue at full saturation', () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual({ r: 255, g: 0, b: 0 });
    expect(hslToRgb(120, 1, 0.5)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hslToRgb(240, 1, 0.5)).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('renders black and white regardless of hue/saturation', () => {
    expect(hslToRgb(200, 0.8, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(hslToRgb(200, 0.8, 1)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('zero saturation is a grey independent of hue', () => {
    expect(hslToRgb(0, 0, 0.5)).toEqual(hslToRgb(270, 0, 0.5));
  });

  it('round-trips through rgbToHex as an uppercase #RRGGBB string', () => {
    expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe('#FF0000');
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(hslToHex(0, 1, 0.5)).toBe('#FF0000');
  });

  it('clamps out-of-range saturation/lightness rather than producing garbage', () => {
    expect(hslToRgb(0, -1, 0.5)).toEqual(hslToRgb(0, 0, 0.5));
    expect(hslToRgb(0, 2, 0.5)).toEqual(hslToRgb(0, 1, 0.5));
    expect(hslToRgb(0, 0.5, -1)).toEqual(hslToRgb(0, 0.5, 0));
    expect(hslToRgb(0, 0.5, 2)).toEqual(hslToRgb(0, 0.5, 1));
  });
});

describe('relativeLuminance / contrastRatio', () => {
  it('black is 0, white is 1', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBe(1);
  });

  it('black on white is the maximum WCAG ratio, 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('a colour against itself is 1:1', () => {
    expect(contrastRatio('#2E7DF6', '#2E7DF6')).toBeCloseTo(1, 5);
  });

  it('is symmetric in its two arguments', () => {
    expect(contrastRatio('#2E7DF6', '#0B0D10')).toBeCloseTo(
      contrastRatio('#0B0D10', '#2E7DF6'),
      10,
    );
  });
});

describe('pickReadableText', () => {
  it('picks near-black on a light colour', () => {
    expect(pickReadableText('#FFFFFF')).toBe('#08111F');
  });

  it('picks white on a dark colour', () => {
    expect(pickReadableText('#000000')).toBe('#FFFFFF');
  });
});

describe('deriveAccent — exhaustive hue sweep (TASKS-profile.md C2)', () => {
  const schemes: Array<{ scheme: 'dark' | 'light'; surfaces: typeof DARK_SURFACES }> = [
    { scheme: 'dark', surfaces: DARK_SURFACES },
    { scheme: 'light', surfaces: LIGHT_SURFACES },
  ];

  for (const { scheme, surfaces } of schemes) {
    describe(`${scheme} scheme`, () => {
      it('holds the 4.5:1 WCAG text floor against every real surface, for all 360 hues', () => {
        const failures: string[] = [];
        for (let hue = 0; hue < 360; hue++) {
          const { accent } = deriveAccent(hue, scheme);
          for (const [name, hex] of Object.entries(surfaces)) {
            const ratio = contrastRatio(accent, hex);
            if (ratio < WCAG_TEXT_FLOOR) {
              failures.push(`hue ${hue} vs ${name}: ${ratio.toFixed(2)}:1 (accent ${accent})`);
            }
          }
        }
        expect(failures).toEqual([]);
      });

      it('holds the 4.5:1 WCAG text floor between accent and its own onAccent, for all 360 hues', () => {
        const failures: string[] = [];
        for (let hue = 0; hue < 360; hue++) {
          const { accent, onAccent } = deriveAccent(hue, scheme);
          const ratio = contrastRatio(accent, onAccent);
          if (ratio < WCAG_TEXT_FLOOR) {
            failures.push(`hue ${hue}: ${ratio.toFixed(2)}:1 (accent ${accent}, onAccent ${onAccent})`);
          }
        }
        expect(failures).toEqual([]);
      });

      it('onAccent is always either white or the shared near-black', () => {
        for (let hue = 0; hue < 360; hue += 3) {
          const { onAccent } = deriveAccent(hue, scheme);
          expect(['#FFFFFF', '#08111F']).toContain(onAccent);
        }
      });

      it('produces a valid #RRGGBB hex for every hue, including fractional and wrapped input', () => {
        for (const hue of [0, 0.5, 45.25, 359.9, 360, 720, -30, -400]) {
          const { accent } = deriveAccent(hue, scheme);
          expect(accent).toMatch(/^#[0-9A-F]{6}$/);
        }
      });
    });
  }

  it('is deterministic — same hue and scheme always derive the same colours', () => {
    expect(deriveAccent(216, 'dark')).toEqual(deriveAccent(216, 'dark'));
    expect(deriveAccent(216, 'light')).toEqual(deriveAccent(216, 'light'));
  });

  it('the same hue derives a different accent for each scheme', () => {
    const dark = deriveAccent(200, 'dark');
    const light = deriveAccent(200, 'light');
    expect(dark.accent).not.toBe(light.accent);
  });

  it('DEFAULT_ACCENT_HUE sits in-range and derives a legible accent in both schemes', () => {
    expect(DEFAULT_ACCENT_HUE).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_ACCENT_HUE).toBeLessThan(360);
    for (const scheme of ['dark', 'light'] as const) {
      const { accent, onAccent } = deriveAccent(DEFAULT_ACCENT_HUE, scheme);
      for (const hex of Object.values(scheme === 'dark' ? DARK_SURFACES : LIGHT_SURFACES)) {
        expect(contrastRatio(accent, hex)).toBeGreaterThanOrEqual(WCAG_TEXT_FLOOR);
      }
      expect(contrastRatio(accent, onAccent)).toBeGreaterThanOrEqual(WCAG_TEXT_FLOOR);
    }
  });
});
