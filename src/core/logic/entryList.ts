/**
 * Deterministic entry-list parsing.
 *
 * The sibling of timetableText.ts, built on the same bet and for the same
 * reasons: it works offline on a phone, it can be tested against real
 * documents, and it carries no model licence. As there, nothing it produces is
 * committed without the user seeing it first.
 *
 * ── What real entry lists look like ───────────────────────────────────────
 * Five documents in `entry-lists/` — WEC, ELMS, NLS, and two historic series —
 * and they share almost nothing. Worse, the text arrives with its columns
 * already destroyed: `extractPdfLines` joins positioned glyphs with a single
 * space and collapses runs, because that is what makes a timetable readable as
 * rows. So a table that looked like columns on screen reaches this file as
 *
 *   007 ASTON MARTIN THOR TEAM USA M Aston Martin Valkyrie Harry TINCKNELL (GBR) P
 *
 * with nothing marking where one field ends. Splitting on whitespace is not
 * available, which is the single fact that shapes everything below.
 *
 * ── Recognisers, most specific first ──────────────────────────────────────
 * One rule set cannot read all five, so this is a short list of recognisers,
 * each matching a shape it can prove, with a generic separator-based parser
 * last for text that still has its delimiters — pasted from a web page, or
 * typed. A recogniser either matches confidently or declines; none of them
 * guesses, and a line no recogniser claims is reported rather than mangled.
 *
 *   1. `readNatCodeLine` — WEC and ELMS. Anchored on the `(GBR)` codes after
 *      driver names, which are unambiguous, and on the strict
 *      `number TEAM NAT tyre` prefix.
 *   2. `readEntrantMarkerLine` — NLS. Anchored on the `B` (Bewerber) marker.
 *   3. `readDelimitedLine` — anything that still has bullets, tabs, column
 *      gaps or commas.
 *
 * ── What it will not do ───────────────────────────────────────────────────
 * The two historic lists put a row index in front of the car number
 * (`3 7 David HART …`) or split one car across two lines. Once the whitespace
 * is gone there is no way to tell the index from the number, so those lines
 * yield the number and nothing else rather than a confident wrong answer. See
 * entryList.test.ts, which pins down exactly what each of the five produces.
 */

export interface TextEntry {
  /** As printed, text — see the note on `Entry.number`. */
  readonly number: string;
  /** From the line, or from the class heading it fell under. Null if neither. */
  readonly className: string | null;
  readonly team: string | null;
  readonly drivers: readonly string[];
  /** Source line, so the confirmation screen can show what it read. */
  readonly source: string;
}

export interface EntryParseResult {
  readonly entries: readonly TextEntry[];
  /**
   * Lines that looked like entries but could not be read.
   *
   * For manual entry, not for diagnostics: the user is meant to see these and
   * type in what the parser could not. Prose, page furniture and column
   * headers are not reported — they were never entries, and a "check these"
   * list padded with the document's title is one nobody checks.
   */
  readonly skipped: readonly string[];
}

/**
 * A car number at the start of a line: `7`, `#7`, `007`, `24A`, `7.`
 *
 * Bounded at three digits because that is what fits on a car, and because an
 * unbounded run of digits also matches a year, a distance and a phone number.
 * `(?!\d)` is what rejects `2026 ENTRY LIST` — without it the year parses as
 * car 202 and the document's title becomes the first entry.
 */
const CAR_NUMBER = /^#?\s*(\d{1,3}[A-Za-z]?)(?!\d)[.)]?\s+(.*)$/;
/** The same, for a line that is nothing but a number. */
const BARE_NUMBER = /^#?\s*(\d{1,3}[A-Za-z]?)$/;

/**
 * A leading clock time, rejected before anything else is tried.
 *
 * `09:00 FIA WEC FREE PRACTICE 1` otherwise reads as car 09 with a team called
 * FIA WEC. Pasting the timetable half of a programme into the entry-list box is
 * an ordinary mistake, and the honest outcome is nothing rather than 40 cars
 * named after sessions.
 */
const LEADING_TIME = /^#?\s*\d{1,2}[:.]\d{2}\b/;

/**
 * Class names, as the series that use them actually write them.
 *
 * Matched against a whole field, never as a prefix. "Pro" and "Am" are real
 * GTWC classes and also the first word of plenty of team names, so
 * `Pro Racing GmbH` must not read as class `Pro` with the rest thrown away.
 */
