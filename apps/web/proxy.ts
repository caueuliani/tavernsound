import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isSessionClaims } from './app/lib/auth-security'
import { allowTestRequest } from './app/lib/test-request-limit'

// Edge runtime usa Web Crypto — não pode importar Node.js crypto
async function isValidSession(value: string): Promise<boolean> {
  if (value.length > 4096) return false
  const s = process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET
  if (!s) return false

  const dot = value.lastIndexOf('.')
  if (dot === -1) return false
  const data = value.slice(0, dot)
  const sig = value.slice(dot + 1)

  try {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(s),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    // base64url → Uint8Array
    const sigBytes = Uint8Array.from(
      atob(sig.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0),
    )
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data))
    if (!valid) return false
    const payload = Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    return isSessionClaims(JSON.parse(new TextDecoder().decode(payload)))
  } catch {
    return false
  }
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    if (!allowTestRequest()) return NextResponse.json({ error: 'Limite de testes atingido. Aguarde um minuto.' }, { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } })
    return NextResponse.next()
  }
  const session = request.cookies.get('user-session')
  const authenticated = session?.value ? await isValidSession(session.value) : false

  if (!authenticated) {
    const loginUrl = new URL('/login', process.env.NEXTAUTH_URL || request.url)
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/rooms/:path*', '/room/:path*', '/api/:path*'],
}
