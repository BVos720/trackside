/**
 * Column detection, against the shapes real entry lists produce.
 *
 * The fixtures in `entry-lists/` cannot be used here: they were captured
 * *after* the whitespace was collapsed, so their positions are already gone —
 * which is the whole reason this module exists. These rows are built from the
 * layouts those documents have, with the x values a PDF writer would emit.
 */
import { describe, expect, it } from 'vitest';

import {
  findColumns,
  splitRowByColumns,
  toGrid,
  type PositionedRow,
} from './pdfColumns';

/** A row from `[x, text]` pairs, with a plausible advance width. */
const row = (...cells: [number, string][]): PositionedRow => ({
  tokens: cells.map(([x, text]) => ({ x, width: text.length * 5, text })),
});

/** The WEC shape: number, team, nat, tyre, car, drivers. */
const WEC: PositionedRow[] = [
  row([40, '007'], [96, 'ASTON MARTIN THOR TEAM'], [300, 'USA'], [340, 'M']),
  row([40, '009'], [96, 'ASTON MARTIN THOR TEAM'], [300, 'USA'], [340, 'M']),
  row([40, '7'], [96, 'TOYOTA RACING'], [300, 'JPN'], [340, 'M']),
  row([40, '8'], [96, 'TOYOTA RACING'], [300, 'JPN'], [340, 'M']),
];

describe('findColumns', () => {
  it('finds the bands the rows agree on', () => {
    const columns = findColumns(WEC);
    expect(columns).toHaveLength(4);
    expect(columns.map((c) => c.left)).toEqual([40, 96, 300, 340]);
  });

  it('runs each column up to the next one, not to its own text', () => {
    // A short value in a wide column would otherwise claim a sliver, and the
    // rest of the cell would fall into the column to its right.
    const columns = findColumns(WEC);
    expect(columns[0]!.right).toBe(96);
    expect(columns[1]!.right).toBe(300);
    expect(columns.at(-1)!.right).toBe(Number.POSITIVE_INFINITY);
  });

  it('absorbs the sub-point drift a PDF writer emits', () => {
    // The same column, never at exactly the same x twice.
    const drifting = [
      row([40, 'a'], [96.0, 'x']),
      row([40.4, 'b'], [96.7, 'y']),
      row([39.8, 'c'], [95.5, 'z']),
    ];
    expect(findColumns(drifting)).toHaveLength(2);
  });

  it('does not merge two columns that are genuinely close', () => {
    // 12pt apart is the narrowest real gap in the sample documents.
    const tight = [
      row([40, 'a'], [52, 'b']),
      row([40, 'c'], [52, 'd']),
      row([40, 'e'], [52, 'f']),
    ];
    expect(findColumns(tight)).toHaveLength(2);
  });

  it('ignores a band only one row uses', () => {
    // A single indented line is not a column, however far it sticks out.
    const withStray = [...WEC, row([40, 'x'], [96, 'y'], [500, 'footnote'])];
    expect(findColumns(withStray).map((c) => c.left)).toEqual([40, 96, 300, 340]);
  });

  it('counts rows, not tokens', () => {
    // One row with eight tokens in a band is one row's opinion. Counting
    // tokens would let a single line invent a column for the whole document.
    const oneBusyRow = [
      row([40, 'a'], [40, 'b'], [40, 'c'], [40, 'd'], [40, 'e'], [40, 'f']),
      row([200, 'z']),
    ];
    expect(findColumns(oneBusyRow)).toEqual([]);
  });
});

describe('findColumns — when it must say no', () => {
  it('finds nothing in prose', () => {
    // Wrapped paragraph text: every line starts in the same place and has no
    // second band. One band is not a table.
    const prose = [
      row([40, 'Entry list subject to change until scrutineering closes.']),
      row([40, 'All times are local.']),
      row([40, 'Published by the organiser.']),
    ];
    expect(findColumns(prose)).toEqual([]);
  });

  it('finds nothing in an empty document', () => {
    expect(findColumns([])).toEqual([]);
    expect(findColumns([{ tokens: [] }])).toEqual([]);
  });

  it('needs more than one row to claim a table', () => {
    expect(findColumns([row([40, 'a'], [96, 'b'], [300, 'c'])])).toEqual([]);
  });
});

describe('splitRowByColumns', () => {
  const columns = findColumns(WEC);

  it('puts each token in its own column', () => {
    expect(splitRowByColumns(WEC[0]!, columns)).toEqual([
      '007',
      'ASTON MARTIN THOR TEAM',
      'USA',
      'M',
    ]);
  });

  it('joins several tokens landing in one column', () => {
    // A cell whose text the PDF emitted as separate runs, which is normal.
    const split = row([40, '7'], [96, 'TOYOTA'], [140, 'RACING'], [300, 'JPN'], [340, 'M']);
    expect(splitRowByColumns(split, columns)[1]).toBe('TOYOTA RACING');
  });

  it('leaves a missing cell empty rather than shifting the rest left', () => {
    // The failure this prevents: one absent value silently moving every
    // later field into the wrong column for that row alone.
    const gap = row([40, '7'], [300, 'JPN'], [340, 'M']);
    expect(splitRowByColumns(gap, columns)).toEqual(['7', '', 'JPN', 'M']);
  });

  it('does not drop a token that starts before the first column', () => {
    // Losing text silently is the one outcome this design exists to avoid.
    const marginal = row([10, '*'], [40, '7'], [96, 'TOYOTA RACING']);
    expect(splitRowByColumns(marginal, columns)[0]).toBe('* 7');
  });

  it('returns nothing when there are no columns', () => {
    expect(splitRowByColumns(WEC[0]!, [])).toEqual([]);
  });
});

describe('toGrid', () => {
  it('slices every row the same way', () => {
    const grid = toGrid(WEC, findColumns(WEC));
    expect(grid).toHaveLength(4);
    expect(grid.every((cells) => cells.length === 4)).toBe(true);
    expect(grid[2]).toEqual(['7', 'TOYOTA RACING', 'JPN', 'M']);
  });

  it('drops rows a page break left empty', () => {
    const withBlank = [...WEC, { tokens: [] }];
    expect(toGrid(withBlank, findColumns(WEC))).toHaveLength(4);
  });
});

describe('the HTC2 case, which is why this exists', () => {
  /**
   * `3 7 David HART Olivier HART BMW M3 E30 1992 Group A2` — row index 3,
   * car 7. Collapsed to one string the two integers are indistinguishable and
   * the parser takes the wrong one. With positions they are simply two
   * columns, and the human says which is which.
   */
  const HTC2: PositionedRow[] = [
    row([30, '2'], [50, '6'], [80, 'Jean-Lou RIHON'], [260, 'BMW 635 CSi'], [400, 'Group A1']),
    row([30, '3'], [50, '7'], [80, 'David HART'], [260, 'BMW M3 E30'], [400, 'Group A2']),
    row([30, '4'], [50, '8'], [80, 'Xavier GALANT'], [260, 'Mercedes 190E'], [400, 'Group A2']),
  ];

  it('separates the row index from the car number', () => {
    const columns = findColumns(HTC2);
    expect(columns).toHaveLength(5);

    const cells = splitRowByColumns(HTC2[1]!, columns);
    expect(cells[0]).toBe('3'); // the row index
    expect(cells[1]).toBe('7'); // the car number, recoverable at last
    expect(cells[4]).toBe('Group A2');
  });
});
