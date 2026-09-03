import { NextResponse } from 'next/server'
import { signSession } from '../../../lib/session'

const API_URL = process.env.API_URL || 'http://localhost:3001'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state') || '/'

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=OAuthCallback', request.url))
  }

  try {
    // 1. Troca code por access_token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${process.env.NEXTAUTH_URL}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      return NextResponse.redirect(new URL('/login?error=OAuthCallback', request.url))
    }

    const { access_token } = await tokenRes.json()

    // 2. Busca dados do usuário com o access_token verificado pelo Google
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    })

    if (!userRes.ok) {
      return NextResponse.redirect(new URL('/login?error=OAuthCallback', request.url))
    }

    const googleUser = await userRes.json()

    // 3. Registra/autentica no backend com X-Internal-Secret para impedir
    //    que o endpoint seja chamado diretamente por terceiros
    const backendRes = await fetch(`${API_URL}/auth/google-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': process.env.INTERNAL_API_SECRET || '',
      },
      body: JSON.stringify({
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.picture,
      }),
    })

    if (!backendRes.ok) {
      return NextResponse.redirect(new URL('/login?error=OAuthCreateAccount', request.url))
    }

    const data = await backendRes.json()

    // 4. Cria sessão assinada e redireciona
    const redirectRes = NextResponse.redirect(new URL(state, request.url))
    redirectRes.cookies.set('user-session', signSession(data.user), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    })

    return redirectRes
  } catch {
    return NextResponse.redirect(new URL('/login?error=OAuthCallback', request.url))
  }
}
