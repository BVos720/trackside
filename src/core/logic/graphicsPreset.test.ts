import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GRAPHICS,
  presetOf,
  sceneryRadiusDegrees,
  settingsForPreset,
  type GraphicsSettings,
} from './graphicsPreset';

describe('settingsForPreset', () => {
  it('turns the expensive things off at low', () => {
    const low = settingsForPreset('low');
    expect(low.scenery).toBe(false);
    expect(low.rain).toBe(false);
    expect(low.stars).toBe(false);
    expect(low.hillshade).toBe(false);
  });

  it('turns everything on at high', () => {
    const high = settingsForPreset('high');
    expect(high.scenery).toBe(true);
    expect(high.rain).toBe(true);
    expect(high.stars).toBe(true);
    expect(high.hillshade).toBe(true);
  });

  it('puts medium between the two', () => {
    const m = settingsForPreset('medium');
    expect(m.scenery).toBe(true);
    // Rain is the one that animates continuously, so it is the one medium
    // gives up first.
    expect(m.rain).toBe(false);
  });

  it('reaches less far for scenery as the preset drops', () => {
    expect(sceneryRadiusDegrees(settingsForPreset('low').sceneryDistance)).toBeLessThan(
      sceneryRadiusDegrees(settingsForPreset('high').sceneryDistance),
    );
  });

  it('defaults to everything on', () => {
    // Nobody who never opens the setting should see the app get quieter.
    expect(DEFAULT_GRAPHICS).toEqual(settingsForPreset('high'));
  });
});

describe('presetOf', () => {
  it('recognises each preset', () => {
    for (const name of ['low', 'medium', 'high'] as const) {
      expect(presetOf(settingsForPreset(name))).toBe(name);
    }
  });

  it('returns null once a switch has been changed', () => {
    // Snapping to the nearest preset would claim a state nobody chose, and
    // make the next tap on it appear to do nothing.
    const custom: GraphicsSettings = { ...settingsForPreset('low'), rain: true };
    expect(presetOf(custom)).toBeNull();
  });

  it('notices a difference in distance alone', () => {
    const custom: GraphicsSettings = {
      ...settingsForPreset('high'),
      sceneryDistance: 'mid',
    };
    expect(presetOf(custom)).toBeNull();
  });
});

describe('sceneryRadiusDegrees', () => {
  it('increases with distance', () => {
    expect(sceneryRadiusDegrees('near')).toBeLessThan(sceneryRadiusDegrees('mid'));
    expect(sceneryRadiusDegrees('mid')).toBeLessThan(sceneryRadiusDegrees('far'));
  });

  it('makes far big enough to mean "everything in the extract"', () => {
    // The scatter is clipped to the corridor anyway, so anything larger adds
    // no features and the value only has to stop being a limit.
    expect(sceneryRadiusDegrees('far')).toBeGreaterThan(0.5);
  });
});
