import test from 'node:test'
import assert from 'node:assert/strict'
import { readSceneSnapshot, sceneSnapshotPath } from './scene-snapshot.ts'

const valid = () => ({
  roomId: 'ABC123', sceneId: 'initial-ABC123', active: false,
  scene: { revision: 2, map: null, settings: { scale: 1, gridSize: 10 }, walls: [] },
  fogData: [true, false],
  tokens: [{ id: 'npc-1', sceneId: 'initial-ABC123', kind: 'SCENERY', x: 1, y: 2, color: '#ff9d00' }],
})

test('builds scene query without trusting a raw URL', () => {
  assert.equal(sceneSnapshotPath('ABC123', 'initial-ABC123'),
    '/rooms/ABC123/scene/snapshot?sceneId=initial-ABC123')
  assert.match(sceneSnapshotPath('ABC123', 'secret&other=true'), /sceneId=secret%26other%3Dtrue/)
})

test('accepts an exact room and scene snapshot', () => {
  assert.deepEqual(readSceneSnapshot(valid(), 'ABC123', 'initial-ABC123'), valid())
})

test('rejects foreign rooms, scenes and activation spoofing', () => {
  assert.throws(() => readSceneSnapshot(valid(), 'DEF456', 'initial-ABC123'), /outra cena/)
  assert.throws(() => readSceneSnapshot(valid(), 'ABC123', 'other-scene'), /outra cena/)
  assert.throws(() => readSceneSnapshot({ ...valid(), active: true }, 'ABC123', 'initial-ABC123'), /outra cena/)
})

test('rejects foreign tokens, missing state and malformed fog', () => {
  assert.throws(() => readSceneSnapshot({ ...valid(), tokens: [{ ...valid().tokens[0], sceneId: 'private' }] },
    'ABC123', 'initial-ABC123'), /tokens/)
  assert.throws(() => readSceneSnapshot({ ...valid(), fogData: [true, 'private'] },
    'ABC123', 'initial-ABC123'), /incompleto/)
  assert.throws(() => readSceneSnapshot({ ...valid(), scene: null },
    'ABC123', 'initial-ABC123'), /incompleto/)
})
