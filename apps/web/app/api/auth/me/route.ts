import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/session'

export async function GET() {
  const cookieStore = await cookies()
  const session = cookieStore.get('user-session')

  if (!session?.value) return NextResponse.json({ user: null })

  if (!verifySession(session.value)?.id) return NextResponse.json({ user: null })
  try {
    const response = await fetch(`${process.env.API_URL || 'http://localhost:3001'}/auth/me`, {
      headers: { cookie: `user-session=${encodeURIComponent(session.value)}` }, cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return NextResponse.json({ user: null }, { status: response.status })
    return NextResponse.json(await response.json(), { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 503 }) }
}
