/**
 * Mapping the five real documents by hand — the case for the whole feature.
 *
 * Each block below is what a person would tap on the mapping screen, and then
 * what comes out. Three of them read documents the string parser cannot:
 *
 *   • **HTC2** — `entryList.fixtures.test.ts` records as KNOWN BUG that
 *     `3 7 David HART …` yields car 3 where the car is 7.
 *   • **NLS** — `entryList.ts` deliberately withholds every team, because
 *     entrant, town, licence and car are indistinguishable once the spacing
 *     is gone.
 *   • **Spa Six Hours** — seven cars vanish with no trace in either `entries`
 *     or `skipped`, because their number sits alone on a line.
 *
 * All three come out right here, with a handful of assignments and no code
 * change per series. That is the argument: today a new format needs a new
 * recogniser and a release; this needs a few taps at the circuit, offline.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import { findColumns, type PositionedRow } from './pdfColumns';
import {
  EntryField,
  applyMapping,
  emptyMapping,
  gridOf,
  toggleExcluded,
  type ColumnMapping,
} from './columnMapping';

const rows = (name: string): PositionedRow[] =>
  JSON.parse(readFileSync(`${__dirname}/entry-lists/${name}.rows.json`, 'utf8'));

const gridFor = (name: string) => {
  const rs = rows(name);
  return gridOf(rs, findColumns(rs));
};

/** What the user taps: `[column, field]` on row 0 of each record. */
const single = (
  pairs: [number, EntryField][],
  over: Partial<ColumnMapping> = {},
): ColumnMapping => ({
  ...emptyMapping,
  assignments: pairs.map(([column, field]) => ({ row: 0, column, field })),
  ...over,
});

describe('WEC — four taps', () => {
  const grid = gridFor('wec-spa-2026');
  // Number, team, class is not a column here (it is a section banner), and
  // three driver columns.
  const mapping = single([
    [0, EntryField.Number],
    [1, EntryField.Team],
    [5, EntryField.Drivers],
    [7, EntryField.Drivers],
    [9, EntryField.Drivers],
  ]);

  it('reads all 35 cars', () => {
    expect(applyMapping(grid, mapping)).toHaveLength(35);
  });

  it('gets the drivers whole, first one included', () => {
    // The string parser cannot find the first driver's left boundary — the
    // car model runs into it — so it clips the given name. Columns do not.
    const toyota = applyMapping(grid, mapping).find((e) => e.number === '7')!;
    expect(toyota.team).toBe('TOYOTA RACING');
    expect(toyota.drivers).toEqual([
      'Mike CONWAY (GBR)',
      'Kamui KOBAYASHI (JPN)',
      'Nyck DE VRIES (NED)',
    ]);
  });

  it('keeps the leading zero on 007', () => {
    expect(applyMapping(grid, mapping).map((e) => e.number)).toContain('007');
  });
});

describe('ELMS — the same taps, a different document', () => {
  const grid = gridFor('elms-spa-2026');
  const mapping = single([
    [0, EntryField.Number],
    [1, EntryField.Team],
    [5, EntryField.Drivers],
    [7, EntryField.Drivers],
    [9, EntryField.Drivers],
  ]);

  it('reads all 47 cars', () => {
    // Same publisher, same layout — which is the argument for templates
    // (TASKS-pdf-mapping P6/P7): map it once, apply it every round.
    expect(applyMapping(grid, mapping)).toHaveLength(47);
  });

  it('reads the first car whole', () => {
    expect(applyMapping(grid, mapping)[0]).toMatchObject({
      number: '9',
      team: 'PROTON COMPETITION',
    });
  });
});

