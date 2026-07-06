import * as THREE from 'three'
import type { TerrainModification } from '../store/saveManager'

// ─── Value Noise + FBM ───────────────────────────────────────────────────────

function hash2(x: number, z: number, seed: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * 74.3) * 43758.5453
  return n - Math.floor(n)
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z)
  const fx = x - ix, fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uz = fz * fz * (3 - 2 * fz)
  const v00 = hash2(ix,     iz,     seed)
  const v10 = hash2(ix + 1, iz,     seed)
  const v01 = hash2(ix,     iz + 1, seed)
  const v11 = hash2(ix + 1, iz + 1, seed)
  return v00 * (1 - ux) * (1 - uz) +
         v10 * ux        * (1 - uz) +
         v01 * (1 - ux)  * uz       +
         v11 * ux        * uz
}

function fbm(x: number, z: number, seed: number, octaves: number): number {
  let value = 0, amplitude = 0.5, frequency = 1
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * frequency, z * frequency, seed + i * 47.3) * amplitude
    amplitude *= 0.5
    frequency *= 2.0
  }
  return value
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// ─── Terrain modifications ────────────────────────────────────────────────────

const activeMods: TerrainModification[] = []

// ─── Height cache ─────────────────────────────────────────────────────────────
// getTerrainHeight is pure and deterministic — same (x,z,seed) always returns
// the same value. Cache at 0.5-unit resolution to avoid redundant fbm work.
const _heightCache = new Map<string, number>()

export function getTerrainHeightCached(x: number, z: number, seed: number): number {
  const key = `${Math.round(x * 2)}_${Math.round(z * 2)}`
  if (_heightCache.has(key)) return _heightCache.get(key)!
  const h = getTerrainHeight(x, z, seed)
  _heightCache.set(key, h)
  return h
}

function clearHeightCache(): void {
  _heightCache.clear()
}

export function addTerrainMod(mod: TerrainModification): void {
  activeMods.push(mod)
}

export function clearTerrainMods(): void {
  activeMods.length = 0
  clearHeightCache()
}

function getModHeight(x: number, z: number): number {
  if (activeMods.length === 0) return 0
  let extra = 0
  for (const mod of activeMods) {
    const dx = x - mod.position[0]
    const dz = z - mod.position[1]
    const dist2 = dx * dx + dz * dz
    const r2 = mod.radius * mod.radius
    if (dist2 < r2 * 4) {
      const falloff = Math.exp(-dist2 / (2 * r2))
      switch (mod.type) {
        case 'mountain': extra += mod.strength * falloff * 18; break
        case 'cave':     extra -= mod.strength * falloff * 6;  break
        case 'river':    extra -= mod.strength * falloff * 4;  break
        case 'anomaly':
          extra += mod.strength * falloff * 12 * Math.sin(Math.sqrt(dist2) * 0.4)
          break
      }
    }
  }
  return extra
}

export function getTerrainHeight(x: number, z: number, seed: number): number {
  const s = (seed % 10000) + 1
  const ctrl = fbm(x * 0.0012 + s * 0.001, z * 0.0012 + s * 0.0013, s, 4)
  const plains    = (fbm(x * 0.01,  z * 0.01,  s + 100, 4) - 0.5) * 4
  const hills     = (fbm(x * 0.018, z * 0.018, s + 200, 5) - 0.5) * 22
  const mRaw      = fbm(x * 0.01,   z * 0.01,  s + 300, 6)
  const mountains = Math.pow(Math.max(0, mRaw - 0.2) / 0.8, 1.8) * 70
  const tPlainHill = smoothstep(0.0, 0.5, ctrl)
  const tHillMnt   = smoothstep(0.6, 1.0, ctrl)
  const base = lerp(lerp(plains, hills, tPlainHill), mountains, tHillMnt)
  return base + getModHeight(x, z)
}

