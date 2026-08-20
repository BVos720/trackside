# Handoff — entry lists

A working note for a session picking up the entry-list feature. Companion to
`HANDOFF.md` (photos, from a different chat — **do not merge or overwrite it**).
**Delete this file once it has been consumed.**

State at the time of writing: `npx tsc --noEmit` clean, `npx vitest run` 335
passing, HEAD at `cd96baf`. Everything below is uncommitted.

**Updated after job #1**: `npx tsc --noEmit` still clean, `npx vitest run` now
353 passing (18 new, all in `entryList.fixtures.test.ts`). Nothing else changed.

> Three sessions share this working tree with no worktree isolation. Commit your
> files **by name**; `git add -A` will sweep up half-finished work that is not
> yours. See the same warning at the top of `HANDOFF.md`.

---

## The ask

> Build entry-list parsing so Branco can tick off which cars he has photographed
> during an event.

Scope was core logic + storage only. `App.tsx` was explicitly off-limits (another
chat was editing it), and it still is — see "Not started" below.

---

## Done and passing

**Domain** — `src/core/domain/entry.ts` (new)
`Entry` with UUID v7 id, tombstone, `syncState`, following `src/core/domain/`
rules. Two decisions worth not re-litigating:

- **`number` is a string.** "07" and "7" are different cars and collide the
  moment either is parsed to an integer. Club racing also uses "24A".
- **`photographedAt` sits next to the `photographed` flag**, carried from the
  first write. A bare boolean cannot be reconciled between two devices that both
  ticked the same car, and §0.1 makes a column added later a migration across
  devices. `setPhotographed()` moves the two together so they can never disagree.

`eventId` has no null case, unlike `Spot` — an entry with no event is a car in no
race.

**Storage** — `src/storage-local/repositories/documentRepositories.ts`,
`src/core/repositories/entryRepository.ts` (new),
`src/storage-local/repositories/entries.test.ts` (new, 15 tests)
`EntryRepository` on `trackside.entries.v1`. `saveMany` writes a parsed list in
one mutation (40 separate saves would be 40 read-modify-write cycles over the
whole collection). `setPhotographed` reads and writes inside one queued mutation
because it is tapped faster than a reload settles. Deleting an event cascades to
its entries, alongside the existing spot/media cascade.

**Bundle + import** — `eventBundle.ts`, `importBundle.ts` and their tests
Entries ride in the bundle with their ticks. Copy mode remints ids and rewrites
`eventId`; without that, two events share one list and ticking a car in one ticks
it in the other. A test caught a real bug here: `planImport` crashed on a bundle
with no `entries` key — i.e. every backup currently on the phone. Fixed via
`entriesOf()` at the read boundary, the same defaulting `normaliseSpot` does.

**One judgement call to review:** copy mode **carries** `photographed` rather
than clearing it, and pushes a warning saying so. Copy is as often "keep both
versions" of your own event as "open someone else's"; clearing would destroy a
weekend's count to tidy a cosmetic wrongness. Easy to flip if Branco disagrees —
`planCopy` in `importBundle.ts`.

**Fixtures** — `src/core/logic/entry-lists/*.txt` (new, 5 files, 746 lines)
Verbatim `pdfjs` output from five real PDFs Branco supplied, captured through the
**same pipeline the app uses** (`extractPdfLines`, `ROW_TOLERANCE = 2`). Kept for
the reason `bundle-from-device.json` is kept: a hand-built fixture agrees with its
author by construction, a capture disagrees freely. Re-capture rather than edit.

---

## The thing that changed the design

`extractPdfLines` joins positioned glyphs with a single space and **collapses
runs of whitespace**. Columns are gone by the time text reaches the parser:

```
007 ASTON MARTIN THOR TEAM USA M Aston Martin Valkyrie Harry TINCKNELL (GBR) P
```

My original parser split on 2+ spaces, which never fires on real input. It was
rewritten as **layered recognisers, most specific first**, each of which either
matches a shape it can prove or declines:

1. `readNatCodeLine` — WEC/ELMS. Anchored on `(GBR)` nationality codes, which are
   unambiguous and appear nowhere else on the line.
