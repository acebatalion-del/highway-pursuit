import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { CarDef, CarKind } from './cars'
import { longitudinalForce } from './cars'
import type { DriveInput } from './input'
import { SPAWN, type World } from './world'

const G = 9.81

interface BodySpec {
  length: number
  width: number
  height: number
  wheelR: number
  wheelW: number
  cabin: number
  cabinLen: number
  cabinZ: number
}

const BODY: Record<CarKind, BodySpec> = {
  sedan: { length: 4.6, width: 1.82, height: 1.45, wheelR: 0.34, wheelW: 0.22, cabin: 0.42, cabinLen: 0.46, cabinZ: -0.05 },
  police: { length: 4.9, width: 1.9, height: 1.58, wheelR: 0.36, wheelW: 0.24, cabin: 0.46, cabinLen: 0.5, cabinZ: -0.02 },
  sport: { length: 4.4, width: 1.88, height: 1.28, wheelR: 0.33, wheelW: 0.26, cabin: 0.36, cabinLen: 0.42, cabinZ: -0.08 },
  suv: { length: 4.95, width: 2.05, height: 1.92, wheelR: 0.42, wheelW: 0.28, cabin: 0.52, cabinLen: 0.58, cabinZ: 0.04 },
  super: { length: 4.55, width: 2.0, height: 1.08, wheelR: 0.32, wheelW: 0.3, cabin: 0.3, cabinLen: 0.38, cabinZ: -0.04 },
}

