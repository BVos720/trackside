/**
 * Template matching, and the real question it answers: would a mapping saved
 * at Spa still read the same series' list at the Nürburgring?
 *
 * The WEC and ELMS fixtures are the honest test of that. They are published by
 * the same organisation in the same layout, so a template made from one should
 * fit the other — and a template made from either must *not* fit the NLS list,
 * which is where a silent misapplication would do real damage.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import { newMappingTemplate, type MappingTemplate } from '../domain/mappingTemplate';
import { findColumns, type PositionedRow } from './pdfColumns';
import { EntryField, emptyMapping, gridOf, type ColumnMapping } from './columnMapping';
import {
  decodeMapping,
  describeMatch,
  encodeMapping,
  matchTemplates,
  scoreShape,
  shapeOf,
} from './templateMatch';

const gridFor = (name: string) => {
  const rs: PositionedRow[] = JSON.parse(
    readFileSync(`${__dirname}/entry-lists/${name}.rows.json`, 'utf8'),
  );
  return gridOf(rs, findColumns(rs));
};

const templateFrom = (name: string, grid: string[][]): MappingTemplate =>
  newMappingTemplate({
    name,
    shape: shapeOf(grid),
    mapping: encodeMapping({
      ...emptyMapping,
      assignments: [{ row: 0, column: 0, field: EntryField.Number }],
    }),
  });

describe('shapeOf', () => {
  it('records the column count and the distinct row shapes', () => {
    const shape = shapeOf([
      ['7', 'Toyota'],
      ['8', 'Ferrari'],
      ['HEADER', ''],
    ]);
    expect(shape.columns).toBe(2);
    expect(shape.signatures).toEqual(['n,t', 't,0']);
  });

  it('does not care how often a shape occurs, or in what order', () => {
    // Page order is not a property of the layout: the same document with its
    // sections rearranged is the same document.
    const a = shapeOf([['7', 'a'], ['HEADER', ''], ['8', 'b']]);
    const b = shapeOf([['HEADER', ''], ['9', 'c']]);
    expect(a.signatures).toEqual(b.signatures);
  });
});

describe('scoreShape', () => {
  const base = shapeOf([['7', 'a'], ['HEADER', '']]);

  it('is a perfect match against itself', () => {
    expect(scoreShape(base, base)).toBe(1);
  });

  it('refuses outright when the column count differs', () => {
    // A mapping written against two columns cannot mean anything against
    // three, however similar the rows look.
    const wider = shapeOf([['7', 'a', 'b'], ['HEADER', '', '']]);
    expect(scoreShape(wider, base)).toBe(0);
  });

  it('still matches a document that has gained a section', () => {
    // The forgiving direction: extra shapes the template never saw are
    // usually the same layout with something new in it.
    const withExtra = shapeOf([['7', 'a'], ['HEADER', ''], ['', 'note']]);
    expect(scoreShape(withExtra, base)).toBe(1);
  });

  it('drops when the document is missing what the template relies on', () => {
    // The dangerous direction, and the one the score is built to catch.
    const missing = shapeOf([['7', 'a']]);
    expect(scoreShape(missing, base)).toBe(0.5);
  });
});

describe('matchTemplates', () => {
  const grid = [['7', 'a'], ['HEADER', '']];
  const fitting = templateFrom('fits', grid);

  it('offers a template that fits', () => {
    expect(matchTemplates(grid, [fitting])).toHaveLength(1);
  });

  it('offers nothing when nothing is close enough', () => {
    // A weak match is worse than none: it puts a filled-in mapping in front of
    // someone who then has to notice it is wrong, instead of an empty one they
    // know they have to fill.
    const other = templateFrom('other', [['7', 'a', 'b'], ['x', 'y', 'z']]);
    expect(matchTemplates(grid, [other])).toEqual([]);
  });

  it('puts the best match first', () => {
    const partial = templateFrom('partial', [['7', 'a'], ['H', ''], ['', 'x']]);
    const matches = matchTemplates(grid, [partial, fitting]);
    expect(matches[0]!.template.name).toBe('fits');
  });

  it('breaks a tie with the one used most recently', () => {
    const older: MappingTemplate = { ...fitting, name: 'older', lastUsedAt: '2026-01-01T00:00:00.000Z' as never };
    const newer: MappingTemplate = { ...fitting, name: 'newer', lastUsedAt: '2026-08-01T00:00:00.000Z' as never };
    expect(matchTemplates(grid, [older, newer])[0]!.template.name).toBe('newer');
  });

  it('offers nothing when there are no templates', () => {
    expect(matchTemplates(grid, [])).toEqual([]);
  });
});

describe('encode / decodeMapping', () => {
  const mapping: ColumnMapping = {
    rowsPerEntry: 3,
    assignments: [
      { row: 0, column: 0, field: EntryField.Number },
      { row: 2, column: 1, field: EntryField.Drivers },
    ],
    excluded: ['t,0,0'],
  };

  it('round-trips', () => {
    expect(decodeMapping(encodeMapping(mapping))).toEqual(mapping);
  });

  it('returns null for anything unreadable rather than throwing', () => {
    // A template from an older build must not take the import screen down —
    // mapping by hand is the fallback the whole feature rests on.
    expect(decodeMapping('not json')).toBeNull();
    expect(decodeMapping('null')).toBeNull();
    expect(decodeMapping('{"nope":1}')).toBeNull();
  });

  it('drops malformed assignments instead of trusting them', () => {
    const decoded = decodeMapping(
      '{"rowsPerEntry":1,"assignments":[{"row":0,"column":0,"field":"number"},{"row":"x"}],"excluded":[]}',
    );
    expect(decoded!.assignments).toHaveLength(1);
  });

  it('defaults a missing or nonsensical stride to 1', () => {
    const decoded = decodeMapping('{"rowsPerEntry":0,"assignments":[],"excluded":[]}');
    expect(decoded!.rowsPerEntry).toBe(1);
  });
});

describe('describeMatch', () => {
  const t = templateFrom('WEC entry list', [['7', 'a']]);

  it('says so plainly at a perfect match', () => {
    expect(describeMatch({ template: t, confidence: 1 })).toBe(
      'Looks like “WEC entry list”.',
    );
  });

  it('asks for a check at anything less', () => {
    // Never applied silently: a stale template produces plausible cars from
    // the wrong cells, which is the failure this design exists to avoid.
    expect(describeMatch({ template: t, confidence: 0.8 })).toContain(
      'check it read this one right',
    );
  });
});

describe('across the real documents', () => {
  const wec = gridFor('wec-spa-2026');
  const elms = gridFor('elms-spa-2026');
  const nls = gridFor('nls6-2026');

  it('a template made from WEC fits the ELMS list', () => {
    // The point of templates: same organisation, same layout, different
    // round. Map it once at Spa, and the next one costs a glance.
    const template = templateFrom('WEC/ELMS entry list', wec);
    const matches = matchTemplates(elms, [template]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.confidence).toBeGreaterThan(0.6);
  });

  it('and does not fit the NLS list', () => {
    // The direction that matters. Applying a WEC mapping to a German club
    // entry list would produce a screen full of plausible nonsense.
    const template = templateFrom('WEC/ELMS entry list', wec);
    expect(matchTemplates(nls, [template])).toEqual([]);
  });

  it('an NLS template does not fit WEC either', () => {
    const template = templateFrom('NLS Teilnehmerliste', nls);
    expect(matchTemplates(wec, [template])).toEqual([]);
  });
});
