import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Line3,
  Matrix4,
  Mesh,
  type Object3D,
  Ray,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MeshBVH, type ExtendedTriangle } from 'three-mesh-bvh'
import type { Surface, WorldHit } from '../core/types'

const SURFACES: Surface[] = ['sand', 'dirt', 'concrete', 'metal', 'wood', 'glass', 'flesh', 'water']

export interface CapsuleResult {
  /** True if something below pushed the capsule up (standing on walkable ground). */
  onGround: boolean
  /** Normal of the steepest-supporting contact below (valid when onGround). */
  groundNormal: Vector3
  /** Total correction applied to the segment. */
  push: Vector3
  /** Any contact at all. */
  collided: boolean
}

const _box = new Box3()
const _triPoint = new Vector3()
const _capPoint = new Vector3()
const _dir = new Vector3()
const _ray = new Ray()
const _seg = new Line3()
const _start = new Vector3()
const _hit: WorldHit = { point: new Vector3(), normal: new Vector3(), distance: 0, surface: 'concrete' }

/**
 * Static level collision. Map builders register meshes / boxes with a surface
 * type, then call build() once. All queries are in world space.
 */
export class CollisionWorld {
  private pending: BufferGeometry[] = []
  bvh: MeshBVH | null = null
  geometry: BufferGeometry | null = null
  private surfaceAttr: BufferAttribute | null = null
  /** Debug mesh of the merged collision (hidden by default). */
  debugMesh: Mesh | null = null

  /** Register a mesh (and optionally its children) as collision with a surface type. */
  addMesh(object: Object3D, surface: Surface, recursive = true) {
    object.updateWorldMatrix(true, recursive)
    const visit = (o: Object3D) => {
      const m = o as Mesh
      if (m.isMesh && m.geometry) this.addGeometry(m.geometry, m.matrixWorld, surface)
      if (recursive) for (const c of o.children) visit(c)
    }
    visit(object)
  }

