/**
 * Event state — the active planning context for a circuit.
 *
 * `activeId === null` is the default map: every spot you have at this circuit.
 * With an event active, the map narrows to that event's selection.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { nowUtc } from '../../core/domain/common';
import {
  type Event,
  type PlanStop,
  newEvent,
  newPlanStop,
} from '../../core/domain/event';
import type {
  CircuitId,
  EventId,
  SessionId,
  SpotId,
  UserGearItemId,
} from '../../core/domain/ids';
import { events as repo } from '../../storage-local/repositories/documentRepositories';
import {
  getActiveEventId,
  setActiveEventId,
} from '../../storage-local/preferences';
import { LOCAL_USER_ID } from './useSpots';

/**
 * @param circuitId the circuit currently on screen — the default for new
 * events, and the one an active event must belong to.
 */
export function useEvents(circuitId: CircuitId) {
  const [events, setEvents] = useState<Event[]>([]);
  const [activeId, setActiveId] = useState<EventId | null>(null);

  // Every circuit's events, so the list can offer one to switch to. The map
  // still narrows by the *active* event, which belongs to exactly one circuit.
  const reload = useCallback(async () => {
    setEvents(await repo.listAll());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Restore whichever event was open last.
   *
   * Android kills backgrounded apps freely, and losing your event on every
   * relaunch means re-picking it repeatedly across a weekend — and, because the
   * file backup only runs for the active event, it also meant nothing was ever
   * written to disk unless you happened to reselect first.
   *
   * Restored only once, and only if the event still exists and belongs to the
   * circuit on screen; the guard below owns every later correction.
   */
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || events.length === 0) return;
    restored.current = true;

    void (async () => {
      const saved = await getActiveEventId();
      if (saved === null) return;
      const event = events.find((e) => e.id === saved);
      if (event && event.circuitId === circuitId) setActiveId(event.id as EventId);
    })();
  }, [events, circuitId]);

  /** Remember the choice, including "none". */
  useEffect(() => {
    void setActiveEventId(activeId);
  }, [activeId]);

  /**
   * An active event must match the circuit on screen.
   *
   * Activating an event switches the circuit to its own — that is the intended
   * direction. But changing circuit *manually* while an event from elsewhere is
   * active would filter the map by spot ids that cannot exist there, leaving an
   * empty map with no explanation. So that case drops the event instead.
   */
  useEffect(() => {
    setActiveId((current) => {
      if (current === null) return null;
      const event = events.find((e) => e.id === current);
      if (!event) return null;
      return event.circuitId === circuitId ? current : null;
    });
  }, [circuitId, events]);

  const active = useMemo(
    () => events.find((e) => e.id === activeId) ?? null,
    [events, activeId],
  );

  /**
   * Create an event, optionally seeding it with existing spots.
   *
   * `seedSpotIds` are references (§4.2) — the same spots, not copies. Passing
   * an empty array is "start clean".
   */
  const create = useCallback(
    async (
      name: string,
      startDate: string | null,
      endDate: string | null,
      seedSpotIds: readonly SpotId[],
      /** Defaults to the circuit on screen. */
      forCircuit: CircuitId = circuitId,
    ) => {
      const event = newEvent({
        circuitId: forCircuit,
        name: name.trim() || 'Untitled event',
        createdBy: LOCAL_USER_ID,
        startDate,
        endDate,
        spotIds: seedSpotIds,
      });
      await repo.save(event);
      await reload();
      setActiveId(event.id);
      return event;
    },
    [circuitId, reload],
  );

  const rename = useCallback(
    async (
      id: EventId,
      name: string,
      startDate: string | null,
      endDate: string | null,
    ) => {
      const existing = await repo.get(id);
      if (!existing) return;
      await repo.save({
        ...existing,
        name,
        startDate,
        endDate,
        updatedAt: nowUtc(),
      });
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: EventId) => {
      await repo.softDelete(id);
      if (activeId === id) setActiveId(null);
      await reload();
    },
    [activeId, reload],
  );

  /**
   * Record which spots an event owns, in one write.
   *
   * Used right after cloning: the copies are made first (they need the event's
   * id), then attached. Doing it through `setSpotIncluded` per spot would read
   * a stale `activeId` from this closure and write nothing.
   */
  const attachSpots = useCallback(
    async (id: EventId, spotIds: readonly SpotId[]) => {
      const existing = await repo.get(id);
      if (!existing) return;
      await repo.save({ ...existing, spotIds, updatedAt: nowUtc() });
      await reload();
    },
    [reload],
  );

  /** Add or remove a spot from the active event. */
  const setSpotIncluded = useCallback(
    async (spotId: SpotId, included: boolean) => {
      if (!activeId) return;
      await repo.setSpotIncluded(activeId, spotId, included);
      await reload();
    },
    [activeId, reload],
  );

  /**
   * Add or remove a gear item from the active event — the toggle behind D4's
   * dropdown. Mirrors `setSpotIncluded` exactly; gear attaches to the event
   * the same way spots do (§ "Open questions", `TASKS-profile.md`).
   */
  const setGearIncluded = useCallback(
    async (gearItemId: UserGearItemId, included: boolean) => {
      if (!activeId) return;
      await repo.setGearIncluded(activeId, gearItemId, included);
      await reload();
    },
    [activeId, reload],
  );

  // ── the plan ──────────────────────────────────────────────────────────────

  const addStop = useCallback(
    async (input: {
      spotId: SpotId;
      day?: string | null;
      arriveAt?: string | null;
      label?: string | null;
      sessionId?: SessionId | null;
    }) => {
      if (!activeId) return null;
      const stop = newPlanStop(input);
      await repo.addStop(activeId, stop);
      await reload();
      return stop;
    },
    [activeId, reload],
  );

  const updateStop = useCallback(
    async (stopId: string, patch: Partial<Omit<PlanStop, 'id' | 'spotId'>>) => {
      if (!activeId) return;
      await repo.updateStop(activeId, stopId, patch);
      await reload();
    },
    [activeId, reload],
  );

  const removeStop = useCallback(
    async (stopId: string) => {
      if (!activeId) return;
      await repo.removeStop(activeId, stopId);
      await reload();
    },
    [activeId, reload],
  );

  const moveStop = useCallback(
    async (stopId: string, toIndex: number) => {
      if (!activeId) return;
      await repo.moveStop(activeId, stopId, toIndex);
      await reload();
    },
    [activeId, reload],
  );

  return {
    events,
    active,
    activeId,
    activate: setActiveId,
    create,
    rename,
    remove,
    setSpotIncluded,
    attachSpots,
    setGearIncluded,
    addStop,
    updateStop,
    removeStop,
    moveStop,
    reload,
  };
}
