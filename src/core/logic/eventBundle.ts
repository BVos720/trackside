/**
 * An event and everything belonging to it, as one file.
 *
 * The KV store already persists this data; a bundle exists for the things a
 * database inside an app sandbox cannot do. It is something you can copy off
 * the phone, keep after a reinstall, hand to someone else, or read in a text
 * editor when the app is the thing that is broken.
 *
 * ── Self-contained, on purpose ─────────────────────────────────────────────
 * The bundle carries the event's *own* spots, not references to a spot table.
 * That is only possible because an event owns copies (see cloneSpots.ts), and
 * it is what makes the file mean something on its own: opened on another
 * device, or in two years, it still describes a complete weekend rather than a
 * list of ids pointing at rows that are not there.
 *
 * ── Versioned from the first write ────────────────────────────────────────
 * `format` is checked on read and refused if unknown. A file written today has
 * to still open after the schema moves, and the only way to migrate something
 * is to know what it is. Guessing from shape is how importers end up silently
 * mangling old data.
 */
import type { Entry } from '../domain/entry';
import type { Event } from '../domain/event';
import type { Session } from '../domain/planning';
import type { Spot } from '../domain/spot';

export const BUNDLE_FORMAT = 'trackside.event.v1';

export interface EventBundle {
  readonly format: typeof BUNDLE_FORMAT;
  /** When the file was written, ISO 8601. Informational only. */
  readonly exportedAt: string;
  readonly event: Event;
  /** The event's own spots — copies, complete with position and notes. */
  readonly spots: readonly Spot[];
  /** The event's timetable. */
  readonly sessions: readonly Session[];
  /**
   * The entry list, ticks included.
   *
   * `photographed` is the part worth backing up. The list itself can be pasted
   * again from the series' website in a minute; which forty of the sixty cars
   * you have already got cannot be reconstructed from anything, and losing it
   * mid-weekend means starting the count again.
   */
  readonly entries: readonly Entry[];
  /**
   * Day headings the sessions hang off, as `{ id, date, label }`.
   *
   * Carried because a session's `eventDayId` is meaningless without them, and
   * the heading is often the only honest record of the day — a published
   * timetable says "SATURDAY" and not everything can be resolved to a date.
   */
  readonly days: readonly { id: string; date: string; label: string | null }[];
}

export function buildEventBundle(input: {
  event: Event;
  spots: readonly Spot[];
  sessions: readonly Session[];
  days: readonly { id: string; date: string; label: string | null }[];
  /** Optional: an event that never had a list pasted into it has none. */
  entries?: readonly Entry[];
  /** Optional: an event with no checklist yet — the very first one — has none. */
  at?: Date;
}): EventBundle {
  return {
    format: BUNDLE_FORMAT,
    exportedAt: (input.at ?? new Date()).toISOString(),
    event: input.event,
    spots: input.spots,
    sessions: input.sessions,
    entries: input.entries ?? [],
    days: input.days,
  };
}

/**
 * A stable, human-readable file name.
 *
 * The id is the part that guarantees uniqueness, but a directory of
 * `01a0167c….json` is unusable by a person — and being able to find the right
 * file in a file manager is most of why bundles exist. The name leads, the id
 * disambiguates.
 *
 * Restricted to characters every filesystem accepts: a circuit name can carry
 * accents, slashes and colons, and Android's storage is not forgiving.
 */
export function bundleFileName(event: Event): string {
  const slug = event.name
    .normalize('NFD')
    // Strip combining marks so "Nürburgring" becomes "Nurburgring" rather than
    // losing the letter entirely.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .toLowerCase();

  /*
   * The *tail* of the id, not the head.
   *
   * A UUID v7 begins with a millisecond timestamp, so two events created in the
   * same millisecond share their first eight characters — and would share a
   * filename, one silently overwriting the other. For a feature whose entire
   * job is not losing data that is the worst possible bug, and it is invisible
   * until the day two events go in and one comes out. The trailing characters
   * come from the random section.
   */
  const short = event.id.slice(-8);
  return `${slug === '' ? 'event' : slug}-${short}.json`;
}

export interface BundleReadResult {
  readonly bundle: EventBundle | null;
  /** Why it could not be read, for showing the user. Null on success. */
  readonly error: string | null;
}

/**
 * Parse a bundle, refusing anything it does not recognise.
 *
 * Returns a result rather than throwing: a bad file is an ordinary thing to
 * find in a folder people can put files in, and the caller needs to say which
 * file failed and why rather than crash an import of twelve.
 */
export function readEventBundle(text: string): BundleReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { bundle: null, error: 'Not valid JSON.' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { bundle: null, error: 'Not an object.' };
  }

  const doc = parsed as Partial<EventBundle>;

  if (doc.format !== BUNDLE_FORMAT) {
    return {
      bundle: null,
      error: `Unknown format ${String(doc.format ?? 'missing')} — expected ${BUNDLE_FORMAT}.`,
    };
  }
  if (typeof doc.event !== 'object' || doc.event === null || !doc.event.id) {
    return { bundle: null, error: 'No event in the file.' };
  }

  // Arrays are defaulted rather than rejected: an event with no spots yet is a
  // real thing to have saved, and so is one saved before sessions existed.
  return {
    bundle: {
      format: BUNDLE_FORMAT,
      exportedAt:
        typeof doc.exportedAt === 'string' ? doc.exportedAt : 'unknown',
      event: doc.event as Event,
      spots: Array.isArray(doc.spots) ? doc.spots : [],
      sessions: Array.isArray(doc.sessions) ? doc.sessions : [],
      // Defaulted, not rejected: every bundle written before entry lists
      // existed has no such key, and those files must still open.
      entries: Array.isArray(doc.entries) ? doc.entries : [],
      days: Array.isArray(doc.days) ? doc.days : [],
    },
    error: null,
  };
}

/** One-line summary for a file listing. */
export function describeBundle(bundle: EventBundle): string {
  const parts = [
    `${bundle.spots.length} spot${bundle.spots.length === 1 ? '' : 's'}`,
    `${bundle.sessions.length} session${bundle.sessions.length === 1 ? '' : 's'}`,
    `${bundle.event.stops.length} planned`,
  ];
  // Named only when there are some. Most events never paste a list, and a
  // permanent "0 entries" on every file listing is noise rather than honesty.
  if (bundle.entries.length > 0) {
    parts.push(
      `${bundle.entries.length} entr${bundle.entries.length === 1 ? 'y' : 'ies'}`,
    );
  }
  // Named only when there is a checklist — most first events have none yet.
  return parts.join(' · ');
}
