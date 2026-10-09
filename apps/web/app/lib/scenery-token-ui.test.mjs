import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('existing token editor offers confirmed deletion only for host scenery tokens', async () => {
  const source = await readFile(new URL('../components/Grid.tsx', import.meta.url), 'utf8')
  assert.match(source, /isHost && tokenEditor\.kind === 'SCENERY' && <div/)
  assert.match(source, /Deseja excluir este token do cenário\?/)
  assert.match(source, /<button onClick=\{handleDeleteToken\} disabled=\{deletingToken\}/)
  assert.match(source, /tokenEditorError && <p role="alert"/)
})

test('successful deletion and room-scoped socket event remove token without refresh', async () => {
  const source = await readFile(new URL('../components/Grid.tsx', import.meta.url), 'utf8')
  assert.match(source, /socket\.on\('token-deleted', \(data: \{ tokenId: string \}\) => removeTokenById\(data\.tokenId\)\)/)
  assert.match(source, /token\.graphics\.destroy\(\{ children: true \}\)/)
  assert.match(source, /tokensRef\.current\.delete\(playerId\)/)
  assert.match(source, /setTokenEditor\(current => current\?\.tokenId === tokenId \? null : current\)/)
  assert.match(source, /if \(response\.status === 404\) \{ removeTokenById\(tokenId\); return \}/)
})

test('NPC name is edited in the existing modal and redrawn when the room receives an update', async () => {
  const source = await readFile(new URL('../components/Grid.tsx', import.meta.url), 'utf8')
  assert.match(source, /kind: token\.kind,\s+name: token\.playerName/)
  assert.match(source, /tokenEditor\.kind === 'SCENERY' && <label/)
  assert.match(source, /<input type="text" maxLength=\{80\} value=\{tokenEditor\.name\}/)
  assert.match(source, /method: 'PATCH'/)
  assert.match(source, /token\.nameText\.text = name/)
  assert.match(source, /socket\.on\('token-name-updated'/)
  assert.match(source, /setTokenEditor\(null\)/)
})
