/**
 * Turning a grid of cells into entries, once a human has said what is what.
 *
 * `pdfColumns.ts` finds the bands. This applies the meaning the person assigns
 * to them. Between the two, nothing is guessed: the machine says where the
 * columns are, the human says which is the car number, and this does the
 * mechanical part in the middle.
 *
 * ── Why assignments and not a field-per-column array ──────────────────────
 * Three of the five sample documents need something an array cannot express:
 *
 *   • **WEC** puts each driver in a column of its own — three columns, one
 *     field. Several assignments to `drivers` concatenate.
 *   • **Spa Six Hours** spans three rows per car: the number alone, then the
 *     car, then the driver. An assignment carries a *row offset* as well as a
 *     column, so a record can be taller than one line.
 *   • **NLS** repeats its page header on all ten pages. Excluding it by text
 *     would miss it on page 2 where the date differs; excluding it by *shape*
 *     — which columns are filled — catches every copy.
 *
 * ── The empty-columns case is not an error ────────────────────────────────
 * A document with no consistent bands (Spa Six Hours) still has rows. `gridOf`
 * gives it a single column holding each whole line, so the multi-line
 * assignment below is the tool that reads it. That is the difference between
 * "we cannot help" and "we cannot help *automatically*".
 */
import type { TextEntry } from './entryList';
import { splitRowByColumns, type Column, type PositionedRow } from './pdfColumns';

export const EntryField = {
  Number: 'number',
  ClassName: 'className',
  Team: 'team',
  Drivers: 'drivers',
  /** Present in the document, wanted by nobody. */
  Ignore: 'ignore',
} as const;
export type EntryField = (typeof EntryField)[keyof typeof EntryField];

/**
 * Generic over the field set, so the same machinery reads a timetable.
 *
 * Entry lists and timetables differ in *what* the columns mean and in nothing
 * else: both are a grid, both need rows grouped into records, both need
 * furniture excluded by shape. Parameterising the field name is what lets the
 * timetable side (timetableMapping.ts) reuse all of it rather than growing a
 * second copy that drifts.
 *
 * Defaults to `EntryField`, so every existing caller is unchanged.
 */
export interface FieldAssignment<F extends string = EntryField> {
  /** Offset within the record, 0 for a single-line list. */
  readonly row: number;
  readonly column: number;
  readonly field: F;
}

export interface ColumnMapping<F extends string = EntryField> {
  /** How many grid rows make one entry. 1 for an ordinary table. */
  readonly rowsPerEntry: number;
  readonly assignments: readonly FieldAssignment<F>[];
  /**
   * Row shapes that are not records — headers, footers, section banners.
   *
   * Held as signatures rather than literal text so the same header matches on
   * every page. See `rowSignature`.
   */
  readonly excluded: readonly string[];
}

export const emptyMapping: ColumnMapping = {
  rowsPerEntry: 1,
  assignments: [],
  excluded: [],
};

/**
 * The grid a document offers, columns or not.
 *
 * With columns, each row is sliced into them. Without, each row becomes a
 * single cell holding the whole line — which is what lets a document that is
 * not a table still be mapped by hand, one row offset at a time.
 */
