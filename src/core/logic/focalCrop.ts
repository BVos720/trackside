/**
 * Cropping an image to a square around a chosen point — TASKS.md F3.
 *
 * ── Why the centre is worth choosing ──────────────────────────────────────
 * Every thumbnail in this app is square and every reference photo is not.
 * Cropping to the middle is a guess, and at a circuit it is usually the wrong
 * one: a shot showing where to stand is framed around a corner, a fence gap
 * or a marshal post that is rarely in the centre of the frame. The photograph
 * is of the *place*, and the part that identifies the place is the part that
 * has to survive the crop.
 *
 * So the photographer says where to look, once, and every square rendering of
 * that image honours it.
 *
 * Pure geometry, no React and no image loading, so the rule can be tested
 * without a renderer and reused by anything that draws a square.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * Where the interesting part of an image is, as fractions of its own size.
 *
 * 0–1 in each axis, with 0.5, 0.5 meaning dead centre — which is both the
 * default and exactly what a plain centre-crop already did, so an image
 * nobody has adjusted renders as it always has.
 */
export interface FocalPoint {
  readonly x: number;
  readonly y: number;
}

export const CENTRE: FocalPoint = { x: 0.5, y: 0.5 };

/** Absolute placement of an image inside a box, for a `cover` style crop. */
export interface CropBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Place `natural` inside `box` so it covers it, centred on `focal`.
 *
 * The image is scaled to cover — the same rule as `resizeMode: 'cover'` — and
 * then slid so the focal point sits in the middle of the box, as far as it
 * can go without exposing an edge. That clamp is the whole subtlety: a focal
 * point near a corner cannot be centred without leaving the box empty, and
 * showing a strip of background would be a worse failure than showing the
 * subject slightly off-centre.
 *
 * Degenerate inputs return the box itself rather than dividing by zero.
 * `Image.getSize` can report 0 while a file is still resolving, and a NaN
 * offset would put the image somewhere unrenderable rather than merely
 * wrong.
 */
export function focalCrop(
  natural: Size,
  box: Size,
  focal: FocalPoint = CENTRE,
): CropBox {
  if (
    !Number.isFinite(natural.width) ||
    !Number.isFinite(natural.height) ||
    natural.width <= 0 ||
    natural.height <= 0 ||
    box.width <= 0 ||
    box.height <= 0
  ) {
    return { left: 0, top: 0, width: box.width, height: box.height };
  }

  const scale = Math.max(box.width / natural.width, box.height / natural.height);
  const width = natural.width * scale;
  const height = natural.height * scale;

  const fx = clamp(Number.isFinite(focal.x) ? focal.x : 0.5, 0, 1);
  const fy = clamp(Number.isFinite(focal.y) ? focal.y : 0.5, 0, 1);

  // Where the focal point lands once scaled, then slid to the box's middle.
  const wantLeft = box.width / 2 - fx * width;
  const wantTop = box.height / 2 - fy * height;

  // Never past the edges: the overflow is negative, so the range is
  // [box - size, 0].
  return {
    left: clamp(wantLeft, box.width - width, 0),
    top: clamp(wantTop, box.height - height, 0),
    width,
    height,
  };
}

/**
 * Turn a tap into a focal point.
 *
 * Taps land in the coordinates of the *displayed* box, which is what the
 * person is looking at, while the focal point has to be in the image's own
 * fractions so it survives being drawn at any other size. This converts one
 * to the other by undoing the crop that produced the view.
 */
export function focalFromTap(
  tap: { readonly x: number; readonly y: number },
  natural: Size,
  box: Size,
  current: FocalPoint = CENTRE,
): FocalPoint {
  // Guarded on the *image*, not on the crop: for an image of unknown size
  // focalCrop honestly returns the box itself, which is a perfectly valid
  // rectangle and would silently convert the tap against the wrong geometry.
  // There is no meaningful answer until the size is known.
  if (
    !Number.isFinite(natural.width) ||
    !Number.isFinite(natural.height) ||
    natural.width <= 0 ||
    natural.height <= 0
  ) {
    return CENTRE;
  }

  const crop = focalCrop(natural, box, current);
  if (crop.width <= 0 || crop.height <= 0) return CENTRE;
  return {
    x: clamp((tap.x - crop.left) / crop.width, 0, 1),
    y: clamp((tap.y - crop.top) / crop.height, 0, 1),
  };
}
