/**
 * Equipment checklist contracts — spec §2.3.
 *
 * Mirrors entryRepository.ts exactly: async throughout, caller-supplied ids,
 * tombstones only (§0.1). The checklist and the entry list are the same shape
 * of thing — a flat, per-event collection with a boolean and its timestamp —
 * so the same rules apply for the same reasons; see the note there.
 */
import type { EquipmentItem } from '../domain/equipment';
import type { EquipmentItemId, EventId } from '../domain/ids';

export interface IEquipmentRepository {
  /**
   * One event's checklist, in the order it was built.
   *
   * Insertion order, not category: the UI groups by category for reading
   * (`EQUIPMENT_CATEGORY_LABELS`), and within a group the order items were
   * added — usually the order they came from the previous event's list — is
   * the one worth keeping.
   */
  listByEvent(eventId: EventId): Promise<EquipmentItem[]>;
  get(id: EquipmentItemId): Promise<EquipmentItem | null>;
  save(item: EquipmentItem): Promise<void>;
  /**
   * Write a seeded checklist in one go.
   *
   * Seeding a new event's list from the previous one (`seedChecklistFromPrevious`
   * in `../logic/equipment.ts`) produces every row at once, and one write makes
   * that atomic — either the checklist is there or it is not, never half of it.
   * Same reasoning as `IEntryRepository.saveMany`.
   */
  saveMany(items: readonly EquipmentItem[]): Promise<void>;
  /**
   * Tick an item into the bag, or out of it.
   *
   * On the repository rather than left to `save` because the flag and its
   * timestamp have to move together (see `setPacked` in the domain), and this
   * is the one write that happens while packing, with both hands busy.
   */
  setPacked(id: EquipmentItemId, packed: boolean, at?: string): Promise<void>;
  softDelete(id: EquipmentItemId, at?: string): Promise<void>;
}
