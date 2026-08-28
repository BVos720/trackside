/**
 * Graphics presets — TASKS.md F8, and F6's render distance.
 *
 * ── Why presets and switches, rather than one or the other ────────────────
 * The 3D view has accumulated a lot of things that cost frames: a woodland
 * scatter of ten thousand sprites, an animation loop for cloud and rain, a
 * star field, relief shading. Each is individually defensible and together
 * they are too much for some phones — and "some phones" is not a thing this
 * app can detect honestly, because the same handset is fine on a cold morning
 * and thermally throttled after an hour in the sun at a circuit in August.
 *
 * So the person decides. A preset is the fast way to say "this phone is
 * struggling" without reading five explanations; the individual switches are
 * there because the trade is personal — somebody who wants rain more than
 * trees should not have to accept the bundle that says otherwise.
 *
 * A preset therefore *writes* the switches rather than overriding them. There
 * is one source of truth for what is drawn, and "Low" is a shortcut to a set
 * of values, not a mode that shadows them.
 */

export type GraphicsPreset = 'low' | 'medium' | 'high';

/**
 * How far scenery is drawn — F6.
 *
 * Distance rather than a count, because the cost that matters is how much is
 * on screen at once, and that is a function of how far you can see. Named
 * rather than numeric so the meaning survives a change to the underlying
 * radius: "near" stays "near" if the metres behind it are retuned.
 */
export type SceneryDistance = 'near' | 'mid' | 'far';

export interface GraphicsSettings {
  /** Woodland and field detail — the most expensive single thing here. */
  readonly scenery: boolean;
  /** How far that scatter reaches. */
  readonly sceneryDistance: SceneryDistance;
  /** Falling rain, which animates continuously while it runs. */
  readonly rain: boolean;
  /** The night sky's star field. */
  readonly stars: boolean;
  /** Relief shading on the terrain. */
  readonly hillshade: boolean;
}

/**
 * What each preset means.
 *
 * Low turns off everything that is decoration and keeps everything that is
 * information. That is the line: hillshade goes, because the terrain mesh
 * already carries the shape and the shading is an enhancement of it; scenery
 * goes, because trees are context rather than data. What never goes at any
 * preset is the circuit, the spots, the sun and the light — those are the
 * reason the view exists, and a performance setting that removed them would
 * be answering a different question.
 */
const PRESETS: Record<GraphicsPreset, GraphicsSettings> = {
  low: {
    scenery: false,
    sceneryDistance: 'near',
    rain: false,
    stars: false,
    hillshade: false,
  },
  medium: {
    scenery: true,
    sceneryDistance: 'near',
    rain: false,
    stars: true,
    hillshade: true,
  },
  high: {
    scenery: true,
    sceneryDistance: 'far',
    rain: true,
    stars: true,
    hillshade: true,
  },
};

export const DEFAULT_GRAPHICS: GraphicsSettings = PRESETS.high;

export function settingsForPreset(preset: GraphicsPreset): GraphicsSettings {
  return PRESETS[preset];
}

/**
 * Which preset a set of switches corresponds to, or null for none of them.
 *
 * Null is the common case once anybody has touched a switch, and the UI shows
 * it by simply not highlighting a preset. That is more honest than snapping
 * the highlight to the nearest one, which would claim a state the person did
 * not choose and would make the next tap on that preset appear to do nothing.
 */
export function presetOf(settings: GraphicsSettings): GraphicsPreset | null {
  for (const name of ['low', 'medium', 'high'] as const) {
    const p = PRESETS[name];
    if (
      p.scenery === settings.scenery &&
      p.sceneryDistance === settings.sceneryDistance &&
      p.rain === settings.rain &&
      p.stars === settings.stars &&
      p.hillshade === settings.hillshade
    ) {
      return name;
    }
  }
  return null;
}

/**
 * How far the scatter reaches, in degrees of latitude either side.
 *
 * Rough by nature — a degree of longitude is not a degree of latitude away
 * from the equator — and that is fine, because this is a *budget* rather than
 * a measurement. What it controls is how much is on screen, and being 30%
 * out at one circuit changes nothing about whether the frame rate holds.
 */
export function sceneryRadiusDegrees(distance: SceneryDistance): number {
  switch (distance) {
    case 'near':
      return 0.012;
    case 'mid':
      return 0.03;
    case 'far':
      // Effectively "everything in the extract". The scatter is clipped to
      // the circuit corridor anyway, so nothing larger would add features.
      return 1;
  }
}
