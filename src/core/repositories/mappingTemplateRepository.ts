/**
 * Saved import layouts — spec §2.3.
 *
 * Async throughout, caller-supplied ids, tombstones only (§0.1). Same rules as
 * every other repository here; see spotRepository.ts for why each one exists.
 */
import type { MappingTemplate } from '../domain/mappingTemplate';
import type { MappingTemplateId } from '../domain/ids';

export interface IMappingTemplateRepository {
  /**
   * Every saved layout, most recently used first.
   *
   * Ordered that way rather than alphabetically because the list is a
   * shortcut, not a catalogue: the layout you used at the last round is
   * overwhelmingly the one you want at this one.
   */
  listAll(): Promise<MappingTemplate[]>;
  get(id: MappingTemplateId): Promise<MappingTemplate | null>;
  save(template: MappingTemplate): Promise<void>;
  /** Stamp it as used, so the ordering above stays true. */
  touch(id: MappingTemplateId, at?: string): Promise<void>;
  softDelete(id: MappingTemplateId, at?: string): Promise<void>;
}