const CLASS_CORE = String.raw`(?:hypercar|lmh|lmdh|lmp[123](?:[\s-]*pro\/?am)?|lmgt3|lmgte|gte|gtp|gtd|gt[2-4]|cup\s?\d+|sp\s?\d+[a-z]*|sp-?x|at-?g?|v[2-9]|vt\d|tcr|tce|silver|bronze|pro|am|invitational|clubsport|group\s?[a-d]\d?)`;
const CLASS_FIELD = new RegExp(`^${CLASS_CORE}(?:[\\s-]*(?:pro|am))*$`, 'i');

/**
 * The class banner over a block of cars, in the WEC/ELMS column header.
 *
 * `N° 17 HYPERCAR COMPETITORS NAT T CARS MISC DRIVER 1 C …` — the 17 is how
 * many cars are in the class, not a car number, so this has to be recognised
 * before anything tries to read a car off it.
 */
const SECTION_HEADER = /^N°?\s*\d+\s+(.+?)\s+COMPETITORS\b/i;

/**
 * The NLS class banner: `SP9 24h-Spezial 9 - GT3 FIA Teilnehmer: 17`.
 *
 * Anchored on `Teilnehmer:` — the count marks it as a banner rather than a
 * car, and the class is the token in front.
 */
const NLS_SECTION = /^([A-Za-zÄÖÜ]+\s?[\d-]*[A-Za-z]*)\b.*\bTeilnehmer:\s*\d+/i;

/**
 * A driver's nationality code, and the strongest anchor in any of these files.
 *
 * WEC, ELMS and the Spa Six Hours list all print it, always in parentheses,
 * always immediately after the name and nowhere else on the line. It is the
 * one thing in a space-collapsed row that marks a field boundary.
 */
const NAT_CODE = /\(([A-Z]{3})\)/g;

/**
 * The driver categorisation letter — Platinum, Gold, Silver, Bronze.
 *
 * Printed after each driver, and doubles as a separator: where a driver's
 * nationality is missing, the lone letter is the only thing between two names.
 */
const CATEGORY_LETTER = /^[PGSB]$/;

/**
 * The WEC/ELMS row prefix: number, an all-capitals team, its three-letter
 * nationality, and a single-letter tyre supplier.
 *
 * Strict on purpose. Requiring all four in order is what lets the recogniser
 * decline other documents instead of half-reading them: nothing in the NLS or
 * historic lists matches it.
 */
