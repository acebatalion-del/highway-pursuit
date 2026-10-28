import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EngineAudio } from './audio'
import { CARS, carById, topSpeedMph, zeroToSixty, type CarId } from './cars'
import { Input, type DriveInput } from './input'
import { Vehicle } from './vehicle'
import { createWorld, type MapRect, type World } from './world'

const SAVE_KEY = 'highway-pursuit-mvp'
const STEP = 1 / 60
const CAMERAS = ['Chase', 'Hood', 'Cockpit'] as const

interface Save {
  car: CarId
  abs: boolean
  tcs: boolean
  volume: number
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing #${id}`)
  return node as T
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function loadSave(): Save {
  const fallback: Save = { car: 'commuter', abs: true, tcs: false, volume: 0.7 }
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return fallback
    const data = JSON.parse(raw) as Partial<Save>
    return {
      car: CARS.some((car) => car.id === data.car) ? (data.car as CarId) : fallback.car,
      abs: data.abs !== false,
      tcs: data.tcs === true,
      volume: typeof data.volume === 'number' ? clamp(data.volume, 0, 1) : fallback.volume,
    }
  } catch {
    return fallback
  }
}

export class Game {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly world: World
  private readonly vehicle: Vehicle
  private readonly input: Input
  private readonly audio = new EngineAudio()
  private readonly ray = new THREE.Raycaster()
  private readonly chase = new THREE.Vector3()
  private readonly focus = new THREE.Vector3()
  private readonly desired = new THREE.Vector3()
  private readonly lookTarget = new THREE.Vector3()
  private readonly rayDir = new THREE.Vector3()
  private readonly mini: CanvasRenderingContext2D

  private save: Save
  private abs: boolean
  private tcs: boolean
  private mode: 'menu' | 'drive' | 'pause' = 'menu'
  private fromPause = false
  private cameraMode = 0
  private lookYaw = 0
  private lookPitch = 0
  private snapCamera = true
  private orbit = 0.6
  private acc = 0
  private last = performance.now()

  private readonly hud = el<HTMLDivElement>('hud')
  private readonly menu = el<HTMLDivElement>('menu')
  private readonly pauseOverlay = el<HTMLDivElement>('pause')
  private readonly speedEl = el<HTMLElement>('speed')
  private readonly gearEl = el<HTMLElement>('gear')
  private readonly carNameEl = el<HTMLElement>('car-name')
  private readonly cameraNameEl = el<HTMLElement>('camera-name')
  private readonly placeEl = el<HTMLElement>('place')
  private readonly panelMain = el<HTMLElement>('panel-main')
  private readonly panelGarage = el<HTMLElement>('panel-garage')
  private readonly panelControls = el<HTMLElement>('panel-controls')
  private readonly panelSettings = el<HTMLElement>('panel-settings')

  constructor() {
    this.canvas = el<HTMLCanvasElement>('view')
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene.background = new THREE.Color(0x8ebcde)
    this.scene.fog = new THREE.Fog(0xa9cbe3, 70, 250)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.25, 600)
    this.resize()
    window.addEventListener('resize', () => this.resize())

    const hemi = new THREE.HemisphereLight(0xc5e6ff, 0x5d8748, 0.95)
    const sun = new THREE.DirectionalLight(0xfff1dd, 2.35)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 8
    sun.shadow.camera.far = 160
    sun.shadow.camera.left = -55
    sun.shadow.camera.right = 55
    sun.shadow.camera.top = 55
    sun.shadow.camera.bottom = -55
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.04
    this.scene.add(hemi, sun, sun.target)
    this.sun = sun

    this.world = createWorld(this.scene)
    this.save = loadSave()
    this.abs = this.save.abs
    this.tcs = this.save.tcs
    this.audio.setVolume(this.save.volume)
    this.vehicle = new Vehicle(this.scene, carById(this.save.car))
    this.input = new Input(this.canvas)

    const miniCanvas = el<HTMLCanvasElement>('minimap')
    const ctx = miniCanvas.getContext('2d')
    if (!ctx) throw new Error('minimap')
    this.mini = ctx

