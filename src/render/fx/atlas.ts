/**
 * GPU-baked 2×2 puff atlas (smoke / dust / fire source). R = soft puff density,
 * G = turbulent detail used for fire erosion + smoke self-shading. Baked once at start.
 */
import {
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Texture,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'

const FRAG = /* glsl */ `
varying vec2 vUv;
float hash(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.02 + vec2(11.7, 5.3); a *= 0.5; }
  return s;
}
void main(){
  vec2 t = floor(vUv * 2.0);
  vec2 l = fract(vUv * 2.0) * 2.0 - 1.0;
  float seed = t.x + t.y * 2.0 + 1.0;
  vec2 o = vec2(seed * 13.37, seed * 7.77);
  float r = length(l);
  // domain-warped billowy noise
  vec2 w = vec2(fbm(l * 1.6 + o), fbm(l * 1.6 + o + 9.2)) - 0.5;
  float n = fbm(l * 2.1 + w * 1.1 + o);
  float radial = 1.0 - smoothstep(0.0, 0.98, r);
  float puff = smoothstep(0.10, 0.62, radial * (0.55 + 1.15 * n) - 0.05);
  puff *= 1.0 - smoothstep(0.80, 0.99, r);
  float detail = fbm(l * 5.0 + w * 2.0 + o * 1.7);
  gl_FragColor = vec4(puff, detail, 0.0, 1.0);
}
`

export function bakePuffAtlas(renderer: WebGLRenderer): Texture {
  const size = 1024
  const rt = new WebGLRenderTarget(size, size, {
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
  })
  const mat = new ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  })
  const scene = new Scene()
  scene.add(new Mesh(new PlaneGeometry(2, 2), mat))
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const prevTarget = renderer.getRenderTarget()
  renderer.setRenderTarget(rt)
  renderer.render(scene, cam)
  renderer.setRenderTarget(prevTarget)
  mat.dispose()
  rt.texture.anisotropy = 4
  return rt.texture
}
