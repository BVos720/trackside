/**
 * SQLite schema — spec §2.3, §7.
 *
 * This is the *local* store, and per spec §2.3 it is permanent, not a
 * placeholder. When the hosted API arrives in Milestone 3 it becomes an
 * additional sync target; these tables remain primary and the app keeps
 * reading from them forever.
 *
 * ── Conventions enforced throughout ────────────────────────────────────────
 *
 * • Every primary key is `text`, holding a client-generated UUID v7. There is
 *   no `integer primary key autoincrement` anywhere in this file, and adding
 *   one would break offline record creation irreversibly (spec §0.1).
 *
 * • Every table carries created_at / updated_at / deleted_at / sync_state.
 *   `deleted_at` is a tombstone: rows are never removed with SQL DELETE,
 *   because a deleted row leaves nothing for a peer to reconcile against and
 *   simply reappears on the next sync.
 *
 * • Timestamps are ISO 8601 UTC strings. Fixed-width UTC sorts correctly under
 *   plain lexicographic comparison, so ORDER BY and BETWEEN work without any
 *   conversion, and the values stay readable in a debugger.
 *
 * • Coordinates are `real` pairs. No spatial extension, no geometry column.
 */
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Columns shared by every table.
 *
 * Spread into each definition rather than expressed through inheritance —
 * Drizzle builds its types from the literal object, so a helper that returns
 * these keeps full column-level type inference at every call site.
 */
const entityColumns = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  /** Tombstone. Non-null means deleted. Never a hard DELETE. */
  deletedAt: text('deleted_at'),
  syncState: text('sync_state').notNull().$type<
    'local' | 'pending' | 'synced' | 'conflict'
  >(),
};

export const circuits = sqliteTable('circuits', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  country: text('country').notNull(),
  timezone: text('timezone').notNull(),
  boundsNorth: real('bounds_north').notNull(),
  boundsSouth: real('bounds_south').notNull(),
  boundsEast: real('bounds_east').notNull(),
  boundsWest: real('bounds_west').notNull(),
  centreLatitude: real('centre_latitude').notNull(),
  centreLongitude: real('centre_longitude').notNull(),
  layoutVariants: text('layout_variants', { mode: 'json' })
    .notNull()
    .$type<{ key: string; name: string; lengthMetres: number | null }[]>(),
  ...entityColumns,
});

export const marshalPosts = sqliteTable(
  'marshal_posts',
  {
    id: text('id').primaryKey(),
    circuitId: text('circuit_id')
      .notNull()
      .references(() => circuits.id),
    /**
     * Text, not integer — real circuit numbering includes forms like '12a'.
     * Sourced from official documents only; never generated (spec §0.2).
     */
    officialNumber: text('official_number').notNull(),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    ...entityColumns,
  },
  (t) => [index('idx_marshal_posts_circuit').on(t.circuitId)],
);

export const circuitFeatures = sqliteTable(
  'circuit_features',
  {
    id: text('id').primaryKey(),
    circuitId: text('circuit_id')
      .notNull()
      .references(() => circuits.id),
    kind: text('kind').notNull().$type<
      'gate' | 'carPark' | 'tunnel' | 'bridge' | 'spectatorArea' | 'facility'
    >(),
    /** GeoJSON geometry as JSON text. No spatial type (spec §2.3). */
    geometry: text('geometry', { mode: 'json' }).notNull(),
    notes: text('notes'),
    ...entityColumns,
  },
  (t) => [index('idx_circuit_features_circuit').on(t.circuitId)],
);

