import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { addPolylinePoint, emptyPolyline, openingBounds, occlusionSegments, polylineShortcut, solidSegments, undoPolyline, validOpenings, wallOcclusionCount } from './scene-geometry.ts'

const wall = { id: 'wall', x1: 0, y1: 5, x2: 10, y2: 5, blocksAudio: true }
const door = { id: 'door', type: 'door', position: .5, width: .2, isOpen: true }
const crossing = x => ({ x1: x, y1: 4, x2: x, y2: 6 })

test('first pointer point starts a polyline; subsequent mouse or touch points make connected walls', () => {
  let state = emptyPolyline()
  const first = addPolylinePoint(state, { x: 0, y: 0 }, 'a')
  assert.equal(first.segment, null)
  state = first.polyline
  const second = addPolylinePoint(state, { x: 4, y: 0 }, 'ab')
  assert.deepEqual(second.segment, { x1: 0, y1: 0, x2: 4, y2: 0 })
  const third = addPolylinePoint(second.polyline, { x: 4, y: 4 }, 'bc')
  assert.deepEqual(third.segment, { x1: 4, y1: 0, x2: 4, y2: 4 })
  const fourth = addPolylinePoint(third.polyline, { x: 0, y: 4 }, 'cd')
  const closed = addPolylinePoint(fourth.polyline, { x: 0, y: 0 }, 'da')
  assert.deepEqual(closed.segment, { x1: 0, y1: 4, x2: 0, y2: 0 })
  assert.deepEqual(closed.polyline.segmentIds, ['ab', 'bc', 'cd', 'da'])
  assert.equal(emptyPolyline().start, null) // Escape and the visible Finish button use this reset.
})

test('Backspace removes only the most recent wall of the active polyline', () => {
  assert.equal(polylineShortcut('Backspace'), 'undo')
  const state = { start: { x: 4, y: 4 }, segmentIds: ['ab', 'bc'] }
  const result = undoPolyline(state, [
    { id: 'ab', x1: 0, y1: 0, x2: 4, y2: 0 },
    { id: 'bc', x1: 4, y1: 0, x2: 4, y2: 4 },
    { id: 'older', x1: 8, y1: 8, x2: 9, y2: 9 },
  ])
  assert.deepEqual(result.polyline.start, { x: 4, y: 0 })
  assert.deepEqual(result.walls.map(item => item.id), ['ab', 'older'])
})

test('Escape ends drawing while unrelated keys do not', () => {
  assert.equal(polylineShortcut('Escape'), 'finish')
  assert.equal(polylineShortcut('Enter'), null)
})

test('editor wires shared Pointer Events and visible touch completion controls', async () => {
  const source = await readFile(new URL('../components/SceneEditor.tsx', import.meta.url), 'utf8')
  assert.match(source, /onPointerDown=\{pointerDown\}/)
  assert.match(source, /onPointerMove=\{e => setHover\(point\(e\)\)\}/)
  assert.match(source, /onClick=\{finishPolyline\}>Finalizar/)
  assert.match(source, /onClick=\{undoLast\}>Desfazer último/)
})

test('an opening is attached to a wall and subtracts only its own interval', () => {
  const segments = solidSegments({ ...wall, openings: [door] })
  assert.deepEqual(openingBounds(door), [.4, .6])
  assert.deepEqual(segments.map(item => [item.x1, item.x2]), [[0, 4], [6, 10]])
  assert.equal(wallOcclusionCount(crossing(5), [{ ...wall, openings: [door] }]), 0)
  assert.equal(wallOcclusionCount(crossing(2), [{ ...wall, openings: [door] }]), 1)
})

test('a closed door occludes its gap; a window remains a visible, non-solid opening', () => {
  assert.equal(occlusionSegments({ ...wall, openings: [{ ...door, isOpen: false }] }).length, 3)
  assert.equal(wallOcclusionCount(crossing(5), [{ ...wall, openings: [{ ...door, isOpen: false }] }]), 1)
  assert.equal(wallOcclusionCount(crossing(5), [{ ...wall, openings: [{ ...door, type: 'window', isOpen: false }] }]), 0)
})

test('out-of-bounds and overlapping openings are rejected', () => {
  assert.equal(validOpenings([door]), true)
  assert.equal(validOpenings([{ ...door, position: .02 }]), false)
  assert.equal(validOpenings([door, { ...door, id: 'second', position: .55 }]), false)
})

test('old solid walls and whole-wall doors retain their previous acoustic behavior', () => {
  assert.equal(wallOcclusionCount(crossing(5), [wall]), 1)
  assert.equal(wallOcclusionCount(crossing(5), [{ ...wall, isDoor: true, isOpen: true }]), 0)
  assert.equal(wallOcclusionCount(crossing(5), [{ ...wall, isDoor: true, isOpen: false }]), 1)
})
