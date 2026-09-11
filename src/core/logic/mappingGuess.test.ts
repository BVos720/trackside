/**
 * The machine's first reading, against the real documents.
 *
 * The bar is not "right everywhere" — the person corrects whatever this gets
 * wrong, one tap per cell. It is "right where the answer is plain, and silent
 * where it is not": a missing label costs a tap, a confident wrong one costs
 * trust.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import { EntryField, applyMapping, gridOf } from './columnMapping';
import {
  guessEntryMapping,
  guessTimetableMapping,
  isRowCounter,
  looksLikePerson,
} from './mappingGuess';
import { findColumns, type PositionedRow } from './pdfColumns';
import { TimetableField, applyTimetableMapping } from './timetableMapping';

const gridFor = (dir: string, name: string) => {
  const rows: PositionedRow[] = JSON.parse(
    readFileSync(`${__dirname}/${dir}/${name}.rows.json`, 'utf8'),
  );
  return gridOf(rows, findColumns(rows));
};

describe('isRowCounter', () => {
  it('recognises a column that counts rows', () => {
    expect(isRowCounter(['1', '2', '3', '4', '5', '6'])).toBe(true);
  });

  it('does not mistake real car numbers for one', () => {
    // WEC's first column. Sorted, and still skipping.
    expect(isRowCounter(['007', '009', '7', '8', '12', '15', '17', '19', '20', '35'])).toBe(
      false,
    );
  });

  it('wants enough evidence before calling anything a counter', () => {
    expect(isRowCounter(['1', '2', '3'])).toBe(false);
  });
});

describe('looksLikePerson', () => {
  it.each([
    'Harry TINCKNELL (GBR)',
    'Sheldon VAN DER LINDE (RSA',
    'Paul-Loup CHATIN (FRA)',
    'WILLIS Andy (GBR)',
    'Kaya, Mustafa Mehmet',
  ])('reads %s as a person', (cell) => {
    expect(looksLikePerson(cell)).toBe(true);
  });

  it.each(['TOYOTA RACING', 'ASTON MARTIN THOR TEAM', 'IDEC SPORT', 'Oreca 07 - Gibson', 'USA', 'P'])(
    'does not read %s as a person',
    (cell) => {
      expect(looksLikePerson(cell)).toBe(false);
    },
  );
});

describe('guessEntryMapping — WEC', () => {
  const grid = gridFor('entry-lists', 'wec-spa-2026');
  const guess = guessEntryMapping(grid);
  const cars = applyMapping(grid, guess);

  it('reads all 35 cars without a tap', () => {
    expect(cars).toHaveLength(35);
  });

  it('finds the team and all three drivers', () => {
    const toyota = cars.find((e) => e.number === '7')!;
    expect(toyota.team).toBe('TOYOTA RACING');
    expect(toyota.drivers).toHaveLength(3);
  });

  it('keeps the leading zero on 007', () => {
    expect(cars.map((e) => e.number)).toContain('007');
  });

  it('proposes no class, because this document has no class column', () => {
    // Class is a section banner here. Guessing the nationality or driver
    // grade column instead would put "USA" or "P" on every car.
    expect(guess.assignments.some((a) => a.field === EntryField.ClassName)).toBe(false);
  });
});

describe('guessEntryMapping — ELMS', () => {
  const grid = gridFor('entry-lists', 'elms-spa-2026');
  const cars = applyMapping(grid, guessEntryMapping(grid));

  it('reads all 47 cars without a tap', () => {
    expect(cars).toHaveLength(47);
  });

  it('reads the first car with its team and drivers', () => {
    expect(cars[0]!.team).not.toBeNull();
    expect(cars[0]!.drivers.length).toBeGreaterThan(0);
  });
});

describe('guessEntryMapping — HTC2', () => {
  const grid = gridFor('entry-lists', 'htc2-spa');
  const cars = applyMapping(grid, guessEntryMapping(grid));

  it('skips the row counter and reads car 7, not row 3', () => {
    // The KNOWN BUG in entryList.fixtures.test.ts, settled with no tap at all.
    const hart = cars.find((e) => /David HART/.test(e.source))!;
    expect(hart.number).toBe('7');
  });
});

describe('guessEntryMapping — Spa Six Hours', () => {
  const grid = gridFor('entry-lists', 'spa-six-hours-2025');

  it('offers the whole line as the number column when there are no columns', () => {
    const guess = guessEntryMapping(grid);
    expect(guess.assignments).toEqual([{ row: 0, column: 0, field: EntryField.Number }]);
  });

  it('reads the car whose number sits alone on its line', () => {
    const cars = applyMapping(grid, guessEntryMapping(grid));
    expect(cars.map((e) => e.number)).toContain('4');
  });
});

describe('guessEntryMapping — nothing to go on', () => {
  it('proposes nothing rather than inventing a number column', () => {
    const prose = [['Welcome to the circuit'], ['Parking is behind the main stand']];
    expect(guessEntryMapping(prose).assignments).toEqual([]);
  });

  it('survives an empty grid', () => {
    expect(guessEntryMapping([]).assignments).toEqual([]);
  });
});

describe('guessTimetableMapping — WEC', () => {
  const grid = gridFor('timetables', 'wec-spa-2026');
  const guess = guessTimetableMapping(grid);
  const sessions = applyTimetableMapping(grid, guess);

  it('reads as many sessions as the parser does', () => {
    // The parser finds 64 in this document.
    expect(sessions.length).toBeGreaterThanOrEqual(60);
  });

  it('takes the start and end from their own columns', () => {
    expect(sessions[0]).toMatchObject({ start: '08:30', end: '13:00' });
  });

  it('carries the day heading row onto the sessions beneath it', () => {
    expect(sessions[0]!.day).toBe('WEDNESDAY, MAY 6');
    expect(new Set(sessions.map((s) => s.day)).size).toBe(4);
  });

  it('builds the name from the series and the session, not the duration', () => {
    expect(sessions[0]!.title).toMatch(/FIA WEC — ADMINISTRATIVE CHECKS/);
    expect(sessions.some((s) => /\d'/.test(s.title))).toBe(false);
  });
});

describe('guessTimetableMapping — ELMS', () => {
  const grid = gridFor('timetables', 'elms-spa-2026');
  const guess = guessTimetableMapping(grid);
  const sessions = applyTimetableMapping(grid, guess);

  it('sees that the start column holds both times, and maps no separate end', () => {
    expect(guess.assignments.some((a) => a.field === TimetableField.End)).toBe(false);
    expect(sessions[0]).toMatchObject({ start: '08:30', end: '13:00' });
  });

  it('reads most of the weekend', () => {
    // The parser finds 66, some of them from names on the line above, which
    // a one-row record cannot reach.
    expect(sessions.length).toBeGreaterThanOrEqual(50);
  });
});

describe('guessTimetableMapping — Spa Classic', () => {
  const grid = gridFor('timetables', 'spa-classic-2026');
  const guess = guessTimetableMapping(grid);
  const sessions = applyTimetableMapping(grid, guess);

  it('takes start and end, and leaves the duration and interval columns alone', () => {
    const times = guess.assignments.filter(
      (a) => a.field === TimetableField.Start || a.field === TimetableField.End,
    );
    expect(times).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ start: '09:00', end: '09:30' });
  });

  it('reads the sessions under the bilingual day headings', () => {
    expect(sessions.length).toBeGreaterThanOrEqual(35);
    expect(sessions[0]!.day).toMatch(/FRIDAY/);
  });
});

describe('guessTimetableMapping — pasted text', () => {
  it('points at the one column, which then yields both times and the name', () => {
    const grid = [
      ['SATURDAY 23 MAY'],
      ['11:00 12:30 FIA WEC FREE PRACTICE 1 Track'],
      ['14:00 15:00 FIA WEC QUALIFYING Track'],
      ['15:30 16:00 PIT WALK Pit Lane'],
    ];
    const sessions = applyTimetableMapping(grid, guessTimetableMapping(grid));
    expect(sessions).toHaveLength(3);
    expect(sessions[0]).toMatchObject({
      day: 'SATURDAY 23 MAY',
      start: '11:00',
      end: '12:30',
      title: 'FIA WEC FREE PRACTICE 1 Track',
    });
  });

  it('proposes nothing for a document with no times in it', () => {
    expect(guessTimetableMapping([['Welcome'], ['Parking']]).assignments).toEqual([]);
  });
});
