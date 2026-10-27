/**
 * MW2-look final grade as a single post effect: blur (menu / dead / ADS periphery),
 * chromatic aberration, exposure, ACES filmic tone-map, lift/gamma/gain + split-toning,
 * contrast / saturation, vignette, film grain, and the gameplay overlays (blood
 * splatter + low-health pulse, flashbang white-out, death desaturation).
 */
import { CanvasTexture, LinearFilter, NoColorSpace, Uniform } from 'three'
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing'

const FRAG = /* glsl */ `
uniform float uExposure;
uniform float uTime;
uniform float uDamage;
uniform float uFlash;
uniform float uDead;
uniform float uAds;
uniform float uMenu;
uniform float uGrain;
uniform float uCA;
uniform float uVignette;
uniform float uHaze;
uniform float uBlurMax;
uniform sampler2D tBlood;

float h21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 RRTAndODTFit(vec3 v){
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilmic(vec3 color){
  const mat3 ACESInputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602));
  color *= 1.0 / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
  vec2 c = uv - 0.5;
  vec2 ca = c * vec2(aspect, 1.0);
  float r = length(ca) / (0.5 * length(vec2(aspect, 1.0))); // 0 centre .. 1 corner
  float r2 = r * r;

  // ---- blur radius in pixels (menu backdrop, death, ADS periphery) -----------------
  float blurPx = uMenu * 7.0 * uBlurMax + uDead * 3.2 * uBlurMax + uAds * smoothstep(0.30, 1.0, r) * 2.6 * uBlurMax;

  vec3 col;
  if (blurPx > 0.15) {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 16; i++) {
      float fi = float(i);
      float rr = sqrt((fi + 0.5) / 16.0);
      float a = fi * 2.39996323;
      vec2 o = vec2(cos(a), sin(a)) * rr * blurPx * texelSize;
      acc += texture2D(inputBuffer, uv + o).rgb;
      wsum += 1.0;
    }
    col = acc / wsum;
  } else {
    // very subtle radial chromatic aberration, edges only
    vec2 k = c * (uCA * 0.0042 * r2);
    col.r = texture2D(inputBuffer, uv - k).r;
    col.g = inputColor.g;
    col.b = texture2D(inputBuffer, uv + k).b;
  }

  // ---- exposure + ACES -------------------------------------------------------------
  col *= uExposure;
  // dusty atmospheric veil lifts the blacks a touch (haze)
  col += uHaze * vec3(0.012, 0.0095, 0.0075);
  col = acesFilmic(col);

  // ---- grade in display space ------------------------------------------------------
  vec3 g = pow(col, vec3(1.0 / 2.2));
  float luma = dot(g, vec3(0.299, 0.587, 0.114));

  // contrast S-curve around mid grey
  vec3 s = g * g * (3.0 - 2.0 * g);
  g = mix(g, s, 0.42);
  g = (g - 0.5) * 1.06 + 0.5;

  // saturation slightly down (gritty)
  luma = dot(g, vec3(0.299, 0.587, 0.114));
  g = mix(vec3(luma), g, 0.86);

  // split-tone: cool teal shadows, warm highlights
  float sh = 1.0 - smoothstep(0.0, 0.5, luma);
  float hi = smoothstep(0.45, 0.95, luma);
  g += vec3(-0.012, 0.010, 0.020) * sh;
  g *= mix(vec3(1.0), vec3(1.07, 1.0, 0.89), hi);

  // lift / gamma / gain
  g = max(g, 0.0);
  g = pow(g, vec3(1.0 / 1.04));
  g = g * vec3(1.02, 1.0, 0.975) + vec3(0.004, 0.006, 0.010) * (1.0 - g);

  // ---- vignette --------------------------------------------------------------------
  float vig = smoothstep(0.30, 1.18, r);
  g *= 1.0 - vig * (uVignette + uAds * 0.30);

  // ---- damage: pulsing red edges + procedural blood splatter -----------------------
  if (uDamage > 0.002) {
    float pulse = 0.5 + 0.5 * sin(uTime * (2.4 + uDamage * 5.5));
    float edge = smoothstep(0.22, 1.05, r);
    float red = edge * (0.22 + 0.55 * pulse) * uDamage;
    float gl = dot(g, vec3(0.3, 0.59, 0.11));
    g = mix(g, vec3(gl), uDamage * 0.35);
    g = g * (1.0 - red * 0.55) + vec3(0.34, 0.0, 0.0) * red;

    float v = texture2D(tBlood, uv).r;
    float thr = 1.0 - uDamage * 1.08;
    float m = smoothstep(thr, thr + 0.07, v) * smoothstep(0.12, 0.55, r);
    float shade = 0.55 + 0.45 * smoothstep(thr, thr + 0.45, v);
    vec3 blood = vec3(0.30, 0.012, 0.010) * shade;
    // wet highlight on the thick parts
    blood += vec3(0.22, 0.05, 0.04) * smoothstep(0.80, 1.0, v) * m;
    g = mix(g, blood, m * 0.88);
  }

  // ---- death: desaturate, darken, red wash ------------------------------------------
  if (uDead > 0.002) {
    float gl = dot(g, vec3(0.3, 0.59, 0.11));
    g = mix(g, vec3(gl) * vec3(1.0, 0.82, 0.80), uDead * 0.9);
    g *= 1.0 - uDead * (0.38 + 0.4 * vig);
    g = mix(g, g * vec3(1.35, 0.30, 0.26), uDead * 0.55);
  }

  // ---- menu darken -----------------------------------------------------------------
  g *= 1.0 - uMenu * 0.46;

  // ---- grain (display space, mid-tone weighted) -------------------------------------
  float n = h21(uv * resolution + fract(uTime * 7.31) * 713.0) - 0.5;
  float n2 = h21(uv * resolution * 0.5 + fract(uTime * 3.7) * 311.0) - 0.5;
  g += (n * 0.7 + n2 * 0.3) * uGrain * (0.8 - abs(luma - 0.45) * 0.7);

  // ---- flashbang / explosion white-out ----------------------------------------------
  if (uFlash > 0.002) {
    float f = smoothstep(0.0, 1.0, uFlash);
    g = mix(g, vec3(1.0, 0.985, 0.95), f);
  }

  col = pow(max(g, 0.0), vec3(2.2));
  outputColor = vec4(col, 1.0);
}
`

