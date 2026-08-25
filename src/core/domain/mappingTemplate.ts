/**
 * A saved answer to "what is what" in one series' entry list.
 *
 * Mapping a document once is a chore. Mapping the *same series* every round is
 * a reason to stop using the app — WEC publishes the same layout for a season,
 * and re-tapping it at every circuit would make the feature cost more than the
 * typing it replaced. A template is that chore paid once.
 *
 * ── Matched on shape, never on the filename ───────────────────────────────
 * Publishers rename files constantly and keep their layout for years:
 * `2026-fia-wec-…-provisional-entry-list-v1-69ef5bcc….pdf` will be a different
 * string next round and the same document. What is stable is the *structure* —
 * how many columns, roughly where, and what shape the rows are. So a template
 * remembers that, and `mappingTemplate.ts`'s matcher compares against it.
 *
 * ── Never applied silently ────────────────────────────────────────────────
 * A template that has gone stale because the publisher changed their layout
 * produces confident nonsense: plausible-looking cars assembled from the wrong
 * columns. That is the single failure this whole design exists to avoid, so a
 * match is a *suggestion* — the mapper opens with it filled in and the live
 * preview showing what it reads, and a person still presses the button.
 */
import type { EntityBase, Utc } from './common';
import { newEntityBase } from './common';
import { type MappingTemplateId, newId } from './ids';

/**
 * What a template compares itself against.
 *
 * Deliberately coarse. Exact column positions drift between revisions of the
 * same template — a publisher nudges a margin and every x moves two points —
 * so pinning them would make templates expire for no reason. Column *count*
 * plus the ordered row shapes is stable across that and still specific enough
 * that the NLS list never matches the WEC one.
 */
export interface DocumentShape {
  readonly columns: number;
  /**
   * The distinct row signatures the document contains, sorted.
   *
   * Sorted because page order is not a property of the layout: the same
   * document with its sections in a different order is still the same shape.
   */
  readonly signatures: readonly string[];
}

export interface MappingTemplate extends EntityBase {
  readonly id: MappingTemplateId;
  /** What the user calls it — "WEC entry list", "NLS Teilnehmerliste". */
  readonly name: string;
  readonly shape: DocumentShape;
  /** The mapping itself, stored as JSON so the domain does not depend on logic. */
  readonly mapping: string;
  /** When it last read a document, for showing the useful ones first. */
  readonly lastUsedAt: Utc | null;
}

export function newMappingTemplate(input: {
  name: string;
  shape: DocumentShape;
  mapping: string;
  at?: Utc;
}): MappingTemplate {
  return {
    id: newId<MappingTemplateId>(),
    name: input.name.trim() === '' ? 'Untitled layout' : input.name.trim(),
    shape: input.shape,
    mapping: input.mapping,
    lastUsedAt: null,
    ...newEntityBase(input.at),
  };
}

/** Stamp a template as used, so the list can put the working ones first. */
export function markUsed(
  template: MappingTemplate,
  at: Utc,
): MappingTemplate {
  return { ...template, lastUsedAt: at, updatedAt: at };
}
