export type CarId = 'commuter' | 'patrol' | 'lumen' | 'summit' | 'aero'
export type CarKind = 'sedan' | 'police' | 'sport' | 'suv' | 'super'

export interface CarDef {
  id: CarId
  maker: string
  name: string
  blurb: string
  price: string
  color: number
  accent: number
  kind: CarKind
  mass: number
  engineForce: number
  brakeForce: number
  reverseForce: number
  topSpeed: number
  grip: number
  handbrakeGrip: number
  maxSteer: number
  steerFalloff: number
  wheelbase: number
  drag: number
  rollScale: number
}

export const CARS: CarDef[] = [
  {
    id: 'commuter',
    maker: 'Feld',
    name: 'Commuter',
    blurb: 'Balanced and planted, until the tires run out of grip.',
    price: 'Owned',
    color: 0xc5ccd4,
    accent: 0x2c3138,
    kind: 'sedan',
    mass: 1350,
    engineForce: 8200,
    brakeForce: 10500,
    reverseForce: 4800,
    topSpeed: 55.9,
    grip: 1,
    handbrakeGrip: 0.34,
    maxSteer: 0.58,
    steerFalloff: 28,
    wheelbase: 2.7,
    drag: 0.4,
    rollScale: 1,
  },
  {
    id: 'patrol',
    maker: 'Feld',
    name: 'Patrol',
    blurb: 'Marked cruiser. Heavier than the Commuter, with stronger brakes.',
    price: 'Owned',
    color: 0xf4f6f8,
    accent: 0x16181c,
    kind: 'police',
    mass: 1680,
    engineForce: 11800,
    brakeForce: 14500,
    reverseForce: 5200,
    topSpeed: 64.8,
    grip: 1.04,
    handbrakeGrip: 0.36,
    maxSteer: 0.56,
    steerFalloff: 26,
    wheelbase: 2.85,
    drag: 0.46,
    rollScale: 1.05,
  },
  {
    id: 'lumen',
    maker: 'Lumen',
    name: 'RS',
    blurb: 'Quick, and willing to rotate if you keep your foot in.',
    price: '$25,000',
    color: 0xc4312e,
    accent: 0x1b1b1b,
    kind: 'sport',
    mass: 1450,
    engineForce: 15000,
    brakeForce: 15000,
    reverseForce: 5600,
    topSpeed: 78.2,
    grip: 0.96,
    handbrakeGrip: 0.28,
    maxSteer: 0.6,
    steerFalloff: 21,
    wheelbase: 2.58,
    drag: 0.36,
    rollScale: 0.85,
  },
  {
    id: 'summit',
    maker: 'Harlan',
    name: 'Summit',
    blurb: 'Tall and heavy. It leans, and it takes a long time to stop.',
    price: '$32,000',
    color: 0x2f4a3c,
    accent: 0xd9c7a2,
    kind: 'suv',
    mass: 2200,
    engineForce: 11500,
    brakeForce: 13500,
    reverseForce: 6200,
    topSpeed: 58.1,
    grip: 0.84,
    handbrakeGrip: 0.32,
    maxSteer: 0.48,
    steerFalloff: 18,
    wheelbase: 3.05,
    drag: 0.62,
    rollScale: 1.7,
  },
  {
    id: 'aero',
    maker: 'Voss',
    name: 'Aero',
    blurb: 'Extremely fast. The wheel goes light as the speed climbs.',
    price: '$75,000',
    color: 0xf2c14e,
    accent: 0x222222,
    kind: 'super',
    mass: 1500,
    engineForce: 19500,
    brakeForce: 16500,
    reverseForce: 6000,
    topSpeed: 91.6,
    grip: 0.93,
    handbrakeGrip: 0.24,
    maxSteer: 0.5,
    steerFalloff: 13,
    wheelbase: 2.62,
    drag: 0.32,
    rollScale: 0.65,
  },
]

export function carById(id: CarId): CarDef {
  return CARS.find((car) => car.id === id) ?? CARS[0]
}

export function driveForce(car: CarDef, vx: number, throttle: number): number {
  if (throttle <= 0) return 0
  const ratio = Math.min(1, Math.max(0, vx) / car.topSpeed)
  return throttle * car.engineForce * (1 - Math.pow(ratio, 1.5))
}

export function longitudinalForce(car: CarDef, vx: number, throttle: number, brake: number): number {
  let force = -(car.drag * vx * Math.abs(vx) + 80 * vx)
  const braking = brake > 0.05
  if (braking && throttle < 0.2) {
    if (vx > 0.4) force -= brake * car.brakeForce
    else force -= brake * car.reverseForce
  } else {
    force += driveForce(car, vx, throttle)
  }
  return force
}

export function zeroToSixty(car: CarDef): number {
  let speed = 0
  let time = 0
  const target = 26.8224
  const dt = 0.02
  while (speed < target && time < 40) {
    const force = longitudinalForce(car, speed, 1, 0)
    speed += (force / car.mass) * dt
    time += dt
  }
  return time
}

export function topSpeedMph(car: CarDef): number {
  return Math.round(car.topSpeed * 2.23694)
}
