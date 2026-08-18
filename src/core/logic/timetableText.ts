/**
 * Deterministic timetable parsing — spec §5.3.
 *
 * ── Why this exists alongside the model path ───────────────────────────────
 * §5.3 argues for a local LLM because "NLS and GTWC publish inconsistent, messy
 * PDFs" and regex is miserable at them. Three real 2026 Spa timetables bear the
 * inconsistency out — same circuit, same season, three different layouts:
 *
 *   WEC          08:30 13:00 FIA WEC ADMINISTRATIVE CHECKS Admin Checks Office
 *   ELMS         ELMS MANDATORY SCRUTINEERING
 *                08:30 13:00 Scrutineering - Garages 1 & 2
 *   Spa Classic  09:00 - 09:30 00:30 SPA-CLASSIC CLUB - Session 1 Private Practice
 *
 * But they share an invariant the spec could not have known without samples: a
 * session is a line, or a line and its immediate neighbour, carrying two HH:MM
 * times. Everything else — separators, column order, which side the name sits
 * on, bilingual headers — is variation around that.
 *
 * That makes a deterministic parser worth having as the *primary* path, for
 * three reasons the model cannot match:
 *
 *   • It works offline (§1.4), and on a phone, where Ollama cannot run at all.
 *   • It is testable. These functions are checked against real extracts from
 *     all three PDFs; a model's output cannot be pinned down that way.
 *   • It carries no model licence (§8).
 *
 * The model path in ../../storage-local/ollama.ts remains the fallback for
 * layouts this cannot crack. Both feed the same confirmation step: §5.3 is
 * emphatic that nothing is committed without the user seeing it first, and a
 * deterministic parser is no more trustworthy than a model in that respect —
 * it is only more predictable.
 */

export const SessionKindValues = [
  'practice',
  'qualifying',
  'race',
  'pitlaneWalk',
  'support',
  'other',
] as const;
export type TimetableKind = (typeof SessionKindValues)[number];

export interface TextSession {
  /** Day heading this fell under, verbatim. Null before any heading. */
  readonly day: string | null;
  /** Everything that was not a time or a duration on the line. */
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly durationMinutes: number;
  readonly kind: TimetableKind;
  /**
   * Whether this looks like track activity rather than paperwork.
   *
   * Scrutineering, admin checks and briefings dominate these documents and are
   * useless to a photographer. Flagged rather than dropped, because the
   * confirmation step should let the user decide, not this function.
   */
  readonly onTrack: boolean;
  /** Source line, so the confirmation screen can show what it read. */
  readonly source: string;
}

export interface TextParseResult {
  readonly sessions: readonly TextSession[];
  /** Lines that held times but could not be read into a session. */
  readonly skipped: readonly string[];
}

/** `9:05`, `09.05`, tolerant of the separators these PDFs actually use. */
const TIME = String.raw`(\d{1,2})[:.](\d{2})`;
/** Two times, with or without a dash between them. */
const TIME_PAIR = new RegExp(`${TIME}\\s*(?:[-–—]\\s*)?${TIME}`);
const ANY_TIME = new RegExp(TIME, 'g');
/** Non-global, for predicate use — see the note on statefulness above. */
const HAS_TIME = new RegExp(TIME);

/**
 * Day headings, in the languages these documents actually appear in.
 *
 * Spa Classic is bilingual French/English on one line; WEC is English; a German
 * NLS document would use the third set. Matching the weekday name is enough —
 * the date formats vary far more than the day names do.
 */
const DAY_WORDS =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i;

function toMinutes(h: number, m: number): number {
  return h * 60 + m;
}

