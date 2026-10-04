'use client'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode, PointerEvent } from 'react'
import { apiUrl } from '../lib/api-url'
import styles from './SceneEditor.module.css'

export interface SceneWall { id: string; x1: number; y1: number; x2: number; y2: number; isDoor: boolean; isOpen: boolean; blocksAudio: boolean }
export interface Scene {
  revision: number
  map: { url: string; width: number; height: number } | null
  settings: { scale: number; x: number; y: number; gridOpacity: number }
  walls: SceneWall[]
}
const initial = (): Scene => ({ revision: 0, map: null, settings: { scale: 1, x: 0, y: 0, gridOpacity: .3 }, walls: [] })
type Point = { x: number; y: number }
type Tool = 'play' | 'wall' | 'door' | 'cave' | 'select'
export default function SceneEditor({ roomId, socket, connected, isHost, onChange, children }: {
  roomId: string; socket: any; connected: boolean; isHost: boolean; onChange: (scene: Scene) => void; children: ReactNode
}) {
  const [scene, setScene] = useState<Scene>(initial)
  const sceneRef = useRef(scene); sceneRef.current = scene
  const [enabled, setEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [tool, setTool] = useState<Tool>('play')
  const [start, setStart] = useState<Point | null>(null)
  const [hover, setHover] = useState<Point | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [snap, setSnap] = useState(true)
  const [past, setPast] = useState<Scene[]>([])
  const [future, setFuture] = useState<Scene[]>([])
  const drag = useRef<{ point: Point; wall: SceneWall } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const endpoint = apiUrl(`/rooms/${roomId}/scene`)
  const editable = isHost && enabled && loaded && connected && !busy
  const active = editable ? tool : 'play'
  const selectedWall = scene.walls.find(w => w.id === selected)
  const accept = (value: Scene) => {
    setScene(value); sceneRef.current = value; setDirty(false); dirtyRef.current = false
    setPast([]); setFuture([]); setLoaded(true); setStart(null); setError('')
  }
  const edit = (value: Scene) => {
    const previous = sceneRef.current
    setPast(p => [...p.slice(-39), previous]); setFuture([])
    setScene(value); sceneRef.current = value; setDirty(true); dirtyRef.current = true; setMessage('Alterações locais. Clique em Salvar cenário para compartilhar.'); setError('')
  }
  useEffect(() => { onChange(scene) }, [scene, onChange])
  useEffect(() => {
    if (!connected) return
    let disposed = false
    const applyRemote = (value: Scene) => {
      if (value.revision <= sceneRef.current.revision) return
      if (dirtyRef.current) { setError('O cenário foi alterado em outra conexão. Recarregue antes de salvar.'); return }
      accept(value)
    }
    socket?.on('scene-updated', applyRemote)
    fetch(endpoint, { credentials: 'include', cache: 'no-store' }).then(async r => {
      const data = await r.json(); if (!r.ok) throw new Error(data.message || 'Não foi possível carregar o cenário.')
      if (disposed) return
      setEnabled(data.editingEnabled)
      if (!dirtyRef.current && data.scene.revision >= sceneRef.current.revision) accept(data.scene)
    }).catch(e => { if (!disposed) setError(e.message) })
    return () => { disposed = true; socket?.off('scene-updated', applyRemote) }
  }, [endpoint, socket, connected])
  const reload = async () => {
    if (dirty && !confirm('Descartar os ajustes locais e carregar o cenário salvo?')) return
    try {
      const response = await fetch(endpoint, { credentials: 'include', cache: 'no-store' })
      const data = await response.json(); if (!response.ok) throw new Error(data.message)
      accept(data.scene); setEnabled(data.editingEnabled); setMessage('Cenário recarregado.')
    } catch (e) { setError((e as Error).message) }
  }
  const request = async (suffix: string, method: string, body?: BodyInit) => {
    setBusy(true); setError('')
    try {
      const response = await fetch(endpoint + suffix, { method, credentials: 'include', headers: {
        'If-Match': String(sceneRef.current.revision), ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      }, body })
      const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Não foi possível salvar.')
      accept(data); setMessage('Cenário salvo e sincronizado com a sala.'); return true
    } catch (e) { setError((e as Error).message); return false }
    finally { setBusy(false) }
  }
  const upload = async (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) { setError('Selecione PNG, JPG ou WebP de até 3 MB.'); return }
    const form = new FormData(); form.append('file', file)
    await request('/image', 'POST', form)
  }
  const sample = async (name: string) => {
    setBusy(true); setError('')
    try {
      // Only bundled, trusted SVGs are rasterized. User SVG uploads are not accepted.
      const img = new Image(); img.src = `/maps/${name}.svg`; await img.decode()
      const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 1000
      canvas.getContext('2d')!.drawImage(img, 0, 0, 1000, 1000)
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Não foi possível preparar o exemplo.')
      await upload(new File([blob], `${name}.png`, { type: 'image/png' }))
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const point = (event: PointerEvent<SVGSVGElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    const value = (n: number) => Math.max(0, Math.min(10, snap ? Math.round(n * 2) / 2 : Math.round(n * 100) / 100))
    return { x: value((event.clientX - rect.left) / rect.width * 10), y: value((event.clientY - rect.top) / rect.height * 10) }
  }
  const nearest = (p: Point) => scene.walls.map(w => {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1
    const t = Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / (dx * dx + dy * dy)))
    return { wall: w, distance: Math.hypot(p.x - w.x1 - t * dx, p.y - w.y1 - t * dy) }
  }).filter(item => item.distance < .25).sort((a, b) => a.distance - b.distance)[0]?.wall
  const pointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || active === 'play') return
    const p = point(e)
    if (active === 'select') {
      const wall = nearest(p); setSelected(wall?.id || null)
      if (wall) { drag.current = { point: p, wall }; e.currentTarget.setPointerCapture(e.pointerId) }
      return
    }
    if (!start) { setStart(p); setHover(p); return }
    if (Math.hypot(p.x - start.x, p.y - start.y) < .05) return
    if (scene.walls.length >= 200) { setError('Limite de 200 segmentos atingido.'); return }
    const wall: SceneWall = { id: crypto.randomUUID(), x1: start.x, y1: start.y, x2: p.x, y2: p.y, isDoor: active === 'door', isOpen: false, blocksAudio: true }
    edit({ ...scene, walls: [...scene.walls, wall] }); setSelected(wall.id)
    setStart(active === 'cave' ? p : null)
  }
  const pointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const current = drag.current; drag.current = null
    if (!current) return
    const p = point(e), w = current.wall
    const dx = Math.max(-Math.min(w.x1, w.x2), Math.min(10 - Math.max(w.x1, w.x2), p.x - current.point.x))
    const dy = Math.max(-Math.min(w.y1, w.y2), Math.min(10 - Math.max(w.y1, w.y2), p.y - current.point.y))
    if (dx || dy) edit({ ...scene, walls: scene.walls.map(item => item.id === w.id ? { ...w, x1: w.x1 + dx, x2: w.x2 + dx, y1: w.y1 + dy, y2: w.y2 + dy } : item) })
  }
  return <>
    <div style={{ position: 'relative', width: 508, height: 508 }}>
      {children}
      <svg aria-label="Paredes e portas do cenário" className={styles.overlay} viewBox="0 0 500 500" style={{ pointerEvents: active === 'play' ? 'none' : 'auto', cursor: active === 'select' ? 'move' : 'crosshair' }}
        onPointerDown={pointerDown} onPointerMove={e => setHover(point(e))} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null }}>
        {scene.walls.map(w => <g key={w.id}>
          <line x1={w.x1 * 50} y1={w.y1 * 50} x2={w.x2 * 50} y2={w.y2 * 50} stroke="#120d09" strokeWidth="7" opacity=".8" />
          <line x1={w.x1 * 50} y1={w.y1 * 50} x2={w.x2 * 50} y2={w.y2 * 50} stroke={active === 'select' && selected === w.id ? '#fff' : w.isDoor ? w.isOpen ? '#64d7a2' : '#ffbf62' : '#a3b4ca'} strokeWidth="3" strokeDasharray={w.isOpen ? '7 7' : undefined} />
          {w.isDoor && <text x={(w.x1 + w.x2) * 25 + 5} y={(w.y1 + w.y2) * 25 - 5} fill={w.isOpen ? '#64d7a2' : '#ffbf62'} fontSize="11" stroke="#120d09" strokeWidth="3" paintOrder="stroke">{w.isOpen ? 'Aberta' : 'Porta'}</text>}
        </g>)}
        {start && hover && active !== 'play' && <line x1={start.x * 50} y1={start.y * 50} x2={hover.x * 50} y2={hover.y * 50} stroke="#fff" strokeWidth="2" strokeDasharray="4 4" />}
      </svg>
    </div>
    {(isHost || error) && <section className={styles.panel} aria-label="Editor de cenário">
      <h3>🗺️ Cenário da mesa</h3>
      {isHost && !enabled && <p>Carregando editor ou edição indisponível nesta hospedagem.</p>}
      {isHost && enabled && <>
        <p>Importe o mapa, alinhe à grade e desenhe as barreiras. Ajustes só chegam aos jogadores ao salvar.</p>
        <div className={styles.samples}>
          {([['taverna', 'Taverna'], ['masmorra', 'Masmorra'], ['caverna', 'Caverna']] as const).map(([id, label]) => <button key={id} disabled={!editable || dirty} onClick={() => sample(id)}><img src={`/maps/${id}.svg`} alt="" />{label}</button>)}
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file) }} />
        <div className={styles.row}>
          <button disabled={!editable || dirty} onClick={() => input.current?.click()}>{scene.map ? 'Trocar imagem' : 'Importar imagem'}</button>
          <button disabled={!editable || dirty || !scene.map} onClick={() => request('/image', 'DELETE')}>Remover imagem</button>
          <span>PNG/JPG/WebP · até 3 MB</span>
        </div>
        {dirty && <p>Salve ou desfaça os ajustes antes de trocar a imagem.</p>}
        <div className={styles.row}>
          <label>Escala <input aria-label="Escala do mapa" type="number" min=".25" max="4" step=".05" disabled={!editable} value={scene.settings.scale} onChange={e => edit({ ...scene, settings: { ...scene.settings, scale: Number(e.target.value) } })} /></label>
          {(['x', 'y'] as const).map(axis => <label key={axis}>Deslocamento {axis.toUpperCase()} <input type="number" min="-500" max="500" step="5" disabled={!editable} value={scene.settings[axis]} onChange={e => edit({ ...scene, settings: { ...scene.settings, [axis]: Number(e.target.value) } })} /></label>)}
          <label>Grade <input aria-label="Opacidade da grade" type="range" min="0" max="1" step=".05" disabled={!editable} value={scene.settings.gridOpacity} onChange={e => edit({ ...scene, settings: { ...scene.settings, gridOpacity: Number(e.target.value) } })} /></label>
        </div>
        <div className={styles.row}>
          {([['play', 'Jogar'], ['wall', 'Parede'], ['door', 'Porta'], ['cave', 'Caverna'], ['select', 'Selecionar / mover']] as const).map(([id, label]) => <button key={id} disabled={!editable} aria-pressed={tool === id} onClick={() => { setTool(id); setStart(null) }}>{label}</button>)}
        </div>
        <p>{tool === 'play' ? 'Modo de jogo: os cliques criam ou movem seu token.' : tool === 'select' ? 'Clique em uma parede ou porta para selecionar. Arraste para reposicionar.' : tool === 'cave' ? 'Clique em sequência para contornar a caverna. Finalizar encerra a linha.' : 'Clique no início e no fim do segmento. Deixe um vão na parede para desenhar a porta.'}</p>
        <div className={styles.row}>
          <label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} />Encaixar na meia célula</label>
          {start && <button onClick={() => setStart(null)}>Finalizar linha</button>}
          <span>{scene.walls.length}/200 segmentos</span>
        </div>
        {selectedWall && <div className={styles.row}>
          <span>{selectedWall.isDoor ? 'Porta selecionada' : 'Parede selecionada'}</span>
          {selectedWall.isDoor && <button disabled={!editable} onClick={() => edit({ ...scene, walls: scene.walls.map(w => w.id === selected ? { ...w, isOpen: !w.isOpen } : w) })}>{selectedWall.isOpen ? 'Fechar porta' : 'Abrir porta'}</button>}
          <button disabled={!editable} onClick={() => { edit({ ...scene, walls: scene.walls.filter(w => w.id !== selected) }); setSelected(null) }}>Apagar segmento</button>
        </div>}
        <div className={styles.row}>
          <button disabled={!editable || !past.length} onClick={() => { setFuture(f => [scene, ...f]); setScene(past[past.length - 1]); setPast(p => p.slice(0, -1)); setDirty(true) }}>Desfazer</button>
          <button disabled={!editable || !future.length} onClick={() => { setPast(p => [...p, scene]); setScene(future[0]); setFuture(f => f.slice(1)); setDirty(true) }}>Refazer</button>
          <button className={styles.save} disabled={!editable || !dirty} onClick={() => request('', 'PUT', JSON.stringify({ settings: scene.settings, walls: scene.walls }))}>{busy ? 'Salvando…' : 'Salvar cenário'}</button>
          <button disabled={!connected || busy} onClick={reload}>Recarregar</button>
        </div>
        <small>Portas abertas deixam o áudio passar. Paredes e portas fechadas abafam o som; ainda não bloqueiam movimento nem visão.</small>
      </>}
      {message && <p role="status" className={styles.message}>{message}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </section>}
  </>
}