export const spots = sqliteTable(
  'spots',
  {
    id: text('id').primaryKey(),
    circuitId: text('circuit_id')
      .notNull()
      .references(() => circuits.id),
    /** Null for the permanent collection; set for an event's own copy. */
    eventId: text('event_id'),
    nearestMarshalPostId: text('nearest_marshal_post_id').references(
      () => marshalPosts.id,
    ),
    name: text('name').notNull(),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    elevation: real('elevation'),
    /** Degrees true. Null means not yet recorded, never "north by default". */
    shootingBearing: real('shooting_bearing'),
    /**
     * Physical-safety field — spec §0.1, §9.1.
     *
     * No SQL default is declared, deliberately. A column default is exactly
     * the kind of silent auto-assignment §0.1 forbids: it would classify a
     * spot without a human ever having decided. Callers pass 'unknown'
     * explicitly, which keeps the choice visible in the code that makes it.
     */
    accessClassification: text('access_classification').notNull().$type<
      'official' | 'publicLand' | 'permissionRequired' | 'unknown'
    >(),
    accessNotes: text('access_notes'),
    /** Photographer's own "worth being here at" labels — see Spot.keyTimes. */
    keyTimes: text('key_times', { mode: 'json' })
      .notNull()
      .$type<string[]>()
      .default([]),
    /** Physical descriptors — see Spot.tags. Not a permission field. */
    tags: text('tags', { mode: 'json' })
      .notNull()
      .$type<string[]>()
      .default([]),
    /** Camera settings per technique — see Spot.shotSettings. */
    shotSettings: text('shot_settings', { mode: 'json' })
      .notNull()
      .$type<unknown[]>()
      .default([]),
    /** Decluttering only — not a tombstone. See Spot.isHidden. */
    isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
    visibility: text('visibility')
      .notNull()
      .$type<'private' | 'followers' | 'public'>(),
    createdBy: text('created_by').notNull(),
    ...entityColumns,
  },
  (t) => [
    index('idx_spots_circuit').on(t.circuitId),
    index('idx_spots_marshal_post').on(t.nearestMarshalPostId),
    // Almost every read filters out tombstoned rows, so the partial-ish index
    // on deleted_at earns its keep immediately.
    index('idx_spots_deleted_at').on(t.deletedAt),
  ],
);

export const userSpotNotes = sqliteTable(
  'user_spot_notes',
  {
    id: text('id').primaryKey(),
    spotId: text('spot_id')
      .notNull()
      .references(() => spots.id),
    userId: text('user_id').notNull(),
    personalNotes: text('personal_notes'),
    rating: integer('rating'),
    visibility: text('visibility')
      .notNull()
      .$type<'private' | 'followers' | 'public'>(),
    ...entityColumns,
  },
  (t) => [
    index('idx_user_spot_notes_spot').on(t.spotId),
    index('idx_user_spot_notes_user').on(t.userId),
  ],
);

/**
 * A planning context over a circuit's spots — see core/domain/event.ts.
 *
 * `spot_ids` holds references, not copies. Duplicating spots per event would
 * recreate the very problem spec §4.2 exists to prevent.
 */
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    circuitId: text('circuit_id')
      .notNull()
      .references(() => circuits.id),
    name: text('name').notNull(),
    /** Local `YYYY-MM-DD`, not a timestamp — a race weekend is a calendar fact. */
    startDate: text('start_date'),
    endDate: text('end_date'),
    notes: text('notes'),
    spotIds: text('spot_ids', { mode: 'json' })
      .notNull()
      .$type<string[]>()
      .default([]),
    /**
     * The planned route, in order.
     *
     * JSON rather than a `plan_stops` table: stops are only ever read as a
     * whole ordered list belonging to one event, never queried across events,
     * and array order is the route. A table would need an explicit sort column
     * whose only job is to reproduce what an array already gives.
     */
    stops: text('stops', { mode: 'json' })
      .notNull()
      .$type<unknown[]>()
      .default([]),
    createdBy: text('created_by').notNull(),
    ...entityColumns,
  },
  (t) => [index('idx_events_circuit').on(t.circuitId)],
);

