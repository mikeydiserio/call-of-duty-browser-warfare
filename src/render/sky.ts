/**
 * Procedural MW2 "Rust" sky: pale grey-blue zenith, warm peach horizon, thick tan
 * haze band, big soft sun glow + bright disc, faint high cirrus. Also owns the global
 * fog-chunk patch (fog gets a sun in-scatter tint so haze and sky share one colour at
 * the horizon).
 */
import { BackSide, Color, Mesh, ShaderChunk, ShaderMaterial, SphereGeometry, Vector3 } from 'three'

/** Strength of the warm in-scatter added to fog / horizon towards the sun. */
const FOG_SUN_STRENGTH = 0.42

const GLSL_NOISE = /* glsl */ `
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm4(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
`

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.9999, p.w);
}
`

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir;      // towards the sun
uniform vec3 uSunCol;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;        // == fog colour
uniform vec3 uGround;
uniform float uTime;
uniform float uSunBright;
uniform float uBake;       // 1 when rendering the PMREM source
uniform float uFogSun;
${GLSL_NOISE}
void main(){
  vec3 d = normalize(vDir);
  float e = d.y;
  float cs = clamp(dot(d, uSunDir), -1.0, 1.0);
  float up = clamp(e, 0.0, 1.0);

  // Base gradient: dusty pale blue-grey up high, warm peach lower.
  float g = pow(smoothstep(0.0, 0.85, up), 0.62);
  vec3 sky = mix(uHorizon, uZenith * vec3(0.90, 1.0, 1.14), g);
  // Slightly darker/cooler directly overhead away from the sun.
  sky *= 1.0 - 0.18 * smoothstep(0.35, 1.0, up) * (1.0 - max(cs, 0.0));

  // Broad warm forward-scatter around the sun + tight glow.
  float cp = max(cs, 0.0);
  vec3 warm = uSunCol * vec3(1.0, 0.70, 0.42);
  sky += warm * pow(cp, 2.5) * 0.36 * (1.0 - 0.55 * up);
  sky += uSunCol * (pow(cp, 18.0) * 0.55 + pow(cp, 140.0) * 1.9 + pow(cp, 900.0) * 5.0);

  // Thick tan haze band at the horizon, same colour as the fog so terrain melts in.
  vec3 haze = uHaze + uSunCol * uFogSun * pow(cp, 5.0);
  float hz = exp(-max(e, 0.0) * 5.5);
  float hazeMix = mix(clamp(hz * 0.92, 0.0, 1.0), 1.0, smoothstep(0.05, 0.0, e));
  sky = mix(sky, haze, hazeMix);

  // High cirrus wisps (very faint), drifting slowly.
  if (e > 0.015) {
    vec2 p = d.xz / (e + 0.16);
    p = vec2(p.x * 0.55 + uTime * 0.004, p.y * 1.35 - uTime * 0.002);
    float w = fbm4(p * vec2(1.1, 2.6) + vec2(3.7, 1.3));
    float w2 = fbm4(p * vec2(2.4, 5.0) - vec2(1.7, 8.1));
    float c = smoothstep(0.50, 0.86, w * 0.75 + w2 * 0.35);
    c *= smoothstep(0.015, 0.30, e) * (1.0 - 0.6 * smoothstep(0.65, 1.0, e));
    vec3 cloud = mix(sky * 1.12 + 0.015, warm * 1.15, pow(cp, 1.7) * 0.8);
    sky = mix(sky, cloud, c * 0.42);
  }

  // Sun disc (HDR so bloom picks it up).
  float disc = smoothstep(0.99972, 0.99991, cs);
  float discAtten = 1.0 - 0.35 * hazeMix;
  sky += uSunCol * disc * uSunBright * discAtten * (e > -0.02 ? 1.0 : 0.0);

  // Below the horizon: haze, easing to ground colour (strongly when baking the env map).
  if (e < 0.0) {
    float t = smoothstep(0.0, mix(-0.45, -0.07, uBake), e);
    sky = mix(sky, mix(haze, uGround, uBake), mix(t * 0.6, t, uBake));
  }

  // Tiny dither against banding in the smooth gradient.
  sky += (hash12(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0);
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`

export interface SkyUniforms {
  sunDir: Vector3
  sunCol: Color
  zenith: Color
  horizon: Color
  haze: Color
  ground: Color
  sunBright: number
}

export function createSkyMaterial(bake: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSunCol: { value: new Color(1, 1, 1) },
      uZenith: { value: new Color() },
      uHorizon: { value: new Color() },
      uHaze: { value: new Color() },
      uGround: { value: new Color() },
      uTime: { value: 0 },
      uSunBright: { value: 30 },
      uBake: { value: bake ? 1 : 0 },
      uFogSun: { value: FOG_SUN_STRENGTH },
    },
  })
}

export function applySkyUniforms(mat: ShaderMaterial, s: SkyUniforms, bake: boolean) {
  const u = mat.uniforms
  u.uSunDir!.value.copy(s.sunDir)
  u.uSunCol!.value.copy(s.sunCol)
  u.uZenith!.value.copy(s.zenith)
  u.uHorizon!.value.copy(s.horizon)
  u.uHaze!.value.copy(s.haze)
  u.uGround!.value.copy(s.ground)
  // The env-map bake gets a calmer disc: the analytic sun light already makes the specular highlight.
  u.uSunBright!.value = bake ? 6 : s.sunBright
}

export function createSkyMesh(material: ShaderMaterial, radius: number): Mesh {
  const mesh = new Mesh(new SphereGeometry(radius, 48, 32), material)
  mesh.frustumCulled = false
  mesh.renderOrder = -1000
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/**
 * Patch three's fog chunks (global, takes effect for programs compiled afterwards) so every
 * fogged material gets a warm sun in-scatter tint — same formula as the sky horizon.
 */
export function installFogChunks(sunToward: Vector3, sunColLinear: Color) {
  const dir = `vec3(${sunToward.x.toFixed(5)}, ${sunToward.y.toFixed(5)}, ${sunToward.z.toFixed(5)})`
  const col = `vec3(${(sunColLinear.r * FOG_SUN_STRENGTH).toFixed(4)}, ${(sunColLinear.g * FOG_SUN_STRENGTH).toFixed(4)}, ${(sunColLinear.b * FOG_SUN_STRENGTH).toFixed(4)})`
  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogView;
#endif
`
  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogView = mvPosition.xyz;
#endif
`
  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogView;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`
  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	vec3 fogWorldDir = normalize( ( vec4( vFogView, 0.0 ) * viewMatrix ).xyz );
	float fogSunAmt = pow( max( dot( fogWorldDir, ${dir} ), 0.0 ), 5.0 );
	vec3 fogTint = fogColor + ${col} * fogSunAmt;
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
#endif
`
}
