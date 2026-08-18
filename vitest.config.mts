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
 * Component and native-module tests are a separate concern and will need
 * jest-expo; they do not belong in this config.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/core/**/*.test.ts', 'src/storage-local/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
});
