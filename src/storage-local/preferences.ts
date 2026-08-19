/**
 * Small pieces of UI state that should survive a restart.
 *
 * Not domain data — nothing here is a record anyone syncs or backs up. It is
 * the answer to "where was I", which the app currently forgets every launch:
 * the event you are working on resets to none, and at a race weekend that means
 * re-picking it every time Android decides to kill the process.
 *
 * Deliberately separate from the repositories. These values have no ids, no
 * tombstones and no sync story, and putting them through the same machinery
 * would imply they do.
 */
import { kv } from './kv';

const ACTIVE_EVENT = 'trackside.ui.activeEventId.v1';
const ACTIVE_VENUE = 'trackside.ui.venue.v1';

export async function getActiveEventId(): Promise<string | null> {
  return kv.get(ACTIVE_EVENT);
}

export async function setActiveEventId(id: string | null): Promise<void> {
  if (id === null) await kv.remove(ACTIVE_EVENT);
  else await kv.set(ACTIVE_EVENT, id);
}

export async function getVenue(): Promise<string | null> {
  return kv.get(ACTIVE_VENUE);
}

export async function setVenue(venue: string): Promise<void> {
  await kv.set(ACTIVE_VENUE, venue);
}