describe('NLS — the team the parser had to withhold', () => {
  const grid = gridFor('nls6-2026');

  const base = single([
    [0, EntryField.Number],
    [2, EntryField.Team],
  ]);

  /** The running page header: text alone in the first column. */
  const header = grid.find((c) => c[0]?.startsWith('1. ADAC Eifel Trophy'))!;
  /**
   * A stray `325i` — a BMW model designation that lands in the number column
   * on one row, with every other cell empty.
   *
   * A car number by shape and not by meaning, and no rule can tell the
   * difference: 325 is a plausible number and `i` a plausible suffix. This is
   * exactly the case the design hands to the person, who can see at a glance
   * that a row with a number and nothing else is not a car in this document.
   */
  const stray = grid.find((c) => c[0] === '325i')!;

  const mapping = toggleExcluded(toggleExcluded(base, header), stray);

  it('reads 111 with only the header excluded — one is not a car', () => {
    // Recorded rather than glossed: the count is not exact until the second
    // shape is excluded too, and knowing which row is wrong is the point.
    expect(applyMapping(grid, toggleExcluded(base, header))).toHaveLength(111);
  });

  it('reads exactly the 110 the document prints, after two taps', () => {
    // "Teilnehmer: 110" is printed in the file, so this is checkable against
    // the document rather than against the parser's own opinion.
    expect(applyMapping(grid, mapping)).toHaveLength(110);
  });

  it('recovers the team, which `entryList.ts` leaves null on principle', () => {
    const falcon = applyMapping(grid, mapping).find((e) => e.number === '5')!;
    expect(falcon.team).toBe('BLACK FALCON Team EAE');
  });

  it('excludes every copy of the running header, not just the first', () => {
    // Shape matching, so page 7's copy goes with page 1's.
    const without = applyMapping(grid, mapping);
    expect(without.some((e) => /ADAC Eifel Trophy/.test(e.source))).toBe(false);
  });
});

describe('HTC2 — the KNOWN BUG, settled by one tap', () => {
  const grid = gridFor('htc2-spa');

  it('takes the car number from the second column', () => {
    // `entryList.ts` reads car 3 here and cannot do otherwise: collapsed to a
    // string, the row index and the car number are two integers with nothing
    // to tell them apart. Choosing the column is the entire fix.
    const mapping = single([[1, EntryField.Number]]);
    const entries = applyMapping(grid, mapping);

    const hart = entries.find((e) => /David HART/.test(e.source))!;
    expect(hart.number).toBe('7');
  });

  it('would take the wrong one if the first column were chosen', () => {
    // The same document, the other tap — proof the choice is what decides it,
    // not something incidental about this file.
    const wrong = applyMapping(grid, single([[0, EntryField.Number]]));
    expect(wrong.find((e) => /David HART/.test(e.source))!.number).toBe('3');
  });
});

describe('Spa Six Hours — the seven cars that vanish', () => {
  const rs = rows('spa-six-hours-2025');
  // No columns at all, so every row is one cell of whole-line text. The
  // records run three lines: `# 4`, the car, the driver.
  const grid = gridOf(rs, findColumns(rs));

  it('has no columns, so the grid is one cell per line', () => {
    expect(grid.every((cells) => cells.length === 1)).toBe(true);
  });

  it('reads a car whose number sits alone on its line', () => {
    // Not in `entries` and not in `skipped` today — gone without trace, which
    // is worse than the HTC2 bug because there is nothing to notice.
    const lone = grid.findIndex((c) => /^#\s*4$/.test(c[0]!));
    expect(lone).toBeGreaterThanOrEqual(0);

    const mapping: ColumnMapping = {
      rowsPerEntry: 3,
      assignments: [
        { row: 0, column: 0, field: EntryField.Number },
        { row: 1, column: 0, field: EntryField.Team },
        { row: 2, column: 0, field: EntryField.Drivers },
      ],
      excluded: [],
    };

    // Applied from the first record rather than the top of the file, since the
    // title block above it is not part of the three-line rhythm.
    const entries = applyMapping(grid.slice(lone), mapping);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.number).toBe('4');
  });

  it('shows why a fixed stride is not enough on its own', () => {
    /*
     * Honest limitation, recorded rather than hidden.
     *
     * This document does not hold a three-line rhythm throughout — some cars
     * put the number and the car on one line. A fixed `rowsPerEntry` drifts
     * out of step after the first such record, and every entry past it is
     * assembled from the wrong lines.
     *
     * The fix is not a cleverer stride: it is that the review after mapping is
     * editable (section R), so drift is visible and correctable rather than
     * silent. If M4 ever grows a smarter grouping — "a new record starts at a
     * row shaped `n`" — this test is where it gets proved.
     */
    const mapping: ColumnMapping = {
      rowsPerEntry: 3,
      assignments: [{ row: 0, column: 0, field: EntryField.Number }],
      excluded: [],
    };
    const entries = applyMapping(grid, mapping);
    // Well short of the 35 the document's own footer claims.
    expect(entries.length).toBeLessThan(35);
  });
});
