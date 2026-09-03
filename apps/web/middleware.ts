import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Edge runtime usa Web Crypto — não pode importar Node.js crypto
async function isValidSession(value: string): Promise<boolean> {
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
    return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data))
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest) {
  const session = request.cookies.get('user-session')
  const authenticated = session?.value ? await isValidSession(session.value) : false

  if (!authenticated) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/room/:path*'],
}
