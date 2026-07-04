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

export function createTerrain(seed: number, size = 4000, segments = 256): THREE.Mesh {
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
