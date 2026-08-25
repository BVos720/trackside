/**
 * Timetables through the mapper — the fallback for a document
 * `timetableText.ts` has never seen.
 *
 * That parser reads all three real Spa documents correctly and stays the first
 * thing tried. What it cannot do is the fourth layout, where it produces
 * nothing and a shrug. These tests use the shapes it fails on.
 */
import { describe, expect, it } from 'vitest';

import { parseTimetableLines } from './timetableText';
import {
  TimetableField,
  applyTimetableMapping,
  describeTimetableMapping,
  emptyTimetableMapping,
  isTimetableUsable,
  readTime,
  type TimetableMapping,
} from './timetableMapping';

/** Build a mapping from `[column, field]` pairs on row 0. */
const map = (
  pairs: [number, TimetableField][],
  over: Partial<TimetableMapping> = {},
): TimetableMapping => ({
  ...emptyTimetableMapping,
  assignments: pairs.map(([column, field]) => ({ row: 0, column, field })),
  ...over,
});

const standard = map([
  [0, TimetableField.Start],
  [1, TimetableField.End],
  [2, TimetableField.Title],
]);

describe('readTime', () => {
  it('reads the separators these documents use', () => {
    expect(readTime('09:05')).toBe('09:05');
    expect(readTime('9.05')).toBe('09:05');
    expect(readTime(' 09:05:00 ')).toBe('09:05');
  });

  it('pads to a fixed width so times sort as text', () => {
    expect(readTime('9:05')).toBe('09:05');
  });

  it('returns null for a cell with no time in it', () => {
    // Which is what keeps a column header, or a stray note, from becoming a
    // session at 00:00.
    expect(readTime('Start')).toBeNull();
    expect(readTime('')).toBeNull();
  });

  it('rejects an impossible time rather than clamping it', () => {
    // 25:00 is a typo or a mis-mapped column. Inventing 01:00 from it would
    // put a session on the plan at a time nothing runs.
    expect(readTime('25:00')).toBeNull();
    expect(readTime('12:75')).toBeNull();
  });
});

describe('applyTimetableMapping', () => {
  const grid = [
    ['09:00', '09:30', 'FIA WEC FREE PRACTICE 1'],
    ['11:00', '12:30', 'FIA WEC FREE PRACTICE 2'],
  ];

  it('reads each row into a session', () => {
    const sessions = applyTimetableMapping(grid, standard);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      start: '09:00',
      end: '09:30',
      title: 'FIA WEC FREE PRACTICE 1',
      durationMinutes: 30,
    });
  });

  it('classifies from the title, as the parser does', () => {
    expect(applyTimetableMapping(grid, standard)[0]!.kind).toBe('practice');
  });

  it('carries a day column onto its sessions', () => {
    const withDay = [['SATURDAY', '09:00', '09:30', 'PRACTICE']];
    const sessions = applyTimetableMapping(
      withDay,
      map([
        [0, TimetableField.Day],
        [1, TimetableField.Start],
        [2, TimetableField.End],
        [3, TimetableField.Title],
      ]),
    );
    expect(sessions[0]!.day).toBe('SATURDAY');
  });

  it('folds a location column into the title', () => {
    // Nothing schedules on it, and "Track" is often the only thing telling
    // two otherwise identical rows apart.
    const withPlace = [['09:00', '09:30', 'ADMIN CHECKS', 'Race Control']];
    const sessions = applyTimetableMapping(
      withPlace,
      map([
        [0, TimetableField.Start],
        [1, TimetableField.End],
        [2, TimetableField.Title],
        [3, TimetableField.Location],
      ]),
    );
    expect(sessions[0]!.title).toBe('ADMIN CHECKS — Race Control');
  });

  it('takes a row with a start and no end', () => {
    // A document printing only start times is common. The honest result is no
    // duration rather than an invented end.
    const startOnly = [['08:15', 'MEDICAL INSPECTION LAPS']];
    const sessions = applyTimetableMapping(
      startOnly,
      map([
        [0, TimetableField.Start],
        [1, TimetableField.Title],
      ]),
    );
    expect(sessions[0]!.start).toBe('08:15');
    expect(sessions[0]!.durationMinutes).toBe(0);
  });

  it('treats a wrapped end as running past midnight', () => {
    const night = [['22:00', '02:00', 'NIGHT PRACTICE']];
    expect(applyTimetableMapping(night, standard)[0]!.durationMinutes).toBe(240);
  });

  it('skips a row with no start time', () => {
    const withHeader = [['Start', 'End', 'Session'], ...grid];
    expect(applyTimetableMapping(withHeader, standard)).toHaveLength(2);
  });

  it('skips a row with no title, since nobody can act on it', () => {
    const nameless = [['09:00', '09:30', '']];
    expect(applyTimetableMapping(nameless, standard)).toEqual([]);
  });

  it('produces nothing until something is mapped', () => {
    expect(applyTimetableMapping(grid, emptyTimetableMapping)).toEqual([]);
  });

  it('separates paperwork from track activity', () => {
    const admin = [['08:30', '13:00', 'FIA WEC ADMINISTRATIVE CHECKS']];
    expect(applyTimetableMapping(admin, standard)[0]!.onTrack).toBe(false);
    expect(applyTimetableMapping(grid, standard)[0]!.onTrack).toBe(true);
  });
});

describe('isTimetableUsable / describeTimetableMapping', () => {
  const grid = [['09:00', '09:30', 'PRACTICE']];

  it('needs the start time, not the car number', () => {
    expect(isTimetableUsable(emptyTimetableMapping)).toBe(false);
    expect(isTimetableUsable(map([[0, TimetableField.Start]]))).toBe(true);
  });

  it('asks for the start column first', () => {
    expect(describeTimetableMapping(grid, emptyTimetableMapping)).toBe(
      'Choose which column is the start time.',
    );
  });

  it('counts what it would read', () => {
    expect(describeTimetableMapping(grid, standard)).toBe('1 session.');
  });

  it('points at the title when a start is mapped but nothing comes out', () => {
    // The likeliest half-finished state, and the one where "0 sessions" alone
    // would be baffling.
    expect(describeTimetableMapping(grid, map([[0, TimetableField.Start]]))).toBe(
      'No sessions yet — check the title column too.',
    );
  });
});

describe('the layout the parser cannot read', () => {
  /**
   * Times in one column, spanning two lines per session — a shape none of the
   * three sample documents use, and one `parseTimetableLines` produces nothing
   * from because no single line carries two times.
   */
  const twoLine = [
    ['09:00', 'FIA WEC FREE PRACTICE 1'],
    ['09:30', ''],
    ['11:00', 'FIA WEC FREE PRACTICE 2'],
    ['12:30', ''],
  ];

  it('produces nothing through the parser', () => {
    const lines = twoLine.map((c) => c.join(' ').trim());
    expect(parseTimetableLines(lines).sessions).toEqual([]);
  });

  it('reads correctly once a person says what is what', () => {
    const mapping: TimetableMapping = {
      rowsPerEntry: 2,
      assignments: [
        { row: 0, column: 0, field: TimetableField.Start },
        { row: 0, column: 1, field: TimetableField.Title },
        { row: 1, column: 0, field: TimetableField.End },
      ],
      excluded: [],
    };

    const sessions = applyTimetableMapping(twoLine, mapping);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      start: '09:00',
      end: '09:30',
      title: 'FIA WEC FREE PRACTICE 1',
      durationMinutes: 30,
    });
    expect(sessions[1]!.start).toBe('11:00');
  });
});
