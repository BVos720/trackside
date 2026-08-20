import { describe, expect, it } from 'vitest';

import {
  describeEntryParse,
  isClassHeading,
  looksLikeClass,
  looksLikeDrivers,
  looksLikePersonName,
  parseEntryList,
  parseEntryLines,
  splitFields,
} from './entryList';

/**
 * The shapes entry lists actually arrive in.
 *
 * Written the way each series publishes them — bullet-separated on a web page,
 * column-aligned out of a PDF, class-grouped with the class as a heading. The
 * variation between them is the reason the parser identifies fields by their
 * shape instead of their position, so the fixtures have to keep disagreeing
 * with each other or the tests stop checking anything.
 */
const BULLETS = [
  '#7 · Toyota Gazoo Racing · Hypercar · Conway/Kobayashi/Lopez',
  '#8 · Toyota Gazoo Racing · Hypercar · Buemi/Hartley/Hirakawa',
  '#51 · Ferrari AF Corse · Hypercar · Pier Guidi/Calado/Giovinazzi',
];

const COLUMNS = [
  'No.   Team                  Class      Drivers',
  '7     Toyota Gazoo Racing   Hypercar   Conway/Kobayashi/Lopez',
  '35    Alpine Endurance      Hypercar   Milesi/Gounon/Chatin',
  '54    Vista AF Corse        LMGT3      Castellacci/Rigon/Manzi',
];

const CLASS_GROUPED = [
  '2026 SPA ENTRY LIST',
  'HYPERCAR',
  '7    Toyota Gazoo Racing    M. Conway    K. Kobayashi    J.M. Lopez',
  '8    Toyota Gazoo Racing    S. Buemi     B. Hartley     R. Hirakawa',
  'LMGT3 (12 cars)',
  '54   Vista AF Corse         T. Flohr     F. Castellacci  D. Rigon',
];

describe('looksLikeClass', () => {
  it('knows the classes these series publish', () => {
    for (const c of ['Hypercar', 'LMP2', 'LMGT3', 'GT3', 'SP9', 'Cup2', 'TCR']) {
      expect(looksLikeClass(c), c).toBe(true);
    }
  });

  it('accepts a class with its Pro/Am qualifier', () => {
    expect(looksLikeClass('SP9 Pro')).toBe(true);
    expect(looksLikeClass('GT3 Pro-Am')).toBe(true);
  });

  it('does not read a team name as a class', () => {
    // "Pro" and "Am" are real classes, which is exactly what makes a prefix
    // match dangerous here.
    expect(looksLikeClass('Pro Racing GmbH')).toBe(false);
    expect(looksLikeClass('Toyota Gazoo Racing')).toBe(false);
    expect(looksLikeClass('AM Motorsport Ltd')).toBe(false);
  });
});

describe('looksLikeDrivers', () => {
  it('reads a slash-separated crew', () => {
    expect(looksLikeDrivers('Conway/Kobayashi/Lopez')).toBe(true);
    expect(looksLikeDrivers('Pier Guidi/Calado/Giovinazzi')).toBe(true);
  });

  it('reads an ampersand between two people', () => {
    expect(looksLikeDrivers('Conway & Kobayashi')).toBe(true);
  });

  it('does not split a team name on its ampersand', () => {
    // Biased on purpose: a crew read as a team is visible and fixable, a team
    // split into two drivers loses the entrant and looks plausible doing it.
    expect(looksLikeDrivers('Rowe Racing & Partners')).toBe(false);
    expect(looksLikeDrivers('Walkenhorst Motorsport & Co')).toBe(false);
  });

  it('does not treat one name as a crew', () => {
    expect(looksLikeDrivers('Mike Conway')).toBe(false);
  });
});

describe('looksLikePersonName', () => {
  it('accepts initials and full names', () => {
    expect(looksLikePersonName('M. Conway')).toBe(true);
    expect(looksLikePersonName('J.M. Lopez')).toBe(true);
    expect(looksLikePersonName('José María López')).toBe(true);
  });

  it('rejects anything with a number in it', () => {
    expect(looksLikePersonName('Team 75')).toBe(false);
  });

  it('rejects a single word', () => {
    expect(looksLikePersonName('Conway')).toBe(false);
  });
});

