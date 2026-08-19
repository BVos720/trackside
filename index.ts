/**
 * App entry.
 *
 * ── The crypto polyfill must come first ────────────────────────────────────
 * `core/domain/ids.ts` mints UUID v7 through the `uuid` package, which calls
 * `crypto.getRandomValues`. Browsers provide that; Hermes does not, so on
 * device every id creation threw `ReferenceError: Property 'crypto' doesn't
 * exist` — meaning no spot, event, session or photo could ever be saved. The
 * web preview hid it completely, because there the global is simply present.
 *
 * `react-native-get-random-values` installs the global as a side effect of
 * being imported, so it must be imported *before* anything that reaches for it.
 * It is first in this file for that reason, and nothing may go above it.
 */
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
