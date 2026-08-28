/**
 * Keep malformed geometry away from MapLibre.
 *
 * ── Why this is not defensive programming for its own sake ────────────────
 * MapLibre parses GeoJSON in C++ and *throws* when a coordinate is not a
 * number. On iOS nothing catches that throw: it unwinds through
 * `-[MLRNGeoJSONSource setShape:]`, hits `std::terminate`, and the process
 * takes `SIGABRT`. There is no red box, no ErrorBoundary, and no JS stack —
 * the app simply vanishes. One bad row anywhere in a feature collection is
 * enough to do it.
 *
 * `JSON.stringify` is what makes this easy to hit by accident: it turns both
 * `NaN` and `undefined` inside an array into `null`, so a coordinate that went
 * wrong three layers away arrives at the parser as a null where a number
 * belongs, with nothing in between to notice.
 *
 * So every collection handed to a source goes through here first. A feature
 * that cannot be trusted is dropped, not repaired: a coordinate we could not
 * verify must never be drawn as though we could, and inventing a position for
 * a spot at a circuit is worse than omitting it.
 */

/** Enough positions to be the shape it claims to be. */
const MIN_POSITIONS: Record<string, number> = {
  Point: 1,
  MultiPoint: 1,
  LineString: 2,
  MultiLineString: 2,
  Polygon: 4,
  MultiPolygon: 4,
};

function finitePosition(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2) return false;
  // Only the first two are used for placement; a third (elevation) is allowed
  // through but still has to be a number if it is there at all.
  return value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/**
 * Walk a coordinates value of unknown nesting depth.
 *
 * Depth varies by geometry type and this deliberately does not care which:
 * the question at every level is the same — is this a position, and is it
 * sound — so recursion answers it once instead of six times.
 */
function soundCoordinates(value: unknown, depth = 0): { ok: boolean; count: number } {
  if (!Array.isArray(value)) return { ok: false, count: 0 };

  // A position: an array whose first element is a number.
  if (typeof value[0] === 'number') {
    return { ok: finitePosition(value), count: 1 };
  }

  // Guard against pathological nesting rather than trusting the input's shape.
  if (depth > 4) return { ok: false, count: 0 };

  let count = 0;
  for (const child of value) {
    const r = soundCoordinates(child, depth + 1);
    if (!r.ok) return { ok: false, count: 0 };
    count += r.count;
  }
  return { ok: true, count };
}

/** Is this geometry safe to hand to the parser? */
export function isSoundGeometry(geometry: unknown): boolean {
  if (geometry === null || typeof geometry !== 'object') return false;
  const g = geometry as { type?: unknown; coordinates?: unknown; geometries?: unknown };

  if (g.type === 'GeometryCollection') {
    return Array.isArray(g.geometries) && g.geometries.every(isSoundGeometry);
  }

  if (typeof g.type !== 'string') return false;
  const min = MIN_POSITIONS[g.type];
  // An unrecognised type is not assumed safe. The parser knows a shorter list
  // than the spec does, and guessing on its behalf is how this crash happens.
  if (min === undefined) return false;

  const r = soundCoordinates(g.coordinates);
  return r.ok && r.count >= min;
}

/**
 * Drop every feature that would crash the parser.
 *
 * `onDrop` exists so a caller can say something. Silently losing a pin is its
 * own kind of bug — quieter than a crash, and harder to explain when someone
 * insists they saved a spot that is not on the map.
 */
export function safeFeatureCollection<T extends { features?: unknown }>(
  collection: T,
  onDrop?: (reason: string, feature: unknown) => void,
): T {
  if (collection === null || typeof collection !== 'object') {
    return { type: 'FeatureCollection', features: [] } as unknown as T;
  }

  const features = Array.isArray(collection.features) ? collection.features : [];
  const kept = features.filter((f) => {
    if (f === null || typeof f !== 'object') {
      onDrop?.('not a feature', f);
      return false;
    }
    const geometry = (f as { geometry?: unknown }).geometry;
    // A null geometry is legal GeoJSON and the parser still rejects it, which
    // is exactly the kind of "valid but fatal" case worth naming.
    if (geometry === null || geometry === undefined) {
      onDrop?.('feature has no geometry', f);
      return false;
    }
    if (!isSoundGeometry(geometry)) {
      onDrop?.('unusable coordinates', f);
      return false;
    }
    return true;
  });

  // Returned unchanged when nothing was wrong, so React sees the same object
  // and the source is not needlessly re-set on every render.
  if (kept.length === features.length) return collection;
  return { ...collection, features: kept };
}
