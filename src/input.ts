export interface DriveInput {
  throttle: number
  brake: number
  steer: number
  handbrake: boolean
  camera: boolean
  reset: boolean
  pause: boolean
  carSlot: number
  lookX: number
  lookY: number
  pointerLook: boolean
}

const empty = (): DriveInput => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  camera: false,
  reset: false,
  pause: false,
  carSlot: -1,
  lookX: 0,
  lookY: 0,
  pointerLook: false,
})

export class Input {
  private keys = new Set<string>()
  private pointerX = 0
  private pointerY = 0
  private locked = false
  private prevButtons = new Set<number>()
  private prevKeys = new Set<string>()

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (event) => {
      if (event.repeat) return
      this.keys.add(event.key.toLowerCase())
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(event.key.toLowerCase())) {
        event.preventDefault()
      }
    })
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.key.toLowerCase())
    })
    window.addEventListener('blur', () => this.keys.clear())
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas
    })
    document.addEventListener('mousemove', (event) => {
      if (!this.locked) return
      this.pointerX += event.movementX
      this.pointerY += event.movementY
    })
    canvas.addEventListener('click', () => {
      if (canvas.dataset.playable === 'true') canvas.requestPointerLock()
    })
  }

  read(): DriveInput {
    const input = empty()
    const pad = navigator.getGamepads?.().find((gamepad) => gamepad && gamepad.connected) ?? null

    input.throttle = this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0
    input.brake = this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0
    if (this.keys.has('a') || this.keys.has('arrowleft')) input.steer -= 1
    if (this.keys.has('d') || this.keys.has('arrowright')) input.steer += 1
    input.handbrake = this.keys.has(' ')

    const numberKeys = ['1', '2', '3', '4', '5']
    numberKeys.forEach((key, index) => {
      if (this.keys.has(key) && !this.prevKeys.has(key)) input.carSlot = index
    })
    input.camera = this.keys.has('c') && !this.prevKeys.has('c')
    input.reset = this.keys.has('r') && !this.prevKeys.has('r')
    input.pause = this.keys.has('escape') && !this.prevKeys.has('escape')

    if (pad) {
      const axis = pad.axes[0] ?? 0
      if (Math.abs(axis) > 0.12) input.steer = Math.max(-1, Math.min(1, axis))
      const rt = pad.buttons[7]?.value ?? 0
      const lt = pad.buttons[6]?.value ?? 0
      if (rt > 0.05) input.throttle = Math.max(input.throttle, rt)
      if (lt > 0.05) input.brake = Math.max(input.brake, lt)
      if (pad.buttons[0]?.pressed) input.handbrake = true
      if (pad.buttons[14]?.pressed) input.steer = -1
      if (pad.buttons[15]?.pressed) input.steer = 1
      if (pad.buttons[3]?.pressed && !this.prevButtons.has(3)) input.camera = true
      if (pad.buttons[9]?.pressed && !this.prevButtons.has(9)) input.pause = true
      input.lookX += pad.axes[2] ?? 0
      input.lookY += pad.axes[3] ?? 0
    }

    input.lookX += this.pointerX * 0.0025
    input.lookY += this.pointerY * 0.002
    input.pointerLook = this.locked
    this.pointerX = 0
    this.pointerY = 0

    this.prevKeys = new Set(this.keys)
    this.prevButtons = new Set(
      pad ? pad.buttons.map((button, index) => (button.pressed ? index : -1)).filter((index) => index >= 0) : [],
    )
    return input
  }
}
