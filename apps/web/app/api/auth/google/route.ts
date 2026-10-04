// apps/web/app/api/auth/google/route.ts

import { NextResponse } from "next/server"
import { safeReturnPath } from '@/lib/auth-security'
import { createOAuthAttempt, OAUTH_COOKIE, oauthCookieOptions } from '@/lib/oauth'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.NEXTAUTH_URL) {
    return NextResponse.json({ error: 'Login Google não configurado.' }, { status: 503 })
  }
  const attempt = createOAuthAttempt(safeReturnPath(searchParams.get('callbackUrl')))
  
  // Parâmetros do Google OAuth
  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  
  googleAuthUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!)
  googleAuthUrl.searchParams.set('redirect_uri', `${process.env.NEXTAUTH_URL}/api/auth/google/callback`)
  googleAuthUrl.searchParams.set('response_type', 'code')
  googleAuthUrl.searchParams.set('scope', 'openid email profile')
  googleAuthUrl.searchParams.set('state', attempt.state)
  googleAuthUrl.searchParams.set('code_challenge', attempt.challenge)
  googleAuthUrl.searchParams.set('code_challenge_method', 'S256')
  
  const response = NextResponse.redirect(googleAuthUrl.toString())
  response.cookies.set(OAUTH_COOKIE, attempt.cookie, oauthCookieOptions)
  return response
}
