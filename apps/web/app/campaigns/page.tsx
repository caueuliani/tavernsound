'use client'

import { useEffect, useState } from 'react'
import { apiUrl } from '../lib/api-url'

type Campaign = { id: string; name: string; description?: string; gameSystemId: string; ownerId: string; memberCount?: number }
type System = { id: string; name: string; version: string }
const field = { padding: '0.75rem', borderRadius: 8, background: '#2b1d13', border: '1px solid #70532c', color: '#fff1cf', width: '100%' }
const button = { padding: '0.8rem 1rem', border: '1px solid #a67c43', borderRadius: 8, background: '#573714', color: '#ffe1a3', cursor: 'pointer' }

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [systems, setSystems] = useState<System[]>([])
  const [ownedRooms, setOwnedRooms] = useState<{ id: string; name: string | null }[]>([])
  const [selectedRoom, setSelectedRoom] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [gameSystemId, setGameSystemId] = useState('dnd5e-2014-srd51')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [userId, setUserId] = useState('')

  const reload = async () => {
    const response = await fetch(apiUrl('/campaigns'), { credentials: 'include', cache: 'no-store' })
    if (!response.ok) throw new Error('Não foi possível carregar suas campanhas.')
    const body = await response.json()
    setCampaigns(Array.isArray(body) ? body : [])
  }

  useEffect(() => {
    let active = true
    Promise.all([
      fetch(apiUrl('/campaigns'), { credentials: 'include', cache: 'no-store' }),
      fetch(apiUrl('/campaigns/systems'), { credentials: 'include', cache: 'no-store' }),
      fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' }),
      fetch(apiUrl('/rooms'), { credentials: 'include', cache: 'no-store' }),
    ]).then(async ([c, s, m, roomsRes]) => {
      if (!c.ok || !s.ok) throw new Error('Entre na sua conta para gerenciar campanhas.')
      const [campaignData, systemsData, me, roomsData] = await Promise.all([c.json(), s.json(), m.json(), roomsRes.ok ? roomsRes.json() : Promise.resolve([])])
      if (!active) return
      setCampaigns(Array.isArray(campaignData) ? campaignData : [])
      setSystems(Array.isArray(systemsData) ? systemsData : [])
      setOwnedRooms(Array.isArray(roomsData) ? roomsData.filter((room: { isOwner?: boolean }) => room.isOwner === true) : [])
      setUserId(me?.user?.id || '')
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : 'Erro ao carregar campanhas.') })
    return () => { active = false }
  }, [])

  const create = async () => {
    if (!name.trim()) { setError('Informe um nome para a campanha.'); return }
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const response = await fetch(apiUrl('/campaigns'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, gameSystemId }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Não foi possível criar a campanha.')
      setName('')
      setDescription('')
      await reload()
      setNotice('Campanha criada com sucesso.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao criar campanha.') }
    finally { setBusy(false) }
  }

  const attachRoom = async (campaign: Campaign) => {
    const roomId = selectedRoom[campaign.id]
    if (!roomId) { setError('Escolha uma sala que você administra.'); return }
    setError('')
    setNotice('')
    try {
      const response = await fetch(apiUrl(`/campaigns/${campaign.id}/rooms/${roomId}`), {
        method: 'PUT', credentials: 'include',
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'Não foi possível associar a sala.')
      setNotice(`Sala ${roomId} vinculada à campanha "${campaign.name}".`)
    } catch (error) { setError(error instanceof Error ? error.message : 'Erro ao vincular sala.') }
  }

  const invite = async (campaign: Campaign) => {
    setError('')
    setNotice('')
    try {
      const response = await fetch(apiUrl(`/campaigns/${campaign.id}/invite`), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiryHours: 48 }),
      })
      const body = await response.json()
      if (!response.ok || !body.inviteUrl) throw new Error(body.message || 'Não foi possível gerar convite.')
      const url = new URL(body.inviteUrl, window.location.origin).href
      await navigator.clipboard.writeText(url)
      setNotice('Link de convite copiado, válido por 48 horas.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao gerar convite.') }
  }

  return <main style={{ minHeight: '100vh', background: '#1a0f0a', color: '#f4e4bc', padding: '2rem max(1rem, 5vw)' }}>
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <a href="/rooms" style={{ color: '#ffbe65' }}>← Voltar às salas</a>
      <h1 style={{ color: '#ff9d00' }}>Campanhas TavernSound</h1>
      <p>Organize personagens e escolha o sistema de RPG. Seu VTT de mapas e áudio continua disponível nas salas.</p>
      <section style={{ background: '#342219', borderRadius: 14, padding: 20, border: '1px solid #70532c', marginBottom: 26 }}>
        <h2>Nova campanha</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <label>Nome<input style={field} maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
          <label>Descrição<input style={field} maxLength={400} value={description} onChange={e => setDescription(e.target.value)} /></label>
          <label>Sistema de RPG
            <select style={field} value={gameSystemId} onChange={e => setGameSystemId(e.target.value)}>
              {systems.length ? systems.map(system => <option key={system.id} value={system.id}>{system.name}</option>) : <>
                <option value="dnd5e-2014-srd51">5E 2014 (SRD 5.1)</option>
                <option value="generic">Sistema genérico</option>
              </>}
            </select>
          </label>
          <button style={button} disabled={busy} onClick={create}>{busy ? 'Criando…' : 'Criar campanha'}</button>
        </div>
      </section>
      {error && <p role="alert" style={{ color: '#ff9999' }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#b5efb5' }}>{notice}</p>}
      <h2>Minhas campanhas</h2>
      {!campaigns.length && <p>Nenhuma campanha disponível.</p>}
      <div style={{ display: 'grid', gap: 12 }}>
        {campaigns.map(campaign => <article key={campaign.id} style={{ padding: 18, background: '#332219', borderRadius: 12, border: '1px solid #70532c' }}>
          <h3 style={{ marginTop: 0, color: '#ffcf7e' }}>{campaign.name}</h3>
          <p>{campaign.description || 'Sem descrição'}</p>
          <p style={{ fontSize: 13, opacity: 0.8 }}>Sistema: {systems.find(s => s.id === campaign.gameSystemId)?.name || campaign.gameSystemId} · Membros: {campaign.memberCount ?? 0}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <a style={button} href={`/campaigns/${campaign.id}/characters`}>Abrir fichas</a>
            {campaign.ownerId === userId && <button style={button} onClick={() => invite(campaign)}>Copiar convite</button>}
            {campaign.ownerId === userId && ownedRooms.length > 0 && <>
              <select aria-label={`Sala da campanha ${campaign.name}`} style={{ ...field, width: 'auto' }} value={selectedRoom[campaign.id] || ''} onChange={e => setSelectedRoom(current => ({ ...current, [campaign.id]: e.target.value }))}>
                <option value="">Selecione uma sala</option>
                {ownedRooms.map(room => <option key={room.id} value={room.id}>{room.name || room.id} · {room.id}</option>)}
              </select>
              <button style={button} onClick={() => attachRoom(campaign)}>Vincular sala</button>
            </>}
          </div>
        </article>)}
      </div>
    </div>
  </main>
}
