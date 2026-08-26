/**
 * Show the error instead of dying silently.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * A release build has no red box. An unhandled JavaScript error goes straight
 * to the native fatal handler and the app disappears to the home screen, which
 * from the outside is indistinguishable from a native crash or a memory kill —
 * and each of those three wants a completely different fix. On a sideloaded
 * build with no Xcode and no Mac, telling them apart otherwise means digging
 * through Analytics Data on the phone hoping a `.ips` was written.
 *
 * So the app says what happened. If the error is in JavaScript, the message
 * and the stack are on screen, readable, screenshot-able. If this screen never
 * appears and the app still vanishes, that is itself the answer: the fault is
 * below JavaScript, and the crash log is worth hunting after all.
 *
 * ── Why it hardcodes its colours ──────────────────────────────────────────
 * It does not call `useTheme()`, and that is deliberate rather than lazy. This
 * component renders *because something already broke*, and the theme provider
 * is one of the things that could have broken. A fallback screen that depends
 * on the machinery it is reporting on can fail the same way and show nothing,
 * which is the one outcome that must not happen here. Dark values, fixed, no
 * context, no hooks into anything.
 *
 * ── Two mechanisms, because one is not enough ─────────────────────────────
 * `getDerivedStateFromError` catches errors thrown while React renders. Plenty
 * of errors are not thrown there — a rejected promise in an effect, a callback
 * from a native module, anything asynchronous — and React never sees those. RN
 * routes them through `ErrorUtils` instead, so `installGlobalErrorHandler`
 * below covers that half. Together they account for essentially every way JS
 * can fail at runtime.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

/** What we managed to learn about the failure. */
interface Caught {
  readonly message: string;
  readonly stack: string | null;
  /** React's component stack — which element was rendering. Render errors only. */
  readonly componentStack: string | null;
  readonly source: 'render' | 'runtime';
}

/**
 * The last error seen by the global handler, if any.
 *
 * A module-level slot rather than state, because the global handler fires
 * outside React entirely and has nothing to call `setState` on. The boundary
 * reads it when it next renders.
 */
let lastGlobalError: Caught | null = null;
let notifyGlobalError: ((error: Caught) => void) | null = null;

/**
 * Catch the asynchronous errors React never sees.
 *
 * Call once, as early as possible. `ErrorUtils` is React Native's own global
 * hook — the same one the red box uses in development — and chaining to the
 * previous handler matters: replacing it outright would stop the platform
 * doing whatever else it does with a fatal, including writing the crash report
 * that is the fallback when this screen cannot help.
 */
export function installGlobalErrorHandler(): void {
  const globals = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler(): (error: Error, isFatal?: boolean) => void;
      setGlobalHandler(handler: (error: Error, isFatal?: boolean) => void): void;
    };
  };

  const utils = globals.ErrorUtils;
  if (!utils) return; // Web, or a runtime without it. Nothing to install.

  const previous = utils.getGlobalHandler();

  utils.setGlobalHandler((error, isFatal) => {
    const caught: Caught = {
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
      componentStack: null,
      source: 'runtime',
    };

    lastGlobalError = caught;
    notifyGlobalError?.(caught);

    // Only hand a non-fatal onward. Letting a fatal through would tear the app
    // down a frame after this screen appeared, which defeats the point of it.
    if (!isFatal) previous?.(error, isFatal);
  });
}

interface Props {
  readonly children: ReactNode;
  /**
   * What failed, for the header — a screen name.
   *
   * Worth having because the same component guards the whole app and each
   * screen individually, and "the spots list threw" is a materially different
   * report from "the app threw".
   */
  readonly label?: string;
}

interface State {
  readonly caught: Caught | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { caught: lastGlobalError };

  static getDerivedStateFromError(error: Error): State {
    return {
      caught: {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null,
        componentStack: null,
        source: 'render',
      },
    };
  }

  override componentDidMount(): void {
    notifyGlobalError = (caught) => this.setState({ caught });
  }

  override componentWillUnmount(): void {
    notifyGlobalError = null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack only arrives here, after getDerivedStateFromError has
    // already set the message. It is the most useful line in the whole report —
    // it names the screen — so it is worth the second setState.
    this.setState((s) => ({
      caught: s.caught
        ? { ...s.caught, componentStack: info.componentStack ?? null }
        : s.caught,
    }));
  }

  private dismiss = (): void => {
    lastGlobalError = null;
    this.setState({ caught: null });
  };

  override render(): ReactNode {
    const { caught } = this.state;
    if (!caught) return this.props.children;

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.kicker}>
            {caught.source === 'render' ? 'RENDER ERROR' : 'RUNTIME ERROR'}
            {this.props.label ? ` · ${this.props.label.toUpperCase()}` : ''}
          </Text>
          <Text style={styles.title}>
            {this.props.label
              ? `The ${this.props.label} screen failed`
              : 'Something in the app failed'}
          </Text>
          <Text style={styles.lede}>
            This is here so the failure is visible instead of the app vanishing.
            Screenshot it — the message and the first few stack lines are what
            identify the bug.
            {this.props.label
              ? ' The menu still works, so you can move to another screen.'
              : ''}
          </Text>

          <Text style={styles.label}>MESSAGE</Text>
          <Text style={styles.mono} selectable>
            {caught.message}
          </Text>

          {caught.componentStack !== null && (
            <>
              <Text style={styles.label}>WHERE IT WAS RENDERING</Text>
              <Text style={styles.mono} selectable>
                {caught.componentStack.trim()}
              </Text>
            </>
          )}

          {caught.stack !== null && (
            <>
              <Text style={styles.label}>STACK</Text>
              <Text style={styles.mono} selectable>
                {caught.stack}
              </Text>
            </>
          )}
        </ScrollView>

        <Pressable
          onPress={this.dismiss}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonLabel}>Try to carry on</Text>
        </Pressable>
      </View>
    );
  }
}

/*
 * Fixed colours, matching the dark palette's values without importing them.
 * See the note in this file's header on why this screen must not depend on the
 * theme it might be reporting a failure in.
 */
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0D10' },
  content: { padding: 16, paddingTop: 64, paddingBottom: 24 },
  pressed: { opacity: 0.7 },

  kicker: {
    color: '#E3746B',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  title: {
    color: '#F2F5F8',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4,
  },
  lede: {
    color: '#9AA5B1',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },

  label: {
    color: '#5E6874',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 20,
  },
  mono: {
    color: '#F2F5F8',
    fontFamily: 'Courier',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#161A20',
  },

  button: {
    margin: 16,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A313B',
  },
  buttonLabel: { color: '#F2F5F8', fontSize: 15, fontWeight: '700' },
});
