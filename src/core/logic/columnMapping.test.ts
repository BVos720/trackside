/**
 * Mapping columns to fields, and whether it reads the documents the string
 * parser cannot.
 *
 * The last three describes are the point of the whole feature: HTC2's row
 * index, NLS's withheld team, and the seven Spa Six Hours cars that vanish.
 * Each is a `KNOWN BUG` or a documented limitation elsewhere in this repo, and
 * each is read correctly here with a handful of assignments — no new
 * recogniser, no code change per series.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import { findColumns, type PositionedRow } from './pdfColumns';
import {
  EntryField,
  applyMapping,
  assign,
  describeMapping,
  emptyMapping,
  fieldAt,
  gridOf,
  isExcluded,
  isUsable,
  rowSignature,
  toggleExcluded,
  type ColumnMapping,
} from './columnMapping';

const rows = (name: string): PositionedRow[] =>
  JSON.parse(readFileSync(`${__dirname}/entry-lists/${name}.rows.json`, 'utf8'));

/** Build a mapping from `[column, field]` pairs on row 0. */
const map = (
  pairs: [number, EntryField][],
  over: Partial<ColumnMapping> = {},
): ColumnMapping => ({
  ...emptyMapping,
  assignments: pairs.map(([column, field]) => ({ row: 0, column, field })),
  ...over,
});

describe('rowSignature', () => {
  it('records which cells are filled, not what is in them', () => {
    // Shape, not text — so the same header matches on every page even when
    // the date in it differs.
    expect(rowSignature(['1. ADAC Eifel Trophy', '', '', '', ''])).toBe('t,0,0,0,0');
    expect(rowSignature(['1. ADAC Eifel Trophy 2027', '', '', '', ''])).toBe('t,0,0,0,0');
  });

  it('treats whitespace as empty', () => {
    expect(rowSignature(['a', '   ', 'b'])).toBe('t,0,t');
  });
});

describe('assign / fieldAt', () => {
  it('sets and reads a field', () => {
    const m = assign(emptyMapping, 0, 2, EntryField.Team);
    expect(fieldAt(m, 0, 2)).toBe(EntryField.Team);
  });

  it('replaces rather than stacking on the same cell', () => {
    let m = assign(emptyMapping, 0, 2, EntryField.Team);
    m = assign(m, 0, 2, EntryField.ClassName);
    expect(m.assignments).toHaveLength(1);
    expect(fieldAt(m, 0, 2)).toBe(EntryField.ClassName);
  });

  it('removes the assignment when set back to Ignore', () => {
    // A mapping holds only what was chosen, so applyMapping never has to tell
    // "assigned to nothing" from "never assigned".
    let m = assign(emptyMapping, 0, 2, EntryField.Team);
    m = assign(m, 0, 2, EntryField.Ignore);
    expect(m.assignments).toEqual([]);
  });

  it('keeps assignments on other cells', () => {
    let m = assign(emptyMapping, 0, 0, EntryField.Number);
    m = assign(m, 0, 1, EntryField.Team);
    expect(m.assignments).toHaveLength(2);
    expect(fieldAt(m, 0, 0)).toBe(EntryField.Number);
  });

  it('keeps row offsets apart', () => {
    let m = assign(emptyMapping, 0, 0, EntryField.Number);
    m = assign(m, 1, 0, EntryField.Drivers);
    expect(fieldAt(m, 0, 0)).toBe(EntryField.Number);
    expect(fieldAt(m, 1, 0)).toBe(EntryField.Drivers);
  });
});

describe('applyMapping', () => {
  const grid = [
    ['7', 'Toyota Gazoo Racing', 'Hypercar', 'Conway / Kobayashi'],
    ['8', 'Toyota Gazoo Racing', 'Hypercar', 'Buemi / Hartley'],
  ];
  const mapping = map([
    [0, EntryField.Number],
    [1, EntryField.Team],
    [2, EntryField.ClassName],
    [3, EntryField.Drivers],
  ]);

  it('reads each row into an entry', () => {
    const entries = applyMapping(grid, mapping);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      number: '7',
      team: 'Toyota Gazoo Racing',
      className: 'Hypercar',
      drivers: ['Conway', 'Kobayashi'],
    });
  });

  it('leaves an unmapped field null', () => {
    const entries = applyMapping(grid, map([[0, EntryField.Number]]));
    expect(entries[0]).toMatchObject({ team: null, className: null, drivers: [] });
  });

  it('skips a group with no number rather than emitting a blank', () => {
    const withBlank = [...grid, ['', 'Orphan Team', '', '']];
    expect(applyMapping(withBlank, mapping)).toHaveLength(2);
  });

  it('produces nothing until something is mapped', () => {
    expect(applyMapping(grid, emptyMapping)).toEqual([]);
  });

  it('concatenates several columns mapped to drivers', () => {
    // WEC gives each driver a column of its own.
    const wide = [['7', 'A NAME', 'B NAME', 'C NAME']];
    const entries = applyMapping(
      wide,
      map([
        [0, EntryField.Number],
        [1, EntryField.Drivers],
        [2, EntryField.Drivers],
        [3, EntryField.Drivers],
      ]),
    );
    expect(entries[0]!.drivers).toEqual(['A NAME', 'B NAME', 'C NAME']);
  });

  it('keeps the source so a mis-map can be traced', () => {
    expect(applyMapping(grid, mapping)[0]!.source).toContain('Toyota Gazoo Racing');
  });
});

