import { NextResponse } from 'next/server'
import { trustedMutation } from '@/lib/auth-security'

export async function POST(request: Request) {
  if (!trustedMutation(request)) return NextResponse.json({ error: 'Origem não autorizada.' }, { status: 403 })
  try {
    const revoked = await fetch(`${process.env.API_URL || 'http://localhost:3001'}/auth/logout`, {
      method: 'POST', headers: { cookie: request.headers.get('cookie') || '' },
    })
    if (!revoked.ok) throw new Error('Falha ao revogar sessão')
  } catch {
    return NextResponse.json({ error: 'Não foi possível sair. Tente novamente.' }, { status: 503 })
  }
  const response = NextResponse.json({ success: true })
  response.cookies.set('user-session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
