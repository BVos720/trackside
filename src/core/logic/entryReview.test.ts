/**
 * The review step, which is where the parser stops being the last word.
 *
 * These tests carry more weight than usual: this repo has no component tests,
 * and nothing here has ever run on a phone, so the pure logic behind the
 * screen is the only part that can be checked at all. The cases below are the
 * ones that decide whether a weekend's entry list is right — a ticked row that
 * silently does not get written, a field cleared and coming back, drivers
 * mangled on the way out.
 */
import { describe, expect, it } from 'vitest';

import { parseEntryList, type TextEntry } from './entryList';
import {
  blankRow,
  describeReview,
  isReady,
  readyRows,
  rowFromEntry,
  rowFromSkipped,
  rowsFromParse,
  splitDriverField,
  toEntry,
  type ReviewRow,
} from './entryReview';

const anEntry = (over: Partial<TextEntry> = {}): TextEntry => ({
  number: '7',
  className: 'Hypercar',
  team: 'Toyota Gazoo Racing',
  drivers: ['Conway', 'Kobayashi', 'Lopez'],
  source: '7 Toyota Gazoo Racing Hypercar Conway/Kobayashi/Lopez',
  ...over,
});

const keys = () => {
  let n = 0;
  return () => `k${n++}`;
};

describe('rowFromEntry', () => {
  it('carries every field across', () => {
    const row = rowFromEntry(anEntry(), 'k0');
    expect(row).toMatchObject({
      key: 'k0',
      number: '7',
      className: 'Hypercar',
      team: 'Toyota Gazoo Racing',
      drivers: 'Conway / Kobayashi / Lopez',
      include: true,
    });
  });

  it('turns the domain nulls into empty boxes', () => {
    // A text input has no null, and an empty box is what "not stated" looks
    // like to the person typing.
    const row = rowFromEntry(anEntry({ className: null, team: null, drivers: [] }), 'k0');
    expect(row.className).toBe('');
    expect(row.team).toBe('');
    expect(row.drivers).toBe('');
  });
});

describe('rowFromSkipped', () => {
  it('keeps the line and starts excluded', () => {
    // Excluded until it has a number: an empty row added to the field is
    // worse than the unreadable line it came from.
    const row = rowFromSkipped('2 6', 'k0');
    expect(row.source).toBe('2 6');
    expect(row.number).toBe('');
    expect(row.include).toBe(false);
  });
});

