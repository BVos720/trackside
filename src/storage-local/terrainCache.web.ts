/**
 * Elevation tiles — web.
 *
 * There is nothing to cache here. The browser already has an HTTP cache doing
 * this job, and there is no document directory to write to; `expo-file-system`
 * is a native module and importing it on web pulls in a shim that cannot store
 * anything durably anyway.
 *
 * More to the point, the reason the native side downloads terrain does not
 * apply. It exists so 3D still works at a circuit with no signal — and the web
 * build is the preview, used at a desk, where the network is the premise rather
 * than the thing being planned around.
 *
 * So the surface matches and every answer is "nothing stored": `terrainStatus`
 * reports zero of zero, `downloadTerrain` is a no-op, and
 * `localTerrainTemplate` returns null so the caller falls through to the remote
 * endpoint — which is exactly what a browser should use.
 */
export interface TerrainStatus {
  readonly have: number;
  readonly need: number;
  readonly complete: boolean;
}

export interface LatLonBounds {
  readonly bounds: readonly [readonly [number, number], readonly [number, number]];
}

/**
 * Zero of zero, and `complete: false`.
 *
 * Not `complete: true`. "Nothing to do" and "ready offline" are different
 * claims, and a UI that offers a download button would otherwise show this
 * platform as already finished — which would be a lie about a capability it
 * does not have.
 */
export async function terrainStatus(): Promise<TerrainStatus> {
  return { have: 0, need: 0, complete: false };
}

export async function downloadTerrain(): Promise<TerrainStatus> {
  return { have: 0, need: 0, complete: false };
}

export function localTerrainTemplate(): string | null {
  return null;
}

export async function clearTerrain(): Promise<void> {
  // Nothing was stored.
}
