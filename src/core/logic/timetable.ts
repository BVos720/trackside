/**
 * Timetable extraction — spec §5.3.
 *
 * A local model turns a pasted schedule into structured sessions. This module
 * holds the prompt and, more importantly, the *validation* of what comes back.
 *
 * ── Why validation is the substance here ───────────────────────────────────
 * §5.3 is explicit: "Always present parsed output for user confirmation before
 * committing. Never trust the extraction silently." A language model asked for
 * JSON will occasionally return prose, invent a field, emit "14:60", or hand
 * back a race that finishes before it starts. None of that may reach the
 * database, and none of it may be silently corrected either — a session whose
 * time was quietly "fixed" is worse than one visibly rejected, because the user
 * plans a day around it.
 *
 * So everything below is written to reject rather than repair, and to say which
 * row failed and why.
 *
 * ── Model licensing — spec §8 ──────────────────────────────────────────────
 * §8 says: "Llama's license carries redistribution conditions. Prefer Qwen or
 * Mistral (Apache 2.0) if the app is ever distributed." Gemma is in that same
 * category — it ships under Google's Gemma Terms of Use, not Apache 2.0, with a
 * prohibited-use policy and an obligation to pass the terms downstream. Fine for
 * personal use; a real constraint the day this is distributed. The model name is
 * configuration precisely so it can be swapped without touching this logic.
 */

/** A session as the model is asked to produce it, before validation. */
export interface RawSession {
  session?: unknown;
  class?: unknown;
  start?: unknown;
  end?: unknown;
  kind?: unknown;
}

export const SessionKindValues = [
  'practice',
  'qualifying',
  'race',
  'pitlaneWalk',
  'support',
] as const;
export type ParsedKind = (typeof SessionKindValues)[number];

/** A validated session, ready to show the user for confirmation. */
export interface ParsedSession {
  readonly seriesName: string;
  readonly className: string | null;
  readonly kind: ParsedKind;
  /** `HH:MM`, 24-hour, local to the circuit. */
  readonly start: string;
  readonly end: string;
  /** Minutes from start to end, for sanity display. */
  readonly durationMinutes: number;
}

export interface RejectedSession {
  readonly raw: RawSession;
  readonly reason: string;
}

export interface ParseResult {
  readonly sessions: readonly ParsedSession[];
  readonly rejected: readonly RejectedSession[];
}

/**
 * The extraction prompt.
 *
 * Deliberately narrow: §5.3's job here is start and finish times, not a general
 * document understanding task. Smaller models follow a tight brief far better
 * than an open one, and every field asked for is a field that can come back
 * wrong.
 */
export function buildPrompt(scheduleText: string): string {
  return [
    'Extract the track sessions from this motorsport timetable.',
    '',
    'Return ONLY a JSON object of the form:',
    '{"sessions":[{"session":"","class":"","start":"HH:MM","end":"HH:MM","kind":""}]}',
    '',
    'Rules:',
    '- "kind" must be one of: practice, qualifying, race, pitlaneWalk, support.',
    '- "start" and "end" must be 24-hour HH:MM. Do not guess times that are not written.',
    '- If a session has no end time, omit that session entirely.',
    '- Do not invent sessions. Only include rows actually present.',
    '- "class" may be an empty string if the timetable does not name one.',
    '',
    'Timetable:',
    scheduleText,
  ].join('\n');
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOf(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Normalise the handful of separators models actually emit for times. */
function normaliseTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/[.h]/g, ':');
  const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  // Reject rather than clamp: "24:15" or "14:75" means the row was misread, and
  // rounding it to something plausible hides that.
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normaliseKind(value: unknown): ParsedKind | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().replace(/[\s_-]/g, '');
  const map: Record<string, ParsedKind> = {
    practice: 'practice',
    freepractice: 'practice',
    fp: 'practice',
    warmup: 'practice',
    qualifying: 'qualifying',
    qualification: 'qualifying',
    quali: 'qualifying',
    q: 'qualifying',
    race: 'race',
    rennen: 'race',
    pitlanewalk: 'pitlaneWalk',
    pitwalk: 'pitlaneWalk',
    support: 'support',
  };
  return map[v] ?? null;
}

/**
 * Validate a model response into sessions the user can confirm.
 *
 * Accepts the raw response text so a model that wraps its JSON in prose or a
 * fenced code block is still usable — that is a formatting slip, not bad data.
 * Anything beyond that is rejected with a reason rather than guessed at.
 */
export function parseSessions(responseText: string): ParseResult {
  const sessions: ParsedSession[] = [];
  const rejected: RejectedSession[] = [];

  let payload: unknown;
  try {
    payload = JSON.parse(extractJson(responseText));
  } catch {
    return {
      sessions: [],
      rejected: [{ raw: {}, reason: 'Model did not return usable JSON.' }],
    };
  }

  const list = (payload as { sessions?: unknown })?.sessions;
  if (!Array.isArray(list)) {
    return {
      sessions: [],
      rejected: [{ raw: {}, reason: 'Response had no "sessions" array.' }],
    };
  }

  for (const item of list) {
    const raw = (item ?? {}) as RawSession;

    const name = typeof raw.session === 'string' ? raw.session.trim() : '';
    if (name === '') {
      rejected.push({ raw, reason: 'No session name.' });
      continue;
    }

    const start = normaliseTime(raw.start);
    const end = normaliseTime(raw.end);
    if (start === null || end === null) {
      rejected.push({ raw, reason: 'Start or end time missing or not HH:MM.' });
      continue;
    }

    const kind = normaliseKind(raw.kind);
    if (kind === null) {
      rejected.push({ raw, reason: `Unrecognised session kind "${String(raw.kind)}".` });
      continue;
    }

    const startM = minutesOf(start);
    const endM = minutesOf(end);

    // Checked before the midnight wrap below, not after. Wrapping treats an
    // end at or before the start as "next day", which silently turned an
    // identical start and end into a 24-hour session instead of rejecting it.
    if (endM === startM) {
      rejected.push({ raw, reason: 'Start and end are the same time.' });
      continue;
    }

    // Sessions running past midnight are real at endurance events, so a
    // wrapped end is treated as next-day rather than rejected.
    const duration = endM > startM ? endM - startM : endM + 24 * 60 - startM;
    if (duration > 24 * 60) {
      rejected.push({ raw, reason: 'Session longer than 24 hours.' });
      continue;
    }

    const className =
      typeof raw.class === 'string' && raw.class.trim() !== ''
        ? raw.class.trim()
        : null;

    sessions.push({
      seriesName: name,
      className,
      kind,
      start,
      end,
      durationMinutes: duration,
    });
  }

  return { sessions, rejected };
}

/**
 * Pull the JSON object out of a response.
 *
 * Models wrap JSON in ```json fences or a sentence of preamble often enough
 * that failing on it would make the feature feel broken when the data is fine.
 */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return body.trim();
  return body.slice(start, end + 1);
}
