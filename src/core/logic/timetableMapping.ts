/**
 * Reading a timetable by saying what each column is.
 *
 * The same machinery as the entry-list mapper, pointed at a different field
 * set — `columnMapping.ts` is generic over the field name for exactly this, so
 * grouping, exclusion by row shape and the multi-row stride are shared rather
 * than copied.
 *
 * ── This does not replace `timetableText.ts` ──────────────────────────────
 * That parser is tested against three real Spa documents and reads all of them
 * correctly, because two `HH:MM` times on a line are a strong anchor that
 * entry lists have no equivalent of. It stays the first thing tried.
 *
 * This is the fallback for the fourth document — the one whose layout the
 * parser has never seen, which today produces nothing and a shrug. Both feed
 * the same confirmation step, exactly as that file's own header anticipates
 * for the model path.
 */
import {
  cellAt,
  groupRows,
  isUsable as usable,
  type ColumnMapping,
} from './columnMapping';
import {
  classify,
  cleanTitle,
  isDayHeading,
  type TextSession,
} from './timetableText';

export const TimetableField = {
  /** The day heading this session runs on. */
  Day: 'day',
  Start: 'start',
  End: 'end',
  /** What the session is — the part a photographer reads. */
  Title: 'title',
  /** Where it happens. Folded into the title, since nothing schedules on it. */
  Location: 'location',
  Ignore: 'ignore',
} as const;
export type TimetableField =
  (typeof TimetableField)[keyof typeof TimetableField];

export type TimetableMapping = ColumnMapping<TimetableField>;

export const emptyTimetableMapping: TimetableMapping = {
  rowsPerEntry: 1,
  assignments: [],
  excluded: [],
};

/** `9:05`, `09.05`, `09:05:00` — the separators these documents actually use. */
const TIME = /(\d{1,2})[:.](\d{2})/;

