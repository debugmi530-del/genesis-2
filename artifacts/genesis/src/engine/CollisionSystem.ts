import * as THREE from 'three'

/**
 * AABB collision system for the player against static world objects.
 *
 * Architecture:
 *  - Registered objects are stored in a spatial hash-grid (CELL_SIZE × CELL_SIZE cells)
 *    so resolve() only tests boxes near the player instead of all collidables — O(1)
 *    in practice even with hundreds of objects.
 *  - Collision resolution uses axis-of-least-penetration in XZ so the player slides
 *    along walls rather than stopping dead.
 *  - Tunneling is prevented by the caller (FirstPersonController) substep-moving
 *    the player in increments of ≤ PLAYER_RADIUS per resolution call.
 */

const _playerBox = new THREE.Box3()
const _objBox    = new THREE.Box3()

export class CollisionSystem {
  // Spatial grid
  private static readonly CELL_SIZE = 16          // world units per cell
  private grid = new Map<string, THREE.Box3[]>()

  // Player capsule approximated as a vertical AABB
  static readonly PLAYER_RADIUS = 0.45   // half-width / depth in metres
  static readonly PLAYER_HEIGHT = 1.7    // camera sits at eye height

  // Minimum collidable footprint — skips tiny decorative flora (flowers, grass…)
  private static readonly MIN_FOOTPRINT = 0.4

  // ─── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a scene object as solid. Call AFTER `scene.add()` and position
   * so that world matrices are already correct.
   */
  register(object: THREE.Object3D): void {
    object.updateWorldMatrix(true, true)
    _objBox.setFromObject(object)

    const sizeX = _objBox.max.x - _objBox.min.x
    const sizeZ = _objBox.max.z - _objBox.min.z
    if (sizeX < CollisionSystem.MIN_FOOTPRINT && sizeZ < CollisionSystem.MIN_FOOTPRINT) return

    const box = _objBox.clone()
    this._insertIntoGrid(box)
  }

  private _insertIntoGrid(box: THREE.Box3): void {
    const cs = CollisionSystem.CELL_SIZE
    const minCX = Math.floor(box.min.x / cs)
    const maxCX = Math.floor(box.max.x / cs)
    const minCZ = Math.floor(box.min.z / cs)
    const maxCZ = Math.floor(box.max.z / cs)

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const key = `${cx},${cz}`
        let cell = this.grid.get(key)
        if (!cell) { cell = []; this.grid.set(key, cell) }
        cell.push(box)
      }
    }
  }

  /** Remove all registered collidables (call on world reset / new game). */
  clear(): void {
    this.grid.clear()
  }

  // ─── Resolution ────────────────────────────────────────────────────────────

  /**
   * Resolve `position` (eye-level camera position) against nearby collidables.
   * Mutates `position` in place; returns it for convenience.
   *
   * This is called once per substep from FirstPersonController, so each call
   * only needs to push the player out of any currently-intersecting boxes.
   * Because the player moves at most PLAYER_RADIUS per substep, no swept
   * (continuous) test is needed — discrete resolution is sufficient.
   */
  resolve(position: THREE.Vector3): THREE.Vector3 {
    const r  = CollisionSystem.PLAYER_RADIUS
    const h  = CollisionSystem.PLAYER_HEIGHT
    const cs = CollisionSystem.CELL_SIZE

    const playerCX = Math.floor(position.x / cs)
    const playerCZ = Math.floor(position.z / cs)

    // Check a 3 × 3 neighbourhood of cells (player fits inside one cell; the
    // adjacent cells handle objects that straddle a cell boundary).
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = this.grid.get(`${playerCX + dx},${playerCZ + dz}`)
        if (!cell) continue

        for (const box of cell) {
          // Rebuild player AABB each iteration so prior resolutions are reflected.
          _playerBox.min.set(position.x - r, position.y - h, position.z - r)
          _playerBox.max.set(position.x + r, position.y + 0.15, position.z + r)

          if (!_playerBox.intersectsBox(box)) continue

          // Penetration depths per horizontal side
          const px1 = _playerBox.max.x - box.min.x   // how far +X overlaps
          const px2 = box.max.x - _playerBox.min.x   // how far -X overlaps
          const pz1 = _playerBox.max.z - box.min.z
          const pz2 = box.max.z - _playerBox.min.z

          const minX = Math.min(px1, px2)
          const minZ = Math.min(pz1, pz2)

          // Push out along axis of least penetration (wall-sliding behaviour)
          if (minX <= minZ) {
            position.x += px1 < px2 ? -px1 : px2
          } else {
            position.z += pz1 < pz2 ? -pz1 : pz2
          }
          // Note: a box spanning multiple cells may appear in several cells and
          // be tested more than once. The second test will find no intersection
          // (the player was already pushed clear) and is a cheap no-op.
        }
      }
    }

    return position
  }

  get collidableCount(): number {
    let total = 0
    this.grid.forEach(cell => total += cell.length)
    return total
  }
}
