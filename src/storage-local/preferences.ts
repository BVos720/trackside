/**
 * Small pieces of UI state that should survive a restart.
 *
 * Not domain data — nothing here is a record anyone syncs or backs up. It is
 * the answer to "where was I", which the app currently forgets every launch:
 * the event you are working on resets to none, and at a race weekend that means
 * re-picking it every time Android decides to kill the process.
 *
 * Deliberately separate from the repositories. These values have no ids, no
 * tombstones and no sync story, and putting them through the same machinery
 * would imply they do.
 */
import { DEFAULT_ACCENT_HUE } from '../core/logic/accentColor';
import { kv } from './kv';

const ACTIVE_EVENT = 'trackside.ui.activeEventId.v1';
const ACTIVE_VENUE = 'trackside.ui.venue.v1';
const SPOT_USE = 'trackside.ui.spotUse.v1';
const PROFILE_NAME = 'trackside.ui.profileName.v1';
const MAP_SCENERY = 'trackside.ui.mapScenery.v1';
const MAP_RAIN = 'trackside.ui.mapRain.v1';
const THEME_PREFERENCE = 'trackside.ui.themePreference.v1';
const THEME_ACCENT_HUE = 'trackside.ui.themeAccentHue.v1';
const SAFETY_ACKNOWLEDGED = 'trackside.ui.safetyAcknowledged.v1';

/**
 * The version of the safety notice this person has read, or null.
 *
 * ── Why a version and not a boolean ───────────────────────────────────────
 * A boolean can only answer "have they ever seen it". If what the notice says
 * changes — a new hazard, a clearer warning, a term that actually matters —
 * everybody who installed before the change would carry on having agreed to
 * the old text forever, and there would be no way to tell.
 *
 * Storing the version means bumping `SAFETY_NOTICE_VERSION` shows it again to
 * everyone. That is deliberately a slightly annoying thing to do, because it
 * should be: it interrupts people, so it should only happen when the content
 * genuinely changed.
 */
export async function getSafetyAcknowledgedVersion(): Promise<number | null> {
  const raw = await kv.get(SAFETY_ACKNOWLEDGED);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function setSafetyAcknowledgedVersion(version: number): Promise<void> {
  await kv.set(SAFETY_ACKNOWLEDGED, String(version));
}

export async function getActiveEventId(): Promise<string | null> {
  return kv.get(ACTIVE_EVENT);
}

export async function setActiveEventId(id: string | null): Promise<void> {
  if (id === null) await kv.remove(ACTIVE_EVENT);
  else await kv.set(ACTIVE_EVENT, id);
}

export async function getVenue(): Promise<string | null> {
  return kv.get(ACTIVE_VENUE);
}

export async function setVenue(venue: string): Promise<void> {
  await kv.set(ACTIVE_VENUE, venue);
}

/**
 * Whether the map is showing camera positions or watching positions.
 *
 * Remembered because it says why you are at the circuit at all, rather than
 * being a view option you flick between — someone spectating for a weekend
 * should not reselect it every time Android kills the process.
 */
export async function getSpotUse(): Promise<string | null> {
  return kv.get(SPOT_USE);
}

export async function setSpotUse(use: string): Promise<void> {
  await kv.set(SPOT_USE, use);
}

/**
 * The display name shown on the profile screen.
 *
 * There is only one local profile, and it belongs to `LOCAL_USER_ID`
 * (`ui/state/useSpots.ts`) — every spot, note and media row already carries
 * that id, so this is a label on that identity rather than a second one.
 * Null (nothing set, or cleared back to empty) reads as "unnamed", never as
 * a default string baked into storage.
 */
export async function getProfileName(): Promise<string | null> {
  return kv.get(PROFILE_NAME);
}

export async function setProfileName(name: string | null): Promise<void> {
  const trimmed = name?.trim() ?? '';
  if (trimmed === '') await kv.remove(PROFILE_NAME);
  else await kv.set(PROFILE_NAME, trimmed);
}

/**
 * Whether the map draws its woodland/field scatter (`trees` and
 * `groundDetail` in `src/ui/map/style.ts`) — TASKS-profile.md D1.
 *
 * Unset reads as enabled, matching the style module's own default: nobody
 * who has not visited the new performance setting sees a behaviour change.
 * Stored as `'0'`/`'1'` rather than a JSON boolean because every other value
 * in this store is a plain string and `kv` is a string-only port.
 */
export async function getMapSceneryEnabled(): Promise<boolean> {
  const raw = await kv.get(MAP_SCENERY);
  return raw !== '0';
}

export async function setMapSceneryEnabled(enabled: boolean): Promise<void> {
  await kv.set(MAP_SCENERY, enabled ? '1' : '0');
}

/**
 * Whether the 3D map draws falling rain — TASKS-map-sky.md D2.
 *
 * The rain is real in the sense that matters — it appears when the forecast
 * says it is raining at that circuit in that hour — but it is still animation
 * over the top of a map somebody is trying to read, and it costs frames the
 * whole time it is running. Both are reasons a person might want it off
 * without wanting the forecast off.
 *
 * Unset reads as enabled, matching every other default here: nobody who never
 * visits the setting sees a change.
 */
export async function getMapRainEnabled(): Promise<boolean> {
  const raw = await kv.get(MAP_RAIN);
  return raw !== '0';
}

export async function setMapRainEnabled(enabled: boolean): Promise<void> {
  await kv.set(MAP_RAIN, enabled ? '1' : '0');
}

/**
 * Light/dark mode — TASKS-profile.md B3. Three states, not two: `'system'`
 * follows the OS appearance setting, `'light'`/`'dark'` are an explicit
 * override. `'system'` is the default so a fresh install (or any value this
 * store has never seen) reads as "follow the phone" rather than pinning a
 * palette nobody chose.
 *
 * Unset, or any stored value other than the two explicit overrides, reads as
 * `'system'` — the same "unrecognised reads as the safe default" shape as
 * `getMapSceneryEnabled` above, rather than throwing on a value a future
 * version of the app no longer writes.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

export async function getThemePreference(): Promise<ThemePreference> {
  const raw = await kv.get(THEME_PREFERENCE);
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export async function setThemePreference(preference: ThemePreference): Promise<void> {
  if (preference === 'system') await kv.remove(THEME_PREFERENCE);
  else await kv.set(THEME_PREFERENCE, preference);
}

/**
 * The accent colour's hue — TASKS-profile.md C1. A single number, `0-360`,
 * not a hex string: deriving the actual `accent`/`onAccent` colours from it
 * happens in `theme.ts` (`ThemeProvider`, via `core/logic/accentColor.ts`'s
 * `deriveAccent`), which can re-derive correctly whenever `scheme` needs a
 * different saturation/lightness for the same hue — a stored hex could not.
 *
 * Unset, or any stored value that does not parse to a finite number, reads as
 * `DEFAULT_ACCENT_HUE` — the same "unrecognised reads as the safe default"
 * shape as `getThemePreference` above. `DEFAULT_ACCENT_HUE` is the hue the
 * app's original fixed accent (`#2E7DF6` dark / `#1B63D1` light) sat at, so a
 * fresh install looks the same as it did before this setting existed.
 */
export async function getThemeAccentHue(): Promise<number> {
  const raw = await kv.get(THEME_ACCENT_HUE);
  if (raw === null) return DEFAULT_ACCENT_HUE;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_ACCENT_HUE;
}

export async function setThemeAccentHue(hue: number): Promise<void> {
  await kv.set(THEME_ACCENT_HUE, String(hue));
}
