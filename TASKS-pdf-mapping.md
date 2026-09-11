# PDF import — the machine extracts, the human says what is what

> "Can't PDF input be like co-work, man and machine — the machine extracts the
> text but doesn't know what what is, and the human can choose what what is?
> For both timetable and entry list?"

Yes, and it is the better design. This file is the argument and the plan.

**Nothing here is built.** It replaces the "write another recogniser" approach
in `HANDOFF-entry-lists.md` jobs #3 and #4 — read this first and those second.

---

## The argument

The parser splits into two jobs that are nothing alike:

| | Reliability | Varies between series? |
|---|---|---|
| **Extraction** — glyphs → positioned text | Near-perfect | No |
| **Classification** — which token is the car number | Guesswork | Constantly |

Everything hard about `entryList.ts` is the second column. Five documents
needed three recognisers, and two of them still come out wrong:

- **HTC2** — `3 7 David HART Olivier HART BMW M3 E30 1992 Group A2`. Row 3,
  car 7. Once the column positions are gone the two integers are
  indistinguishable, so the parser takes the first and is wrong every time. A
  human glances at it and knows instantly.
- **Spa Six Hours** — seven cars vanish entirely (`4`, `12`, `26`, `43`, `62`,
  `75`, `153`) because their number sits alone on a line with the car and
  driver on the two lines beneath. A human says "each entry is three lines"
  once.

No amount of heuristic gets these right, because the information needed is not
in the text — it is in the layout the extractor discarded, plus knowledge the
reader has and the file does not.

**And the economics are the real argument.** Today a new series means a new
recogniser, a code change and a release. With mapping it means twenty seconds
of tapping, by the person holding the phone, at the circuit, offline.

This does not weaken §5.3's rule that nothing is committed without the user
seeing it. It strengthens it: the human stops *checking a guess* and starts
*making the decision*.

---

## The enabling change, and it is small

`extractPdfLines` already computes what this design needs and throws it away:

```ts
// src/storage-local/pdfText.web.ts
rows.set(y, [{ x: item.transform[4], s: item.str }]);   // x is right here
…
  .sort((a, b) => a.x - b.x)
  .map((i) => i.s)
  .join(' ')                                            // …and gone
  .replace(/\s+/g, ' ')
```

Every token's x-position is collected, sorted by, and discarded one line before
the function returns. **Return the tokens instead of the joined string** and
columns become recoverable — which is what makes both the mapping UI and the
existing parser better at once.

- [x] **P1. Return positioned tokens.** `extractPdfLines` gains a sibling —
      `extractPdfRows` — returning `{ y, tokens: { x, width, text }[] }[]`.
      Keep the joined-string version: `timetableText.ts` is tested against it
      and works, and this must not be a rewrite of a working parser.
      Owns `pdfText.web.ts` / `pdfText.ts` only. No UI.

**P1 and P2 done — 25 August, and measured against all five documents.**
`extractPdfRows` keeps the positions; `extractPdfLines` is unchanged byte for
byte. `core/logic/pdfColumns.ts` finds the bands. Captured
`entry-lists/*.rows.json` fixtures — the same pdfjs pass the app runs, taken
*before* the whitespace collapse the `.txt` siblings were taken after.

| Document | Columns | Result |
|---|---|---|
| WEC | 11 | 35 cars, every driver in its own column — better than the string parser, which cannot find the first driver's left boundary |
| ELMS | 11 | 47 cars, every field separated |
| NLS | 5 | **Recovers the team and town `entryList.ts` had to leave null**, and isolates the running page header that made it read 120 where the document says 110 |
| HTC2 | 2 | Partial — later columns do not align across rows. But it separates the row index from the car number, which is the KNOWN BUG in `entryList.fixtures.test.ts` |
| Spa Six Hours | 0 | Multi-line records, no consistent bands. Reports none rather than a grid over prose |