    this.syncSettings()
    this.renderGarage()
    this.wireUi()
    this.applyFov()
    requestAnimationFrame(this.frame)
  }

  private sun: THREE.DirectionalLight

  private resize() {
    const width = this.canvas.clientWidth || window.innerWidth
    const height = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  private frame = (now: number) => {
    const frameDt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    const input = this.input.read()

    if (input.carSlot >= 0) {
      const car = CARS[input.carSlot]
      if (car) this.selectCar(car.id)
    }
    if (input.pause) this.onPauseKey()
    if (this.mode !== 'menu' && input.camera) this.cycleCamera()
    if (this.mode === 'drive' && input.reset) {
      this.vehicle.reset()
      this.snapCamera = true
    }

    if (this.mode === 'drive') {
      this.acc = Math.min(0.2, this.acc + frameDt)
      while (this.acc >= STEP) {
        const impact = this.vehicle.step(STEP, input, this.world, this.abs, this.tcs)
        if (impact > 0) this.audio.impact(impact)
        this.acc -= STEP
      }
    }

    this.world.tick(frameDt)
    this.followSun()
    if (this.mode === 'menu') {
      this.vehicle.updateVisuals(frameDt, 0)
      this.updateOrbit(frameDt)
      this.audio.update(0, 0, 0, false)
    } else {
      this.vehicle.updateVisuals(frameDt, this.mode === 'drive' ? input.brake : 0)
      this.vehicle.updateMatrix()
      this.updateDriveCamera(frameDt, input)
      this.updateHud()
      const live = this.mode === 'drive'
      this.audio.update(this.vehicle.vx, live ? input.throttle : 0, Math.abs(this.vehicle.vz), live)
    }

    if (import.meta.env.DEV) {
      const debug = window as Window & { __hp?: Record<string, number | string> }
      debug.__hp = {
        x: this.vehicle.x,
        z: this.vehicle.z,
        speed: this.vehicle.speed,
        heading: this.vehicle.heading,
        gear: this.vehicle.gear,
        mode: this.mode,
        camera: CAMERAS[this.cameraMode],
        place: this.world.placeAt(this.vehicle.x, this.vehicle.z),
      }
    }

    this.renderer.render(this.scene, this.camera)
    requestAnimationFrame(this.frame)
  }

  private followSun() {
    const x = this.mode === 'menu' ? 0 : this.vehicle.x
    const z = this.mode === 'menu' ? 0 : this.vehicle.z
    this.sun.position.set(x + 38, 70, z + 20)
    this.sun.target.position.set(x, 0, z)
    this.sun.target.updateMatrixWorld()
  }

  private onPauseKey() {
    if (this.mode === 'drive') this.pause()
    else if (this.mode === 'pause' && this.menu.hidden) this.resume()
    else if (this.mode === 'pause') this.showPause()
  }

  private beginDrive() {
    this.mode = 'drive'
    this.fromPause = false
    this.menu.hidden = true
    this.pauseOverlay.hidden = true
    this.hud.hidden = false
    this.canvas.dataset.playable = 'true'
    this.acc = 0
    this.snapCamera = true
    this.lookYaw = 0
    this.lookPitch = 0
    this.vehicle.reset()
    this.restartHint()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  private pause() {
    this.mode = 'pause'
    this.pauseOverlay.hidden = false
    this.menu.hidden = true
    this.fromPause = false
    this.canvas.dataset.playable = 'false'
    if (document.pointerLockElement) document.exitPointerLock()
  }

  private resume() {
    this.mode = 'drive'
    this.pauseOverlay.hidden = true
    this.menu.hidden = true
    this.fromPause = false
    this.canvas.dataset.playable = 'true'
    this.acc = 0
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  private quit() {
    this.mode = 'menu'
    this.hud.hidden = true
    this.pauseOverlay.hidden = true
    this.canvas.dataset.playable = 'false'
    this.fromPause = false
    this.showPanel('main')
    if (document.pointerLockElement) document.exitPointerLock()
    this.vehicle.reset()
    this.audio.update(0, 0, 0, false)
  }

  private showPause() {
    this.mode = 'pause'
    this.menu.hidden = true
    this.pauseOverlay.hidden = false
    this.fromPause = false
    this.hud.hidden = false
  }

  private openFromPause(panel: 'garage' | 'controls' | 'settings') {
    this.fromPause = true
    this.pauseOverlay.hidden = true
    this.showPanel(panel)
  }

  private back() {
    if (this.fromPause) this.showPause()
    else this.showPanel('main')
  }

  private showPanel(name: 'main' | 'garage' | 'controls' | 'settings') {
    this.menu.hidden = false
    this.panelMain.hidden = name !== 'main'
    this.panelGarage.hidden = name !== 'garage'
    this.panelControls.hidden = name !== 'controls'
    this.panelSettings.hidden = name !== 'settings'
  }

  private wireUi() {
    const click = (id: string, fn: () => void) => el<HTMLButtonElement>(id).addEventListener('click', fn)
    click('play', () => {
      this.audio.start()
      this.beginDrive()
    })
    click('open-garage', () => this.showPanel('garage'))
    click('open-controls', () => this.showPanel('controls'))
    click('open-settings', () => this.showPanel('settings'))
    click('garage-back', () => this.back())
    click('controls-back', () => this.back())
    click('settings-back', () => this.back())
    click('resume', () => this.resume())
    click('pause-garage', () => this.openFromPause('garage'))
    click('pause-controls', () => this.openFromPause('controls'))
    click('pause-settings', () => this.openFromPause('settings'))
    click('quit', () => this.quit())

    el<HTMLInputElement>('opt-abs').addEventListener('change', () => {
      this.abs = el<HTMLInputElement>('opt-abs').checked
      this.save.abs = this.abs
      this.persist()
    })
    el<HTMLInputElement>('opt-tcs').addEventListener('change', () => {
      this.tcs = el<HTMLInputElement>('opt-tcs').checked
      this.save.tcs = this.tcs
      this.persist()
    })
    el<HTMLInputElement>('opt-volume').addEventListener('input', () => {
      this.save.volume = Number(el<HTMLInputElement>('opt-volume').value) / 100
      this.audio.setVolume(this.save.volume)
      this.persist()
    })
  }

  private syncSettings() {
    el<HTMLInputElement>('opt-abs').checked = this.abs
    el<HTMLInputElement>('opt-tcs').checked = this.tcs
    el<HTMLInputElement>('opt-volume').value = String(Math.round(this.save.volume * 100))
  }

  private persist() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.save))
    } catch {
      // Private mode can reject storage; the session still plays.
    }
  }

  private selectCar(id: CarId) {
    this.save.car = id
    if (this.vehicle.def.id !== id) this.vehicle.swap(carById(id))
    this.persist()
    this.renderGarage()
    if (this.mode !== 'menu') this.updateHud()
  }

  private renderGarage() {
    const list = el<HTMLDivElement>('car-list')
    list.replaceChildren()
    for (const car of CARS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = car.id === this.save.car ? 'car-card selected' : 'car-card'
      const swatch = document.createElement('span')
      swatch.className = 'swatch'
      swatch.style.background = `#${car.color.toString(16).padStart(6, '0')}`
      const title = document.createElement('b')
      title.textContent = `${car.maker} ${car.name} `
      const price = document.createElement('i')
      price.textContent = car.price
      title.append(price)
      const stats = document.createElement('div')
      stats.className = 'stats'
      stats.textContent = `${zeroToSixty(car).toFixed(1)}s 0–60 · ${topSpeedMph(car)} mph`
      const blurb = document.createElement('div')
      blurb.className = 'blurb'
      blurb.textContent = car.blurb
      button.append(swatch, title, stats, blurb)
      button.addEventListener('click', () => this.selectCar(car.id))
      list.append(button)
    }
  }

  private restartHint() {
    const hint = el<HTMLElement>('hint')
    hint.style.animation = 'none'
    void hint.offsetWidth
    hint.style.animation = ''
  }

  private cycleCamera() {
    this.cameraMode = (this.cameraMode + 1) % CAMERAS.length
    this.snapCamera = true
    this.applyFov()
    this.vehicle.setCockpit(CAMERAS[this.cameraMode] === 'Cockpit')
  }

  private applyFov() {
    const mounted = this.cameraMode > 0
    this.camera.fov = this.cameraMode === 2 ? 74 : 60
    this.camera.near = mounted ? 0.05 : 0.25
    this.camera.updateProjectionMatrix()
  }

  private updateOrbit(dt: number) {
    this.orbit += dt * 0.09
    this.camera.position.set(Math.sin(this.orbit) * 132, 56, Math.cos(this.orbit) * 98)
    this.camera.lookAt(0, 2, 6)
  }

  private updateDriveCamera(dt: number, input: DriveInput) {
    const locked = input.pointerLook
    this.lookYaw += input.lookX * (locked ? 1 : dt * 1.7)
    this.lookPitch += input.lookY * (locked ? 1 : dt * 1.3)
    this.lookYaw = clamp(this.lookYaw, -1.3, 1.3)
    this.lookPitch = clamp(this.lookPitch, -0.55, 0.62)
    if (!locked && this.cameraMode === 0 && Math.hypot(input.lookX, input.lookY) < 0.18) {
      const decay = Math.exp(-1.8 * dt)
      this.lookYaw *= decay
      this.lookPitch *= decay
    }

    const name = CAMERAS[this.cameraMode]
    this.vehicle.setCockpit(name === 'Cockpit')
    if (name === 'Chase') this.updateChase(dt)
    else this.updateMounted(name === 'Hood' ? this.vehicle.hood : this.vehicle.cockpit)
  }

  private updateChase(dt: number) {
    const yaw = this.vehicle.heading + this.lookYaw
    const back = 7.6 + Math.min(3.2, Math.abs(this.vehicle.vx) * 0.045)
    this.focus.set(this.vehicle.x, this.vehicle.groundY + 1.35, this.vehicle.z)
    this.desired.set(
      this.vehicle.x - Math.sin(yaw) * back,
      this.vehicle.groundY + 2.9 + Math.max(0, this.lookPitch) * 0.5,
      this.vehicle.z - Math.cos(yaw) * back,
    )
    this.pullCamera(this.focus, this.desired)
    this.desired.y = Math.max(0.9, this.desired.y)
    if (this.snapCamera) {
      this.chase.copy(this.desired)
      this.snapCamera = false
    } else {
      this.chase.lerp(this.desired, 1 - Math.exp(-4.2 * dt))
    }
    this.chase.y = Math.max(0.9, this.chase.y)
    this.pullCamera(this.focus, this.chase)
    this.camera.position.copy(this.chase)
    this.lookTarget.set(
      this.vehicle.x + Math.sin(this.vehicle.heading) * 5,
      this.vehicle.groundY + 1.15 - this.lookPitch * 2.5,
      this.vehicle.z + Math.cos(this.vehicle.heading) * 5,
    )
    this.camera.lookAt(this.lookTarget)
  }

  private updateMounted(anchor: THREE.Object3D) {
    anchor.getWorldPosition(this.desired)
    this.camera.position.copy(this.desired)
    const yaw = this.vehicle.heading + this.lookYaw
    const pitch = -this.lookPitch
    const cos = Math.cos(pitch)
    this.lookTarget.set(
      this.desired.x + Math.sin(yaw) * cos * 12,
      this.desired.y + Math.sin(pitch) * 12,
      this.desired.z + Math.cos(yaw) * cos * 12,
    )
    this.camera.lookAt(this.lookTarget)
  }

  private pullCamera(from: THREE.Vector3, to: THREE.Vector3) {
    this.rayDir.copy(to).sub(from)
    const dist = this.rayDir.length()
    if (dist < 0.35) return
    this.rayDir.multiplyScalar(1 / dist)
    this.ray.set(from, this.rayDir)
    this.ray.far = dist
    const hits = this.ray.intersectObjects(this.world.obstacles, true)
    const hit = hits.find((item) => item.distance > 0.2)
    if (hit && hit.distance < dist - 0.2) {
      const keep = Math.max(1.25, hit.distance - 0.4)
      to.copy(from).addScaledVector(this.rayDir, keep)
    }
  }

  private updateHud() {
    this.speedEl.textContent = String(Math.round(Math.abs(this.vehicle.speed) * 2.23694))
    this.gearEl.textContent = this.vehicle.gear
    this.carNameEl.textContent = `${this.vehicle.def.maker} ${this.vehicle.def.name}`
    this.cameraNameEl.textContent = CAMERAS[this.cameraMode]
    this.placeEl.textContent = this.world.placeAt(this.vehicle.x, this.vehicle.z)
    this.drawMap(this.vehicle.x, this.vehicle.z, this.vehicle.heading)
  }

  private drawMap(px: number, pz: number, heading: number) {
    const ctx = this.mini
    const scale = 220 / 190
    ctx.clearRect(0, 0, 220, 220)
    ctx.save()
    ctx.beginPath()
    ctx.arc(110, 110, 108, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = '#173628'
    ctx.fillRect(0, 0, 220, 220)
    this.paintRect(ctx, this.world.water, '#1b6486', px, pz, scale)
    for (const road of this.world.roads) this.paintRect(ctx, road, '#3a4148', px, pz, scale)
    for (const building of this.world.buildings) this.paintRect(ctx, building, '#c5ced6', px, pz, scale)
    ctx.translate(110, 110)
    ctx.rotate(-heading)
    ctx.fillStyle = '#ffb020'
    ctx.beginPath()
    ctx.moveTo(0, 8)
    ctx.lineTo(5.5, -7)
    ctx.lineTo(-5.5, -7)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  private paintRect(
    ctx: CanvasRenderingContext2D,
    rect: MapRect,
    color: string,
    px: number,
    pz: number,
    scale: number,
  ) {
    ctx.fillStyle = color
    ctx.fillRect(
      110 + (rect.x - rect.hx - px) * scale,
      110 + (rect.z - rect.hz - pz) * scale,
      rect.hx * 2 * scale,
      rect.hz * 2 * scale,
    )
  }
}
