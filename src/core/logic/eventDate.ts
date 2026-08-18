/**
 * Matching a timetable's day heading to a real date.
 *
 * A published timetable says "SATURDAY, MAY 9" or "Sunday 11 October" — a
 * weekday, sometimes a day number, almost never a year. On its own that cannot
 * become a date, which is why sessions used to be stored against today's date
 * with only the time meaningful.
 *
 * An event now carries real dates, and that closes the gap: the heading only
 * has to identify *which* of the event's own days it refers to, and there are
 * rarely more than three.
 *
 * ── Returning null is a real answer ────────────────────────────────────────
 * When nothing matches, this returns null and the caller keeps the heading as
 * written rather than guessing. A timetable pinned to the wrong day is worse
 * than one with no date at all: it will schedule someone to be at a corner on
 * a day when nothing is running, and look authoritative doing it.
 */

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/** Local `YYYY-MM-DD` → Date at local midnight, or null. */
function parseIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Which of `days` a heading refers to, or null.
 *
 * Tries the day number first, then the weekday name. The number is the stronger
 * signal: a race weekend can span two Saturdays across a fortnight, but "11"
 * appears once in an eleven-day window.
 */
export function matchEventDay(
  heading: string,
  days: readonly string[],
): string | null {
  if (days.length === 0) return null;
  const text = heading.toLowerCase();

  // ── day of month ────────────────────────────────────────────────────────
  // Bounded to 1–31 so a time ("14:00") or a year cannot be read as a date.
  const numbers = [...text.matchAll(/\b(\d{1,2})\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 1 && n <= 31);

  for (const n of numbers) {
    const hits = days.filter((d) => parseIso(d)?.getDate() === n);
    // Only accept an unambiguous match. Two candidates means the heading does
    // not identify a day on its own.
    if (hits.length === 1) return hits[0]!;
  }

  // ── weekday name ────────────────────────────────────────────────────────
  const named = WEEKDAYS.findIndex((w) => text.includes(w));
  if (named !== -1) {
    const hits = days.filter((d) => parseIso(d)?.getDay() === named);
    if (hits.length === 1) return hits[0]!;
  }

  // A single-day event: any heading can only mean that day.
  if (days.length === 1) return days[0]!;

  return null;
}
