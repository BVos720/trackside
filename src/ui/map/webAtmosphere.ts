import { MercatorCoordinate, type Map as MapLibreMap, type CustomLayerInterface, type ImageSource } from 'maplibre-gl';
import { rainVertexShader, rainFragmentShader, cloudFragmentShader } from './atmosphereShaders';
import { terrainShadowMask } from '../../core/logic/terrainShadow';

export interface AtmosphereState {
  cover: number; rain: number; azimuth: number; altitude: number; epoch: number;
  enabled: boolean; reducedMotion: boolean;
}

const cloudVertexShader = `#version 300 es
precision highp float;
in vec3 a_pos;
uniform mat4 u_matrix;
uniform float u_base, u_thickness, u_mercPerMetre;
out vec2 v_world;
out float v_t;
void main() {
  v_world = a_pos.xy; v_t = a_pos.z;
  gl_Position = u_matrix * vec4(a_pos.xy, (u_base + a_pos.z * u_thickness) * u_mercPerMetre, 1.0);
}`;

/** Owns GPU resources and repaint lifetime; uses the same shaders as the native terrain view. */
export function installWebAtmosphere(map: MapLibreMap, centre: readonly [number, number], bounds: readonly [readonly [number, number], readonly [number, number]]) {
  let state: AtmosphereState = { cover: 0, rain: 0, azimuth: 180, altitude: 30, epoch: Date.now() / 1000, enabled: false, reducedMotion: true };
  let started = performance.now(), frame = 0, previous = 0, disposed = false;
  let grid: Float32Array | null = null;
  let lastShadow = '';
  let ground = 0;
  const origin = MercatorCoordinate.fromLngLat([centre[0], centre[1]]);
  const rain: number[] = [], clouds: number[] = [];
  let seed = 9147;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 7000; i++) {
    const x = random() - 0.5, y = random() - 0.5, phase = random();
    for (const corner of [0, 1, 2, 2, 1, 3]) rain.push(x, y, phase, corner);
  }
  const west = bounds[0][0] - 0.55, south = bounds[0][1] - 0.55, east = bounds[1][0] + 0.55, north = bounds[1][1] + 0.55;
  const corners = [[west, south], [east, south], [east, north], [west, north]].map(p => MercatorCoordinate.fromLngLat([p[0]!, p[1]!]));
  for (let slice = 0; slice < 16; slice++) for (const index of [0, 1, 2, 0, 2, 3]) {
    const p = corners[index]!; clouds.push(p.x, p.y, 1 - slice / 15);
  }
  type GL = WebGLRenderingContext | WebGL2RenderingContext;
  function program(gl: GL, vs: string, fs: string) {
    const result = gl.createProgram()!;
    for (const [kind, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const shader = gl.createShader(kind)!; gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); gl.deleteProgram(result); throw new Error(message ?? 'Atmosphere shader failed'); }
      gl.attachShader(result, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) { const message = gl.getProgramInfoLog(result); gl.deleteProgram(result); throw new Error(message ?? 'Atmosphere program failed'); }
    return result;
  }
  function layer(kind: 'rain' | 'cloud'): CustomLayerInterface {
    let prog: WebGLProgram, buffer: WebGLBuffer, attribute: number;
    const locations = new Map<string, WebGLUniformLocation | null>();
    const data = new Float32Array(kind === 'rain' ? rain : clouds);
    return {
      id: `trackside-${kind}`, type: 'custom', renderingMode: '3d',
      onAdd(_map, gl) {
        prog = program(gl, kind === 'rain' ? rainVertexShader : cloudVertexShader, kind === 'rain' ? rainFragmentShader : cloudFragmentShader);
        buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        attribute = gl.getAttribLocation(prog, kind === 'rain' ? 'a_drop' : 'a_pos');
      },
      render(gl, args) {
        if (!state.enabled || (kind === 'rain' ? state.rain <= 0 : state.cover <= 0)) return;
        const uniform = (name: string) => { if (!locations.has(name)) locations.set(name, gl.getUniformLocation(prog, name)); return locations.get(name)!; };
        gl.useProgram(prog);
        gl.uniformMatrix4fv(uniform('u_matrix'), false, args.defaultProjectionData.mainMatrix);
        const at = map.getCenter(), merc = MercatorCoordinate.fromLngLat(at, 1).z;
        const time = state.epoch + (state.reducedMotion ? 0 : (performance.now() - started) / 1000);
        const light = Math.max(0, Math.min(1, (state.altitude + 6) / 30));
        gl.uniform1f(uniform('u_mercPerMetre'), merc);
        if (kind === 'rain') {
          const box = map.getBounds(), sw = MercatorCoordinate.fromLngLat(box.getSouthWest()), ne = MercatorCoordinate.fromLngLat(box.getNorthEast());
          const span = Math.max(Math.abs(ne.x - sw.x), Math.abs(ne.y - sw.y)) * 1.15, snap = span / 6;
          gl.uniform2f(uniform('u_origin'), Math.round((sw.x + ne.x) / 2 / snap) * snap, Math.round((sw.y + ne.y) / 2 / snap) * snap);
          gl.uniform1f(uniform('u_span'), span);
          gl.uniform1f(uniform('u_top'), ground + 550);
          gl.uniform1f(uniform('u_fall'), 650);
          gl.uniform1f(uniform('u_streak'), 7 + Math.min(state.rain, 10) * 1.2);
          gl.uniform1f(uniform('u_time'), (time % 3600) * 0.75);
          gl.uniform2f(uniform('u_resolution'), gl.drawingBufferWidth, gl.drawingBufferHeight);
          gl.uniform1f(uniform('u_alpha'), Math.min(0.55, 0.20 + state.rain * 0.035) * (0.4 + light * 0.6));
          gl.uniform3f(uniform('u_tint'), 0.62 + light * 0.2, 0.70 + light * 0.18, 0.80 + light * 0.14);
        } else {
          const mpp = 156543.03392 * Math.cos(at.lat * Math.PI / 180) / Math.pow(2, map.getZoom());
          const camera = map.getCanvas().clientHeight / 2 * mpp / 0.3333;
          gl.uniform1f(uniform('u_base'), Math.max(ground + 900, camera + 500));
          gl.uniform1f(uniform('u_thickness'), 450 + state.cover * 6);
          gl.uniform2f(uniform('u_noiseOrigin'), origin.x, origin.y);
          gl.uniform1f(uniform('u_cover'), state.cover / 100);
          gl.uniform1f(uniform('u_time'), time % 86400);
          gl.uniform1f(uniform('u_visible'), 1);
          const az = state.azimuth * Math.PI / 180, alt = state.altitude * Math.PI / 180;
          gl.uniform3f(uniform('u_sun'), Math.sin(az) * Math.cos(alt), -Math.cos(az) * Math.cos(alt), Math.sin(alt));
          const warmth = Math.max(0, 1 - Math.abs(state.altitude - 3) / 12) * (1 - state.cover / 140);
          gl.uniform3f(uniform('u_lit'), 0.18 + 0.78 * light, 0.22 + 0.72 * light - warmth * 0.16, 0.31 + 0.65 * light - warmth * 0.32);
          gl.uniform3f(uniform('u_shade'), 0.08 + 0.32 * light, 0.12 + 0.35 * light, 0.20 + 0.39 * light);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, kind === 'rain' ? 4 : 3, gl.FLOAT, false, 0, 0);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
        gl.drawArrays(gl.TRIANGLES, 0, kind === 'rain' ? Math.max(100, Math.floor(7000 * Math.min(1, Math.sqrt(state.rain / 8)))) * 6 : data.length / 3);
        gl.depthMask(true);
      },
      onRemove(_map, gl) { gl.deleteBuffer(buffer); gl.deleteProgram(prog); },
    };
  }
  map.addLayer(layer('cloud')); map.addLayer(layer('rain'));

  function shadows() {
    if (!state.enabled || state.altitude <= 0) { if (map.getLayer('trackside-shadow')) map.setPaintProperty('trackside-shadow', 'raster-opacity', 0); lastShadow = ''; return; }
    const size = 100, [sw, ne] = bounds;
    if (!grid) {
      const candidate = new Float32Array(size * size); let found = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const elevation = map.queryTerrainElevation({ lng: sw[0] + (ne[0] - sw[0]) * x / (size - 1), lat: sw[1] + (ne[1] - sw[1]) * y / (size - 1) });
        candidate[y * size + x] = elevation ?? NaN; if (elevation !== null) found++;
      }
      if (found < size * size * 0.85) return;
      grid = candidate;
    }
    const key = `${Math.round(state.azimuth * 2)}:${Math.round(state.altitude * 2)}:${Math.round(state.cover)}`;
    if (key === lastShadow) return;
    lastShadow = key;
    const mask = terrainShadowMask(grid, size, (ne[0] - sw[0]) * 111320 * Math.cos(centre[1] * Math.PI / 180), (ne[1] - sw[1]) * 110540, state.azimuth, state.altitude);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const context = canvas.getContext('2d')!; const image = context.createImageData(size, size);
    const strength = (0.32 + Math.max(0, (50 - state.altitude) / 50) * 0.38) * Math.min(1, state.altitude / 4) * (1 - state.cover / 100 * 0.85);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const p = ((size - 1 - y) * size + x) * 4; image.data[p] = 4; image.data[p + 1] = 12; image.data[p + 2] = 30; image.data[p + 3] = mask[y * size + x] ? Math.round(255 * strength) : 0; }
    context.putImageData(image, 0, 0);
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [[sw[0], ne[1]], [ne[0], ne[1]], [ne[0], sw[1]], [sw[0], sw[1]]];
    const source = map.getSource('trackside-shadow-source') as ImageSource | undefined;
    if (source) { source.updateImage({ url: canvas.toDataURL(), coordinates }); map.setPaintProperty('trackside-shadow', 'raster-opacity', 1); }
    else { map.addSource('trackside-shadow-source', { type: 'image', url: canvas.toDataURL(), coordinates }); map.addLayer({ id: 'trackside-shadow', type: 'raster', source: 'trackside-shadow-source', paint: { 'raster-opacity': 1, 'raster-fade-duration': 160 } }, map.getLayer('corner-labels') ? 'corner-labels' : 'trackside-cloud'); }
  }
  function tick(timestamp: number) {
    frame = 0;
    if (disposed || document.hidden || !state.enabled || state.reducedMotion || (!state.cover && !state.rain)) return;
    if (timestamp - previous >= 33) { previous = timestamp; map.triggerRepaint(); }
    frame = requestAnimationFrame(tick);
  }
  function wake() { if (frame) cancelAnimationFrame(frame); frame = requestAnimationFrame(tick); }
  function sample() { if (!state.enabled) return; const elevation = map.queryTerrainElevation(map.getCenter()); if (elevation !== null) ground = elevation; shadows(); }
  map.on('idle', sample); document.addEventListener('visibilitychange', wake);
  return {
    update(next: AtmosphereState) { state = next; started = performance.now(); if (state.enabled) sample(); else shadows(); wake(); map.triggerRepaint(); },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); map.off('idle', sample); document.removeEventListener('visibilitychange', wake);
      for (const id of ['trackside-rain', 'trackside-cloud', 'trackside-shadow']) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource('trackside-shadow-source')) map.removeSource('trackside-shadow-source');
    },
  };
}
