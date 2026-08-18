/**
 * Session state for the timetable screen — spec §5.3.
 *
 * Imported rows are written as `Session` records against an `EventDay`, which
 * is created on demand per (circuit, date).
 */
import { useCallback, useEffect, useState } from 'react';

import { nowUtc, toUtc, type Utc } from '../../core/domain/common';
import { newId, type CircuitId, type SessionId } from '../../core/domain/ids';
import { SessionKind, type Session } from '../../core/domain/planning';
import { matchEventDay } from '../../core/logic/eventDate';
import { eventDays, sessions as sessionRepo } from '../../storage-local/repositories/documentRepositories';

export interface SessionDraft {
  day: string | null;
  title: string;
  start: string;
  end: string;
  kind: string;
}

/** Map the parser's vocabulary onto the domain enum. */
function toKind(raw: string): SessionKind {
  switch (raw) {
    case 'practice':
      return SessionKind.Practice;
    case 'qualifying':
      return SessionKind.Qualifying;
    case 'race':
      return SessionKind.Race;
    case 'pitlaneWalk':
      return SessionKind.PitlaneWalk;
    default:
      return SessionKind.Support;
  }
}

/**
 * Build a UTC instant from a day label and HH:MM.
 *
 * ── The date now comes from the event, when it can ─────────────────────────
 * The domain stores instants in UTC (§2.3), but a timetable gives a wall-clock
 * time and a day *name* — "SATURDAY, MAY 9" — with no year. This used to fall
 * back to today's date with only the time meaningful, because nothing in the
 * app knew when the weekend was.
 *
 * An event now carries real dates, so `isoDate` resolves the heading to one of
 * them (see core/logic/eventDate.ts). When it cannot — an ambiguous heading, or
 * no event dates set — the old behaviour stands, and the screen keeps showing
 * the label verbatim rather than a date it would be guessing at.
 *
 * The circuit's timezone is still unknown: `Circuit` preset data is reserved
 * for human sourcing under §0.2, so the instant is built in the device's zone.
 * That is right at the circuit and wrong from home, which is why nothing
 * displays these as absolute times.
 */
function instantFrom(hhmm: string, isoDate: string | null): Utc {
  const [h, m] = hhmm.split(':').map(Number);

  const d = isoDate ? new Date(`${isoDate}T00:00:00`) : new Date();
  if (Number.isNaN(d.getTime())) d.setTime(Date.now());

  d.setHours(h ?? 0, m ?? 0, 0, 0);
  // toUtc rather than a bare ISO string: the brand is what stops a local-time
  // value being stored as if it were UTC.
  return toUtc(d);
}

/**
 * @param circuitId the circuit the sessions hang off, for the EventDay key.
 * @param eventDates the active event's days, `YYYY-MM-DD`. Empty when there is
 * no active event or it has no dates, in which case headings stay unresolved.
 */
export function useSessions(circuitId: CircuitId, eventDates: readonly string[] = []) {
  const [rows, setRows] = useState<Session[]>([]);

  const reload = useCallback(async () => {
    setRows(await sessionRepo.listByCircuit(circuitId));
  }, [circuitId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addMany = useCallback(
    async (drafts: SessionDraft[]) => {
      for (const d of drafts) {
        // One EventDay per label, so a re-import after a timetable revision
        // does not duplicate the weekend.
        const label = d.day ?? 'Unscheduled';
        // Resolve the heading to one of the event's own days when it is
        // unambiguous; null keeps the label as written rather than guessing.
        const iso = matchEventDay(label, eventDates);
        const day = await eventDays.ensure(circuitId, iso ?? label, label);
        const at = nowUtc();
        const session: Session = {
          id: newId<SessionId>(),
          eventDayId: day.id,
          seriesName: d.title,
          className: null,
          kind: toKind(d.kind),
          startTime: instantFrom(d.start, iso),
          endTime: instantFrom(d.end, iso),
          // Not derived from sunset: an organiser's "night session" is a
          // scheduling fact, not an astronomical one (see planning.ts).
          isNight: false,
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
          syncState: 'local',
        };
        await sessionRepo.save(session);
      }
      await reload();
    },
    [circuitId, eventDates, reload],
  );

  const remove = useCallback(
    async (id: SessionId) => {
      await sessionRepo.softDelete(id);
      await reload();
    },
    [reload],
  );

  return { sessions: rows, addMany, remove, reload };
}
