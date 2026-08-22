import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import MapScreen from './src/ui/screens/MapScreen';
import SpotSheet from './src/ui/screens/SpotSheet';
import SpotOverview from './src/ui/screens/SpotOverview';
import SpotListScreen from './src/ui/screens/SpotListScreen';
import TimetableScreen from './src/ui/screens/TimetableScreen';
import CircuitScreen from './src/ui/screens/CircuitScreen';
import ProfileScreen from './src/ui/screens/ProfileScreen';
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
import {
  buildEventBundle,
  describeBundle,
  type EventBundle,
} from './src/core/logic/eventBundle';
import {
  describeImport,
  inspectBundle,
  planImport,
  type ImportMode,
  type LocalState,
} from './src/core/logic/importBundle';
import {
  FILES_SUPPORTED,
  eventsFolderUri,
  importBundleFromPicker,
  listEventBundles,
  readBundleFile,
  saveEventBundle,
} from './src/storage-local/eventFiles';
import { applyImport, readLocalState } from './src/storage-local/importEvent';
import {
  getProfileName,
  getSpotUse,
  getVenue,
  setProfileName as setProfileNamePreference,
  setSpotUse as setSpotUsePreference,
  setVenue as setVenuePreference,
} from './src/storage-local/preferences';
import { ALL_SPOT_USES, SpotUse } from './src/core/domain/spot';
import { countByUse, spotsForUse } from './src/core/logic/spotUse';
import { spotsForContext } from './src/core/logic/cloneSpots';
import { withinBounds } from './src/core/logic/geo';
import { repositories } from './src/storage-local/repositories/documentRepositories';
import {
  VENUE_VIEW,
  pathWaysFor,
  trackLinesFor,
  type VenueKey,
} from './src/ui/map/style';
import { useSessions } from './src/ui/state/useSessions';
import { useEntries } from './src/ui/state/useEntries';
import { useEquipment } from './src/ui/state/useEquipment';
import { useWeather } from './src/ui/state/useWeather';
import { snapBesideTrack } from './src/core/logic/track';
import { useSpots, type SpotDraft } from './src/ui/state/useSpots';
import { mediaStore } from './src/storage-local/mediaStore';
import { pickImage } from './src/storage-local/pickImage';
import {
  asId,
  type CircuitId,
  type EventId,
  type MediaId,
  type SpotId,
} from './src/core/domain/ids';
import type { ReferenceKind } from './src/core/domain/media';
import {
  MENU_HEIGHT,
  MENU_TOP,
  ThemeProvider,
  color,
  radius,
  space,
  type,
  weight,
} from './src/ui/theme';



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
  suzuka: asId<CircuitId>('01920000-0000-7000-8000-000000000006'),
  fuji: asId<CircuitId>('01920000-0000-7000-8000-000000000007'),
};

/**
 * IANA timezone per venue, standing in for `Circuit.timezone` for the same
 * reason `CIRCUIT_IDS` above stands in for the rest of the `Circuit` preset —
 * spec §4.1's presets are seeded from JSON and reserved for human sourcing
 * under §0.2, which is about facts an official document has to confirm
 * (`MarshalPost.officialNumber`, in particular). A circuit's timezone is not
 * that kind of fact — it is public, undisputed geography — so a small fixed
 * table here is enough until the real presets land.
 */
