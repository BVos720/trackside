/**
 * Tests for `useMapClock` — live ticking, scrubbing, and resuming.
 *
 * ── Why `react-test-renderer` rather than `@testing-library/react-hooks` ────
 * Neither `@testing-library/react-hooks` nor `@testing-library/react-native`
 * is a dependency of this project, and there is no existing precedent for
 * testing a `useX` hook here (`useWeather` has no colocated test). This is a
 * *stateful* hook — `useState` plus a `useEffect`-driven interval — so it
 * cannot be exercised by calling it directly outside a component the way a
 * pure function could; some renderer has to mount it and run its effects.
 *
 * `react-test-renderer` is the minimal choice: it's an official React
 * package version-pinned to the exact `react` version in this repo (see
 * `package.json`), needs no DOM/jsdom, and is dev-only. A tiny `Probe`
 * component below stands in for the "manual-render approach" the task
 * allows — mount it, read the hook's return value off a ref, and use `act`
 * to flush effects and timers deterministically.
 */
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMapClock, type MapClock } from './useMapClock';

// React 19 only flushes `act(...)` effects synchronously (and stays quiet
// about it) when the environment declares itself act-aware. Vitest's plain
// Node environment doesn't set this on its own.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mounts `useMapClock` inside a throwaway component and exposes its
 * current return value via a mutable box, updated on every render. */
function renderMapClock() {
  const box: { current: MapClock | null } = { current: null };

  function Probe() {
    box.current = useMapClock();
    return null;
  }

  act(() => {
    create(<Probe />);
  });

  return box;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-21T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useMapClock', () => {
  it('starts live, pinned to the real clock', () => {
    const box = renderMapClock();
    expect(box.current!.isLive).toBe(true);
    expect(box.current!.now.getTime()).toBe(new Date('2026-08-21T10:00:00Z').getTime());
  });

  it('ticks `now` forward on its own while live', () => {
    const box = renderMapClock();

    // Advancing the fake clock both moves "now" and fires any interval that
    // falls within the window — from the 10:00:00 base set in beforeEach,
    // 60s fires the (30s) live interval twice and lands `now` on 10:01:00.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(box.current!.isLive).toBe(true);
    expect(box.current!.now.getTime()).toBe(new Date('2026-08-21T10:01:00Z').getTime());
  });

  it('scrubTo pins `now` and clears isLive, and stops ticking', () => {
    const box = renderMapClock();
    const target = new Date('2026-08-21T18:30:00Z');

    act(() => {
      box.current!.scrubTo(target);
    });

    expect(box.current!.isLive).toBe(false);
    expect(box.current!.now.getTime()).toBe(target.getTime());

    // Time moving on and the live interval firing (were it still armed)
    // must not un-pin the scrubbed instant.
    vi.setSystemTime(new Date('2026-08-21T19:00:00Z'));
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });

    expect(box.current!.isLive).toBe(false);
    expect(box.current!.now.getTime()).toBe(target.getTime());
  });

  it('resumeNow restores both isLive and the real instant, and resumes ticking', () => {
    const box = renderMapClock();

    act(() => {
      box.current!.scrubTo(new Date('2026-08-21T03:00:00Z'));
    });
    expect(box.current!.isLive).toBe(false);

    // Move the real/mocked clock on while scrubbed, then resume — proves
    // `resumeNow` reads the *current* instant, not wherever it was scrubbed
    // to or the instant `beforeEach` set up.
    act(() => {
      vi.setSystemTime(new Date('2026-08-21T12:00:00Z'));
      box.current!.resumeNow();
    });

    expect(box.current!.isLive).toBe(true);
    expect(box.current!.now.getTime()).toBe(new Date('2026-08-21T12:00:00Z').getTime());

    // And it keeps following the real clock again afterwards — same
    // "advance fires the interval" reasoning as the ticking test above.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(box.current!.now.getTime()).toBe(new Date('2026-08-21T12:01:00Z').getTime());
  });
});
