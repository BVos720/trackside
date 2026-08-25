/**
 * Recognising a document a saved template already fits.
 *
 * The economics of the whole mapping feature turn on this: the first WEC
 * weekend costs a few taps, and every round after should cost a glance. But a
 * template that has gone stale — the publisher moved a column between rounds —
 * produces plausible-looking cars assembled from the wrong cells, which is the
 * one failure the design exists to avoid.
 *
 * So this reports a *confidence*, never a decision. The caller opens the mapper
 * with the match filled in and the live preview showing what it reads; the
 * person still presses the button. A wrong suggestion costs one tap to
 * override. A wrong silent application costs a weekend's entry list.
 */
import type { DocumentShape, MappingTemplate } from '../domain/mappingTemplate';
import { rowSignature, type ColumnMapping } from './columnMapping';

/**
 * The shape of a grid, for storing on a template or comparing against one.
 *
 * Column count plus the *set* of row signatures. Exact positions are left out
 * deliberately: a publisher nudging a margin moves every x by a point or two,
 * and a template that expired for that would be worse than none.
 */
export function shapeOf(grid: readonly string[][]): DocumentShape {
  const signatures = [...new Set(grid.map((cells) => rowSignature(cells)))].sort();
  return {
    columns: Math.max(0, ...grid.map((r) => r.length)),
    signatures,
  };
}

export interface TemplateMatch {
  readonly template: MappingTemplate;
  /** 0 to 1. See `matchTemplates` for what the number means. */
  readonly confidence: number;
}

/**
 * How well a shape matches a template's.
 *
 * Column count must agree exactly — a document with a different number of
 * columns is a different document, and a mapping written against ten columns
 * cannot mean anything against eleven.
 *
 * Beyond that it is the overlap of row signatures, weighted towards the
 * template: a document containing *extra* shapes the template never saw is
 * usually the same layout with a new section, and should still match. A
 * document *missing* shapes the template relies on is the dangerous direction,
 * and is what drags the score down.
 */
export function scoreShape(shape: DocumentShape, against: DocumentShape): number {
  if (shape.columns !== against.columns) return 0;
  if (against.signatures.length === 0) return 0;

  const present = new Set(shape.signatures);
  const found = against.signatures.filter((s) => present.has(s)).length;
  return found / against.signatures.length;
}

/**
 * Templates that might fit this document, best first.
 *
 * Anything below `minimum` is not offered at all. A weak match is worse than
 * no match: it puts a filled-in mapping in front of someone who then has to
 * notice it is wrong, rather than an empty one they know they must fill.
 */
export function matchTemplates(
  grid: readonly string[][],
  templates: readonly MappingTemplate[],
  minimum = 0.6,
): TemplateMatch[] {
  const shape = shapeOf(grid);
  return templates
    .map((template) => ({
      template,
      confidence: scoreShape(shape, template.shape),
    }))
    .filter((m) => m.confidence >= minimum)
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      // Same confidence: the one used most recently is the likelier answer.
      return (b.template.lastUsedAt ?? '').localeCompare(a.template.lastUsedAt ?? '');
    });
}

/** Serialise a mapping for storage on a template. */
export function encodeMapping(mapping: ColumnMapping): string {
  return JSON.stringify(mapping);
}

/**
 * Read a stored mapping back.
 *
 * Returns null rather than throwing on anything unrecognisable. A template
 * written by an older build, or corrupted, must not take the import screen
 * down — the user can always map by hand, which is the whole fallback the
 * feature is built on.
 */
export function decodeMapping(encoded: string): ColumnMapping | null {
  try {
    const parsed: unknown = JSON.parse(encoded);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const m = parsed as Partial<ColumnMapping>;
    if (!Array.isArray(m.assignments)) return null;
    return {
      rowsPerEntry:
        typeof m.rowsPerEntry === 'number' && m.rowsPerEntry >= 1
          ? Math.trunc(m.rowsPerEntry)
          : 1,
      assignments: m.assignments.filter(
        (a): a is ColumnMapping['assignments'][number] =>
          typeof a === 'object' &&
          a !== null &&
          typeof (a as { row?: unknown }).row === 'number' &&
          typeof (a as { column?: unknown }).column === 'number' &&
          typeof (a as { field?: unknown }).field === 'string',
      ),
      excluded: Array.isArray(m.excluded)
        ? m.excluded.filter((s): s is string => typeof s === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

/** One line for the suggestion banner. */
export function describeMatch(match: TemplateMatch): string {
  const pct = Math.round(match.confidence * 100);
  return pct === 100
    ? `Looks like “${match.template.name}”.`
    : `Looks like “${match.template.name}” (${pct}% match) — check it read this one right.`;
}
