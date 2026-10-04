import crypto from 'crypto'
import { isSessionClaims } from './auth-security'

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET || ''
  if (!s) throw new Error('SESSION_SECRET env var não definida')
  return s
}

/** Verifica assinatura e retorna o payload, ou null se inválido/adulterado */
export function verifySession(token: string): Record<string, unknown> | null {
  if (typeof token !== 'string' || token.length > 4096) return null
  const dot = token.lastIndexOf('.')
  if (dot === -1) return null
  const data = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  try {
    const expected = crypto.createHmac('sha256', secret()).update(data).digest('base64url')
    const sigBuf = Buffer.from(sig, 'base64url')
    const expBuf = Buffer.from(expected, 'base64url')
    if (sigBuf.length !== expBuf.length) return null
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null
    const claims = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
    return isSessionClaims(claims) ? claims : null
  } catch {
    return null
  }
}
