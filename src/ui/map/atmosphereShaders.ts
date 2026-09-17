/** WebGL2 shaders shared by the terrain renderer. Positions stay in world space. */
export const rainVertexShader = `#version 300 es
precision highp float;
in vec4 a_drop;
uniform mat4 u_matrix;
uniform float u_time, u_top, u_fall, u_streak, u_mercPerMetre, u_span;
uniform vec2 u_origin, u_resolution;
out vec2 v_uv;
out float v_fade;
void main() {
  float tail = floor(a_drop.w / 2.0);
  float side = mod(a_drop.w, 2.0) * 2.0 - 1.0;
  float speed = mix(0.72, 1.3, a_drop.z);
  float phase = fract(a_drop.z + u_time * speed);
  float gust = sin(u_time * 0.37 + a_drop.z * 18.0) * 0.12;
  vec2 drift = vec2(0.24 + gust, 0.10);
  vec2 world = u_origin + a_drop.xy * u_span + drift * phase * 32.0 * u_mercPerMetre;
  float height = u_top - phase * u_fall;
  vec4 head = u_matrix * vec4(world, height * u_mercPerMetre, 1.0);
  vec4 end = u_matrix * vec4(world - drift * u_streak * u_mercPerMetre, (height + u_streak * speed) * u_mercPerMetre, 1.0);
  vec2 direction = (end.xy / max(end.w, 0.000001) - head.xy / max(head.w, 0.000001)) * u_resolution;
  vec2 perpendicular = normalize(vec2(-direction.y, direction.x) + vec2(0.00001));
  vec4 p = mix(head, end, tail);
  // Pixel-width quads avoid device-dependent GL_LINES widths. Perspective still sets length.
  p.xy += perpendicular * side * mix(0.65, 1.35, a_drop.z) / u_resolution * p.w;
  gl_Position = p;
  v_uv = vec2(side, tail);
  v_fade = smoothstep(0.0, 0.08, phase) * (1.0 - smoothstep(0.90, 1.0, phase));
}`;

export const rainFragmentShader = `#version 300 es
precision highp float;
uniform float u_alpha;
uniform vec3 u_tint;
in vec2 v_uv;
in float v_fade;
out vec4 o;
void main() {
  float edge = 1.0 - smoothstep(0.15, 1.0, abs(v_uv.x));
  float tail = mix(0.95, 0.10, v_uv.y);
  o = vec4(u_tint, u_alpha * edge * tail * v_fade);
}`;

/** One density field for the visible volume and its ground projection. */
export const cloudFieldGLSL = `
float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float field(vec3 p) {
  return noise(p) * 0.57 + noise(p * 2.03 + 7.0) * 0.28 + noise(p * 4.11 + 13.0) * 0.15;
}
vec3 cloudPoint(vec2 world, float slice) {
  // Periodic drift has no jump when the time slider crosses midnight.
  float phase = u_time * 6.28318530718 / 86400.0;
  vec2 drift = vec2(sin(phase) * 55.0, cos(phase) * 35.0);
  return vec3((world - u_noiseOrigin) * 9000.0 + drift, slice * 1.8);
}
float cloudDensity(vec2 world, float slice) {
  float profile = smoothstep(0.0, 0.16, slice) * (1.0 - smoothstep(0.52, 1.0, slice));
  float threshold = mix(0.78, 0.22, u_cover);
  return smoothstep(threshold, threshold + 0.16, field(cloudPoint(world, slice))) * profile;
}`;

export const cloudFragmentShader = `#version 300 es
precision highp float;
in vec2 v_world;
in float v_t;
uniform float u_cover, u_time, u_visible;
uniform vec2 u_noiseOrigin;
uniform vec3 u_lit, u_shade, u_sun;
out vec4 o;
${cloudFieldGLSL}
void main() {
  vec3 p = cloudPoint(v_world, v_t);
  float threshold = mix(0.78, 0.22, u_cover);
  float density = cloudDensity(v_world, v_t);
  if (density < 0.005) discard;
  // A sample toward the sun gives the volume a directional, self-shaded edge.
  float occlusion = smoothstep(threshold, threshold + 0.25, field(p + u_sun * 0.35));
  float light = clamp(0.3 + v_t * 0.6 + (1.0 - occlusion) * 0.35, 0.0, 1.0);
  vec3 tint = mix(u_shade, u_lit, light);
  float silver = pow(1.0 - density, 3.0) * max(u_sun.z, 0.0) * 0.12;
  tint += u_lit * silver;
  // Beer-Lambert absorption stays consistent with the 16 world-space slices.
  float alpha = (1.0 - exp(-density * 0.23)) * u_visible;
  o = vec4(tint, alpha);
}`;

