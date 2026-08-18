import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import LightScreen from './src/ui/screens/LightScreen';
import MapScreen from './src/ui/screens/MapScreen';
import SpotSheet from './src/ui/screens/SpotSheet';
import SpotOverview from './src/ui/screens/SpotOverview';
import SpotListScreen from './src/ui/screens/SpotListScreen';
import TimetableScreen from './src/ui/screens/TimetableScreen';
import CircuitScreen from './src/ui/screens/CircuitScreen';
import PlannerScreen from './src/ui/screens/PlannerScreen';
import EventScreen from './src/ui/screens/EventScreen';
import NavigatorPanel from './src/ui/screens/NavigatorPanel';
import { usePosition } from './src/ui/state/usePosition';
import { buildWalkNetwork, routeBetween } from './src/core/logic/route';
import { formatDateRange } from './src/ui/DateRangePicker';
import MainMenu, { type Destination } from './src/ui/MainMenu';
import EventsScreen from './src/ui/screens/EventsScreen';
import { useEvents } from './src/ui/state/useEvents';
import { eventDays } from './src/core/domain/event';
import { spotsForContext } from './src/core/logic/cloneSpots';
import { repositories } from './src/storage-local/repositories/documentRepositories';
import {
  VENUE_VIEW,
  pathLinesFor,
  trackLinesFor,
  type VenueKey,
} from './src/ui/map/style';
import { useSessions } from './src/ui/state/useSessions';
import { snapBesideTrack } from './src/core/logic/track';
import { useSpots, type SpotDraft } from './src/ui/state/useSpots';
import { mediaStore } from './src/storage-local/mediaStore';
import {
  asId,
  type CircuitId,
  type EventId,
  type MediaId,
  type SpotId,
} from './src/core/domain/ids';
import type { ReferenceKind } from './src/core/domain/media';
import { color, radius, space, type, weight } from './src/ui/theme';



/**
 * What the bottom sheet is currently doing.
 *
 * `overview` and `edit` are separate states rather than one panel with a flag,
 * because tapping a pin should show you the spot, not put you in a form where a
 * stray tap edits saved data.
 */
type SheetMode =
  | { kind: 'none' }
  | { kind: 'creating'; at: { latitude: number; longitude: number } }
  | { kind: 'overview'; id: SpotId }
  | { kind: 'edit'; id: SpotId };

/** Set while relocating an existing spot; the next map tap becomes its position. */
type MoveTarget = SpotId | null;

/**
 * Circuit ids, pending real preset data.
 *
 * Spot rows need a stable `circuitId` now, but the `Circuit` presets described
 * in spec §4.1 — name, timezone, layout variants, bounding box — are seeded
 * from JSON per §7 and reserved for human sourcing under §0.2. These are fixed
 * UUID v7 values standing in for that, so spots created today keep their
 * association when the real presets land.
 */
const CIRCUIT_IDS: Record<VenueKey, CircuitId> = {
  nordschleife: asId<CircuitId>('01920000-0000-7000-8000-000000000001'),
  'spa-francorchamps': asId<CircuitId>('01920000-0000-7000-8000-000000000002'),
  zandvoort: asId<CircuitId>('01920000-0000-7000-8000-000000000003'),
  'le-mans': asId<CircuitId>('01920000-0000-7000-8000-000000000004'),
  zolder: asId<CircuitId>('01920000-0000-7000-8000-000000000005'),
};

/** Reverse of CIRCUIT_IDS, so an event's circuit can select its venue. */
const VENUE_FOR_CIRCUIT: Record<string, VenueKey> = Object.fromEntries(
  Object.entries(CIRCUIT_IDS).map(([venue, id]) => [id, venue as VenueKey]),
);

/** Circuit options for the event form, in the order the map lists them. */
const CIRCUIT_CHOICES = (Object.keys(CIRCUIT_IDS) as VenueKey[]).map((v) => ({
  id: CIRCUIT_IDS[v],
  label: VENUE_VIEW[v].label,
}));