2. `readEntrantMarkerLine` — NLS, anchored on the `B` (Bewerber) marker.
3. `readDelimitedLine` — text that still has bullets, tabs, column gaps or commas
   (a web-page paste, or typing). This is the original path, still needed.

---

## Where it actually stands against the five real lists

Measured, not estimated. **None of this is under test yet — that is job #1.**

| List | Entries | Quality |
|---|---|---|
| WEC Spa 2026 | 35 | ✅ all 35 with team + class + drivers, 0 false |
| ELMS Spa 2026 | 48 | ✅ 47 correct, **1 false** |
| NLS6 2026 | 120 | ⚠️ 119 have class, **none have team/drivers**, count should be 110 |
| HTC2 Spa | 20 | ❌ 19 number-only, **1 fabricated**, 2 skipped |
| Spa Six Hours 2025 | 35 | ❌ 32 number-only, **3 fabricated** |

WEC and ELMS are genuinely good, and they are the Spa events Branco shoots.

---

## Job #1 — write the fixture tests — done

`src/core/logic/entryList.fixtures.test.ts` (new, 18 tests, 353 passing total).
Reads all five files with `readFileSync` the way `importBundle.roundtrip.test.ts`
reads `bundle-from-device.json`, and pins current behaviour warts included —
every known-bad case below is now an assertion, not a claim.

Two things fell out of writing it that the throwaway harness's headline numbers
didn't surface, worth reading before touching job #2 or #3:

- **Spa Six Hours has a second fabrication next to the one already named
  below.** `#3. HISTORIC GRAND PRIX CARS ASSOCIATION` repeats once per page
  exactly like `25 TO 27 SEPTEMBER 2025` does, and matches `CAR_NUMBER` the
  same way — car "3", three times, stacked on top of the one genuine `# 3
  COOPER T51 …` row. A footer line, `35 CARS IN THE ENTRY LIST`, is a fourth
  kind of fabrication again (a total count read as a car). Any guard for job
  #2 needs to survive all four, not just the one this handoff originally
  named.
- **Seven real Spa Six Hours cars are silently dropped, not skipped.** `# 4`
  on its own line (car and driver follow on the next two lines) matches
  `BARE_NUMBER`, and bare numbers are only kept when *nothing else* was found
  in the whole document — the stripped-copy-paste case. Because this document
  also yields 35 richer entries, `4`, `12`, `26`, `43`, `62`, `75` and `153`
  vanish with no trace at all: not in `entries`, not in `skipped`. That is
  worse than job #3's wrong-number bug, which at least reports something. See
  the last test in the fixture file for the exact list.

## Job #2 — false entries (correctness, do before any polish)

Document furniture is being read as cars. This violates the "never guesses"
principle the parser is built on, and a fabricated car is worse than a missing
one because it looks real on a tick list.

| Source line | Read as |
|---|---|
| `4 HOURS OF SPA-FRANCORCHAMPS - ENTRY LIST - V1` | car 4 |
| `1. ADAC Eifel Trophy (19.06.2026 - 20.06.2026)` | car 1 |
| `25 TO 27 SEPTEMBER 2025` (×3, once per page) | car 25, team "TO 27 SEPTEMBER 2025" |
| `23 voitures / cars` | car 23, drivers `["voitures", "cars"]` |

All four are "a number, then prose". A guard belongs in `parseEntryLines` before
the delimited path. Suggestions, in order of how much I trust them:

- Reject when the remainder starts with a word that cannot begin a team name —
  `HOURS OF`, `TO`, `voitures`, `cars`. Narrow and safe.
- Reject when the line holds a date or date range.
- Stronger and probably right: **only accept a bare/delimited entry once a class
  section has been seen**, or when the line carries a name/nat anchor. All four
  offenders sit above the first section header. Check this does not break the
  "stripped paste of just numbers" case, which has a test.

## Job #3 — the two historic lists

Both defeat the "an entry is a line starting with a car number" invariant.

