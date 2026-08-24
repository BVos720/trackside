// Bare specifiers rather than the `node:` prefix, for the reason given at the
// top of storage-local/db/schema.invariants.test.ts: Expo's tsconfig.base sets
// `customConditions: ["react-native"]`, under which `node:`-prefixed builtins
// fail to resolve.
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * `core/` may not import from `ui/` or `storage-local/` — spec §2.3.
 *
 * The architecture already holds. This is what stops it drifting, and the
 * drift is the kind nobody notices in review: one `import { color } from
 * '../../ui/theme'` for a convenience constant, and `core/` is no longer
 * portable, no longer testable under plain Node, and no longer the thing the
 * eventual sync target can be built against.
 *
 * ── Why a test and not an ESLint rule ─────────────────────────────────────
 * TASKS.md A3 asked for `no-restricted-imports` in an ESLint config. This does
 * the same job with no new toolchain: nothing in this repo lints today, so
 * adding ESLint means either a rule nobody runs, or a new command every agent
 * and every CI step has to remember. `npx vitest run` is already mandatory
 * before committing and is already green, so a boundary asserted here is a
 * boundary that actually gets checked. Adding the full lint setup is still a
 * reasonable thing to want — it buys unused-variable and hook-dependency
 * checks this cannot — but it is a separate decision from enforcing §2.3.
 *
 * Scanning text rather than resolving a module graph is deliberate: it needs
 * no bundler, no dependency, and it cannot be defeated by a re-export chain,
 * because the offending specifier still has to appear literally in the file.
 */
const CORE = join(process.cwd(), 'src', 'core');

/**
 * Every `.ts`/`.tsx` under `core/`, tests included — except this file.
 *
 * This one is excluded because it deliberately contains the offending
 * specifiers as fixtures, in the two cases below that check the guard can
 * still see a violation. Scanning itself, it reports itself. The exclusion is
 * by exact filename rather than a pattern, so it cannot quietly grow to cover
 * a file that is genuinely breaking the rule.
 */
const SELF = 'layers.invariants.test.ts';

function coreFiles(dir = CORE): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...coreFiles(full));
    else if (/\.tsx?$/.test(entry.name) && entry.name !== SELF) out.push(full);
  }
  return out;
}

/**
 * Import and re-export specifiers in a file.
 *
 * Covers `import … from 'x'`, `export … from 'x'`, bare `import 'x'` and
 * dynamic `import('x')` — a boundary that only checked static imports would be
 * one `await import()` away from being decorative.
 */
function specifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s[^;]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const p of patterns) {
    for (const m of source.matchAll(p)) out.push(m[1]!);
  }
  return out;
}

/** True when a specifier reaches into a layer `core/` may not know about. */
function crossesBoundary(spec: string): boolean {
  // Relative paths that climb out of core/ into a sibling layer.
  if (/(^|\/)\.\.\/(ui|storage-local)\//.test(spec)) return true;
  if (/^\.\.\/\.\.\/(ui|storage-local)(\/|$)/.test(spec)) return true;
  // The tsconfig path aliases, which climb out just as effectively.
  if (/^@(ui|storage-local)\//.test(spec)) return true;
  return false;
}

describe('core/ imports nothing from ui/ or storage-local/ (§2.3)', () => {
  const files = coreFiles();

  it('finds the core layer to scan', () => {
    // A rename that empties this list would make every assertion below pass
    // vacuously, which is the one way a guard like this fails silently.
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no file reaching into another layer', () => {
    const offences: string[] = [];

    for (const file of files) {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        if (crossesBoundary(spec)) {
          offences.push(`${relative(process.cwd(), file)} → ${spec}`);
        }
      }
    }

    // Listed rather than counted, so a failure names the import to delete.
    expect(offences).toEqual([]);
  });

  it('recognises the shapes it is meant to catch', () => {
    // The guard's own guard. A regex that quietly stopped matching would make
    // the test above pass forever, and this is cheaper than finding that out
    // during a sync migration.
    for (const bad of [
      '../../ui/theme',
      '../ui/theme',
      '../../storage-local/kv',
      '@ui/theme',
      '@storage-local/kv',
    ]) {
      expect(crossesBoundary(bad), bad).toBe(true);
    }

    for (const fine of [
      './spot',
      '../domain/ids',
      '../../core/logic/sun',
      'suncalc',
      'uuid',
      // Names that merely contain a layer word must not trip it.
      './uiHelpers',
      '../domain/storage-localish',
    ]) {
      expect(crossesBoundary(fine), fine).toBe(false);
    }
  });

  it('sees dynamic and re-exported imports, not just static ones', () => {
    const source = `
      import { a } from '../../ui/theme';
      export { b } from '../../storage-local/kv';
      const c = await import('@ui/theme');
      const d = require('../../ui/other');
    `;
    expect(specifiers(source).filter(crossesBoundary)).toHaveLength(4);
  });
});
