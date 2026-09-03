import { NextResponse } from 'next/server'
import { signSession } from '../../lib/session'

const API_URL = process.env.API_URL || 'http://localhost:3001'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params

  if (provider === 'credentials') {
    try {
      const body = await request.json()
      const { email, password, callbackUrl } = body

      if (!email || !password) {
        return NextResponse.json({ error: 'Email e senha são obrigatórios' }, { status: 400 })
      }

      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        return NextResponse.json(
          { error: data.error || 'Email ou senha incorretos', url: '/login?error=CredentialsSignin' },
          { status: 401 },
        )
      }

      if (data.success && data.user) {
        const redirect = callbackUrl || '/'
        const res = NextResponse.json({ success: true, url: redirect, user: data.user })
        res.cookies.set('user-session', signSession(data.user), {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 7,
        })
        return res
      }

      return NextResponse.json({ error: 'Dados inválidos' }, { status: 401 })
    } catch {
      return NextResponse.json({ error: 'Erro ao fazer login' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Provider não suportado' }, { status: 400 })
}
