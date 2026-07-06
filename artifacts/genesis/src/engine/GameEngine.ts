import * as THREE from 'three'
import { FirstPersonController } from './FirstPersonController'
import { EntityManager } from './EntityManager'
import {
  createTerrain, createSky, getTerrainHeightCached,
  addTerrainMod, rebuildTerrainMesh, createStructureMesh, createFloraMesh, clearTerrainMods,
} from './TerrainSystem'
import type { StructurePart } from './TerrainSystem'
import type { WorldSave, TerrainModification } from '../store/saveManager'

function createRainParticles(intensity: number, color = 0xaabbff, size = 0.18, fallSpeed = 0): THREE.Points {
  const count = Math.floor(3000 * Math.max(0.3, intensity))
  const pos = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 160
    pos[i * 3 + 1] = Math.random() * 70
    pos[i * 3 + 2] = (Math.random() - 0.5) * 160
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.55, depthWrite: false })
  const pts = new THREE.Points(geo, mat)
  ;(pts as any).__fallSpeed = fallSpeed || (18 + intensity * 12)
  return pts
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
  private ambientLight: THREE.AmbientLight | null = null
  private sunLight: THREE.DirectionalLight | null = null

  constructor(canvas: HTMLCanvasElement, world: WorldSave, onPause?: () => void) {
    this.seed = world.seed
    this.onPause = onPause

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.8

    this.scene = new THREE.Scene()
    createSky(this.scene)

    this.scene.children.forEach(c => {
      if (c instanceof THREE.AmbientLight) this.ambientLight = c
      if (c instanceof THREE.DirectionalLight) this.sunLight = c
    })

    clearTerrainMods()
    this.terrain = createTerrain(this.seed)
    this.scene.add(this.terrain)

    if (world.worldState.terrain && world.worldState.terrain.length > 0) {
      for (const mod of world.worldState.terrain) addTerrainMod(mod)
      rebuildTerrainMesh(this.terrain, this.seed)
    }

    this.camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 3000)
    const startX = 0, startZ = 0
    this.camera.position.set(startX, getTerrainHeightCached(startX, startZ, this.seed) + 1.7, startZ)

    this.controller = new FirstPersonController(this.camera, canvas)
    this.entityManager = new EntityManager(this.scene, this.seed)
    this.entityManager.spawnFromSavedData(world.worldState.entities)

    // Re-apply world rules if any saved
    if (world.worldState.worldRules) {
      for (const rule of world.worldState.worldRules) {
        this.setWorldRule(rule.name, rule.value)
      }
    }

    this.controller.enable(() => {}, () => {})
    window.addEventListener('resize', this.onResize)
    document.addEventListener('keydown', this.onEscape)
  }

  // ─── Weather ──────────────────────────────────────────────────────────────

  setWeather(weather: string, intensity: number): void {
    const w = weather.toLowerCase()
    const fog = this.scene.fog as THREE.FogExp2
    if (this.rainParticles) {
      this.scene.remove(this.rainParticles)
      this.rainParticles.geometry.dispose()
      ;(this.rainParticles.material as THREE.Material).dispose()
      this.rainParticles = null
    }
    const ci = Math.max(0.1, Math.min(3, intensity))

    if (w.includes('rain') || w.includes('дожд')) {
      fog.density = 0.004 + ci * 0.002
      this.rainParticles = createRainParticles(ci)
      this.scene.add(this.rainParticles)
      if (this.ambientLight) this.ambientLight.intensity = 0.7
    } else if (w.includes('storm') || w.includes('шторм') || w.includes('гроз')) {
      fog.density = 0.009
      this.rainParticles = createRainParticles(ci * 1.8, 0xaabbff, 0.18, 35)
      this.scene.add(this.rainParticles)
      if (this.ambientLight) this.ambientLight.intensity = 0.4
      this.scene.background = new THREE.Color(0x445566)
    } else if (w.includes('snow') || w.includes('снег')) {
      fog.density = 0.005 + ci * 0.001
      this.rainParticles = createRainParticles(ci * 0.6, 0xffffff, 0.35, 4)
      this.scene.add(this.rainParticles)
    } else if (w.includes('fog') || w.includes('туман')) {
      fog.density = 0.007 + ci * 0.005
      if (this.ambientLight) this.ambientLight.intensity = 0.8
    } else {
      fog.density = 0.003
      this.scene.background = new THREE.Color(0x87ceeb)
      if (this.ambientLight) this.ambientLight.intensity = 1.2
    }
  }

  // ─── World rules ──────────────────────────────────────────────────────────

  setWorldRule(name: string, value: string | number | boolean): void {
    const n = String(name).toLowerCase()
    const v = String(value).toLowerCase()
    const fog = this.scene.fog as THREE.FogExp2

    if (n.includes('time') || n.includes('время') || n.includes('day')) {
      if (v.includes('dawn') || v.includes('рассвет')) {
        this.scene.background = new THREE.Color(0xff8844)
        fog.color.setHex(0xff9966); fog.density = 0.004
        if (this.ambientLight) { this.ambientLight.color.setHex(0xffcc88); this.ambientLight.intensity = 0.65 }
        if (this.sunLight) { this.sunLight.color.setHex(0xffaa66); this.sunLight.intensity = 1.0; this.sunLight.position.set(10, 30, 80) }
      } else if (v.includes('noon') || v.includes('полдень')) {
        this.scene.background = new THREE.Color(0x87ceeb)
        fog.color.setHex(0xc9e8f5); fog.density = 0.003
        if (this.ambientLight) { this.ambientLight.color.setHex(0xffffff); this.ambientLight.intensity = 1.2 }
        if (this.sunLight) { this.sunLight.color.setHex(0xfff4d0); this.sunLight.intensity = 1.8; this.sunLight.position.set(80, 120, 60) }
      } else if (v.includes('dusk') || v.includes('закат') || v.includes('evening')) {
        this.scene.background = new THREE.Color(0xcc5533)
        fog.color.setHex(0xcc7744); fog.density = 0.005
        if (this.ambientLight) { this.ambientLight.color.setHex(0xff9966); this.ambientLight.intensity = 0.7 }
        if (this.sunLight) { this.sunLight.color.setHex(0xff6633); this.sunLight.intensity = 0.9; this.sunLight.position.set(-80, 20, 60) }
      } else if (v.includes('night') || v.includes('midnight') || v.includes('ночь')) {
        this.scene.background = new THREE.Color(0x080818)
        fog.color.setHex(0x080818); fog.density = 0.006
        if (this.ambientLight) { this.ambientLight.color.setHex(0x4466aa); this.ambientLight.intensity = 0.2 }
        if (this.sunLight) { this.sunLight.intensity = 0.05 }
      }
    } else if (n.includes('fog') || n.includes('туман')) {
      const level = typeof value === 'number' ? value : parseFloat(v) || 0.5
      fog.density = Math.max(0, Math.min(0.04, level * 0.02))
    } else if (n.includes('ambient') || n.includes('атмосфер') || n.includes('color')) {
      if (this.ambientLight && typeof value === 'string') {
        try { this.ambientLight.color.set(value) } catch (_) {}
      }
    } else if (n.includes('sky') || n.includes('небо')) {
      if (typeof value === 'string') {
        try { this.scene.background = new THREE.Color(value) } catch (_) {}
      }
    }
  }

  // ─── Structures ───────────────────────────────────────────────────────────

  spawnStructure(name: string, type: string, position: [number, number, number], parts?: StructurePart[]): void {
    const group = createStructureMesh(type, parts)
    const groundY = getTerrainHeightCached(position[0], position[2], this.seed)
    group.position.set(position[0], groundY, position[2])
    group.name = `structure_${name}`
    this.scene.add(group)
  }

  // ─── Flora ────────────────────────────────────────────────────────────────

  spawnFlora(name: string, type: string, position: [number, number, number], parts?: StructurePart[], scale = 1.0, colorVariant?: string): void {
    const group = createFloraMesh(type, parts, scale, colorVariant)
    const groundY = getTerrainHeightCached(position[0], position[2], this.seed)
    group.position.set(position[0], groundY, position[2])
    group.rotation.y = Math.random() * Math.PI * 2
    group.name = `flora_${name}`
    this.scene.add(group)
  }

  // ─── Beacon ───────────────────────────────────────────────────────────────

  placeBeacon(name: string, position: [number, number, number], color: string): void {
    const group = new THREE.Group()
    const col = new THREE.Color(color || '#88aaff')
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 10, 8),
      new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.55 })
    )
    pillar.position.y = 5
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 10, 8),
      new THREE.MeshBasicMaterial({ color: col })
    )
    orb.position.y = 10.5
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 1.0, 0.4, 10),
      new THREE.MeshLambertMaterial({ color: col })
    )
    base.position.y = 0.2
    const light = new THREE.PointLight(col, 4, 50)
    light.position.y = 10.5
    group.add(base, pillar, orb, light)
    const groundY = getTerrainHeightCached(position[0], position[2], this.seed)
    group.position.set(position[0], groundY, position[2])
    group.name = `beacon_${name}`
    this.scene.add(group)
  }

  // ─── Terrain ──────────────────────────────────────────────────────────────

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
    this.controller.update(delta, (x, z) => getTerrainHeightCached(x, z, this.seed))
    this.entityManager.update(delta, this.camera.position)
    this.updateRain(delta)
    this.renderer.render(this.scene, this.camera)
  }

  private updateRain(delta: number): void {
    if (!this.rainParticles) return
    const fallSpeed: number = (this.rainParticles as any).__fallSpeed ?? 20
    const pos = this.rainParticles.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) - fallSpeed * delta
      pos.setY(i, y < -3 ? 65 : y)
    }
    pos.needsUpdate = true
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
