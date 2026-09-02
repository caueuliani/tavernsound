import * as crypto from 'crypto'

function secret(): string {
  return process.env.SESSION_SECRET || ''
}

/** Verifica assinatura HMAC-SHA256 e retorna o payload, ou null se inválido */
export function verifySession(token: string): Record<string, unknown> | null {
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
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}
