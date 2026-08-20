/**
 * The parser against the five real documents it has to survive, not the
 * hand-written shapes above.
 *
 * `entry-lists/*.txt` is verbatim `pdfjs` output — captured through the same
 * pipeline the app uses, kept for the reason `bundle-from-device.json` is
 * kept: a hand-built fixture agrees with its author by construction, a
 * capture disagrees freely. Re-capture rather than edit.
 *
 * This file pins current behaviour, warts included — it is job #1 of
 * HANDOFF-entry-lists.md, not a spec of what the parser should do. Several
 * assertions below exist only to record a known bug so a fix has something to
 * flip; each says so.
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
});

describe('ELMS Spa 2026 — one fabricated entry', () => {
  const r = fixture('elms-spa-2026.txt');

  it('reads 48 entries, the first of them not a car', () => {
    // "4 HOURS OF SPA-FRANCORCHAMPS - ENTRY LIST - V1" is the document's own
    // subtitle, not a competitor. Job #2 in HANDOFF-entry-lists.md.
    expect(r.entries).toHaveLength(48);
    expect(r.entries[0]).toMatchObject({
      number: '4',
      className: null,
      team: null,
      drivers: [],
    });
  });

  it('gives every real car a team, a class and at least two drivers', () => {
    for (const e of r.entries.slice(1)) {
      expect(e.team, e.source).not.toBeNull();
      expect(e.className, e.source).not.toBeNull();
      expect(e.drivers.length, e.source).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('NLS6 2026 — team and drivers withheld, the header line repeats', () => {
  const r = fixture('nls6-2026.txt');

  it('reads 120 entries and reports nothing unreadable', () => {
    expect(r.entries).toHaveLength(120);
    expect(r.skipped).toEqual([]);
  });

  it('never guesses at team or drivers — the columns cannot support it', () => {
    // Deliberate, per entryList.ts: entrant, town, licence and car are all
    // plain words once the spacing is gone, so team is left null rather than
    // storing the blob. See job #4.
    expect(r.entries.every((e) => e.team === null)).toBe(true);
    expect(r.entries.every((e) => e.drivers.length === 0)).toBe(true);
  });

  it('reads the class off the section banner above each car', () => {
    const car5 = r.entries.find((e) => e.source.startsWith('5 B BLACK FALCON'));
    expect(car5?.className).toBe('SP9');
  });

  it('rereads the page header as car "1" once per page — the document says 110, not 120', () => {
    // "1. ADAC Eifel Trophy (19.06.2026 - 20.06.2026)" is the running header,
    // repeated at the top of every page. The first occurrence, before any
    // class banner has been seen, has no class; the other nine land under
    // whatever class was current when that page broke. 120 parsed - 10
    // fabricated "1"s = 110, matching "Teilnehmer: 110" in the document. Not
    // diagnosed further than this — job #4.
    const ones = r.entries.filter((e) => e.number === '1');
    expect(ones).toHaveLength(10);
    expect(ones.filter((e) => e.className === null)).toHaveLength(1);
    expect(r.entries.length - ones.length).toBe(110);
  });
});

describe('HTC2 Spa — the row-index-as-car-number bug', () => {
  const r = fixture('htc2-spa.txt');

  it('reads 20 entries and reports the two bare row pairs as unreadable', () => {
    expect(r.entries).toHaveLength(20);
    expect(r.skipped).toEqual(['2 6', '7 14']);
  });

  it('reads the "23 voitures / cars" count line as a fabricated car with two "drivers"', () => {
    // Job #2: a bare number followed by prose is read as a car with the
    // prose as team or drivers, whichever field shape it happens to match.
    expect(r.entries[0]).toMatchObject({
      number: '23',
      className: null,
      team: null,
      drivers: ['voitures', 'cars'],
      source: '23 voitures / cars',
    });
  });

  it('takes the row index, not the true car number, once the columns are gone', () => {
    // `3 7 David HART …` is car 7, row 3 — see job #3 in the handoff. The
    // parser cannot tell the two numbers apart any more, so it reports the
    // first (wrong) one with every other field left null rather than a
    // confident wrong answer for those fields too.
    const row = r.entries.find((e) => e.source.startsWith('3 7 David HART'));
    expect(row).toMatchObject({ number: '3', team: null, className: null, drivers: [] });
  });

  it('leaves every other real row number-only', () => {
    for (const e of r.entries.slice(1)) {
      expect(e.team, e.source).toBeNull();
      expect(e.className, e.source).toBeNull();
      expect(e.drivers, e.source).toEqual([]);
    }
  });
});

describe('Spa Six Hours 2025 — three-page document furniture and silent drops', () => {
  const r = fixture('spa-six-hours-2025.txt');

  it('reads 35 entries and reports nothing unreadable', () => {
    // Coincidence, not correctness: the real list also holds 35 cars per its
    // own footer, but these are not the same 35 — see below.
    expect(r.entries).toHaveLength(35);
    expect(r.skipped).toEqual([]);
  });

  it('reads the repeated date line as a fabricated car once per page', () => {
    // "25 TO 27 SEPTEMBER 2025" is the event's dates, not a car, and the
    // three-page document repeats it at the top of every page. Job #2.
    const dateLine = r.entries.filter((e) => e.number === '25');
    expect(dateLine).toHaveLength(3);
    for (const e of dateLine) {
      expect(e).toMatchObject({ team: 'TO 27 SEPTEMBER 2025', className: null, drivers: [] });
    }
  });

  it('also reads the repeated section header as car "3", on top of the real car 3', () => {
    // "#3. HISTORIC GRAND PRIX CARS ASSOCIATION" repeats with the date line
    // and matches CAR_NUMBER the same way — a fabrication not yet named in
    // HANDOFF-entry-lists.md job #2, sitting right beside the one it does
    // name. One of the four is the genuine "# 3 COOPER T51 …" row.
    const three = r.entries.filter((e) => e.number === '3');
    expect(three).toHaveLength(4);
    expect(three.filter((e) => e.source.startsWith('# 3 COOPER'))).toHaveLength(1);
    expect(
      three.filter((e) => e.source === '#3. HISTORIC GRAND PRIX CARS ASSOCIATION'),
    ).toHaveLength(3);
  });

  it('reads the closing car count as car "35"', () => {
    // "35 CARS IN THE ENTRY LIST" is the footer, not car 35 — this document
    // has no car 35. A fourth fabrication kind, distinct from the two above.
    const last = r.entries.at(-1)!;
    expect(last).toMatchObject({ number: '35', team: null, source: '35 CARS IN THE ENTRY LIST' });
  });

  it('silently drops cars whose number sits alone on its own line', () => {
    // "# 4" on a line by itself, with the car and driver on the two lines
    // after it, matches BARE_NUMBER — but bare numbers are only kept when
    // *nothing else* was found in the whole document (the "stripped
    // copy-paste of just numbers" case). Because this document also yields
    // 35 richer entries, these seven are discarded rather than skipped or
    // reported: not a documented job in the handoff, and worse than job #3's
    // wrong-number bug, because there is no trace of them at all.
    const dropped = ['4', '12', '26', '43', '62', '75', '153'];
    for (const n of dropped) {
      expect(r.entries.some((e) => e.number === n), n).toBe(false);
    }
  });
});
