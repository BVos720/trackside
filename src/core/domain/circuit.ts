/**
 * Preset circuit reference data — spec §4.1.
 *
 * This is the only preset data in the application. It ships as JSON in the
 * repository (spec §7) and becomes the API's seed data unchanged when the
 * backend arrives.
 *
 * ── Sourcing constraint, spec §0.2 ──────────────────────────────────────────
 * `MarshalPost.officialNumber` must match the circuit's own numbering, taken
 * from official documents. It is the shared vocabulary the entire spot naming
 * scheme is built on: if the numbers are wrong, every spot description built
 * on top of them is wrong, and the error is invisible until someone is stood
 * at the wrong post during a session.
 *
 * Do not infer post numbers from position along the track. Do not interpolate
 * between two known posts. Do not generate plausible-looking values — once
 * written they are indistinguishable from verified data. Where a number is not
 * known, the record does not get created.
 */
import type { BoundingBox, EntityBase, LatLon } from './common';
import type { CircuitFeatureId, CircuitId, MarshalPostId } from './ids';

/**
 * A circuit, and the layout variants that can be run at it.
 *
 * The Nürburgring is the reason `layoutVariants` exists: Nordschleife,
 * GP-Strecke and the combined 25.378km configuration are the same venue but
 * genuinely different tracks, with different marshal posts in use and
 * different accessible areas.
 */
export interface Circuit extends EntityBase {
  readonly id: CircuitId;
  readonly name: string;
  /** ISO 3166-1 alpha-2, e.g. 'DE'. */
  readonly country: string;
  /**
   * IANA timezone, e.g. 'Europe/Berlin'.
   *
   * Stored per circuit rather than read from the device, because plans are
   * built at home and used abroad. A schedule authored in Breda for a Spa
   * weekend must render in Belgian local time regardless of where the phone
   * currently is.
   */
  readonly timezone: string;
  readonly boundingBox: BoundingBox;
  readonly centre: LatLon;
  readonly layoutVariants: readonly LayoutVariant[];
}

export interface LayoutVariant {
  readonly key: string;
  readonly name: string;
  /** Track length in metres, where known. */
  readonly lengthMetres: number | null;
}

/**
 * A numbered trackside safety position.
 *
 * The anchor for describing where you are at a circuit. "Just past post 88" is
 * how marshals, drivers and photographers all actually communicate location,
 * so spots hang off posts rather than off raw coordinates.
 */
export interface MarshalPost extends EntityBase {
  readonly id: MarshalPostId;
  readonly circuitId: CircuitId;
  /**
   * The circuit's own designation for this post — spec §0.2.
   *
   * A string, not a number: real circuit numbering includes forms like '12a'
   * and '88b'. Never generated, never inferred from ordering along the track.
   */
  readonly officialNumber: string;
  readonly position: LatLon;
}

export const CircuitFeatureKind = {
  Gate: 'gate',
  CarPark: 'carPark',
  Tunnel: 'tunnel',
  Bridge: 'bridge',
  SpectatorArea: 'spectatorArea',
  Facility: 'facility',
} as const;
export type CircuitFeatureKind =
  (typeof CircuitFeatureKind)[keyof typeof CircuitFeatureKind];

/**
 * A fixed feature of the venue — a gate, a tunnel, a car park.
 *
 * Distinct from a `Spot`: these are facts about the circuit, not opinions
 * about where to photograph from. Tunnels and gates in particular are what
 * make walking-route planning tractable at the Nordschleife, where crossing
 * the track is only possible at specific points.
 */
export interface CircuitFeature extends EntityBase {
  readonly id: CircuitFeatureId;
  readonly circuitId: CircuitId;
  readonly kind: CircuitFeatureKind;
  /** GeoJSON geometry. Point, LineString or Polygon depending on `kind`. */
  readonly geometry: GeoJsonGeometry;
  readonly notes: string | null;
}

/**
 * Minimal GeoJSON geometry typing.
 *
 * Kept structural rather than pulling in a spatial library — spec §2.3
 * constraint 4 keeps spatial types out of the domain layer entirely.
 */
export type GeoJsonGeometry =
  | { readonly type: 'Point'; readonly coordinates: readonly [number, number] }
  | {
      readonly type: 'LineString';
      readonly coordinates: readonly (readonly [number, number])[];
    }
  | {
      readonly type: 'Polygon';
      readonly coordinates: readonly (readonly (readonly [number, number])[])[];
    };
