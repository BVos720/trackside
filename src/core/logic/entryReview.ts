/**
 * The editable review between parsing an entry list and writing it.
 *
 * `parseEntryList` produces a best reading of pasted text. This is what the
 * person then does to it: correct a field, untick a row that is not a car, add
 * one the list missed. Only after that does anything reach the store.
 *
 * ── Why the last word is the human's ──────────────────────────────────────
 * A checkbox is half a confirmation step. It lets you reject a wrong row but
 * not repair one, so a car with the right number and a mangled team is a
 * choice between keeping something wrong and losing it. Editing removes that
 * choice, and it changes what the parser has to be: not right, only close.
 *
 * Concretely, the two documents the parser still reads wrong stop being
 * defects. HTC2's row index in place of the car number is one field to
 * retype. The seven Spa Six Hours cars whose number sits alone on a line are
 * seven rows to add. Neither needs a parser change to be usable today.
 *
 * ── Strings, not the domain's nulls ───────────────────────────────────────
 * A text input has no null. Converting at the edit boundary rather than on
 * every keystroke keeps "cleared the field" and "never had one" the same
 * thing, which is what the person typing means by an empty box. `toEntry`
 * puts the nulls back on the way out.
 */
import type { TextEntry } from './entryList';

export interface ReviewRow {
  /**
   * Stable across edits, deletions and reorderings.
   *
   * Never the array index: editing row 3 after deleting row 1 would otherwise
   * write into a different row's text, silently and only sometimes.
   */
  readonly key: string;
  readonly number: string;
  readonly className: string;
  readonly team: string;
  /** Slash-joined while editing — the way entry lists print them. */
  readonly drivers: string;
  /** The line this came from, or '' when typed by hand. */
  readonly source: string;
  /** Whether Add would write it. */
  readonly include: boolean;
}

/** A row from something the parser read. Included by default. */
export function rowFromEntry(entry: TextEntry, key: string): ReviewRow {
  return {
    key,
    number: entry.number,
    className: entry.className ?? '',
    team: entry.team ?? '',
    drivers: entry.drivers.join(' / '),
    source: entry.source,
    include: true,
  };
}

/**
 * A row from a line the parser could not read.
 *
 * Excluded until it has a number: an empty row added to the field is worse
 * than the unreadable line it came from. It belongs in the same list as
 * everything else rather than in a separate "could not read" section — a
 * count at the foot of the screen is something you have to go hunting for,
 * and hunting is what gets skipped.
 */
export function rowFromSkipped(line: string, key: string): ReviewRow {
  return {
    key,
    number: '',
    className: '',
    team: '',
    drivers: '',
    source: line,
    include: false,
  };
}

/** An empty row, for a car the document never listed. */
export function blankRow(key: string): ReviewRow {
  return {
    key,
    number: '',
    className: '',
    team: '',
    drivers: '',
    source: '',
    include: true,
  };
}

/**
 * Everything a parse produced, entries and unreadable lines together.
 *
 * One list, in document order for the entries and the unreadable lines after
 * them, so the review reads top to bottom without a second section to find.
 */
export function rowsFromParse(
  parse: { entries: readonly TextEntry[]; skipped: readonly string[] },
  key: (i: number) => string,
): ReviewRow[] {
  let n = 0;
  return [
    ...parse.entries.map((e) => rowFromEntry(e, key(n++))),
    ...parse.skipped.map((l) => rowFromSkipped(l, key(n++))),
  ];
}

const trimmedOrNull = (s: string): string | null => {
  const t = s.trim();
  return t === '' ? null : t;
};

/** Split the editable drivers field back into names. */
export function splitDriverField(value: string): string[] {
  return value
    .split('/')
    .map((d) => d.trim())
    .filter((d) => d !== '');
}

/** A row is writable once it has a number — the part you actually tick. */
export function isReady(row: ReviewRow): boolean {
  return row.include && row.number.trim() !== '';
}

/** The rows Add would write, in order. */
export function readyRows(rows: readonly ReviewRow[]): ReviewRow[] {
  return rows.filter(isReady);
}

/** Back to the shape the repository takes. */
export function toEntry(row: ReviewRow): TextEntry {
  return {
    number: row.number.trim(),
    className: trimmedOrNull(row.className),
    team: trimmedOrNull(row.team),
    drivers: splitDriverField(row.drivers),
    source: row.source,
  };
}

/** One line for the Add button and the status text. */
export function describeReview(rows: readonly ReviewRow[]): string {
  const ready = readyRows(rows).length;
  const blocked = rows.filter((r) => r.include && r.number.trim() === '').length;

  const head = `${ready} entr${ready === 1 ? 'y' : 'ies'}`;
  if (blocked === 0) return `${head}.`;
  // Named, because a ticked row that Add silently skips is the one thing here
  // that would look like the feature losing data.
  return `${head}, ${blocked} still ${blocked === 1 ? 'needs' : 'need'} a number.`;
}
