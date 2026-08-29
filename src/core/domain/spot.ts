/**
 * Spots — the central entity. Spec §4.1, §5.1, §9.1.
 */
import {
  type EntityBase,
  type LatLonElevation,
  Visibility,
  newEntityBase,
  type Utc,
} from './common';
import { type CircuitId,
  type EventId, type MarshalPostId, type SpotGroupId, type SpotId, type UserId, newId } from './ids';

/**
 * What a position is good for.
 *
 * A photography spot and a spectating spot are not the same place, and the gap
 * between them is not a detail. A gap in a debris fence at the exit of
 * Pflanzgarten is a fine camera position and a miserable place to watch from;
 * a grandstand with a big screen and a bratwurst stand is the reverse. Marking
 * both on one map with no way to filter gives you a list where most entries
 * are wrong for whatever you came to do.
 *
 * ── A set, not a third "both" value ───────────────────────────────────────
 * Plenty of positions genuinely serve both, so that case has to be
 * expressible — but as `['photography', 'spectating']`, not as a separate enum
 * member. A three-value enum turns every filter into a two-branch test that
 * someone eventually writes as one, and adding a fourth use later (filming,
 * marshal viewing) means revisiting all of them. Set membership stays a single
 * test however many uses exist.
 *
 * ── Not a safety field ────────────────────────────────────────────────────
 * This says what a position is *useful* for, never whether you may be there.
 * That is `accessClassification` below, and marking a spot as good for
 * spectating must never be read as permission to stand in it.
 */
export const SpotUse = {
  Photography: 'photography',
  Spectating: 'spectating',
} as const;
export type SpotUse = (typeof SpotUse)[keyof typeof SpotUse];

export const ALL_SPOT_USES: readonly SpotUse[] = [
  SpotUse.Photography,
  SpotUse.Spectating,
];

/**
 * What a spot that does not say is assumed to be for.
 *
 * Every spot saved before this field existed was a camera position — that is
 * the only thing the app did. Defaulting to photography preserves what those
 * rows meant. Defaulting to both would silently claim they had been assessed
 * as somewhere to watch from, which nobody ever did.
 */
export const DEFAULT_SPOT_USES: readonly SpotUse[] = [SpotUse.Photography];

/**
 * Coerce a stored or user-supplied set into a usable one.
 *
 * The empty set is the case worth guarding. A spot that is for nothing is
 * filtered out of every mode and simply vanishes off the map — no error, and
 * nothing left to tap to get it back. Unticking both boxes in the editor is
 * one gesture away, so that is a state people will actually reach.
 *
 * Unknown values are dropped rather than kept: they come from a future build
 * or a hand-edited bundle, and carrying them through would let a spot match a
 * mode this build cannot name.
 */
export function normaliseUses(uses: readonly string[] | undefined): SpotUse[] {
  const known = (uses ?? []).filter((u): u is SpotUse =>
    ALL_SPOT_USES.includes(u as SpotUse),
  );
  const unique = [...new Set(known)];
  return unique.length === 0 ? [...DEFAULT_SPOT_USES] : unique;
}

/**
 * Whether you are actually allowed to stand somewhere.
 *
 * ── This is a physical-safety and liability field. Spec §0.1, §9.1. ─────────
 *
 * It must NEVER be assigned by anything other than a human who knows the
 * answer. Not inferred from coordinates. Not inferred from proximity to a
 * public footpath. Not inferred from the fact that other spots nearby are
 * marked `official`. Not defaulted to `publicLand` because that is the common
 * case.
 *
 * Many of the best Nordschleife positions are places people should not be.
 * A wrong `official` on a spot is an instruction to a stranger to stand
 * somewhere that could get them hurt, prosecuted, or the position permanently
 * fenced off for everyone.
 *
 * `Unknown` is the honest answer until a human supplies otherwise, and the UI
 * surfaces it as "not yet documented" rather than hiding it.
 */
