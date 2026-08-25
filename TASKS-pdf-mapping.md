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

- [ ] **P1. Return positioned tokens.** `extractPdfLines` gains a sibling —
      `extractPdfRows` — returning `{ y, tokens: { x, width, text }[] }[]`.
      Keep the joined-string version: `timetableText.ts` is tested against it
      and works, and this must not be a rewrite of a working parser.
      Owns `pdfText.web.ts` / `pdfText.ts` only. No UI.

- [ ] **P2. Cluster tokens into columns.** Pure logic in `core/logic/`: given
      the rows, find the x-bands that most rows share. This is the machine half
      of the co-work — it proposes the grid, and proposes nothing about meaning.
      Must degrade honestly: a document with no consistent bands (prose, or a
      single-column list) reports "no columns found" rather than inventing
      them. Test against all five fixtures. Logic and tests only.

---

## The interaction — tap a row, not fill a form

The obvious version is a spreadsheet-style header-mapping screen. **Do not
build that first.** It is a desktop idiom and this is a phone in a paddock.

The version that suits the device: **show one representative row, and have the
human tap the parts.**

```
  Row 4 of 47                      tap each part

  007   ASTON MARTIN THOR TEAM   USA   M   Aston Martin Valkyrie   Harry TINCKNELL (GBR)

  ↑ tap → [ Car number · Class · Team · Drivers · Ignore ]
```

Three or four taps maps the whole document, because a tap identifies a
*column*, and the column applies to every row. Then show the first three parsed
entries underneath, live, so a wrong tap is visible immediately rather than
after committing forty cars.

- [ ] **P3. The mapping screen.** One row, tappable tokens, a field picker, and
      a live preview of the first three results. `HIT_SIZE` throughout — this
      is a tap-accuracy exercise on a moving bus. One-handed.

- [ ] **P4. Multi-line entries, as a mode not a guess.** Spa Six Hours and NLS
      both span several lines per record. A single control — "each entry is N
      lines" — plus tapping fields on each of those lines. That one control is
      the whole fix for the seven cars that currently vanish, and for NLS's
      missing teams and drivers, neither of which any recogniser has managed.

- [ ] **P5. Row filtering.** Page headers, footers and section banners repeat.
      The human should be able to tap one and say "lines like this are not
      entries" (matched by x-band and shape, not by literal text, or it will
      not catch the same header on page 2). This is the general form of the
      four fabrication guards that were hand-coded into `entryList.ts`.

---

## Templates — the part that makes it worth building

Mapping a document once is a chore. Mapping the *same series* every round is a
reason to stop using the app.

- [ ] **P6. Save the mapping as a named template.** "WEC entry list",
      "NLS Teilnehmerliste". A domain entity — UUID v7, tombstones, `syncState`,
      the same rules as everything else in `core/domain/`.

- [ ] **P7. Recognise a document a template already fits.** Match on the column
      structure, not the filename — publishers rename files constantly and keep
      their layout for years. Apply it, show the result, and let the human
      confirm or re-map. **Never apply silently**: a template that has gone
      stale because the publisher changed their layout produces confident
      nonsense, which is the one failure this whole design exists to avoid.

That is the shape where this stops being a chore: the first WEC weekend costs
twenty seconds, and every one after that costs a glance.

---

## Timetables get this for free

The same seam, and the same screen. `timetableText.ts` currently guesses which
text on a row is the session name, which is the location, and which is a
duration — and it guesses well, because two `HH:MM` times are a strong anchor
that entry lists have no equivalent of.

- [ ] **P8. Point the mapper at timetables too.** Same rows, same tapping,
      different field set (Day · Start · End · Session · Location · Ignore).

**Do not replace `timetableText.ts` with it.** That parser is tested against
three real documents and works. This is the fallback for the fourth document
that does not fit it — which today produces nothing and a shrug. Both feed the
same confirmation step, exactly as the file's own header already anticipates
for the model path.

---

## What this does *not* solve

**Native PDF text extraction is still missing.** `PDF_SUPPORTED = false` in
`src/storage-local/pdfText.ts`; pdfjs needs a DOM and a worker bundle Metro
will not produce. On a phone this is still paste-only, and none of the above
changes that.

But it lowers the bar for solving it. **OCR from a screenshot becomes viable
once a human is doing the classification** — OCR gives you text and rough
positions and gets the structure wrong, which is fatal for a parser that must
infer meaning and survivable for one where a person assigns it. That reframes
STATUS.md's "native text module *or* OCR" from a toss-up into a clear
preference.

- [ ] **P9. Revisit on-device extraction after P1–P3 land**, with OCR as the
      leading candidate rather than the fallback.

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

1. **P1 + P2** — positioned tokens and column clustering. Pure logic, tested
   against the five fixtures, useful on their own.
2. **P3** — the tap-a-row screen, entry lists only.
3. **P4 + P5** — multi-line and row filtering. This is where HTC2, NLS and Spa
   Six Hours all become correct.
4. **P6 + P7** — templates.
5. **P8** — timetables.
6. **P9** — on-device extraction, reconsidered.

## Done means

- `npx tsc --noEmit` clean, `npx vitest run` green, no exclusions.
- All five fixtures in `src/core/logic/entry-lists/` fully readable via
  mapping — including the two the parser gets wrong today.
- The two `KNOWN BUG` assertions in `entryList.fixtures.test.ts` can be
  deleted, because the cases they record are no longer reachable.
- Verified on a device: mapping a real PDF, one-handed.