describe('splitFields', () => {
  it('splits on bullets', () => {
    expect(splitFields('· Toyota Gazoo Racing · Hypercar')).toEqual([
      'Toyota Gazoo Racing',
      'Hypercar',
    ]);
  });

  it('splits on column gaps but not on single spaces', () => {
    expect(splitFields('Toyota Gazoo Racing   Hypercar')).toEqual([
      'Toyota Gazoo Racing',
      'Hypercar',
    ]);
  });

  it('keeps a lone comma inside its field', () => {
    // "Kobayashi, Kamui" is one name written backwards, not two fields.
    expect(splitFields('Kobayashi, Kamui')).toEqual(['Kobayashi, Kamui']);
  });

  it('splits on commas once there are several', () => {
    expect(splitFields('Toyota Gazoo Racing, Hypercar, Conway/Kobayashi')).toEqual([
      'Toyota Gazoo Racing',
      'Hypercar',
      'Conway/Kobayashi',
    ]);
  });
});

describe('isClassHeading', () => {
  it('recognises a class on a line of its own', () => {
    expect(isClassHeading('HYPERCAR')).toBe(true);
    expect(isClassHeading('LMGT3 (12 cars)')).toBe(true);
    expect(isClassHeading('LMP2:')).toBe(true);
  });

  it('does not treat a car in that class as a heading', () => {
    expect(isClassHeading('7 Toyota Gazoo Racing Hypercar')).toBe(false);
  });

  it('does not treat the document title as a heading', () => {
    expect(isClassHeading('2026 SPA ENTRY LIST')).toBe(false);
  });
});

describe('parseEntryList — bullet-separated', () => {
  const r = parseEntryLines(BULLETS);

  it('reads every car', () => {
    expect(r.entries).toHaveLength(3);
    expect(r.entries.map((e) => e.number)).toEqual(['7', '8', '51']);
  });

  it('separates team, class and drivers regardless of order', () => {
    const e = r.entries[0]!;
    expect(e.team).toBe('Toyota Gazoo Racing');
    expect(e.className).toBe('Hypercar');
    expect(e.drivers).toEqual(['Conway', 'Kobayashi', 'Lopez']);
  });

  it('keeps a multi-word driver name whole', () => {
    expect(r.entries[2]!.drivers).toEqual([
      'Pier Guidi',
      'Calado',
      'Giovinazzi',
    ]);
  });

  it('keeps the source line for the confirmation step', () => {
    expect(r.entries[0]!.source).toBe(BULLETS[0]);
  });

  it('reports nothing as unreadable', () => {
    expect(r.skipped).toEqual([]);
  });
});

describe('parseEntryList — column layout', () => {
  const r = parseEntryLines(COLUMNS);

  it('reads the cars and not the header row', () => {
    expect(r.entries.map((e) => e.number)).toEqual(['7', '35', '54']);
  });

  it('does not report the header row as unreadable', () => {
    // It is furniture, not a car that lost its number. Reporting it would put
    // a line in front of the user on every single paste.
    expect(r.skipped).toEqual([]);
  });

  it('assigns the columns by shape', () => {
    const gt3 = r.entries.find((e) => e.number === '54')!;
    expect(gt3.team).toBe('Vista AF Corse');
    expect(gt3.className).toBe('LMGT3');
    expect(gt3.drivers).toEqual(['Castellacci', 'Rigon', 'Manzi']);
  });
});

describe('parseEntryList — class as a heading', () => {
  const r = parseEntryLines(CLASS_GROUPED);

  it('carries the heading down onto its cars', () => {
    // Verbatim, including the publisher's capitals. Normalising to "Hypercar"
    // would be the parser overruling the document it is reading, and class
    // names genuinely differ in case — LMGT3, SP9 Pro, Cup2.
    expect(r.entries.map((e) => e.className)).toEqual([
      'HYPERCAR',
      'HYPERCAR',
      'LMGT3',
    ]);
  });

  it('strips the car count from the heading', () => {
    expect(r.entries[2]!.className).toBe('LMGT3');
  });

  it('reads one driver per column', () => {
    expect(r.entries[0]!.drivers).toEqual(['M. Conway', 'K. Kobayashi', 'J.M. Lopez']);
    expect(r.entries[0]!.team).toBe('Toyota Gazoo Racing');
  });

  it('does not read the document title as a car', () => {
    // "2026" would be car 202 under a looser number rule, with the rest of the
    // title as its team.
    expect(r.entries.some((e) => e.number.startsWith('202'))).toBe(false);
  });
});

