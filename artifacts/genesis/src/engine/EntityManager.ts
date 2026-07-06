import * as THREE from 'three'
import type { EntityData } from '../store/saveManager'
import { getTerrainHeightCached, createFloraMesh } from './TerrainSystem'
import type { StructurePart } from './TerrainSystem'

interface LiveEntity {
  data: EntityData
  mesh: THREE.Object3D
  targetPosition: THREE.Vector3
  moveTimer: number
  behaviorTimer: number
  originalSize: number
  hasParts: boolean
}

export class EntityManager {
  private scene: THREE.Scene
  private entities: Map<string, LiveEntity> = new Map()
  private seed: number

  constructor(scene: THREE.Scene, seed: number) {
    this.scene = scene
    this.seed = seed
  }

  spawnEntity(data: EntityData): void {
    if (this.entities.has(data.id)) return

    const size = data.size || 1
    const hasParts = Array.isArray(data.parts) && data.parts.length > 0

    let mesh: THREE.Object3D

    if (hasParts) {
      mesh = createFloraMesh('custom', data.parts as StructurePart[], size, data.color)
    } else {
      const color = new THREE.Color(data.color || '#44ff88')
      const geometry = this.getGeometryForType(data.type, size)
      const material = new THREE.MeshLambertMaterial({ color })
      const m = new THREE.Mesh(geometry, material)
      m.castShadow = true
      mesh = m
    }

    const groundY = getTerrainHeightCached(data.position[0], data.position[2], this.seed)
    mesh.position.set(data.position[0], groundY + (hasParts ? 0 : size * 0.5), data.position[2])

    this.scene.add(mesh)
    this.entities.set(data.id, {
      data,
      mesh,
      targetPosition: mesh.position.clone(),
      moveTimer: Math.random() * 3,
      behaviorTimer: Math.random() * 10,
      originalSize: size,
      hasParts,
    })
  }

  removeEntity(id: string): void {
    const entity = this.entities.get(id)
    if (!entity) return
    this.scene.remove(entity.mesh)
    if (entity.hasParts) {
      entity.mesh.traverse(child => {
        if (child instanceof THREE.Mesh) child.geometry.dispose()
      })
    } else {
      const m = entity.mesh as THREE.Mesh
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
    this.entities.delete(id)
  }

  updateEntity(id: string, updates: Partial<EntityData>): void {
    const entity = this.entities.get(id)
    if (!entity) return
    if (!entity.hasParts) {
      if (updates.color) {
        ;(entity.mesh as THREE.Mesh).material &&
          ((entity.mesh as THREE.Mesh).material as THREE.MeshLambertMaterial).color.set(updates.color)
      }
    }
    if (updates.size) {
      entity.mesh.scale.setScalar(updates.size / entity.originalSize)
    }
    entity.data = { ...entity.data, ...updates }
  }

  update(delta: number, playerPosition: THREE.Vector3): void {
    this.entities.forEach((entity) => {
      entity.moveTimer -= delta
      entity.behaviorTimer -= delta

      if (entity.moveTimer <= 0) {
        entity.moveTimer = 3 + Math.random() * 5
        this.updateTarget(entity, playerPosition)
      }

      const direction = entity.targetPosition.clone().sub(entity.mesh.position)
      const dist = direction.length()
      if (dist > 0.2) {
        direction.normalize()
        const speed = this.getSpeed(entity.data.behavior)
        entity.mesh.position.addScaledVector(direction, speed * delta)
        entity.mesh.lookAt(entity.targetPosition)
        const groundY = getTerrainHeightCached(entity.mesh.position.x, entity.mesh.position.z, this.seed)
        entity.mesh.position.y = groundY + (entity.hasParts ? 0 : (entity.data.size || 1) * 0.5)
      }

      if (entity.behaviorTimer <= 0) {
        entity.behaviorTimer = 5 + Math.random() * 10
        this.applyBehavior(entity, playerPosition)
      }
    })
  }

  private updateTarget(entity: LiveEntity, playerPosition: THREE.Vector3): void {
    const behavior = entity.data.behavior?.toLowerCase() || ''
    const pos = entity.mesh.position

    if (behavior.includes('игрок') || behavior.includes('player') || behavior.includes('охот')) {
      const dir = playerPosition.clone().sub(pos).normalize()
      entity.targetPosition = pos.clone().addScaledVector(dir, 15 + Math.random() * 5)
    } else if (behavior.includes('убег') || behavior.includes('боит') || behavior.includes('flee')) {
      const dir = pos.clone().sub(playerPosition).normalize()
      entity.targetPosition = pos.clone().addScaledVector(dir, 20 + Math.random() * 10)
    } else {
      const angle = Math.random() * Math.PI * 2
      const dist = 5 + Math.random() * 20
      entity.targetPosition = new THREE.Vector3(
        pos.x + Math.cos(angle) * dist,
        0,
        pos.z + Math.sin(angle) * dist
      )
    }

    entity.targetPosition.x = Math.max(-200, Math.min(200, entity.targetPosition.x))
    entity.targetPosition.z = Math.max(-200, Math.min(200, entity.targetPosition.z))
  }

  private applyBehavior(entity: LiveEntity, _playerPosition: THREE.Vector3): void {
    entity.mesh.rotation.y += (Math.random() - 0.5) * 0.5
  }

  private getSpeed(behavior: string): number {
    const b = behavior?.toLowerCase() || ''
    if (b.includes('быстр') || b.includes('стремит') || b.includes('sprint')) return 6
    if (b.includes('медлен') || b.includes('ползет') || b.includes('slow')) return 1
    return 3
  }

  private getGeometryForType(type: string, size: number): THREE.BufferGeometry {
    const t = type?.toLowerCase() || ''
    if (t.includes('птиц') || t.includes('bird') || t.includes('летит')) {
      return new THREE.ConeGeometry(size * 0.3, size, 4)
    }
    if (t.includes('дерев') || t.includes('tree') || t.includes('раст')) {
      return new THREE.CylinderGeometry(size * 0.1, size * 0.3, size * 2, 6)
    }
    if (t.includes('рыб') || t.includes('fish') || t.includes('вод')) {
      return new THREE.SphereGeometry(size * 0.4, 6, 4)
    }
    return new THREE.BoxGeometry(size, size, size)
  }

  spawnFromSavedData(entities: EntityData[]): void {
    entities.forEach((e) => this.spawnEntity(e))
  }

  getAllPositions(): Map<string, THREE.Vector3> {
    const result = new Map<string, THREE.Vector3>()
    this.entities.forEach((e, id) => result.set(id, e.mesh.position.clone()))
    return result
  }

  dispose(): void {
    this.entities.forEach((_, id) => this.removeEntity(id))
  }
}
