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
  const [players, setPlayers] = useState<{ userId: string; nickname: string; sceneId: string | null; activeSceneId?: string | null }[]>([])
  const [assignmentsLoading, setAssignmentsLoading] = useState(false)
  const [sceneNpcs, setSceneNpcs] = useState<Array<{ id: string; playerName?: string; hp?: number; maxHp?: number; x: number; y: number }>>([])
  const [npcName, setNpcName] = useState('NPC')
  const [npcX, setNpcX] = useState('1')
  const [npcY, setNpcY] = useState('1')
  const [preflight, setPreflight] = useState<Record<string, { requestId?: string; status: string }>>({})
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
  const initialScene = scenes[0]?.id ?? ''
  const npcScene = host && !!sceneId && !!initialScene && sceneId !== initialScene
  const loadNpcs = async (id: string) => {
    const response = await fetch(apiUrl(`/rooms/${roomId}/scene/snapshot?sceneId=${encodeURIComponent(id)}`), {
      credentials: 'include', cache: 'no-store',
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || 'Não foi possível carregar NPCs da cena.')
    setSceneNpcs((data.tokens || []).filter((token: { kind: string }) => token.kind === 'SCENERY'))
  }
  useEffect(() => {
    if (!npcScene) { setSceneNpcs([]); return }
    let cancelled = false
    fetch(apiUrl(`/rooms/${roomId}/scene/snapshot?sceneId=${encodeURIComponent(sceneId)}`), {
      credentials: 'include', cache: 'no-store',
    }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Não foi possível carregar NPCs.')
      if (!cancelled) setSceneNpcs((data.tokens || []).filter((token: { kind: string }) => token.kind === 'SCENERY'))
    }).catch(error => { if (!cancelled) setError((error as Error).message) })
    return () => { cancelled = true }
  }, [roomId, sceneId, npcScene])
  const npcRequest = async (method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: object) => {
    if (busy || !npcScene) return
    setBusy(true); setError('')
    try {
      const response = await fetch(apiUrl(path), {
        method, credentials: 'include', cache: 'no-store',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Não foi possível modificar o NPC.')
      await loadNpcs(sceneId)
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  const createNpc = () => void npcRequest('POST',
    `/rooms/${roomId}/tokens/scenes/${encodeURIComponent(sceneId)}/scenery`, {
      name: npcName, x: Number(npcX), y: Number(npcY),
    })
  const editNpc = (npc: { id: string; hp?: number; maxHp?: number; x: number; y: number }) => {
    const hpInput = prompt('HP atual do NPC:', String(npc.hp ?? 10))
    if (hpInput === null) return
    const maxInput = prompt('HP máximo:', String(npc.maxHp ?? 10))
    if (maxInput === null) return
    const xInput = prompt('Coordenada X (grade da cena):', String(npc.x))
    if (xInput === null) return
    const yInput = prompt('Coordenada Y (grade da cena):', String(npc.y))
    if (yInput === null) return
    void npcRequest('PATCH',
      `/rooms/${roomId}/tokens/scenes/${encodeURIComponent(sceneId)}/scenery/${encodeURIComponent(npc.id)}`, {
        hp: Number(hpInput), maxHp: Number(maxInput), x: Number(xInput), y: Number(yInput),
      })
  }

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
      setPreflight(current => { const next = { ...current }; delete next[userId]; return next })
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  const recoverToInitial = async (userId: string) => {
    if (busy || !window.confirm('Restaurar este jogador à Cena inicial? A conexão atual será encerrada e ele deverá atualizar a mesa.')) return
    setBusy(true); setError('')
    try {
      const response = await fetch(apiUrl(`/rooms/${roomId}/scene/transfers/${encodeURIComponent(userId)}/return-to-initial`), {
        method: 'POST', credentials: 'include', cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Não foi possível restaurar a Cena inicial.')
      setPlayers(previous => previous.map(player => player.userId === userId
        ? { ...player, activeSceneId: data.sceneId } : player))
      setPreflight(previous => { const next = { ...previous }; delete next[userId]; return next })
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }

  const checkTransferPreflight = async (userId: string) => {
    if (busy) return
    const previous = preflight[userId]
    setBusy(true); setError('')
    try {
      const checkingExisting = !!previous?.requestId &&
        (previous.status === 'pending' || previous.status === 'accepted')
      const endpoint = checkingExisting
        ? `/rooms/${roomId}/scene/transfers/preflight/${encodeURIComponent(previous.requestId!)}`
        : `/rooms/${roomId}/scene/transfers/${encodeURIComponent(userId)}/preflight`
      const response = await fetch(apiUrl(endpoint), {
        method: checkingExisting ? 'GET' : 'POST', credentials: 'include', cache: 'no-store',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Não foi possível verificar a conexão.')
      setPreflight(current => ({ ...current, [userId]: { requestId: result.requestId, status: result.status } }))
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  const activatePreparedScene = async (userId: string) => {
    const requestId = preflight[userId]?.requestId
    if (busy || preflight[userId]?.status !== 'accepted' || !requestId ||
        !window.confirm('Ativar a cena deste jogador? O navegador dele recarregará e a webcam será desligada.')) return
    setBusy(true); setError('')
    try {
      const response = await fetch(apiUrl(`/rooms/${roomId}/scene/transfers/${encodeURIComponent(userId)}/activate`), {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Não foi possível ativar a transferência.')
      setPlayers(previous => previous.map(player => player.userId === userId
        ? { ...player, activeSceneId: data.sceneId } : player))
      setPreflight(previous => { const next = { ...previous }; delete next[userId]; return next })
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
        <p style={{ fontSize: 13 }}>Defina para qual cena cada jogador deverá ir. <strong>Esta escolha ainda não move o personagem nem altera voz ou mapa da mesa. O botão de verificação só solicita confirmação da conexão, sem teleporte. A ativação experimental só aparece em versões preparadas para áudio por cena e depende de autorização do servidor. Se a transferência falhar, o mestre poderá restaurar o jogador à Cena inicial.</strong></p>
        {assignmentsLoading && <p>Carregando jogadores…</p>}
        {!assignmentsLoading && players.length === 0 && <p>Nenhum jogador cadastrado como membro ativo desta sala.</p>}
        {players.map(player => <div key={player.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>{player.nickname || 'Jogador'}</span>
            <select value={player.sceneId ?? ''} disabled={busy || scenes.length === 0}
              onChange={event => void stageAssignment(player.userId, event.target.value)}
              style={{ padding: 6, background: '#332319', color: '#f4e4bc', border: '1px solid #85613b' }}>
              {scenes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy || !player.sceneId || player.sceneId === `initial-${roomId}`}
            onClick={() => void checkTransferPreflight(player.userId)}>
            {preflight[player.userId]?.status === 'pending' || preflight[player.userId]?.status === 'accepted'
              ? 'Consultar confirmação' : 'Verificar conexão'}
          </button>
          {process.env.NEXT_PUBLIC_SCENE_RTC_HANDOFF === 'true' &&
            preflight[player.userId]?.status === 'accepted' &&
            (!player.activeSceneId || player.activeSceneId === `initial-${roomId}`) &&
            <button type="button" disabled={busy}
              onClick={() => void activatePreparedScene(player.userId)}>
              Ativar transferência (experimental)
            </button>}
          {player.activeSceneId && player.activeSceneId !== `initial-${roomId}` && <button
            type="button" disabled={busy} onClick={() => void recoverToInitial(player.userId)}>
            Restaurar Cena inicial
          </button>}
          {preflight[player.userId] && <span role="status" style={{ fontSize: 12 }}>
            {({ pending: 'Aguardando jogador', accepted: 'Conexão confirmada; transferência NÃO ativada',
              rejected: 'Jogador recusou', expired: 'Verificação expirada' } as Record<string, string>)[preflight[player.userId].status] ?? 'Verificação indisponível'}
          </span>}
        </div>)}
      </section>}
      {npcScene && <section aria-label="NPCs da cena alternativa" style={{ marginBottom: 20, padding: 14, border: '1px solid #79552c', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>⚔️ Tokens e NPCs desta cena</h2>
        <p style={{ fontSize: 13 }}>Crie e administre NPCs apenas no mapa selecionado. Jogadores transferidos podem movimentar seu próprio token e editar seu HP pela mesa.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label>Nome <input aria-label="Nome do NPC" value={npcName} onChange={event => setNpcName(event.target.value)} maxLength={64} /></label>
          <label>X <input aria-label="X do NPC" type="number" step="0.5" min="0" max="10" value={npcX} onChange={event => setNpcX(event.target.value)} style={{ width: 72 }} /></label>
          <label>Y <input aria-label="Y do NPC" type="number" step="0.5" min="0" max="10" value={npcY} onChange={event => setNpcY(event.target.value)} style={{ width: 72 }} /></label>
          <button type="button" disabled={busy || !npcName.trim()} onClick={createNpc}>Criar NPC</button>
          <button type="button" disabled={busy} onClick={() => void loadNpcs(sceneId).catch(error => setError(error.message))}>Atualizar</button>
        </div>
        {sceneNpcs.map(npc => <div key={npc.id} style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
          <span style={{ flex: 1 }}>{npc.playerName || 'NPC'} · ({npc.x}, {npc.y}) · HP {npc.hp ?? 10}/{npc.maxHp ?? 10}</span>
          <button type="button" disabled={busy} onClick={() => editNpc(npc)}>Editar posição/HP</button>
          <button type="button" disabled={busy} onClick={() => {
            if (window.confirm('Excluir este NPC apenas desta cena?')) void npcRequest('DELETE',
              `/rooms/${roomId}/tokens/scenes/${encodeURIComponent(sceneId)}/scenery/${encodeURIComponent(npc.id)}`)
          }}>Excluir</button>
        </div>)}
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
