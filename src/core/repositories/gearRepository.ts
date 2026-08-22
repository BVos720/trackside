/**
 * Gear-locker contracts — spec §2.3.
 *
 * Mirrors equipmentRepository.ts's shape — async throughout, caller-supplied
 * ids, tombstones only (§0.1) — but scoped to the user rather than an event:
 * a `GearItem` is a standing part of someone's kit, not this weekend's list,
 * so there is `listByUser` where equipment has `listByEvent` and no
 * per-event `save`. See ../domain/gear.ts for why.
 */
import type { GearItem } from '../domain/gear';
import type { UserGearItemId, UserId } from '../domain/ids';

export interface IGearRepository {
  /**
   * One user's whole locker, in the order it was built.
   *
   * Insertion order, same reasoning as `IEquipmentRepository.listByEvent`:
   * grouping bodies from lenses for display is a UI concern
   * (`gear.ts`'s `bodies`/`lenses`), not a storage one.
   */
  listByUser(userId: UserId): Promise<GearItem[]>;
  get(id: UserGearItemId): Promise<GearItem | null>;
  save(item: GearItem): Promise<void>;
  /**
   * Write several items in one go — adding a starter kit of bodies and
   * lenses in one sitting shouldn't be N separate read-modify-write cycles
   * over the whole locker. Same reasoning as `IEquipmentRepository.saveMany`.
   */
  saveMany(items: readonly GearItem[]): Promise<void>;
  softDelete(id: UserGearItemId, at?: string): Promise<void>;
}
