/**
 * What the column mapper maps *to* — one description per kind of document.
 *
 * The mapper is the same screen for an entry list and a timetable: a grid, a
 * field picker, a stride, a live preview. What differs is the set of fields,
 * what counts as a record, how one is previewed and how the first guess is
 * made — and those live here, so neither document grows its own copy of the
 * screen that then drifts from the other.
 */
import {
  EntryField,
  applyMapping,
  describeMapping,
  isUsable,
  type ColumnMapping,
} from '../../core/logic/columnMapping';
import type { TextEntry } from '../../core/logic/entryList';
import {
  guessEntryMapping,
  guessTimetableMapping,
} from '../../core/logic/mappingGuess';
import {
  TimetableField,
  applyTimetableMapping,
  describeTimetableMapping,
  isTimetableUsable,
} from '../../core/logic/timetableMapping';
import type { TextSession } from '../../core/logic/timetableText';

type Grid = readonly string[][];

export interface MapperSpec<F extends string, R> {
  /** The picker, in the order it is offered. Ignore last. */
  readonly fields: readonly { field: F; label: string; short: string }[];
  /** The machine's first reading — `core/logic/mappingGuess.ts`. */
  readonly guess: (grid: Grid) => ColumnMapping<F>;
  readonly apply: (grid: Grid, mapping: ColumnMapping<F>) => R[];
  readonly describe: (grid: Grid, mapping: ColumnMapping<F>) => string;
  readonly usable: (mapping: ColumnMapping<F>) => boolean;
  /** "car", "cars" — for the stride, the exclusion button and Use. */
  readonly noun: readonly [string, string];
  readonly preview: (record: R) => { lead: string; title: string; meta: string };
  /** Whether saved layouts apply. Entry lists only, for now. */
  readonly templates: boolean;
}

export const ENTRY_SPEC: MapperSpec<EntryField, TextEntry> = {
  fields: [
    { field: EntryField.Number, label: 'Number', short: 'No.' },
    { field: EntryField.ClassName, label: 'Class', short: 'Class' },
    { field: EntryField.Team, label: 'Team', short: 'Team' },
    { field: EntryField.Drivers, label: 'Drivers', short: 'Drivers' },
    { field: EntryField.Ignore, label: 'Ignore', short: '' },
  ],
  guess: guessEntryMapping,
  apply: (grid, mapping) => applyMapping(grid as string[][], mapping),
  describe: (grid, mapping) => describeMapping(grid as string[][], mapping),
  usable: (mapping) => isUsable(mapping),
  noun: ['car', 'cars'],
  preview: (e) => ({
    lead: e.number,
    title: e.team ?? '—',
    meta: [e.className, e.drivers.join(' / ')].filter(Boolean).join(' · '),
  }),
  templates: true,
};

export const TIMETABLE_SPEC: MapperSpec<TimetableField, TextSession> = {
  fields: [
    { field: TimetableField.Start, label: 'Start', short: 'Start' },
    { field: TimetableField.End, label: 'End', short: 'End' },
    { field: TimetableField.Title, label: 'Name', short: 'Name' },
    { field: TimetableField.Location, label: 'Place', short: 'Place' },
    { field: TimetableField.Day, label: 'Day', short: 'Day' },
    { field: TimetableField.Ignore, label: 'Ignore', short: '' },
  ],
  guess: guessTimetableMapping,
  apply: (grid, mapping) => applyTimetableMapping(grid as string[][], mapping),
  describe: (grid, mapping) => describeTimetableMapping(grid as string[][], mapping),
  usable: isTimetableUsable,
  noun: ['session', 'sessions'],
  preview: (s) => ({
    lead: s.start,
    title: s.title,
    meta: [s.end !== s.start ? `until ${s.end}` : null, s.day].filter(Boolean).join(' · '),
  }),
  templates: false,
};
