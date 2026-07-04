import * as THREE from 'three'

// --- Value noise с плавной интерполяцией ---

function hash2(x: number, z: number, seed: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * 74.3) * 43758.5453
  return n - Math.floor(n)
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  // Smooth step (cubic Hermite) — убирает линейные артефакты
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

// Fractional Brownian Motion — складывает октавы шума
function fbm(x: number, z: number, seed: number, octaves: number): number {
  let value = 0
  let amplitude = 0.5
  let frequency = 1
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * frequency, z * frequency, seed + i * 47.3) * amplitude
    amplitude *= 0.5
    frequency *= 2.0
  }
  return value // диапазон ≈ [0..1]
}

// --- Основная функция высоты ---

export function getTerrainHeight(x: number, z: number, seed: number): number {
  const s = (seed % 10000) + 1

  // Контрольная карта (очень низкая частота) — определяет тип зоны
  // 0 = равнина, 1 = горы
  const ctrl = fbm(x * 0.0012 + s * 0.001, z * 0.0012 + s * 0.0013, s, 4)

  // Равнина — слабый fbm, почти плоско, лёгкие неровности
  const plains = (fbm(x * 0.01, z * 0.01, s + 100, 4) - 0.5) * 4

  // Холмы — средний fbm
  const hills = (fbm(x * 0.018, z * 0.018, s + 200, 5) - 0.5) * 22

  // Горы — fbm с возведением в степень для острых пиков
  const mRaw = fbm(x * 0.01, z * 0.01, s + 300, 6)
  const mountains = Math.pow(Math.max(0, mRaw - 0.2) / 0.8, 1.8) * 70

  // Плавное смешивание через контрольную карту
  // 0.0..0.45 → равнина→холмы
  // 0.45..0.65 → холмы
  // 0.65..1.0  → холмы→горы
  const tPlainHill = smoothstep(0.0, 0.5, ctrl)
  const tHillMnt   = smoothstep(0.6, 1.0, ctrl)

  const h = lerp(lerp(plains, hills, tPlainHill), mountains, tHillMnt)
  return h
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// --- Создание меша ---

export function createTerrain(seed: number, size = 4000, segments = 400): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments)
  geometry.rotateX(-Math.PI / 2)

  const positions = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const z = positions.getZ(i)
    positions.setY(i, getTerrainHeight(x, z, seed))
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()

  // Vertex colors: окрашиваем по высоте (вода → трава → камень → снег)
  const colors = new Float32Array(positions.count * 3)
  const color = new THREE.Color()
  for (let i = 0; i < positions.count; i++) {
    const h = positions.getY(i)
    if (h < -2) {
      color.setHex(0x3a6b8a)         // вода/болото
    } else if (h < 3) {
      color.setHex(0x4a8c35)         // трава
    } else if (h < 12) {
      color.setHex(0x5a7a40)         // высокая трава / кустарник
    } else if (h < 25) {
      color.setHex(0x7a6a52)         // камень / скала
    } else {
      color.setHex(0xd0cfc8)         // снег на вершинах
    }
    colors[i * 3]     = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.FrontSide,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.name = 'terrain'
  return mesh
}

export function createSky(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x87ceeb)
  scene.fog = new THREE.FogExp2(0xc9e8f5, 0.003)

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.2)
  scene.add(ambientLight)

  const sunLight = new THREE.DirectionalLight(0xfff4d0, 1.8)
  sunLight.position.set(80, 120, 60)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(2048, 2048)
  sunLight.shadow.camera.near = 0.5
  sunLight.shadow.camera.far = 500
  sunLight.shadow.camera.left = -150
  sunLight.shadow.camera.right = 150
  sunLight.shadow.camera.top = 150
  sunLight.shadow.camera.bottom = -150
  scene.add(sunLight)

  const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x4a7c3f, 0.6)
  scene.add(hemiLight)
}