export function rebuildTerrainMesh(mesh: THREE.Mesh, seed: number): void {
  clearHeightCache()
  const geo = mesh.geometry as THREE.BufferGeometry
  const positions = geo.attributes.position as THREE.BufferAttribute
  const colors    = geo.attributes.color    as THREE.BufferAttribute
  const color = new THREE.Color()
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i)
    const h = getTerrainHeight(x, z, seed)
    positions.setY(i, h)
    if (colors) {
      if      (h < -2)  color.setHex(0x3a6b8a)
      else if (h < 3)   color.setHex(0x4a8c35)
      else if (h < 12)  color.setHex(0x5a7a40)
      else if (h < 25)  color.setHex(0x7a6a52)
      else              color.setHex(0xd0cfc8)
      colors.setXYZ(i, color.r, color.g, color.b)
    }
  }
  positions.needsUpdate = true
  if (colors) colors.needsUpdate = true
  geo.computeVertexNormals()
}

export function createTerrain(seed: number, size = 4000, segments = 400): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments)
  geometry.rotateX(-Math.PI / 2)
  const positions = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, getTerrainHeight(positions.getX(i), positions.getZ(i), seed))
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()
  const colors = new Float32Array(positions.count * 3)
  const color  = new THREE.Color()
  for (let i = 0; i < positions.count; i++) {
    const h = positions.getY(i)
    if      (h < -2)  color.setHex(0x3a6b8a)
    else if (h < 3)   color.setHex(0x4a8c35)
    else if (h < 12)  color.setHex(0x5a7a40)
    else if (h < 25)  color.setHex(0x7a6a52)
    else              color.setHex(0xd0cfc8)
    colors[i * 3]     = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide })
  )
  mesh.receiveShadow = true
  mesh.name = 'terrain'
  return mesh
}

// ─── Параметрические структуры ────────────────────────────────────────────────

export interface StructurePart {
  shape: 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus'
  pos?: [number, number, number]
  color?: string
  glow?: boolean
  opacity?: number
  size?: [number, number, number]
  r?: number
  r1?: number
  r2?: number
  h?: number
  tube?: number
  rotX?: number
  rotY?: number
  rotZ?: number
  scaleX?: number
  scaleY?: number
  scaleZ?: number
  segments?: number
}

// ─── Material cache ───────────────────────────────────────────────────────────
// MeshLambertMaterial is safe to share across meshes when color/opacity match.
// Avoids creating hundreds of identical material objects for repeated parts.
const _matCache = new Map<string, THREE.MeshLambertMaterial>()

function getCachedMat(colorStr: string, opacity: number): THREE.MeshLambertMaterial {
  const key = `${colorStr}_${opacity.toFixed(2)}`
  if (_matCache.has(key)) return _matCache.get(key)!
  const color = new THREE.Color(colorStr)
  const mat = new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity })
  _matCache.set(key, mat)
  return mat
}

function buildPartMesh(part: StructurePart): THREE.Object3D {
  const colorStr = part.color || '#888888'
  const opacity  = part.opacity ?? 1
  const mat = getCachedMat(colorStr, opacity)

  let geo: THREE.BufferGeometry

  switch (part.shape) {
    case 'box': {
      const [w = 1, h = 1, d = 1] = part.size ?? [1, 1, 1]
      geo = new THREE.BoxGeometry(w, h, d)
      break
    }
    case 'cylinder': {
      const topR    = part.r1 ?? part.r ?? 0.5
      const bottomR = part.r2 ?? part.r ?? 0.5
      geo = new THREE.CylinderGeometry(topR, bottomR, part.h ?? 1, part.segments ?? 10)
      break
    }
    case 'cone': {
      geo = new THREE.ConeGeometry(part.r ?? 0.5, part.h ?? 1, part.segments ?? 8)
      break
    }
    case 'sphere': {
      geo = new THREE.SphereGeometry(part.r ?? 0.5, part.segments ?? 10, part.segments ?? 8)
      break
    }
    case 'torus': {
      geo = new THREE.TorusGeometry(part.r ?? 1, part.tube ?? 0.2, part.segments ?? 8, 16)
      break
    }
    default:
      geo = new THREE.BoxGeometry(1, 1, 1)
  }

  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true

  const [px = 0, py = 0, pz = 0] = part.pos ?? [0, 0, 0]
  mesh.position.set(px, py, pz)

  if (part.rotX) mesh.rotation.x = part.rotX
  if (part.rotY) mesh.rotation.y = part.rotY
  if (part.rotZ) mesh.rotation.z = part.rotZ

  if (part.scaleX !== undefined) mesh.scale.x = part.scaleX
  if (part.scaleY !== undefined) mesh.scale.y = part.scaleY
  if (part.scaleZ !== undefined) mesh.scale.z = part.scaleZ

  if (part.glow) {
    const group = new THREE.Group()
    group.add(mesh)
    const light = new THREE.PointLight(color, 2, 20)
    light.position.set(px, py, pz)
    group.add(light)
    return group
  }

  return mesh
}

