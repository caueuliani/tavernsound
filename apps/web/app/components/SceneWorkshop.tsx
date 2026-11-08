'use client'
import { useEffect, useState } from 'react'
import SceneEditor from './SceneEditor'
import type { Scene } from './SceneEditor'
import { apiUrl } from '../lib/api-url'
import { DEFAULT_GRID_SIZE, gridLinePositions } from '../lib/scene-grid'

export default function SceneWorkshop({ roomId }: { roomId: string }) {
  const [allowed, setAllowed] = useState(false)
  const [host, setHost] = useState(false)
  const [scene, setScene] = useState<Scene | null>(null)
  const [error, setError] = useState('')
  const [scenes, setScenes] = useState<{ id: string; name: string; position: number }[]>([])
  const [sceneId, setSceneId] = useState('')
  const [busy, setBusy] = useState(false)
  const [players, setPlayers] = useState<{ userId: string; nickname: string; sceneId: string | null }[]>([])
  const [assignmentsLoading, setAssignmentsLoading] = useState(false)
  useEffect(() => {
    let disposed = false
    fetch(apiUrl(`/rooms/${roomId}/scene/list`), { credentials: 'include', cache: 'no-store' }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Faça login com uma conta autorizada nesta sala.')
      if (!disposed) { setHost(data.isHost); setAllowed(true); setScenes(data.scenes); setSceneId(data.currentSceneId ?? '') }
    }).catch(e => { if (!disposed) setError(e.message) })
    return () => { disposed = true }
  }, [roomId])
  useEffect(() => {
    if (!allowed || !host) return
    let cancelled = false
    setAssignmentsLoading(true)
    fetch(apiUrl(`/rooms/${roomId}/scene/assignments`), { credentials: 'include', cache: 'no-store' })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Não foi possível consultar jogadores.')
        if (!cancelled) setPlayers(data.players || [])
      }).catch(error => { if (!cancelled) setError((error as Error).message) })
      .finally(() => { if (!cancelled) setAssignmentsLoading(false) })
    return () => { cancelled = true }
  }, [roomId, allowed, host])
  const stageAssignment = async (userId: string, nextSceneId: string) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch(apiUrl(`/rooms/${roomId}/scene/assignments/${encodeURIComponent(userId)}`), {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: nextSceneId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Não foi possível preparar o destino do jogador.')
      setPlayers(previous => previous.map(player => player.userId === userId
        ? { ...player, sceneId: data.sceneId } : player))
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  const createScene = async () => {
    const name = prompt('Nome da nova cena (até 80 caracteres):')?.trim()
    if (!name || busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch(apiUrl(`/rooms/${roomId}/scene/list`), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Não foi possível criar a cena.')
      setScenes(previous => [...previous, data])
      setScene(null)
      setSceneId(data.id)
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  const renameScene = async () => {
    if (!sceneId || busy) return
    const name = prompt('Novo nome:', scenes.find(item => item.id === sceneId)?.name)?.trim()
    if (!name) return
    setBusy(true); setError('')
    try {
      const response = await fetch(apiUrl(`/rooms/${roomId}/scene/list/${encodeURIComponent(sceneId)}`), {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Não foi possível renomear a cena.')
      setScenes(previous => previous.map(item => item.id === sceneId ? { ...item, name } : item))
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  const settings = scene?.settings || { scale: 1, x: 0, y: 0, gridOpacity: .3, gridSize: DEFAULT_GRID_SIZE }
  const gridPath = gridLinePositions(settings.gridSize).map(position => `M${position} 0V500 M0 ${position}H500`).join(' ')
  const width = scene?.map ? scene.map.width * Math.min(500 / scene.map.width, 500 / scene.map.height) : 500
  const height = scene?.map ? scene.map.height * Math.min(500 / scene.map.width, 500 / scene.map.height) : 500
  return <main style={{ minHeight: '100vh', background: '#160f0b', color: '#f4e4bc', padding: '24px', fontFamily: 'system-ui' }}>
    <div style={{ maxWidth: 740, margin: '0 auto' }}>
      <a href={`/room/${roomId}`} style={{ color: '#ffc568' }}>← Voltar à mesa</a>
      <h1 style={{ fontSize: 26 }}>Preparar cenário · {roomId}</h1>
      <p>Prepare vários mapas sem entrar na sessão de áudio. Apenas a Cena inicial aparece na mesa nesta versão; as demais ficam como rascunhos.</p>
      {allowed && <nav aria-label="Cenas da sala" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {scenes.map((item, index) => <button key={item.id} type="button" aria-current={item.id === sceneId ? 'page' : undefined}
          style={{ padding: '8px 12px', background: item.id === sceneId ? '#805324' : '#34251a', color: '#f4e4bc', border: '1px solid #986f40', borderRadius: 6 }}
          onClick={() => { setScene(null); setSceneId(item.id) }}>{item.name}{index > 0 ? ' · rascunho' : ' · ativa'}</button>)}
        {host && <><button disabled={busy || scenes.length >= 20} type="button" onClick={() => void createScene()}>+ Nova cena</button>
          <button disabled={busy || !sceneId} type="button" onClick={() => void renameScene()}>Renomear</button></>}
      </nav>}
      {host && allowed && <section aria-label="Preparar destinos dos jogadores" style={{ marginBottom: 20, padding: 14, border: '1px solid #79552c', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>🎭 Destinos dos personagens (preparação)</h2>
        <p style={{ fontSize: 13 }}>Defina para qual cena cada jogador deverá ir. <strong>Esta escolha ainda não move o personagem nem altera voz ou mapa da mesa.</strong></p>
        {assignmentsLoading && <p>Carregando jogadores…</p>}
        {!assignmentsLoading && players.length === 0 && <p>Nenhum jogador cadastrado como membro ativo desta sala.</p>}
        {players.map(player => <label key={player.userId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <span>{player.nickname || 'Jogador'}</span>
          <select value={player.sceneId ?? ''} disabled={busy || scenes.length === 0}
            onChange={event => void stageAssignment(player.userId, event.target.value)}
            style={{ padding: 6, background: '#332319', color: '#f4e4bc', border: '1px solid #85613b' }}>
            {scenes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>)}
      </section>}
      {error && <p role="alert">{error} <a href="/login" style={{ color: '#ffc568' }}>Entrar</a></p>}
      {!allowed && !error && <p>Carregando cenário…</p>}
      {allowed && sceneId && <SceneEditor key={sceneId} roomId={roomId} sceneId={sceneId} socket={null} connected={true} isHost={host} onChange={setScene}>
        <div style={{ width: 500, height: 500, border: '4px solid #3d2b1f', position: 'relative', overflow: 'hidden', background: '#211911' }}>
          {scene?.map && <img alt="Mapa da sala" src={apiUrl(scene.map.url)} style={{ position: 'absolute', width, height, maxWidth: 'none', left: settings.x, top: settings.y, transform: `scale(${settings.scale})`, transformOrigin: 'top left' }} />}
          <svg aria-hidden="true" width="500" height="500" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <path d={gridPath} stroke="#b8a88a" strokeOpacity={settings.gridOpacity} fill="none" />
          </svg>
        </div>
      </SceneEditor>}
    </div>
  </main>
}
