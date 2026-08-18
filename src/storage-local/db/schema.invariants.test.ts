// Bare specifiers rather than the `node:` prefix: Expo's tsconfig.base sets
// `customConditions: ["react-native"]`, under which `node:`-prefixed builtins
// fail to resolve even with @types/node installed. Vitest runs this file in
// Node regardless, so the bare form is both correct and type-resolvable.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Guards on the generated migration SQL — spec §0.1.
 *
 * These assert against the emitted `.sql`, not against the Drizzle schema
 * source, because what actually reaches the device is the SQL. A schema change
 * that looks harmless in TypeScript but generates an integer primary key, or
 * drops a tombstone column, fails here.
 *
 * The failures these prevent share a shape: invisible for months, then
 * unrecoverable. By the time an integer primary key is noticed, records
 * carrying colliding ids exist on devices that may not have synced since.
 * There is no migration back from that — hence a test rather than a code
 * review convention.
 */
const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');

function migrationSql(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((file) => ({
      file,
      sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8'),
    }));
}

/** Table name → body, for each CREATE TABLE in the file. */
function createTableBodies(sql: string): Map<string, string> {
  const tables = new Map<string, string>();
  const pattern = /CREATE TABLE\s+`?(\w+)`?\s*\(([\s\S]*?)\n\);/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    tables.set(match[1]!, match[2]!);
  }
  return tables;
}

describe('migration SQL invariants', () => {
  const migrations = migrationSql();

  it('creates the schema somewhere across the migration set', () => {
    const all = migrations.map((m) => m.sql).join('\n');
    expect(all, 'no CREATE TABLE in any migration').toMatch(/CREATE TABLE/i);
  });

  it('has at least one generated migration checked in', () => {
    // Spec §7 wants schema history from the start. An empty drizzle/ directory
    // means someone changed the schema without regenerating.
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('never uses AUTOINCREMENT', () => {
    for (const { file, sql } of migrations) {
      expect(sql.toUpperCase(), `${file} uses AUTOINCREMENT`).not.toContain(
        'AUTOINCREMENT',
      );
    }
  });

  it('declares every primary key as text, never integer', () => {
    // The single constraint from §0.1 that cannot be walked back. An integer
    // primary key makes two offline devices mint colliding ids.
    for (const { file, sql } of migrations) {
      const primaryKeyLines = sql
        .split('\n')
        .filter((line) => /PRIMARY KEY/i.test(line));

      // Only CREATE TABLE migrations declare primary keys. An ALTER TABLE
      // migration adding a column has none, and demanding one there would fail
      // every future migration for no reason. The "schema exists somewhere"
      // check above is what catches an empty drizzle/ directory.
      if (/CREATE TABLE/i.test(sql)) {
        expect(
          primaryKeyLines.length,
          `${file} creates tables but declares no primary keys`,
        ).toBeGreaterThan(0);
      }

      for (const line of primaryKeyLines) {
        expect(line, `${file}: non-text primary key → ${line.trim()}`).toMatch(
          /`?\w+`?\s+text\s+PRIMARY KEY/i,
        );
      }
    }
  });

  it('gives every table the four lifecycle columns', () => {
    // created_at / updated_at / deleted_at / sync_state on every row from the
    // first migration (spec §2.3). Adding them later is a migration against
    // data already spread across devices.
    const required = ['created_at', 'updated_at', 'deleted_at', 'sync_state'];

    for (const { file, sql } of migrations) {
      for (const [table, body] of createTableBodies(sql)) {
        for (const column of required) {
          expect(body, `${file}: ${table} is missing ${column}`).toContain(
            `\`${column}\``,
          );
        }
      }
    }
  });

  it('leaves deleted_at nullable so it can act as a tombstone', () => {
    for (const { file, sql } of migrations) {
      for (const [table, body] of createTableBodies(sql)) {
        const line = body
          .split('\n')
          .find((l) => l.includes('`deleted_at`'));
        expect(line, `${file}: ${table} has no deleted_at`).toBeDefined();
        expect(
          line!,
          `${file}: ${table}.deleted_at is NOT NULL and cannot tombstone`,
        ).not.toMatch(/NOT NULL/i);
      }
    }
  });

  it('declares no SQL default for access_classification', () => {
    // Spec §0.1 and §9.1: a column default would classify a spot's physical
    // safety without a human ever deciding — precisely the silent
    // auto-assignment the spec forbids.
    for (const { file, sql } of migrations) {
      const line = sql
        .split('\n')
        .find((l) => l.includes('`access_classification`'));
      if (line === undefined) continue;
      expect(
        line,
        `${file}: access_classification must not carry a SQL default`,
      ).not.toMatch(/DEFAULT/i);
    }
  });
});
