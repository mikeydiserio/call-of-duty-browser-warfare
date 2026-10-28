/**
 * Cheap depth-only ambient occlusion (contact shadows) — no normal pass, so no second
 * geometry render. View position comes from the depth buffer, the normal from screen-space
 * derivatives, and 12 spiral samples with range falloff estimate occlusion. Runs between the
 * world and viewmodel passes, so the first-person weapon never receives world AO.
 */
import { Matrix4, type PerspectiveCamera, Uniform, Vector2 } from 'three'
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'

const FRAG = /* glsl */ `
uniform mat4 uProjInv;
uniform vec2 uProjScale;
uniform float uRadius;
uniform float uIntensity;
uniform float uFadeFar;

vec3 aoViewPos(const in vec2 uv, const in float d) {
  vec4 v = uProjInv * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (depth >= 0.99999) { outputColor = inputColor; return; }
  vec3 P = aoViewPos(uv, depth);
  float dist = -P.z;
  if (!(dist > 0.0) || !(dist < uFadeFar)) { outputColor = inputColor; return; }
  float fade = 1.0 - smoothstep(uFadeFar * 0.55, uFadeFar, dist);
  if (fade <= 0.0) { outputColor = inputColor; return; }
  vec3 rawN = cross(dFdx(P), dFdy(P));
  float normalLengthSq = dot(rawN, rawN);
  if (!(normalLengthSq > 1e-10) || !(normalLengthSq < 1e10)) { outputColor = inputColor; return; }
  vec3 N = rawN * inversesqrt(normalLengthSq);
  // screen-space radius (uv units, y) of a uRadius sphere at this depth; clamp so close-ups stay cheap
  float rUv = min(uRadius * uProjScale.y * 0.5 / dist, 0.12);
  // 4x4 interleaved rotation keeps the pattern stable; SMAA + grain hide the residual
  vec2 ip = mod(floor(gl_FragCoord.xy), 4.0);
  float ang = (ip.x * 4.0 + ip.y) * (6.2831853 / 16.0) + mod(ip.x + ip.y, 2.0) * 0.4;
  float occ = 0.0;
  float r2 = uRadius * uRadius;
  for (int i = 0; i < 12; i++) {
    float fi = (float(i) + 0.5) / 12.0;
    float a = ang + float(i) * 2.3999632;
    vec2 suv = uv + vec2(cos(a) / aspect, sin(a)) * (fi * fi * 0.85 + 0.15) * rUv;
    vec3 S = aoViewPos(suv, readDepth(suv));
    vec3 v = S - P;
    float d2 = dot(v, v);
    float nv = dot(N, v) * inversesqrt(d2 + 1e-4);
    occ += max(0.0, nv - 0.1) * (1.0 / (1.0 + d2 / r2));
  }
  occ *= (1.0 / 12.0);
  float ao = 1.0 - clamp(occ * uIntensity * fade, 0.0, 0.8);
  outputColor = vec4(inputColor.rgb * ao, inputColor.a);
}
`

export class ContactAOEffect extends Effect {
  constructor(private readonly cam: PerspectiveCamera) {
    super('ContactAO', FRAG, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uProjInv', new Uniform(new Matrix4())],
        ['uProjScale', new Uniform(new Vector2(1, 1))],
        ['uRadius', new Uniform(0.85)],
        ['uIntensity', new Uniform(1.8)],
        ['uFadeFar', new Uniform(60)],
      ]),
    })
  }

  /** Sync projection uniforms with the camera (call once per frame before rendering). */
  sync() {
    const u = this.uniforms
    u.get('uProjInv')!.value.copy(this.cam.projectionMatrixInverse)
    const e = this.cam.projectionMatrix.elements
    u.get('uProjScale')!.value.set(e[0], e[5])
  }
}
