/**
 * What this build is. GENERATED — do not edit.
 *
 * Written by `scripts/write-build-info.mjs`, which CI runs before building.
 * Committed with whatever the last run produced so a fresh checkout compiles
 * without needing the script first.
 *
 * Shown in Profile. It exists because a sideloaded build otherwise carries no
 * version anyone can see, and "still broken" is indistinguishable from "not
 * built yet" when neither side knows which commit is on the phone.
 */
export const BUILD_INFO = {
  version: "1.0.0",
  commit: "e91daa9",
  /** True when the tree had uncommitted changes at build time. */
  modified: true,
  builtAt: "2026-08-27T11:34:01.774Z",
} as const;

/** One line for a settings row: `1.0.0 · a1b2c3d`, with a marker when dirty. */
export const BUILD_LABEL = `${BUILD_INFO.version} · ${BUILD_INFO.commit}${
  BUILD_INFO.modified ? ' +local' : ''
}`;
