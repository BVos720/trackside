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

export const cloudFragmentShader = `#version 300 es
precision highp float;
in vec2 v_world;
in float v_t;
uniform float u_cover, u_time, u_visible;
uniform vec2 u_noiseOrigin;
uniform vec3 u_lit, u_shade, u_sun;
out vec4 o;
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
void main() {
  vec2 drift = vec2(u_time * 0.004, u_time * 0.0025);
  vec3 p = vec3((v_world - u_noiseOrigin) * 9000.0 + drift, v_t * 1.8);
  float n = field(p);
  float profile = smoothstep(0.0, 0.16, v_t) * (1.0 - smoothstep(0.52, 1.0, v_t));
  float threshold = mix(0.78, 0.22, u_cover);
  float density = smoothstep(threshold, threshold + 0.16, n) * profile;
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
