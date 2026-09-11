/**
 * The machine's first reading of what each column means — TASKS-pdf-mapping.md.
 *
 * ── Why the mapper now starts filled in ───────────────────────────────────
 * The mapper began empty on principle: the machine finds the columns, the
 * person says what they mean. On a phone at a circuit that principle cost ten
 * taps before the first car appeared, on documents where the answer is plain
 * from the cells themselves — a column of `007`, `7`, `8`, `12` is the car
 * number, and a column of `Harry TINCKNELL (GBR)` is a driver.
 *
 * So this proposes and the person corrects. Nothing here decides anything
 * out of sight: the guess lands in the same grid under the same labels, the
 * live preview shows what it reads, and "Use" is still a button somebody
 * presses. A wrong guess costs one tap on the cell it got wrong. That is the
 * hybrid — the algorithm does the obvious part, the human does the part only
 * a human can see.
 *
 * ── Conservative on purpose ───────────────────────────────────────────────
 * Every rule here would rather leave a column unassigned than assign it
 * wrongly. An unlabelled cell invites a tap; a confident wrong label invites
 * trust. Class in particular is only proposed from known class names: in
 * every sample document the class is a section banner rather than a column,
 * and a column of nationalities or driver grades guessed as class would put
 * "USA" on forty cars.
 *
 * Pure, and tested against the real documents in `entry-lists/` and
 * `timetables/`.
 */
import {
  EntryField,
  readNumber,
  type ColumnMapping,
  type FieldAssignment,
} from './columnMapping';
import {
  TimetableField,
  readTime,
  type TimetableMapping,
} from './timetableMapping';
import { isDayHeading } from './timetableText';

type Grid = readonly (readonly string[])[];

/** "-", "–", "·": printed where a cell is empty, and meaning exactly that. */
const PLACEHOLDER = /^[-–—·.]+$/;

/** The filled cells of one column, placeholders dropped. */
function filled(grid: Grid, column: number): string[] {
  const out: string[] = [];
  for (const row of grid) {
    const v = row[column]?.trim() ?? '';
    if (v !== '' && !PLACEHOLDER.test(v)) out.push(v);
  }
  return out;
}

const share = (cells: readonly string[], test: (c: string) => boolean): number =>
  cells.length === 0 ? 0 : cells.filter(test).length / cells.length;

const widthOf = (grid: Grid): number =>
  grid.reduce((w, r) => Math.max(w, r.length), 0);

const averageLength = (cells: readonly string[]): number =>
  cells.length === 0 ? 0 : cells.reduce((n, c) => n + c.length, 0) / cells.length;

const one = <F extends string>(column: number, field: F): FieldAssignment<F> => ({
  row: 0,
  column,
  field,
});

// ── Entry lists ────────────────────────────────────────────────────────────

const BARE_NUMBER = /^#?\s*\d{1,3}[A-Za-z]?$/;

/**
 * A running row count, not a car number.
 *
 * HTC2 numbers its rows 1, 2, 3… in the first column and prints the car
 * number in the second — the KNOWN BUG in entryList.fixtures.test.ts, where
 * the parser reads car 3 for car 7. A column that mostly counts up by exactly
 * one is a counter. Real car numbers skip: 007, 009, 7, 8, 12, 15.
 */
export function isRowCounter(cells: readonly string[]): boolean {
  const numbers = cells.filter((c) => /^\d{1,3}$/.test(c)).map(Number);
  if (numbers.length < 5) return false;
  let steps = 0;
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] === numbers[i - 1]! + 1) steps++;
  }
  return steps / (numbers.length - 1) >= 0.7;
}

/**
 * How racing documents print a person.
 *
 * Three shapes cover every sample: "Harry TINCKNELL" (WEC, ELMS — given name,
 * then the surname in capitals), "WILLIS Andy" (Spa Six Hours — the other way
 * round) and "Kaya, Mustafa" (NLS — surname, comma, given name). Team names
 * in these documents are set entirely in capitals, which keeps "TOYOTA
 * RACING" out of the first shape and "IDEC SPORT" out of the second.
 */