export const AccessClassification = {
  /** Inside a ticketed or otherwise sanctioned spectator area. */
  Official: 'official',
  /** Publicly accessible land with no permission needed. */
  PublicLand: 'publicLand',
  /** Requires a pass, an accreditation, or a landowner's permission. */
  PermissionRequired: 'permissionRequired',
  /** Not yet documented by a human. The only permitted default. */
  Unknown: 'unknown',
} as const;
export type AccessClassification =
  (typeof AccessClassification)[keyof typeof AccessClassification];

/**
 * Camera settings that work from a position — spec §5.6, §5.19.
 *
 * Several per spot on purpose: the same position gives a completely different
 * frame panned at 1/60 than frozen at 1/1600, and both are worth recording.
 *
 * ── Focal length is stored as full-frame equivalent ────────────────────────
 * §5.6 rule 1, and the one thing here that is expensive to get wrong. "RF
 * 100-500" is meaningless to a Sony shooter and "300mm" means two different
 * framings on full-frame and APS-C. Storing the equivalent plus the crop factor
 * it was derived from means the number can be rendered against whatever body
 * the reader owns. Retrofitting that later means guessing what every historical
 * entry meant.
 *
 * Shutter, aperture and ISO are free text: "1/125", "f/2.8", "3200" are how
 * photographers write them, and parsing them into numbers gains nothing until
 * something actually computes with them (§5.19's EXIF import is where that
 * starts).
 */
export interface ShotSetting {
  readonly id: string;
  /** What this setting is for — "panning", "static", "rig", "long exposure". */
  readonly technique: string;
  /** Full-frame equivalent, in millimetres. Null when not specified. */
  readonly focalMinMm: number | null;
  readonly focalMaxMm: number | null;
  /**
   * Crop factor the focal figures were derived from — 1.0 for full frame,
   * 1.6 for Canon APS-C. Recorded so the equivalence can be undone if the
   * conversion ever needs auditing.
   */
  readonly cropFactorBasis: number;
  readonly shutter: string | null;
  readonly aperture: string | null;
  readonly iso: string | null;
  readonly note: string | null;
}

/**
 * A canonical, community-owned photography position.
 *
 * Deliberately separate from `UserSpotNote` (spec §4.2, non-negotiable). The
 * split is what stops the map degrading into two hundred near-identical pins
 * at Brünnchen: personal opinion lives on the note, the position itself stays
 * singular. Sharing means promoting a note's spot to canonical, never copying
 * a pin.
 */
