import { describe, it, expect } from 'vitest';
import { terrainShadowMask, TERRAIN_SHADOW_FUNCTION } from './terrainShadow';

describe('terrain cast shadows', () => {
  it('keeps the source shipped to Hermes WebViews equivalent to the typed kernel', () => {
    const embedded = new Function(`return (${TERRAIN_SHADOW_FUNCTION});`)() as typeof terrainShadowMask;
    const grid = Float32Array.from({ length: 121 }, (_, i) => i % 17 === 0 ? NaN : Math.sin(i * 1.71) * 150 + 300);
    for (const azimuth of [0, 45, 90, 135, 180, 270, 359]) for (const altitude of [-3, 2, 15, 45, 89]) {
      expect(embedded(grid, 11, 1900, 500, azimuth, altitude)).toEqual(terrainShadowMask(grid, 11, 1900, 500, azimuth, altitude));
    }
  });
  it('casts away from the sun and reverses with its azimuth', () => {
    const grid = new Float32Array(25);
    for (let y = 0; y < 5; y++) grid[y * 5 + 2] = 100;
    const east = terrainShadowMask(grid, 5, 400, 400, 90, 10);
    const west = terrainShadowMask(grid, 5, 400, 400, 270, 10);
    expect(east[10]).toBe(1); expect(east[14]).toBe(0);
    expect(west[10]).toBe(0); expect(west[14]).toBe(1);
  });
  it('shortens shadows with a higher sun', () => {
    const grid = new Float32Array(25); grid[12] = 80;
    expect(terrainShadowMask(grid, 5, 400, 400, 90, 10)[10]).toBe(1);
    expect(terrainShadowMask(grid, 5, 400, 400, 90, 60)[10]).toBe(0);
  });
  it('preserves compass direction on a rectangular grid', () => {
    const grid = new Float32Array(25); grid[2 * 5 + 1] = 500;
    // NE travels 100m east and 100m north: one column, two rows here.
    expect(terrainShadowMask(grid, 5, 400, 200, 45, 10)[0]).toBe(1);
  });
  it('does not invent terrain or direct sunlight when data is missing or the sun is down', () => {
    const grid = new Float32Array(25).fill(NaN);
    expect([...terrainShadowMask(grid, 5, 400, 400, 90, 10)].some(Boolean)).toBe(false);
    grid[12] = 200;
    expect([...terrainShadowMask(grid, 5, 400, 400, 90, -5)].some(Boolean)).toBe(false);
  });
});
