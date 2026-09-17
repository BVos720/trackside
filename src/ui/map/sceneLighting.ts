import type { Map as MapLibreMap, MercatorCoordinate as Mercator, GeoJSONSource, ImageSource, CustomLayerInterface } from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { cloudPlacement, projectFootprint, shadowStrength, treeFootprint } from '../../core/logic/sceneShadows';
import { cloudShadowFragmentShader, nightSkyFragmentShader } from './atmosphereShaders';

export interface SceneLightingState {
  enabled: boolean;
  shadows: boolean;
  stars?: boolean;
  reducedMotion: boolean;
  cover: number;
  azimuth: number;
  altitude: number;
  epoch: number;
  ground: number;
  moon?: { azimuth: number; altitude: number } | null;
}

const quadShader = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 1.0, 1.0); }`;

function makeProgram(gl: WebGLRenderingContext | WebGL2RenderingContext, fragment: string) {
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to allocate scene lighting program');
  for (const [kind, source] of [[gl.VERTEX_SHADER, quadShader], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(kind);
    if (!shader) { gl.deleteProgram(program); throw new Error('Unable to allocate scene lighting shader'); }
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader); gl.deleteProgram(program);
      throw new Error(error ?? 'Scene lighting shader did not compile');
    }
    gl.attachShader(program, shader); gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program); gl.deleteProgram(program);
    throw new Error(error ?? 'Scene lighting program did not link');
  }
  return program;
}

/** This module is also embedded at build time in the native WebView; never Function.toString(). */
export function installSceneLighting(map: MapLibreMap, MercatorCoordinate: typeof Mercator, options: {
  centre: readonly [number, number];
  bounds: readonly [readonly [number, number], readonly [number, number]];
  sky?: boolean;
  onError?: (message: string) => void;
}) {
  let state: SceneLightingState = { enabled: false, shadows: true, reducedMotion: true, cover: 0, azimuth: 180, altitude: -18, epoch: 0, ground: 0 };
  let disposed = false, mapRemoved = false, started = performance.now(), lastCloud = '', lastScenery = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let canvas: HTMLCanvasElement | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let cloudProgram: WebGLProgram | null = null, cloudBuffer: WebGLBuffer | null = null;
  let cloudFailed = false;
  let lastLight = '';
  const locations = new Map<string, WebGLUniformLocation | null>();
  const origin = MercatorCoordinate.fromLngLat([options.centre[0], options.centre[1]]);
  const merc = MercatorCoordinate.fromLngLat([options.centre[0], options.centre[1]], 1).z;
  const [sw, ne] = options.bounds;
  const northwest = MercatorCoordinate.fromLngLat([sw[0], ne[1]]);
  const southeast = MercatorCoordinate.fromLngLat([ne[0], sw[1]]);
  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [[sw[0], ne[1]], [ne[0], ne[1]], [ne[0], sw[1]], [sw[0], sw[1]]];
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  const seconds = () => state.epoch + (state.reducedMotion ? 0 : (performance.now() - started) / 1000);
  const active = () => !disposed && state.enabled && !document.hidden;
  const before = () => map.getLayer('buildings-3d') ? 'buildings-3d' : map.getLayer('corner-labels') ? 'corner-labels' : undefined;
  const visible = (id: string) => Boolean(map.getLayer(id)) && map.getLayoutProperty(id, 'visibility') !== 'none';

  function scenery(force = false) {
    const opacity = state.enabled && state.shadows ? shadowStrength(state.altitude, state.cover) : 0;
    for (const id of ['scenery-building-shadows', 'scenery-tree-shadows']) {
      if (map.getLayer(id)) map.setPaintProperty(id, 'fill-opacity', opacity * (id.includes('tree') ? 0.65 : 0.8));
    }
    if (!active() || opacity <= 0) { lastScenery = ''; return; }
    const key = `${Math.round(state.azimuth * 2)}:${Math.round(state.altitude * 2)}:${visible('buildings-3d')}:${visible('trees')}:${map.getZoom() >= 14}`;
    if (!force && key === lastScenery) return;
    const features: Feature[] = [];
    const source = map.getStyle().sources.buildings;
    const buildings = source?.type === 'geojson' && typeof source.data !== 'string' && source.data?.type === 'FeatureCollection' ? source.data.features : [];
    if (visible('buildings-3d')) for (const feature of buildings) {
      const geometry = feature.geometry;
      const rings = geometry?.type === 'Polygon' ? [geometry.coordinates[0]] : geometry?.type === 'MultiPolygon' ? geometry.coordinates.map(p => p[0]) : [];
      const height = typeof feature.properties?.heightMetres === 'number' ? feature.properties.heightMetres : 6;
      for (const ring of rings) {
        if (!ring) continue;
        const hull = projectFootprint(ring, height, state.azimuth, state.altitude);
        if (hull) features.push({ type: 'Feature', properties: { kind: 'building' }, geometry: { type: 'Polygon', coordinates: [hull] } });
      }
    }
    if (visible('trees') && map.getZoom() >= 14) {
      // Use rendered symbols: this respects the user's scenery radius and layer filter.
      const trees = map.queryRenderedFeatures({ layers: ['trees'] });
      const seen = new Set<string>();
      for (const tree of trees) {
        if (seen.size >= 1500) break;
        if (tree.geometry.type !== 'Point') continue;
        const [lng, lat] = tree.geometry.coordinates;
        if (lng === undefined || lat === undefined) continue;
        const key = `${lng.toFixed(6)}:${lat.toFixed(6)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Woodland points and sprites are illustrative, so their 10m height is too.
        const hull = projectFootprint(treeFootprint(lng, lat), 10, state.azimuth, state.altitude);
        if (hull) features.push({ type: 'Feature', properties: { kind: 'tree' }, geometry: { type: 'Polygon', coordinates: [hull] } });
      }
    }
    const collection: FeatureCollection<Geometry> = { type: 'FeatureCollection', features };
    if (!map.getSource('scenery-shadow-source')) {
      map.addSource('scenery-shadow-source', { type: 'geojson', data: empty });
      for (const kind of ['building', 'tree']) map.addLayer({
        id: `scenery-${kind}-shadows`, type: 'fill', source: 'scenery-shadow-source',
        filter: ['==', ['get', 'kind'], kind], minzoom: kind === 'tree' ? 14 : 0,
        paint: { 'fill-color': '#07111c', 'fill-opacity': opacity * (kind === 'tree' ? 0.65 : 0.8), 'fill-antialias': true },
      }, before());
    }
    (map.getSource('scenery-shadow-source') as GeoJSONSource).setData(collection);
    lastScenery = key;
  }

  function clouds() {
    const opacity = state.enabled && state.shadows && state.altitude > 0 && state.cover > 0 ? Math.min(1, state.altitude / 6) * 0.52 : 0;
    if (map.getLayer('cloud-ground-shadows')) map.setPaintProperty('cloud-ground-shadows', 'raster-opacity', opacity);
    if (!active() || !opacity || cloudFailed) { lastCloud = ''; return; }
    const time = seconds();
    const key = `${Math.floor(time / 2)}:${state.cover}:${state.azimuth}:${state.altitude}:${state.ground}`;
    if (key === lastCloud) return;
    try {
      if (!canvas) {
        canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
        gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
        if (!gl) throw new Error('WebGL2 unavailable for cloud shadows');
        cloudProgram = makeProgram(gl, cloudShadowFragmentShader);
        cloudBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cloudBuffer); gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
      }
      if (!gl || !cloudProgram) return;
      const uniform = (name: string) => {
        if (!locations.has(name)) locations.set(name, gl!.getUniformLocation(cloudProgram!, name));
        return locations.get(name)!;
      };
      gl.useProgram(cloudProgram); gl.viewport(0, 0, 128, 128);
      gl.bindBuffer(gl.ARRAY_BUFFER, cloudBuffer);
      const attribute = gl.getAttribLocation(cloudProgram, 'a_pos'); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
      // GL's first row is south; image sources interpret the PNG's first row as north.
      gl.uniform4f(uniform('u_bounds'), northwest.x, southeast.y, southeast.x, northwest.y);
      gl.uniform2f(uniform('u_noiseOrigin'), origin.x, origin.y);
      gl.uniform1f(uniform('u_cover'), state.cover / 100); gl.uniform1f(uniform('u_time'), time % 86400);
      const placement = cloudPlacement(state.ground, 0, state.cover);
      gl.uniform1f(uniform('u_base'), placement.base); gl.uniform1f(uniform('u_thickness'), placement.thickness);
      gl.uniform1f(uniform('u_ground'), state.ground); gl.uniform1f(uniform('u_merc'), merc); gl.uniform1f(uniform('u_strength'), 1);
      const az = state.azimuth * Math.PI / 180, alt = state.altitude * Math.PI / 180;
      gl.uniform3f(uniform('u_sun'), Math.sin(az) * Math.cos(alt), -Math.cos(az) * Math.cos(alt), Math.sin(alt));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const url = canvas.toDataURL();
      const source = map.getSource('cloud-ground-source') as ImageSource | undefined;
      if (source) source.updateImage({ url, coordinates });
      else {
        map.addSource('cloud-ground-source', { type: 'image', url, coordinates });
        map.addLayer({ id: 'cloud-ground-shadows', type: 'raster', source: 'cloud-ground-source', paint: { 'raster-opacity': opacity, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }, before());
      }
      lastCloud = key;
    } catch (error) { cloudFailed = true; options.onError?.(`Cloud shadows: ${String(error)}`); }
  }

  function refresh(force = false) {
    if (disposed) return;
    if (active()) {
      const key = `${Math.round(state.azimuth * 2)}:${Math.round(state.altitude * 2)}:${Math.round(state.cover)}`;
      if (key !== lastLight) {
        const day = Math.max(0, Math.min(1, (state.altitude + 6) / 25));
        const warmth = Math.max(0, 1 - Math.abs(state.altitude - 3) / 12);
        map.setLight({ anchor: 'map', position: [1.5, state.azimuth, 90 - Math.max(0, state.altitude)],
          intensity: 0.12 + day * 0.48 * (1 - state.cover / 160),
          color: `rgb(255,${Math.round(255 - warmth * 35)},${Math.round(255 - warmth * 65)})`,
        });
        lastLight = key;
      }
    }
    scenery(force); clouds();
  }
  function wake() {
    clearTimeout(timer);
    if (!active()) return;
    refresh();
    if (!state.reducedMotion && !cloudFailed && state.shadows && state.cover > 0 && state.altitude > 0) timer = setTimeout(wake, 2000);
  }
  const move = () => { if (active()) refresh(true); };
  map.on('moveend', move);
  // Source symbols may arrive after the first update. idle is not used for animated work.
  let sourceRefresh: ReturnType<typeof setTimeout> | undefined;
  const sourceData = (event: { sourceId?: string }) => {
    if (event.sourceId !== 'trees' && event.sourceId !== 'buildings') return;
    clearTimeout(sourceRefresh); sourceRefresh = setTimeout(move, 100);
  };
  map.on('sourcedata', sourceData);
  document.addEventListener('visibilitychange', wake);

  if (options.sky) {
    let program: WebGLProgram, buffer: WebGLBuffer;
    const uniforms = new Map<string, WebGLUniformLocation | null>();
    const sky: CustomLayerInterface = {
      id: 'trackside-night-sky', type: 'custom', renderingMode: '3d',
      onAdd(_map, context) { program = makeProgram(context, nightSkyFragmentShader); buffer = context.createBuffer()!; context.bindBuffer(context.ARRAY_BUFFER, buffer); context.bufferData(context.ARRAY_BUFFER, quad, context.STATIC_DRAW); },
      render(context) {
        if (!state.enabled || state.altitude > 0) return;
        const uniform = (name: string) => { if (!uniforms.has(name)) uniforms.set(name, context.getUniformLocation(program, name)); return uniforms.get(name)!; };
        context.useProgram(program); context.bindBuffer(context.ARRAY_BUFFER, buffer);
        const attribute = context.getAttribLocation(program, 'a_pos'); context.enableVertexAttribArray(attribute); context.vertexAttribPointer(attribute, 2, context.FLOAT, false, 0, 0);
        context.uniform1f(uniform('u_pitch'), map.getPitch() * Math.PI / 180); context.uniform1f(uniform('u_bearing'), map.getBearing() * Math.PI / 180);
        context.uniform1f(uniform('u_aspect'), context.drawingBufferWidth / context.drawingBufferHeight);
        context.uniform1f(uniform('u_night'), state.stars === false ? 0 : Math.max(0, Math.min(1, (-state.altitude - 4) / 12))); context.uniform1f(uniform('u_cover'), state.cover / 100);
        context.uniform1f(uniform('u_epoch'), seconds() % 86164.0905); context.uniform1f(uniform('u_latitude'), options.centre[1] * Math.PI / 180);
        for (const [name, position] of [['u_moon', state.moon], ['u_sun', state]] as const) {
          const az = (position?.azimuth ?? 0) * Math.PI / 180, alt = (position?.altitude ?? -90) * Math.PI / 180;
          context.uniform3f(uniform(name), Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt));
        }
        context.uniform1f(uniform('u_moonVisible'), state.moon && state.moon.altitude > 0 ? 1 : 0);
        context.enable(context.BLEND); context.blendFunc(context.SRC_ALPHA, context.ONE_MINUS_SRC_ALPHA);
        context.enable(context.DEPTH_TEST); context.depthFunc(context.LEQUAL); context.depthMask(false); context.disable(context.CULL_FACE);
        context.drawArrays(context.TRIANGLES, 0, 6); context.depthMask(true);
      },
      onRemove(_map, context) { context.deleteBuffer(buffer); context.deleteProgram(program); },
    };
    map.addLayer(sky);
  }

  function dispose() {
    if (disposed) return;
    disposed = true; clearTimeout(timer); clearTimeout(sourceRefresh);
    map.off('moveend', move); map.off('sourcedata', sourceData); map.off('remove', onMapRemove); document.removeEventListener('visibilitychange', wake);
    if (!mapRemoved) {
      for (const id of ['trackside-night-sky', 'scenery-building-shadows', 'scenery-tree-shadows', 'cloud-ground-shadows']) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of ['scenery-shadow-source', 'cloud-ground-source']) if (map.getSource(id)) map.removeSource(id);
    }
    gl?.deleteBuffer(cloudBuffer); gl?.deleteProgram(cloudProgram); gl?.getExtension('WEBGL_lose_context')?.loseContext();
    gl = null; canvas = null;
  }
  function onMapRemove() { mapRemoved = true; dispose(); }
  map.on('remove', onMapRemove);
  return {
    cloudPlacement,
    refresh: () => refresh(true),
    update(next: SceneLightingState) { const changed = state.enabled !== next.enabled || state.shadows !== next.shadows; state = next; started = performance.now(); refresh(changed); wake(); },
    dispose,
  };
}
