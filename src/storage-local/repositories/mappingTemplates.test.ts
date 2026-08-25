/**
 * Saved import layouts, through the store.
 *
 * The ordering is the part worth a test rather than a read: the list is a
 * shortcut, not a catalogue, so "the one I used last round" has to come first
 * or the shortcut is longer than mapping by hand.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../kv', () => {
  const store = new Map<string, string>();
  return {
    kv: {
      async get(key: string) {
        await Promise.resolve();
        return store.get(key) ?? null;
      },
      async set(key: string, value: string) {
        await Promise.resolve();
        store.set(key, value);
      },
      async remove(key: string) {
        store.delete(key);
      },
      __store: store,
    },
  };
});

import { newMappingTemplate } from '../../core/domain/mappingTemplate';
import { mappingTemplates } from './documentRepositories';
import { kv } from '../kv';

beforeEach(() => {
  (kv as unknown as { __store: Map<string, string> }).__store.clear();
});

const aTemplate = (name: string, columns = 4) =>
  newMappingTemplate({
    name,
    shape: { columns, signatures: ['n,t,t,t'] },
    mapping: '{"rowsPerEntry":1,"assignments":[],"excluded":[]}',
  });

describe('saving a layout', () => {
  it('stores and reads it back', async () => {
    const t = aTemplate('WEC entry list');
    await mappingTemplates.save(t);

    const saved = await mappingTemplates.get(t.id);
    expect(saved?.name).toBe('WEC entry list');
    expect(saved?.shape.columns).toBe(4);
  });

  it('names an untitled layout rather than storing a blank', async () => {
    const t = newMappingTemplate({
      name: '   ',
      shape: { columns: 2, signatures: [] },
      mapping: '{}',
    });
    expect(t.name).toBe('Untitled layout');
  });

  it('starts never used', async () => {
    const t = aTemplate('WEC');
    await mappingTemplates.save(t);
    expect((await mappingTemplates.get(t.id))!.lastUsedAt).toBeNull();
  });
});

describe('ordering', () => {
  it('puts the most recently used first', async () => {
    const older = aTemplate('older');
    const newer = aTemplate('newer');
    await mappingTemplates.save(older);
    await mappingTemplates.save(newer);

    await mappingTemplates.touch(older.id, '2026-01-01T00:00:00.000Z');
    await mappingTemplates.touch(newer.id, '2026-08-01T00:00:00.000Z');

    expect((await mappingTemplates.listAll()).map((t) => t.name)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('sorts a never-used layout last, not first', async () => {
    // A layout that has not read a document yet is the least likely answer,
    // and an empty `lastUsedAt` sorting to the top would bury the one that
    // works behind every experiment.
    const used = aTemplate('used');
    const fresh = aTemplate('fresh');
    await mappingTemplates.save(used);
    await mappingTemplates.save(fresh);
    await mappingTemplates.touch(used.id, '2026-08-01T00:00:00.000Z');

    expect((await mappingTemplates.listAll())[0]!.name).toBe('used');
  });
});

describe('touch', () => {
  it('stamps the moment it was used', async () => {
    const t = aTemplate('WEC');
    await mappingTemplates.save(t);

    await mappingTemplates.touch(t.id, '2026-08-19T09:30:00.000Z');

    const saved = (await mappingTemplates.get(t.id))!;
    expect(saved.lastUsedAt).toBe('2026-08-19T09:30:00.000Z');
    expect(saved.updatedAt).toBe('2026-08-19T09:30:00.000Z');
  });

  it('does not lose a touch to a save landing at the same moment', async () => {
    // An import touches the template it used while the same screen is writing
    // whatever else it produced.
    const a = aTemplate('a');
    const b = aTemplate('b');
    await mappingTemplates.save(a);

    await Promise.all([
      mappingTemplates.touch(a.id, '2026-08-19T09:30:00.000Z'),
      mappingTemplates.save(b),
    ]);

    expect(await mappingTemplates.listAll()).toHaveLength(2);
    expect((await mappingTemplates.get(a.id))!.lastUsedAt).not.toBeNull();
  });

  it('ignores a touch for a layout that is not there', async () => {
    const gone = aTemplate('gone');
    await expect(mappingTemplates.touch(gone.id)).resolves.toBeUndefined();
  });
});

describe('deleting', () => {
  it('tombstones rather than removing', async () => {
    const t = aTemplate('WEC');
    await mappingTemplates.save(t);

    await mappingTemplates.softDelete(t.id, '2026-08-19T09:30:00.000Z');

    expect(await mappingTemplates.listAll()).toEqual([]);
    // §0.1: the row stays, or it reappears from any device that still has it.
    expect((await mappingTemplates.get(t.id))!.deletedAt).toBe(
      '2026-08-19T09:30:00.000Z',
    );
  });
});