describe('applyMapping — excluded rows', () => {
  const grid = [
    ['PAGE HEADER', '', ''],
    ['7', 'Toyota', 'Hypercar'],
    ['PAGE HEADER', '', ''],
    ['8', 'Ferrari', 'Hypercar'],
  ];
  const mapping = map(
    [
      [0, EntryField.Number],
      [1, EntryField.Team],
    ],
    { excluded: ['t,0,0'] },
  );

  it('drops rows matching an excluded shape', () => {
    const entries = applyMapping(grid, mapping);
    expect(entries.map((e) => e.number)).toEqual(['7', '8']);
  });

  it('drops them before grouping, not after', () => {
    // The failure this prevents: a header inside a multi-line document
    // shifting every record after it by one row, which corrupts the rest of
    // the list in a way that still looks plausible on screen.
    const multi = [
      ['4', ''],
      ['', 'WILLIS Andy'],
      ['PAGE HEADER', ''],
      ['12', ''],
      ['', 'JOLLEY Rod'],
    ];
    const m: ColumnMapping = {
      rowsPerEntry: 2,
      assignments: [
        { row: 0, column: 0, field: EntryField.Number },
        { row: 1, column: 1, field: EntryField.Drivers },
      ],
      excluded: ['t,0'],
    };
    const entries = applyMapping(multi, m);
    expect(entries.map((e) => e.number)).toEqual(['4', '12']);
    expect(entries[1]!.drivers).toEqual(['JOLLEY Rod']);
  });
});

describe('toggleExcluded', () => {
  it('adds then removes a shape', () => {
    const cells = ['header', '', ''];
    const on = toggleExcluded(emptyMapping, cells);
    expect(isExcluded(cells, on)).toBe(true);
    expect(isExcluded(cells, toggleExcluded(on, cells))).toBe(false);
  });

  it('excludes every row of the same shape at once', () => {
    // One tap, all ten pages.
    const m = toggleExcluded(emptyMapping, ['1. ADAC Eifel Trophy', '', '']);
    expect(isExcluded(['1. ADAC Eifel Trophy 2027', '', ''], m)).toBe(true);
  });
});

describe('isUsable / describeMapping', () => {
  const grid = [['7', 'Toyota'], ['8', 'Ferrari']];

  it('is unusable until the car number is chosen', () => {
    expect(isUsable(emptyMapping)).toBe(false);
    expect(describeMapping(grid, emptyMapping)).toBe(
      'Choose which column is the car number.',
    );
  });

  it('counts what it would read', () => {
    const m = map([[0, EntryField.Number]]);
    expect(isUsable(m)).toBe(true);
    expect(describeMapping(grid, m)).toBe('2 cars.');
  });

  it('names the rows being skipped', () => {
    const m = map([[0, EntryField.Number]], { excluded: ['0,t'] });
    const withHeader = [...grid, ['', 'footer']];
    expect(describeMapping(withHeader, m)).toBe('2 cars, 1 row skipped.');
  });
});

describe('gridOf', () => {
  const row = (...cells: [number, string][]): PositionedRow => ({
    tokens: cells.map(([x, text]) => ({ x, width: 10, text })),
  });

  it('slices by columns when there are some', () => {
    const rs = [row([40, 'a'], [96, 'b']), row([40, 'c'], [96, 'd'])];
    expect(gridOf(rs, findColumns(rs))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('falls back to one column of whole lines when there are none', () => {
    // The difference between "we cannot help" and "we cannot help
    // automatically" — a document that is not a table can still be mapped by
    // hand, one row offset at a time.
    const rs = [row([40, 'just'], [70, 'a line'])];
    expect(gridOf(rs, [])).toEqual([['just a line']]);
  });

  it('drops rows a page break left empty', () => {
    expect(gridOf([{ tokens: [] }], [])).toEqual([]);
  });
});
