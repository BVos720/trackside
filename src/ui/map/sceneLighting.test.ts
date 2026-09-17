import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installSceneLighting, type SceneLightingState } from './sceneLighting';
import { SCENE_LIGHTING_SOURCE } from './sceneLightingSource';
import { cloudFieldGLSL, cloudFragmentShader, cloudShadowFragmentShader } from './atmosphereShaders';

const embedded = new Function(`return (${SCENE_LIGHTING_SOURCE});`)() as typeof installSceneLighting;
const options = { centre: [6, 50], bounds: [[5.99, 49.99], [6.02, 50.02]] } as const;
const state: SceneLightingState = { enabled: true, shadows: true, reducedMotion: true, altitude: 30, azimuth: 90, cover: 0, epoch: 1700000000, ground: 300 };

function fixture(install: typeof installSceneLighting) {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const layers = new Map<string, any>([['buildings-3d', { layout: { visibility: 'visible' } }], ['trees', { layout: { visibility: 'visible' } }]]);
  const sources = new Map<string, any>();
  const tree = { geometry: { type: 'Point', coordinates: [6.001, 50] }, properties: {} };
  const map = {
    getLayer: vi.fn((id: string) => layers.get(id)),
    getSource: (id: string) => sources.get(id),
    getLayoutProperty: (id: string, key: string) => layers.get(id)?.layout?.[key],
    getStyle: () => ({ sources: { buildings: { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { heightMetres: 20 }, geometry: { type: 'Polygon', coordinates: [[[6, 50], [6.001, 50], [6.001, 50.001], [6, 50.001], [6, 50]]] } }] } } } }),
    getZoom: () => 15,
    setLight: vi.fn(),
    queryRenderedFeatures: () => [tree, tree],
    addSource: (id: string, source: any) => sources.set(id, { ...source, setData: vi.fn((data: any) => { sources.get(id).data = data; }) }),
    addLayer: (layer: any) => layers.set(layer.id, layer),
    setPaintProperty: (id: string, key: string, value: any) => { layers.get(id).paint[key] = value; },
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
    on: (event: string, listener: (...args: any[]) => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
    off: (event: string, listener: (...args: any[]) => void) => listeners.get(event)?.delete(listener),
  };
  const mercator = { fromLngLat: ([lng, lat]: number[], altitude = 0) => ({ x: lng! / 360 + 0.5, y: 0.5 - lat! / 180, z: altitude / 40000000 }) };
  const onError = vi.fn();
  const controller = install(map as never, mercator as never, { ...options, onError });
  return { controller, map, layers, sources, listeners, onError };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), createElement: vi.fn(() => ({ getContext: () => null })) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe.each([['web', installSceneLighting], ['native bridge', embedded]] as const)('%s scenery lifecycle', (_name, install) => {
  it('projects buildings and deduplicates visible tree symbols', () => {
    const f = fixture(install); f.controller.update(state);
    const features = f.sources.get('scenery-shadow-source').data.features;
    expect(features.map((feature: any) => feature.properties.kind)).toEqual(['building', 'tree']);
    expect(Math.min(...features[0].geometry.coordinates[0].map((point: number[]) => point[0]))).toBeLessThan(6);
    expect(f.map.setLight).toHaveBeenCalledWith(expect.objectContaining({ anchor: 'map', position: [1.5, 90, 60] }));
    f.controller.dispose();
  });
  it('hides at night and redraws at the same daylight angle after re-enabling', () => {
    const f = fixture(install); f.controller.update(state);
    f.controller.update({ ...state, altitude: -3 });
    expect(f.layers.get('scenery-building-shadows').paint['fill-opacity']).toBe(0);
    f.controller.update({ ...state, shadows: false });
    expect(f.layers.get('scenery-building-shadows').paint['fill-opacity']).toBe(0);
    f.controller.update(state);
    expect(f.layers.get('scenery-building-shadows').paint['fill-opacity']).toBeGreaterThan(0);
    f.controller.dispose();
  });
  it('respects scenery visibility and releases sources and listeners', () => {
    const f = fixture(install); f.layers.get('trees').layout.visibility = 'none'; f.controller.update(state);
    expect(f.sources.get('scenery-shadow-source').data.features).toHaveLength(1);
    f.controller.dispose(); f.controller.dispose();
    expect(f.sources.size).toBe(0);
    expect([...f.listeners.values()].every(set => set.size === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('handles map removal after MapLibre has destroyed its style', () => {
    const f = fixture(install); f.controller.update(state);
    const remove = [...f.listeners.get('remove')!][0]!;
    f.map.getLayer.mockImplementation(() => { throw new Error('Style already destroyed'); });
    expect(remove).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps scenery usable and stops retrying when a cloud GPU context is unavailable', () => {
    const f = fixture(install); f.controller.update({ ...state, cover: 60, reducedMotion: false });
    f.controller.update({ ...state, cover: 80, reducedMotion: false });
    expect(f.onError).toHaveBeenCalledTimes(1);
    expect(f.sources.get('scenery-shadow-source').data.features.length).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
    f.controller.dispose();
  });
});

it('uses one cloud density and continuous daily drift in the volume and ground shader', () => {
  expect(cloudFragmentShader).toContain(cloudFieldGLSL);
  expect(cloudShadowFragmentShader).toContain(cloudFieldGLSL);
});
