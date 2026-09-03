// apps/web/app/api/auth/csrf/route.ts

import { NextResponse } from "next/server"
import { randomBytes } from "crypto"

export async function GET() {
  const csrfToken = randomBytes(32).toString('hex')
  
  return NextResponse.json({
    csrfToken
  })
}