export interface Spot extends EntityBase {
  readonly id: SpotId;
  readonly circuitId: CircuitId;
  /**
   * The event this spot belongs to, or null for your permanent collection.
   *
   * ── Why events own copies rather than sharing spots ──────────────────────
   * An event starts as a *clone* of your spots, not a set of references, so
   * moving a pin or deleting one while planning a weekend cannot damage the
   * collection you have built up over years. That is the trade made
   * deliberately: the cost is that a genuine correction has to be made twice,
   * and the benefit is that the map you rely on is never one careless tap from
   * being wrong.
   *
   * This field is what keeps the two apart. The default map shows spots with
   * no event; an event shows only its own. Without it the clones would appear
   * alongside their originals and double every pin at the circuit.
   */
  readonly eventId: EventId | null;
  /** Nearest numbered post — the human-readable anchor. Null until known. */
  readonly nearestMarshalPostId: MarshalPostId | null;
  readonly name: string;
  readonly position: LatLonElevation;
  /**
   * Direction the camera points, in degrees true (0 = north, clockwise).
   *
   * This single field is what lets the app answer "is this backlit at 17:00"
   * directly, instead of drawing a compass overlay and making the user work it
   * out — see ../logic/sun.ts. Null when not yet recorded; auto-filled from
   * device compass when a reference photo is captured in-app (spec §5.1).
   */
  readonly shootingBearing: number | null;
  /** See the safety note on `AccessClassification`. Never auto-assigned. */
  readonly accessClassification: AccessClassification;
  /** Free-text detail: which side of the fence, where marshals move you on. */
  readonly accessNotes: string | null;
  /**
   * When this spot is worth being at — "golden hour", "sundown", "night".
   *
   * Free-text labels rather than a fixed enum, because the useful answer is
   * often venue-specific ("before the sun clears the trees", "last hour of the
   * 24h"). The suggested set in the UI covers the common cases without closing
   * the door on the rest.
   *
   * These are the photographer's own judgement, deliberately separate from the
   * computed light bands in ../logic/sun.ts. §5.2 works out when golden hour
   * *is* for a date and position; this records that the spot is worth using
   * then. Eventually the two join up — "show me spots tagged golden hour, and
   * when golden hour falls on race day" — but one is measured and the other is
   * an opinion, and they should not be stored as the same thing.
   */
  readonly keyTimes: readonly string[];
  /**
   * What the position is physically like — "viewport", "blocking fence",
   * "debris fence", "elevated", "armco only".
   *
   * Separate from `keyTimes` on purpose. One answers *when* to be here, the
   * other *what you are dealing with* when you arrive, and merging them into a
   * single tag cloud makes both harder to scan. Free text for the same reason
   * as keyTimes: the useful vocabulary is venue-specific.
   *
   * Note this is descriptive, not permissive. Whether you are *allowed* to
   * stand somewhere is `accessClassification`, which is a safety field with its
   * own rules (§0.1, §9.1) — a tag saying "viewport" must never be read as
   * permission to be there.
   */
  readonly tags: readonly string[];
  /**
   * Hidden from the map without being deleted.
   *
   * Decluttering, not removal: a hidden spot keeps all its data, still appears
   * in the list under its own tab, and comes straight back. Distinct from
   * `deletedAt`, which is a tombstone for sync (§0.1) and means the record is
   * gone.
   *
   * ── Belongs on UserSpotNote once accounts exist ──────────────────────────
   * Hiding is one person's opinion about clutter, and `Spot` is the canonical,
   * community-owned record (§4.2). With a single local user the distinction is
   * invisible, but the moment spots are shared, one photographer hiding
   * Brünnchen must not hide it for everyone. Move this to `UserSpotNote` with
   * the Milestone 3 account work.
   */
  /**
   * Camera settings that work here.
   *
   * Embedded rather than its own table for now. Spec §4.1 has this as
   * `SpotGearSuggestion` — a per-user, votable, community entity — but that is
   * Milestone 4 and needs accounts to mean anything. These are one
   * photographer's notes, and they migrate into those rows when sharing lands.
   */
  readonly shotSettings: readonly ShotSetting[];
  /**
   * What this position is good for — see `SpotUse`.
   *
   * Never empty. A spot for nothing matches no mode and disappears from the
   * map with nothing left to tap; `normaliseUses` is what keeps that state
   * unreachable, and it runs at both the write and the read boundary.
   */
  readonly uses: readonly SpotUse[];
  readonly isHidden: boolean;
  /**
   * The waypoint this spot belongs to, or null when it stands alone.
   *
   * ── One place, several ways of shooting it ───────────────────────────────
   * A corner is one position on the ground but rarely one photograph: long
   * lens down the straight, wide from the same fence post, panning low
   * through the apex. Those want different bearings, different glass and
   * different notes, which is to say they want to be different spots — but
   * they are emphatically not different *places*, and drawing three pins on
   * one fence post says they are.
   *
   * So members keep every setting of their own and share a waypoint. The map
   * draws the waypoint; the carousel steps between the ways of shooting it.
   *
   * An opaque shared token rather than a pointer to a primary row. If the
   * group were identified by one member's id, deleting that member would
   * either destroy the group or leave the rest pointing at nothing; with a
   * token, membership is simply "same value" and any member can go.
   *
   * Null is the ordinary case and the safe default: a spot with no group is a
   * waypoint of one, and nothing downstream needs to special-case it.
   */
  readonly groupId: SpotGroupId | null;
  /**
   * What this way of shooting is called, under the waypoint's own name.
   *
   * `name` is the place — Brünnchen — and every way of shooting it shares
   * that. This is the part that differs: "long lens down the straight",
   * "low through the apex". Null when a waypoint has only ever had one way,
   * which is most of them, and there is nothing to distinguish.
   *
   * Kept separate rather than folded into `name` because a way is not a
   * place. Renaming the corner should rename it everywhere at once, and
   * naming one approach should not quietly rename the fence post.
   */
  readonly subName: string | null;
  /**
   * How good this way of shooting turned out to be — 1 to 5, or null.
   *
   * Null means "not rated", which is *not* the same as bad and must never
   * sort or filter as zero. Most spots will never be rated; a filter for
   * "3 stars and up" should exclude them, and a filter for "everything"
   * should not.
   *
   * The photographer's own judgement, like `keyTimes` and unlike anything
   * computed. It belongs on `UserSpotNote` once accounts exist, for the same
   * reason `isHidden` does — one person's opinion of a shot must not become
   * everyone's — and moves there with the Milestone 3 work.
   */
  readonly rating: number | null;
  readonly visibility: Visibility;
  readonly createdBy: UserId;
}

