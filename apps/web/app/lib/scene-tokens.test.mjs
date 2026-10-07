import assert from 'node:assert/strict'
import test from 'node:test'
import { visibleSceneTokens } from './scene-tokens.ts'

test('the table renders only tokens assigned to its current scene', () => {
  const tokens = [
    { id: 'player-a', sceneId: 'a' },
    { id: 'npc-a', sceneId: 'a' },
    { id: 'player-b', sceneId: 'b' },
  ]
  assert.deepEqual(visibleSceneTokens(tokens, 'a').map(token => token.id), ['player-a', 'npc-a'])
  assert.deepEqual(visibleSceneTokens(tokens, 'b').map(token => token.id), ['player-b'])
})