export default function App() {
  // Map is home; everything else is a destination reached from the menu.
  const [where, setWhere] = useState<Destination>('map');
  const [menuOpen, setMenuOpen] = useState(false);
  /** Peek or full — the list is a panel over the map, never a separate page. */
  const [listFull, setListFull] = useState(false);
  /** The stop being navigated to, if any. Null means the navigator is closed. */
  const [navStopId, setNavStopId] = useState<string | null>(null);
  const [venue, setVenue] = useState<VenueKey>('nordschleife');

  const circuitId = CIRCUIT_IDS[venue];
  const {
    spots,
    media,
    create,
    update,
    remove,
    moveSpot,
    setHidden,
    addPhoto,
    setKeyImage,
    removePhoto,
    asGeoJson,
    cloneInto,
  } = useSpots(circuitId);

  const {
    events: eventList,
    active: activeEvent,
    activeId: activeEventId,
    activate,
    create: createEvent,
    remove: removeEvent,
    setSpotIncluded,
    attachSpots,
    addStop,
    updateStop,
    removeStop,
    moveStop,
  } = useEvents(circuitId);

  /**
   * The walkable network for this venue, built once per circuit.
   *
   * Tens of thousands of edges, so rebuilding it on every render would be
   * felt. Keyed on `venue` rather than on the data itself because the data is
   * a static import that never changes within a session.
   */
  /**
   * How many permanent spots each circuit holds.
   *
   * The event form needs this for a circuit that is not on screen — "Copies all
   * 12" while looking at somewhere else — so it comes from the repository
   * rather than from the loaded set. Refreshed whenever spots change, which
   * covers a clone having just added some.
   */
  const [spotCounts, setSpotCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, number> = {};
      for (const id of Object.values(CIRCUIT_IDS)) {
        const rows = await repositories.spots.listByCircuit(id);
        out[id] = spotsForContext(rows, null).length;
      }
      if (!cancelled) setSpotCounts(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [spots]);

  const countPermanentSpots = useCallback(
    (circuit: CircuitId) => spotCounts[circuit] ?? 0,
    [spotCounts],
  );

  const walkNetwork = useMemo(() => buildWalkNetwork(pathLinesFor(venue)), [venue]);

  /** The active event's days, so imported headings resolve to real dates. */
  const activeEventDays = useMemo(
    () => (activeEvent ? eventDays(activeEvent) : []),
    [activeEvent],
  );

  const {
    sessions: savedSessions,
    days: sessionDayLabels,
    addMany,
    remove: removeSession,
  } = useSessions(circuitId, activeEventDays, activeEventId);

  /**
   * Sessions as the timetable displays them.
   *
   * Times are formatted in the device's zone, which is right at the circuit and
   * wrong from home — the circuit's own timezone is `Circuit` preset data
   * reserved for human sourcing (§0.2), so nothing here claims otherwise.
   */
  const sessionRows = useMemo(
    () =>
      savedSessions.map((s) => {
        const clock = (iso: string) => {
          const d = new Date(iso);
          return Number.isNaN(d.getTime())
            ? '--:--'
            : `${String(d.getHours()).padStart(2, '0')}:${String(
                d.getMinutes(),
              ).padStart(2, '0')}`;
        };
        return {
          id: s.id,
          title: s.seriesName,
          day: sessionDayLabels[s.eventDayId] ?? '',
          start: clock(s.startTime),
          end: clock(s.endTime),
        };
      }),
    [savedSessions, sessionDayLabels],
  );

  const navStop = useMemo(
    () => activeEvent?.stops.find((s) => s.id === navStopId) ?? null,
    [activeEvent, navStopId],
  );
  const navSpot = useMemo(
    () => (navStop ? (spots.find((s) => s.id === navStop.spotId) ?? null) : null),
    [spots, navStop],
  );

  // Location is only watched while actually navigating: a GPS fix every three
  // seconds for a whole race weekend is a flat battery by lunchtime.
  const { status: positionStatus, fix } = usePosition(navStop !== null);

  /**
   * A clock that ticks while navigating.
   *
   * The leave-by warning is only useful if it changes on its own. Thirty
   * seconds is fine for a countdown measured in minutes and costs almost
   * nothing; a per-second tick would re-run the router sixty times a minute.
   */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!navStop) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [navStop]);

  const [placing, setPlacing] = useState(false);
  const [sheet, setSheet] = useState<SheetMode>({ kind: 'none' });
  const [moving, setMoving] = useState<MoveTarget>(null);
  /**
   * Photos picked before the spot exists.
   *
   * A new spot has no id to attach media to, but making the user save first and
   * then reopen to add pictures is a pointless round trip. Files are held here
   * and written once the spot is created.
   */
  const [pendingPhotos, setPendingPhotos] = useState<
    { file: Blob; kind: ReferenceKind | null; isKey: boolean }[]
  >([]);
  const [mediaUris, setMediaUris] = useState<Record<string, string>>({});

  /**
   * The map shows the active event's selection, or everything when there is
   * none. Filtering here rather than in the repository keeps `spots` as the
   * full set, which the Events screen needs in order to seed a new event.
   */
  /**
   * An event shows its own copies; the default map shows the permanent
   * collection. Ownership rather than a membership list, so a spot can never
   * appear on both — see core/logic/cloneSpots.ts.
   */
  const visibleSpots = useMemo(
    () => spotsForContext(spots, activeEventId),
    [spots, activeEventId],
  );

  const visibleGeoJson = useMemo(() => {
    const shown = new Set<string>(visibleSpots.map((s) => s.id));
    return {
      type: 'FeatureCollection' as const,
      features: asGeoJson.features.filter((f) =>
        shown.has(String(f.properties.id)),
      ),
    };
  }, [asGeoJson, visibleSpots]);

  /**
   * The route drawn on the map while navigating.
   *
   * Split into network and direct legs so the map can style them differently —
   * a straight line across a field must never look like a footpath (see
   * core/logic/route.ts).
   */
  const routeGeoJson = useMemo(() => {
    if (!navSpot) return null;
    const from = fix?.position ?? null;
    if (!from) return null;

    const route = routeBetween(walkNetwork, from, navSpot.position);
    return {
      type: 'FeatureCollection' as const,
      features: route.legs.map((leg) => ({
        type: 'Feature' as const,
        properties: { kind: leg.kind },
        geometry: {
          type: 'LineString' as const,
          coordinates: leg.coordinates.map(
            (c) => [c.longitude, c.latitude] as [number, number],
          ),
        },
      })),
    };
  }, [navSpot, fix, walkNetwork]);

  const activeId = sheet.kind === 'overview' || sheet.kind === 'edit' ? sheet.id : null;
  const activeSpot = useMemo(
    () => spots.find((s) => s.id === activeId) ?? null,
    [spots, activeId],
  );
  const activeMedia = activeId ? (media[activeId] ?? []) : [];
  const sheetOpen = sheet.kind !== 'none';

  /** Resolve storage keys to displayable URIs — bytes never live on the row. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, string> = {};
      for (const rows of Object.values(media)) {
        for (const m of rows) {
          if (!m.storageKey) continue;
          const uri = await mediaStore.getUri(m.storageKey);
          if (uri) out[m.storageKey] = uri;
        }
      }
      if (!cancelled) setMediaUris(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [media]);

  const closeSheet = () => setSheet({ kind: 'none' });

  /**
   * Save closes the sheet.
   *
   * Both for a new spot and an edit — the map is the thing you came back to
   * look at, and leaving a panel over it after saving means an extra dismiss
   * every single time.
   */
  const onSave = async (draft: SpotDraft) => {
    if (sheet.kind === 'edit') {
      await update(sheet.id, draft);
    } else if (sheet.kind === 'creating') {
      // Owned by the active event, so planning never adds to the home map.
      const spot = await create(draft, activeEventId);
      if (activeEventId) await setSpotIncluded(spot.id, true);
      for (const p of pendingPhotos) {
        await addPhoto(spot.id, p.file, p.kind, p.isKey);
      }
      setPendingPhotos([]);
    }
    setSheet({ kind: 'none' });
    setPlacing(false);
  };

  /**
   * Photo picking, web only for now.
   *
   * On device this becomes expo-image-picker plus the §5.1 EXIF path: read
   * coordinates to help place the pin, keep the original local-only, strip all
   * metadata before anything leaves the device.
   */
  const onPickPhoto = useCallback(
    (kind: ReferenceKind | null, isKey: boolean) => {
      const doc = (globalThis as { document?: Document }).document;
      if (!doc) return;

      const input = doc.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        if (activeId) {
          void addPhoto(activeId, file, kind, isKey);
        } else {
          // Creating: hold it until the spot has an id.
          setPendingPhotos((p) => [...p, { file, kind, isKey }]);
        }
      };
      input.click();
    },
    [activeId, addPhoto],
  );

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />

      <View style={styles.body}>
        {where === 'map' || where === 'list' ? (
          <>
            <MapScreen
              key={venue}
              venue={venue}
              spots={visibleGeoJson}
              route={routeGeoJson}
              here={fix?.position ?? null}
              mediaUris={mediaUris}
              placing={where === 'map' && (placing || moving !== null)}
              onMapTap={(at) => {
                // Never place a spot on the racing surface — push it to the
                // verge on the side that was tapped (core/logic/track.ts).
                const snapped =
                  snapBesideTrack(at, trackLinesFor(venue))?.position ?? at;

                if (moving) {
                  void moveSpot(moving, snapped.latitude, snapped.longitude);
                  setSheet({ kind: 'overview', id: moving });
                  setMoving(null);
                  return;
                }
                setSheet({ kind: 'creating', at: snapped });
              }}
              onSpotTap={(id) => {
                setSheet({ kind: 'overview', id: asId<SpotId>(id) });
                setPlacing(false);
              }}
            />

            {/*
              The spot list opens from the map, not the menu: it answers "what
              is that pin", which is a question you only have while looking at
              the map.
            */}
            {where === 'map' && !sheetOpen && !navStop && (
              <Pressable
                onPress={() => {
                  setWhere('list');
                  setPlacing(false);
                }}
                style={({ pressed }) => [
                  styles.listButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.listButtonLabel}>
                  Spots
                  {visibleSpots.length > 0 ? ` · ${visibleSpots.length}` : ''}
                </Text>
              </Pressable>
            )}

            {where === 'map' && !sheetOpen && !navStop && (
              <Pressable
                onPress={() => setPlacing((p) => !p)}
                style={({ pressed }) => [
                  styles.addButton,
                  placing && styles.addButtonActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[styles.addLabel, placing && styles.addLabelActive]}
                >
                  {moving ? 'Tap to move' : placing ? 'Tap the map' : '+ Spot'}
                </Text>
              </Pressable>
            )}

            {sheet.kind === 'overview' && activeSpot && (
              <SpotOverview
                spot={activeSpot}
                media={activeMedia}
                mediaUris={mediaUris}
                onEdit={() => setSheet({ kind: 'edit', id: activeSpot.id })}
                onMove={() => {
                  setMoving(activeSpot.id);
                  setSheet({ kind: 'none' });
                }}
                onDelete={() => {
                  void remove(activeSpot.id);
                  closeSheet();
                }}
                onClose={closeSheet}
                onSetKey={(mediaId) =>
                  void setKeyImage(activeSpot.id, asId<MediaId>(mediaId))
                }
              />
            )}

            {(sheet.kind === 'creating' || sheet.kind === 'edit') && (
              <SpotSheet
                spot={sheet.kind === 'edit' ? activeSpot : null}
                draftPosition={sheet.kind === 'creating' ? sheet.at : null}
                media={activeMedia}
                mediaUris={mediaUris}
                onSave={onSave}
                onCancel={() =>
                  // Cancelling an edit returns to the overview it came from,
                  // rather than dumping you back to a bare map.
                  sheet.kind === 'edit'
                    ? setSheet({ kind: 'overview', id: sheet.id })
                    : (setPendingPhotos([]), closeSheet())
                }
                onPickPhoto={onPickPhoto}
                onRemovePhoto={(id) => void removePhoto(asId<MediaId>(id))}
              />
            )}
            {/*
              The list lives at the bottom of the map, not on its own page.
              "Which spot do I walk to" is a question about position, and
              answering it with the map hidden means flipping back and forth to
              place every name.
            */}
            {navStop && !sheetOpen && where === 'map' && (
              <NavigatorPanel
                stop={navStop}
                spot={navSpot}
                network={walkNetwork}
                fix={fix}
                status={positionStatus}
                now={now}
                onClose={() => setNavStopId(null)}
              />
            )}

            {where === 'list' && !sheetOpen && (
              <View
                style={[styles.listPanel, listFull && styles.listPanelFull]}
              >
                <View style={styles.listHeader}>
                  <Pressable
                    onPress={() => setListFull((v) => !v)}
                    style={styles.grabZone}
                  >
                    <View style={styles.grab} />
                  </Pressable>
                  <Pressable
                    onPress={() => setWhere('map')}
                    hitSlop={10}
                    style={({ pressed }) => [
                      styles.listClose,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.listCloseLabel}>Close</Text>
                  </Pressable>
                </View>

                <SpotListScreen
                  spots={visibleSpots}
                  media={media}
                  mediaUris={mediaUris}
                  onOpen={(id) => {
                    // The overview is a bottom panel too, so the list steps
                    // aside for it — the map stays put underneath either way.
                    setWhere('map');
                    setSheet({ kind: 'overview', id });
                  }}
                  onToggleHidden={(id, hidden) => void setHidden(id, hidden)}
                />
              </View>
            )}
          </>
        ) : where === 'times' ? (
          <TimetableScreen
            circuitLabel={VENUE_VIEW[venue].label}
            eventName={activeEvent?.name ?? null}
            eventDates={
              activeEvent
                ? formatDateRange(activeEvent.startDate, activeEvent.endDate)
                : null
            }
            onBack={() => setWhere('events')}
            savedCount={savedSessions.length}
            onCommit={(pending) =>
              void addMany(
                pending.map((p) => ({
                  day: p.day,
                  title: p.title,
                  start: p.start,
                  end: p.end,
                  kind: p.kind,
                })),
              )
            }
          />
        ) : where === 'events' ? (
          <EventsScreen
            circuitLabel={VENUE_VIEW[venue].label}
            circuitId={circuitId}
            circuits={CIRCUIT_CHOICES}
            events={eventList}
            activeId={activeEventId}
            spotCount={visibleSpots.length}
            spotCountFor={countPermanentSpots}
            onActivate={(id) => {
              // An event's spots only exist at its own circuit, so activating
              // one takes the map there.
              const target = eventList.find((e) => e.id === id);
              if (target) {
                const key = VENUE_FOR_CIRCUIT[target.circuitId];
                if (key && key !== venue) setVenue(key);
              }
              activate(id as EventId | null);
              // Choosing "Default map" has nowhere else to go; an event opens
              // its own page, which onOpen handles.
              if (id === null) setWhere('map');
            }}
            onCreate={(name, from, to, seedFromSpots, forCircuit) => {
              const key = VENUE_FOR_CIRCUIT[forCircuit];
              if (key && key !== venue) setVenue(key);
              void (async () => {
                const event = await createEvent(name, from, to, [], forCircuit);
                if (!seedFromSpots) return;
                // Copies, not references: the event owns them, so nothing done
                // here can damage the collection they came from.
                const copies = await cloneInto(forCircuit, event.id);
                await attachSpots(
                  event.id,
                  copies.map((c) => c.id),
                );
              })();
            }}
            onOpen={() => setWhere('event')}
            onDelete={(id) => void removeEvent(id)}
          />
        ) : where === 'event' ? (
          activeEvent ? (
            <EventScreen
              event={activeEvent}
              circuitLabel={VENUE_VIEW[venue].label}
              spots={visibleSpots}
              network={walkNetwork}
              sessions={sessionRows}
              onCommitSessions={(pending) =>
                void addMany(
                  pending.map((p) => ({
                    day: p.day,
                    title: p.title,
                    start: p.start,
                    end: p.end,
                    kind: p.kind,
                  })),
                )
              }
              onRemoveSession={(id) => void removeSession(asId(id))}
              onAddStop={(spotId, day) => void addStop({ spotId, day })}
              onUpdateStop={(stopId, patch) => void updateStop(stopId, patch)}
              onRemoveStop={(stopId) => void removeStop(stopId)}
              onMoveStop={(stopId, to) => void moveStop(stopId, to)}
              onNavigate={(stopId) => {
                setNavStopId(stopId);
                setWhere('map');
              }}
              onOpenMap={() => setWhere('map')}
              onBack={() => setWhere('events')}
              onDelete={() => {
                void removeEvent(activeEvent.id);
                setWhere('events');
              }}
            />
          ) : (
            <View style={styles.emptyPlan}>
              <Text style={styles.emptyPlanTitle}>No event open</Text>
              <Pressable
                onPress={() => setWhere('events')}
                style={({ pressed }) => [
                  styles.emptyPlanBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.emptyPlanBtnLabel}>Go to Events</Text>
              </Pressable>
            </View>
          )
        ) : where === 'plan' ? (
          activeEvent ? (
            <PlannerScreen
              event={activeEvent}
              spots={spots}
              network={walkNetwork}
              onAddStop={(spotId, day) => void addStop({ spotId, day })}
              onUpdateStop={(stopId, patch) => void updateStop(stopId, patch)}
              onRemoveStop={(stopId) => void removeStop(stopId)}
              onMoveStop={(stopId, to) => void moveStop(stopId, to)}
              onNavigate={(stopId) => {
                setNavStopId(stopId);
                setWhere('map');
              }}
            />
          ) : (
            <View style={styles.emptyPlan}>
              <Text style={styles.emptyPlanTitle}>No event active</Text>
              <Text style={styles.emptyPlanBody}>
                A plan belongs to an event. Pick one in Events, or make a new
                one, then come back here.
              </Text>
              <Pressable
                onPress={() => setWhere('events')}
                style={({ pressed }) => [
                  styles.emptyPlanBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.emptyPlanBtnLabel}>Go to Events</Text>
              </Pressable>
            </View>
          )
        ) : where === 'circuit' ? (
          <CircuitScreen
            venue={venue}
            onChange={(v) => {
              setVenue(v);
              setWhere('map');
            }}
          />
        ) : (
          <LightScreen />
        )}
      </View>



      {!sheetOpen && (
        <MainMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          venue={venue}
          eventName={activeEvent?.name ?? null}
          counts={{
            spots: visibleSpots.length,
            sessions: savedSessions.length,
            events: eventList.length,
            stops: activeEvent?.stops.length ?? 0,
          }}
          onNavigate={setWhere}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  body: { flex: 1 },
  pressed: { opacity: 0.7 },

  addButton: {
    position: 'absolute',
    // Bottom right: the menu owns the top left, and this is the one control
    // reached one-handed while holding a camera.
    right: space.md,
    bottom: space.md,
    height: 52,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
  },
  addButtonActive: { backgroundColor: color.accent, borderColor: color.accent },

  listButton: {
    position: 'absolute',
    left: space.md,
    bottom: space.md,
    height: 52,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
  },
  listButtonLabel: {
    color: color.text,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  addLabel: { color: color.text, fontSize: type.body, fontWeight: weight.bold },
  addLabelActive: { color: '#0B0D10' },

  /**
   * Bottom panel heights.
   *
   * Peek shows a few rows and still leaves most of the map readable; the handle
   * takes it full for a long list. Two fixed stops rather than a drag gesture —
   * one tap with gloves on beats a precise drag.
   */
  emptyPlan: { flex: 1, padding: space.md, paddingTop: 120 },
  emptyPlanTitle: {
    color: color.text,
    fontSize: type.title,
    fontWeight: weight.bold,
  },
  emptyPlanBody: {
    color: color.textMuted,
    fontSize: type.body,
    lineHeight: 21,
    marginTop: space.sm,
  },
  emptyPlanBtn: {
    marginTop: space.lg,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.accent,
  },
  emptyPlanBtnLabel: {
    color: color.onAccent,
    fontSize: type.body,
    fontWeight: weight.bold,
  },

  listPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '46%',
    backgroundColor: color.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
  },
  listPanelFull: { height: '84%' },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: space.sm,
  },
  grabZone: { flex: 1, alignItems: 'center', paddingVertical: space.xs },
  grab: { width: 44, height: 4, borderRadius: 2, backgroundColor: color.border },
  listClose: {
    position: 'absolute',
    right: space.sm,
    height: 36,
    paddingHorizontal: space.sm,
    justifyContent: 'center',
  },
  listCloseLabel: {
    color: color.textMuted,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
});
