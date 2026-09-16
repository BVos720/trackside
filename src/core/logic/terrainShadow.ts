/** Horizon test on a north-up DEM grid. Distances are in metres, angles in degrees. */
export function terrainShadowMask(grid: ArrayLike<number>, size: number, widthMetres: number, heightMetres: number, azimuth: number, altitude: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size);
  if (size < 2 || widthMetres <= 0 || heightMetres <= 0 || altitude <= 0 || altitude >= 90) return out;
  const mx = widthMetres / (size - 1), my = heightMetres / (size - 1);
  const angle = azimuth * Math.PI / 180;
  const step = Math.min(mx, my);
  // Convert the solar direction to grid units: rectangular venues need different X/Y steps.
  const dx = Math.sin(angle) * step / mx, dy = Math.cos(angle) * step / my;
  const slope = Math.tan(altitude * Math.PI / 180);
  const steps = Math.ceil(Math.hypot(widthMetres, heightMetres) / step);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const base = grid[j * size + i];
    if (typeof base !== 'number' || !Number.isFinite(base)) continue;
    for (let k = 1; k <= steps; k++) {
      const x = i + dx * k, y = j + dy * k;
      if (x < 0 || y < 0 || x > size - 1 || y > size - 1) break;
      const height = grid[Math.round(y) * size + Math.round(x)];
      if (typeof height === 'number' && Number.isFinite(height) && height > base + k * step * slope + 1) { out[j * size + i] = 1; break; }
    }
  }
  return out;
}

/**
 * Source for the WebView bridge. Do not use Function.toString(): Hermes release
 * bytecode does not retain function source. Parity is checked against the typed kernel.
 */
export const TERRAIN_SHADOW_FUNCTION = `function (grid, size, widthMetres, heightMetres, azimuth, altitude) {
  var out = new Uint8ClampedArray(size * size);
  if (size < 2 || widthMetres <= 0 || heightMetres <= 0 || altitude <= 0 || altitude >= 90) return out;
  var mx = widthMetres / (size - 1), my = heightMetres / (size - 1);
  var angle = azimuth * Math.PI / 180, step = Math.min(mx, my);
  var dx = Math.sin(angle) * step / mx, dy = Math.cos(angle) * step / my;
  var slope = Math.tan(altitude * Math.PI / 180);
  var steps = Math.ceil(Math.hypot(widthMetres, heightMetres) / step);
  for (var j = 0; j < size; j++) for (var i = 0; i < size; i++) {
    var base = grid[j * size + i];
    if (typeof base !== 'number' || !Number.isFinite(base)) continue;
    for (var k = 1; k <= steps; k++) {
      var x = i + dx * k, y = j + dy * k;
      if (x < 0 || y < 0 || x > size - 1 || y > size - 1) break;
      var height = grid[Math.round(y) * size + Math.round(x)];
      if (typeof height === 'number' && Number.isFinite(height) && height > base + k * step * slope + 1) { out[j * size + i] = 1; break; }
    }
  }
  return out;
}`;
