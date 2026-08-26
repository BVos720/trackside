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
import { installGlobalErrorHandler } from './src/ui/ErrorBoundary';

/*
 * Installed here, not in a component.
 *
 * An error thrown while the very first render runs would happen before any
 * effect had a chance to install this, which is exactly the failure worth
 * catching — so it goes at module scope in the entry file, before
 * registerRootComponent. Only the crypto polyfill above may precede it.
 */
installGlobalErrorHandler();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