function fmt(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** True when the line is a day heading rather than a session. */
export function isDayHeading(line: string): boolean {
  if (!DAY_WORDS.test(line)) return false;
  // "Sunrise: 06:04 / Sunset: 21:03" sits under a heading and mentions no day,
  // but a heading that also carries a time would be ambiguous — require that a
  // heading has no time pair.
  return !TIME_PAIR.test(line);
}

/**
 * Classify a session from its wording.
 *
 * Ordered deliberately: "qualifying practice" is qualifying, and a "pit walk"
 * is not a race even though "race" appears in "FIA WEC race pit walk".
 */
export function classify(text: string): TimetableKind {
  const t = text.toLowerCase();
  if (/pit\s*(lane)?\s*walk|pitwalk/.test(t)) return 'pitlaneWalk';
  if (/qualif|superpole|hyperpole/.test(t)) return 'qualifying';
  if (/\brace\b|\bcourse\b|\brennen\b|hours? of|grand prix/.test(t)) return 'race';
  if (/practice|essais|training|warm\s*up|test|shakedown/.test(t)) return 'practice';
  if (/briefing|scrutineer|administrative|checks?|inspection|press|meeting|autograph/.test(t)) {
    return 'other';
  }
  return 'support';
}

/** Paperwork versus track activity. */
function looksOnTrack(text: string, kind: TimetableKind): boolean {
  const t = text.toLowerCase();
  if (/scrutineer|administrative|briefing|press conference|meeting|checks/.test(t)) {
    return false;
  }
  if (kind === 'other') return /\btrack\b|\bpit\s*lane\b/.test(t);
  return true;
}

/**
 * Strip times, durations and column noise, leaving the human-readable name.
 *
 * The three documents pad their rows with a duration (`90'`, `00:45`) and an
 * interval column, and the PDF extractor leaves stray superscript fragments
 * behind (`st` from "1ˢᵗ floor"). None of that belongs in a session name.
 */
export function cleanTitle(line: string): string {
  return line
    .replace(ANY_TIME, ' ')
    .replace(/\b\d{1,3}'\s*/g, ' ')
    .replace(/(^|\s)[-–—]+(\s|$)/g, ' ')
    .replace(/\bst\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Parse extracted PDF lines into candidate sessions.
 *
 * Handles the one-line and name-on-previous-line shapes together: if a line
 * carrying times has too little text of its own, the preceding line is used as
 * the name. That single rule covers WEC and ELMS without knowing which is
 * which, which is the point — a per-publisher branch would need editing every
 * time somebody changes their template.
 */
export function parseTimetableLines(lines: readonly string[]): TextParseResult {
  const sessions: TextSession[] = [];
  const skipped: string[] = [];
  let day: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;

    if (isDayHeading(line)) {
      day = line;
      continue;
    }

    const pair = TIME_PAIR.exec(line);
    if (!pair) continue;

    const sh = Number(pair[1]);
    const sm = Number(pair[2]);
    const eh = Number(pair[3]);
    const em = Number(pair[4]);

    if (sh > 23 || eh > 23 || sm > 59 || em > 59) {
      skipped.push(line);
      continue;
    }

    // "Sunrise: 06:04 / Sunset: 21:03" reads as a time pair but is not a
    // session. It is the only such line in these documents and worth naming.
    if (/sunrise|sunset|lever de soleil|coucher/i.test(line)) continue;

    let title = cleanTitle(line);

    /**
     * Pull in the preceding line when it is a bare label.
     *
     * The rule is structural rather than length-based: if the previous line
     * carries no times and is not a day heading, it is a label belonging to
     * this row, so it goes in front. That covers the ELMS shape — where the
     * session name sits above its times — without touching WEC or Spa Classic,
     * whose rows follow one another and whose predecessors therefore always
     * contain times.
     *
     * An earlier version only reached back when the current line was short.
     * That silently lost names to long locations: "Michelin Le Mans Cup
     * ADMINISTRATIVE CHECKS" was replaced by "F1 Pitbuilding 1 floor Room 130",
     * which also stripped the keyword marking it as paperwork, so an admin
     * check was presented as a track session.
     */
    if (i > 0) {
      const prev = lines[i - 1]!.trim();
      // Rejects on *any* time, not just a pair. "Sunrise: 06:04 / Sunset:
      // 21:03" separates its two times with a slash, so TIME_PAIR misses it and
      // it was being prepended to the first session of each day as a label.
      if (prev !== '' && !HAS_TIME.test(prev) && !isDayHeading(prev)) {
        const label = cleanTitle(prev);
        // Guard against repeating a label the row already states, and against
        // extractor debris like the stray "st" from a superscript.
        if (label.length >= 3 && !title.toLowerCase().includes(label.toLowerCase())) {
          title = title === '' ? label : `${label} — ${title}`;
        }
      }
    }

    if (title === '') {
      skipped.push(line);
      continue;
    }

    const startM = toMinutes(sh, sm);
    const endM = toMinutes(eh, em);
    if (startM === endM) {
      skipped.push(line);
      continue;
    }
    // Wrapped end means it runs past midnight — normal at endurance events.
    const duration = endM > startM ? endM - startM : endM + 1440 - startM;

    const kind = classify(title);
    sessions.push({
      day,
      title,
      start: fmt(sh, sm),
      end: fmt(eh, em),
      durationMinutes: duration,
      kind,
      onTrack: looksOnTrack(`${title} ${line}`, kind),
      source: line,
    });
  }

  return { sessions, skipped };
}
