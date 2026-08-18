/**
 * Per-user notes attached to a canonical spot — spec §4.1, §4.2.
 *
 * ── Why this is a separate entity ──────────────────────────────────────────
 *
 * Spec §4.2 calls the `Spot` / `UserSpotNote` split non-negotiable, and the
 * reason is worth restating because the shortcut is tempting every single time
 * someone adds a personal field.
 *
 * If personal opinion lived on `Spot`, two hundred photographers documenting
 * Brünnchen would produce two hundred overlapping pins within thirty metres of
 * each other, and the map would become unreadable at exactly the venue where
 * it matters most. Worse, it is not reversible: once the duplicates exist,
 * merging them means adjudicating which of two hundred people owns the
 * position.
 *
 * So: the position is singular and shared. What you think about it is yours.
 * Sharing means promoting a note's spot to canonical — never copying a pin.
 */
import type { EntityBase, Visibility } from './common';
import type { SpotId, UserId, UserSpotNoteId } from './ids';

export interface UserSpotNote extends EntityBase {
  readonly id: UserSpotNoteId;
  readonly spotId: SpotId;
  readonly userId: UserId;
  readonly personalNotes: string | null;
  /** 1–5, or null if never rated. */
  readonly rating: number | null;
  readonly visibility: Visibility;
}
