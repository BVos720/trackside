import { describe, expect, it, vi } from 'vitest';

import { isSoundGeometry, safeFeatureCollection } from './geojsonSafety';

const point = (coords: unknown) => ({ type: 'Point', coordinates: coords });
const line = (coords: unknown) => ({ type: 'LineString', coordinates: coords });
const feature = (geometry: unknown) => ({ type: 'Feature', properties: {}, geometry });
const fc = (features: unknown[]) => ({ type: 'FeatureCollection', features });

describe('isSoundGeometry', () => {
  it('accepts an ordinary point', () => {
    expect(isSoundGeometry(point([6.95, 50.35]))).toBe(true);
  });

  it('accepts elevation as a third number', () => {
    expect(isSoundGeometry(point([6.95, 50.35, 620]))).toBe(true);
  });

  it('rejects NaN, which JSON.stringify turns into null', () => {
    // This is the whole reason the module exists: a NaN three layers away
    // arrives at the C++ parser as a null and aborts the process.
    expect(isSoundGeometry(point([NaN, 50.35]))).toBe(false);
  });

  it('rejects null in a position', () => {
    expect(isSoundGeometry(point([null, 50.35]))).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(isSoundGeometry(point([Infinity, 50.35]))).toBe(false);
  });

  it('rejects a position with only one number', () => {
    expect(isSoundGeometry(point([6.95]))).toBe(false);
  });

  it('rejects a LineString with a single position', () => {
    // Legal-looking, and still fatal: a line needs two ends.
    expect(isSoundGeometry(line([[6.95, 50.35]]))).toBe(false);
  });

  it('accepts a LineString with two positions', () => {
    expect(isSoundGeometry(line([[6.95, 50.35], [6.96, 50.36]]))).toBe(true);
  });

  it('rejects a LineString with one bad position among good ones', () => {
    expect(
      isSoundGeometry(line([[6.95, 50.35], [NaN, 50.36], [6.97, 50.37]])),
    ).toBe(false);
  });

  it('rejects an unrecognised geometry type rather than assuming it is safe', () => {
    // The parser knows a shorter list than the spec does, and guessing on its
    // behalf is how the crash happens in the first place.
    expect(isSoundGeometry({ type: 'Circle', coordinates: [6.95, 50.35] })).toBe(false);
  });

  it('rejects null and non-objects', () => {
    expect(isSoundGeometry(null)).toBe(false);
    expect(isSoundGeometry('Point')).toBe(false);
  });

  it('handles a polygon', () => {
    const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
    expect(isSoundGeometry({ type: 'Polygon', coordinates: [ring] })).toBe(true);
  });

  it('rejects a polygon ring that is too short to close', () => {
    expect(isSoundGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] })).toBe(false);
  });
});

describe('safeFeatureCollection', () => {
  it('keeps sound features', () => {
    const good = fc([feature(point([6.95, 50.35]))]);
    expect(safeFeatureCollection(good).features).toHaveLength(1);
  });

  it('drops the bad one and keeps the rest', () => {
    // One unusable row must not take the whole map down with it.
    const mixed = fc([
      feature(point([6.95, 50.35])),
      feature(point([NaN, 50.36])),
      feature(point([6.97, 50.37])),
    ]);
    expect(safeFeatureCollection(mixed).features).toHaveLength(2);
  });

  it('drops a feature with null geometry', () => {
    // Legal GeoJSON that the parser still rejects — valid but fatal.
    expect(safeFeatureCollection(fc([feature(null)])).features).toHaveLength(0);
  });

  it('reports what it dropped', () => {
    // Silently losing a pin is its own bug, harder to explain than a crash.
    const onDrop = vi.fn();
    safeFeatureCollection(fc([feature(point([NaN, 1]))]), onDrop);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop.mock.calls[0]![0]).toBe('unusable coordinates');
  });

  it('returns the same object when nothing was wrong', () => {
    // So React does not re-set the source on every render.
    const good = fc([feature(point([6.95, 50.35]))]);
    expect(safeFeatureCollection(good)).toBe(good);
  });

  it('survives a missing features array', () => {
    const bare: { features?: unknown } = { type: 'FeatureCollection' } as never;
    expect(safeFeatureCollection(bare).features).toBeUndefined();
  });

  it('survives being handed nothing at all', () => {
    expect(
      safeFeatureCollection(null as unknown as { features?: unknown }),
    ).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