- **HTC2** puts a row index in front: `3 7 David HART Olivier HART BMW M3 E30 …`
  is *car 7*, not car 3. Once the column positions are gone I could not tell the
  index from the number, so `assign()` currently returns number-only for these
  (team/drivers/class null) rather than a confident wrong answer. Lines that are
  *only* two numbers (`2 6`) are reported in `skipped`. If you want these, the
  index runs 2…9 and then degrades to a literal `#`, so a cross-line
  running-ordinal check is possible but stateful.
- **Spa Six Hours (G3)** splits one car across two or three lines: `# 1`, then
  `BRM P48-7 1960 2500 Rear engine R.7b`, then `WILLIS Andy (GBR)`. Needs
  multi-line association, like the ELMS "name on the previous line" rule in
  `timetableText.ts` but in the other direction.

Both are historic support races. Lower value than WEC/ELMS/NLS — it is entirely
reasonable to leave them reported-for-manual-entry and say so in the UI.

## Job #4 — NLS

- **Count is 120, the document says `Teilnehmer: 110`.** Ten extra beyond the
  title-line false positive from job #2. Not diagnosed. Start by diffing the
  parsed numbers against the numbers in the fixture; the file is 10 pages with
  repeating page headers, so duplicates across pages are the first suspect.
- **`team` is deliberately null.** The columns are entrant, town, licence, car —
  all plain words, no boundary recoverable once spacing is gone.
  `BLACK FALCON Team EAE Meuspath` is not a team name. Do not "fix" this by
  storing the blob; if you want the team, the fix is to stop collapsing
  whitespace upstream (see job #6), not to guess downstream.
- **Drivers are on their own following lines** (`F Kaya, Mustafa Mehmet Türkei …`,
  `Surname, Firstname` order, German country names). Same multi-line problem as
  G3. Number + class is most of the value for ticking off, so this is optional.

## Job #5 — the UI (blocked on `App.tsx`)

Nothing is wired up. This is the gap between "logic exists" and "Branco can use
it". All of it is in `App.tsx` / `src/ui/`, which was out of scope:

- A paste box → `parseEntryList` → confirmation screen showing
  `describeEntryParse()` and the `skipped` lines for manual entry. **Nothing may
  commit without that confirmation** — the same rule §5.3 sets for timetables.
- A tick list on the event screen, calling `entries.setPhotographed`.
  `photographedCount()` is there for the progress line.
- **Two one-line changes that are currently silent data loss:** `App.tsx` builds
  bundles without `entries` (`buildEventBundle` at ~line 495 and ~1074) and
  `applyImport` never writes `plan.entries`. So entries do **not** survive backup
  or import today, even though the bundle and planner both handle them.

## Job #6 — worth considering

PDF text extraction does not work on device yet, so this is pasted-text-only for
now. When it does land, note that `extractPdfLines` collapsing whitespace is what
destroys the column structure. Preserving a gap marker (a tab, say) when the x-gap
between glyphs exceeds some threshold would make NLS teams and both historic lists
tractable, and would cost the timetable parser nothing — it splits on times, not
spaces. That single upstream change is worth more than any amount of downstream
heuristics.

---

## Files

**New:** `src/core/domain/entry.ts`, `src/core/logic/entryList.ts`,
`src/core/logic/entryList.test.ts`, `src/core/logic/entryList.fixtures.test.ts`,
`src/core/logic/entry-lists/` (5 fixtures),
`src/core/repositories/entryRepository.ts`,
`src/storage-local/repositories/entries.test.ts`

**Modified:** `src/core/domain/ids.ts` (`EntryId`),
`src/core/logic/eventBundle.ts` + test, `src/core/logic/importBundle.ts` + test,
`src/storage-local/repositories/documentRepositories.ts` (`EntryRepository`,
event-delete cascade)

**Not mine, do not commit as part of this:** `App.tsx`, `mediaStore.ts`,
`pickImage*.ts`, `SpotSheet.tsx`, `package.json` (photos — see `HANDOFF.md`);
the `MENU_CLEARANCE` screen padding changes and the event soft-delete cascade in
`eventDeletion.test.ts`.

Verify with `npx vitest run` and `npx tsc --noEmit`.