const PERSON = [
  /\p{Lu}[\p{Ll}'’-]+(?:[\s-]+\p{Lu}[\p{Ll}'’-]+)*\s+\p{Lu}{2,}[\p{Lu}'’-]*(?=[\s(,/]|$)/u,
  /^\p{Lu}{2,}[\p{Lu}'’-]*(?:\s+\p{Lu}{2,}[\p{Lu}'’-]*)*\s+\p{Lu}\p{Ll}+/u,
  /^\p{Lu}[\p{Ll}'’-]+(?:[\s-]+\p{Lu}[\p{Ll}'’-]+)*,\s*\p{Lu}\p{Ll}/u,
];

export const looksLikePerson = (cell: string): boolean =>
  PERSON.some((p) => p.test(cell));

/** Class names as series print them. Only these are ever proposed as class. */
const CLASS_NAME =
  /^(hypercar|lmh|lmdh|lmp[1-3](?:\s*pro[\s/-]*am)?|lmgt3|gte(?:\s*(?:pro|am))?|gt[1-4](?:\s*(?:pro|am|cup))?|gtd(?:\s*pro)?|tcr|sp\s?-?\s?(?:\d{1,2}[a-z]?|pro|x|t)|cup\s?\d|pro|am|pro[\s/-]*am|silver|bronze|gold)$/i;

const NOTHING: ColumnMapping = { rowsPerEntry: 1, assignments: [], excluded: [] };

/**
 * A first reading of an entry-list grid.
 *
 * The car number is the anchor, as it is for the parser: find it, treat the
 * rows that have one as the cars, and read the other columns only in those
 * rows — so a page header or a class banner cannot vote on what a column is.
 */
export function guessEntryMapping(grid: Grid): ColumnMapping {
  const width = widthOf(grid);
  if (width === 0) return NOTHING;
  const columns = Array.from({ length: width }, (_, c) => filled(grid, c));

  const counter = columns.map(isRowCounter);
  const bare = columns.map((cells) => share(cells, (c) => BARE_NUMBER.test(c)));
  const leading = columns.map((cells) => share(cells, (c) => readNumber(c) !== null));
  const enough = (c: number) => columns[c]!.length >= 3;

  const first = (ok: (c: number) => boolean): number => {
    for (let c = 0; c < width; c++) if (ok(c)) return c;
    return -1;
  };

  // A column of bare numbers first; then one whose cells *start* with a
  // number (HTC2's second column, which holds the car and everything after
  // it); and a counter only when nothing else could be the number at all —
  // a club list numbered 1 to 30 is still a list of cars.
  let number = first((c) => enough(c) && !counter[c] && bare[c]! >= 0.5);
  if (number < 0) number = first((c) => enough(c) && !counter[c] && leading[c]! >= 0.5);
  if (number < 0) number = first((c) => enough(c) && bare[c]! >= 0.5);
  // Whole lines in one column — a paste, or a PDF with no bands. A numbered
  // line is a car even when only some lines are numbered.
  if (number < 0 && width === 1 && leading[0]! >= 0.25) number = 0;
  if (number < 0) return NOTHING;

  const records = grid.filter((r) => readNumber(r[number] ?? '') !== null);
  const inRecords = (c: number) => filled(records, c);

  const drivers: number[] = [];
  for (let c = 0; c < width; c++) {
    if (c === number) continue;
    const cells = inRecords(c);
    if (
      cells.length >= Math.max(2, records.length * 0.3) &&
      share(cells, looksLikePerson) >= 0.5
    ) {
      drivers.push(c);
    }
  }

  let classColumn = -1;
  for (let c = 0; c < width; c++) {
    if (c === number || drivers.includes(c)) continue;
    const cells = inRecords(c);
    if (cells.length >= 3 && share(cells, (v) => CLASS_NAME.test(v)) >= 0.6) {
      classColumn = c;
      break;
    }
  }

  /*
   * The team: the first column of real text after the number and before the
   * drivers.
   *
   * "Before the drivers" is what keeps NLS's town column — "Meuspath",
   * "Wermelskirchen" — from being read as the team. Every sample that has a
   * team puts it between the number and the first driver.
   */
  let team = -1;
  const limit = drivers.length > 0 ? Math.min(...drivers) : width;
  for (let c = number + 1; c < limit; c++) {
    if (c === classColumn) continue;
    const cells = inRecords(c);
    if (cells.length < records.length * 0.5) continue;
    if (share(cells, (v) => BARE_NUMBER.test(v)) >= 0.3) continue;
    if (averageLength(cells) < 6) continue;
    team = c;
    break;
  }

  const assignments: FieldAssignment[] = [one(number, EntryField.Number)];
  if (classColumn >= 0) assignments.push(one(classColumn, EntryField.ClassName));
  if (team >= 0) assignments.push(one(team, EntryField.Team));
  for (const c of drivers) assignments.push(one(c, EntryField.Drivers));

  return { rowsPerEntry: 1, assignments, excluded: [] };
}

