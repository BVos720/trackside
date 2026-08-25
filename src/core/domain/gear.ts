/**
 * A photographer's permanent kit — bodies and lenses, added by hand.
 *
 * `UserGearItemId` has been sitting in `./ids.ts` since the id brands were
 * first laid out; the domain anticipated this entity and never got it until
 * now. This is that entity.
 *
 * ── Belongs to the user, not to an event ────────────────────────────────────
 * A `GearItem` is a standing fact: "I own a Canon R7". It does not get
 * reseeded, retyped or reset — it is added once, in the profile screen, and
 * referenced from wherever it is needed (an event's gear picker, a future
 * per-spot suggestion).
 *
 * There was once a per-event packing checklist beside this, reset every
 * weekend. It was removed on 25 August: two overlapping lists of kit on one
 * screen is one more than anybody maintains, and this is the half that earns
 * its place, because a body's crop factor is a fact the app can compute with.
 *
 * ── Why a body's crop factor matters enough to store ────────────────────────
 * `Spot.shotSettings` (`./spot.ts` §5.6) stores focal length as a full-frame
 * equivalent plus the crop factor it was derived from, specifically so the
 * number can be rendered against whatever body the *reader* owns rather than
 * whichever body the original photographer shot with. That only works once
 * the app actually knows a crop factor for a body — seeing `cropFactor` here
 * is what makes that rendering possible; see `../logic/gear.ts` for the
 * conversion itself.
 *
 * ── Kind is a closed set ───────────────────────────────────────────────────
 * A gear item is a body or a lens — nothing else is in scope for D2/D3. Free
 * text would let "Canon R7" and "body" both live in the same field with no
 * way to tell them apart programmatically, which is exactly what `cropFactor`
 * needs to avoid: it is meaningful for a body and meaningless for a lens, and
 * the constructor below enforces that rather than trusting every call site to
 * remember it.
 *
 * ── No preset catalogue ──────────────────────────────────────────────────
 * `manufacturer` and `model` are free text, typed by hand. A bundled catalogue
 * of real bodies and lenses was considered and deliberately left out — see the
 * open question in `TASKS-profile.md` — because it is a licensing and
 * maintenance liability that neither D2 nor D3 needs to work.
 */
import type { EntityBase, Utc } from './common';
import { newEntityBase } from './common';
import { type UserGearItemId, type UserId, newId } from './ids';

export const GearKind = {
  Body: 'body',
  Lens: 'lens',
} as const;
export type GearKind = (typeof GearKind)[keyof typeof GearKind];

export interface GearItem extends EntityBase {
  readonly id: UserGearItemId;
  readonly userId: UserId;
  readonly kind: GearKind;
  /** "Canon", "Sony", "Sigma" — as typed. */
  readonly manufacturer: string;
  /** "EOS R7", "RF 100-500mm f/5-7.1" — as typed. */
  readonly model: string;
  /**
   * Sensor crop factor relative to full frame: `1.0` for full frame, `1.6`
   * for Canon APS-C, `1.5` for most other APS-C, `2.0` for Micro Four Thirds.
   *
   * Always `null` for a lens — a lens has no sensor, so the field is
   * meaningless and the constructor refuses to store one. For a body it is
   * `null` until entered by hand ("not yet recorded", the same convention
   * `Spot.shootingBearing` uses) rather than guessed: there is no catalogue
   * here to look it up against (see the file header), so a default would be
   * a fabricated fact, not a placeholder.
   */
  readonly cropFactor: number | null;
}

export function newGearItem(input: {
  userId: UserId;
  kind: GearKind;
  manufacturer: string;
  model: string;
  /** Ignored — forced to `null` — when `kind` is `Lens`. */
  cropFactor?: number | null;
  at?: Utc;
}): GearItem {
  return {
    id: newId<UserGearItemId>(),
    userId: input.userId,
    kind: input.kind,
    manufacturer: input.manufacturer,
    model: input.model,
    cropFactor: input.kind === GearKind.Lens ? null : (input.cropFactor ?? null),
    ...newEntityBase(input.at),
  };
}

/** All bodies in a collection, live ones only. */
export function bodies(items: readonly GearItem[]): GearItem[] {
  return items.filter((i) => i.deletedAt === null && i.kind === GearKind.Body);
}

/** All lenses in a collection, live ones only. */
export function lenses(items: readonly GearItem[]): GearItem[] {
  return items.filter((i) => i.deletedAt === null && i.kind === GearKind.Lens);
}
