import { describe, expect, it } from 'vitest';

import { CENTRE, focalCrop, focalFromTap } from './focalCrop';

const box = { width: 100, height: 100 };

describe('focalCrop', () => {
  it('covers the box with a landscape image', () => {
    const c = focalCrop({ width: 200, height: 100 }, box);
    expect(c.height).toBe(100);
    expect(c.width).toBe(200);
  });

  it('covers the box with a portrait image', () => {
    const c = focalCrop({ width: 100, height: 200 }, box);
    expect(c.width).toBe(100);
    expect(c.height).toBe(200);
  });

  it('centres by default, exactly as a plain centre-crop did', () => {
    // An image nobody has adjusted must render as it always has.
    const c = focalCrop({ width: 200, height: 100 }, box);
    expect(c.left).toBe(-50);
    expect(c.top).toBe(0);
  });

  it('slides towards a focal point left of centre', () => {
    const c = focalCrop({ width: 200, height: 100 }, box, { x: 0.25, y: 0.5 });
    // The quarter point is at x=50 in the scaled image; centring it in a
    // 100-wide box wants left = 0.
    expect(c.left).toBe(0);
  });

  it('never exposes an edge, even for a focal point in the corner', () => {
    // A corner cannot be centred without leaving the box empty, and a strip
    // of background is a worse failure than an off-centre subject.
    const c = focalCrop({ width: 200, height: 100 }, box, { x: 0, y: 0 });
    expect(c.left).toBeLessThanOrEqual(0);
    expect(c.left).toBeGreaterThanOrEqual(box.width - c.width);
    expect(c.top).toBe(0);
  });

  it('clamps a focal point outside the image', () => {
    const c = focalCrop({ width: 200, height: 100 }, box, { x: 5, y: -3 });
    expect(c.left).toBe(box.width - c.width);
    expect(c.top).toBe(0);
  });

  it('returns the box rather than NaN for a zero-sized image', () => {
    // Image.getSize can report 0 while a file is still resolving, and a NaN
    // offset puts the image somewhere unrenderable rather than merely wrong.
    const c = focalCrop({ width: 0, height: 0 }, box);
    expect(c).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('survives a non-finite focal point', () => {
    const c = focalCrop({ width: 200, height: 100 }, box, { x: NaN, y: NaN });
    expect(Number.isFinite(c.left)).toBe(true);
    expect(Number.isFinite(c.top)).toBe(true);
  });

  it('always covers the box completely', () => {
    for (const natural of [
      { width: 300, height: 100 },
      { width: 100, height: 400 },
      { width: 640, height: 480 },
      { width: 99, height: 101 },
    ]) {
      for (const f of [CENTRE, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.2, y: 0.8 }]) {
        const c = focalCrop(natural, box, f);
        expect(c.left).toBeLessThanOrEqual(0.0001);
        expect(c.top).toBeLessThanOrEqual(0.0001);
        expect(c.left + c.width).toBeGreaterThanOrEqual(box.width - 0.0001);
        expect(c.top + c.height).toBeGreaterThanOrEqual(box.height - 0.0001);
      }
    }
  });
});

describe('focalFromTap', () => {
  it('turns a tap in the middle into the point already centred', () => {
    const natural = { width: 200, height: 100 };
    const f = focalFromTap({ x: 50, y: 50 }, natural, box, CENTRE);
    expect(f.x).toBeCloseTo(0.5);
    expect(f.y).toBeCloseTo(0.5);
  });

  it('round-trips: tapping a point makes it the new centre', () => {
    // The property that matters — tap something, and it moves to the middle.
    const natural = { width: 200, height: 100 };
    const tapped = focalFromTap({ x: 20, y: 50 }, natural, box, CENTRE);
    const after = focalCrop(natural, box, tapped);
    const wherePointNowIs = after.left + tapped.x * after.width;
    expect(wherePointNowIs).toBeCloseTo(box.width / 2);
  });

  it('clamps a tap outside the box', () => {
    const f = focalFromTap({ x: -40, y: 900 }, { width: 200, height: 100 }, box);
    expect(f.x).toBeGreaterThanOrEqual(0);
    expect(f.y).toBeLessThanOrEqual(1);
  });

  it('falls back to the centre for a degenerate image', () => {
    expect(focalFromTap({ x: 10, y: 10 }, { width: 0, height: 0 }, box)).toEqual(CENTRE);
  });
});