const fmt = (h: number, m: number): string =>
  `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/**
 * The clock time in a cell, or null.
 *
 * The user says which column holds the start; this reads the time out of it,
 * for the same reason the entry mapper reads a number out of the number
 * column. A cell that cannot supply one is not a session — which is what keeps
 * a column header ("Start") or a stray note from becoming a 00:00 session.
 *
 * Out-of-range values are rejected rather than clamped. `25:00` is a typo or a
 * mis-mapped column, and inventing 01:00 from it would put a session on the
 * plan at a time nothing runs.
 */
export function readTime(cellText: string): string | null {
  const m = TIME.exec(cellText.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return fmt(h, min);
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

const ALL_TIMES = /\d{1,2}[:.]\d{2}/g;

/**
 * The second clock time in a cell, or null.
 *
 * ELMS prints start and end as one column — "08:30 13:00" — so the column a
 * person marks as the start also holds the end. Reading it from there is not
 * a guess: it is the only other time in the cell they pointed at.
 */
function secondTime(cellText: string): string | null {
  const times = (cellText.match(ALL_TIMES) ?? [])
    .map(readTime)
    .filter((t): t is string => t !== null);
  return times[1] ?? null;
}

/** "Track 180'" → "Track": a duration mark is not part of a name. */
const stripDuration = (value: string): string =>
  value.replace(/\b\d{1,3}'/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Apply a mapping to a grid of timetable rows.
 *
 * A group with no start time is skipped — that is the field without which
 * there is no session, the way the car number is for an entry.
 *
 * The end time is optional. A document that prints only start times is common
 * enough (the WEC medical-inspection row is one), and the honest result is a
 * session with no duration rather than one whose end was invented.
 */
export function applyTimetableMapping(
  grid: readonly string[][],
  mapping: TimetableMapping,
): TextSession[] {
  if (mapping.assignments.length === 0) return [];

  /*
   * Left to right, whatever order the cells were tapped in.
   *
   * Name parts join in this order, and "ADMINISTRATIVE CHECKS — FIA WEC"
   * because the session column happened to be tapped before the series
   * column would be a name no document printed.
   */
  const assignments = [...mapping.assignments].sort(
    (a, b) => a.row - b.row || a.column - b.column,
  );
  // Whether the person pointed at an end, or at any name at all. Without
  // them the start cell is asked for both — see below.
  const hasEnd = assignments.some((a) => a.field === TimetableField.End);
  const hasName = assignments.some(
    (a) => a.field === TimetableField.Title || a.field === TimetableField.Location,
  );

  const out: TextSession[] = [];
  /**
   * The last day heading passed, carried onto the sessions under it.
   *
   * Every sample timetable prints the day as a heading *row* — "WEDNESDAY,
   * MAY 6" — not as a column, so a Day assignment alone would leave a whole
   * weekend on no day at all. The parser does exactly this with the same
   * `isDayHeading` rule, and a mapped timetable must not know less than a
   * parsed one.
   */
  let heading: string | null = null;

  for (const group of groupRows(grid, mapping)) {
    let day: string | null = null;
    let start: string | null = null;
    let startCell = '';
    let end: string | null = null;
    const titleParts: string[] = [];

    for (const a of assignments) {
      const value = cellAt(group, a.row, a.column);
      if (value === '') continue;
      switch (a.field) {
        case TimetableField.Day:
          if (day === null) day = value;
          break;
        case TimetableField.Start:
          if (start === null) {
            start = readTime(value);
            if (start !== null) startCell = value;
          }
          break;
        case TimetableField.End:
          if (end === null) end = readTime(value);
          break;
        case TimetableField.Title:
        case TimetableField.Location:
          // Location joins the title: nothing schedules on it, and "Track" or
          // "Pit building" is often the only thing distinguishing two rows.
          titleParts.push(stripDuration(value));
          break;
        case TimetableField.Ignore:
          break;
      }
    }

    if (start === null) {
      const text = group
        .map((cells) => cells.join(' '))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (isDayHeading(text)) heading = text;
      continue;
    }

    // Both times in the one cell — ELMS prints "08:30 13:00" as one column.
    if (end === null && !hasEnd) end = secondTime(startCell);

    /*
     * No name column at all: the rest of the start cell is the name.
     *
     * That is the shape of pasted text and of a PDF with no detectable
     * columns — one cell per line, "11:00 12:30 FIA WEC FREE PRACTICE 1".
     * Pointing at that cell as the start is pointing at all of it.
     */
    if (!hasName) titleParts.push(cleanTitle(startCell));

    const title = titleParts
      .filter((part) => part !== '')
      .join(' — ')
      .replace(/\s+/g, ' ')
      .trim();
    // A session with no name is one nobody can act on, so it is not written.
    if (title === '') continue;

    const startM = toMinutes(start);
    // Wrapped end means it runs past midnight — normal at endurance events.
    const duration =
      end === null
        ? 0
        : toMinutes(end) > startM
          ? toMinutes(end) - startM
          : toMinutes(end) + 1440 - startM;

    const kind = classify(title);

    out.push({
      day: day ?? heading,
      title,
      start,
      end: end ?? start,
      durationMinutes: duration,
      kind,
      // Reusing the entry parser's own classifier rather than a second
      // opinion: scrutineering is paperwork whether it was parsed or mapped.
      onTrack: looksOnTrack(title, kind),
      source: group.map((g) => g.join(' ').trim()).join(' / ').trim(),
    });
  }

  return out;
}

/**
 * Paperwork versus track activity.
 *
 * A copy of the rule in timetableText.ts, which does not export it. Kept in
 * step deliberately: a mapped scrutineering row and a parsed one must not
 * disagree about whether to show it, or the same document read two ways would
 * produce two different plans.
 */
function looksOnTrack(text: string, kind: string): boolean {
  const t = text.toLowerCase();
  if (/scrutineer|administrative|briefing|press conference|meeting|checks/.test(t)) {
    return false;
  }
  if (kind === 'other') return /\btrack\b|\bpit\s*lane\b/.test(t);
  return true;
}

/** True once the mapping can produce a session. */
export function isTimetableUsable(mapping: TimetableMapping): boolean {
  return usable(mapping, TimetableField.Start);
}

/** One line for the mapping screen. */
export function describeTimetableMapping(
  grid: readonly string[][],
  mapping: TimetableMapping,
): string {
  if (!isTimetableUsable(mapping)) return 'Choose which column is the start time.';
  const n = applyTimetableMapping(grid, mapping).length;
  return n === 0
    ? 'No sessions yet — check the title column too.'
    : `${n} session${n === 1 ? '' : 's'}.`;
}
