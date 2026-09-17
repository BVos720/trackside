import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Vitest covers the non-UI layers, and that is the point.
 *
 * `core/` has no storage and no React Native dependency by construction (spec
 * §2.3), so it runs under plain Node with no native module shimming and no
 * Metro in the loop. Tests are milliseconds, which is what makes it realistic
 * to actually run them against the maths that has to be right.
 *
 * `storage-local/` is included for schema-invariant checks: the Drizzle schema
 * and the generated migration SQL are plain declarations and text, so asserting
 * on them needs no native SQLite driver and no device.
 *
 * `ui/state/` hooks are included too, on the same logic: they mock any native
 * module they touch (e.g. `expo-location`) rather than exercising it for
 * real, and test with `react-test-renderer` rather than rendering actual RN
 * primitives — so, like `core/`, they run under plain Node with nothing to
 * shim. This is narrower than "all of `src/ui/`" on purpose: a component test
 * that renders real `View`/`Text`/map primitives still needs jest-expo and
 * does not belong here.
 *
 * Component and native-module-rendering tests are a separate concern and will
 * need jest-expo; they do not belong in this config.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/core/**/*.test.ts',
      'src/storage-local/**/*.test.ts',
      'src/ui/state/**/*.test.ts',
      'src/ui/state/**/*.test.tsx',
      // Plain MapLibre lifecycle tests with map/GL boundaries mocked; no RN primitives.
      'src/ui/map/**/*.test.ts',
    ],
    globals: false,
  },
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
});
