/**
 * Waypoint layouts — a named set of spots, shareable as a file.
 *
 * An event bundle carries a whole weekend: the event, its timetable, its entry
 * list with the ticks. A layout carries only *where to stand*, and it is meant
 * to be given away — "here is how I shoot Spa" — so it is a different thing
 * with different rules, not a bundle with fields removed.
 *
 * ── What deliberately cannot travel ───────────────────────────────────────
 * **Access classification.** This is the important one, and it is enforced by
 * the format rather than by a rule somewhere: `LayoutSpot` has no field for it.
 *
 * `AccessClassification` in core/domain/spot.ts is emphatic that nothing may
 * infer it, because "a wrong `official` on a spot is an instruction to a
 * stranger to stand somewhere that could get them hurt". A shared layout is
 * exactly that stranger. Carrying `official` across would take one person's
 * claim about one weekend — a pass they held, a gate that was open, a marshal
 * who waved them through — and restate it to somebody else as a property of
 * the place.
 *
 * So an imported spot arrives `Unknown`, which the app already renders as
 * *find out before you go*. Not a degradation: it is the honest classification
 * for somewhere nobody at this end has checked. The notes still travel as
 * text, so "behind the fence at the exit, need a paddock pass" is preserved as
 * a human sentence — read by a person, not acted on by the app.
 *
 * **Photographs.** The bytes are not in the file and could not usefully be:
 * they are large, and §5.1/§9.4 treat a reference photo as personal data with
 * EXIF that is only stripped on a best-effort basis. A layout is a map, not an
 * album.
 *
 * **Ids, and anything tying a spot to its origin.** No spot id, no event id, no
 * timestamps, no sync state. An imported spot is a *new* record on this device,
 * minted here. Carrying ids would mean two devices holding different spots
 * under the same identity — which is the one thing a future sync could not
 * reconcile, and §0.1's tombstones assume identity means something.
 */
import { Visibility, type LatLonElevation, type Utc } from '../domain/common';
import type { CircuitId, SpotId } from '../domain/ids';
import { AccessClassification, type Spot, type SpotUse } from '../domain/spot';

export const LAYOUT_FORMAT = 'trackside.layout.v1' as const;

/**
 * One spot, as it travels.
 *
 * Every field here is something a person chose to write down about a place.
 * Nothing here is an assertion the app will act on — see the header on why
 * access classification is absent.
 */
export interface LayoutSpot {
  readonly name: string;
  readonly position: LatLonElevation;
  /** Degrees from north, or null. Which way the camera points, not where you stand. */
  readonly shootingBearing: number | null;
  /** Free text, preserved verbatim. Read by a human; never parsed. */
  readonly accessNotes: string | null;
  readonly keyTimes: readonly string[];
  readonly tags: readonly string[];
  readonly uses: readonly SpotUse[];
}

export interface SpotLayout {
  readonly format: typeof LAYOUT_FORMAT;
  /** When the file was written, ISO 8601. Informational only. */
  readonly exportedAt: string;
  /** What the author called it — "Spa, wet weather" rather than a filename. */
  readonly name: string;
  /**
   * The circuit these belong to.
   *
   * A layout for Spa is not merely unhelpful at the Nürburgring, it is
   * dangerous nonsense: the positions would land in fields several hundred
   * kilometres from any circuit, or worse, plausibly near one. Import refuses
   * on a mismatch rather than translating, because there is no translation.
   */
  readonly circuitId: CircuitId;
  readonly spots: readonly LayoutSpot[];
}

/** Reduce a stored spot to what a layout carries. */
export function toLayoutSpot(spot: Spot): LayoutSpot {
  return {
    name: spot.name,
    position: spot.position,
    shootingBearing: spot.shootingBearing,
    accessNotes: spot.accessNotes,
    keyTimes: [...spot.keyTimes],
    tags: [...spot.tags],
    uses: [...spot.uses],
  };
}

/**
 * Build a shareable layout from spots that are already on this device.
 *
 * `spots` is filtered to the given circuit rather than trusted: exporting the
 * "Spa" layout while a Nürburgring spot is in the list would produce a file
 * that is wrong in the way `circuitId` exists to prevent.
 */