/**
 * Create a new spot.
 *
 * Note what this function refuses to do: it will not guess an access
 * classification and it will not make a spot visible to anyone else. Both
 * start at their most conservative value and can only be widened by a
 * deliberate human action elsewhere in the app.
 *
 * `accessClassification` is not even an optional parameter — a caller that
 * knows the answer passes it, a caller that does not gets `Unknown`. There is
 * no code path that derives it.
 */
export function newSpot(input: {
  circuitId: CircuitId;
  eventId?: EventId | null;
  name: string;
  position: LatLonElevation;
  createdBy: UserId;
  nearestMarshalPostId?: MarshalPostId | null;
  shootingBearing?: number | null;
  accessClassification?: AccessClassification;
  accessNotes?: string | null;
  keyTimes?: readonly string[];
  tags?: readonly string[];
  shotSettings?: readonly ShotSetting[];
  uses?: readonly SpotUse[];
  isHidden?: boolean;
  at?: Utc;
}): Spot {
  return {
    id: newId<SpotId>(),
    circuitId: input.circuitId,
    /*
      A new spot stands alone and is unrated.

      Not parameters. Joining a waypoint is an action taken against an
      existing group, and a rating is a judgement formed after the fact —
      neither is something the creating caller can honestly know, and
      offering them here would invite a caller to invent both.
    */
    groupId: null,
    subName: null,
    rating: null,
    eventId: input.eventId ?? null,
    nearestMarshalPostId: input.nearestMarshalPostId ?? null,
    name: input.name,
    position: input.position,
    shootingBearing: input.shootingBearing ?? null,
    accessClassification:
      input.accessClassification ?? AccessClassification.Unknown,
    accessNotes: input.accessNotes ?? null,
    keyTimes: input.keyTimes ?? [],
    tags: input.tags ?? [],
    shotSettings: input.shotSettings ?? [],
    // Through the normaliser rather than `?? DEFAULT`: a caller passing an
    // empty array means "I unticked everything", which must not be stored.
    uses: normaliseUses(input.uses),
    isHidden: input.isHidden ?? false,
    visibility: Visibility.Private,
    createdBy: input.createdBy,
    ...newEntityBase(input.at),
  };
}

/**
 * Guard for the sharing flow — spec §9.1.
 *
 * A spot may not be made public while its access status is undocumented.
 * Publishing an unclassified position is exactly the failure mode §9.1 warns
 * about: it is both a liability and the fastest route to a good position being
 * fenced off.
 *
 * `permissionRequired` spots are separately gated: §9.1 asks for explicit
 * confirmation before those can be shared at all, which is a UI decision, so
 * this returns the reason rather than silently refusing.
 */
export type ShareRefusal =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string }
  | { readonly allowed: false; readonly reason: string; readonly requiresConfirmation: true };

export function canMakePublic(spot: Spot): ShareRefusal {
  if (spot.accessClassification === AccessClassification.Unknown) {
    return {
      allowed: false,
      reason:
        'Access is not yet documented. Classify this spot before sharing it.',
    };
  }
  if (spot.accessClassification === AccessClassification.PermissionRequired) {
    return {
      allowed: false,
      reason:
        'This spot needs permission to access. Confirm you intend to publish it.',
      requiresConfirmation: true,
    };
  }
  return { allowed: true };
}
