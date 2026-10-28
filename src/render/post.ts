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
uniform float uThermal;
uniform float uStatic;
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

  // ---- killstreak thermal camera (Predator / Chopper Gunner / AC-130): white-hot mono --
  if (uThermal > 0.002) {
    float l = dot(g, vec3(0.299, 0.587, 0.114));
    float th = smoothstep(0.04, 0.8, l);
    th = th * th * (3.0 - 2.0 * th);
    vec3 mono = vec3(th) * vec3(0.9, 0.96, 1.0) + vec3(0.02, 0.025, 0.03);
    float scan = 0.96 + 0.04 * sin(uv.y * resolution.y * 1.6);
    g = mix(g, mono * scan, uThermal);
  }

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
    float thr = 1.0 - uDamage * 0.95;
    float m = smoothstep(thr, thr + 0.16, v) * smoothstep(0.2, 0.6, r);
    float thick = smoothstep(thr, thr + 0.5, v);
    // translucent thin smear → dark opaque clots
    vec3 blood = mix(vec3(0.30, 0.02, 0.018), vec3(0.11, 0.004, 0.004), thick);
    g = mix(g, g * vec3(0.42, 0.05, 0.045) + blood * 0.65, m * (0.6 + 0.38 * thick));
  }

  // ---- death: desaturate, darken, red wash ------------------------------------------
  if (uDead > 0.002) {
    float gl = dot(g, vec3(0.3, 0.59, 0.11));
    g = mix(g, vec3(gl) * vec3(1.0, 0.82, 0.80), uDead * 0.9);
    g *= 1.0 - uDead * (0.38 + 0.4 * vig);
    g = mix(g, g * vec3(1.3, 0.42, 0.38), uDead * 0.35);
  }

  // ---- menu darken -----------------------------------------------------------------
  g *= 1.0 - uMenu * 0.46;

  // ---- grain (display space, mid-tone weighted) -------------------------------------
  float n = h21(uv * resolution + fract(uTime * 7.31) * 713.0) - 0.5;
  float n2 = h21(uv * resolution * 0.5 + fract(uTime * 3.7) * 311.0) - 0.5;
  g += (n * 0.7 + n2 * 0.3) * uGrain * (0.8 - abs(luma - 0.45) * 0.7);

  // ---- video static (camera feed switching, EMP) ------------------------------------
  if (uStatic > 0.002) {
    float band = step(0.9, h21(vec2(floor(uv.y * 70.0), floor(uTime * 22.0))));
    float nz = h21(uv * resolution * 0.5 + fract(uTime * 13.0) * 400.0);
    g = mix(g, vec3(nz), clamp(uStatic * (0.55 + band * 0.45), 0.0, 1.0));
  }

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
        ['uThermal', new Uniform(0)],
        ['uStatic', new Uniform(0)],
        ['tBlood', new Uniform(bloodTexture)],
      ]),
    })
  }

  set(name: string, v: number) {
    const u = this.uniforms.get(name)
    if (u) u.value = v
  }
}

/**
 * Greyscale blood "height field": smeared, domain-warped noise concentrated at the screen
 * edges (thick in the corners), plus fine spatter and a few short drips from the top. The
 * shader thresholds it lower as damage grows so the blood creeps in from the edges.
 */
export function createBloodTexture(): CanvasTexture {
  const W = 640
  const H = 360
  let seed = 1337
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  // value-noise lattice
  const G = 64
  const lat = new Float32Array(G * G)
  for (let i = 0; i < lat.length; i++) lat[i] = rnd()
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    let fx = x - xi
    let fy = y - yi
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    const a = lat[(((yi % G) + G) % G) * G + (((xi % G) + G) % G)]!
    const b = lat[(((yi % G) + G) % G) * G + ((((xi + 1) % G) + G) % G)]!
    const c = lat[((((yi + 1) % G) + G) % G) * G + (((xi % G) + G) % G)]!
    const d = lat[((((yi + 1) % G) + G) % G) * G + ((((xi + 1) % G) + G) % G)]!
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
  }
  const fbm = (x: number, y: number) => {
    let s = 0
    let amp = 0.5
    for (let o = 0; o < 5; o++) {
      s += amp * noise(x, y)
      x = x * 2.03 + 7.1
      y = y * 2.03 + 3.7
      amp *= 0.5
    }
    return s
  }
  const field = new Float32Array(W * H)
  const aspect = W / H
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W - 0.5
      const v = y / H - 0.5
      // elliptical edge distance: 0 centre → ~1 at the frame edge, >1 in corners
      const r = Math.sqrt(u * u * 4 * (aspect > 1 ? 1 : aspect) + v * v * 4)
      const px = (x / H) * 3.2
      const py = (y / H) * 3.2
      const wx = fbm(px + 11.3, py + 2.1) - 0.5
      const wy = fbm(px + 4.7, py + 19.2) - 0.5
      const n = fbm(px + wx * 2.2, py + wy * 2.2)
      const edge = Math.min(1, Math.max(0, (r - 0.42) / 0.7))
      field[y * W + x] = Math.min(1, Math.max(0, edge * 0.95 + (n - 0.5) * 1.15 - 0.08))
    }
  }
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(W, H)
  for (let i = 0; i < W * H; i++) {
    const c = Math.round(field[i]! * 255)
    img.data[i * 4] = c
    img.data[i * 4 + 1] = c
    img.data[i * 4 + 2] = c
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  // fine spatter in the edge band + short drips from the top edge
  ctx.globalCompositeOperation = 'lighten'
  for (let i = 0; i < 140; i++) {
    const a = rnd() * Math.PI * 2
    const d = 0.74 + rnd() * 0.45
    const x = W / 2 + Math.cos(a) * d * W * 0.5
    const y = H / 2 + Math.sin(a) * d * H * 0.5
    const c = Math.round((0.55 + rnd() * 0.4) * 255)
    ctx.fillStyle = `rgb(${c},${c},${c})`
    ctx.beginPath()
    ctx.arc(x, y, 0.6 + rnd() * rnd() * 3.2, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 0; i < 14; i++) {
    const x = rnd() * W
    const top = rnd() * H * 0.08
    const len = H * (0.05 + rnd() * 0.12)
    const c = Math.round((0.6 + rnd() * 0.3) * 255)
    const g = ctx.createLinearGradient(0, top, 0, top + len)
    g.addColorStop(0, `rgb(${c},${c},${c})`)
    g.addColorStop(1, 'rgb(0,0,0)')
    ctx.strokeStyle = g
    ctx.lineWidth = 1 + rnd() * 2.5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x + (rnd() - 0.5) * 3, top + len)
    ctx.stroke()
  }
  const tex = new CanvasTexture(cv)
  tex.colorSpace = NoColorSpace
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.generateMipmaps = false
  return tex
}