// ── Timetables ─────────────────────────────────────────────────────────────

/** Words that name a place at a circuit rather than a session. */
const LOCATION =
  /\b(track|pit\s*lane|pitlane|pit|paddock|room|office|area|garages?|building|pitbuilding|tower|centre|center|hall|zone|grid|podium|circuit|village|parc\s+ferm[ée])\b/i;

/** "60'", "90 min" — a duration column, which is neither a time nor a name. */
const DURATION = /^\d{1,3}\s*(?:'|min|mins)$/i;

const TIMES = /\d{1,2}[:.]\d{2}/g;

/**
 * A first reading of a timetable grid.
 *
 * The first column of clock times is the start and the second is the end —
 * unless the start cells usually hold both, which is how ELMS prints them.
 * Any later time columns are durations and intervals (Spa Classic has both)
 * and are left alone. Every other column with text in most sessions is part
 * of the name, and one that mostly names places is the location.
 *
 * Day headings are not guessed here because they are rows, not columns;
 * `applyTimetableMapping` carries them onto the sessions beneath.
 */
export function guessTimetableMapping(grid: Grid): TimetableMapping {
  const empty: TimetableMapping = { rowsPerEntry: 1, assignments: [], excluded: [] };
  const width = widthOf(grid);
  if (width === 0) return empty;
  const columns = Array.from({ length: width }, (_, c) => filled(grid, c));

  const timeish = columns.map(
    (cells) => cells.length >= 3 && share(cells, (v) => readTime(v) !== null) >= 0.35,
  );
  const timeColumns = columns.map((_, c) => c).filter((c) => timeish[c]);
  const start = timeColumns[0];
  if (start === undefined) return empty;

  const records = grid.filter((r) => readTime(r[start] ?? '') !== null);
  const bothInOne =
    share(filled(records, start), (v) => (v.match(TIMES) ?? []).length >= 2) >= 0.5;

  const assignments: FieldAssignment<TimetableField>[] = [
    one(start, TimetableField.Start),
  ];
  const end = timeColumns[1];
  if (!bothInOne && end !== undefined) {
    assignments.push(one(end, TimetableField.End));
  }

  for (let c = 0; c < width; c++) {
    if (timeish[c]) continue;
    const cells = filled(records, c);
    if (cells.length === 0 || cells.length < records.length * 0.3) continue;
    if (share(cells, (v) => DURATION.test(v) || readTime(v) !== null) >= 0.5) continue;
    if (averageLength(cells) < 2) continue;

    if (share(cells, isDayHeading) >= 0.6) {
      assignments.push(one(c, TimetableField.Day));
    } else if (share(cells, (v) => LOCATION.test(v)) >= 0.4) {
      assignments.push(one(c, TimetableField.Location));
    } else {
      assignments.push(one(c, TimetableField.Title));
    }
  }

  return { rowsPerEntry: 1, assignments, excluded: [] };
}