The empty answer is a supported outcome, not a failure: it routes to R's
editable review instead of to a table that looks authoritative and is wrong.

- [x] **P2. Cluster tokens into columns.** Pure logic in `core/logic/`: given
      the rows, find the x-bands that most rows share. This is the machine half
      of the co-work — it proposes the grid, and proposes nothing about meaning.
      Must degrade honestly: a document with no consistent bands (prose, or a
      single-column list) reports "no columns found" rather than inventing
      them. Test against all five fixtures. Logic and tests only.

---

## R — The editable review table. Build this first.

> "It should be editable if the parser part kind of fails."

This is the highest-value, lowest-risk piece, and **it needs none of the
extraction work below**. It sits on top of the parser that exists today.

The insight: if every parsed field can be corrected by hand, the parser never
has to be *right*, only *close*. That changes what all the machinery below is
for — it stops being a correctness problem and becomes a "how few taps" one.

- [x] **R1. Show the parse as an editable list, not a summary.** Today
      `describeEntryParse()` returns "47 entries, 2 lines to enter by hand" and
      the user takes it on trust. Show the rows instead: number, class, team,
      drivers, each tappable and editable in place.

- [x] **R2. Delete a row, add a row.** The two operations that fix everything
      the parser can get wrong in a way editing cannot: furniture read as a
      car (delete), and a car it never saw (add). With these, every fabrication
      and every silent drop becomes a five-second fix rather than a defect.

- [x] **R3. Show the source line under each row.** `TextEntry.source` is
      already carried for exactly this. When a field looks wrong, the line it
      came from is the only way to tell a mis-parse from a typo in the PDF.

- [x] **R4. Surface `skipped` in the same list.** Lines the parser could not
      read should appear as empty rows with their source text, ready to fill
      in — not as a separate "2 lines to enter by hand" count that sends you
      hunting for them.

**Done — 25 August.** `EntryListScreen.tsx` rewritten: every field editable
in place, rows deletable, "+ Add a car the list missed", the source line under
each row, and unreadable lines as blank rows in the same list rather than a
separate section. Logic in `core/logic/entryReview.ts` with 23 tests — which
carries more weight than usual here, since this repo has no component tests and
none of this has run on a phone.

**Ship R alone and the entry-list feature is usable for all five documents
today**, including the two the parser gets wrong. Everything below is about
reducing how much correcting R has to do.

---

## M — The visual column mapper

> "The best thing is if you would get a PDF preview and can choose columns for
> certain parts, but idk if that is doable."

It is doable, and it is the right interaction — you see the document you know
instead of a stripped text row you have to translate in your head.

**M2–M5 done — 25 August.** `ColumnMapper.tsx` plus
`core/logic/columnMapping.ts` (37 tests). Tap a cell, say what it is, watch the
entries appear underneath; a rows-per-car stepper for taller records, and
"Not a car" to exclude a row shape everywhere it occurs.

Measured against the real documents — every one of these is a defect recorded
elsewhere in the repo, closed by taps rather than code:

| Document | What the mapper does |
|---|---|
| WEC | 35 cars, drivers whole **including the first**, which the string parser clips because the car model runs into it with no boundary |
| ELMS | 47 cars from the same taps — the case for templates below |
| NLS | **110**, exactly the `Teilnehmer: 110` the file prints, after excluding the page header and one stray `325i`. Team recovered, which `entryList.ts` withholds on principle |
| HTC2 | car **7**, not 3 — the KNOWN BUG in `entryList.fixtures.test.ts` |
| Spa Six Hours | reads a three-line record whose number sits alone on a line, which today vanishes with no trace |

Two limits recorded rather than papered over. `325i` is a car number by shape
and not by meaning and no rule can tell the difference — that is the human
step working, not a gap. And a fixed stride drifts on documents that do not
hold their rhythm, which the editable review makes visible instead of silent.

**Tap a column band, choose what it is.** That is the whole interaction.