export function gridOf(
  rows: readonly PositionedRow[],
  columns: readonly Column[],
): string[][] {
  if (columns.length === 0) {
    return rows
      .map((r) => [
        r.tokens
          .map((t) => t.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      ])
      .filter((cells) => cells[0] !== '');
  }
  return rows
    .map((r) => splitRowByColumns(r, columns))
    .filter((cells) => cells.some((c) => c !== ''));
}

/** A bare car number: `7`, `#7`, `007`, `24A`. */
const BARE_NUMBER = /^#?\s*\d{1,3}[A-Za-z]?$/;

/**
 * The shape of a row, as a string.
 *
 * Each cell becomes `0` (empty), `n` (nothing but a car number) or `t` (any
 * other text), so `"t,0,0,0,0"` is "text in the first column and nothing
 * else" — the shape of every repeated page header in the NLS list, whatever
 * date that copy carries. Matching on shape rather than on text is what makes
 * one tap exclude all ten copies.
 *
 * ── Why `n` is a class of its own ─────────────────────────────────────────
 * Without it, a lone `# 4` and a lone `SPA SIX HOURS 2025` are both "first
 * cell filled" and indistinguishable. In that document they are the two most
 * important rows to tell apart: one is a car, the other is furniture repeated
 * on every page. Excluding the header would silently take every car with it,
 * and the result would look like a shorter entry list rather than a bug.
 */
export function rowSignature(cells: readonly string[]): string {
  return cells
    .map((c) => {
      const t = c.trim();
      if (t === '') return '0';
      return BARE_NUMBER.test(t) ? 'n' : 't';
    })
    .join(',');
}

/**
 * The car number at the front of a cell, or null.
 *
 * The user says *which* column holds the number; this reads the number out of
 * it. That is not the machine guessing — the field has a type, and a cell that
 * cannot supply one is not a car.
 *
 * Two real documents need it. HTC2 has only two detectable columns, so the
 * second holds `7 David HART Olivier HART BMW M3 E30 1992 Group A2` and the
 * car number is the first token of it. NLS puts its class banners in the same
 * column as the numbers — `SP9`, `Cup2` — and without a check those become
 * cars, which is exactly the fabrication the string parser was fixed for.
 *
 * The `#` is a marker, not part of the number, so it is dropped. The leading
 * zero is not: `007` and `7` are different cars.
 */
const LEADING_NUMBER = /^#?\s*(\d{1,3}[A-Za-z]?)\b/;

export function readNumber(cellText: string): string | null {
  const m = LEADING_NUMBER.exec(cellText.trim());
  return m ? m[1]! : null;
}

/** True when the mapping says this row is furniture. */
export function isExcluded<F extends string>(
  cells: readonly string[],
  mapping: ColumnMapping<F>,
): boolean {
  return mapping.excluded.includes(rowSignature(cells));
}

export const cellAt = (
  group: readonly string[][],
  row: number,
  column: number,
): string => group[row]?.[column]?.trim() ?? '';

/**
 * The grid split into records, furniture removed.
 *
 * Excluded rows are dropped *before* grouping, so a header sitting in the
 * middle of a multi-line document does not shunt every record after it by one
 * row — which would corrupt the rest of the list in a way that still looks
 * plausible on screen.
 */
export function groupRows<F extends string>(
  grid: readonly string[][],
  mapping: ColumnMapping<F>,
): string[][][] {
  const rows = grid.filter((cells) => !isExcluded(cells, mapping));
  const stride = Math.max(1, Math.trunc(mapping.rowsPerEntry));
  const out: string[][][] = [];
  for (let start = 0; start + stride <= rows.length; start += stride) {
    out.push(rows.slice(start, start + stride));
  }
  return out;
}

const cell = (grid: readonly string[][], row: number, column: number): string =>
  grid[row]?.[column]?.trim() ?? '';

const orNull = (s: string): string | null => (s === '' ? null : s);

/**
 * Apply a mapping to a grid.
 *
 * Excluded rows are dropped *before* grouping, so a header sitting in the
 * middle of a multi-line document does not shunt every record after it by one
 * row — which would corrupt the whole rest of the list in a way that looks
 * plausible on screen.
 *
 * A group with no number is skipped rather than emitted blank. It is not lost:
 * the caller shows every unmapped row in the review either way, and an entry
 * with no number is not something you can tick off.
 */
export function applyMapping(
  grid: readonly string[][],
  mapping: ColumnMapping,
): TextEntry[] {
  if (mapping.assignments.length === 0) return [];

  const out: TextEntry[] = [];

  for (const group of groupRows(grid, mapping)) {
    let number = '';
    let className = '';
    let team = '';
    const drivers: string[] = [];

    for (const a of mapping.assignments) {
      const value = cell(group, a.row, a.column);
      if (value === '') continue;
      switch (a.field) {
        case EntryField.Number: {
          // First assignment wins, so a second mapped to the same field cannot
          // silently overwrite the one the user meant.
          const read = readNumber(value);
          if (number === '' && read !== null) number = read;
          break;
        }
        case EntryField.ClassName:
          if (className === '') className = value;
          break;
        case EntryField.Team:
          if (team === '') team = value;
          break;
        case EntryField.Drivers:
          drivers.push(value);
          break;
        case EntryField.Ignore:
          break;
      }
    }

    if (number === '') continue;

    out.push({
      number,
      className: orNull(className),
      team: orNull(team),
      // One cell may still hold several names — WEC gives each driver a column,
      // but a slash-joined cell is just as common.
      drivers: drivers.flatMap((d) =>
        d
          .split('/')
          .map((n) => n.trim())
          .filter((n) => n !== ''),
      ),
      source: group.map((g) => g.join(' ').trim()).join(' / ').trim(),
    });
  }

  return out;
}

/** The field a column is assigned at a given row offset, or Ignore. */
export function fieldAt<F extends string>(
  mapping: ColumnMapping<F>,
  row: number,
  column: number,
): F | 'ignore' {
  return (
    mapping.assignments.find((a) => a.row === row && a.column === column)?.field ??
    'ignore'
  );
}

/**
 * Set one cell's field, replacing any assignment already on it.
 *
 * `Ignore` removes the assignment rather than storing it, so a mapping only
 * ever holds what the user actually chose — which keeps `applyMapping` from
 * having to distinguish "assigned to nothing" from "never assigned".
 */
export function assign<F extends string>(
  mapping: ColumnMapping<F>,
  row: number,
  column: number,
  field: F,
): ColumnMapping<F> {
  const rest = mapping.assignments.filter(
    (a) => !(a.row === row && a.column === column),
  );
  return {
    ...mapping,
    assignments:
      field === 'ignore' ? rest : [...rest, { row, column, field }],
  };
}

/** Add or remove a row shape from the exclusion list. */
export function toggleExcluded<F extends string>(
  mapping: ColumnMapping<F>,
  cells: readonly string[],
): ColumnMapping<F> {
  const sig = rowSignature(cells);
  return {
    ...mapping,
    excluded: mapping.excluded.includes(sig)
      ? mapping.excluded.filter((s) => s !== sig)
      : [...mapping.excluded, sig],
  };
}

/**
 * True once the mapping can produce anything at all.
 *
 * `required` is the field without which a record is meaningless — the car
 * number for an entry list, the start time for a timetable. Everything else is
 * optional detail; this is the one that decides whether there is a record.
 */
export function isUsable<F extends string>(
  mapping: ColumnMapping<F>,
  required: string = EntryField.Number,
): boolean {
  return mapping.assignments.some((a) => a.field === required);
}

/** One line for the mapping screen: what this mapping would read. */
export function describeMapping(
  grid: readonly string[][],
  mapping: ColumnMapping,
): string {
  if (!isUsable(mapping)) return 'Choose which column is the car number.';
  const n = applyMapping(grid, mapping).length;
  const excluded = grid.filter((c) => isExcluded(c, mapping)).length;
  const head = n === 0 ? 'No cars yet' : `${n} car${n === 1 ? '' : 's'}`;
  return excluded === 0
    ? `${head}.`
    : `${head}, ${excluded} row${excluded === 1 ? '' : 's'} skipped.`;
}
