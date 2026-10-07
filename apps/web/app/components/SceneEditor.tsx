'use client'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode, PointerEvent } from 'react'
import { apiUrl } from '../lib/api-url'
import { addPolylinePoint, emptyPolyline, openingBounds, pointOnWall, polylineShortcut, projectOnWall, solidSegments, undoPolyline, validOpenings, type Opening, type Polyline } from '../lib/scene-geometry'
import styles from './SceneEditor.module.css'

export interface SceneWall { id: string; x1: number; y1: number; x2: number; y2: number; isDoor: boolean; isOpen: boolean; blocksAudio: boolean; openings?: Opening[] }
export interface Scene {
  revision: number
  map: { url: string; width: number; height: number } | null
  settings: { scale: number; x: number; y: number; gridOpacity: number }
  walls: SceneWall[]
}
const initial = (): Scene => ({ revision: 0, map: null, settings: { scale: 1, x: 0, y: 0, gridOpacity: .3 }, walls: [] })
type Point = { x: number; y: number }
type Tool = 'play' | 'wall' | 'door' | 'window' | 'cave' | 'select'
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
  const [polyline, setPolyline] = useState<Polyline>(emptyPolyline)
  const [hover, setHover] = useState<Point | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedOpening, setSelectedOpening] = useState<string | null>(null)
  const [snap, setSnap] = useState(true)
  const [past, setPast] = useState<Scene[]>([])
  const [future, setFuture] = useState<Scene[]>([])
  const drag = useRef<{ point: Point; wall: SceneWall; endpoint?: 'start' | 'end' } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const endpoint = apiUrl(`/rooms/${roomId}/scene`)
  const editable = isHost && enabled && loaded && connected && !busy
  const active = editable ? tool : 'play'
  const selectedWall = scene.walls.find(w => w.id === selected)
  const opening = selectedWall?.openings?.find(item => item.id === selectedOpening)
  const accept = (value: Scene) => {
    setScene(value); sceneRef.current = value; setDirty(false); dirtyRef.current = false
    setPast([]); setFuture([]); setLoaded(true); setPolyline(emptyPolyline()); setError('')
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
  }).filter(item => item.distance < .44).sort((a, b) => a.distance - b.distance)[0]?.wall
  const finishPolyline = () => { setPolyline(emptyPolyline()); setHover(null) }
  const undoLast = () => {
    const result = undoPolyline(polyline, scene.walls)
    if (result.walls.length !== scene.walls.length) {
      edit({ ...scene, walls: result.walls }); setPolyline(result.polyline)
    }
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!polyline.start || !['wall', 'cave'].includes(tool) || event.target instanceof HTMLInputElement) return
      const action = polylineShortcut(event.key)
      if (action) event.preventDefault()
      if (action === 'finish') finishPolyline()
      if (action === 'undo') undoLast()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [polyline, scene, tool])
  const updateOpening = (value: Opening) => {
    if (!selectedWall) return
    const openings = (selectedWall.openings || []).map(item => item.id === value.id ? value : item)
    if (!validOpenings(openings)) { setError('Abertura fora da parede ou sobreposta.'); return }
    edit({ ...scene, walls: scene.walls.map(w => w.id === selectedWall.id ? { ...w, openings } : w) })
  }
  const pointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || active === 'play') return
    const p = point(e)
    if (active === 'select') {
      const wall = nearest(p); setSelected(wall?.id || null)
      const nearestOpening = wall?.openings?.find(item => Math.abs(projectOnWall(wall, p.x, p.y) - item.position) < Math.max(item.width / 2, .12))
      setSelectedOpening(nearestOpening?.id || null)
      if (wall && !nearestOpening) {
        const endpoint = Math.hypot(p.x - wall.x1, p.y - wall.y1) < .44 ? 'start' : Math.hypot(p.x - wall.x2, p.y - wall.y2) < .44 ? 'end' : undefined
        drag.current = { point: p, wall, endpoint }; e.currentTarget.setPointerCapture(e.pointerId)
      }
      return
    }
    if (active === 'door' || active === 'window') {
      const wall = nearest(p)
      if (!wall || wall.isDoor) { setError('Toque sobre uma parede para criar a abertura.'); return }
      const width = .2, position = Math.max(width / 2, Math.min(1 - width / 2, projectOnWall(wall, p.x, p.y)))
      const next: Opening = { id: crypto.randomUUID(), type: active, position, width, isOpen: false }
      const openings = [...(wall.openings || []), next]
      if (!validOpenings(openings)) { setError('Abertura sobreposta. Escolha outro ponto.'); return }
      edit({ ...scene, walls: scene.walls.map(item => item.id === wall.id ? { ...item, openings } : item) })
      setSelected(wall.id); setSelectedOpening(next.id)
      return
    }
    if (scene.walls.length >= 200 && polyline.start) { setError('Limite de 200 segmentos atingido.'); return }
    const id = crypto.randomUUID()
    const result = addPolylinePoint(polyline, p, id)
    setPolyline(result.polyline); setHover(p)
    if (result.segment) {
      const wall: SceneWall = { id, ...result.segment, isDoor: false, isOpen: false, blocksAudio: true }
      edit({ ...scene, walls: [...scene.walls, wall] })
    }
  }
  const pointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const current = drag.current; drag.current = null
    if (!current) return
    const p = point(e), w = current.wall
    const dx = Math.max(-Math.min(w.x1, w.x2), Math.min(10 - Math.max(w.x1, w.x2), p.x - current.point.x))
    const dy = Math.max(-Math.min(w.y1, w.y2), Math.min(10 - Math.max(w.y1, w.y2), p.y - current.point.y))
    if (dx || dy) edit({ ...scene, walls: scene.walls.map(item => item.id === w.id ? current.endpoint === 'start'
      ? { ...w, x1: Math.max(0, Math.min(10, w.x1 + dx)), y1: Math.max(0, Math.min(10, w.y1 + dy)) }
      : current.endpoint === 'end' ? { ...w, x2: Math.max(0, Math.min(10, w.x2 + dx)), y2: Math.max(0, Math.min(10, w.y2 + dy)) }
        : { ...w, x1: w.x1 + dx, x2: w.x2 + dx, y1: w.y1 + dy, y2: w.y2 + dy } : item) })
  }
  return <>
    <div style={{ position: 'relative', width: 508, height: 508 }}>
      {children}
      <svg aria-label="Paredes e portas do cenário" className={styles.overlay} viewBox="0 0 500 500" style={{ pointerEvents: active === 'play' ? 'none' : 'auto', cursor: active === 'select' ? 'move' : 'crosshair' }}
        onPointerDown={pointerDown} onPointerMove={e => setHover(point(e))} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null }}>
        {scene.walls.map(w => <g key={w.id}>
          {solidSegments(w).map((segment, index) => <g key={index}>
            <line x1={segment.x1 * 50} y1={segment.y1 * 50} x2={segment.x2 * 50} y2={segment.y2 * 50} stroke="#120d09" strokeWidth="7" opacity=".8" />
            <line x1={segment.x1 * 50} y1={segment.y1 * 50} x2={segment.x2 * 50} y2={segment.y2 * 50} stroke={active === 'select' && selected === w.id ? '#fff' : w.isDoor ? w.isOpen ? '#64d7a2' : '#ffbf62' : '#a3b4ca'} strokeWidth="3" strokeDasharray={w.isOpen ? '7 7' : undefined} />
          </g>)}
          {w.isDoor && <text x={(w.x1 + w.x2) * 25 + 5} y={(w.y1 + w.y2) * 25 - 5} fill={w.isOpen ? '#64d7a2' : '#ffbf62'} fontSize="11" stroke="#120d09" strokeWidth="3" paintOrder="stroke">{w.isOpen ? 'Aberta' : 'Porta'}</text>}
          {w.openings?.map(item => {
            const [left, right] = openingBounds(item), a = pointOnWall(w, left), b = pointOnWall(w, right)
            return <g key={item.id}>
              <line x1={a.x * 50} y1={a.y * 50} x2={b.x * 50} y2={b.y * 50} stroke={item.type === 'window' ? '#8fd3ff' : item.isOpen ? '#64d7a2' : '#ffbf62'} strokeWidth="4" strokeDasharray={item.isOpen ? '7 7' : undefined} />
              <circle cx={(a.x + b.x) * 25} cy={(a.y + b.y) * 25} r="5" fill={item.type === 'window' ? '#8fd3ff' : '#ffbf62'} />
            </g>
          })}
          {active === 'select' && selected === w.id && <>
            <circle cx={w.x1 * 50} cy={w.y1 * 50} r="12" fill="#fff" fillOpacity=".35" />
            <circle cx={w.x2 * 50} cy={w.y2 * 50} r="12" fill="#fff" fillOpacity=".35" />
          </>}
        </g>)}
        {polyline.start && hover && (active === 'wall' || active === 'cave') && <line x1={polyline.start.x * 50} y1={polyline.start.y * 50} x2={hover.x * 50} y2={hover.y * 50} stroke="#fff" strokeWidth="2" strokeDasharray="4 4" />}
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
          {([['play', 'Jogar'], ['wall', 'Parede'], ['door', 'Porta'], ['window', 'Janela'], ['cave', 'Caverna'], ['select', 'Selecionar / mover']] as const).map(([id, label]) => <button key={id} disabled={!editable} aria-pressed={tool === id} onClick={() => { setTool(id); finishPolyline() }}>{label}</button>)}
        </div>
        <p>{tool === 'play' ? 'Modo de jogo: os cliques criam ou movem seu token.' : tool === 'select' ? 'Toque em um segmento ou vértice e arraste para reposicionar.' : tool === 'door' || tool === 'window' ? 'Toque sobre uma parede para inserir uma abertura.' : 'Toque nos vértices em sequência. Esc ou Finalizar encerra; Backspace desfaz o último segmento.'}</p>
        <div className={styles.row}>
          <label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} />Encaixar na meia célula</label>
          {polyline.start && <button onClick={finishPolyline}>Finalizar</button>}
          {polyline.segmentIds.length > 0 && <button onClick={undoLast}>Desfazer último</button>}
          <span>{scene.walls.length}/200 segmentos</span>
        </div>
        {selectedWall && <div className={styles.row}>
          <span>{selectedWall.isDoor ? 'Porta selecionada' : 'Parede selecionada'}</span>
          {selectedWall.isDoor && <button disabled={!editable} onClick={() => edit({ ...scene, walls: scene.walls.map(w => w.id === selected ? { ...w, isOpen: !w.isOpen } : w) })}>{selectedWall.isOpen ? 'Fechar porta' : 'Abrir porta'}</button>}
          {selectedWall.openings?.map(item => <button key={item.id} disabled={!editable} onClick={() => setSelectedOpening(item.id)}>{item.type === 'door' ? 'Porta' : 'Janela'} {item.id === selectedOpening ? '✓' : ''}</button>)}
          <button disabled={!editable} onClick={() => { edit({ ...scene, walls: scene.walls.filter(w => w.id !== selected) }); setSelected(null) }}>Apagar segmento</button>
        </div>}
        {opening && <div className={styles.row}>
          <label>Posição <input type="range" min={opening.width / 2} max={1 - opening.width / 2} step=".01" disabled={!editable} value={opening.position} onChange={e => updateOpening({ ...opening, position: Number(e.target.value) })} /></label>
          <label>Largura <input type="range" min=".04" max={Math.min(1, opening.position * 2, (1 - opening.position) * 2)} step=".01" disabled={!editable} value={opening.width} onChange={e => updateOpening({ ...opening, width: Number(e.target.value) })} /></label>
          {opening.type === 'door' && <button disabled={!editable} onClick={() => updateOpening({ ...opening, isOpen: !opening.isOpen })}>{opening.isOpen ? 'Fechar porta' : 'Abrir porta'}</button>}
          <button disabled={!editable} onClick={() => { edit({ ...scene, walls: scene.walls.map(w => w.id === selected ? { ...w, openings: w.openings?.filter(item => item.id !== opening.id) } : w) }); setSelectedOpening(null) }}>Remover abertura</button>
        </div>}
        <div className={styles.row}>
          <button disabled={!editable || !past.length} onClick={() => { setFuture(f => [scene, ...f]); setScene(past[past.length - 1]); setPast(p => p.slice(0, -1)); setDirty(true) }}>Desfazer</button>
          <button disabled={!editable || !future.length} onClick={() => { setPast(p => [...p, scene]); setScene(future[0]); setFuture(f => f.slice(1)); setDirty(true) }}>Refazer</button>
          <button className={styles.save} disabled={!editable || !dirty} onClick={() => request('', 'PUT', JSON.stringify({ settings: scene.settings, walls: scene.walls }))}>{busy ? 'Salvando…' : 'Salvar cenário'}</button>
          <button disabled={!connected || busy} onClick={reload}>Recarregar</button>
        </div>
        <small>Portas abertas e janelas deixam o áudio passar pelo vão. Paredes e portas fechadas abafam o som; ainda não bloqueiam movimento nem visão.</small>
      </>}
      {message && <p role="status" className={styles.message}>{message}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </section>}
  </>
}
