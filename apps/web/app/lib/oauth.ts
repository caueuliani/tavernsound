import { createHash, randomBytes, timingSafeEqual } from 'crypto'

export const OAUTH_COOKIE = 'tavern-google-oauth'
export const OAUTH_TTL = 600

export function createOAuthAttempt(returnTo: string) {
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  return {
    state,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    cookie: JSON.stringify({ provider: 'google', state, verifier, returnTo, expires: Date.now() + OAUTH_TTL * 1000 }),
  }
}

export function readOAuthAttempt(cookie: string | undefined, state: string | null) {
  try {
    if (!cookie || !state || cookie.length > 4096) return null
    const attempt = JSON.parse(cookie)
    if (attempt.provider !== 'google' || typeof attempt.state !== 'string' ||
        typeof attempt.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(attempt.verifier) ||
        !Number.isFinite(attempt.expires) || attempt.expires <= Date.now() ||
        attempt.expires > Date.now() + OAUTH_TTL * 1000) return null
    const actual = Buffer.from(state)
    const expected = Buffer.from(attempt.state)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
    return attempt as { verifier: string; returnTo: string }
  } catch { return null }
}

export const oauthCookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const,
  path: '/api/auth/google', maxAge: OAUTH_TTL,
}
