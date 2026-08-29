/**
 * Circuits the user traced themselves — TASKS.md F7.
 *
 * ── Why these are not venues ──────────────────────────────────────────────
 * A venue in this app is a compile-time thing: a pmtiles archive, an entry in
 * `VENUE_VIEW`, extracted scenery and paths. That is what makes the map work
 * with no signal, and it is not something a person can create on a phone at
 * the side of a road.
 *
 * A traced circuit is therefore an overlay on a venue that already exists,
 * not a new one. That is a real limit and worth being clear about — it covers
 * a street layout inside an extract we already ship, or a variant of a
 * permanent circuit, and it does not cover tracing Monaco from Germany.
 *
 * Stored as JSON in the key-value store rather than as its own table. These
 * are a handful of short lines per venue, they are read all at once, and
 * nothing queries inside them — a table would be structure for its own sake.
 */
import type { LatLon } from '../core/domain/common';
import { kv } from './kv';

const KEY = 'trackside.tracedCircuits.v1';

export interface TracedCircuitRecord {
  readonly id: string;
  /** Which venue's map it was drawn on. */
  readonly venue: string;
  readonly name: string;
  /** The snapped line, following roads. */
  readonly coordinates: readonly LatLon[];
  readonly metres: number;
  /** Metres of the lap that follow no road — see `traceCircuit`. */
  readonly offRoadMetres: number;
  readonly closed: boolean;
  /** UTC ISO. */
  readonly createdAt: string;
}

/**
 * Everything traced, for every venue.
 *
 * Returns an empty list for anything unreadable rather than throwing. This is
 * a convenience layer over the map; a corrupt value should cost the user
 * their traces, not their ability to open the app.
 */
export async function listTracedCircuits(): Promise<TracedCircuitRecord[]> {
  try {
    const raw = await kv.get(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord);
  } catch {
    return [];
  }
}

/**
 * Validated on the way out, not trusted.
 *
 * The stored blob is the one thing here an older or newer build could have
 * written, and a record missing its coordinates would reach a GeoJSON source
 * and abort the process — see `core/logic/geojsonSafety.ts` for why that is
 * not hypothetical.
 */
function isRecord(value: unknown): value is TracedCircuitRecord {
  if (value === null || typeof value !== 'object') return false;
  const r = value as Partial<TracedCircuitRecord>;
  return (
    typeof r.id === 'string' &&
    typeof r.venue === 'string' &&
    typeof r.name === 'string' &&
    Array.isArray(r.coordinates) &&
    r.coordinates.length >= 2 &&
    r.coordinates.every(
      (c) =>
        typeof c?.latitude === 'number' &&
        typeof c?.longitude === 'number' &&
        Number.isFinite(c.latitude) &&
        Number.isFinite(c.longitude),
    )
  );
}

export async function tracedCircuitsFor(
  venue: string,
): Promise<TracedCircuitRecord[]> {
  return (await listTracedCircuits()).filter((c) => c.venue === venue);
}

export async function saveTracedCircuit(
  record: TracedCircuitRecord,
): Promise<void> {
  const all = await listTracedCircuits();
  // Replace by id so saving an edited trace does not leave the old one behind.
  const next = [...all.filter((c) => c.id !== record.id), record];
  await kv.set(KEY, JSON.stringify(next));
}

export async function deleteTracedCircuit(id: string): Promise<void> {
  const all = await listTracedCircuits();
  await kv.set(KEY, JSON.stringify(all.filter((c) => c.id !== id)));
}
