/**
 * The parser against the five real documents it has to survive, not the
 * hand-written shapes in entryList.test.ts.
 *
 * `entry-lists/*.txt` is verbatim `pdfjs` output — captured through the same
 * pipeline the app uses, kept for the reason `bundle-from-device.json` is
 * kept: a hand-built fixture agrees with its author by construction, a
 * capture disagrees freely. Re-capture rather than edit.
 *
 * ── What these assertions are ─────────────────────────────────────────────
 * Mostly a spec now. The fabrications this file used to record have been
 * fixed, and the counts below are the correct ones — two of them checkable
 * against the documents' own printed totals, which is as close to an external
 * oracle as this gets.
 *
 * Two known bugs remain, each asserted deliberately so a fix has something to
 * flip. Both say so, and both name the job in HANDOFF-entry-lists.md. If one
 * of those tests fails because the result got *better*, that is the fix
 * landing — update the test, do not revert the parser.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseEntryList } from './entryList';

const fixture = (name: string) =>
  parseEntryList(readFileSync(`${__dirname}/entry-lists/${name}`, 'utf8'));

describe('WEC Spa 2026 — the clean case', () => {
  const r = fixture('wec-spa-2026.txt');

  it('reads all 35 cars and reports nothing unreadable', () => {
    expect(r.entries).toHaveLength(35);
    expect(r.skipped).toEqual([]);
  });

  it('gives every car a team, a class and at least two drivers', () => {
    for (const e of r.entries) {
      expect(e.team, e.source).not.toBeNull();
      expect(e.className, e.source).not.toBeNull();
      expect(e.drivers.length, e.source).toBeGreaterThanOrEqual(2);
    }
  });

  it('splits the nat-code row correctly', () => {
    expect(r.entries[0]).toMatchObject({
      number: '007',
      className: 'HYPERCAR',
      team: 'ASTON MARTIN THOR TEAM',
      drivers: ['Harry TINCKNELL', 'Tom GAMBLE'],
    });
  });

  it('keeps the leading zero that makes 007 a different car from 7', () => {
    const numbers = r.entries.map((e) => e.number);
    expect(numbers).toContain('007');
    expect(numbers).toContain('7');
  });

  it('invents no cars — every number appears once', () => {
    // A repeated number is the signature of page furniture being read as a
    // car, which is how all four fabrication bugs presented.
    expect(new Set(r.entries.map((e) => e.number)).size).toBe(r.entries.length);
  });
});

describe('ELMS Spa 2026', () => {
  const r = fixture('elms-spa-2026.txt');

  it('reads 47 cars and no longer takes the subtitle for one of them', () => {
    // "4 HOURS OF SPA-FRANCORCHAMPS - ENTRY LIST - V1" used to parse as car 4.
    // A count of 48 here means that guard has regressed.
    expect(r.entries).toHaveLength(47);
    expect(r.entries.some((e) => /HOURS OF/.test(e.source))).toBe(false);
    expect(r.skipped).toEqual([]);
  });

  it('gives every car a team, a class and at least two drivers', () => {
    for (const e of r.entries) {
      expect(e.team, e.source).not.toBeNull();
      expect(e.className, e.source).not.toBeNull();
      expect(e.drivers.length, e.source).toBeGreaterThanOrEqual(2);
    }
  });

  it('reads the first car rather than the document title', () => {
    expect(r.entries[0]).toMatchObject({
      number: '9',
      className: 'LMP2',
      team: 'PROTON COMPETITION',
    });
  });
});

describe('NLS6 2026 — number and class only, by design', () => {
  const r = fixture('nls6-2026.txt');

  it('reads exactly the 110 cars the document says it has', () => {
    // "Teilnehmer: 110" is printed in the file itself, so this count is
    // checkable against the document rather than against the parser's own
    // opinion. It used to read 120: the running page header
    // "1. ADAC Eifel Trophy (…)" was parsed as car 1 once per page.
    expect(r.entries).toHaveLength(110);
    expect(r.entries.some((e) => /ADAC Eifel Trophy/.test(e.source))).toBe(false);
    expect(r.skipped).toEqual([]);
  });

  it('never guesses at team or drivers — the columns cannot support it', () => {
    // Deliberate, per entryList.ts: entrant, town, licence and car are all
    // plain words once the spacing is gone, so team is left null rather than
    // storing the blob. Not a bug; see job #4.
    expect(r.entries.every((e) => e.team === null)).toBe(true);
    expect(r.entries.every((e) => e.drivers.length === 0)).toBe(true);
  });

  it('reads the class off the section banner above each car', () => {
    const car5 = r.entries.find((e) => e.source.startsWith('5 B BLACK FALCON'));
    expect(car5?.className).toBe('SP9');
  });

  it('gives every car a class', () => {
    for (const e of r.entries) expect(e.className, e.source).not.toBeNull();
  });
});

describe('HTC2 Spa', () => {
  const r = fixture('htc2-spa.txt');

  it('reads 19 rows and reports the two bare row pairs as unreadable', () => {
    expect(r.entries).toHaveLength(19);
    expect(r.skipped).toEqual(['2 6', '7 14']);
  });

  it('no longer reads the "23 voitures / cars" count line as a car', () => {
    expect(r.entries.some((e) => /voitures/.test(e.source))).toBe(false);
    expect(r.entries.some((e) => e.drivers.includes('voitures'))).toBe(false);
  });

  it('KNOWN BUG — takes the row index, not the car number', () => {
    // `3 7 David HART …` is car 7 on row 3. Once the column positions are
    // gone the two integers are indistinguishable, so the parser reports the
    // first and leaves every other field null rather than committing to a
    // confident wrong answer for those too. Job #3 in HANDOFF-entry-lists.md.
    // When that is fixed this expects '7'.
    const row = r.entries.find((e) => e.source.startsWith('3 7 David HART'));
    expect(row).toMatchObject({
      number: '3',
      team: null,
      className: null,
      drivers: [],
    });
  });

  it('leaves every row number-only rather than storing an unsegmented blob', () => {
    for (const e of r.entries) {
      expect(e.team, e.source).toBeNull();
      expect(e.className, e.source).toBeNull();
      expect(e.drivers, e.source).toEqual([]);
    }
  });
});

describe('Spa Six Hours 2025 — three pages of furniture, now rejected', () => {
  const r = fixture('spa-six-hours-2025.txt');

  it('reads 28 cars and none of the page furniture', () => {
    expect(r.entries).toHaveLength(28);
    expect(r.skipped).toEqual([]);
  });

  it('rejects all three fabrications this document used to produce', () => {
    // Each repeated once per page, and each a different shape of wrong: a
    // date range, a section header, and a closing total.
    const sources = r.entries.map((e) => e.source);
    expect(sources.some((s) => s.startsWith('25 TO 27 SEPTEMBER'))).toBe(false);
    expect(sources.some((s) => /HISTORIC GRAND PRIX CARS/.test(s))).toBe(false);
    expect(sources.some((s) => /CARS IN THE ENTRY LIST/.test(s))).toBe(false);
    expect(r.entries.filter((e) => e.number === '25')).toHaveLength(0);
    expect(r.entries.filter((e) => e.number === '35')).toHaveLength(0);
  });

  it('keeps the one genuine car 3 and no copies of it', () => {
    const three = r.entries.filter((e) => e.number === '3');
    expect(three).toHaveLength(1);
    expect(three[0]!.source).toMatch(/^# 3 COOPER/);
  });

  it('KNOWN BUG — silently drops cars whose number sits alone on its line', () => {
    // "# 4" on a line by itself, with the car and driver on the two lines
    // after it, matches BARE_NUMBER — and bare numbers are only kept when
    // *nothing else* was found in the whole document (the "stripped
    // copy-paste of just numbers" case). Because this document also yields
    // richer entries, these seven are discarded with no trace: not in
    // `entries`, not in `skipped`.
    //
    // Worse than the HTC2 bug above, which at least reports a wrong number
    // rather than nothing at all, and the strongest argument for the
    // multi-line association work in job #3. When it is fixed these seven
    // should appear — as entries if their following lines can be associated,
    // or in `skipped` if not. Either is an improvement; vanishing is not.
    const dropped = ['4', '12', '26', '43', '62', '75', '153'];
    for (const n of dropped) {
      expect(r.entries.some((e) => e.number === n), n).toBe(false);
    }
  });
});