```
   ┌──────────────────────── the page, rendered ────────────────────────┐
   │ ░░░░░  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  ░░░  ░  ▒▒▒▒▒▒▒▒▒▒  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │
   │ 007    ASTON MARTIN THOR  USA   M  Aston Martin  Harry TINCKNELL  │
   │ 009    ASTON MARTIN THOR  USA   M  Aston Martin  Alex RIBERAS     │
   │ └──┬─┘ └────────┬───────┘                       └───────┬──────┘  │
   └────┼────────────┼────────────────────────────────────────┼────────┘
     Car number    Team                                    Drivers
```

- Bands are **proposed automatically** by the x-clustering in P2 — the machine
  half. It proposes the grid and nothing about meaning.
- **Tap a band → pick a field.** Car number · Class · Team · Drivers · Ignore.
- **Drag a band edge** when the proposal splits or merges a column wrongly.
  Dragging a boundary is far more forgiving on a phone than tapping a token.
- **Live preview** of the first two or three rows underneath, so a wrong
  assignment shows immediately rather than after committing forty cars.

- [x] **M1. Render the page.** See "Is the preview actually doable" below —
      the answer differs per platform and web is free.

      **Deliberately not done yet — 25 August.** The mapper ships showing the
      sliced *grid* instead. A page-render mapper needs pdfjs, which runs on
      web and not on the phone, so it would be a feature Branco cannot use
      where he uses the app. The grid is the structure the page has, and it
      works on both. This stays worth doing on web as a nicer skin over the
      same controls — not a prerequisite for them.
- [x] **M2. Overlay the proposed bands** from P2, tappable and draggable.
- [x] **M3. The field picker and live preview.** `HIT_SIZE` throughout.
- [x] **M4. Multi-line entries, as a mode not a guess.** One control — "each
      entry is N lines" — plus assigning fields on each line. That single
      control is the whole fix for Spa Six Hours' seven vanished cars and for
      NLS's missing teams and drivers, neither of which any recogniser has
      managed.
- [x] **M5. Exclude a row by shape.** Tap a page header and say "lines like
      this are not entries", matched by band and shape rather than literal
      text — or it will not catch the same header on page 2. This is the
      general form of the four fabrication guards hand-coded into
      `entryList.ts`.

---

## Is the preview actually doable

Yes, with a different answer per platform.

**Web — yes, today, with what is already installed.** `pdfjs-dist` is a
dependency and already renders pages to a canvas; its text layer gives every
token a bounding box in the same coordinate space. Drawing bands over a
rendered page is what the pdfjs viewer already does for text selection. No new
dependency.

**Android — yes, but it needs a small native module.** The platform ships
`android.graphics.pdf.PdfRenderer` (API 21+), which renders a page to a bitmap
with no third-party library. That solves the *picture*. Text and positions come
from either a native extractor or on-device OCR — see P9. The module is small
and well-trodden; check for an existing Expo package before writing one.

**iOS — same shape via PDFKit**, and academic for now: building for iOS needs
a paid Apple account (STATUS.md gap 5).

**The honest caveat:** on native this is blocked behind the same wall as
everything else PDF — `PDF_SUPPORTED = false`, pdfjs needs a DOM and a worker
bundle Metro will not produce. The mapper does not remove that wall. What it
does is make **OCR** a good enough way through it, which it is not today: OCR
returns text with rough boxes and gets structure wrong, which is fatal for a
parser inferring meaning and survivable when a human assigns it and can edit
the result.

So the order is: **R works everywhere now. M works on web now. M works on
native once P9 lands.**

## Templates — the part that makes it worth building

Mapping a document once is a chore. Mapping the *same series* every round is a
reason to stop using the app.

- [x] **P6. Save the mapping as a named template.** "WEC entry list",
      "NLS Teilnehmerliste". A domain entity — UUID v7, tombstones, `syncState`,
      the same rules as everything else in `core/domain/`.

