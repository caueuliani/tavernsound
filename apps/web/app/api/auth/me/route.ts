import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '../../lib/session'

export async function GET() {
  const cookieStore = await cookies()
  const session = cookieStore.get('user-session')

  if (!session?.value) return NextResponse.json({ user: null })

  const user = verifySession(session.value)
  if (!user?.id) return NextResponse.json({ user: null })

  return NextResponse.json({ user })
}
