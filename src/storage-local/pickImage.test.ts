import { describe, expect, it, vi } from 'vitest';

/**
 * `pickImage`'s actual EXIF stripping happens inside `expo-image-manipulator`
 * — a native module with no JS-mockable pixel pipeline, so it can't be
 * unit-tested here (and importing it for real drags in `react-native`, which
 * this Vitest config — see its own comment — deliberately excludes: Flow
 * syntax it can't parse). Both native packages are stubbed below purely so
 * `pickImage.ts` can be imported at all; nothing about the stubs is
 * exercised.
 *
 * What *can* be tested is the one decision that used to skip the manipulator
 * entirely (and so used to leave EXIF untouched) for any image already at or
 * under `MAX_EDGE`: `resizeTargetFor` must never return "don't call the
 * manipulator" — every input, large or small, gets a resize target, even if
 * that target reproduces the image's own dimensions.
 *
 * See `downscale`'s comment in pickImage.ts for why a no-op resize still
 * forces the re-encode that drops EXIF, and what still needs on-device
 * verification.
 */
vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}));
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: vi.fn() },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

const { resizeTargetFor } = await import('./pickImage');
describe('resizeTargetFor', () => {
  it('caps a large landscape image at MAX_EDGE on its width', () => {
    expect(resizeTargetFor(4000, 3000)).toEqual({ width: 1600 });
  });

  it('caps a large portrait image at MAX_EDGE on its height', () => {
    expect(resizeTargetFor(3000, 4000)).toEqual({ height: 1600 });
  });

  it('still returns a resize target for an already-small landscape image (forces re-encode)', () => {
    expect(resizeTargetFor(800, 600)).toEqual({ width: 800 });
  });

  it('still returns a resize target for an already-small portrait image (forces re-encode)', () => {
    expect(resizeTargetFor(600, 800)).toEqual({ height: 800 });
  });

  it('treats an image exactly at MAX_EDGE as already small (no-op target, still forces re-encode)', () => {
    expect(resizeTargetFor(1600, 1200)).toEqual({ width: 1600 });
  });

  it('falls back to capping at MAX_EDGE when dimensions are unknown', () => {
    expect(resizeTargetFor(undefined, undefined)).toEqual({ width: 1600 });
  });

  it('never returns an empty target that would let the manipulator be skipped', () => {
    for (const [w, h] of [
      [4000, 3000],
      [3000, 4000],
      [800, 600],
      [600, 800],
      [1600, 1600],
      [1, 1],
      [undefined, undefined],
    ] as const) {
      const target = resizeTargetFor(w, h);
      expect(target.width !== undefined || target.height !== undefined).toBe(true);
    }
  });
});