  /** Register raw geometry transformed by matrix. */
  addGeometry(geometry: BufferGeometry, matrix: Matrix4, surface: Surface) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    const pos = g.getAttribute('position')
    const clean = new BufferGeometry()
    clean.setAttribute('position', pos.clone())
    clean.applyMatrix4(matrix)
    const n = clean.getAttribute('position').count
    const s = new Uint8Array(n).fill(SURFACES.indexOf(surface))
    clean.setAttribute('surface', new BufferAttribute(s, 1))
    this.pending.push(clean)
    g.dispose()
    g = clean
  }

  /** Invisible axis-aligned box collider. */
  addBox(center: Vector3, size: Vector3, surface: Surface, rotationY = 0) {
    const g = new BoxGeometry(size.x, size.y, size.z)
    const m = new Matrix4().makeRotationY(rotationY).setPosition(center)
    this.addGeometry(g, m, surface)
    g.dispose()
  }

  /** Drop the current static level before another map is built. */
  clear() {
    for (const g of this.pending) g.dispose()
    this.pending = []
    this.geometry?.dispose()
    this.geometry = null
    this.bvh = null
    this.surfaceAttr = null
    this.debugMesh = null
  }

  build() {
    if (this.pending.length === 0) throw new Error('CollisionWorld.build(): no geometry registered')
    const merged = mergeGeometries(this.pending, false)
    if (!merged) throw new Error('CollisionWorld.build(): merge failed')
    for (const g of this.pending) g.dispose()
    this.pending = []
    this.geometry = merged
    this.surfaceAttr = merged.getAttribute('surface') as BufferAttribute
    this.bvh = new MeshBVH(merged, { targetLeafSize: 8 })
    this.debugMesh = new Mesh(merged)
    this.debugMesh.visible = false
  }

  /** Nearest hit along a ray, or null. dir must be normalised. Allocates the result; use raycastInto in hot paths. */
  raycast(origin: Vector3, dir: Vector3, maxDistance: number): WorldHit | null {
    const out: WorldHit = { point: new Vector3(), normal: new Vector3(), distance: 0, surface: 'concrete' }
    return this.raycastInto(origin, dir, maxDistance, out) ? out : null
  }

  /** Allocation-free raycast: writes the nearest hit into `out` and returns true, or returns false. */
  raycastInto(origin: Vector3, dir: Vector3, maxDistance: number, out: WorldHit): boolean {
    if (!this.bvh) return false
    _ray.origin.copy(origin)
    _ray.direction.copy(dir)
    const hit = this.bvh.raycastFirst(_ray, DoubleSide, 0, maxDistance)
    if (!hit || hit.distance > maxDistance) return false
    if (hit.face) out.normal.copy(hit.face.normal)
    else out.normal.set(0, 1, 0)
    // Face normals are in geometry space == world space here. Make them face the ray.
    if (out.normal.dot(dir) > 0) out.normal.negate()
    const vi = hit.face ? hit.face.a : 0
    out.surface = SURFACES[this.surfaceAttr ? this.surfaceAttr.getX(vi) : 0] ?? 'concrete'
    out.point.copy(hit.point)
    out.distance = hit.distance
    return true
  }

  /** True if the segment a→b is unobstructed. */
  lineOfSight(a: Vector3, b: Vector3): boolean {
    _dir.subVectors(b, a)
    const len = _dir.length()
    if (len < 1e-4) return true
    _dir.divideScalar(len)
    return !this.raycastInto(a, _dir, len - 0.02, _hit)
  }

  /** Height of the first surface below (x, fromY, z), or -Infinity. */
  groundHeight(x: number, z: number, fromY = 50, maxDrop = 100): number {
    _start.set(x, fromY, z)
    return this.raycastInto(_start, _dir.set(0, -1, 0), maxDrop, _hit) ? _hit.point.y : -Infinity
  }

  surfaceBelow(x: number, y: number, z: number): Surface {
    _start.set(x, y + 0.1, z)
    return this.raycastInto(_start, _dir.set(0, -1, 0), 0.6, _hit) ? _hit.surface : 'sand'
  }

  /**
   * Push a capsule (segment start=bottom sphere centre, end=top sphere centre)
   * out of the level. Mutates start/end in place. Iterates a few times for
   * stability in corners.
   */
  resolveCapsule(start: Vector3, end: Vector3, radius: number, out?: CapsuleResult): CapsuleResult {
    const res: CapsuleResult = out ?? { onGround: false, groundNormal: new Vector3(0, 1, 0), push: new Vector3(), collided: false }
    res.onGround = false
    res.collided = false
    res.push.set(0, 0, 0)
    res.groundNormal.set(0, 1, 0)
    if (!this.bvh) return res
    let bestUp = 0.0
    for (let iter = 0; iter < 3; iter++) {
      _seg.start.copy(start)
      _seg.end.copy(end)
      _box.makeEmpty()
      _box.expandByPoint(_seg.start)
      _box.expandByPoint(_seg.end)
      _box.min.addScalar(-radius)
      _box.max.addScalar(radius)
      let any = false
      this.bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(_box),
        intersectsTriangle: (tri: ExtendedTriangle) => {
          const d = tri.closestPointToSegment(_seg, _triPoint, _capPoint)
          if (d < radius) {
            const depth = radius - d
            _dir.subVectors(_capPoint, _triPoint)
            if (_dir.lengthSq() < 1e-10) tri.getNormal(_dir)
            else _dir.normalize()
            _seg.start.addScaledVector(_dir, depth)
            _seg.end.addScaledVector(_dir, depth)
            any = true
            if (_dir.y > 0.55 && _dir.y > bestUp) {
              bestUp = _dir.y
              res.groundNormal.copy(_dir)
            }
          }
          return false
        },
      })
      if (!any) break
      res.collided = true
      res.push.add(_dir.subVectors(_seg.start, start))
      start.copy(_seg.start)
      end.copy(_seg.end)
    }
    res.onGround = bestUp > 0.55
    return res
  }
}