export function createStructureMesh(type: string, parts?: StructurePart[]): THREE.Group {
  const group = new THREE.Group()

  if (parts && parts.length > 0) {
    for (const part of parts) {
      try { group.add(buildPartMesh(part)) } catch (_) {}
    }
    return group
  }

  const t = type.toLowerCase()

  if (t.includes('tree') || t.includes('дерев') || t.includes('лес')) {
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3728 })
    const crownMat = new THREE.MeshLambertMaterial({ color: 0x2d7a1e })
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 4, 7), trunkMat)
    trunk.position.y = 2; trunk.castShadow = true
    const crown = new THREE.Mesh(new THREE.SphereGeometry(2.8, 8, 6), crownMat)
    crown.position.y = 6; crown.castShadow = true
    group.add(trunk, crown)
  } else if (t.includes('ancient') || t.includes('древн')) {
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x2a1a0e })
    const crownMat = new THREE.MeshLambertMaterial({ color: 0x1a4a0e })
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.0, 8, 7), trunkMat)
    trunk.position.y = 4; trunk.castShadow = true
    const crown = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 6), crownMat)
    crown.position.y = 11; crown.scale.y = 0.7; crown.castShadow = true
    group.add(trunk, crown)
  } else if (t.includes('ruin') || t.includes('руин')) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x888070 })
    const walls: [number, number, number, number, number, number][] = [
      [6, 3, 0.7, 0, 1.5, -3.3],
      [0.7, 4, 5, 3.3, 2, 0],
      [3, 1.5, 0.7, -1.5, 0.75, 3.3],
    ]
    for (const [w, h, d, x, y, z] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      m.position.set(x, y, z); m.rotation.y = (Math.random() - 0.5) * 0.15
      m.castShadow = true; group.add(m)
    }
  } else if (t.includes('altar') || t.includes('алтар')) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x445566 })
    const plat = new THREE.Mesh(new THREE.BoxGeometry(5, 0.6, 5), mat)
    plat.position.y = 0.3; plat.castShadow = true
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 3.5, 8), mat)
    pillar.position.y = 2.05; pillar.castShadow = true
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 10), new THREE.MeshBasicMaterial({ color: 0x88aaff }))
    orb.position.y = 4.1
    const light = new THREE.PointLight(0x6688ff, 2, 25)
    light.position.y = 4.1
    group.add(plat, pillar, orb, light)
  } else if (t.includes('nest') || t.includes('гнездо')) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x5a3a20 })
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 3, 6), mat)
      log.position.set(Math.cos(angle) * 1.8, 0.5, Math.sin(angle) * 1.8)
      log.rotation.z = Math.PI * 0.35; log.rotation.y = angle + Math.PI / 2
      log.castShadow = true; group.add(log)
    }
  } else if (t.includes('crystal') || t.includes('кристалл')) {
    const cols = [0x88ffcc, 0xaaffee, 0x66ddff]
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshLambertMaterial({ color: cols[i], transparent: true, opacity: 0.85 })
      const h = 2 + i * 1.2
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.4 - i * 0.1, h, 6), mat)
      m.position.set((i - 1) * 1.1, h / 2, (i % 2) * 0.6)
      group.add(m)
    }
    group.add(Object.assign(new THREE.PointLight(0x44ffcc, 1.5, 18), { position: new THREE.Vector3(0, 3, 0) }))
  } else if (t.includes('monolith') || t.includes('монолит')) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x666055 })
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 0.8), mat)
    m.position.y = 3; m.rotation.y = (Math.random() - 0.5) * 0.3
    m.castShadow = true; group.add(m)
  } else {
    const mat = new THREE.MeshLambertMaterial({ color: 0x777070 })
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 5, 8), mat)
    base.position.y = 2.5; base.castShadow = true
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.5, 8), new THREE.MeshLambertMaterial({ color: 0x554444 }))
    top.position.y = 6; top.castShadow = true
    group.add(base, top)
  }

  return group
}

