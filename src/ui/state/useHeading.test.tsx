/**
 * Tests for `useHeading` — wrap-safe smoothing, the uncalibrated/`-1` case,
 * and subscription lifecycle.
 *
 * `smoothHeading` is a pure function and is exercised directly, with no
 * rendering or mocking at all — that is the point of pulling it out (task
 * file C1: "Filter the angle, not the number", extracted so it "can be unit-
 * tested without mocking `expo-location` at all").
 *
 * The hook itself is *stateful* (`useState` + a `useEffect`-driven
 * subscription), so it needs something to mount it and run its effects, the
 * same problem `useMapClock.test.tsx` solves — see that file's header for
 * why `react-test-renderer` and not `@testing-library/react-hooks` (not a
 * dependency here, and there is no other precedent in this repo). This file
 * mirrors that style: a throwaway `Probe` component, a mutable box for the
 * latest return value, and `act` to flush effects deterministically.
 */
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { smoothHeading, useHeading, type UseHeadingResult } from './useHeading';

// Same React-19-under-Vitest requirement as useMapClock.test.tsx: without
// this, `act(...)` does not flush effects synchronously in a plain Node
// environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Mock expo-location ───────────────────────────────────────────────────
// `watchHeadingAsync` is captured so tests can push readings into it by
// hand; `remove` is a spy so the "stops the subscription" test can assert on
// it directly, per the task file's requirement. `vi.hoisted` is required
// here (rather than plain top-level `const`s) because `vi.mock`'s factory is
// hoisted above the rest of the module, and vitest only allows a factory to
// close over bindings created the same way.
type HeadingCallback = (reading: { trueHeading: number; magHeading: number }) => void;

const mocks = vi.hoisted(() => {
  const removeSpy = vi.fn();
  return {
    requestForegroundPermissionsAsync: vi.fn(),
    removeSpy,
    headingCallback: { current: null as HeadingCallback | null },
    watchHeadingAsync: vi.fn(async (callback: HeadingCallback) => {
      mocks.headingCallback.current = callback;
      return { remove: removeSpy };
    }),
  };
});
const { requestForegroundPermissionsAsync, removeSpy, watchHeadingAsync } = mocks;

vi.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: mocks.requestForegroundPermissionsAsync,
  watchHeadingAsync: mocks.watchHeadingAsync,
}));

/** Mounts `useHeading` inside a throwaway component and exposes its current
 * return value via a mutable box, updated on every render. */
function renderHeading(enabled?: boolean) {
  const box: { current: UseHeadingResult | null } = { current: null };

  function Probe() {
    box.current = useHeading(enabled);
    return null;
  }

  let root!: ReturnType<typeof create>;
  act(() => {
    root = create(<Probe />);
  });

  return { box, root };
}

// Flushes the microtask queue so the `async () => { ... }` permission +
// subscription chain inside the hook's effect settles before assertions.
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  requestForegroundPermissionsAsync.mockReset();
  requestForegroundPermissionsAsync.mockResolvedValue({ granted: true });
  watchHeadingAsync.mockClear();
  removeSpy.mockClear();
  mocks.headingCallback.current = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('smoothHeading', () => {
  it('is a no-op the first time (no previous value)', () => {
    expect(smoothHeading(null, 42, 0.2)).toBe(42);
  });

  it('steps a fraction of the way towards the next reading', () => {
    // From 10 to 20, alpha 0.5 -> halfway.
    expect(smoothHeading(10, 20, 0.5)).toBeCloseTo(15, 5);
  });

  it('wraps the short way across the 359°/0° boundary', () => {
    // 359 -> 1 the short way is +2 total, not -359. Alpha 0.5 should land
    // near 0, not swing through 180.
    const result = smoothHeading(359, 1, 0.5);
    // Expected: 359 + 0.5*2 = 360 -> normalises to 0.
    expect(result).toBeCloseTo(0, 5);
  });

  it('wraps the short way when going backwards across the boundary', () => {
    // From 1 to 359: short way is -2 (through 0), not +358.
    const result = smoothHeading(1, 359, 0.5);
    expect(result).toBeCloseTo(0, 5);
  });

  it('never produces a value outside [0, 360)', () => {
    expect(smoothHeading(350, 10, 1)).toBeGreaterThanOrEqual(0);
    expect(smoothHeading(350, 10, 1)).toBeLessThan(360);
  });

  it('alpha of 0 leaves the previous value unchanged', () => {
    expect(smoothHeading(123, 45, 0)).toBeCloseTo(123, 5);
  });

  it('alpha of 1 snaps straight to the next reading', () => {
    expect(smoothHeading(123, 45, 1)).toBeCloseTo(45, 5);
  });
});

describe('useHeading', () => {
  it('starts idle/null before permission resolves, then watches', async () => {
    const { box } = renderHeading(true);
    expect(box.current!.heading).toBeNull();

    await flush();

    expect(requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(watchHeadingAsync).toHaveBeenCalledTimes(1);
    expect(box.current!.status).toBe('watching');
  });

  it('reports a smoothed true-heading reading', async () => {
    const { box } = renderHeading(true);
    await flush();

    act(() => {
      mocks.headingCallback.current!({ trueHeading: 90, magHeading: 92 });
    });

    // First reading: smoothing has no previous value, so it lands exactly
    // on the raw reading.
    expect(box.current!.heading).toBeCloseTo(90, 5);
  });

  it('treats -1 (uncalibrated) as unavailable, never a fabricated 0', async () => {
    const { box } = renderHeading(true);
    await flush();

    act(() => {
      mocks.headingCallback.current!({ trueHeading: 90, magHeading: 92 });
    });
    expect(box.current!.heading).toBeCloseTo(90, 5);

    act(() => {
      mocks.headingCallback.current!({ trueHeading: -1, magHeading: 92 });
    });

    expect(box.current!.heading).toBeNull();
    expect(box.current!.heading).not.toBe(0);
  });

  it('does not call watchHeadingAsync when disabled', async () => {
    const { box } = renderHeading(false);
    await flush();

    expect(requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(watchHeadingAsync).not.toHaveBeenCalled();
    expect(box.current!.heading).toBeNull();
    expect(box.current!.status).toBe('idle');
  });

  it('tears down the subscription when enabled flips to false', async () => {
    const box: { current: UseHeadingResult | null } = { current: null };

    function Probe({ enabled }: { enabled: boolean }) {
      box.current = useHeading(enabled);
      return null;
    }

    let root!: ReturnType<typeof create>;
    act(() => {
      root = create(<Probe enabled={true} />);
    });
    await flush();

    expect(watchHeadingAsync).toHaveBeenCalledTimes(1);
    expect(removeSpy).not.toHaveBeenCalled();

    act(() => {
      root.update(<Probe enabled={false} />);
    });
    await flush();

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(box.current!.heading).toBeNull();
    expect(box.current!.status).toBe('idle');
  });

  it('tears down the subscription on unmount', async () => {
    const { root } = renderHeading(true);
    await flush();

    expect(watchHeadingAsync).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });

    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it('surfaces denied permission as a status, with heading staying null', async () => {
    requestForegroundPermissionsAsync.mockResolvedValue({ granted: false });

    const { box } = renderHeading(true);
    await flush();

    expect(box.current!.status).toBe('denied');
    expect(box.current!.heading).toBeNull();
    expect(watchHeadingAsync).not.toHaveBeenCalled();
  });
});