interface WheelRig {
  pivot: THREE.Group
  spin: THREE.Group
  steered: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function basis(heading: number) {
  return {
    fx: Math.sin(heading),
    fz: Math.cos(heading),
    rx: Math.cos(heading),
    rz: -Math.sin(heading),
  }
}

function paintText(text: string, fg: string, bg: string, w: number, h: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = fg
  ctx.font = `700 ${Math.floor(h * 0.58)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2 + 1)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function disposeObject(root: THREE.Object3D) {
  const geos = new Set<THREE.BufferGeometry>()
  const mats = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    geos.add(mesh.geometry)
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of list) mats.add(mat)
  })
  for (const geo of geos) geo.dispose()
  for (const mat of mats) {
    const mapped = mat as THREE.MeshStandardMaterial
    if (mapped.map) textures.add(mapped.map)
    if (mapped.emissiveMap) textures.add(mapped.emissiveMap)
    mat.dispose()
  }
  for (const texture of textures) texture.dispose()
}

export class Vehicle {
  readonly hood = new THREE.Object3D()
  readonly cockpit = new THREE.Object3D()

  x = SPAWN.x
  z = SPAWN.z
  heading = SPAWN.heading
  vx = 0
  vz = 0
  groundY = 0.12

  private velX = 0
  private velZ = 0
  private smoothedSteer = 0
  private steerAngle = 0
  private pitch = 0
  private roll = 0
  private yawRate = 0
  private throttle = 0
  private time = 0
  private length = 4.6
  private radius = 0.9
  private root = new THREE.Group()
  private tilt = new THREE.Group()
  private wheels: WheelRig[] = []
  private cabin: THREE.Object3D | null = null
  private brakeMat = new THREE.MeshStandardMaterial()
  private redMat: THREE.MeshStandardMaterial | null = null
  private blueMat: THREE.MeshStandardMaterial | null = null

  constructor(
    private scene: THREE.Scene,
    public def: CarDef,
  ) {
    this.mount()
    this.reset()
  }

  get speed(): number {
    return Math.hypot(this.velX, this.velZ)
  }

  get gear(): string {
    if (this.vx < -0.4) return 'R'
    if (Math.abs(this.vx) < 0.75 && this.throttle < 0.12) return 'N'
    const ratio = Math.abs(this.vx) / this.def.topSpeed
    if (ratio < 0.15) return '1'
    if (ratio < 0.3) return '2'
    if (ratio < 0.46) return '3'
    if (ratio < 0.62) return '4'
    if (ratio < 0.78) return '5'
    return '6'
  }

  reset() {
    this.x = SPAWN.x
    this.z = SPAWN.z
    this.heading = SPAWN.heading
    this.velX = 0
    this.velZ = 0
    this.vx = 0
    this.vz = 0
    this.smoothedSteer = 0
    this.steerAngle = 0
    this.pitch = 0
    this.roll = 0
    this.yawRate = 0
    this.throttle = 0
    this.groundY = 0.12
    this.syncMesh()
  }

  swap(def: CarDef) {
    this.def = def
    this.scene.remove(this.root)
    disposeObject(this.root)
    this.mount()
    this.clampSpeed()
    this.syncMesh()
  }

  setCockpit(on: boolean) {
    if (this.cabin) this.cabin.visible = !on
  }

  updateMatrix() {
    this.root.updateMatrixWorld(true)
  }

  updateVisuals(dt: number, braking: number) {
    this.time += dt
    const spin = this.vx / Math.max(0.25, BODY[this.def.kind].wheelR)
    for (const wheel of this.wheels) {
      wheel.spin.rotation.x += spin * dt
      if (wheel.steered) wheel.pivot.rotation.y = this.steerAngle
    }
    this.brakeMat.emissiveIntensity = braking > 0.2 || this.vx < -0.4 ? 2.8 : 0.18
    if (this.redMat && this.blueMat) {
      const flash = Math.sin(this.time * 18) > 0
      this.redMat.emissiveIntensity = flash ? 6 : 0.05
      this.blueMat.emissiveIntensity = flash ? 0.05 : 6
    }
    this.syncMesh()
  }

  /**
   * Fixed-step vehicle model. Longitudinal force comes from cars.ts.
   * Velocity is written in the current basis, then the car yaws under it.
   */
  step(dt: number, input: DriveInput, world: World, absOn: boolean, tcs: boolean): number {
    const car = this.def
    this.throttle = input.throttle
    this.smoothedSteer += (input.steer - this.smoothedSteer) * (1 - Math.exp(-9 * dt))

    let { vx, vz } = this.project()
    let throttle = input.throttle
    if (tcs && Math.abs(vz) > 2.6) throttle *= 0.3

    const surface = world.surfaceAt(this.x, this.z)
    let mu = car.grip * (surface === 'road' ? 1 : surface === 'grass' ? 0.58 : 0.32)
    if (input.handbrake) mu *= car.handbrakeGrip
    if (!absOn && input.brake > 0.5 && vx > 1.2) mu *= 0.55

    let ax = longitudinalForce(car, vx, throttle, input.brake) / car.mass
    if (surface === 'grass') ax -= 1.6 * vx * Math.abs(vx)
    else if (surface === 'water') ax -= 7 * vx * Math.abs(vx)
    vx += ax * dt
    vx = clamp(vx, -12, car.topSpeed)

    const maxLat = mu * G
    vz += clamp(-vz * 7.5, -maxLat, maxLat) * dt
    this.write(vx, vz)

    this.steerAngle = (this.smoothedSteer * car.maxSteer) / (1 + Math.abs(vx) / car.steerFalloff)
    let yaw = 0
    if (Math.abs(vx) > 0.4) yaw = (vx / car.wheelbase) * Math.tan(this.steerAngle)
    const yawLimit = ((mu * G) / Math.max(Math.abs(vx), 3.5)) * (input.handbrake ? 1.65 : 1)
    yaw = clamp(yaw, -yawLimit, yawLimit)
    const over = (input.handbrake ? 0.48 : 0.085) * Math.min(1, Math.max(0, (Math.abs(vx) - 1.2) / 7))
    yaw += clamp(-vz * over, -1.8, 1.8)

    this.heading = Math.atan2(Math.sin(this.heading + yaw * dt), Math.cos(this.heading + yaw * dt))
    this.yawRate = yaw

    const blend = 1 - Math.exp(-8 * dt)
    this.pitch += (clamp(-ax * 0.012, -0.1, 0.08) - this.pitch) * blend
    this.roll += (clamp(this.yawRate * vx * car.rollScale * 0.012, -0.24, 0.24) - this.roll) * blend

    const distance = Math.hypot(this.velX, this.velZ) * dt
    const sub = Math.min(4, Math.max(1, Math.ceil(distance / 0.7)))
    const slice = dt / sub
    let impact = 0
    for (let i = 0; i < sub; i += 1) {
      this.x += this.velX * slice
      this.z += this.velZ * slice
      impact = Math.max(impact, this.solve(world))
    }
    impact = Math.max(impact, this.keepInside())

    const next = this.project()
    this.vx = next.vx
    this.vz = next.vz
    const ride = world.surfaceAt(this.x, this.z)
    this.groundY = ride === 'road' ? 0.12 : ride === 'water' ? -0.25 : 0.02
    return impact
  }

  private mount() {
    const spec = BODY[this.def.kind]
    this.length = spec.length
    this.radius = spec.width * 0.5
    this.root = new THREE.Group()
    this.tilt = new THREE.Group()
    this.root.add(this.tilt)
    this.wheels = []
    this.cabin = null
    this.redMat = null
    this.blueMat = null
    this.brakeMat = new THREE.MeshStandardMaterial({
      color: 0x3a0000,
      emissive: 0xff1a1a,
      emissiveIntensity: 0.18,
    })
    buildBody(this.def, spec, this.tilt, this.brakeMat, (cabin, red, blue) => {
      this.cabin = cabin
      this.redMat = red
      this.blueMat = blue
    }, (hood, cockpit) => {
      this.hood.position.copy(hood)
      this.cockpit.position.copy(cockpit)
    })
    this.tilt.add(this.hood, this.cockpit)
    const half = this.def.wheelbase / 2
    const x = spec.width / 2 + spec.wheelW * 0.08
    this.wheels.push(
      addWheel(this.root, x, half, spec, true),
      addWheel(this.root, -x, half, spec, true),
      addWheel(this.root, x, -half, spec, false),
      addWheel(this.root, -x, -half, spec, false),
    )
    this.scene.add(this.root)
  }

  private syncMesh() {
    this.root.position.set(this.x, this.groundY, this.z)
    this.root.rotation.y = this.heading
    this.tilt.rotation.x = this.pitch
    this.tilt.rotation.z = this.roll
  }

  private project() {
    const b = basis(this.heading)
    return {
      vx: this.velX * b.fx + this.velZ * b.fz,
      vz: this.velX * b.rx + this.velZ * b.rz,
    }
  }

  private write(vx: number, vz: number) {
    const b = basis(this.heading)
    this.velX = b.fx * vx + b.rx * vz
    this.velZ = b.fz * vx + b.rz * vz
    this.vx = vx
    this.vz = vz
  }

  private clampSpeed() {
    const current = this.project()
    const vx = clamp(current.vx, -12, this.def.topSpeed)
    this.write(vx, current.vz)
  }

  private solve(world: World): number {
    const b = basis(this.heading)
    const offset = Math.max(0, this.length * 0.5 - this.radius)
    const samples = offset > 0.05 ? [-offset, offset] : [0]
    let impact = 0
    for (const box of world.colliders) {
      if (!nearby(box, this.x, this.z, this.length)) continue
      for (const along of samples) {
        const hit = pushCircle(this.x + b.fx * along, this.z + b.fz * along, this.radius, box)
        if (!hit) continue
        this.x += hit.mx
        this.z += hit.mz
        const vn = this.velX * hit.nx + this.velZ * hit.nz
        if (vn < 0) {
          impact = Math.max(impact, -vn)
          this.velX -= vn * hit.nx * 1.22
          this.velZ -= vn * hit.nz * 1.22
        }
      }
    }
    return impact
  }

  private keepInside(): number {
    const limitX = 180 - this.radius
    const limitZ = 130 - this.radius
    let impact = 0
    if (this.x < -limitX) {
      this.x = -limitX
      if (this.velX < 0) {
        impact = -this.velX
        this.velX *= -0.22
      }
    } else if (this.x > limitX) {
      this.x = limitX
      if (this.velX > 0) {
        impact = this.velX
        this.velX *= -0.22
      }
    }
    if (this.z < -limitZ) {
      this.z = -limitZ
      if (this.velZ < 0) {
        impact = Math.max(impact, -this.velZ)
        this.velZ *= -0.22
      }
    } else if (this.z > limitZ) {
      this.z = limitZ
      if (this.velZ > 0) {
        impact = Math.max(impact, this.velZ)
        this.velZ *= -0.22
      }
    }
    return impact
  }
}

function nearby(box: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number, reach: number) {
  const cx = (box.minX + box.maxX) * 0.5
  const cz = (box.minZ + box.maxZ) * 0.5
  const hx = (box.maxX - box.minX) * 0.5 + reach
  const hz = (box.maxZ - box.minZ) * 0.5 + reach
  return Math.abs(x - cx) <= hx && Math.abs(z - cz) <= hz
}

function pushCircle(
  px: number,
  pz: number,
  radius: number,
  box: { minX: number; maxX: number; minZ: number; maxZ: number },
): { mx: number; mz: number; nx: number; nz: number } | null {
  const closestX = clamp(px, box.minX, box.maxX)
  const closestZ = clamp(pz, box.minZ, box.maxZ)
  const dx = px - closestX
  const dz = pz - closestZ
  const dist2 = dx * dx + dz * dz
  if (dist2 >= radius * radius) return null
  if (dist2 < 1e-8) {
    const left = px - box.minX
    const right = box.maxX - px
    const north = pz - box.minZ
    const south = box.maxZ - pz
    const nearest = Math.min(left, right, north, south)
    if (nearest === left) return { mx: -(radius + left), mz: 0, nx: -1, nz: 0 }
    if (nearest === right) return { mx: radius + right, mz: 0, nx: 1, nz: 0 }
    if (nearest === north) return { mx: 0, mz: -(radius + north), nx: 0, nz: -1 }
    return { mx: 0, mz: radius + south, nx: 0, nz: 1 }
  }
  const dist = Math.sqrt(dist2)
  const nx = dx / dist
  const nz = dz / dist
  const pen = radius - dist
  return { mx: nx * pen, mz: nz * pen, nx, nz }
}

function addWheel(parent: THREE.Object3D, x: number, z: number, spec: BodySpec, steered: boolean): WheelRig {
  const pivot = new THREE.Group()
  pivot.position.set(x, spec.wheelR, z)
  const spin = new THREE.Group()
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92 })
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(spec.wheelR, spec.wheelR, spec.wheelW, 16), rubber)
  tire.rotation.z = Math.PI / 2
  tire.castShadow = true
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.wheelR * 0.45, spec.wheelR * 0.45, spec.wheelW + 0.03, 10),
    new THREE.MeshStandardMaterial({ color: 0xd5d8de, metalness: 0.8, roughness: 0.28 }),
  )
  hub.rotation.z = Math.PI / 2
  spin.add(tire, hub)
  pivot.add(spin)
  parent.add(pivot)
  return { pivot, spin, steered }
}

function buildBody(
  def: CarDef,
  spec: BodySpec,
  parent: THREE.Group,
  brakeMat: THREE.MeshStandardMaterial,
  setCabin: (cabin: THREE.Object3D, red: THREE.MeshStandardMaterial | null, blue: THREE.MeshStandardMaterial | null) => void,
  setAnchors: (hood: THREE.Vector3, cockpit: THREE.Vector3) => void,
) {
  const paint = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.32, metalness: 0.62 })
  const accent = new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.48, metalness: 0.35 })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x1a2734,
    roughness: 0.08,
    metalness: 0.85,
    transparent: true,
    opacity: 0.82,
  })
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff4d2,
    emissive: 0xfff1c2,
    emissiveIntensity: 1.8,
  })

  const bodyH = spec.height * 0.55
  const bodyY = spec.wheelR * 0.55 + bodyH * 0.5
  const body = new THREE.Mesh(new RoundedBoxGeometry(spec.width, bodyH, spec.length, 2, 0.1), paint)
  body.position.y = bodyY
  body.castShadow = true
  body.receiveShadow = true
  parent.add(body)

  const cabinH = Math.max(0.28, spec.height * spec.cabin)
  const cabinLen = spec.length * spec.cabinLen
  const cabinZ = spec.cabinZ * spec.length
  const cabinY = bodyY + bodyH * 0.5 + cabinH * 0.5 - 0.1
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(spec.width * 0.86, cabinH, cabinLen, 2, 0.07), glassMat)
  cabin.position.set(0, cabinY, cabinZ)
  cabin.castShadow = true
  parent.add(cabin)

  const nose = spec.length * 0.5
  const lampZ = nose + 0.02
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.06), headMat)
    lamp.position.set(side * spec.width * 0.32, bodyY + 0.02, lampZ)
    parent.add(lamp)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.05), brakeMat)
    tail.position.set(side * spec.width * 0.32, bodyY + 0.02, -nose - 0.02)
    parent.add(tail)
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(spec.width * 0.42, 0.16, 0.05), accent)
  grille.position.set(0, bodyY - bodyH * 0.18, lampZ)
  parent.add(grille)

  if (def.kind === 'police') addPolice(spec, parent, accent, bodyY, cabin, cabinH, cabinY, cabinZ, setCabin)
  else setCabin(cabin, null, null)

  if (def.kind === 'sport' || def.kind === 'super') {
    const wingY = bodyY + bodyH * 0.5 + (def.kind === 'super' ? 0.14 : 0.24)
    for (const side of [-1, 1]) {
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.08), accent)
      upright.position.set(side * spec.width * 0.32, wingY - 0.06, -nose + 0.28)
      upright.castShadow = true
      parent.add(upright)
    }
    const wing = new THREE.Mesh(new THREE.BoxGeometry(spec.width * 0.78, 0.05, 0.26), accent)
    wing.position.set(0, wingY, -nose + 0.28)
    wing.castShadow = true
    parent.add(wing)
  }

  if (def.kind === 'super') {
    for (const side of [-1, 1]) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, spec.length * 0.62), accent)
      skirt.position.set(side * (spec.width * 0.5 + 0.01), spec.wheelR * 0.7, 0)
      parent.add(skirt)
    }
  }

  if (def.kind === 'suv') {
    const railY = cabinY + cabinH * 0.5 + 0.05
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, cabinLen * 0.92), accent)
      rail.position.set(side * spec.width * 0.28, railY, cabinZ)
      parent.add(rail)
    }
  }

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.16),
    new THREE.MeshStandardMaterial({ map: paintText('NM', '#1a1a1a', '#f2f2f2', 128, 64), roughness: 0.45 }),
  )
  plate.position.set(0, bodyY - 0.08, -nose - 0.03)
  plate.rotation.y = Math.PI
  parent.add(plate)

  const bodyTop = bodyY + bodyH * 0.5
  setAnchors(
    new THREE.Vector3(0, bodyTop + 0.55, spec.length * 0.42),
    new THREE.Vector3(-0.28, cabinY + cabinH * 0.08, cabinZ + cabinLen * 0.36),
  )
}

function addPolice(
  spec: BodySpec,
  parent: THREE.Group,
  accent: THREE.Material,
  bodyY: number,
  cabin: THREE.Mesh,
  cabinH: number,
  cabinY: number,
  cabinZ: number,
  setCabin: (cabin: THREE.Object3D, red: THREE.MeshStandardMaterial | null, blue: THREE.MeshStandardMaterial | null) => void,
) {
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(spec.length * 0.7, 0.12, 0.03), accent)
  stripe.rotation.y = Math.PI / 2
  stripe.position.set(-spec.width * 0.5 - 0.02, bodyY + 0.02, 0.05)
  const stripeR = stripe.clone()
  stripeR.position.x *= -1
  parent.add(stripe, stripeR)

  const decalMat = new THREE.MeshStandardMaterial({
    map: paintText('POLICE', '#f7f9fc', '#14181d', 320, 72),
    roughness: 0.55,
  })
  const left = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.26), decalMat)
  left.position.set(-spec.width * 0.5 - 0.03, bodyY + 0.16, 0.2)
  left.rotation.y = -Math.PI / 2
  const right = left.clone()
  right.position.x *= -1
  right.rotation.y = Math.PI / 2
  const hood = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.24), decalMat)
  hood.rotation.x = -Math.PI / 2
  hood.position.set(0, bodyY + spec.height * 0.28, spec.length * 0.18)
  parent.add(left, right, hood)

  const bar = new THREE.Mesh(new THREE.BoxGeometry(spec.width * 0.48, 0.1, 0.24), accent)
  bar.position.set(0, cabinH * 0.5 + 0.08, 0)
  const redMat = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1d1d, emissiveIntensity: 4 })
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x2a4bff, emissive: 0x1d3dff, emissiveIntensity: 0.05 })
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.16), redMat)
  red.position.set(-0.22, 0.08, 0)
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.16), blueMat)
  blue.position.set(0.22, 0.08, 0)
  bar.add(red, blue)
  cabin.add(bar)
  void cabinY
  void cabinZ
  setCabin(cabin, redMat, blueMat)
}
