/**
 * The forecast, reduced to something that fits on the time strip — F4.
 *
 * The strip already answers "what will the light be doing at four". This adds
 * the other half of that question, because light and weather are not
 * separable in practice: golden hour under a closed sky is not golden hour,
 * and a shot that needs the sun behind you needs to know whether there will
 * be one.
 *
 * Deliberately coarse. A number per hour on a strip a few hundred pixels wide
 * would be unreadable, and precision nobody can read is precision that only
 * makes the display harder to scan. Three states is what the strip can
 * usefully show: clear, cloudy, wet.
 */
import type { HourlyForecastPoint } from './forecast';

export type WeatherMarkKind = 'clear' | 'cloud' | 'rain';

export interface WeatherMark {
  /** Local hour, 0–23. */
  readonly hour: number;
  readonly kind: WeatherMarkKind;
}

/**
 * Rain wins over cloud, and the thresholds are not symmetrical.
 *
 * Any measurable rain is worth a mark: 0.2mm in an hour will not soak you but
 * it will put water on the lens, and that is a thing to know before walking
 * out to a spot with no shelter. Cloud has to be genuinely dominant before it
 * is worth saying — a mark at 30% cover would put a symbol on almost every
 * hour of a European summer and mean nothing.
 */
export function markFor(
  cloudCoverPercent: number | null,
  precipitationMm: number | null,
): WeatherMarkKind {
  if (precipitationMm !== null && precipitationMm >= 0.2) return 'rain';
  if (cloudCoverPercent !== null && cloudCoverPercent >= 60) return 'cloud';
  return 'clear';
}

/**
 * Marks for one local day, one per hour the forecast covers.
 *
 * Hours with nothing to say are omitted rather than returned as 'clear'. The
 * strip draws what it is given, and an absent mark is the honest rendering of
 * both "clear" and "no forecast for that hour" — inventing a clear-sky symbol
 * for an hour the provider never sent would be a claim, not a blank.
 *
 * `dayIso` is a local `YYYY-MM-DD`, matched against the point's own local
 * time. See the note on `HourlyForecastPoint.time` for why the series is kept
 * in circuit-local time rather than UTC.
 */
export function weatherMarksForDay(
  points: readonly HourlyForecastPoint[],
  dayIso: string,
): WeatherMark[] {
  const out: WeatherMark[] = [];
  const seen = new Set<number>();

  for (const p of points) {
    if (typeof p.time !== 'string' || !p.time.startsWith(dayIso)) continue;

    const hour = Number(p.time.slice(11, 13));
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    // A series should not carry an hour twice, but if it does the first entry
    // wins rather than the last — otherwise a duplicate silently overrides a
    // reading with no way to tell which was used.
    if (seen.has(hour)) continue;

    const kind = markFor(p.cloudCoverPercent, p.precipitationMm);
    seen.add(hour);
    if (kind !== 'clear') out.push({ hour, kind });
  }

  return out.sort((a, b) => a.hour - b.hour);
}
