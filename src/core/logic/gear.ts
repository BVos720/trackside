/**
 * Rendering a full-frame-equivalent focal length against a body the reader
 * actually owns — spec §5.6, the reason `GearItem.cropFactor`
 * (`../domain/gear.ts`) is worth storing at all.
 *
 * `Spot.shotSettings` stores `focalMinMm`/`focalMaxMm` as full-frame
 * equivalents plus the `cropFactorBasis` they were derived from (`../domain/
 * spot.ts` §5.6) — the crop factor of whichever body the *original*
 * photographer shot with. That basis is irrelevant to this conversion: it
 * only documents where the number came from, not what a different reader
 * should dial in. What the reader needs is their *own* body's crop factor.
 *
 * ── The maths ────────────────────────────────────────────────────────────
 * A full-frame-equivalent focal length is the number that produces the same
 * field of view on a full-frame sensor. A smaller sensor (crop factor > 1)
 * narrows the field of view for a given physical focal length, so a shorter
 * physical lens is needed to reach the same equivalent — division, not
 * multiplication:
 *
 *   actual = fullFrameEquivalent / bodyCropFactor
 *
 * A 480mm full-frame-equivalent reading, read on a Canon R7 (1.6x), is
 * actually a 300mm lens: 480 / 1.6 = 300. Read on the R6 Mark II (1.0, full
 * frame) it stays 480mm, because dividing by 1.0 is a no-op — which is the
 * whole reason full frame is `1.0` and not some other placeholder.
 */

/**
 * Convert one full-frame-equivalent focal length to the physical focal
 * length a reader would actually need, given their body's crop factor.
 *
 * `bodyCropFactor` must be a positive number — `1.0` for full frame, `1.6`
 * for Canon APS-C, `1.5` for most other APS-C, `2.0` for Micro Four Thirds.
 * A `GearItem.cropFactor` of `null` ("not yet recorded") is a caller
 * concern, not this function's: resolve it to a real number, or don't call
 * this, before reaching for a displayed range.
 */
export function actualFocalLengthMm(
  fullFrameEquivalentMm: number,
  bodyCropFactor: number,
): number {
  if (!(bodyCropFactor > 0)) {
    throw new RangeError(
      `bodyCropFactor must be a positive number, got ${bodyCropFactor}`,
    );
  }
  return fullFrameEquivalentMm / bodyCropFactor;
}

/** A focal length range, either full-frame-equivalent or actual — same shape. */
export interface FocalRangeMm {
  readonly minMm: number | null;
  readonly maxMm: number | null;
}

/**
 * Convert a whole `focalMinMm`/`focalMaxMm` range at once — the shape
 * `ShotSetting` (`../domain/spot.ts`) actually stores. Either end may be
 * `null` (not specified) and passes through unconverted.
 */
export function actualFocalRangeMm(
  fullFrameEquivalent: FocalRangeMm,
  bodyCropFactor: number,
): FocalRangeMm {
  return {
    minMm:
      fullFrameEquivalent.minMm === null
        ? null
        : actualFocalLengthMm(fullFrameEquivalent.minMm, bodyCropFactor),
    maxMm:
      fullFrameEquivalent.maxMm === null
        ? null
        : actualFocalLengthMm(fullFrameEquivalent.maxMm, bodyCropFactor),
  };
}