export const media = sqliteTable(
  'media',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    spotId: text('spot_id').references(() => spots.id),
    /** Polymorphic from the first migration — never split into `photos`. */
    type: text('type').notNull().$type<'photo' | 'video'>(),
    source: text('source').notNull().$type<'uploaded' | 'embedded'>(),
    /** IMediaStore key. Never a raw device path, never the bytes (spec §2.4). */
    storageKey: text('storage_key'),
    externalUrl: text('external_url'),
    referenceKind: text('reference_kind').$type<
      'approach' | 'view' | 'hazard'
    >(),
    sortOrder: integer('sort_order').notNull(),
    /** The spot's hero shot — see Media.isKeyImage. At most one per spot. */
    isKeyImage: integer('is_key_image', { mode: 'boolean' })
      .notNull()
      .default(false),
    capturedAt: text('captured_at'),
    capturedBearing: real('captured_bearing'),
    capturedPitch: real('captured_pitch'),
    visibility: text('visibility')
      .notNull()
      .$type<'private' | 'followers' | 'public'>(),
    /** Nothing may be served beyond the device while this is false (§9.4). */
    metadataStripped: integer('metadata_stripped', { mode: 'boolean' })
      .notNull()
      .default(false),
    ...entityColumns,
  },
  (t) => [index('idx_media_spot').on(t.spotId)],
);

export const walkEdges = sqliteTable(
  'walk_edges',
  {
    id: text('id').primaryKey(),
    fromSpotId: text('from_spot_id')
      .notNull()
      .references(() => spots.id),
    toSpotId: text('to_spot_id')
      .notNull()
      .references(() => spots.id),
    /** Walked or GPS-measured. Never computed from distance (spec §0.2). */
    minutes: real('minutes').notNull(),
    source: text('source').notNull().$type<'manual' | 'derived'>(),
    derivedFromTraceIds: text('derived_from_trace_ids', { mode: 'json' })
      .notNull()
      .$type<string[]>(),
    /**
     * Nullable on purpose. Null means undocumented, and the planner must treat
     * that as "ask a human", never as "yes". Cannot be derived (spec §5.15).
     */
    possibleDuringLiveSession: integer('possible_during_live_session', {
      mode: 'boolean',
    }),
    notes: text('notes'),
    ...entityColumns,
  },
  (t) => [
    index('idx_walk_edges_from').on(t.fromSpotId),
    index('idx_walk_edges_to').on(t.toSpotId),
  ],
);

export const eventDays = sqliteTable(
  'event_days',
  {
    id: text('id').primaryKey(),
    circuitId: text('circuit_id')
      .notNull()
      .references(() => circuits.id),
    /** `YYYY-MM-DD` in the circuit's own timezone. */
    date: text('date').notNull(),
    sourceDocumentId: text('source_document_id'),
    label: text('label'),
    ...entityColumns,
  },
  (t) => [index('idx_event_days_circuit').on(t.circuitId)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    eventDayId: text('event_day_id')
      .notNull()
      .references(() => eventDays.id),
    seriesName: text('series_name').notNull(),
    className: text('class_name'),
    kind: text('kind').notNull().$type<
      'practice' | 'qualifying' | 'race' | 'pitlaneWalk' | 'support'
    >(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    isNight: integer('is_night', { mode: 'boolean' }).notNull(),
    ...entityColumns,
  },
  (t) => [index('idx_sessions_event_day').on(t.eventDayId)],
);

export const plans = sqliteTable(
  'plans',
  {
    id: text('id').primaryKey(),
    eventDayId: text('event_day_id')
      .notNull()
      .references(() => eventDays.id),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    visibility: text('visibility')
      .notNull()
      .$type<'private' | 'followers' | 'public'>(),
    ...entityColumns,
  },
  (t) => [index('idx_plans_event_day').on(t.eventDayId)],
);

export const planStops = sqliteTable(
  'plan_stops',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id),
    spotId: text('spot_id')
      .notNull()
      .references(() => spots.id),
    arrivalTime: text('arrival_time').notNull(),
    departureTime: text('departure_time').notNull(),
    targetSessionIds: text('target_session_ids', { mode: 'json' })
      .notNull()
      .$type<string[]>(),
    notes: text('notes'),
    sequence: integer('sequence').notNull(),
    ...entityColumns,
  },
  (t) => [index('idx_plan_stops_plan').on(t.planId)],
);