- [x] **P7. Recognise a document a template already fits.** Match on the column
      structure, not the filename — publishers rename files constantly and keep
      their layout for years. Apply it, show the result, and let the human
      confirm or re-map. **Never apply silently**: a template that has gone
      stale because the publisher changed their layout produces confident
      nonsense, which is the one failure this whole design exists to avoid.

**P6 and P7 done — 25 August, including the UI.** `MappingTemplate` domain
type, `core/logic/templateMatch.ts`, a repository on
`trackside.mappingtemplates.v1`, and a `useMappingTemplates` hook feeding the
mapper. 20 + 10 tests.

Matched on **structure, not filename** — publishers rename files constantly and
keep layouts for years. Column count must agree exactly, then row-shape
overlap, weighted so a document that has *gained* a section still matches while
one *missing* what the template relies on does not. Proved on the fixtures: a
template made from the WEC list fits ELMS and is refused for NLS, which is the
direction that would do damage.

**Never applied automatically**, which was the explicit instruction and is also
the only defensible design: automatic cannot be right consistently, and a
template gone stale produces plausible cars from the wrong cells. The banner
offers "Use this layout" or "Map by hand"; either way the live preview shows
what it reads and a person presses Use.

That is the shape where this stops being a chore: the first WEC weekend costs
twenty seconds, and every one after that costs a glance.

---

## Timetables get this for free

The same seam, and the same screen. `timetableText.ts` currently guesses which
text on a row is the session name, which is the location, and which is a
duration — and it guesses well, because two `HH:MM` times are a strong anchor
that entry lists have no equivalent of.

- [x] **P8. Point the mapper at timetables too.** Same rows, same tapping,
      different field set (Day · Start · End · Session · Location · Ignore).

**Do not replace `timetableText.ts` with it.** That parser is tested against
three real documents and works. This is the fallback for the fourth document
that does not fit it — which today produces nothing and a shrug. Both feed the
same confirmation step, exactly as the file's own header already anticipates
for the model path.

---

## On-device PDF reading — solved, through a WebView

**Done — 25 August.** This section used to say native extraction was still
missing and offered a native text module *or* OCR. Neither was needed.

`pdfText.ts` says pdfjs cannot run on the phone because it needs a DOM and a
worker bundle Metro will not produce. Both are true of React Native's JS
context and **neither is true inside a WebView**, which is a browser: it has a
DOM, it has `Blob` and `URL.createObjectURL`, and pdfjs runs in it exactly as
it does on web — the same library already in this project, producing the same
positioned rows the fixtures were captured through.

`src/storage-local/pdfBridge.tsx`, with a `.web.tsx` sibling that needs no
WebView because it is already a browser. Four things worth knowing:

- **Nothing is fetched.** pdfjs and its worker ship as bundled assets, are
  read off disk at mount and inlined into the page, with the worker as a blob
  URL minted inside it. No CDN, no `file://` cross-reference for Android to
  refuse, no network call in the path — §1.4 means the importer works with no
  signal.
- **The extension is renamed** `.mjs` → `.pdfjs`, because Metro treats `.mjs`
  as source and would try to parse a 1.2MB minified bundle as a module.
- **A PDF goes straight to the mapper**, not through the string parser. It is
  the one input that still has its column positions, and the parser exists to
  throw those away.
- **Failure is reported, never returned as emptiness.** A PDF that yields no
  rows and one that failed to open look identical from outside, and the second
  must not be shown as "this document has no entries in it".

