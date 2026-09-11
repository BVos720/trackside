/**
 * The editable review between reading a timetable and writing it.
 *
 * The same idea as `entryReview.ts`, for the same reason: a checkbox lets you
 * reject a wrong session but not repair one. A parsed timetable is a reading
 * of somebody's PDF, and a session with the right name and the wrong end time
 * used to be a choice between keeping a mistake and losing the row.
 *
 * Here every field can be corrected before anything is saved, rows can be
 * deleted and added, and the lines the reader could not make sense of arrive
 * as rows to fill in rather than a list to squint at. It makes the reader's
 * job "close", not "right" — the last word is the person holding the phone.
 *
 * ── Strings while editing ─────────────────────────────────────────────────
 * Times stay as typed until they leave. Normalising on every keystroke would
 * reject "9:" halfway to "9:05", so `toReadySession` does it once, on the way
 * out, and `isSessionReady` says whether it will succeed.
 */
import { readTime } from './timetableMapping';
import {
  classify,
  cleanTitle,
  type TextSession,
  type TimetableKind,
} from './timetableText';

export interface SessionRow {
  /** Stable across edits and deletions — never the array index. */
  readonly key: string;
  /** The day heading as the document wrote it, '' when there is none. */
  readonly day: string;
  readonly title: string;
  readonly start: string;
  /** '' for a session the document gives no end for. */
  readonly end: string;
  /** The line this came from, or '' when typed by hand. */
  readonly source: string;
  /** Whether Add would write it. */
  readonly include: boolean;
  /**
   * Whether the reading took this for track activity.
   *
   * Drives the "track only" view. Paperwork is still in the list and still
   * editable — hidden by default, never dropped.
   */
  readonly onTrack: boolean;
}

/** A row from a session the parser or the mapper read. */
export function rowFromSession(session: TextSession, key: string): SessionRow {
  return {
    key,
    day: session.day ?? '',
    title: session.title,
    start: session.start,
    // A start-only session comes back with its end equal to its start. Shown
    // as no end, because that is what the document said.
    end: session.end === session.start ? '' : session.end,
    source: session.source,
    include: session.onTrack,
    onTrack: session.onTrack,
  };
}

const ALL_TIMES = /\d{1,2}[:.]\d{2}/g;

/**
 * A row from a line that held times but could not be read.
 *
 * Pre-filled with whatever the line does give — its valid times and the rest
 * of its text — and left unticked until somebody has looked at it. Shown in
 * the track view regardless: an unread line is exactly the row that needs
 * eyes on it.
 */
export function rowFromUnreadLine(line: string, key: string, day = ''): SessionRow {
  const times = (line.match(ALL_TIMES) ?? [])
    .map(readTime)
    .filter((t): t is string => t !== null);
  return {
    key,
    day,
    title: cleanTitle(line),
    start: times[0] ?? '',
    end: times[1] ?? '',
    source: line,
    include: false,
    onTrack: true,
  };
}

/** An empty row, for a session the document never listed. */
export function blankSessionRow(key: string, day = ''): SessionRow {
  return {
    key,
    day,
    title: '',
    start: '',
    end: '',
    source: '',
    include: true,
    onTrack: true,
  };
}

/** Sessions first, in document order, then the lines that could not be read. */
export function sessionRowsFrom(
  sessions: readonly TextSession[],
  skipped: readonly string[],
  key: (i: number) => string,
): SessionRow[] {
  let n = 0;
  return [
    ...sessions.map((s) => rowFromSession(s, key(n++))),
    ...skipped.map((line) => rowFromUnreadLine(line, key(n++))),
  ];
}

/**
 * What stops this row being written, or null when nothing does.
 *
 * Worded for the row itself, so the screen can say why a ticked row is not
 * counted rather than silently leaving it out — which would look like the
 * feature losing a session.
 */
export function sessionProblem(row: SessionRow): string | null {
  if (readTime(row.start) === null) return 'Needs a start time, like 09:30.';
  if (row.end.trim() !== '' && readTime(row.end) === null) {
    return 'The end time is not a time — use 17:00, or leave it empty.';
  }
  if (row.title.trim() === '') return 'Needs a name.';
  return null;
}

/** Ticked, and writable as it stands. */
export function isSessionReady(row: SessionRow): boolean {
  return row.include && sessionProblem(row) === null;
}

export function readySessionRows(rows: readonly SessionRow[]): SessionRow[] {
  return rows.filter(isSessionReady);
}

/** The shape the screen hands on to be saved. */
export interface ReadySession {
  readonly day: string | null;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly kind: TimetableKind;
  readonly onTrack: boolean;
}

/**
 * Back to a session, times normalised.
 *
 * The kind is classified again from the title as it now reads: someone who
 * corrects "FREE PRACTCE" to "FREE PRACTICE" has also corrected what it is.
 * No end means the end is the start — the same rule the mapper uses, rather
 * than a duration nobody wrote down.
 */
export function toReadySession(row: SessionRow): ReadySession {
  const start = readTime(row.start) ?? row.start.trim();
  const title = row.title.trim().replace(/\s+/g, ' ');
  const day = row.day.trim();
  return {
    day: day === '' ? null : day,
    title,
    start,
    end: readTime(row.end) ?? start,
    kind: classify(title),
    onTrack: row.onTrack,
  };
}

/** One line for the status text. */
export function describeSessionReview(rows: readonly SessionRow[]): string {
  const ready = readySessionRows(rows).length;
  const blocked = rows.filter((r) => r.include && !isSessionReady(r)).length;
  const head = `${ready} session${ready === 1 ? '' : 's'}`;
  if (blocked === 0) return `${head}.`;
  return `${head}, ${blocked} ticked ${blocked === 1 ? 'row needs' : 'rows need'} fixing first.`;
}
