/**
 * Walking time, and when to leave.
 *
 * The planner's whole value is the answer to one question: it is 13:20, the
 * race you want starts at 14:00, and you are at Adenauer Forst — do you have
 * time to get to Brünnchen? Getting that wrong costs the shot you came for, so
 * the numbers here are deliberately pessimistic and deliberately explicit.
 *
 * ── Every constant here is a guess, and says so ────────────────────────────
 * Real walking speed depends on the person, the terrain, the crowd, and what
 * you are carrying. A body with two bodies and a 500mm on a monopod does not
 * move at Naismith pace. These are defaults that can be overridden, not
 * measurements, and nothing in this file should be presented to the user as a
 * precise time — the UI rounds up and says "about".
 */

/**
 * Metres per minute on a path.
 *
 * 75 m/min is 4.5 km/h — an unhurried walk, which is the honest assumption for
 * someone carrying camera gear rather than out for exercise. Erring slow means
 * the app tells you to leave early; erring fast means you miss the session.
 * Only one of those failures is recoverable.
 */
export const PATH_METRES_PER_MINUTE = 75;

/**
 * The off-network penalty.
 *
 * Direct legs cross grass, banks, ditches and fences. Treating them as
 * equivalent to path metres is how a route that looks like eight minutes turns
 * into twenty. Doubling the cost is a blunt instrument, and it is the right
 * kind of blunt: it biases towards leaving too early.
 */
export const OFF_NETWORK_PENALTY = 2;

/**
 * Fixed overhead per stop.
 *
 * Finding the gap in the fence, working out where you are actually allowed to
 * stand, getting the lens on. Never zero, even for a spot ten metres away.
 */
export const SETUP_MINUTES = 3;

/**
 * Slack on every journey, on top of the walk and the setup.
 *
 * Kept separate from SETUP_MINUTES because it answers a different question.
 * Setup is work you will certainly do — finding the gap, getting the lens on.
 * This is the admission that the estimate itself can be wrong: the path is
 * muddier than the map says, a gate is shut, the crossing is further than it
 * looked, you stop to talk to someone.
 *
 * Five minutes early costs five minutes of standing. Five minutes late costs
 * the session you came for, and there is no way to get it back — so the error
 * is deliberately one-sided.
 */
export const SAFETY_MARGIN_MINUTES = 5;

export interface WalkEstimate {
  readonly minutes: number;
  readonly metres: number;
  /** True when most of the journey is across ground we have no path for. */
  readonly mostlyOffNetwork: boolean;
}

/**
 * Minutes to walk a route, rounded up.
 *
 * Rounded up rather than to nearest: a 90-second underestimate is the
 * difference between standing ready and still walking when the pack arrives.
 */
export function walkEstimate(input: {
  metres: number;
  offNetworkMetres?: number;
  metresPerMinute?: number;
  setupMinutes?: number;
  /** Slack on top. Defaults to SAFETY_MARGIN_MINUTES; zero to measure raw. */
  marginMinutes?: number;
}): WalkEstimate {
  const metres = Math.max(0, input.metres);
  const off = Math.min(metres, Math.max(0, input.offNetworkMetres ?? 0));
  const onPath = metres - off;
  const speed = input.metresPerMinute ?? PATH_METRES_PER_MINUTE;
  const setup = input.setupMinutes ?? SETUP_MINUTES;
  const margin = input.marginMinutes ?? SAFETY_MARGIN_MINUTES;

  const effective = onPath + off * OFF_NETWORK_PENALTY;
  const minutes = Math.ceil(effective / speed) + setup + margin;

  return {
    minutes,
    metres,
    mostlyOffNetwork: metres > 0 && off / metres > 0.5,
  };
}

/** Local `HH:MM` → minutes since midnight, or null when unparseable. */
export function parseClock(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Minutes since midnight → `HH:MM`, wrapping across the day boundary. */
export function formatClock(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const m = String(wrapped % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * When to set off to arrive on time.
 *
 * Returns minutes since midnight, which may be negative if the walk starts the
 * previous day — the caller decides whether that is nonsense or a 04:00 start
 * for a dawn session. Clamping here would quietly turn "you cannot make it" into
 * "leave at midnight".
 */
export function departureMinute(
  arriveAtMinute: number,
  walkMinutes: number,
): number {
  return arriveAtMinute - walkMinutes;
}

export type Urgency = 'idle' | 'soon' | 'now' | 'late';

/**
 * How urgent the next stop is, given the time now.
 *
 * The thresholds are about attention, not precision. `soon` is far enough out
 * to finish what you are doing; `now` means stop and walk; `late` means the
 * plan is already broken and the app should say so rather than counting down to
 * a time that has passed.
 */
export function urgencyOf(
  nowMinute: number,
  departAtMinute: number,
): Urgency {
  const remaining = departAtMinute - nowMinute;
  if (remaining < 0) return 'late';
  if (remaining <= 2) return 'now';
  if (remaining <= 15) return 'soon';
  return 'idle';
}

/** "in 24 min", "in 1 h 05", "12 min ago". */
export function relativeMinutes(delta: number): string {
  const abs = Math.abs(Math.round(delta));
  const body =
    abs < 60
      ? `${abs} min`
      : `${Math.floor(abs / 60)} h ${String(abs % 60).padStart(2, '0')}`;
  if (delta < 0) return `${body} ago`;
  return `in ${body}`;
}

/** Minutes since local midnight for a Date. */
export function minuteOfDay(at: Date): number {
  return at.getHours() * 60 + at.getMinutes();
}
