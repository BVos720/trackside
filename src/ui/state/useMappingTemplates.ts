/**
 * Saved import layouts for the mapper.
 *
 * Mirrors useEntries.ts. Not scoped to an event, unlike most state here: a
 * layout is a fact about a *series*, not about a weekend — the WEC list is laid
 * out the same at Spa and at Le Mans, which is the entire reason to save one.
 */
import { useCallback, useEffect, useState } from 'react';

import type { MappingTemplateId } from '../../core/domain/ids';
import {
  newMappingTemplate,
  type MappingTemplate,
} from '../../core/domain/mappingTemplate';
import type { ColumnMapping } from '../../core/logic/columnMapping';
import { encodeMapping, shapeOf } from '../../core/logic/templateMatch';
import { mappingTemplates as repo } from '../../storage-local/repositories/documentRepositories';

export function useMappingTemplates() {
  const [templates, setTemplates] = useState<MappingTemplate[]>([]);

  const reload = useCallback(async () => {
    setTemplates(await repo.listAll());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Save the mapping the user has just built, against the shape of the
   * document it was built on.
   *
   * The shape comes from the grid rather than from the mapping, because what
   * makes two documents "the same layout" is how they are laid out, not which
   * columns somebody happened to assign.
   */
  const save = useCallback(
    async (name: string, grid: readonly string[][], mapping: ColumnMapping) => {
      await repo.save(
        newMappingTemplate({
          name,
          shape: shapeOf(grid),
          mapping: encodeMapping(mapping),
        }),
      );
      await reload();
    },
    [reload],
  );

  /** Stamp one as used, so the list keeps the working ones near the top. */
  const touch = useCallback(
    async (id: MappingTemplateId) => {
      await repo.touch(id);
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: MappingTemplateId) => {
      await repo.softDelete(id);
      await reload();
    },
    [reload],
  );

  return { templates, save, touch, remove, reload };
}
