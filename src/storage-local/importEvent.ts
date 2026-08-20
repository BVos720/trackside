/**
 * Writing an import plan into the store.
 *
 * The decisions all live in core/logic/importBundle.ts, which is pure and
 * tested. This file only reads the current state, hands it over, and writes
 * back whatever comes out — so the rules about what an import may overwrite are
 * verifiable without a database, and this layer stays dumb enough to trust.
 *
 * ── Not a transaction, and honest about it ────────────────────────────────
 * The KV store has no multi-key transaction, so a failure partway through
 * leaves some records written. Order is chosen to make that partial state the
 * least harmful one: days, then sessions, then spots, then entries, then the
 * event last. Everything before the event is unreachable without it —
 * orphaned rows that the UI never lists — whereas writing the event first
 * would produce a visible event whose spots, timetable and field had not
 * arrived yet.
 */
import type { ImportPlan, LocalState } from '../core/logic/importBundle';
import {
  entries,
  equipment,
  eventDays,
  events,
  repositories,
  sessions,
} from './repositories/documentRepositories';

const { spots } = repositories;

/** Everything an import needs to know about what is already here. */
export async function readLocalState(): Promise<LocalState> {
  const [existingEvents, existingSpots] = await Promise.all([
    events.listAllIncludingDeleted(),
    spots.listAllIncludingDeleted(),
  ]);
  return { events: existingEvents, spots: existingSpots };
}

/**
 * Write the plan.
 *
 * Sequential rather than `Promise.all`: the document store serialises writes
 * per key anyway, and a burst of concurrent writes to the same key is exactly
 * the read-modify-write race the per-key queue exists to absorb. There is no
 * speed to gain and a failure mode to avoid.
 */
export async function applyImport(plan: ImportPlan): Promise<void> {
  for (const day of plan.days) await eventDays.save(day);
  for (const session of plan.sessions) await sessions.save(session);
  for (const spot of plan.spots) await spots.save(spot);
  await entries.saveMany(plan.entries);
  await equipment.saveMany(plan.equipment);
  await events.save(plan.event);
}