describe('parseEntryList — what it refuses to do', () => {
  it('keeps a leading zero, because 07 and 7 are different cars', () => {
    const r = parseEntryList('07  Rowe Racing\n7  Toyota Gazoo Racing');
    expect(r.entries.map((e) => e.number)).toEqual(['07', '7']);
  });

  it('reads a number with a letter suffix', () => {
    const r = parseEntryList('24A  Walkenhorst Motorsport');
    expect(r.entries[0]!.number).toBe('24A');
  });

  it('takes a car with nothing but a number', () => {
    const r = parseEntryList('7\n8');
    expect(r.entries.map((e) => e.number)).toEqual(['7', '8']);
    expect(r.entries[0]!.team).toBeNull();
  });

  it('does not turn a pasted timetable into an entry list', () => {
    // The wrong half of the programme is an ordinary thing to paste, and the
    // honest outcome is nothing rather than 40 cars named after sessions.
    const r = parseEntryList(
      '09:00 FIA WEC FREE PRACTICE 1\n11:00 12:30 FIA WEC FREE PRACTICE 2',
    );
    expect(r.entries).toEqual([]);
  });

  it('leaves a field null rather than guessing at it', () => {
    const r = parseEntryList('7  Toyota Gazoo Racing');
    expect(r.entries[0]!.team).toBe('Toyota Gazoo Racing');
    expect(r.entries[0]!.className).toBeNull();
    expect(r.entries[0]!.drivers).toEqual([]);
  });

  it('keeps a lone name-shaped field as the team, not a driver', () => {
    // Every single-column list would otherwise come out with no teams and one
    // invented driver each.
    const r = parseEntryList('7  Mike Conway');
    expect(r.entries[0]!.team).toBe('Mike Conway');
    expect(r.entries[0]!.drivers).toEqual([]);
  });

  it('reports a row that lost its number instead of dropping it', () => {
    const r = parseEntryLines([
      '7     Toyota Gazoo Racing   Hypercar   Conway/Kobayashi/Lopez',
      '      Porsche Penske        Hypercar   Estre/Vanthoor/Christensen',
    ]);
    expect(r.entries).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toContain('Porsche Penske');
  });

  it('does not report prose as an unreadable entry', () => {
    const r = parseEntryList(
      'Entry list subject to change until scrutineering closes.',
    );
    expect(r.entries).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it('finds nothing in an empty paste', () => {
    expect(parseEntryList('')).toEqual({ entries: [], skipped: [] });
    expect(parseEntryList('\n  \n\n')).toEqual({ entries: [], skipped: [] });
  });

  it('is deterministic — the same text twice gives the same result', () => {
    const text = [...BULLETS, ...CLASS_GROUPED].join('\n');
    expect(parseEntryList(text)).toEqual(parseEntryList(text));
  });
});

describe('describeEntryParse', () => {
  it('counts what it found', () => {
    expect(describeEntryParse(parseEntryLines(BULLETS))).toBe('3 entries.');
  });

  it('gets the singular right', () => {
    expect(describeEntryParse(parseEntryList('7 Toyota Gazoo Racing'))).toBe(
      '1 entry.',
    );
  });

  it('says so when it found nothing', () => {
    // The case most in need of stating: the alternative is a confirmation
    // screen that looks like it worked and commits nothing.
    expect(describeEntryParse(parseEntryList('nothing here'))).toBe(
      'No entries found.',
    );
  });

  it('names the lines needing manual entry', () => {
    const r = parseEntryLines([
      '7   Toyota Gazoo Racing   Hypercar   Conway/Kobayashi/Lopez',
      '    Porsche Penske        Hypercar   Estre/Vanthoor/Christensen',
    ]);
    expect(describeEntryParse(r)).toBe('1 entry, 1 line to enter by hand.');
  });
});
