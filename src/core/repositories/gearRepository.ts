/**
 * Gear-locker contracts — spec §2.3.
 *
 * Async throughout, caller-supplied ids, tombstones only (§0.1) — and scoped
 * to the user rather than to an event, unlike its siblings here: a `GearItem`
 * is a standing part of someone's kit rather than this weekend's list, so it
 * has `listByUser` where the others have `listByEvent`. See ../domain/gear.ts
 * for why.
 */
import type { GearItem } from '../domain/gear';
import type { UserGearItemId, UserId } from '../domain/ids';

export interface IGearRepository {
  /**
   * One user's whole locker, in the order it was built.
   *
   * Insertion order:
   * grouping bodies from lenses for display is a UI concern
   * (`gear.ts`'s `bodies`/`lenses`), not a storage one.
   */
  listByUser(userId: UserId): Promise<GearItem[]>;
  get(id: UserGearItemId): Promise<GearItem | null>;
  save(item: GearItem): Promise<void>;
  /**
   * Write several items in one go — adding a starter kit of bodies and
   * lenses in one sitting shouldn't be N separate read-modify-write cycles
   * over the whole locker.
   */
  saveMany(items: readonly GearItem[]): Promise<void>;
  softDelete(id: UserGearItemId, at?: string): Promise<void>;
}
