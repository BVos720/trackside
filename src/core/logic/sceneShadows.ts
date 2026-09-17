/** Ground projections for the illustrative scenery, never an access/viewshed model. */
export function shadowOffset(height: number, azimuth: number, altitude: number, latitude: number): [number, number] | null {
  if (![height, azimuth, altitude, latitude].every(Number.isFinite) || height <= 0 || altitude <= 0 || altitude >= 90 || Math.abs(latitude) >= 85) return null;
  // Fade at the horizon in the renderer; cap geometry to avoid kilometre-long polygons.
  const length = Math.min(600, height / Math.tan(altitude * Math.PI / 180));
  const az = azimuth * Math.PI / 180;
  return [-Math.sin(az) * length / (111320 * Math.cos(latitude * Math.PI / 180)), -Math.cos(az) * length / 110540];
}

/** Convex silhouette of a footprint swept away from the sun. Concave roofs are approximated. */
export function projectFootprint(ring: readonly (readonly number[])[], height: number, azimuth: number, altitude: number): number[][] | null {
  if (ring.length < 3 || !ring.every(p => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return null;
  const offset = shadowOffset(height, azimuth, altitude, ring[0]![1]!);
  if (!offset) return null;
  const points = ring.flatMap(p => [[p[0]!, p[1]!], [p[0]! + offset[0], p[1]! + offset[1]]]);
  points.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  const cross = (a: number[], b: number[], c: number[]) => (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
  const lower: number[][] = [], upper: number[][] = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  return hull.length >= 3 ? [...hull, hull[0]!] : null;
}

export function treeFootprint(lng: number, lat: number, radius = 3.5): number[][] {
  return Array.from({ length: 12 }, (_, i) => {
    const angle = i * Math.PI / 6;
    return [lng + Math.cos(angle) * radius / (111320 * Math.cos(lat * Math.PI / 180)), lat + Math.sin(angle) * radius / 110540];
  });
}

/** A stable modelled cloud deck: zooming changes visibility, never its ground shadow. */
export function cloudPlacement(ground: number, cameraHeight: number, cover: number) {
  const base = ground + 900;
  const thickness = 450 + Math.max(0, Math.min(100, cover)) * 6;
  const visible = Math.max(0, Math.min(1, (base - cameraHeight + 300) / 600));
  return { base, thickness, visible };
}

export function shadowStrength(altitude: number, cover: number): number {
  if (!Number.isFinite(altitude) || !Number.isFinite(cover) || altitude <= 0) return 0;
  return (0.32 + Math.max(0, (50 - altitude) / 50) * 0.38) * Math.min(1, altitude / 4) * (1 - Math.max(0, Math.min(100, cover)) / 100 * 0.85);
}
