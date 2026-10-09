import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { TOKEN_IMAGE_FALLBACK, tokenImageError } from './token-image-error.ts'

test('shows only recognized, user-safe API portrait errors', () => {
  for (const [status, message] of [
    [403, 'Você não pode alterar a imagem deste token.'],
    [400, 'A imagem deve ter no máximo 2 MB.'],
    [400, 'Use uma imagem PNG, JPG ou WebP.'],
    [400, 'Não foi possível processar esta imagem.'],
    [404, 'Token não encontrado.'],
  ]) assert.equal(tokenImageError(status, { message }), message)
})

test('handles non-JSON responses and never exposes internal messages', () => {
  assert.equal(tokenImageError(413, null), 'A imagem deve ter no máximo 2 MB.')
  assert.equal(tokenImageError(403, null), TOKEN_IMAGE_FALLBACK)
  assert.equal(tokenImageError(500, { message: 'database stack trace' }), TOKEN_IMAGE_FALLBACK)
  assert.equal(tokenImageError(400, { message: 'internal validation error' }), TOKEN_IMAGE_FALLBACK)
})

test('portrait flow validates before fetch and presents errors beside the relevant action', async () => {
  const source = await readFile(new URL('../components/Grid.tsx', import.meta.url), 'utf8')
  assert.match(source, /file\.size > 2 \* 1024 \* 1024/)
  assert.match(source, /file\.type && !\['image\/png', 'image\/jpeg', 'image\/webp'\]/)
  assert.match(source, /if \(!response\.ok\) \{ setPortraitError\(tokenImageError\(response\.status, result\)\); return \}/)
  assert.match(source, /portraitError && \(!tokenEditor \|\| imageTargetTokenIdRef\.current !== tokenEditor\.tokenId\) && <p role="alert" className=\{styles\.portraitError\}>/)
  assert.match(source, /myOwnToken && <button/)
  assert.match(source, /\(tokenEditor\.isOwn && !isHost\) \|\| \(isHost && tokenEditor\.kind === 'SCENERY'\)/)
  assert.match(source, /imageTargetTokenIdRef\.current = tokenEditor\.tokenId/)
  assert.match(source, /portraitError && imageTargetTokenIdRef\.current === tokenEditor\.tokenId && <p role="alert"/)
  assert.match(source, /'Trocar imagem'/)
})
