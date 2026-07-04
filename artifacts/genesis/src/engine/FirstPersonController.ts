import * as THREE from 'three'

export class FirstPersonController {
  private camera: THREE.PerspectiveCamera
  private domElement: HTMLElement
  private velocity = new THREE.Vector3()
  private direction = new THREE.Vector3()
  private euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private moveForward = false
  private moveBackward = false
  private moveLeft = false
  private moveRight = false
  private sprint = false
  private isLocked = false
  private onInteract?: () => void
  private onAttack?: () => void

  readonly SPEED = 8
  readonly SPRINT_MULT = 2.0
  readonly GRAVITY = 20
  readonly JUMP_FORCE = 8
  private verticalVelocity = 0
  private isOnGround = true

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera
    this.domElement = domElement
  }

  enable(onInteract?: () => void, onAttack?: () => void) {
    this.onInteract = onInteract
    this.onAttack = onAttack
    this.domElement.addEventListener('click', this.onClick)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    document.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('mousemove', this.onMouseMove)
  }

  disable() {
    this.domElement.removeEventListener('click', this.onClick)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('mousemove', this.onMouseMove)
    if (document.pointerLockElement) document.exitPointerLock()
    this.isLocked = false
  }

  private onClick = () => {
    if (!this.isLocked) {
      this.domElement.requestPointerLock()
    }
  }

  private onPointerLockChange = () => {
    this.isLocked = document.pointerLockElement === this.domElement
  }

  private onKeyDown = (e: KeyboardEvent) => {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.moveForward = true; break
      case 'KeyS': case 'ArrowDown': this.moveBackward = true; break
      case 'KeyA': case 'ArrowLeft': this.moveLeft = true; break
      case 'KeyD': case 'ArrowRight': this.moveRight = true; break
      case 'ShiftLeft': this.sprint = true; break
      case 'Space':
        if (this.isOnGround) {
          this.verticalVelocity = this.JUMP_FORCE
          this.isOnGround = false
        }
        break
      case 'KeyE': this.onInteract?.(); break
      case 'Escape':
        if (this.isLocked) document.exitPointerLock()
        break
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.moveForward = false; break
      case 'KeyS': case 'ArrowDown': this.moveBackward = false; break
      case 'KeyA': case 'ArrowLeft': this.moveLeft = false; break
      case 'KeyD': case 'ArrowRight': this.moveRight = false; break
      case 'ShiftLeft': this.sprint = false; break
    }
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isLocked) return
    const sensitivity = 0.002
    this.euler.setFromQuaternion(this.camera.quaternion)
    this.euler.y -= e.movementX * sensitivity
    this.euler.x -= e.movementY * sensitivity
    this.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.euler.x))
    this.camera.quaternion.setFromEuler(this.euler)
  }

  update(delta: number, getGroundHeight: (x: number, z: number) => number) {
    if (!this.isLocked) return

    const speed = this.SPEED * (this.sprint ? this.SPRINT_MULT : 1)

    this.direction.set(0, 0, 0)
    if (this.moveForward) this.direction.z -= 1
    if (this.moveBackward) this.direction.z += 1
    if (this.moveLeft) this.direction.x -= 1
    if (this.moveRight) this.direction.x += 1
    if (this.direction.length() > 0) this.direction.normalize()

    const forward = new THREE.Vector3(-Math.sin(this.euler.y), 0, -Math.cos(this.euler.y))
    const right = new THREE.Vector3(Math.cos(this.euler.y), 0, -Math.sin(this.euler.y))

    this.velocity.set(0, 0, 0)
    this.velocity.addScaledVector(forward, -this.direction.z * speed)
    this.velocity.addScaledVector(right, this.direction.x * speed)

    this.camera.position.x += this.velocity.x * delta
    this.camera.position.z += this.velocity.z * delta

    this.verticalVelocity -= this.GRAVITY * delta
    this.camera.position.y += this.verticalVelocity * delta

    const groundY = getGroundHeight(this.camera.position.x, this.camera.position.z) + 1.7
    if (this.camera.position.y <= groundY) {
      this.camera.position.y = groundY
      this.verticalVelocity = 0
      this.isOnGround = true
    }
  }

  get locked() {
    return this.isLocked
  }

  requestLock() {
    this.domElement.requestPointerLock()
  }
}