/** Rendered to a small georeferenced image, which MapLibre drapes onto its terrain. */
export const cloudShadowFragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec4 u_bounds;
uniform vec2 u_noiseOrigin;
uniform float u_cover, u_time, u_base, u_thickness, u_ground, u_merc, u_strength;
uniform vec3 u_sun;
out vec4 o;
${cloudFieldGLSL}
void main() {
  vec2 ground = mix(u_bounds.xy, u_bounds.zw, v_uv);
  float opticalDepth = 0.0;
  for (int i = 0; i < 8; i++) {
    float slice = (float(i) + 0.5) / 8.0;
    float height = u_base + slice * u_thickness - u_ground;
    vec2 world = ground + u_sun.xy / max(u_sun.z, 0.04) * height * u_merc;
    opticalDepth += cloudDensity(world, slice) * 0.46;
  }
  o = vec4(0.035, 0.065, 0.105, (1.0 - exp(-opticalDepth)) * u_strength);
}`;

export const mistFragmentShader = `#version 300 es
precision highp float;
in vec2 v_world;
in float v_t;
uniform vec2 u_noiseOrigin;
uniform float u_time, u_cover, u_density;
uniform vec3 u_tint;
out vec4 o;
${cloudFieldGLSL}
void main() {
  float phase = u_time * 6.28318530718 / 86400.0;
  vec2 drift = vec2(sin(phase) * 30.0, cos(phase) * 25.0);
  float n = field(vec3((v_world - u_noiseOrigin) * 22000.0 + drift, 0.5));
  float alpha = u_density * (1.0 - smoothstep(0.25, 1.0, v_t)) * smoothstep(0.28, 0.70, n) * 0.12;
  if (alpha < 0.002) discard;
  o = vec4(u_tint, alpha);
}`;

/** Far-plane sky overlay: depth testing keeps stars and moon behind terrain. */
export const nightSkyFragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform float u_pitch, u_bearing, u_aspect, u_night, u_cover, u_epoch, u_latitude;
uniform vec3 u_moon, u_sun;
uniform float u_moonVisible;
out vec4 o;
float starHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main() {
  vec2 screen = v_uv * 2.0 - 1.0;
  vec3 forward = vec3(sin(u_bearing) * sin(u_pitch), cos(u_bearing) * sin(u_pitch), -cos(u_pitch));
  vec3 right = vec3(cos(u_bearing), -sin(u_bearing), 0.0);
  vec3 up = vec3(sin(u_bearing) * cos(u_pitch), cos(u_bearing) * cos(u_pitch), sin(u_pitch));
  vec3 ray = normalize(forward + right * screen.x * u_aspect / 3.0 + up * screen.y / 3.0);
  if (ray.z <= 0.0) discard;
  // Rotate a deterministic illustrative star field about the celestial pole.
  vec3 pole = vec3(0.0, cos(u_latitude), sin(u_latitude));
  float turn = u_epoch * 6.28318530718 / 86164.0905;
  vec3 sky = ray * cos(turn) + cross(pole, ray) * sin(turn) + pole * dot(pole, ray) * (1.0 - cos(turn));
  vec3 cell = floor(sky * 240.0);
  vec3 delta = fract(sky * 240.0) - 0.5;
  float seed = starHash(cell);
  float star = (1.0 - smoothstep(0.05, 0.22, length(delta))) * step(0.975, seed);
  float horizon = smoothstep(0.0, 0.16, ray.z);
  float stars = star * u_night * (1.0 - u_cover) * horizon;
  vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.91, 0.76), seed);
  float radius = 0.012; // Deliberately enlarged for readability on a phone.
  float distance = length(ray - u_moon);
  float moon = (1.0 - smoothstep(radius * 0.92, radius, distance)) * u_moonVisible * horizon;
  vec3 tangent = (ray - u_moon * dot(ray, u_moon)) / radius;
  vec3 normal = tangent - u_moon * sqrt(max(0.0, 1.0 - dot(tangent, tangent)));
  float lit = smoothstep(-0.07, 0.07, dot(normal, u_sun));
  vec3 moonColor = mix(vec3(0.09, 0.12, 0.17), vec3(0.91, 0.91, 0.82), lit);
  o = vec4(mix(tint, moonColor, moon), max(stars, moon * (1.0 - u_cover * 0.8)));
}`;
