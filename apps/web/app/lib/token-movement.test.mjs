import test from 'node:test'
import assert from 'node:assert/strict'
import { arrowDestination, isTypingTarget, keyboardToken, lastValidTokenCell, movementSegments, tokenCenter, tokenHudLayout, tokenRadius, tokenSize, validTokenMove, validTokenPosition } from './token-movement.ts'
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
  assert.match(source, /commitTokenMove\(token, \{ x: snapTokenCoordinate/)
  assert.match(source, /event\.pointerType === 'touch'/)
  assert.match(source, /longPressRef\.current = setTimeout/)
})

test('drag and arrows use one grid step, independent of token size', () => {
  for (const size of [4, 10, 20, 30, 40, 50, 100]) {
    const step = 10 / size
    const origin = Number((Math.round(4 / step) * step).toFixed(6))
    const from = { x: origin, y: origin }
    const directions = { ArrowRight: { x: origin + step, y: origin }, ArrowLeft: { x: origin - step, y: origin }, ArrowDown: { x: origin, y: origin + step }, ArrowUp: { x: origin, y: origin - step } }
    for (const [key, expected] of Object.entries(directions)) {
      const desired = arrowDestination(from, key, size)
      assert.deepEqual(desired, { x: Number(expected.x.toFixed(6)), y: Number(expected.y.toFixed(6)) })
      for (const tokenSize of size === 4 ? [1] : [1, 4]) {
        const actual = lastValidTokenCell(from, desired, tokenSize, size, [], () => false)
        assert.deepEqual(actual, desired)
      }
    }
  }
})

test('arrows share drag collision for walls, doors, windows and bounds', () => {
  const start = { x: 4.5, y: 4.5 }, step = arrowDestination(start, 'ArrowRight', 20)
  assert.deepEqual(lastValidTokenCell(start, step, 1, 20, movementSegments([wall([])]), () => false), start)
  assert.deepEqual(lastValidTokenCell(start, step, 1, 20, movementSegments([wall([{ ...door, isOpen: false }])]), () => false), start)
  assert.deepEqual(lastValidTokenCell(start, step, 1, 20, movementSegments([wall([{ ...door, type: 'window' }])]), () => false), start)
  assert.deepEqual(lastValidTokenCell(start, step, 1, 20, movementSegments([wall([door])]), () => false), step)
  assert.deepEqual(lastValidTokenCell({ x: 0, y: 2 }, { x: -.5, y: 2 }, 1, 20, [], () => false), { x: 0, y: 2 })
  assert.equal(validTokenPosition(tokenCenter(0, 2, 20), 4, 20, []), false)
})

test('keyboard movement is ignored in editable controls and the token modal', async () => {
  const original = globalThis.Element
  class ElementMock { constructor(tag) { this.tag = tag } closest() { return this.tag === 'div' ? null : this } }
  globalThis.Element = ElementMock
  try {
    for (const tag of ['input', 'textarea', 'select', 'contenteditable', 'dialog']) assert.equal(isTypingTarget(new ElementMock(tag)), true)
    assert.equal(isTypingTarget(new ElementMock('div')), false)
  } finally { globalThis.Element = original }
  const source = await readFile(new URL('../components/Grid.tsx', import.meta.url), 'utf8')
  assert.match(source, /isTypingTarget\(event\.target\) \|\| tokenEditorOpenRef\.current/)
  assert.match(source, /selectedTokenIdRef\.current/)
  assert.match(source, /keyboardToken\(tokensRef\.current\.values\(\), isHostRef\.current, selectedTokenIdRef\.current\)/)
  assert.match(source, /const canMoveToken = .*token\.kind === 'SCENERY'/)
  assert.match(source, /socket\.emit\('move-token'/)
})

test('player arrows choose only their personal token without selection; host requires selected NPC', () => {
  const own = { id: 'personal', kind: 'PLAYER', isOwn: true }
  const other = { id: 'other-player', kind: 'PLAYER', isOwn: false }
  const npc = { id: 'npc', kind: 'SCENERY', isOwn: false }
  const tokens = [other, npc, own]
  assert.equal(keyboardToken(tokens, false, null), own)
  assert.equal(keyboardToken(tokens, false, 'npc'), own)
  assert.equal(keyboardToken([other, npc], false, null), null)
  assert.equal(keyboardToken(tokens, true, null), null)
  assert.equal(keyboardToken(tokens, true, 'personal'), null)
  assert.equal(keyboardToken(tokens, true, 'other-player'), null)
  assert.equal(keyboardToken(tokens, true, 'npc'), npc)
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