const VENUE_TIMEZONE: Record<VenueKey, string> = {
  nordschleife: 'Europe/Berlin',
  'spa-francorchamps': 'Europe/Brussels',
  zandvoort: 'Europe/Amsterdam',
  'le-mans': 'Europe/Paris',
  zolder: 'Europe/Brussels',
  suzuka: 'Asia/Tokyo',
  fuji: 'Asia/Tokyo',
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

/**
 * The map runs edge to edge; only the controls step around the system UI.
 *
 * React Native's own `SafeAreaView` was doing this job and does nothing at all
 * on Android — which is why the menu sat under the clock and the 2D toggle
 * under the battery icon. `react-native-safe-area-context` reports real insets
 * on both platforms.
 *
 * Insetting the whole app would be the easy fix and the wrong one: it would
 * letterbox the map behind black bars, and on a phone at a circuit the map is
 * the thing you want every pixel of. So the container stays full-bleed and each
 * floating control offsets itself.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppShell() {
  const insets = useSafeAreaInsets();
  // Map is home; everything else is a destination reached from the menu.
  const [where, setWhere] = useState<Destination>('map');
  const [menuOpen, setMenuOpen] = useState(false);
  /** Peek or full — the list is a panel over the map, never a separate page. */
  const [listFull, setListFull] = useState(false);
  /** The stop being navigated to, if any. Null means the navigator is closed. */
  const [navStopId, setNavStopId] = useState<string | null>(null);
  const [venue, setVenue] = useState<VenueKey>('nordschleife');

  /**
   * The circuit you were last looking at, restored on launch.
   *
   * Without this the app opens at the Nürburgring every time, which is wrong
   * for anyone standing at Spa — and it silently broke the file backup, since
   * the active event is only restored when it belongs to the circuit on screen.
   * A default that is right once a week is a default that is wrong six days out
   * of seven.
   */
  useEffect(() => {
    void (async () => {
      const saved = await getVenue();
      if (saved !== null && saved in VENUE_VIEW) setVenue(saved as VenueKey);
    })();
  }, []);

  useEffect(() => {
    void setVenuePreference(venue);
  }, [venue]);

  /**
   * Camera positions or watching positions.
   *
   * Photography is the default because that is what the app was built for and
   * what every existing spot is. Restored on launch for the same reason the
   * venue is: it describes why you came, not which view you last tapped.
   */
  const [spotUse, setSpotUse] = useState<SpotUse>(SpotUse.Photography);
  useEffect(() => {
    void (async () => {
      const saved = await getSpotUse();
      if (saved !== null && ALL_SPOT_USES.includes(saved as SpotUse)) {
        setSpotUse(saved as SpotUse);
      }
    })();
  }, []);

  useEffect(() => {
    void setSpotUsePreference(spotUse);
  }, [spotUse]);

  /**
   * The profile's display name, restored on launch. Null means unnamed —
   * see `setProfileName`.
   */
  const [profileName, setProfileNameState] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const saved = await getProfileName();
      setProfileNameState(saved);
    })();
  }, []);

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
    reload: reloadSpots,
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
    reload: reloadEvents,
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

  const walkNetwork = useMemo(() => buildWalkNetwork(pathWaysFor(venue)), [venue]);

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
    reload: reloadSessions,
  } = useSessions(circuitId, activeEventDays, activeEventId);

  const {
    entries: fieldEntries,
    addParsed: addParsedEntries,
    setPhotographed: setEntryPhotographed,
    remove: removeEntry,
    reload: reloadEntries,
  } = useEntries(activeEventId);

  const {
    items: checklist,
    addItem: addEquipmentItem,
    setPacked: setEquipmentPacked,
    remove: removeEquipmentItem,
    seedForNewEvent: seedEquipmentForNewEvent,
    reload: reloadEquipment,
  } = useEquipment(activeEventId);

  /** The checklist as the equipment screen displays it. */
  const equipmentRows = useMemo(
    () =>
      checklist.map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        packed: i.packed,
      })),
    [checklist],
  );

  /**
   * The circuit's position and timezone, for the weather fetch.
   *
   * `VENUE_VIEW[venue].centre` is `[longitude, latitude]` — see map/style.ts.
   */
  const circuitPosition = useMemo(
    () => ({
      latitude: VENUE_VIEW[venue].centre[1],
      longitude: VENUE_VIEW[venue].centre[0],
    }),
    [venue],
  );

  const {
    display: weatherDisplay,
    refresh: refreshWeather,
    refreshing: weatherRefreshing,
    error: weatherError,
  } = useWeather(activeEvent, activeEventId, circuitPosition, VENUE_TIMEZONE[venue]);

  /** The field as the entry-list screen displays it — Entry, minus the parts it does not need. */
  const entryRows = useMemo(
    () =>
      fieldEntries.map((e) => ({
        id: e.id,
        number: e.number,
        className: e.className,
        team: e.team,
        drivers: e.drivers,
        photographed: e.photographed,
      })),
    [fieldEntries],
  );

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

  /**
   * Watched while the map is on screen, not only while navigating.
   *
   * Showing where you are and which way you face is most of the value at a
   * circuit, and it has to be there before you start navigating — you use it to
   * decide *whether* to move. It still stops the moment you leave the map, so a
   * weekend of reading the timetable is not a weekend of GPS.
   */
  const { status: positionStatus, fix, heading } = usePosition(where === 'map');

  /**
   * Is the fix actually at this circuit?
   *
   * "Add my current location" is nonsense from home — it would drop a spot in
   * Breda on a map of the Eifel. The check is against the venue's extract
   * bounds rather than the 300m corridor, so the car park and the walk in still
   * count (see core/logic/geo.ts).
   */
  const atVenue = useMemo(
    () => (fix ? withinBounds(fix.position, VENUE_VIEW[venue].bounds) : false),
    [fix, venue],
  );

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
    {
      file: Blob;
      kind: ReferenceKind | null;
      isKey: boolean;
      /** For showing it before it is written. Revoked once the spot is saved. */
      previewUri: string | null;
    }[]
  >([]);
  const [mediaUris, setMediaUris] = useState<Record<string, string>>({});

  /**
   * Release preview handles for photos that were never saved.
   *
   * Only meaningful on web, where a preview is an object URL held by the
   * document until it is revoked. Abandoning a half-filled spot is the common
   * case — you mark one, think better of it, and cancel — so this is the path
   * that leaks if it is forgotten.
   */
  const revokePendingPreviews = useCallback(() => {
    for (const p of pendingPhotos) {
      if (p.previewUri?.startsWith('blob:')) URL.revokeObjectURL(p.previewUri);
    }
  }, [pendingPhotos]);

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

  /**
   * The same set, narrowed to what this mode is for.
   *
   * ── Deliberately *not* folded into `visibleSpots` ─────────────────────────
   * `visibleSpots` is what the event owns, and it is what gets written into the
   * backup bundle and what the planner schedules against. Filtering it by mode
   * would mean saving a backup while in spectating mode quietly dropped every
   * camera position from the file — a data-loss bug whose only symptom is a
   * restore months later that is missing half the weekend.
   *
   * So the mode narrows what is *drawn and listed*, and nothing else. Anything
   * that persists, plans or exports reads the unfiltered set.
   */
  const spotsInMode = useMemo(
    () => spotsForUse(visibleSpots, spotUse),
    [visibleSpots, spotUse],
  );

  /** Counted over the unfiltered set, so each side of the switch is honest. */
  const useCounts = useMemo(() => countByUse(visibleSpots), [visibleSpots]);

  const visibleGeoJson = useMemo(() => {
    const shown = new Set<string>(spotsInMode.map((s) => s.id));
    return {
      type: 'FeatureCollection' as const,
      features: asGeoJson.features.filter((f) =>
        shown.has(String(f.properties.id)),
      ),
    };
  }, [asGeoJson, spotsInMode]);

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

    // The racing surface is a barrier, not scenery: a straight line across it
    // is never a suggestion worth drawing (core/logic/route.ts).
    const route = routeBetween(
      walkNetwork,
      from,
      navSpot.position,
      trackLinesFor(venue),
      // GPS is good to 5-25 m and a circuit is about 12 m wide, so the fix
      // routinely lands on the racing surface. Passing the accuracy lets the
      // router decline to assert which side you are on.
      fix?.accuracyMetres ?? 0,
    );
    /*
     * A blocked route is drawn as nothing at all.
     *
     * When the only line we have crosses the circuit, putting it on the map is
     * worse than putting nothing there: it is an instruction to walk onto a
     * live track, drawn in the same blue as every route that is safe. The panel
     * explains instead, and keeps looking as the fix moves.
     */
    if (route.blocked) return null;

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

  /**
   * The active event, written out as a file whenever it changes.
   *
   * Debounced because a bundle is rewritten whole and edits arrive in bursts —
   * typing a stop's label fires per keystroke commit, and rewriting the file
   * each time is pointless churn on flash storage.
   *
   * Fire-and-forget on purpose: a failed backup must never block the edit that
   * triggered it. The KV store is still the source of truth; this is the copy
   * that outlives it.
   */
  const [savedTo, setSavedTo] = useState<string | null>(null);
  useEffect(() => {
    if (!FILES_SUPPORTED || !activeEvent) return;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const bundle = buildEventBundle({
            event: activeEvent,
            spots: visibleSpots,
            sessions: savedSessions,
            entries: fieldEntries,
            equipment: checklist,
            days: Object.entries(sessionDayLabels).map(([id, label]) => ({
              id,
              date: label,
              label,
            })),
          });
          setSavedTo(await saveEventBundle(bundle));
        } catch {
          // Left silent by design: see above. The UI shows the last path that
          // did succeed, so a stale value is never mistaken for a fresh save.
          setSavedTo(null);
        }
      })();
    }, 1500);

    return () => clearTimeout(timer);
  }, [
    activeEvent,
    visibleSpots,
    savedSessions,
    fieldEntries,
    checklist,
    sessionDayLabels,
  ]);

  /*
   * ── Reading an event back in ──────────────────────────────────────────────
   *
   * A file that has been read but not yet acted on, together with the state it
   * was inspected against. Both are held so the two outcomes can be described
   * before the user picks one — see core/logic/importBundle.ts, which owns
   * every rule about what an import may overwrite.
   */
  const [pendingBundle, setPendingBundle] = useState<{
    fileName: string;
    bundle: EventBundle;
    local: LocalState;
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [storedBundles, setStoredBundles] = useState<
    { uri: string; title: string; subtitle: string }[]
  >([]);

  /** The app's own folder, refreshed whenever the events list is opened. */
  useEffect(() => {
    if (where !== 'events') return;
    void (async () => {
      const found = await listEventBundles();
      setStoredBundles(
        found.map((f) => ({
          uri: f.uri,
          title: f.bundle.event.name,
          subtitle: describeBundle(f.bundle),
        })),
      );
    })();
  }, [where, savedTo]);

  /** Read the current state fresh: it may have changed since the last render. */
  const offerBundle = useCallback(
    async (bundle: EventBundle, fileName: string) => {
      setImportError(null);
      setPendingBundle({ fileName, bundle, local: await readLocalState() });
    },
    [],
  );

  const runImport = useCallback(
    async (mode: ImportMode) => {
      if (!pendingBundle) return;
      const plan = planImport(pendingBundle.bundle, pendingBundle.local, mode);

      try {
        await applyImport(plan);
      } catch {
        setImportError('The import could not be written. Nothing was changed.');
        return;
      }
      setPendingBundle(null);

      // The event may belong to a circuit other than the one on screen, and its
      // spots only exist there — so follow it, exactly as activating one does.
      const key = VENUE_FOR_CIRCUIT[plan.event.circuitId];
      if (key && key !== venue) setVenue(key);

      await Promise.all([
        reloadEvents(),
        reloadSpots(),
        reloadSessions(),
        reloadEntries(),
        reloadEquipment(),
      ]);
      activate(plan.event.id);
      setWhere('event');
    },
    [
      pendingBundle,
      venue,
      reloadEvents,
      reloadSpots,
      reloadSessions,
      reloadEntries,
      reloadEquipment,
      activate,
    ],
  );

  /** Both outcomes, described, so each button can show its own consequences. */
  const pendingImport = useMemo(() => {
    if (!pendingBundle) return null;
    const { bundle, local, fileName } = pendingBundle;
    const restore = planImport(bundle, local, 'restore');
    const copy = planImport(bundle, local, 'copy');
    const circuit = VENUE_FOR_CIRCUIT[bundle.event.circuitId];

    return {
      fileName,
      eventName: bundle.event.name,
      circuitLabel: circuit ? VENUE_VIEW[circuit].label : 'Unknown circuit',
      conflict: inspectBundle(bundle, local),
      restore: { summary: describeImport(restore), warnings: restore.warnings },
      copy: { summary: describeImport(copy), warnings: copy.warnings },
    };
  }, [pendingBundle]);

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
        await addPhoto(spot.id, p.file, p.kind, p.isKey, activeEvent?.tag ?? null);
        // The preview was only ever a handle on a blob in memory; the bytes
        // now live in the media store under the spot's own id.
        if (p.previewUri?.startsWith('blob:')) URL.revokeObjectURL(p.previewUri);
      }
      setPendingPhotos([]);
    }
    setSheet({ kind: 'none' });
    setPlacing(false);
  };

  /**
   * Photo picking.
   *
   * `pickImage()` is the platform picker behind a single shape (native and web
   * both return `{ blob, contentType, previewUri }`), so this stays ignorant of
   * where the bytes come from. The 1600px/quality-0.7 downscale for on-device
   * storage lives in pickImage.ts, not here.
   */
  const onPickPhoto = useCallback(
    async (kind: ReferenceKind | null, isKey: boolean) => {
      const picked = await pickImage();
      if (!picked) return; // User backed out, or permission was refused.

      if (activeId) {
        void addPhoto(activeId, picked.blob, kind, isKey, activeEvent?.tag ?? null);
      } else {
        // Creating: hold it until the spot has an id.
        setPendingPhotos((p) => [
          ...p,
          { file: picked.blob, kind, isKey, previewUri: picked.previewUri },
        ]);
      }
    },
    [activeId, addPhoto, activeEvent],
  );

  return (
    <View style={styles.root}>
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
              heading={heading}
              // The back-to-event button occupies the row under the menu, so
              // the mode toggle starts below it.
              controlsTop={activeEvent ? 48 : 0}
              mediaUris={mediaUris}
              position={circuitPosition}
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
              Back to the event you came from.

              The map reached from an event is a *view of that event*, not the
              home map, and the menu trigger leads outward rather than back —
              without this the only way back to the timetable and plan is
              through Events and re-opening the event you never left.
            */}
            {where === 'map' && !sheetOpen && !navStop && activeEvent && (
              <Pressable
                onPress={() => setWhere('event')}
                style={({ pressed }) => [
                  styles.backToEvent,
                  { top: insets.top + MENU_TOP + MENU_HEIGHT + 8 },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.backToEventLabel} numberOfLines={1}>
                  ‹ {activeEvent.name}
                </Text>
              </Pressable>
            )}

            {/*
              The spot list opens from the map, not the menu: it answers "what
              is that pin", which is a question you only have while looking at
              the map.
            */}
            {where === 'map' && !sheetOpen && !navStop && (
              /*
               * One row, not three floating buttons.
               *
               * Even spacing has to come from layout: absolutely positioned
               * siblings sit wherever their own widths put them, so "Spots · 1"
               * being narrow and "Tap the map" being wide left the middle
               * button crowded against the right. A flex row with
               * space-between spaces them by construction, and keeps doing so
               * when the middle one appears and disappears.
               */
              <View
                style={[styles.bottomBar, { bottom: insets.bottom + space.md }]}
                pointerEvents="box-none"
              >
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

                {/*
                  Drop a spot where you are standing.

                  Only while placing, and only when the fix is actually at this
                  circuit — the whole point is that you are there, looking at
                  the thing you want to remember.
                */}
                {placing && atVenue && fix && (
                  <Pressable
                    onPress={() => {
                      const snapped =
                        snapBesideTrack(fix.position, trackLinesFor(venue))
                          ?.position ?? fix.position;
                      setSheet({ kind: 'creating', at: snapped });
                      setPlacing(false);
                    }}
                    style={({ pressed }) => [
                      styles.hereButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.hereLabel}>Add here</Text>
                    <Text style={styles.hereHint}>
                      {fix.accuracyMetres === null
                        ? 'Uses your position'
                        : `Accurate to about ${Math.round(fix.accuracyMetres)} m`}
                    </Text>
                  </Pressable>
                )}

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
              </View>
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
                pendingPhotos={sheet.kind === 'creating' ? pendingPhotos : []}
                onSave={onSave}
                onCancel={() =>
                  // Cancelling an edit returns to the overview it came from,
                  // rather than dumping you back to a bare map.
                  sheet.kind === 'edit'
                    ? setSheet({ kind: 'overview', id: sheet.id })
                    : (revokePendingPreviews(), setPendingPhotos([]), closeSheet())
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
                barriers={trackLinesFor(venue)}
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
                  spots={spotsInMode}
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
                // Seeded from the most recent previous event's checklist —
                // the entire point of the feature, see core/logic/equipment.ts.
                // `eventList` here is the list as it stood before this event
                // existed, which is exactly what "previous" means.
                await seedEquipmentForNewEvent(eventList, event);
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
            storedBundles={storedBundles}
            pendingImport={pendingImport}
            importError={importError}
            onChooseImportFile={() => {
              void (async () => {
                const picked = await importBundleFromPicker();
                // Backing out is not an error, and must not look like one.
                if (picked.kind === 'cancelled') return;
                if (picked.kind === 'error') {
                  setImportError(picked.message);
                  return;
                }
                await offerBundle(picked.bundle, picked.fileName);
              })();
            }}
            onOpenStoredBundle={(uri) => {
              void (async () => {
                const stored = await readBundleFile(uri);
                if (!stored) {
                  setImportError('That file could no longer be read.');
                  return;
                }
                await offerBundle(stored.bundle, stored.fileName);
              })();
            }}
            onConfirmImport={(mode) => void runImport(mode)}
            onCancelImport={() => {
              setPendingBundle(null);
              setImportError(null);
            }}
          />
        ) : where === 'event' ? (
          activeEvent ? (
            <EventScreen
              event={activeEvent}
              circuitLabel={VENUE_VIEW[venue].label}
              spots={visibleSpots}
              network={walkNetwork}
              barriers={trackLinesFor(venue)}
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
              entries={entryRows}
              onCommitEntries={(rows) => void addParsedEntries(rows)}
              onTogglePhotographed={(id, photographed) =>
                void setEntryPhotographed(asId(id), photographed)
              }
              onRemoveEntry={(id) => void removeEntry(asId(id))}
              equipment={equipmentRows}
              onTogglePacked={(id, packed) =>
                void setEquipmentPacked(asId(id), packed)
              }
              onAddEquipmentItem={(name, category) =>
                void addEquipmentItem(name, category)
              }
              onRemoveEquipmentItem={(id) => void removeEquipmentItem(asId(id))}
              weatherDisplay={weatherDisplay}
              onRefreshWeather={() => void refreshWeather()}
              weatherRefreshing={weatherRefreshing}
              weatherError={weatherError}
              onAddStop={(spotId, day) => void addStop({ spotId, day })}
              onUpdateStop={(stopId, patch) => void updateStop(stopId, patch)}
              onRemoveStop={(stopId) => void removeStop(stopId)}
              onMoveStop={(stopId, to) => void moveStop(stopId, to)}
              onNavigate={(stopId) => {
                setNavStopId(stopId);
                setWhere('map');
              }}
              onStartEvent={() => {
                const now = new Date();
                const m = String(now.getMonth() + 1).padStart(2, '0');
                const d = String(now.getDate()).padStart(2, '0');
                const currentIsoDate = `${now.getFullYear()}-${m}-${d}`;
                const currentClock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

                let nextStop = activeEvent.stops.find(s => {
                  if (!s.day || !s.arriveAt) return false;
                  if (s.day > currentIsoDate) return true;
                  if (s.day === currentIsoDate && s.arriveAt >= currentClock) return true;
                  return false;
                });

                if (!nextStop && activeEvent.stops.length > 0) {
                  nextStop = activeEvent.stops[0];
                }

                if (nextStop) {
                  setNavStopId(nextStop.id);
                  setWhere('map');
                }
              }}
              savedTo={savedTo}
              filesFolder={FILES_SUPPORTED ? eventsFolderUri() : null}
              onSaveNow={() => {
                void (async () => {
                  const bundle = buildEventBundle({
                    event: activeEvent,
                    spots: visibleSpots,
                    sessions: savedSessions,
                    entries: fieldEntries,
                    equipment: checklist,
                    days: Object.entries(sessionDayLabels).map(
                      ([id, label]) => ({ id, date: label, label }),
                    ),
                  });
                  setSavedTo(await saveEventBundle(bundle));
                })();
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
              barriers={trackLinesFor(venue)}
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
        ) : where === 'profile' ? (
          <ProfileScreen
            displayName={profileName}
            onChangeDisplayName={(name) => {
              setProfileNameState(name);
              void setProfileNamePreference(name);
            }}
          />
        ) : (
          // `where` is exhaustively handled by the branches above once
          // `'light'` is gone from `Destination` — nothing reaches this arm,
          // but a ternary chain still needs a final expression.
          null
        )}
      </View>



      {!sheetOpen && (
        <MainMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          venue={venue}
          eventName={activeEvent?.name ?? null}
          counts={{
            // The count for the mode you are in, matching what the map shows.
            spots: spotsInMode.length,
            sessions: savedSessions.length,
            events: eventList.length,
            stops: activeEvent?.stops.length ?? 0,
          }}
          spotUse={spotUse}
          useCounts={useCounts}
          onSpotUseChange={setSpotUse}
          onNavigate={setWhere}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  body: { flex: 1 },
  pressed: { opacity: 0.7 },

  /**
   * The row every map control sits in.
   *
   * `box-none` so the gaps between buttons stay map, not a transparent bar
   * swallowing taps and pans across the bottom of the screen.
   */
  bottomBar: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },

  addButton: {
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

  /**
   * Sits under the menu trigger rather than beside the map's other controls.
   *
   * It is navigation, not a map tool, so it belongs with the thing that says
   * where you are — and the bottom corners are already spoken for by the two
   * controls you use with a camera in one hand.
   */
  backToEvent: {
    position: 'absolute',
    top: space.md + 64,
    left: space.md,
    maxWidth: 240,
    height: 40,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: 'rgba(11,13,16,0.92)',
    borderWidth: 1,
    borderColor: color.accent,
  },
  backToEventLabel: {
    color: color.accent,
    fontSize: type.label,
    fontWeight: weight.bold,
  },

  /**
   * Centred, because it is the one control you use without looking.
   *
   * Sized well past the 56pt glove minimum (§5.14): it appears only in the
   * moment you have decided to save where you are standing, and a miss there
   * costs the spot.
   */
  /**
   * The bottom row's middle slot, between Spots and the placing button.
   *
   * It belongs with the other two rather than floating over the map: all three
   * are the same kind of thing — what you can do right now — and a control in
   * the middle of the map covers the ground you are trying to look at.
   */
  hereButton: {
    minHeight: 52,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.accent,
    alignItems: 'center',
  },
  hereLabel: {
    color: color.onAccent,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  hereHint: { color: color.onAccent, fontSize: 10, opacity: 0.85 },

  listButton: {
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
