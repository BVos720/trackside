import { describe, expect, it } from 'vitest';
import { cloudPlacement, projectFootprint, shadowOffset, shadowStrength, treeFootprint } from './sceneShadows';

describe('scenery lighting geometry', () => {
  it('projects opposite each compass direction in both hemispheres', () => {
    for (const lat of [-50, 0, 50]) {
      expect(shadowOffset(10, 90, 45, lat)![0]).toBeLessThan(0);
      expect(shadowOffset(10, 270, 45, lat)![0]).toBeGreaterThan(0);
      expect(shadowOffset(10, 0, 45, lat)![1]).toBeLessThan(0);
      expect(shadowOffset(10, 180, 45, lat)![1]).toBeGreaterThan(0);
      expect(shadowOffset(10, 90, 45, lat)![0] * 111320 * Math.cos(lat * Math.PI / 180)).toBeCloseTo(-10);
    }
  });
  it('shortens with the sun and caps near-horizon geometry', () => {
    expect(Math.abs(shadowOffset(10, 90, 70, 0)![0])).toBeLessThan(Math.abs(shadowOffset(10, 90, 15, 0)![0]));
    expect(shadowOffset(100, 90, 0.001, 0)![0] * 111320).toBeCloseTo(-600);
    expect(shadowStrength(0.001, 0)).toBeLessThan(0.001);
  });
  it('rejects missing heights, malformed rings, and sun below the horizon', () => {
    for (const height of [NaN, Infinity, 0, -2]) expect(shadowOffset(height, 90, 30, 50)).toBeNull();
    expect(shadowOffset(10, 90, -1, 50)).toBeNull();
    expect(projectFootprint([[6, 50], [NaN, 51], [7, 52]], 10, 90, 30)).toBeNull();
    expect(shadowStrength(-1, 0)).toBe(0);
  });
  it('produces a closed silhouette containing the roof and its cast extent', () => {
    const ring = [[6, 50], [6.001, 50], [6.001, 50.001], [6, 50.001], [6, 50]];
    const hull = projectFootprint(ring, 20, 90, 45)!;
    expect(hull[0]).toEqual(hull.at(-1));
    expect(Math.min(...hull.map(p => p[0]!))).toBeLessThan(6);
    expect(Math.max(...hull.map(p => p[0]!))).toBe(6.001);
    expect(projectFootprint([[0, 0], [0, 0], [0, 0]], 10, 90, 45)).toBeNull();
  });
  it('uses metres for tree crowns and weakens shade under overcast', () => {
    const crown = treeFootprint(6, 50);
    expect((crown[0]![0]! - 6) * 111320 * Math.cos(50 * Math.PI / 180)).toBeCloseTo(3.5);
    expect(shadowStrength(20, 100)).toBeLessThan(shadowStrength(20, 0) / 4);
  });
  it('keeps clouds and their projected height fixed through camera movement', () => {
    const below = cloudPlacement(300, 400, 70), above = cloudPlacement(300, 4000, 70);
    expect(below.base).toBe(above.base);
    expect(below.thickness).toBe(above.thickness);
    expect(below.visible).toBe(1);
    expect(above.visible).toBe(0);
  });
});
