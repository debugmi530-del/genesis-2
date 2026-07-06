import * as THREE from 'three'

/**
 * Simple AABB collision system for the player against static world objects
 * (structures, flora, beacons). Uses axis-of-least-penetration resolution
 * in the XZ plane so the player slides along walls instead of stopping dead.
 */

const _playerBox = new THREE.Box3()
const _objBox    = new THREE.Box3()

export class CollisionSystem {
  private collidables: THREE.Box3[] = []

  // Player capsule approximated as a vertical box
  static readonly PLAYER_RADIUS = 0.45   // half-width/depth (metres)
  static readonly PLAYER_HEIGHT = 1.7    // camera sits at eye height

  // Minimum collidable footprint – skips tiny decorative flora (flowers, grass)
  private static readonly MIN_FOOTPRINT = 0.4

  /**
   * Register a scene object as solid. Call after positioning AND adding to scene
   * so that world matrices are correct.
   */
  register(object: THREE.Object3D): void {
    object.updateWorldMatrix(true, true)
    _objBox.setFromObject(object)

    const sizeX = _objBox.max.x - _objBox.min.x
    const sizeZ = _objBox.max.z - _objBox.min.z

    if (sizeX < CollisionSystem.MIN_FOOTPRINT && sizeZ < CollisionSystem.MIN_FOOTPRINT) return

    this.collidables.push(_objBox.clone())
  }

  /** Remove all registered collidables (call on world reset / new game). */
  clear(): void {
    this.collidables = []
  }

  /**
   * Resolve `position` (eye-level camera position) against all collidables.
   * Mutates `position` in place; returns it for convenience.
   */
  resolve(position: THREE.Vector3): THREE.Vector3 {
    const r = CollisionSystem.PLAYER_RADIUS
    const h = CollisionSystem.PLAYER_HEIGHT

    for (const box of this.collidables) {
      // Build player box around current (possibly already corrected) position
      _playerBox.min.set(position.x - r, position.y - h, position.z - r)
      _playerBox.max.set(position.x + r, position.y + 0.15, position.z + r)

      if (!_playerBox.intersectsBox(box)) continue

      // Penetration depths on each horizontal axis
      const px1 = _playerBox.max.x - box.min.x   // overlap from +X side
      const px2 = box.max.x - _playerBox.min.x   // overlap from -X side
      const pz1 = _playerBox.max.z - box.min.z   // overlap from +Z side
      const pz2 = box.max.z - _playerBox.min.z   // overlap from -Z side

      const minX = Math.min(px1, px2)
      const minZ = Math.min(pz1, pz2)

      // Push out along the axis with the smallest penetration (sliding behaviour)
      if (minX <= minZ) {
        position.x += px1 < px2 ? -px1 : px2
      } else {
        position.z += pz1 < pz2 ? -pz1 : pz2
      }
    }

    return position
  }

  get collidableCount(): number {
    return this.collidables.length
  }
}
