'use client'
import { useEffect, useState } from 'react'
import SceneEditor from './SceneEditor'
import type { Scene } from './SceneEditor'
import { apiUrl } from '../lib/api-url'

export default function SceneWorkshop({ roomId }: { roomId: string }) {
  const [allowed, setAllowed] = useState(false)
  const [host, setHost] = useState(false)
  const [scene, setScene] = useState<Scene | null>(null)
  const [scenes, setScenes] = useState<{ id: string; name: string }[]>([])
  const [sceneId, setSceneId] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    fetch(apiUrl(`/rooms/${roomId}/scene/list`), { credentials: 'include', cache: 'no-store' }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Faça login com uma conta autorizada nesta sala.')
      if (!disposed) { setHost(data.isHost); setScenes(data.scenes); setSceneId(data.currentSceneId); setAllowed(true) }
    }).catch(e => { if (!disposed) setError(e.message) })
    return () => { disposed = true }
  }, [roomId])
  const settings = scene?.settings || { scale: 1, x: 0, y: 0, gridOpacity: .3 }
  const width = scene?.map ? scene.map.width * Math.min(500 / scene.map.width, 500 / scene.map.height) : 500
  const height = scene?.map ? scene.map.height * Math.min(500 / scene.map.width, 500 / scene.map.height) : 500
  const createScene = async () => {
    const name = prompt('Nome da nova cena:')?.trim()
    if (!name) return
    const response = await fetch(apiUrl(`/rooms/${roomId}/scene/list`), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    const data = await response.json()
    if (!response.ok) { setError(data.message || 'Não foi possível criar a cena.'); return }
    setScenes(previous => [...previous, data]); setScene(null); setSceneId(data.id)
  }
  const renameScene = async () => {
    const name = prompt('Novo nome da cena:', scenes.find(item => item.id === sceneId)?.name)?.trim()
    if (!name) return
    const response = await fetch(apiUrl(`/rooms/${roomId}/scene/list/${sceneId}`), { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    const data = await response.json()
    if (!response.ok) { setError(data.message || 'Não foi possível renomear.'); return }
    setScenes(previous => previous.map(item => item.id === sceneId ? { ...item, name } : item))
  }
  return <main style={{ minHeight: '100vh', background: '#160f0b', color: '#f4e4bc', padding: '24px', fontFamily: 'system-ui' }}>
    <div style={{ maxWidth: 740, margin: '0 auto' }}>
      <a href={`/room/${roomId}`} style={{ color: '#ffc568' }}>← Voltar à mesa</a>
      <h1 style={{ fontSize: 26 }}>Preparar cenário · {roomId}</h1>
      <p>Edite o cenário sem entrar na sessão de áudio. As mudanças salvas aparecerão na mesa.</p>
      {allowed && <nav aria-label="Cenas" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {scenes.map(item => <button key={item.id} aria-current={item.id === sceneId ? 'page' : undefined} onClick={() => { setScene(null); setSceneId(item.id) }}>{item.name}</button>)}
        {host && <><button onClick={createScene}>+ Nova cena</button><button onClick={renameScene}>Renomear cena</button></>}
      </nav>}
      {error && <p role="alert">{error} <a href="/login" style={{ color: '#ffc568' }}>Entrar</a></p>}
      {!allowed && !error && <p>Carregando cenário…</p>}
      {allowed && sceneId && <SceneEditor key={sceneId} roomId={roomId} sceneId={sceneId} socket={null} connected={true} isHost={host} onChange={setScene}>
        <div style={{ width: '100%', height: '100%', boxSizing: 'border-box', border: '4px solid #3d2b1f', position: 'relative', overflow: 'hidden', background: '#211911' }}>
          {scene?.map && <img alt="Mapa da sala" src={apiUrl(scene.map.url)} style={{ position: 'absolute', width: `${width / 500 * 100}%`, height: `${height / 500 * 100}%`, maxWidth: 'none', left: `${settings.x / 500 * 100}%`, top: `${settings.y / 500 * 100}%`, transform: `scale(${settings.scale})`, transformOrigin: 'top left' }} />}
          <svg aria-hidden="true" width="100%" height="100%" viewBox="0 0 500 500" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {Array.from({ length: 11 }, (_, i) => <path key={i} d={`M${i * 50} 0V500M0 ${i * 50}H500`} stroke="#b8a88a" strokeOpacity={settings.gridOpacity} />)}
          </svg>
        </div>
      </SceneEditor>}
    </div>
  </main>
}
