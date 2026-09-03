// apps/web/app/api/auth/error/route.ts

import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const error = searchParams.get('error')
  
  console.error('❌ NextAuth Error:', error)
  
  // Redireciona para login com mensagem de erro
  return NextResponse.redirect(new URL(`/login?error=${error || 'unknown'}`, request.url))
}