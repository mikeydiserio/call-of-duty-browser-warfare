import type { Scene } from 'three'
import type { CollisionWorld } from './collision'
import type { MapData } from '../core/types'
import { buildRustMap } from './rust/map'
import { buildScrapyardMap } from './scrapyard/map'
import { buildFavelaMap } from './favela/map'

export const MAP_OPTIONS = [
  { id: 'rust', name: 'Rust', location: 'Oil yard, Afghanistan border', description: 'A corroded oil yard baking under the afternoon sun. Rusted pipelines, stacked containers and a steel tower dominate the middle.' },
  { id: 'scrapyard', name: 'Scrapyard', location: 'Aircraft boneyard, western Nevada', description: 'A sun-bleached aircraft boneyard split by a wrecked airliner, open hangars and lanes of stacked salvage.' },
  { id: 'favela', name: 'Favela', location: 'Rio de Janeiro, Brazil', description: 'A dense hillside neighborhood of close alleys, small courtyards and climbable rooftops above the city.' },
] as const

export type MapId = (typeof MAP_OPTIONS)[number]['id']

export function getMapOption(id: string) {
  return MAP_OPTIONS.find((map) => map.id === id) ?? MAP_OPTIONS[0]
}

export function buildMap(id: string, scene: Scene, collision: CollisionWorld): MapData {
  switch (getMapOption(id).id) {
    case 'scrapyard':
      return buildScrapyardMap(scene, collision)
    case 'favela':
      return buildFavelaMap(scene, collision)
    default:
      return buildRustMap(scene, collision)
  }
}
