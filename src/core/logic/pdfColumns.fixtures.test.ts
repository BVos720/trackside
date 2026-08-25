/**
 * Column detection against the five real documents, positions intact.
 *
 * `entry-lists/*.rows.json` is captured from the same pdfjs pass the app runs,
 * *before* the whitespace collapse that the `.txt` siblings were taken after.
 * That is the whole point: the `.txt` files are what the parser has to work
 * with today and the reason it cannot read two of these documents at all.
 * Re-capture rather than edit.
 *
 * ── What this pins ────────────────────────────────────────────────────────
 * Not "columns are found", but *which* — including the two documents where the
 * answer is partial or nothing. A change that starts inventing a grid over the
 * Spa Six Hours list would pass a looser test and be a regression, because the
 * honest empty answer is what sends the user to the editable review instead of
 * to a confidently wrong table.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import { findColumns, splitRowByColumns, type PositionedRow } from './pdfColumns';

const rows = (name: string): PositionedRow[] =>
  JSON.parse(readFileSync(`${__dirname}/entry-lists/${name}.rows.json`, 'utf8'));

const carRows = (all: PositionedRow[], columns: ReturnType<typeof findColumns>) =>
  all
    .map((r) => splitRowByColumns(r, columns))
    .filter((cells) => /^\d/.test(cells[0] ?? ''));

describe('WEC Spa 2026 — a clean table', () => {
  const all = rows('wec-spa-2026');
  const columns = findColumns(all);

  it('finds the eleven columns the document is laid out in', () => {
    expect(columns).toHaveLength(11);
  });

  it('separates every field, drivers included', () => {
    const cars = carRows(all, columns);
    expect(cars).toHaveLength(35);
    expect(cars[0]!.slice(0, 5)).toEqual([
      '007',
      'ASTON MARTIN THOR TEAM',
      'USA',
      'M',
      'Aston Martin Valkyrie',
    ]);
  });

  it('puts each driver in a column of its own', () => {
    // Better than the string parser manages. Reading the collapsed line, the
    // first driver's name has no left boundary — the car model runs straight
    // into it — so `Jens Reno MØLLER` comes out as `Reno MØLLER`. With columns
    // there is nothing to guess.
    const toyota = carRows(all, columns).find((c) => c[0] === '7')!;
    expect(toyota[5]).toBe('Mike CONWAY (GBR)');
    expect(toyota[7]).toBe('Kamui KOBAYASHI (JPN)');
    expect(toyota[9]).toBe('Nyck DE VRIES (NED)');
  });
});

describe('ELMS Spa 2026 — the same publisher, the same shape', () => {
  const all = rows('elms-spa-2026');
  const columns = findColumns(all);

  it('finds eleven columns and forty-seven cars', () => {
    expect(columns).toHaveLength(11);
    expect(carRows(all, columns)).toHaveLength(47);
  });

  it('reads the first car whole', () => {
    expect(carRows(all, columns)[0]!.slice(0, 5)).toEqual([
      '9',
      'PROTON COMPETITION',
      'GER',
      'G',
      'Oreca 07 - Gibson',
    ]);
  });
});

describe('NLS6 2026 — the columns the string parser gave up on', () => {
  const all = rows('nls6-2026');
  const columns = findColumns(all);

  it('finds five columns', () => {
    expect(columns).toHaveLength(5);
  });

  it('recovers the team and town the parser had to leave null', () => {
    // `entryList.ts` deliberately withholds NLS teams: entrant, town, licence
    // and car are all plain words once the spacing is gone, so
    // `BLACK FALCON Team EAE Meuspath` is not a team name and offering it as
    // one would be a guess wearing a fact's clothes. The positions settle it.
    const falcon = all
      .map((r) => splitRowByColumns(r, columns))
      .find((c) => c[2]?.startsWith('BLACK FALCON'))!;

    expect(falcon[0]).toBe('5');
    expect(falcon[1]).toBe('B');
    expect(falcon[2]).toBe('BLACK FALCON Team EAE');
    expect(falcon[3]).toBe('Meuspath');
  });

  it('leaves the running page header sitting alone in the first column', () => {
    // "1. ADAC Eifel Trophy (…)" repeats at the top of all ten pages and is
    // what made the string parser read 120 cars where the document says 110.
    // As a row it is unmistakable: one cell filled, the rest empty — which is
    // the signal the row-exclusion control in TASKS-pdf-mapping M5 will use.
    const header = all
      .map((r) => splitRowByColumns(r, columns))
      .find((c) => c[0]?.startsWith('1. ADAC Eifel Trophy'))!;

    expect(header.slice(1).every((cell) => cell === '')).toBe(true);
  });
});

describe('HTC2 Spa — partial, and the part that works is the bug', () => {
  const all = rows('htc2-spa');
  const columns = findColumns(all);

  it('finds only two columns', () => {
    // This document does not align its later columns across rows, so they
    // collapse into the last band. Recorded rather than papered over.
    expect(columns).toHaveLength(2);
  });

  it('still separates the row index from the car number', () => {
    // Which is exactly the bug `entryList.fixtures.test.ts` records as KNOWN
    // BUG: reading the collapsed line, `3 7 David HART …` yields car 3, and
    // the car is 7. Two columns is all it takes to settle it.
    const row = all
      .map((c) => splitRowByColumns(c, columns))
      .find((c) => c[1]?.startsWith('7 David HART'))!;

    expect(row[0]).toBe('3');
    expect(row[1]).toMatch(/^7 David HART/);
  });
});

describe('Spa Six Hours 2025 — no columns, said plainly', () => {
  const all = rows('spa-six-hours-2025');

  it('finds none rather than inventing a grid', () => {
    // Multi-line records with no consistent bands. An empty answer is the
    // supported outcome: it routes the user to the editable review, where the
    // seven cars this document loses can be typed in, instead of to a table
    // that looks authoritative and is wrong.
    expect(findColumns(all)).toEqual([]);
  });

  it('has rows to work with, so the empty answer is a judgement not a blank', () => {
    // Guards against the fixture silently emptying and making the assertion
    // above pass for the wrong reason.
    expect(all.length).toBeGreaterThan(50);
    expect(all.some((r) => r.tokens.length > 0)).toBe(true);
  });
});
