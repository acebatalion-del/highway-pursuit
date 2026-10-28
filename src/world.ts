import * as THREE from 'three'

export interface Aabb {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface MapRect {
  x: number
  z: number
  hx: number
  hz: number
}

export type Surface = 'road' | 'grass' | 'water'

export const SPAWN = { x: -70, z: 104, heading: Math.PI / 2 }

const ROADS: MapRect[] = [
  { x: 0, z: -100, hx: 155, hz: 9 },
  { x: 0, z: 100, hx: 155, hz: 9 },
  { x: 150, z: 0, hx: 9, hz: 100 },
  { x: -150, z: 0, hx: 9, hz: 100 },
  { x: -50, z: 0, hx: 5.5, hz: 62 },
  { x: 0, z: 0, hx: 5.5, hz: 62 },
  { x: 50, z: 0, hx: 5.5, hz: 62 },
  { x: 0, z: -40, hx: 72, hz: 5.5 },
  { x: 0, z: 0, hx: 72, hz: 5.5 },
  { x: 0, z: 40, hx: 72, hz: 5.5 },
  { x: 0, z: -82, hx: 6, hz: 28 },
  { x: 0, z: 80, hx: 6, hz: 22 },
  { x: 110, z: 0, hx: 42, hz: 6 },
  { x: -110, z: 0, hx: 42, hz: 6 },
]

const WATER: MapRect = { x: 0, z: -80, hx: 170, hz: 12 }

interface Tower {
  x: number
  z: number
  hx: number
  hz: number
  h: number
  color: number
}

const TOWERS: Tower[] = [
  { x: -26, z: -20, hx: 12, hz: 9, h: 38, color: 0x9aa3ad },
  { x: 28, z: -21, hx: 11, hz: 9, h: 52, color: 0xc8bfb0 },
  { x: -24, z: 20, hx: 12, hz: 8, h: 26, color: 0x7d8792 },
  { x: 24, z: 19, hx: 10, hz: 8, h: 33, color: 0xb7b1a4 },
  { x: -64, z: -20, hx: 5, hz: 8, h: 16, color: 0x8e99a3 },
  { x: 64, z: 18, hx: 5, hz: 7, h: 18, color: 0xd5cfc2 },
  { x: -24, z: -54, hx: 10, hz: 4.5, h: 14, color: 0x6e7882 },
  { x: 22, z: -54, hx: 9, hz: 4.5, h: 20, color: 0xaeb6bf },
  { x: -22, z: 54, hx: 9, hz: 4.5, h: 12, color: 0x8a8478 },
  { x: 26, z: 54, hx: 8, hz: 4.5, h: 15, color: 0x9aa7b4 },
  { x: 40, z: -30, hx: 3, hz: 3, h: 22, color: 0x5e6872 },
  { x: -40, z: 28, hx: 3, hz: 3, h: 18, color: 0xcfc6b8 },
]

function inside(rect: MapRect, x: number, z: number, pad = 0): boolean {
  return Math.abs(x - rect.x) <= rect.hx + pad && Math.abs(z - rect.z) <= rect.hz + pad
}

function onRoad(x: number, z: number, pad = 0): boolean {
  return ROADS.some((road) => inside(road, x, z, pad))
}

function inWater(x: number, z: number): boolean {
  return inside(WATER, x, z)
}

function labelTexture(text: string, fg: string, bg: string, w = 512, h = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = fg
  ctx.font = `700 ${Math.floor(h * 0.42)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2 + 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function windowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.fillStyle = '#243140'
  ctx.fillRect(0, 0, 128, 128)
  for (let y = 8; y < 122; y += 22) {
    for (let x = 8; x < 122; x += 18) {
      const lit = ((x * 13 + y * 7) % 17) > 4
      ctx.fillStyle = lit ? '#f3e2b0' : '#1b2836'
      ctx.fillRect(x, y, 10, 14)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

function waterTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.fillStyle = '#1a6486'
  ctx.fillRect(0, 0, 128, 64)
  ctx.strokeStyle = 'rgba(186, 230, 238, 0.45)'
  ctx.lineWidth = 2
  for (let row = 0; row < 8; row += 1) {
    ctx.beginPath()
    const y = 4 + row * 8
    ctx.moveTo(0, y)
    for (let x = 0; x <= 128; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.18 + row) * 2.2)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(14, 2)
  return texture
}

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface World {
  colliders: Aabb[]
  obstacles: THREE.Object3D[]
  roads: MapRect[]
  buildings: MapRect[]
  water: MapRect
  surfaceAt(x: number, z: number): Surface
  placeAt(x: number, z: number): string
  tick(dt: number): void
}

export function createWorld(scene: THREE.Scene): World {
  const colliders: Aabb[] = []
  const obstacles: THREE.Object3D[] = []
  const buildings: MapRect[] = []

  const grass = new THREE.MeshStandardMaterial({ color: 0x3f7a45, roughness: 1 })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(440, 340), grass)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  const waterMap = waterTexture()
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: waterMap,
    roughness: 0.22,
    metalness: 0.35,
  })
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WATER.hx * 2, WATER.hz * 2), waterMat)
  water.rotation.x = -Math.PI / 2
  water.position.set(WATER.x, 0.02, WATER.z)
  water.receiveShadow = true
  scene.add(water)

  const asphalt = new THREE.MeshStandardMaterial({ color: 0x32363c, roughness: 0.94, metalness: 0.02 })
  const whiteMark = new THREE.MeshBasicMaterial({ color: 0xf3f1ea })
  const yellowMark = new THREE.MeshBasicMaterial({ color: 0xe6b325 })

  const addCollider = (box: Aabb, obstacle?: THREE.Object3D) => {
    colliders.push(box)
    if (obstacle) obstacles.push(obstacle)
  }

  for (const road of ROADS) {
    const highway = Math.min(road.hx, road.hz) >= 8.5
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(road.hx * 2, 0.1, road.hz * 2), asphalt)
    mesh.position.set(road.x, highway ? 0.05 : 0.065, road.z)
    mesh.receiveShadow = true
    scene.add(mesh)
  }

  const marks: Array<{ x: number; z: number; rot: number; sx: number; sz: number }> = []
  const pushDash = (x: number, z: number, alongX: boolean) => {
    marks.push({ x, z, rot: alongX ? 0 : Math.PI / 2, sx: 2.6, sz: 1 })
  }

  const addSolid = (x: number, z: number, length: number, alongX: boolean, yellow: boolean) => {
    const geo = alongX
      ? new THREE.BoxGeometry(length, 0.02, yellow ? 0.16 : 0.18)
      : new THREE.BoxGeometry(yellow ? 0.16 : 0.18, 0.02, length)
    const mesh = new THREE.Mesh(geo, yellow ? yellowMark : whiteMark)
    mesh.position.set(x, 0.13, z)
    mesh.receiveShadow = true
    scene.add(mesh)
  }

  for (const road of ROADS) {
    const alongX = road.hx >= road.hz
    const highway = Math.min(road.hx, road.hz) >= 8.5
    const span = (alongX ? road.hx : road.hz) * 2 - 4
    const lateral = alongX ? road.hz : road.hx
    if (highway) {
      if (alongX) {
        addSolid(road.x, road.z - 0.22, span, true, true)
        addSolid(road.x, road.z + 0.22, span, true, true)
      } else {
        addSolid(road.x - 0.22, road.z, span, false, true)
        addSolid(road.x + 0.22, road.z, span, false, true)
      }
      const lane = lateral * 0.5
      for (let d = -span / 2 + 2; d < span / 2 - 2; d += 7) {
        if (alongX) {
          pushDash(road.x + d, road.z - lane, true)
          pushDash(road.x + d, road.z + lane, true)
        } else {
          pushDash(road.x - lane, road.z + d, false)
          pushDash(road.x + lane, road.z + d, false)
        }
      }
    } else {
      for (let d = -span / 2 + 2; d < span / 2 - 2; d += 7) {
        if (alongX) pushDash(road.x + d, road.z, true)
        else pushDash(road.x, road.z + d, false)
      }
    }
    const edge = lateral - 0.45
    if (alongX) {
      addSolid(road.x, road.z - edge, span, true, false)
      addSolid(road.x, road.z + edge, span, true, false)
    } else {
      addSolid(road.x - edge, road.z, span, false, false)
      addSolid(road.x + edge, road.z, span, false, false)
    }
  }

  if (marks.length > 0) {
    const dashes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.02, 0.14),
      whiteMark,
      marks.length,
    )
    const dummy = new THREE.Object3D()
    marks.forEach((mark, index) => {
      dummy.position.set(mark.x, 0.13, mark.z)
      dummy.rotation.set(0, mark.rot, 0)
      dummy.scale.set(mark.sx, 1, mark.sz)
      dummy.updateMatrix()
      dashes.setMatrixAt(index, dummy.matrix)
    })
    dashes.instanceMatrix.needsUpdate = true
    dashes.receiveShadow = true
    scene.add(dashes)
  }

  const facadeTex = windowTexture()
  const addBuilding = (tower: Tower) => {
    const map = facadeTex.clone()
    map.needsUpdate = true
    map.repeat.set(Math.max(1, (tower.hx * 2) / 6), Math.max(1, tower.h / 5))
    const walls = new THREE.MeshStandardMaterial({
      color: tower.color,
      map,
      roughness: 0.78,
      metalness: 0.04,
      emissive: 0xffe1a8,
      emissiveMap: map,
      emissiveIntensity: 0.28,
    })
    const body = new THREE.Mesh(new THREE.BoxGeometry(tower.hx * 2, tower.h, tower.hz * 2), walls)
    body.position.set(tower.x, tower.h / 2, tower.z)
    body.castShadow = true
    body.receiveShadow = true
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(tower.hx * 2 + 0.3, 0.45, tower.hz * 2 + 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.8 }),
    )
    roof.position.y = tower.h / 2 + 0.1
    roof.castShadow = true
    body.add(roof)
    scene.add(body)
    buildings.push({ x: tower.x, z: tower.z, hx: tower.hx, hz: tower.hz })
    addCollider(
      {
        minX: tower.x - tower.hx,
        maxX: tower.x + tower.hx,
        minZ: tower.z - tower.hz,
        maxZ: tower.z + tower.hz,
      },
      body,
    )
  }

  for (const tower of TOWERS) addBuilding(tower)

  addBuilding({ x: -90, z: -58, hx: 15, hz: 8, h: 12, color: 0xd9d4c8 })
  addBuilding({ x: 94, z: 58, hx: 14, hz: 8, h: 7, color: 0x6d6258 })
  addBuilding({ x: 126, z: 58, hx: 7, hz: 6, h: 5, color: 0xc4553a })

  const steel = new THREE.MeshStandardMaterial({ color: 0x8d939a, metalness: 0.65, roughness: 0.38 })

  const addSign = (text: string, x: number, y: number, z: number, rotY: number, w: number, h: number, fg = '#f4f7fb', bg = '#1b2430') => {
    const mat = new THREE.MeshBasicMaterial({ map: labelTexture(text, fg, bg, 512, 160), side: THREE.DoubleSide })
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
    board.position.set(x, y, z)
    board.rotation.y = rotY
    scene.add(board)
    return board
  }

  const gantryX = 36
  const postZs = [87.6, 112.4]
  for (const z of postZs) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.55, 8, 0.55), steel)
    post.position.set(gantryX, 4, z)
    post.castShadow = true
    scene.add(post)
    addCollider(
      { minX: gantryX - 0.45, maxX: gantryX + 0.45, minZ: z - 0.45, maxZ: z + 0.45 },
      post,
    )
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 26.4), steel)
  beam.position.set(gantryX, 7.7, 100)
  beam.castShadow = true
  scene.add(beam)
  obstacles.push(beam)
  addSign('NORTH LOOP', gantryX - 0.28, 6.35, 100, -Math.PI / 2, 12, 1.5)
  addSign('NORTH LOOP', gantryX + 0.28, 6.35, 100, Math.PI / 2, 12, 1.5)

  addSign('POLICE PLAZA', -90, 3.2, -48.6, 0, 6.5, 1.15, '#1b2430', '#f4f1e6')
  const plazaPost = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.2, 0.18), steel)
  plazaPost.position.set(-90, 1.6, -48.6)
  scene.add(plazaPost)

  addSign('WESTBROOK GARAGE', 94, 2.6, 67.2, 0, 6.2, 1.05, '#f6f3ea', '#3a342c')
  const garagePost = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 0.16), steel)
  garagePost.position.set(94, 1.3, 67.2)
  scene.add(garagePost)

  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.28, 12),
    new THREE.MeshStandardMaterial({ color: 0xd24a32, roughness: 0.55, metalness: 0.2 }),
  )
  canopy.position.set(126, 3.45, 76)
  canopy.castShadow = true
  scene.add(canopy)
  const poleSpots = [
    [119, 71],
    [133, 71],
    [119, 81],
    [133, 81],
  ]
  for (const [x, z] of poleSpots) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 3.4, 8), steel)
    pole.position.set(x, 1.7, z)
    pole.castShadow = true
    scene.add(pole)
    addCollider({ minX: x - 0.28, maxX: x + 0.28, minZ: z - 0.28, maxZ: z + 0.28 }, pole)
  }
  addSign('MERIDIAN FUEL', 126, 3.15, 82.2, 0, 5.4, 0.9, '#fff8ee', '#9d2e22')

  addSign('HARBOR', -42, 2.4, -64, 0, 3.4, 0.85, '#e8f6fb', '#16485f')
  const harborPost = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.4, 6), steel)
  harborPost.position.set(-42, 1.2, -64)
  scene.add(harborPost)

  const railMat = new THREE.MeshStandardMaterial({ color: 0xb9b3a8, roughness: 0.72, metalness: 0.15 })
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.05, 24), railMat)
    rail.position.set(side * 7.25, 0.62, -78)
    rail.castShadow = true
    rail.receiveShadow = true
    scene.add(rail)
    const minX = side < 0 ? -8 : 6.5
    const maxX = side < 0 ? -6.5 : 8
    addCollider({ minX, maxX, minZ: -90, maxZ: -66 }, rail)
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6e747c, roughness: 0.88 })
  const walls: Array<{ x: number; z: number; w: number; d: number; box: Aabb }> = [
    { x: -181.2, z: 0, w: 2.4, d: 264, box: { minX: -200, maxX: -180, minZ: -150, maxZ: 150 } },
    { x: 181.2, z: 0, w: 2.4, d: 264, box: { minX: 180, maxX: 200, minZ: -150, maxZ: 150 } },
    { x: 0, z: -131.2, w: 364, d: 2.4, box: { minX: -180, maxX: 180, minZ: -150, maxZ: -130 } },
    { x: 0, z: 131.2, w: 364, d: 2.4, box: { minX: -180, maxX: 180, minZ: 130, maxZ: 150 } },
  ]
  for (const wall of walls) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(wall.w, 3.4, wall.d), wallMat)
    mesh.position.set(wall.x, 1.7, wall.z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
    addCollider(wall.box, mesh)
  }

  const blocked = (x: number, z: number, pad: number) => {
    if (onRoad(x, z, pad) || inWater(x, z)) return true
    return colliders.some(
      (box) => x > box.minX - pad && x < box.maxX + pad && z > box.minZ - pad && z < box.maxZ + pad,
    )
  }

  const parkedColors = [0x8899aa, 0xc45c26, 0xdedede, 0x35507a, 0x22262b, 0x6e8f72]
  const parkSpots = [
    [86, 76],
    [90.2, 76],
    [94.4, 76],
    [98.6, 76],
    [86, 82.4],
    [90.2, 82.4],
  ]
  parkSpots.forEach(([x, z], index) => {
    const color = parkedColors[index % parkedColors.length]
    const heading = index < 4 ? 0 : Math.PI
    addParkedCar(scene, obstacles, colliders, x, z, heading, color)
  })

  const rand = mulberry32(23)
  const trees: Array<[number, number, number]> = []
  for (let i = 0; i < 140 && trees.length < 46; i += 1) {
    const x = -165 + rand() * 330
    const z = -120 + rand() * 235
    if (blocked(x, z, 3.2)) continue
    if (trees.some(([tx, tz]) => (tx - x) ** 2 + (tz - z) ** 2 < 81)) continue
    trees.push([x, z, 0.85 + rand() * 0.5])
  }

  if (trees.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1.5, 6)
    const leafGeo = new THREE.ConeGeometry(1.35, 2.8, 7)
    const trunks = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.92 }),
      trees.length,
    )
    const leaves = new THREE.InstancedMesh(
      leafGeo,
      new THREE.MeshStandardMaterial({ color: 0x2f6d3c, roughness: 0.86 }),
      trees.length,
    )
    const dummy = new THREE.Object3D()
    trees.forEach(([x, z, scale], index) => {
      dummy.position.set(x, 0.75, z)
      dummy.scale.set(scale, scale, scale)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      trunks.setMatrixAt(index, dummy.matrix)
      dummy.position.set(x, 2.15 * scale, z)
      dummy.scale.set(scale, scale, scale)
      dummy.updateMatrix()
      leaves.setMatrixAt(index, dummy.matrix)
      addCollider({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4 })
    })
    trunks.instanceMatrix.needsUpdate = true
    leaves.instanceMatrix.needsUpdate = true
    trunks.castShadow = true
    leaves.castShadow = true
    scene.add(trunks, leaves)
    obstacles.push(trunks, leaves)
  }

  const lampMat = new THREE.MeshStandardMaterial({ color: 0x5d646c, metalness: 0.5, roughness: 0.45 })
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffd7a1,
    emissive: 0xffc56b,
    emissiveIntensity: 2.4,
  })
  const addLamp = (x: number, z: number, rot: number) => {
    const group = new THREE.Group()
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5.6, 6), lampMat)
    pole.position.y = 2.8
    pole.castShadow = true
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.07), lampMat)
    arm.position.set(0.7, 5.55, 0)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), bulbMat)
    bulb.position.set(1.35, 5.42, 0)
    group.add(pole, arm, bulb)
    group.position.set(x, 0, z)
    group.rotation.y = rot
    scene.add(group)
  }

  const lampLine = (x0: number, z0: number, x1: number, z1: number, step: number, rot: number) => {
    const dx = x1 - x0
    const dz = z1 - z0
    const len = Math.hypot(dx, dz)
    const ux = dx / len
    const uz = dz / len
    for (let d = 10; d < len - 6; d += step) {
      const x = x0 + ux * d
      const z = z0 + uz * d
      if (blocked(x, z, 0.8)) continue
      addLamp(x, z, rot)
    }
  }

  lampLine(-140, -112, 140, -112, 34, -Math.PI / 2)
  lampLine(-140, 114, 140, 114, 34, Math.PI / 2)
  lampLine(162, -80, 162, 80, 32, Math.PI)
  lampLine(-162, -80, -162, 80, 32, 0)
  lampLine(-70, -48, 70, -48, 28, -Math.PI / 2)
  lampLine(-70, 48, 70, 48, 28, Math.PI / 2)

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(6.5, 3.2, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.7 }),
  )
  door.position.set(94, 1.7, 66.15)
  scene.add(door)

  return {
    colliders,
    obstacles,
    roads: ROADS,
    buildings,
    water: WATER,
    surfaceAt(x, z) {
      if (onRoad(x, z)) return 'road'
      if (inWater(x, z)) return 'water'
      return 'grass'
    },
    placeAt(x, z) {
      const plaza = (x + 90) ** 2 + (z + 58) ** 2
      const fuel = (x - 126) ** 2 + (z - 70) ** 2
      const garage = (x - 94) ** 2 + (z - 62) ** 2
      if (plaza < 26 * 26) return 'Police Plaza'
      if (fuel < 20 * 20) return 'Meridian Fuel'
      if (garage < 22 * 22) return 'Westbrook Garage'
      const surface = onRoad(x, z) ? 'road' : inWater(x, z) ? 'water' : 'grass'
      if (surface === 'water' || (Math.abs(x) < 18 && z <= -66 && z >= -92)) return 'Harbor River'
      if (Math.abs(x) < 76 && Math.abs(z) < 66) return 'Downtown'
      const onLoop =
        (Math.abs(z + 100) <= 9 && Math.abs(x) <= 155) ||
        (Math.abs(z - 100) <= 9 && Math.abs(x) <= 155) ||
        (Math.abs(x - 150) <= 9 && Math.abs(z) <= 100) ||
        (Math.abs(x + 150) <= 9 && Math.abs(z) <= 100)
      if (onLoop) return 'North Loop'
      if (surface === 'grass') return 'Off road'
      return 'New Meridian'
    },
    tick(dt: number) {
      waterMap.offset.x += dt * 0.02
    },
  }
}

function addParkedCar(
  scene: THREE.Scene,
  obstacles: THREE.Object3D[],
  colliders: Aabb[],
  x: number,
  z: number,
  heading: number,
  color: number,
) {
  const length = 4.4
  const width = 1.78
  const group = new THREE.Group()
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.45 })
  const glass = new THREE.MeshStandardMaterial({
    color: 0x1c2836,
    roughness: 0.15,
    metalness: 0.7,
  })
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, 0.7, length), paint)
  body.position.y = 0.72
  body.castShadow = true
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(width * 0.86, 0.55, length * 0.46), glass)
  cabin.position.set(0, 1.2, -0.1)
  cabin.castShadow = true
  group.add(body, cabin)
  group.position.set(x, 0.02, z)
  group.rotation.y = heading
  scene.add(group)
  obstacles.push(group)

  const hx = Math.abs(Math.cos(heading)) * (width / 2) + Math.abs(Math.sin(heading)) * (length / 2)
  const hz = Math.abs(Math.sin(heading)) * (width / 2) + Math.abs(Math.cos(heading)) * (length / 2)
  colliders.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz })
}
