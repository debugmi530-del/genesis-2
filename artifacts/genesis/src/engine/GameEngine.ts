import * as THREE from 'three'
import { FirstPersonController } from './FirstPersonController'
import { EntityManager } from './EntityManager'
import { createTerrain, createSky, getTerrainHeight } from './TerrainSystem'
import type { WorldSave } from '../store/saveManager'

export class GameEngine {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controller: FirstPersonController
  private entityManager: EntityManager
  private animationId: number | null = null
  private clock = new THREE.Clock()
  private seed: number
  private onPause?: () => void

  constructor(canvas: HTMLCanvasElement, world: WorldSave, onPause?: () => void) {
    this.seed = world.seed
    this.onPause = onPause

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.8

    this.scene = new THREE.Scene()
    createSky(this.scene)

    const terrain = createTerrain(this.seed)
    this.scene.add(terrain)

    this.camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000)
    const startX = 0
    const startZ = 0
    const startY = getTerrainHeight(startX, startZ, this.seed) + 1.7
    this.camera.position.set(startX, startY, startZ)

    this.controller = new FirstPersonController(this.camera, canvas)
    this.entityManager = new EntityManager(this.scene, this.seed)

    this.entityManager.spawnFromSavedData(world.worldState.entities)

    this.controller.enable(
      () => {},
      () => {},
    )

    window.addEventListener('resize', this.onResize)
    document.addEventListener('keydown', this.onEscape)
  }

  private onEscape = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && this.controller.locked) {
      this.onPause?.()
    }
  }

  private onResize = () => {
    const canvas = this.renderer.domElement
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  start(): void {
    this.clock.start()
    this.loop()
  }

  private loop = (): void => {
    this.animationId = requestAnimationFrame(this.loop)
    const delta = Math.min(this.clock.getDelta(), 0.05)

    this.controller.update(delta, (x, z) => getTerrainHeight(x, z, this.seed))
    this.entityManager.update(delta, this.camera.position)

    this.renderer.render(this.scene, this.camera)
  }

  spawnEntity(data: import('../store/saveManager').EntityData): void {
    this.entityManager.spawnEntity(data)
  }

  removeEntity(id: string): void {
    this.entityManager.removeEntity(id)
  }

  updateEntity(id: string, updates: Partial<import('../store/saveManager').EntityData>): void {
    this.entityManager.updateEntity(id, updates)
  }

  getPlayerPosition(): [number, number, number] {
    const p = this.camera.position
    return [p.x, p.y, p.z]
  }

  requestPointerLock(): void {
    this.controller.requestLock()
  }

  dispose(): void {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId)
    this.controller.disable()
    this.entityManager.dispose()
    window.removeEventListener('resize', this.onResize)
    document.removeEventListener('keydown', this.onEscape)
    this.renderer.dispose()
  }
}