const NAT_ROW =
  /^(\d{1,3}[A-Z]?)\s+([A-Z0-9ÀÁÂÄÆÃÅĀÇÉÈÊËÍÎÏÑÓÔÖØÚÜŠŽ&.'’\- ]{2,}?)\s+([A-Z]{3})\s+([MG])\s+(.+)$/;

/** The NLS row prefix: number, then the `B` entrant marker. */
const ENTRANT_ROW = /^(\d{1,3}[A-Za-z]?)\s+B\s+(.+)$/;

/** Column headers, so a pasted table's first row is not reported as unreadable. */
const HEADER_WORDS =
  /^(?:no\.?|nr\.?|num(?:ber)?|car|#|team|entrant|class|cat(?:egory)?|drivers?|pilotes?|pilot\s?\d|fahrer|bewerber|sponsor|wohnort|tyres?|tires?|engine|make|model|year|nat|t|c|misc|cars)$/i;

/**
 * Page furniture that carries a number and would otherwise read as a car.
 *
 * The WEC list ends with a bare `35` (the total), a tyre legend and a
 * timestamp. None of them is an entry.
 */
const LEGEND_LINE = /^(?:tyres?|categorisation|categorization)\b.*:/i;

/**
 * The words a real team, class or driver field never opens with, tried
 * against what follows a `CAR_NUMBER` match before that match is trusted.
 *
 * Every one of these was caught by capture, not guessed: a race's own title
 * (`4 HOURS OF SPA-FRANCORCHAMPS …`), a date range (`25 TO 27 SEPTEMBER
 * 2025`), a bilingual car count (`23 voitures / cars`), a closing car-count
 * footer (`35 CARS IN THE ENTRY LIST`) and a repeating organiser credit
 * (`#3. HISTORIC GRAND PRIX CARS ASSOCIATION`). All five are page furniture
 * that happens to start with a number, and a car number in front of prose is
 * still prose — see job #2 in HANDOFF-entry-lists.md. Narrow on purpose: this
 * rejects what has actually been seen rather than guessing at team-name
 * shapes in general.
 */
const FURNITURE_PROSE = /^(?:hours\s+of\b|to\s+\d|voitures\b|cars\b|historic\b)/i;

/**
 * A date or date range in the body of what should be a team/driver field.
 *
 * `1. ADAC Eifel Trophy (19.06.2026 - 20.06.2026)` is the NLS running page
 * header, repeated once per page — nothing about its words alone marks it as
 * furniture, but no entrant, class or driver field in any of these documents
 * carries a date. Job #2.
 */
const DATE_RANGE = /\(\s*\d{1,2}[./]\d{1,2}[./]\d{2,4}\s*[-–]\s*\d{1,2}[./]\d{1,2}[./]\d{2,4}\s*\)/;

/** Separators an entry list actually uses, in the order they are looked for. */
const SEPARATORS: readonly RegExp[] = [
  /\s*[·•|]\s*/,
  /\t+/,
  /\s{2,}/,
  /\s*;\s*/,
];

/** Splits several drivers out of one field. */
const SLASH_SPLIT = /\s*\/\s*/;
const AMP_SPLIT = /\s*(?:&|\band\b)\s*/i;

/** True when a field carries several drivers rather than one name or a team. */
export function looksLikeDrivers(field: string): boolean {
  const trimmed = field.trim();

  if (SLASH_SPLIT.test(trimmed)) {
    const parts = trimmed.split(SLASH_SPLIT).filter((p) => p.trim() !== '');
    // A slash between two long phrases is a route or a location, not a crew.
    return parts.length >= 2 && parts.every((p) => p.trim().split(/\s+/).length <= 4);
  }

  /*
   * `&` only when nothing in the field names an entrant.
   *
   * Biased deliberately towards reading it as a team: a two-driver crew mis-read
   * as a team name is visible on screen and fixable in one tap, whereas a team
   * silently split into two drivers loses the entrant entirely and looks
   * plausible while doing it.
   */
  if (AMP_SPLIT.test(trimmed) && !TEAM_WORDS.test(trimmed)) {
    const parts = trimmed.split(AMP_SPLIT).filter((p) => p.trim() !== '');
    return parts.length >= 2 && parts.every((p) => p.trim().split(/\s+/).length <= 3);
  }

  return false;
}

/**
 * Words that mark a field as an entrant rather than a person.
 *
 * Used only to stop `&` from splitting a team in half: `Rowe Racing & Partners`
 * is one entrant, `Conway & Kobayashi` is two drivers, and nothing about their
 * shape tells them apart.
 */
const TEAM_WORDS =
  /\b(?:racing|motorsports?|team|autosport|auto|competition|competizione|engineering|performance|sport|sports|gmbh|ag|srl|s\.r\.l|ltd|bv|b\.v|inc|by|garage|squadra|scuderia|partners)\b/i;

/** Split a field known to hold drivers. */
function splitDrivers(field: string): string[] {
  const sep = SLASH_SPLIT.test(field) ? SLASH_SPLIT : AMP_SPLIT;
  return field
    .split(sep)
    .map((d) => d.trim())
    .filter((d) => d !== '');
}

/** True when a field reads as one person's name. */
export function looksLikePersonName(field: string): boolean {
  const trimmed = field.trim();
  if (trimmed === '' || /\d/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  // Every word starts with a capital, initials included: "J.M. Lopez".
  return words.every((w) => /^[A-ZÀ-Þ]/.test(w));
}

/** True when a field names a class. */
export function looksLikeClass(field: string): boolean {
  return CLASS_FIELD.test(field.trim());
}

/** Strip a trailing count or colon: `LMP2 (14 cars)`, `HYPERCAR:`. */
function bareHeading(line: string): string {
  return line
    .replace(/\(.*?\)\s*$/, '')
    .replace(/[:—–-]\s*$/, '')
    .trim();
}

/**
 * True when the line is a class heading over the block of cars beneath it.
 *
 * The entry-list equivalent of a day heading in a timetable, and handled the
 * same way: remembered and applied to what follows rather than becoming a
 * record of its own.
 */
export function isClassHeading(line: string): boolean {
  if (SECTION_HEADER.test(line)) return true;
  if (NLS_SECTION.test(line) && !CAR_NUMBER.test(line)) return true;
  if (CAR_NUMBER.test(line) || BARE_NUMBER.test(line)) return false;
  const bare = bareHeading(line);
  return bare !== '' && looksLikeClass(bare);
}

/** The class a heading names, or null when the line is not one. */
export function classFromHeading(line: string): string | null {
  const section = SECTION_HEADER.exec(line);
  if (section) return section[1]!.trim();

  if (!CAR_NUMBER.test(line)) {
    const nls = NLS_SECTION.exec(line);
    if (nls) return nls[1]!.trim();
  }

  if (CAR_NUMBER.test(line) || BARE_NUMBER.test(line)) return null;
  const bare = bareHeading(line);
  return bare !== '' && looksLikeClass(bare) ? bare : null;
}

/** Split the part after the number into fields, on whichever separator is used. */
export function splitFields(rest: string): string[] {
  for (const sep of SEPARATORS) {
    if (sep.test(rest)) {
      return rest
        .split(sep)
        .map((f) => f.trim())
        .filter((f) => f !== '');
    }
  }
  /*
   * Comma last, and only when there are at least two.
   *
   * A single comma is far more likely to sit inside one field — `Kobayashi,
   * Kamui` or `Rowe Racing, Munich` — than to separate two, and splitting on it
   * would cut a name in half. Two or more reads as a deliberate list.
   */
  if ((rest.match(/,/g) ?? []).length >= 2) {
    return rest
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f !== '');
  }
  const single = rest.trim();
  return single === '' ? [] : [single];
}

/** True when the fields are a table's column headers rather than a car. */
function isHeaderRow(fields: readonly string[]): boolean {
  return fields.length >= 2 && fields.every((f) => HEADER_WORDS.test(f.trim()));
}

/**
 * Pull driver names out of a space-collapsed row using the nationality codes.
 *
 * Every driver but the first has both boundaries marked — the previous code
 * ends one and its own code ends the other — so those names come out exactly.
 * The first driver has only a right-hand boundary, because the car model runs
 * straight into it with nothing between:
 *
 *   … Aston Martin Valkyrie Harry TINCKNELL (GBR) …
 *
 * For that one the name is taken as the trailing run of capitals plus a single
 * given name in front. It errs towards a short name — `Jens Reno MØLLER` comes
 * out as `Reno MØLLER` — rather than towards swallowing `Valkyrie`, because a
 * clipped first name is obvious on screen while a car model presented as a
 * driver is not.
 */
function driversFromNatCodes(region: string): string[] {
  const codes = [...region.matchAll(NAT_CODE)];
  if (codes.length === 0) return [];

  const drivers: string[] = [];
  let cursor = 0;

  codes.forEach((code, i) => {
    const before = region.slice(cursor, code.index).trim();
    cursor = code.index + code[0].length;

    if (i === 0) {
      drivers.push(...firstDriverName(before));
      return;
    }

    /*
     * Split on the leftover categorisation letters.
     *
     * A driver whose nationality is missing leaves two names inside one
     * segment — `B Timur BOGUSLAVSKIY S Ayhancan GÜVEN` — with only the lone
     * `S` between them. The letters are the delimiter the document already
     * has, so they are used as one rather than inventing a rule.
     */
    for (const name of splitOnCategoryLetters(before)) drivers.push(name);
  });

  return drivers;
}

/** Break a segment on lone P/G/S/B letters and drop them. */
function splitOnCategoryLetters(segment: string): string[] {
  const out: string[] = [];
  let current: string[] = [];

  for (const word of segment.split(/\s+/)) {
    if (word === '') continue;
    if (CATEGORY_LETTER.test(word)) {
      if (current.length > 0) out.push(current.join(' '));
      current = [];
      continue;
    }
    current.push(word);
  }
  if (current.length > 0) out.push(current.join(' '));
  // `-` marks a car with no third driver.
  return out.filter((n) => n !== '' && n !== '-');
}

/**
 * The first driver's name, taken off the end of the car model.
 *
 * The surname is printed in capitals in every one of these documents, so the
 * trailing run of capitalised words is the surname, and the word in front of
 * it is the given name.
 */
function firstDriverName(before: string): string[] {
  const words = splitOnCategoryLetters(before).join(' ').split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [];

  let start = words.length;
  while (start > 0 && isShoutedWord(words[start - 1]!)) start--;
  if (start === words.length) {
    // No capitalised surname to anchor on. Better nothing than the car model.
    return [];
  }
  // One given name in front of the surname, when there is one to take.
  if (start > 0 && /^[A-ZÀ-Þ][^\s]*$/.test(words[start - 1]!)) start--;

  return [words.slice(start).join(' ')];
}

/** True for a word printed in capitals, accents and particles included. */
function isShoutedWord(word: string): boolean {
  if (!/[A-ZÀ-Þ]/.test(word)) return false;
  return word === word.toUpperCase() && !/\d/.test(word);
}

/** WEC and ELMS: `7 TOYOTA RACING JPN M Toyota TR010 Hybrid HY Mike CONWAY (GBR) P …` */
function readNatCodeLine(line: string): TextEntry | null {
  const row = NAT_ROW.exec(line);
  if (!row) return null;

  const [, number, team, , , rest] = row;
  const drivers = driversFromNatCodes(rest!);
  if (drivers.length === 0) return null;

  return {
    number: number!,
    className: null,
    team: team!.trim(),
    drivers,
    source: line,
  };
}

/**
 * NLS: `5 B BLACK FALCON Team EAE Meuspath 51399 Porsche 911 GT3 R`
 *
 * The number is certain and the class comes from the banner above, which is
 * what a tick list actually needs. The team is deliberately left null: the
 * columns are entrant, town, licence and car, all of them plain words, and
 * once the spacing is gone there is no boundary between the entrant and the
 * town to find. `BLACK FALCON Team EAE Meuspath` is not a team name, and
 * offering it as one would be a guess wearing a fact's clothes.
 *
 * The driver rows beneath (`F Kaya, Mustafa Mehmet Türkei …`) are a separate
 * shape again and are left alone rather than half-read.
 */
function readEntrantMarkerLine(line: string): TextEntry | null {
  const row = ENTRANT_ROW.exec(line);
  if (!row) return null;

  return {
    number: row[1]!,
    className: null,
    team: null,
    drivers: [],
    source: line,
  };
}

/**
 * Assign delimited fields to class, team and drivers.
 *
 * The order is the whole design. Drivers go first because a slash-joined field
 * is unambiguous; class next, because its vocabulary is closed; team is what
 * remains. Nothing is assigned by position, so a series that prints the class
 * before the team parses the same as one that prints it after.
 */
function assign(fields: readonly string[]): {
  className: string | null;
  team: string | null;
  drivers: string[];
} {
  const rest = [...fields];
  let drivers: string[] = [];

  const driversAt = rest.findIndex(looksLikeDrivers);
  if (driversAt !== -1) {
    drivers = splitDrivers(rest[driversAt]!);
    rest.splice(driversAt, 1);
  }

  const classAt = rest.findIndex(looksLikeClass);
  const className = classAt === -1 ? null : rest[classAt]!.trim();
  if (classAt !== -1) rest.splice(classAt, 1);

  /*
   * Drivers as one column each.
   *
   * Taken from the *end* of the row, and only while something is left in front
   * to be the team. A lone name-shaped field stays the team: `#7 Rowe Racing`
   * is the common shape, and reading its only field as a driver would leave
   * every single-column list with no teams and an invented driver each.
   */
  if (drivers.length === 0 && rest.length >= 2) {
    let from = rest.length;
    while (from > 1 && looksLikePersonName(rest[from - 1]!)) from--;
    if (from < rest.length) drivers = rest.splice(from).map((d) => d.trim());
  }

  const team = rest.length > 0 ? rest[0]!.trim() : null;

  /*
   * One long unsplit field is a row whose columns were lost, not a team.
   *
   * `# 17 Mats vd BRAND BMW M3 E30 1992 Group A2` arrives as a single field
   * holding a driver, a car, a year and a class. Storing all of it as the team
   * would put four facts in a field that means one, and the entry would look
   * complete while being wrong in a way no later reader could untangle. The
   * number is kept — it is what gets ticked — and the rest is left blank.
   */
  const unsegmented =
    fields.length === 1 && team !== null && team.split(/\s+/).length > 4;

  return {
    className,
    team: unsegmented ? null : team,
    drivers,
  };
}

/** Anything that still has its delimiters — a web-page paste, or typing. */
function readDelimitedLine(line: string, rest: string): TextEntry | null {
  const fields = splitFields(rest);
  if (isHeaderRow(fields)) return null;

  const { className, team, drivers } =
    fields.length === 0
      ? { className: null, team: null, drivers: [] as string[] }
      : assign(fields);

  return { number: '', className, team, drivers, source: line };
}

/**
 * Parse pasted entry-list text.
 *
 * Line-oriented, like the timetable parser, because that is the shape text
 * arrives in when it is copied out of a PDF or a web page.
 */
export function parseEntryList(text: string): EntryParseResult {
  return parseEntryLines(text.split(/\r?\n/));
}

export function parseEntryLines(lines: readonly string[]): EntryParseResult {
  const entries: TextEntry[] = [];
  const skipped: string[] = [];
  /** Entries that came from a line with fields, as opposed to a bare number. */
  const bareOnly: TextEntry[] = [];
  let currentClass: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    if (LEADING_TIME.test(line)) continue;
    if (LEGEND_LINE.test(line)) continue;
    // A lone categorisation letter is the tail of the row above, wrapped.
    if (CATEGORY_LETTER.test(line)) continue;

    const heading = classFromHeading(line);
    if (heading !== null) {
      currentClass = heading;
      continue;
    }

    const structured = readNatCodeLine(line) ?? readEntrantMarkerLine(line);
    if (structured) {
      entries.push({ ...structured, className: structured.className ?? currentClass });
      continue;
    }

    const withRest = CAR_NUMBER.exec(line);
    if (withRest) {
      /*
       * A number in front of prose is still prose — page furniture, not a
       * car that happens to have fields. Dropped like any other furniture,
       * not reported: it was never an entry to begin with.
       */
      if (FURNITURE_PROSE.test(withRest[2]!) || DATE_RANGE.test(withRest[2]!)) {
        continue;
      }

      /*
       * Two numbers and then a name is a row index in front of the car number,
       * which the historic lists use. Which of the two is the car cannot be
       * recovered once the column positions are gone, so the line is reported
       * rather than answered with a coin flip.
       */
      if (/^\d{1,3}\s*$/.test(withRest[2]!)) {
        skipped.push(line);
        continue;
      }

      const read = readDelimitedLine(line, withRest[2]!);
      if (read) {
        entries.push({
          ...read,
          number: withRest[1]!,
          className: read.className ?? currentClass,
        });
      }
      continue;
    }

    const bare = BARE_NUMBER.exec(line);
    if (bare) {
      bareOnly.push({
        number: bare[1]!,
        className: currentClass,
        team: null,
        drivers: [],
        source: line,
      });
      continue;
    }

    /*
     * No car number. Reported only when the line was shaped like an entry.
     *
     * A row of columns with no number in the first one is a row that lost its
     * car and is worth typing in by hand. A sentence, a page title or a column
     * header is not.
     */
    const fields = splitFields(line);
    if (fields.length >= 3 && !isHeaderRow(fields)) skipped.push(line);
  }

  /*
   * Bare numbers count only when nothing richer was found.
   *
   * `7` on its own is a real entry in a stripped copy-paste of just the
   * numbers. It is also the page count at the foot of the WEC list, the `35`
   * under the last car. Whether it is a car depends on the company it keeps:
   * in a document that yielded forty full rows a lone number is furniture, and
   * in one that yielded nothing else it is the list.
   */
  if (entries.length === 0) entries.push(...bareOnly);

  return { entries, skipped };
}

/**
 * One line describing what a parse found, for the confirmation step.
 *
 * Says so plainly when nothing was found. That is the case most in need of
 * stating, because the alternative is a confirmation screen that looks like it
 * worked and commits nothing.
 */
export function describeEntryParse(result: EntryParseResult): string {
  const n = result.entries.length;
  const head = n === 0 ? 'No entries found' : `${n} entr${n === 1 ? 'y' : 'ies'}`;
  if (result.skipped.length === 0) return `${head}.`;
  const s = result.skipped.length;
  return `${head}, ${s} line${s === 1 ? '' : 's'} to enter by hand.`;
}
