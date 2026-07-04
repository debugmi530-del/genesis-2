import * as THREE from 'three'
import { FirstPersonController } from './FirstPersonController'
import { EntityManager } from './EntityManager'
import {
  createTerrain, createSky, getTerrainHeight,
  addTerrainMod, rebuildTerrainMesh, createStructureMesh,
} from './TerrainSystem'
import type { WorldSave, TerrainModification } from '../store/saveManager'

function createRainParticles(intensity: number): THREE.Points {
  const count = Math.floor(3000 * Math.max(0.3, intensity))
  const pos = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 160
    pos[i * 3 + 1] = Math.random() * 70
    pos[i * 3 + 2] = (Math.random() - 0.5) * 160
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({
    color: 0xaabbff,
    size: 0.18,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  return new THREE.Points(geo, mat)
}

export class GameEngine {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controller: FirstPersonController
  private entityManager: EntityManager
  private terrain: THREE.Mesh
  private animationId: number | null = null
  private clock = new THREE.Clock()
  private seed: number
  private onPause?: () => void

  private rainParticles: THREE.Points | null = null
  private rainFallSpeed = 0
  private ambientLight: THREE.AmbientLight | null = null

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

    // сохраняем ссылку на ambient light для weather
    this.scene.children.forEach(c => {
      if (c instanceof THREE.AmbientLight) this.ambientLight = c
    })

    this.terrain = createTerrain(this.seed)
    this.scene.add(this.terrain)

    this.camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 3000)
    const startX = 0, startZ = 0
    this.camera.position.set(startX, getTerrainHeight(startX, startZ, this.seed) + 1.7, startZ)

    this.controller = new FirstPersonController(this.camera, canvas)
    this.entityManager = new EntityManager(this.scene, this.seed)
    this.entityManager.spawnFromSavedData(world.worldState.entities)

    this.controller.enable(() => {}, () => {})
    window.addEventListener('resize', this.onResize)
    document.addEventListener('keydown', this.onEscape)
  }

  // ─── Weather ──────────────────────────────────────────────────────────────

  setWeather(weather: string, intensity: number): void {
    const w = weather.toLowerCase()
    const fog = this.scene.fog as THREE.FogExp2

    // убрать старые частицы
    if (this.rainParticles) {
      this.scene.remove(this.rainParticles)
      this.rainParticles.geometry.dispose()
      ;(this.rainParticles.material as THREE.Material).dispose()
      this.rainParticles = null
    }

    const clampedIntensity = Math.max(0.1, Math.min(3, intensity))

    if (w.includes('rain') || w.includes('дожд')) {
      fog.density = 0.004 + clampedIntensity * 0.002
      this.rainParticles = createRainParticles(clampedIntensity)
      this.rainFallSpeed = 18 + clampedIntensity * 12
      this.scene.add(this.rainParticles)
      if (this.ambientLight) this.ambientLight.intensity = 0.7

    } else if (w.includes('storm') || w.includes('шторм') || w.includes('гроз')) {
      fog.density = 0.009
      this.rainParticles = createRainParticles(clampedIntensity * 1.8)
      this.rainFallSpeed = 35
      this.scene.add(this.rainParticles)
      if (this.ambientLight) this.ambientLight.intensity = 0.4
      this.scene.background = new THREE.Color(0x445566)

    } else if (w.includes('snow') || w.includes('снег')) {
      fog.density = 0.005 + clampedIntensity * 0.001
      this.rainParticles = createRainParticles(clampedIntensity * 0.6)
      this.rainFallSpeed = 4
      // перекрашиваем частицы в белый
      ;(this.rainParticles.material as THREE.PointsMaterial).color.setHex(0xffffff)
      ;(this.rainParticles.material as THREE.PointsMaterial).size = 0.35
      this.scene.add(this.rainParticles)

    } else if (w.includes('fog') || w.includes('туман')) {
      fog.density = 0.007 + clampedIntensity * 0.005
      if (this.ambientLight) this.ambientLight.intensity = 0.8

    } else {
      // clear / ясно / солнечно
      fog.density = 0.003
      this.scene.background = new THREE.Color(0x87ceeb)
      if (this.ambientLight) this.ambientLight.intensity = 1.2
    }
  }

  // ─── Structures ───────────────────────────────────────────────────────────

  spawnStructure(name: string, type: string, position: [number, number, number]): void {
    const group = createStructureMesh(type)
    const groundY = getTerrainHeight(position[0], position[2], this.seed)
    group.position.set(position[0], groundY, position[2])
    group.name = `structure_${name}`
    this.scene.add(group)
  }

  // ─── Terrain modification ─────────────────────────────────────────────────

  applyTerrainMod(mod: TerrainModification): void {
    addTerrainMod(mod)
    rebuildTerrainMesh(this.terrain, this.seed)
  }

  // ─── Entities ─────────────────────────────────────────────────────────────

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

  // ─── Loop ─────────────────────────────────────────────────────────────────

  start(): void {
    this.clock.start()
    this.loop()
  }

  private loop = (): void => {
    this.animationId = requestAnimationFrame(this.loop)
    const delta = Math.min(this.clock.getDelta(), 0.05)

    this.controller.update(delta, (x, z) => getTerrainHeight(x, z, this.seed))
    this.entityManager.update(delta, this.camera.position)
    this.updateRain(delta)

    this.renderer.render(this.scene, this.camera)
  }

  private updateRain(delta: number): void {
    if (!this.rainParticles) return
    const pos = this.rainParticles.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) - this.rainFallSpeed * delta
      pos.setY(i, y < -3 ? 65 : y)
    }
    pos.needsUpdate = true
    // двигаем вместе с камерой
    this.rainParticles.position.x = this.camera.position.x
    this.rainParticles.position.z = this.camera.position.z
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  private onEscape = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && this.controller.locked) this.onPause?.()
  }

  private onResize = () => {
    const canvas = this.renderer.domElement
    const w = canvas.clientWidth, h = canvas.clientHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  dispose(): void {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId)
    this.controller.disable()
    this.entityManager.dispose()
    if (this.rainParticles) {
      this.scene.remove(this.rainParticles)
      this.rainParticles.geometry.dispose()
      ;(this.rainParticles.material as THREE.Material).dispose()
    }
    window.removeEventListener('resize', this.onResize)
    document.removeEventListener('keydown', this.onEscape)
    this.renderer.dispose()
  }
}
