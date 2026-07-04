import * as THREE from 'three'

function noise(x: number, z: number, seed: number): number {
  const s = seed * 0.001
  return (
    Math.sin(x * 0.05 + s) * Math.cos(z * 0.05 + s) * 10 +
    Math.sin(x * 0.12 + s * 2) * Math.cos(z * 0.08 + s * 3) * 4 +
    Math.sin(x * 0.25 + s * 5) * Math.cos(z * 0.3 + s * 7) * 2 +
    Math.sin(x * 0.5 + z * 0.4 + s * 11) * 1
  )
}

export function getTerrainHeight(x: number, z: number, seed: number): number {
  return noise(x, z, seed)
}

export function createTerrain(seed: number, size = 500, segments = 128): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments)
  geometry.rotateX(-Math.PI / 2)

  const positions = geometry.attributes.position
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const z = positions.getZ(i)
    positions.setY(i, getTerrainHeight(x, z, seed))
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()

  const material = new THREE.MeshLambertMaterial({
    vertexColors: false,
    color: new THREE.Color(0x2d5a1e),
    side: THREE.FrontSide,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.name = 'terrain'
  return mesh
}

export function createSky(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x0a0a1a)
  scene.fog = new THREE.FogExp2(0x0a0a1a, 0.012)

  const ambientLight = new THREE.AmbientLight(0x111133, 0.8)
  scene.add(ambientLight)

  const moonLight = new THREE.DirectionalLight(0x8888cc, 0.6)
  moonLight.position.set(50, 80, 30)
  moonLight.castShadow = true
  moonLight.shadow.mapSize.set(2048, 2048)
  moonLight.shadow.camera.near = 0.5
  moonLight.shadow.camera.far = 500
  moonLight.shadow.camera.left = -100
  moonLight.shadow.camera.right = 100
  moonLight.shadow.camera.top = 100
  moonLight.shadow.camera.bottom = -100
  scene.add(moonLight)

  const starGeometry = new THREE.BufferGeometry()
  const starCount = 3000
  const positions = new Float32Array(starCount * 3)
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(Math.random() * 2 - 1)
    const r = 300
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.abs(Math.cos(phi)) + 50
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
  }
  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.5 })
  scene.add(new THREE.Points(starGeometry, starMaterial))
}
