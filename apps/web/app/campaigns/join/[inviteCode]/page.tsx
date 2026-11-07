'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiUrl } from '../../../lib/api-url'

export default function JoinCampaignPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>()
  const router = useRouter()
  const [state, setState] = useState<'ready' | 'joining' | 'joined' | 'failed'>('ready')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (typeof inviteCode !== 'string' || !inviteCode.trim()) setState('failed')
  }, [inviteCode])

  const join = async () => {
    setState('joining')
    setMessage('')
    try {
      const res = await fetch(apiUrl(`/campaigns/join/${encodeURIComponent(inviteCode)}`), {
        method: 'POST', credentials: 'include',
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok || !payload.id) throw new Error(payload.message || 'Convite inválido ou expirado. Faça login e tente novamente.')
      setState('joined')
      router.push(`/campaigns/${payload.id}/characters`)
    } catch (error) {
      setState('failed')
      setMessage(error instanceof Error ? error.message : 'Não foi possível entrar na campanha.')
    }
  }

  return <main style={{ background: '#1a0f0a', minHeight: '100vh', color: '#f4e4bc', display: 'grid', placeItems: 'center', padding: 20 }}>
    <section style={{ padding: 28, border: '1px solid #74552b', borderRadius: 16, maxWidth: 480 }}>
      <h1 style={{ color: '#ff9d00' }}>Convite para campanha</h1>
      <p>Entre com sua conta TavernSound para participar. O mestre decide quais personagens e cenas serão utilizados na sessão.</p>
      {message && <p role="alert">{message}</p>}
      <button disabled={state === 'joining' || state === 'joined'} onClick={join} style={{ padding: 12, background: '#aa681d', border: 0, borderRadius: 8, cursor: 'pointer' }}>
        {state === 'joining' ? 'Entrando…' : state === 'joined' ? 'Redirecionando…' : 'Aceitar convite'}
      </button>
      <p><a style={{ color: '#ffcb7e' }} href="/login">Entrar na minha conta</a></p>
    </section>
  </main>
}