> **Why it never worked on an iPhone — found 11 September.** The WebView
> was given `onShouldStartLoadWithRequest={() => false}` to refuse every
> navigation. iOS asks that callback about the page's *own first load* too
> (`loadHTMLString:baseURL:` is a navigation to the base URL, and
> react-native-webview forwards it); Android's `loadDataWithBaseURL` never
> asks. So on iOS the page was cancelled before its first line ran — no stage
> report, no error, "Reading…" until the 25s timeout. The data:-URL fallback
> and the stage reports were both aimed at a page that never loaded.
>
> Fixed by `isOwnPage`: the base URL (and `about:blank`) may load, nothing
> else may. The same page, built by `buildHtml` around the real WEC timetable,
> was run in Chromium with a stub bridge: every stage reports and 93 rows come
> back. Stages now also go to `console`, so they land in Profile →
> Diagnostics — if it still fails on a device, the last `[pdf]` line says
> where. **Needs a rebuild to verify on the iPhone.**

---

## The hybrid, wired end to end — 11 September

> "Should be a kind of hybrid between the user and an algorithm."

P8 was ticked above but only the logic existed: the timetable screen had no
mapper and no editable review, so "the parser recognised nothing" was still a
shrug. Now both documents run the same three steps:

1. **The algorithm reads first.** Timetables: `parseTimetableLines`, which
   reads all three Spa documents. Entry lists from a PDF: straight to step 2,
   as before.
2. **The mapper opens pre-filled.** `core/logic/mappingGuess.ts` proposes what
   each column is — the number column (skipping HTC2's row counter), team,
   driver columns by how names are printed; start and end times (or both in
   one cell, as ELMS prints them), name and place columns. Tested against the
   real documents: WEC 35 cars and ELMS 47 with **no taps**, HTC2 car 7 not 3,
   WEC timetable 64 sessions with days carried from the heading rows. A wrong
   guess is one tap on that cell; "Start from empty" is there too.
3. **An editable review is the last word.** `core/logic/timetableReview.ts`
   (the timetable twin of `entryReview.ts`): every field correctable, delete,
   "+ Add a session the list missed", unread lines as rows to fill in, and a
   ticked row that cannot be written says why instead of vanishing.

`ColumnMapper` is now one screen for both, driven by a `MapperSpec`
(`ui/screens/mapperSpecs.ts`). `applyTimetableMapping` learned the three
shapes real timetables print: day headings as rows, both times in one cell,
and a whole line in one cell (paste) read from the start column alone.

---
## Honest costs

- **This is UI work**, and the UI is this app's thinnest layer. P3 is the
  hardest screen in the app so far: tappable text spans, a picker, and a live
  preview, one-handed, in gloves.
- **It is slower than a paste for a document that already parses.** WEC and
  ELMS come out perfectly today. Mapping must be the path for documents that
  *don't* parse, offered when confidence is low — not a toll booth in front of
  the two formats that work.
- **P1 and P2 are worth doing even if the UI never gets built.** Preserving
  columns would let the existing parser split NLS's entrant from its town and
  read HTC2's second integer — the two things it currently cannot do at all.

---

## Suggested order

1. **R1–R4 — the editable review table.** No extraction changes, works on both
   platforms, and makes all five documents usable immediately. If only one
   thing gets built, build this.
2. **P1 + P2** — positioned tokens and column clustering. Pure logic, tested
   against the five fixtures. Worth doing even if the mapper never gets built:
   preserving columns is what would let the existing parser split NLS's entrant
   from its town and read HTC2's second integer.
3. **M1–M3** — the visual mapper, web first, where it costs no new dependency.
4. **M4 + M5** — multi-line and row exclusion. This is where HTC2, NLS and Spa
   Six Hours all become correct rather than corrected.
5. **P6 + P7** — templates.
6. **P8** — timetables through the same screen.
7. **P9** — native page rendering and OCR, which unlocks M on the phone.

## Done means

- `npx tsc --noEmit` clean, `npx vitest run` green, no exclusions.
- All five fixtures in `src/core/logic/entry-lists/` fully readable via
  mapping — including the two the parser gets wrong today.
- The two `KNOWN BUG` assertions in `entryList.fixtures.test.ts` can be
  deleted, because the cases they record are no longer reachable.
- Verified on a device: mapping a real PDF, one-handed.