describe('rowsFromParse', () => {
  it('puts entries and unreadable lines in one list', () => {
    // One list, not two sections — a count at the foot of the screen is
    // something you have to go hunting for, and hunting is what gets skipped.
    const parse = {
      entries: [anEntry({ number: '7' }), anEntry({ number: '8' })],
      skipped: ['2 6'],
    };
    const rows = rowsFromParse(parse, keys());

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.number)).toEqual(['7', '8', '']);
    expect(rows.map((r) => r.key)).toEqual(['k0', 'k1', 'k2']);
  });

  it('gives every row its own key', () => {
    const parse = { entries: [anEntry(), anEntry(), anEntry()], skipped: ['a b c'] };
    const rows = rowsFromParse(parse, keys());
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe('isReady / readyRows', () => {
  it('needs both a tick and a number', () => {
    const base = blankRow('k0');
    expect(isReady(base)).toBe(false);
    expect(isReady({ ...base, number: '7' })).toBe(true);
    expect(isReady({ ...base, number: '7', include: false })).toBe(false);
  });

  it('does not count whitespace as a number', () => {
    expect(isReady({ ...blankRow('k0'), number: '   ' })).toBe(false);
  });

  it('keeps document order', () => {
    const rows: ReviewRow[] = [
      { ...blankRow('a'), number: '51' },
      { ...blankRow('b'), number: '7', include: false },
      { ...blankRow('c'), number: '8' },
    ];
    expect(readyRows(rows).map((r) => r.number)).toEqual(['51', '8']);
  });
});

describe('splitDriverField', () => {
  it('splits on slashes and trims', () => {
    expect(splitDriverField('Conway / Kobayashi / Lopez')).toEqual([
      'Conway',
      'Kobayashi',
      'Lopez',
    ]);
  });

  it('keeps a multi-word name whole', () => {
    expect(splitDriverField('Pier Guidi / Calado')).toEqual(['Pier Guidi', 'Calado']);
  });

  it('drops empty segments rather than producing blank drivers', () => {
    // Mid-edit text: someone has typed a slash and not the next name yet.
    expect(splitDriverField('Conway //  / Kobayashi')).toEqual(['Conway', 'Kobayashi']);
    expect(splitDriverField('   ')).toEqual([]);
  });
});

describe('toEntry', () => {
  it('round-trips an untouched row', () => {
    const entry = anEntry();
    expect(toEntry(rowFromEntry(entry, 'k0'))).toEqual(entry);
  });

  it('turns a cleared box back into null, not an empty string', () => {
    // The domain distinguishes "no class" from "a class that is blank"; the
    // editor does not, so this boundary is where the distinction is restored.
    const row = { ...rowFromEntry(anEntry(), 'k0'), className: '', team: '   ' };
    const entry = toEntry(row);
    expect(entry.className).toBeNull();
    expect(entry.team).toBeNull();
  });

  it('trims a number typed with a stray space', () => {
    expect(toEntry({ ...blankRow('k0'), number: ' 7 ' }).number).toBe('7');
  });

  it('keeps the source line through an edit', () => {
    // The source is what lets a later reader tell a mis-parse from a typo in
    // the document, so correcting a field must not erase where it came from.
    const row = { ...rowFromEntry(anEntry(), 'k0'), team: 'Corrected' };
    expect(toEntry(row).source).toBe(anEntry().source);
  });

  it('leaves a hand-typed row with no source', () => {
    expect(toEntry({ ...blankRow('k0'), number: '99' }).source).toBe('');
  });
});

describe('describeReview', () => {
  it('counts what Add would write', () => {
    const rows = [
      { ...blankRow('a'), number: '7' },
      { ...blankRow('b'), number: '8' },
    ];
    expect(describeReview(rows)).toBe('2 entries.');
  });

  it('gets the singular right', () => {
    expect(describeReview([{ ...blankRow('a'), number: '7' }])).toBe('1 entry.');
  });

  it('names ticked rows that still have no number', () => {
    // The one failure here that would look like the feature losing data: a
    // row you ticked, that Add then skips without saying so.
    const rows = [
      { ...blankRow('a'), number: '7' },
      { ...blankRow('b'), include: true },
    ];
    expect(describeReview(rows)).toBe('1 entry, 1 still needs a number.');
  });

  it('does not nag about unticked blanks', () => {
    // An unreadable line you have chosen to leave alone is not a problem.
    const rows = [
      { ...blankRow('a'), number: '7' },
      rowFromSkipped('2 6', 'b'),
    ];
    expect(describeReview(rows)).toBe('1 entry.');
  });
});

describe('the review over a real document', () => {
  /**
   * HTC2, which the parser reads wrong: `3 7 David HART …` is car 7 on row 3,
   * and the row index wins. The point of the review is that this is now one
   * field to retype rather than a defect to ship around.
   */
  it('lets the HTC2 row-index bug be corrected by hand', () => {
    const parse = parseEntryList('3 7 David HART Olivier HART BMW M3 E30 1992 Group A2');
    const rows = rowsFromParse(parse, keys());

    expect(rows[0]!.number).toBe('3'); // wrong, as parsed
    const corrected = { ...rows[0]!, number: '7', team: 'David HART / Olivier HART' };

    expect(toEntry(corrected)).toMatchObject({ number: '7' });
    expect(readyRows([corrected])).toHaveLength(1);
  });

  it('lets a car the parser never saw be added', () => {
    // The seven Spa Six Hours cars whose number sits alone on a line are not
    // in `entries` and not in `skipped`. Adding one by hand is the whole fix.
    const added = { ...blankRow('new'), number: '4', team: 'Historic GP' };
    expect(isReady(added)).toBe(true);
    expect(toEntry(added).number).toBe('4');
  });

  it('turns a WEC paste into a review with nothing to correct', () => {
    const parse = parseEntryList(
      '007 ASTON MARTIN THOR TEAM USA M Aston Martin Valkyrie Harry TINCKNELL (GBR) P Tom GAMBLE (GBR) G -',
    );
    const rows = rowsFromParse(parse, keys());

    expect(rows).toHaveLength(1);
    expect(readyRows(rows)).toHaveLength(1);
    expect(toEntry(rows[0]!)).toMatchObject({
      number: '007',
      team: 'ASTON MARTIN THOR TEAM',
      drivers: ['Harry TINCKNELL', 'Tom GAMBLE'],
    });
  });
});