// ─── Флора (18 видов растительности) ─────────────────────────────────────────

function mat(hex: number | string, opacity = 1): THREE.MeshLambertMaterial {
  const color = typeof hex === 'string' ? new THREE.Color(hex) : new THREE.Color(hex)
  return new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity })
}

function addM(group: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material,
              px = 0, py = 0, pz = 0, rxDeg = 0, ryDeg = 0, rzDeg = 0): void {
  const mesh = new THREE.Mesh(geo, m)
  mesh.position.set(px, py, pz)
  if (rxDeg) mesh.rotation.x = rxDeg * Math.PI / 180
  if (ryDeg) mesh.rotation.y = ryDeg * Math.PI / 180
  if (rzDeg) mesh.rotation.z = rzDeg * Math.PI / 180
  mesh.castShadow = true
  group.add(mesh)
}

export function createFloraMesh(type: string, parts?: StructurePart[], scale = 1.0, colorVariant?: string): THREE.Group {
  const group = new THREE.Group()

  if (parts && parts.length > 0) {
    for (const part of parts) {
      try { group.add(buildPartMesh(part)) } catch (_) {}
    }
    return group
  }

  const t = type.toLowerCase()
  const s = Math.max(0.2, Math.min(5, scale))
  const cv = colorVariant

  if (t === 'oak' || t === 'дуб') {
    const th = 4 * s
    addM(group, new THREE.CylinderGeometry(0.3*s, 0.5*s, th, 8), mat(0x4a3728), 0, th/2, 0)
    addM(group, new THREE.SphereGeometry(2.5*s, 9, 7), mat(cv || 0x2d7a1e), 0, th+2*s, 0)
    addM(group, new THREE.SphereGeometry(1.8*s, 8, 6), mat(0x347a22), -1.5*s, th+1.5*s, 0.5*s)
    addM(group, new THREE.SphereGeometry(1.6*s, 8, 6), mat(0x257a18), 1.2*s, th+1.2*s, -0.8*s)

  } else if (t === 'pine' || t === 'сосна') {
    addM(group, new THREE.CylinderGeometry(0.2*s, 0.4*s, 5*s, 7), mat(0x4a3020), 0, 2.5*s, 0)
    for (let i = 0; i < 4; i++) {
      const y = (1.2 + i * 1.3) * s
      const r = (2.2 - i * 0.45) * s
      const h = (2 + i * 0.3) * s
      addM(group, new THREE.ConeGeometry(r, h, 8), mat(cv || 0x1a5c20), 0, y + h/2, 0)
    }

  } else if (t === 'birch' || t === 'берёза') {
    const th = 5 * s
    addM(group, new THREE.CylinderGeometry(0.18*s, 0.28*s, th, 7), mat(0xe8e0d0), 0, th/2, 0)
    for (let i = 0; i < 4; i++) {
      addM(group, new THREE.BoxGeometry(0.38*s, 0.15*s, 0.38*s), mat(0x333333), 0, 1+i*1.1*s, 0)
    }
    addM(group, new THREE.SphereGeometry(1.8*s, 8, 6), mat(cv || 0x8bc34a), -0.5*s, th+1.5*s, 0)
    addM(group, new THREE.SphereGeometry(1.4*s, 7, 5), mat(0x7ab03e), 0.8*s, th+1.2*s, 0.4*s)

  } else if (t === 'willow' || t === 'ива') {
    const th = 5 * s
    addM(group, new THREE.CylinderGeometry(0.3*s, 0.5*s, th, 8), mat(0x3d2b14), 0, th/2, 0)
    const crown = new THREE.Mesh(new THREE.SphereGeometry(3*s, 9, 7), mat(cv || 0x4a8c2e))
    crown.scale.y = 0.55; crown.position.set(0, th+1.2*s, 0); crown.castShadow = true; group.add(crown)
    for (let i = 0; i < 7; i++) {
      const angle = (i/7)*Math.PI*2
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.05*s, 0.03*s, 2.8*s, 4), mat(0x4a8c2e))
      branch.position.set(Math.cos(angle)*2.2*s, th-0.5*s, Math.sin(angle)*2.2*s)
      branch.rotation.z = Math.cos(angle) * 0.85; branch.rotation.x = Math.sin(angle) * 0.85
      group.add(branch)
    }

  } else if (t === 'palm' || t === 'пальма') {
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.22*s, 0.28*s, 1.5*s, 7), mat(0x8b6914))
      seg.position.set(i*0.15*s, 0.75*s + i*1.5*s, 0); seg.rotation.z = i * 0.05
      seg.castShadow = true; group.add(seg)
    }
    const topY = 7.5 * s
    for (let i = 0; i < 7; i++) {
      const angle = (i/7)*Math.PI*2
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.35*s, 2.8*s, 4), mat(cv || 0x2d8a1e))
      frond.position.set(Math.cos(angle)*1.5*s, topY, Math.sin(angle)*1.5*s)
      frond.rotation.z = 1.1 * Math.cos(angle); frond.rotation.x = 1.1 * Math.sin(angle)
      group.add(frond)
    }

  } else if (t === 'dead_tree' || t === 'мёртвое_дерево') {
    addM(group, new THREE.CylinderGeometry(0.25*s, 0.45*s, 5*s, 6), mat(0x4a3a2a), 0, 2.5*s, 0)
    const angles = [0.4, 1.8, 3.5, 4.9, 5.8]
    angles.forEach((angle, i) => {
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.06*s, 0.12*s, 2*s, 5), mat(0x3a2a1a))
      branch.position.set(Math.cos(angle)*0.3*s, (2.5+i*0.4)*s, Math.sin(angle)*0.3*s)
      branch.rotation.z = (Math.random()-0.5)*1.5; branch.rotation.y = angle; group.add(branch)
    })

  } else if (t === 'sakura' || t === 'сакура') {
    const th = 4 * s
    addM(group, new THREE.CylinderGeometry(0.25*s, 0.4*s, th, 7), mat(0x5a3320), 0, th/2, 0)
    addM(group, new THREE.SphereGeometry(2.2*s, 9, 7), mat(cv || 0xff88bb), 0, th+1.8*s, 0)
    addM(group, new THREE.SphereGeometry(1.5*s, 8, 6), mat(0xff99cc), -1.3*s, th+1.3*s, 0.6*s)
    addM(group, new THREE.SphereGeometry(1.3*s, 7, 5), mat(0xffaadd), 1*s, th+1*s, -0.8*s)
    // Falling petals hint
    for (let i = 0; i < 5; i++) {
      const angle = (i/5)*Math.PI*2
      addM(group, new THREE.SphereGeometry(0.12*s, 5, 4), mat(0xffbbdd),
        Math.cos(angle)*2.5*s, th+(Math.random()*1.5)*s, Math.sin(angle)*2.5*s)
    }

  } else if (t === 'jungle_tree' || t === 'джунгли') {
    const th = 6 * s
    addM(group, new THREE.CylinderGeometry(0.5*s, 0.7*s, th, 8), mat(0x3a2a14), 0, th/2, 0)
    for (let i = 0; i < 4; i++) {
      const angle = (i/4)*Math.PI*2
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.08*s, 0.15*s, 2*s, 5), mat(0x3a2a14))
      root.position.set(Math.cos(angle)*0.8*s, 0.5*s, Math.sin(angle)*0.8*s)
      root.rotation.z = Math.cos(angle)*0.4; root.rotation.x = Math.sin(angle)*0.4; group.add(root)
    }
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(3.5*s, 9, 6), mat(cv || 0x1a5c10))
    canopy.scale.y = 0.6; canopy.position.set(0, th+1.5*s, 0); canopy.castShadow = true; group.add(canopy)
    addM(group, new THREE.SphereGeometry(2.5*s, 8, 5), mat(0x228b22), -1.5*s, th+0.8*s, 1*s)

  } else if (t === 'ancient_oak' || t === 'древний_дуб') {
    const th = 7 * s
    addM(group, new THREE.CylinderGeometry(0.8*s, 1.2*s, th, 9), mat(0x2a1a0e), 0, th/2, 0)
    for (let i = 0; i < 5; i++) {
      const angle = (i/5)*Math.PI*2
      const root = new THREE.Mesh(new THREE.BoxGeometry(0.4*s, 1.5*s, 2*s), mat(0x2a1a0e))
      root.position.set(Math.cos(angle)*1.5*s, 0.5*s, Math.sin(angle)*1.5*s)
      root.rotation.y = angle; group.add(root)
    }
    addM(group, new THREE.SphereGeometry(4*s, 10, 8), mat(cv || 0x1a5a0e), 0, th+3*s, 0)
    addM(group, new THREE.SphereGeometry(3*s, 9, 7), mat(0x1e6412), -2.5*s, th+1.5*s, 0.8*s)
    addM(group, new THREE.SphereGeometry(2.5*s, 8, 6), mat(0x185a10), 2*s, th+1*s, -1.5*s)
    addM(group, new THREE.SphereGeometry(2*s, 8, 6), mat(0x1a6814), 0.5*s, th+0*s, 2*s)

  } else if (t === 'mushroom' || t === 'гриб') {
    addM(group, new THREE.CylinderGeometry(0.15*s, 0.2*s, 1.2*s, 7), mat(0xd4c5a0), 0, 0.6*s, 0)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.1*s, 10, 7), mat(cv || 0xcc3322))
    cap.scale.y = 0.5; cap.position.set(0, 1.45*s, 0); cap.castShadow = true; group.add(cap)
    for (let i = 0; i < 5; i++) {
      const angle = (i/5)*Math.PI*2
      addM(group, new THREE.SphereGeometry(0.1*s, 5, 4), mat(0xffffff),
        Math.cos(angle)*0.55*s, 1.55*s, Math.sin(angle)*0.55*s)
    }

  } else if (t === 'giant_mushroom' || t === 'гигантский_гриб') {
    addM(group, new THREE.CylinderGeometry(0.35*s, 0.5*s, 4*s, 8), mat(0xc8b89a), 0, 2*s, 0)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(3.5*s, 10, 8), mat(cv || 0x882211))
    cap.scale.y = 0.45; cap.position.set(0, 4.3*s, 0); cap.castShadow = true; group.add(cap)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3*s, 0.12*s, 6, 24), mat(0xffeeaa, 0.8))
    ring.position.y = 4*s; ring.rotation.x = Math.PI/2; group.add(ring)

  } else if (t === 'bioluminescent_mushroom' || t === 'светящийся_гриб') {
    addM(group, new THREE.CylinderGeometry(0.12*s, 0.18*s, 1.5*s, 7), mat(0xa0c8c8), 0, 0.75*s, 0)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.9*s, 9, 7), mat(cv || 0x44ffcc, 0.85))
    cap.scale.y = 0.6; cap.position.set(0, 1.6*s, 0); cap.castShadow = true; group.add(cap)
    const light = new THREE.PointLight(new THREE.Color(cv || '#44ffcc'), 1.5, 12)
    light.position.set(0, 1.6*s, 0); group.add(light)

  } else if (t === 'flower' || t === 'цветок') {
    addM(group, new THREE.CylinderGeometry(0.04*s, 0.06*s, 0.8*s, 5), mat(0x3a8a20), 0, 0.4*s, 0)
    for (let i = 0; i < 6; i++) {
      const angle = (i/6)*Math.PI*2
      const petal = new THREE.Mesh(new THREE.SphereGeometry(0.2*s, 6, 4), mat(cv || 0xff6688))
      petal.scale.z = 0.3; petal.position.set(Math.cos(angle)*0.22*s, 0.85*s, Math.sin(angle)*0.22*s)
      group.add(petal)
    }
    addM(group, new THREE.SphereGeometry(0.15*s, 7, 6), mat(0xffee44), 0, 0.85*s, 0)

  } else if (t === 'sunflower' || t === 'подсолнух') {
    addM(group, new THREE.CylinderGeometry(0.07*s, 0.1*s, 1.8*s, 6), mat(0x3a7820), 0, 0.9*s, 0)
    for (let i = 0; i < 12; i++) {
      const angle = (i/12)*Math.PI*2
      const petal = new THREE.Mesh(new THREE.BoxGeometry(0.08*s, 0.55*s, 0.2*s), mat(cv || 0xffcc00))
      petal.position.set(Math.cos(angle)*0.42*s, 1.9*s, Math.sin(angle)*0.42*s)
      petal.rotation.y = angle; group.add(petal)
    }
    addM(group, new THREE.CylinderGeometry(0.3*s, 0.3*s, 0.12*s, 10), mat(0x3a2000), 0, 1.9*s, 0)

  } else if (t === 'fern' || t === 'папоротник') {
    for (let i = 0; i < 8; i++) {
      const angle = (i/8)*Math.PI*2 + Math.PI/8
      const frond = new THREE.Mesh(new THREE.BoxGeometry(0.1*s, 1.5*s, 0.07*s), mat(cv || 0x2d8a20))
      frond.position.set(Math.cos(angle)*0.3*s, 0.5*s, Math.sin(angle)*0.3*s)
      frond.rotation.z = Math.cos(angle)*0.7; frond.rotation.x = Math.sin(angle)*0.4
      frond.rotation.y = angle; group.add(frond)
    }

  } else if (t === 'cactus' || t === 'кактус') {
    addM(group, new THREE.CylinderGeometry(0.3*s, 0.35*s, 3*s, 8), mat(cv || 0x2d7a2e), 0, 1.5*s, 0)
    const cm = mat(cv || 0x2d7a2e)
    const ah1 = new THREE.Mesh(new THREE.CylinderGeometry(0.2*s, 0.2*s, 1*s, 7), cm)
    ah1.position.set(0.5*s, 1.8*s, 0); ah1.rotation.z = Math.PI/2; group.add(ah1)
    const av1 = new THREE.Mesh(new THREE.CylinderGeometry(0.2*s, 0.2*s, 1.2*s, 7), cm)
    av1.position.set(1*s, 2.4*s, 0); group.add(av1)
    const ah2 = new THREE.Mesh(new THREE.CylinderGeometry(0.18*s, 0.18*s, 0.8*s, 7), cm)
    ah2.position.set(-0.4*s, 2.2*s, 0); ah2.rotation.z = -Math.PI/2; group.add(ah2)
    const av2 = new THREE.Mesh(new THREE.CylinderGeometry(0.18*s, 0.18*s, 1*s, 7), cm)
    av2.position.set(-0.8*s, 2.7*s, 0); group.add(av2)

  } else if (t === 'bush' || t === 'куст') {
    for (let i = 0; i < 5; i++) {
      const angle = (i/5)*Math.PI*2
      const r = (0.5 + (i%2)*0.3) * s
      addM(group, new THREE.SphereGeometry((0.5+i*0.08)*s, 7, 5), mat(cv || 0x2d6a18),
        Math.cos(angle)*r, (0.3+i*0.05)*s, Math.sin(angle)*r)
    }
    addM(group, new THREE.SphereGeometry(0.7*s, 7, 5), mat(0x357a20), 0, 0.6*s, 0)

  } else if (t === 'bamboo' || t === 'бамбук') {
    const segs = Math.max(3, Math.round(4*s))
    for (let i = 0; i < segs; i++) {
      addM(group, new THREE.CylinderGeometry(0.12*s, 0.14*s, 1.2*s, 6), mat(cv || 0x6aaa30), 0, i*1.2*s+0.6*s, 0)
      addM(group, new THREE.CylinderGeometry(0.16*s, 0.16*s, 0.1*s, 6), mat(0x558820), 0, (i+1)*1.2*s, 0)
    }
    for (let i = 0; i < 3; i++) {
      const angle = (i/3)*Math.PI*2
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.07*s, 0.8*s, 0.25*s), mat(0x4a9a28))
      leaf.position.set(Math.cos(angle)*0.3*s, segs*1.2*s+0.4*s, Math.sin(angle)*0.3*s)
      leaf.rotation.z = Math.cos(angle)*0.8; leaf.rotation.x = Math.sin(angle)*0.6; group.add(leaf)
    }

  } else if (t === 'lily_pad' || t === 'кувшинка') {
    addM(group, new THREE.CylinderGeometry(1.2*s, 1.2*s, 0.08*s, 12), mat(cv || 0x2d7a1e), 0, 0.04*s, 0)
    for (let i = 0; i < 5; i++) {
      const angle = (i/5)*Math.PI*2
      const petal = new THREE.Mesh(new THREE.SphereGeometry(0.2*s, 6, 4), mat(0xffc0cb))
      petal.scale.z = 0.4; petal.position.set(Math.cos(angle)*0.22*s, 0.2*s, Math.sin(angle)*0.22*s)
      group.add(petal)
    }
    addM(group, new THREE.SphereGeometry(0.15*s, 6, 5), mat(0xffee55), 0, 0.22*s, 0)

  } else if (t === 'grass_cluster' || t === 'трава') {
    for (let i = 0; i < 14; i++) {
      const angle = Math.random()*Math.PI*2
      const dist = Math.random()*0.9*s
      const h = (0.3 + Math.random()*0.6)*s
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06*s, h, 0.04*s), mat(cv || 0x4a8a20))
      blade.position.set(Math.cos(angle)*dist, h/2, Math.sin(angle)*dist)
      blade.rotation.z = (Math.random()-0.5)*0.5; group.add(blade)
    }

  } else if (t === 'spiral_tree' || t === 'спиральное_дерево') {
    for (let i = 0; i < 8; i++) {
      const angle = (i/8)*Math.PI*4
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.2*s, 0.28*s, 0.9*s, 6), mat(cv || 0x6a3a8e))
      seg.position.set(Math.cos(angle)*0.4*s, i*0.9*s+0.45*s, Math.sin(angle)*0.4*s)
      seg.castShadow = true; group.add(seg)
    }
    addM(group, new THREE.SphereGeometry(1.8*s, 9, 7), mat(0x8844cc), 0, 7.5*s, 0)
    const light = new THREE.PointLight(0xaa66ff, 1, 15)
    light.position.set(0, 7.5*s, 0); group.add(light)

  } else if (t === 'mangrove' || t === 'мангровое') {
    const th = 4 * s
    addM(group, new THREE.CylinderGeometry(0.25*s, 0.35*s, th, 7), mat(0x3a2a14), 0, th/2, 0)
    for (let i = 0; i < 6; i++) {
      const angle = (i/6)*Math.PI*2
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.06*s, 0.1*s, 2.5*s, 5), mat(0x3a2a14))
      root.position.set(Math.cos(angle)*1.2*s, 0.8*s, Math.sin(angle)*1.2*s)
      root.rotation.z = Math.cos(angle)*0.5; root.rotation.x = Math.sin(angle)*0.5; group.add(root)
    }
    addM(group, new THREE.SphereGeometry(2.5*s, 8, 6), mat(cv || 0x1a6a20), 0, th+2*s, 0)

  } else {
    // Default simple tree
    addM(group, new THREE.CylinderGeometry(0.3*s, 0.5*s, 4*s, 8), mat(0x4a3728), 0, 2*s, 0)
    addM(group, new THREE.SphereGeometry(2.5*s, 9, 7), mat(cv || 0x2d7a1e), 0, 6*s, 0)
  }

  return group
}

// ─── Небо и освещение ────────────────────────────────────────────────────────

export function createSky(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x87ceeb)
  scene.fog = new THREE.FogExp2(0xc9e8f5, 0.003)
  scene.add(new THREE.AmbientLight(0xffffff, 1.2))
  const sun = new THREE.DirectionalLight(0xfff4d0, 1.8)
  sun.position.set(80, 120, 60)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 500
  sun.shadow.camera.left = sun.shadow.camera.bottom = -150
  sun.shadow.camera.right = sun.shadow.camera.top   =  150
  scene.add(sun)
  scene.add(new THREE.HemisphereLight(0x87ceeb, 0x4a7c3f, 0.6))
}