export class ScreenFXEffect extends Effect {
  constructor(bloodTexture: CanvasTexture) {
    super('MW2ScreenFX', FRAG, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['uExposure', new Uniform(1)],
        ['uTime', new Uniform(0)],
        ['uDamage', new Uniform(0)],
        ['uFlash', new Uniform(0)],
        ['uDead', new Uniform(0)],
        ['uAds', new Uniform(0)],
        ['uMenu', new Uniform(0)],
        ['uGrain', new Uniform(0.045)],
        ['uCA', new Uniform(1)],
        ['uVignette', new Uniform(0.52)],
        ['uHaze', new Uniform(0.5)],
        ['uBlurMax', new Uniform(1)],
        ['tBlood', new Uniform(bloodTexture)],
      ]),
    })
  }

  set(name: string, v: number) {
    const u = this.uniforms.get(name)
    if (u) u.value = v
  }
}

/** Greyscale "height field" of blood blobs/drips — thresholded in the shader as damage grows. */
export function createBloodTexture(): CanvasTexture {
  const W = 1280
  const H = 720
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighten'
  let seed = 1337
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const blob = (x: number, y: number, rad: number, v: number) => {
    const grd = ctx.createRadialGradient(x, y, 0, x, y, rad)
    const a = Math.round(v * 255)
    grd.addColorStop(0, `rgb(${a},${a},${a})`)
    grd.addColorStop(0.18, `rgb(${Math.round(a * 0.93)},${Math.round(a * 0.93)},${Math.round(a * 0.93)})`)
    grd.addColorStop(1, 'rgb(0,0,0)')
    ctx.fillStyle = grd
    ctx.beginPath()
    ctx.arc(x, y, rad, 0, Math.PI * 2)
    ctx.fill()
  }
  const splats = 34
  for (let i = 0; i < splats; i++) {
    const ang = rnd() * Math.PI * 2
    const rx = 0.36 + rnd() * 0.2
    const ry = 0.34 + rnd() * 0.18
    const cx = W * (0.5 + Math.cos(ang) * rx)
    const cy = H * (0.5 + Math.sin(ang) * ry)
    const base = 0.55 + rnd() * 0.45
    const R = 26 + rnd() * 88
    // irregular main body: several offset circles
    const parts = 4 + Math.floor(rnd() * 5)
    for (let p = 0; p < parts; p++) {
      const a = rnd() * Math.PI * 2
      const d = rnd() * R * 0.55
      blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * (0.35 + rnd() * 0.55), base * (0.85 + rnd() * 0.15))
    }
    // spatter droplets thrown outward
    const drops = 5 + Math.floor(rnd() * 9)
    for (let p = 0; p < drops; p++) {
      const a = rnd() * Math.PI * 2
      const d = R * (0.9 + rnd() * 2.2)
      blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 3 + rnd() * 10, base * (0.7 + rnd() * 0.3))
    }
    // drips running down
    if (rnd() < 0.7) {
      const len = 50 + rnd() * 190
      const w = 3 + rnd() * 8
      const x = cx + (rnd() - 0.5) * R * 0.8
      const grd = ctx.createLinearGradient(0, cy, 0, cy + len)
      const a = Math.round(base * 0.95 * 255)
      grd.addColorStop(0, `rgb(${a},${a},${a})`)
      grd.addColorStop(1, `rgb(${Math.round(a * 0.45)},${Math.round(a * 0.45)},${Math.round(a * 0.45)})`)
      ctx.strokeStyle = grd
      ctx.lineWidth = w
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x, cy)
      ctx.lineTo(x + (rnd() - 0.5) * 8, cy + len)
      ctx.stroke()
      blob(x, cy + len, w * 1.1, base * 0.6)
    }
  }
  const tex = new CanvasTexture(cv)
  tex.colorSpace = NoColorSpace
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.generateMipmaps = false
  return tex
}
