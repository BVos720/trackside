/**
 * Key/value port — the narrow seam the local repositories sit on.
 *
 * ── Why this exists rather than repositories talking to SQLite directly ────
 * Spec §2.3 wants the local store written "as though it were already remote",
 * with `core/` knowing nothing about storage. This port is what lets a single
 * repository implementation serve both targets while that stays true: the
 * device uses expo-sqlite, the web preview uses localStorage, and neither is
 * visible above `storage-local/`.
 *
 * It is deliberately a document store for now. The Drizzle schema and its
 * migration already exist (drizzle/0000_init.sql) and remain the destination
 * for the device implementation; moving to it changes this directory only,
 * because the UI depends on the `core/` interfaces rather than on rows.
 */
export interface IKeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /**
   * Delete every key.
   *
   * Not a domain operation and not reachable from normal use — see
   * `resetApp.ts`, which is the only caller. Deliberately not built out of
   * `remove` in a loop: this store has no way to enumerate its keys, and
   * giving it one would invite code that walks the store instead of asking
   * a repository.
   */
  clear(): Promise<void>;
}

/**
 * Native implementation, backed by expo-sqlite.
 *
 * Metro resolves `kv.web.ts` ahead of this file for the web target, so this
 * module is only ever evaluated on device — which matters, because importing
 * expo-sqlite on web pulls in a WASM build that needs its own setup.
 */
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'trackside.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const handle = await SQLite.openDatabaseAsync(DB_NAME);
    await handle.execAsync(
      `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`,
    );
    return handle;
  })();
  return dbPromise;
}

export const kv: IKeyValueStore = {
  async get(key) {
    const handle = await db();
    const row = await handle.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv WHERE key = ?',
      key,
    );
    return row?.value ?? null;
  },
  async set(key, value) {
    const handle = await db();
    await handle.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  },
  async remove(key) {
    // Removing a KV bucket is not a domain delete — entity deletion is always a
    // tombstone (spec §0.1). This exists for cache-style keys only.
    const handle = await db();
    await handle.runAsync('DELETE FROM kv WHERE key = ?', key);
  },
  async clear() {
    const handle = await db();
    await handle.runAsync('DELETE FROM kv');
  },
};
