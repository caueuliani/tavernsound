'use client'

import { useState } from 'react'
import { apiUrl } from '../lib/api-url'

export default function RoomMembers({ roomId }: { roomId: string }) {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  return <form onSubmit={async event => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(apiUrl(`/rooms/${encodeURIComponent(roomId)}/members`), {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Não foi possível autorizar.')
      setMessage(`Conta autorizada. Compartilhe o código ${roomId} com o participante.`)
      setEmail('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Serviço indisponível.') }
    finally { setBusy(false) }
  }} style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #74522a', borderRadius: 8 }}>
    <label htmlFor="member-email">Autorizar participante</label>
    <p style={{ fontSize: '0.85rem' }}>Use o e-mail de uma conta já cadastrada no TavernSound.</p>
    <input id="member-email" type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail da conta" />
    <button type="submit" disabled={busy}>{busy ? 'Autorizando…' : 'Autorizar acesso'}</button>
    {message && <p role="status">{message}</p>}
  </form>
}
