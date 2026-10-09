import test from 'node:test'
import assert from 'node:assert/strict'
import { lastValidTokenCell, movementSegments, tokenHudLayout, tokenRadius, tokenSize, validTokenMove, validTokenPosition } from './token-movement.ts'
import { readFile } from 'node:fs/promises'

const wall = openings => ({ x1: 5, y1: 0, x2: 5, y2: 10, openings })
const door = { id: 'door', type: 'door', position: .5, width: .3, isOpen: true }

test('old tokens default to one configured grid cell and larger NPCs scale with it', () => {
  assert.equal(tokenSize(undefined), 1)
  assert.equal(tokenRadius(1, 10) * 50 * 2, 50)
  assert.equal(tokenRadius(2, 10) * 50 * 2, 100)
  assert.equal(tokenRadius(1, 20) * 50 * 2, 25)
  const small = tokenHudLayout(1, 10), large = tokenHudLayout(2, 10)
  assert.equal(small.radius, 25)
  assert.equal(large.radius, 50)
  assert.equal(large.nameY - small.nameY, 25)
  assert.equal(large.hpY - small.hpY, 25)
  assert.equal(large.hpWidth, small.hpWidth * 2)
})

test('the existing modal edits NPC size and the HUD does not intercept pointer input', async () => {
  const source = await readFile(new URL('../components/Grid.tsx', import.meta.url), 'utf8')
  assert.match(source, /Tamanho em células/)
  assert.match(source, /TOKEN_SIZES\.map\(size => <option/)
  assert.match(source, /nameText\.eventMode = 'none'/)
  assert.match(source, /hpBar\.eventMode = 'none'/)
  assert.match(source, /socket\.on\('token-size-updated'/)
  assert.match(source, /lastValidTokenCell\(token, \{ x: cx, y: cy \}/)
  assert.match(source, /event\.pointerType === 'touch'/)
  assert.match(source, /longPressRef\.current = setTimeout/)
})

test('movement and audio share the solid wall segments while openings have physical rules', () => {
  const from = { x: 3, y: 5 }, to = { x: 7, y: 5 }
  assert.equal(validTokenMove(from, to, 1, 10, movementSegments([wall([])])), false)
  assert.equal(validTokenMove(from, to, 1, 10, movementSegments([wall([{ ...door, isOpen: false }])])), false)
  assert.equal(validTokenMove(from, to, 1, 10, movementSegments([wall([{ ...door, type: 'window' }])])), false)
  assert.equal(validTokenMove(from, to, 1, 10, movementSegments([wall([door])])), true)
  assert.equal(validTokenMove(from, to, 1, 10, movementSegments([{ ...wall([]), isDoor: true, isOpen: false }])), false)
  assert.equal(validTokenMove(from, to, 1, 10, movementSegments([{ ...wall([]), isDoor: true, isOpen: true }])), true)
  assert.equal(validTokenMove({ x: 3, y: 8 }, { x: 7, y: 8 }, 1, 10, movementSegments([wall([door])])), false)
  assert.equal(validTokenPosition({ x: .5, y: 5 }, 2, 10, []), false)
  assert.deepEqual(lastValidTokenCell({ x: 2, y: 4 }, { x: 7, y: 4 }, 1, 10, movementSegments([wall([])]), () => false), { x: 4, y: 4 })
  assert.deepEqual(lastValidTokenCell({ x: 2, y: 4 }, { x: 7, y: 4 }, 1, 10, movementSegments([wall([door])]), () => false), { x: 7, y: 4 })
})
