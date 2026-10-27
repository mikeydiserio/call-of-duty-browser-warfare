// STUB — owned by the map agent. Keep the signature; replace everything else.
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Scene, Vector3 } from 'three'
import type { MapData } from '../../core/types'
import type { CollisionWorld } from '../collision'

export function buildRustMap(scene: Scene, collision: CollisionWorld): MapData {
  const root = new Group()
  const ground = new Mesh(new BoxGeometry(80, 1, 80), new MeshStandardMaterial({ color: 0xb59a6e }))
  ground.position.y = -0.5
  root.add(ground)
  const tower = new Mesh(new BoxGeometry(4, 8, 4), new MeshStandardMaterial({ color: 0x7a4a2a }))
  tower.position.set(0, 4, 0)
  root.add(tower)
  scene.add(root)
  collision.addMesh(root, 'sand')
  collision.build()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  return {
    id: 'rust',
    displayName: 'Rust',
    location: 'Oil yard, Afghanistan border',
    root,
    bounds: { minX: -38, maxX: 38, minZ: -38, maxZ: 38 },
    spawns: [
      { team: 'tf141', position: new Vector3(-20, 0, 20), yaw: Math.PI * 0.75 },
      { team: 'opfor', position: new Vector3(20, 0, -20), yaw: -Math.PI * 0.25 },
      { team: 'any', position: new Vector3(20, 0, 20), yaw: 0 },
    ],
    ladders: [],
    nav: [],
    callouts: [],
    environment: {
      sunDirection: new Vector3(-0.5, -0.6, 0.3).normalize(),
      sunColor: 0xffd7a0, sunIntensity: 3, skyZenith: 0x8fa0ad, skyHorizon: 0xd9b98a,
      groundColor: 0x6b5236, fogColor: 0xc9a979, fogDensity: 0.012, exposure: 1, haze: 0.5,
    },
    minimap: canvas,
    menuCameraPath: [
      { position: new Vector3(25, 10, 25), target: new Vector3(0, 3, 0) },
      { position: new Vector3(-25, 12, 20), target: new Vector3(0, 3, 0) },
    ],
  }
}