export function buildSpotLayout(input: {
  readonly name: string;
  readonly circuitId: CircuitId;
  readonly spots: readonly Spot[];
  readonly now?: Date;
}): SpotLayout {
  return {
    format: LAYOUT_FORMAT,
    exportedAt: (input.now ?? new Date()).toISOString(),
    name: input.name.trim(),
    circuitId: input.circuitId,
    spots: input.spots
      .filter((s) => s.circuitId === input.circuitId && s.deletedAt === null)
      .map(toLayoutSpot),
  };
}

/** Why a layout could not be imported. Null when it can. */
export type LayoutRejection =
  | 'not-a-layout'
  | 'unsupported-version'
  | 'wrong-circuit'
  | 'empty';

/**
 * Check a parsed file before anything is written.
 *
 * Separate from the import itself so a screen can say *why* it will not take a
 * file — "that layout is for Spa" is a useful sentence, and "import failed" is
 * not. Nothing here mutates.
 */
export function inspectLayout(
  value: unknown,
  expectedCircuit: CircuitId,
): LayoutRejection | null {
  if (typeof value !== 'object' || value === null) return 'not-a-layout';
  const l = value as Partial<SpotLayout>;

  if (typeof l.format !== 'string' || !l.format.startsWith('trackside.layout.')) {
    return 'not-a-layout';
  }
  if (l.format !== LAYOUT_FORMAT) return 'unsupported-version';
  if (!Array.isArray(l.spots)) return 'not-a-layout';
  if (l.circuitId !== expectedCircuit) return 'wrong-circuit';
  if (l.spots.length === 0) return 'empty';

  return null;
}

/**
 * Turn a layout into spots for this device.
 *
 * `mintId` is passed in rather than called here so this stays pure and
 * testable — the same reason the rest of `core/logic` takes its clock and its
 * ids as arguments.
 *
 * Every spot comes back `Unknown` and unowned by any event. See the header:
 * the classification is not withheld because the data is untrusted in some
 * vague sense, it is withheld because nobody at this end has been there.
 */
export function spotsFromLayout(
  layout: SpotLayout,
  mintId: () => SpotId,
  /**
   * Who owns the imported spots — the person importing, not the author.
   *
   * These are new records on this device. Carrying the author across would
   * make somebody else the owner of rows only this device holds, which is
   * exactly the ambiguity §0.1 identity exists to avoid. Provenance belongs in
   * the layout name a person reads, not in a field the app acts on.
   */
  createdBy: Spot['createdBy'],
  now: Date = new Date(),
): Omit<Spot, 'syncState'>[] {
  const at = now.toISOString() as Utc;

  return layout.spots.map((s) => ({
    id: mintId(),
    circuitId: layout.circuitId,
    // A layout describes places, not ways of shooting them, and carries
    // nobody's opinion of the results.
    groupId: null,
    subName: null,
    rating: null,
    // A layout is not a weekend. Imported spots land on the home map, and are
    // taken into an event the same way any other spot is.
    eventId: null,
    nearestMarshalPostId: null,
    name: s.name,
    position: s.position,
    shootingBearing: s.shootingBearing,
    accessClassification: AccessClassification.Unknown,
    accessNotes: s.accessNotes,
    keyTimes: [...s.keyTimes],
    tags: [...s.tags],
    shotSettings: [],
    uses: [...s.uses],
    isHidden: false,
    /*
     * Private, as the spot factory always sets it.
     *
     * An imported layout must not arrive already shareable onward. §9.1 gates
     * publishing on a human decision about a specific spot, and a spot nobody
     * here has visited is the last thing that should skip it.
     */
    visibility: Visibility.Private,
    createdBy,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  }));
}

/** A sentence for the user. Never a code. */
export function describeRejection(
  rejection: LayoutRejection,
  circuitLabel: string,
): string {
  switch (rejection) {
    case 'not-a-layout':
      return 'That file is not a Trackside layout.';
    case 'unsupported-version':
      return 'That layout was made by a newer version of Trackside.';
    case 'wrong-circuit':
      return `That layout is for a different circuit, not ${circuitLabel}.`;
    case 'empty':
      return 'That layout has no spots in it.';
  }
}
