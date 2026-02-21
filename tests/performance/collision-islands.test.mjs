/**
 * Collision Test — Island Navigation
 *
 * Reproduces the exact collision logic from Controls.tsx and tests
 * that a player can navigate smoothly around the two island shelves
 * without getting stuck on corners or edges.
 *
 * Usage: node --test tests/performance/collision-islands.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'

// ── Constants from Controls.tsx ─────────────────────────
const ROOM_WIDTH = 9
const ROOM_DEPTH = 8.5
const COLLISION_MARGIN = 0.07

const COLLISION_ZONES = [
  {
    minX: ROOM_WIDTH / 2 - 2.3 - 1.35 - 0.3,
    maxX: ROOM_WIDTH / 2 - 2.3 + 1.35 + 0.3,
    minZ: ROOM_DEPTH / 2 - 1.28 - 0.5,
    maxZ: ROOM_DEPTH / 2 - 1.28 + 0.5,
    name: 'comptoir',
    cornerRadius: 0.3,
  },
  {
    minX: -1.6 - 0.68,
    maxX: -1.6 + 0.68,
    minZ: -1.02,
    maxZ: 1.02,
    name: 'ilot',
    cornerRadius: 0.65,
  },
  {
    minX: 0.65 - 0.68,
    maxX: 0.65 + 0.68,
    minZ: -0.3 - 1.02,
    maxZ: -0.3 + 1.02,
    name: 'ilot2',
    cornerRadius: 0.65,
  },
]

// ── Collision function (exact copy from Controls.tsx) ────
function checkCollision(x, z, margin) {
  for (const zone of COLLISION_ZONES) {
    const expandedMinX = zone.minX - margin
    const expandedMaxX = zone.maxX + margin
    const expandedMinZ = zone.minZ - margin
    const expandedMaxZ = zone.maxZ + margin

    if (x < expandedMinX || x > expandedMaxX || z < expandedMinZ || z > expandedMaxZ) {
      continue
    }

    const r = zone.cornerRadius ?? 0
    if (r > 0) {
      const innerMinX = expandedMinX + r
      const innerMaxX = expandedMaxX - r
      const innerMinZ = expandedMinZ + r
      const innerMaxZ = expandedMaxZ - r

      if ((x < innerMinX || x > innerMaxX) && (z < innerMinZ || z > innerMaxZ)) {
        const cx = x < innerMinX ? innerMinX : innerMaxX
        const cz = z < innerMinZ ? innerMinZ : innerMaxZ
        const dx = x - cx
        const dz = z - cz
        if (dx * dx + dz * dz > r * r) {
          continue
        }
      }
    }

    return zone.name
  }
  return null
}

const collisionDist = 0.5 * COLLISION_MARGIN * 10  // 0.25m

// ── Helper: simulate walking along a path ───────────────
// Returns { blocked, blockedAt, path } — moves in small steps,
// stops when collision prevents next step
function walkPath(startX, startZ, endX, endZ, steps = 100) {
  const dx = (endX - startX) / steps
  const dz = (endZ - startZ) / steps
  let x = startX, z = startZ
  const walked = []

  for (let i = 0; i < steps; i++) {
    const nextX = x + dx
    const nextZ = z + dz
    const hit = checkCollision(nextX, nextZ, collisionDist)
    if (hit) {
      return { blocked: true, blockedAt: { x: nextX, z: nextZ, step: i, zone: hit }, walked }
    }
    x = nextX
    z = nextZ
    walked.push({ x, z })
  }
  return { blocked: false, blockedAt: null, walked }
}

// ── Helper: walk around an obstacle (series of waypoints) ──
function walkWaypoints(waypoints) {
  const results = []
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [sx, sz] = waypoints[i]
    const [ex, ez] = waypoints[i + 1]
    const result = walkPath(sx, sz, ex, ez)
    results.push({
      from: waypoints[i],
      to: waypoints[i + 1],
      ...result,
    })
    if (result.blocked) break
  }
  return results
}

// ── Island centers and bounds for reference ──────────────
const ILOT1 = { cx: -1.6, cz: 0, halfX: 0.68, halfZ: 1.02 }
const ILOT2 = { cx: 0.65, cz: -0.3, halfX: 0.68, halfZ: 1.02 }
const GAP_CENTER_X = (ILOT1.cx + ILOT1.halfX + ILOT2.cx - ILOT2.halfX) / 2
const GAP_WIDTH = (ILOT2.cx - ILOT2.halfX) - (ILOT1.cx + ILOT1.halfX)

// ── Test: gap between islands is wide enough ────────────
test('collision: gap between islands is passable', () => {
  const leftEdge = ILOT1.cx + ILOT1.halfX   // -0.92
  const rightEdge = ILOT2.cx - ILOT2.halfX  // -0.03
  const gap = rightEdge - leftEdge
  const passableGap = gap - 2 * collisionDist  // subtract player radius on each side

  console.log(`  Gap between islands: ${gap.toFixed(3)}m`)
  console.log(`  Passable gap (minus 2x collision): ${passableGap.toFixed(3)}m`)

  assert.ok(
    passableGap > 0.15,
    `Gap too narrow: ${passableGap.toFixed(3)}m passable (need >0.15m)`
  )
})

// ── Test: walk straight between the two islands (N→S) ───
test('collision: walk north-to-south between islands', () => {
  const x = GAP_CENTER_X
  const result = walkPath(x, -2.0, x, 2.0)

  if (result.blocked) {
    console.log(`  BLOCKED at x=${result.blockedAt.x.toFixed(3)}, z=${result.blockedAt.z.toFixed(3)} (zone: ${result.blockedAt.zone})`)
  } else {
    console.log(`  OK — passed through at x=${x.toFixed(3)}`)
  }

  assert.ok(!result.blocked, `Blocked between islands at z=${result.blockedAt?.z.toFixed(3)}`)
})

// ── Test: walk straight between the two islands (S→N) ───
test('collision: walk south-to-north between islands', () => {
  const x = GAP_CENTER_X
  const result = walkPath(x, 2.0, x, -2.0)

  assert.ok(!result.blocked, `Blocked between islands at z=${result.blockedAt?.z.toFixed(3)}`)
})

// ── Test: approach island 1 corners diagonally (should slide, not block) ──
test('collision: diagonal approach to ilot1 corners is not a dead-end', () => {
  const corners = [
    { name: 'NW', x: ILOT1.cx - ILOT1.halfX, z: ILOT1.cz - ILOT1.halfZ },
    { name: 'NE', x: ILOT1.cx + ILOT1.halfX, z: ILOT1.cz - ILOT1.halfZ },
    { name: 'SW', x: ILOT1.cx - ILOT1.halfX, z: ILOT1.cz + ILOT1.halfZ },
    { name: 'SE', x: ILOT1.cx + ILOT1.halfX, z: ILOT1.cz + ILOT1.halfZ },
  ]

  for (const corner of corners) {
    // Point just outside the corner (diagonal offset)
    const offset = collisionDist + 0.05  // just beyond collision range
    const dirX = corner.x > ILOT1.cx ? 1 : -1
    const dirZ = corner.z > ILOT1.cz ? 1 : -1
    const testX = corner.x + dirX * offset
    const testZ = corner.z + dirZ * offset

    const hit = checkCollision(testX, testZ, collisionDist)
    console.log(`  Ilot1 corner ${corner.name}: (${testX.toFixed(3)}, ${testZ.toFixed(3)}) → ${hit ? 'BLOCKED by ' + hit : 'free'}`)
    assert.equal(hit, null, `Corner ${corner.name} of ilot1 blocks diagonal approach`)
  }
})

// ── Test: approach island 2 corners diagonally ──────────
test('collision: diagonal approach to ilot2 corners is not a dead-end', () => {
  const corners = [
    { name: 'NW', x: ILOT2.cx - ILOT2.halfX, z: ILOT2.cz - ILOT2.halfZ },
    { name: 'NE', x: ILOT2.cx + ILOT2.halfX, z: ILOT2.cz - ILOT2.halfZ },
    { name: 'SW', x: ILOT2.cx - ILOT2.halfX, z: ILOT2.cz + ILOT2.halfZ },
    { name: 'SE', x: ILOT2.cx + ILOT2.halfX, z: ILOT2.cz + ILOT2.halfZ },
  ]

  for (const corner of corners) {
    const offset = collisionDist + 0.05
    const dirX = corner.x > ILOT2.cx ? 1 : -1
    const dirZ = corner.z > ILOT2.cz ? 1 : -1
    const testX = corner.x + dirX * offset
    const testZ = corner.z + dirZ * offset

    const hit = checkCollision(testX, testZ, collisionDist)
    console.log(`  Ilot2 corner ${corner.name}: (${testX.toFixed(3)}, ${testZ.toFixed(3)}) → ${hit ? 'BLOCKED by ' + hit : 'free'}`)
    assert.equal(hit, null, `Corner ${corner.name} of ilot2 blocks diagonal approach`)
  }
})

// ── Test: circumnavigate ilot1 (walk around it fully) ───
test('collision: can walk around ilot1 completely', () => {
  const pad = collisionDist + 0.15  // comfortable clearance
  const { cx, cz, halfX, halfZ } = ILOT1
  const waypoints = [
    [cx, cz - halfZ - pad],         // north
    [cx + halfX + pad, cz - halfZ - pad], // NE corner
    [cx + halfX + pad, cz],          // east center
    [cx + halfX + pad, cz + halfZ + pad], // SE corner
    [cx, cz + halfZ + pad],          // south
    [cx - halfX - pad, cz + halfZ + pad], // SW corner
    [cx - halfX - pad, cz],          // west center
    [cx - halfX - pad, cz - halfZ - pad], // NW corner
    [cx, cz - halfZ - pad],          // back to north
  ]

  const results = walkWaypoints(waypoints)
  const blocked = results.find(r => r.blocked)

  if (blocked) {
    console.log(`  BLOCKED: from (${blocked.from}) to (${blocked.to})`)
    console.log(`  At: x=${blocked.blockedAt.x.toFixed(3)}, z=${blocked.blockedAt.z.toFixed(3)} (${blocked.blockedAt.zone})`)
  } else {
    console.log(`  OK — full circumnavigation at ${pad.toFixed(2)}m clearance`)
  }

  assert.ok(!blocked, `Cannot walk around ilot1`)
})

// ── Test: circumnavigate ilot2 ──────────────────────────
test('collision: can walk around ilot2 completely', () => {
  const pad = collisionDist + 0.15
  const { cx, cz, halfX, halfZ } = ILOT2
  const waypoints = [
    [cx, cz - halfZ - pad],
    [cx + halfX + pad, cz - halfZ - pad],
    [cx + halfX + pad, cz],
    [cx + halfX + pad, cz + halfZ + pad],
    [cx, cz + halfZ + pad],
    [cx - halfX - pad, cz + halfZ + pad],
    [cx - halfX - pad, cz],
    [cx - halfX - pad, cz - halfZ - pad],
    [cx, cz - halfZ - pad],
  ]

  const results = walkWaypoints(waypoints)
  const blocked = results.find(r => r.blocked)

  if (blocked) {
    console.log(`  BLOCKED: from (${blocked.from}) to (${blocked.to})`)
    console.log(`  At: x=${blocked.blockedAt.x.toFixed(3)}, z=${blocked.blockedAt.z.toFixed(3)} (${blocked.blockedAt.zone})`)
  } else {
    console.log(`  OK — full circumnavigation at ${pad.toFixed(2)}m clearance`)
  }

  assert.ok(!blocked, `Cannot walk around ilot2`)
})

// ── Test: tight passage between islands at various Z ────
test('collision: tight passage between islands at multiple Z positions', () => {
  const leftEdge = ILOT1.cx + ILOT1.halfX + collisionDist
  const rightEdge = ILOT2.cx - ILOT2.halfX - collisionDist
  const midX = (leftEdge + rightEdge) / 2
  const failures = []

  // Test at 20 different Z positions through the overlap region
  const overlapMinZ = Math.max(ILOT1.cz - ILOT1.halfZ, ILOT2.cz - ILOT2.halfZ)
  const overlapMaxZ = Math.min(ILOT1.cz + ILOT1.halfZ, ILOT2.cz + ILOT2.halfZ)

  console.log(`  Overlap Z range: ${overlapMinZ.toFixed(3)} to ${overlapMaxZ.toFixed(3)}`)
  console.log(`  Passage X range: ${leftEdge.toFixed(3)} to ${rightEdge.toFixed(3)} (width ${(rightEdge - leftEdge).toFixed(3)}m)`)

  for (let i = 0; i <= 20; i++) {
    const z = overlapMinZ + (overlapMaxZ - overlapMinZ) * (i / 20)
    const hit = checkCollision(midX, z, collisionDist)
    if (hit) {
      failures.push({ z, hit })
    }
  }

  if (failures.length > 0) {
    for (const f of failures) {
      console.log(`  BLOCKED at center x=${midX.toFixed(3)}, z=${f.z.toFixed(3)} by ${f.hit}`)
    }
  } else {
    console.log(`  OK — center line passable at all 21 Z positions`)
  }

  assert.equal(failures.length, 0, `${failures.length} positions blocked in passage`)
})

// ── Test: rounded corners actually differ from square ───
test('collision: rounded corners create free zone vs square AABB', () => {
  // Test points at 45° diagonals from corner centers — these are INSIDE the
  // square AABB but OUTSIDE the rounded circle, so they should be FREE.
  let roundedFree = 0
  let totalCornerPoints = 0

  for (const zone of COLLISION_ZONES) {
    if (!zone.cornerRadius) continue
    const r = zone.cornerRadius
    const margin = collisionDist

    const expandedMinX = zone.minX - margin
    const expandedMaxX = zone.maxX + margin
    const expandedMinZ = zone.minZ - margin
    const expandedMaxZ = zone.maxZ + margin

    // The 4 corner circle centers
    const corners = [
      { cx: expandedMinX + r, cz: expandedMinZ + r, dx: -1, dz: -1 },
      { cx: expandedMaxX - r, cz: expandedMinZ + r, dx: 1, dz: -1 },
      { cx: expandedMinX + r, cz: expandedMaxZ - r, dx: -1, dz: 1 },
      { cx: expandedMaxX - r, cz: expandedMaxZ - r, dx: 1, dz: 1 },
    ]

    for (const { cx, cz, dx, dz } of corners) {
      // Sample at 45° at distances from r*1.05 to r*1.35 (outside circle, inside square)
      for (let dist = r * 1.05; dist <= r * 1.35; dist += r * 0.1) {
        const testX = cx + dx * dist * Math.cos(Math.PI / 4)
        const testZ = cz + dz * dist * Math.sin(Math.PI / 4)

        // Verify point is inside the AABB (otherwise it's not a valid test)
        if (testX >= expandedMinX && testX <= expandedMaxX &&
            testZ >= expandedMinZ && testZ <= expandedMaxZ) {
          totalCornerPoints++
          const hit = checkCollision(testX, testZ, collisionDist)
          if (!hit) roundedFree++
        }
      }
    }
  }

  console.log(`  Corner points tested: ${totalCornerPoints}`)
  console.log(`  Free due to rounding: ${roundedFree} (${((roundedFree / totalCornerPoints) * 100).toFixed(1)}%)`)

  assert.ok(
    roundedFree > 0,
    'Rounded corners should create free zones that square AABB would block'
  )
})

// ── Test: visual ASCII map of collision zones ───────────
test('collision: generate ASCII map of islands + passages', () => {
  const mapMinX = -3.5, mapMaxX = 2.5
  const mapMinZ = -2.5, mapMaxZ = 2.5
  const cols = 60, rows = 40

  const lines = []
  for (let row = 0; row < rows; row++) {
    const z = mapMinZ + (mapMaxZ - mapMinZ) * (row / rows)
    let line = ''
    for (let col = 0; col < cols; col++) {
      const x = mapMinX + (mapMaxX - mapMinX) * (col / cols)
      const hit = checkCollision(x, z, collisionDist)
      if (hit === 'ilot') line += '#'
      else if (hit === 'ilot2') line += '@'
      else if (hit === 'comptoir') line += 'C'
      else line += '.'
    }
    lines.push(line)
  }

  console.log('\n  Collision map (# = ilot1, @ = ilot2, C = comptoir, . = free):')
  console.log('  X: ' + mapMinX + ' → ' + mapMaxX + '  Z: ' + mapMinZ + ' → ' + mapMaxZ)
  for (const l of lines) {
    console.log('  ' + l)
  }

  // Just verify the map was generated (visual test)
  assert.ok(lines.length === rows, 'Map should have correct number of rows')
})
