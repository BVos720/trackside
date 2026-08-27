#!/usr/bin/env node
/**
 * Stamp the build with what it actually is.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * A sideloaded build carries no version anyone can see. That turned into a
 * real cost: bugs were reported against a build that already had the fix, and
 * neither side could tell — "still broken" and "not built yet" look identical
 * from a screenshot. Time went into re-diagnosing things that were already
 * done.
 *
 * So the app says which commit it came from, and Profile shows it.
 *
 * ── Why generated rather than read from a library ─────────────────────────
 * `expo-constants` would give the version from app.json, but not the commit —
 * and it is a native module, which means a new pod on a build where signing
 * keys are rationed. Writing a plain TypeScript file needs nothing: Metro
 * compiles it like any other source, and it works identically on web.
 *
 * The generated file is committed with local defaults so a checkout builds
 * without running this first. CI overwrites it before `expo prebuild`.
 *
 *   node scripts/write-build-info.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** Short SHA, or a stand-in. Never throws — a missing git is not a build failure. */
function commit() {
  // GitHub Actions provides the SHA directly, and its checkout may be shallow
  // in ways that make git itself less reliable than the environment.
  const fromCi = process.env.GITHUB_SHA;
  if (typeof fromCi === 'string' && fromCi.length >= 7) return fromCi.slice(0, 7);

  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/** True when the working tree has uncommitted changes — worth knowing on a test build. */
function dirty() {
  try {
    const status = execSync('git status --porcelain', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

const version = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.version;
const sha = commit();
const modified = dirty();
const builtAt = new Date().toISOString();

const contents = `/**
 * What this build is. GENERATED — do not edit.
 *
 * Written by \`scripts/write-build-info.mjs\`, which CI runs before building.
 * Committed with whatever the last run produced so a fresh checkout compiles
 * without needing the script first.
 *
 * Shown in Profile. It exists because a sideloaded build otherwise carries no
 * version anyone can see, and "still broken" is indistinguishable from "not
 * built yet" when neither side knows which commit is on the phone.
 */
export const BUILD_INFO = {
  version: ${JSON.stringify(version)},
  commit: ${JSON.stringify(sha)},
  /** True when the tree had uncommitted changes at build time. */
  modified: ${JSON.stringify(modified)},
  builtAt: ${JSON.stringify(builtAt)},
} as const;

/** One line for a settings row: \`1.0.0 · a1b2c3d\`, with a marker when dirty. */
export const BUILD_LABEL = \`\${BUILD_INFO.version} · \${BUILD_INFO.commit}\${
  BUILD_INFO.modified ? ' +local' : ''
}\`;
`;

writeFileSync(join(root, 'src', 'buildInfo.ts'), contents);
console.log(`build info: ${version} · ${sha}${modified ? ' +local' : ''}`);
