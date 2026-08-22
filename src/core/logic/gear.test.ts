import { describe, expect, it } from 'vitest';
import { actualFocalLengthMm, actualFocalRangeMm } from './gear';

describe('actualFocalLengthMm', () => {
  it('is a no-op on a full-frame body', () => {
    // Canon R6 Mark II — full frame, crop factor 1.0.
    expect(actualFocalLengthMm(480, 1.0)).toBe(480);
  });

  it('divides by the crop factor on an APS-C body', () => {
    // Canon R7 — 1.6x APS-C. A 480mm full-frame-equivalent reading is
    // actually a 300mm lens on this body.
    expect(actualFocalLengthMm(480, 1.6)).toBeCloseTo(300, 10);
  });

  it('divides by a different real APS-C factor correctly', () => {
    // Most non-Canon APS-C bodies are 1.5x.
    expect(actualFocalLengthMm(300, 1.5)).toBe(200);
  });

  it('divides by a Micro Four Thirds factor correctly', () => {
    expect(actualFocalLengthMm(400, 2.0)).toBe(200);
  });

  it('rejects a zero crop factor', () => {
    expect(() => actualFocalLengthMm(480, 0)).toThrow(RangeError);
  });

  it('rejects a negative crop factor', () => {
    expect(() => actualFocalLengthMm(480, -1.6)).toThrow(RangeError);
  });
});

describe('actualFocalRangeMm', () => {
  it('converts both ends of a range', () => {
    // A 100-500mm full-frame-equivalent reading, read on a Canon R7.
    const result = actualFocalRangeMm({ minMm: 160, maxMm: 800 }, 1.6);
    expect(result.minMm).toBeCloseTo(100, 10);
    expect(result.maxMm).toBeCloseTo(500, 10);
  });

  it('passes a null end through unconverted', () => {
    const result = actualFocalRangeMm({ minMm: null, maxMm: 800 }, 1.6);
    expect(result.minMm).toBeNull();
    expect(result.maxMm).toBeCloseTo(500, 10);
  });

  it('passes an all-null range through unconverted', () => {
    expect(actualFocalRangeMm({ minMm: null, maxMm: null }, 1.6)).toEqual({
      minMm: null,
      maxMm: null,
    });
  });
});
