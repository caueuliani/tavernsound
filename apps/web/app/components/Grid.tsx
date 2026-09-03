'use client'

import { useEffect, useRef, useState } from 'react'
import * as PIXI from 'pixi.js'
import io from 'socket.io-client'
import { useSpatialAudio } from '../hooks/useSpatialAudio'
import DiceRoller from './DiceRoller'
import DiceHistory from './DiceHistory'
import MapUploader from './MapUploader'
import ChatBox from './ChatBox'

const GRID_SIZE = 500
const CELL_SIZE = 50
const GRID_CELLS = GRID_SIZE / CELL_SIZE
const TOKEN_RADIUS = 20

const AMBER = 0xff9d00
const WOOD_DARK = 0x1a0f0a
const WOOD_WARM = 0x3d2b1f

const TOKEN_COLORS = [
  0xff9d00, 0xd4af37, 0xe67e22, 0xa35d1e, 0xf1c40f, 0xc0392b,
]

interface Token {
  id: string
  x: number
  y: number
  color: number
  graphics: any // PIXI.Container
  playerId: string
  isOwn?: boolean
  playerName?: string
  nameText?: PIXI.Text
  speakingIndicator?: PIXI.Graphics
  hpBar?: PIXI.Graphics
  circleGraphic?: PIXI.Graphics
  hp?: number
  maxHp?: number
  imageUrl?: string
}

interface TokenEditorState {
  tokenId: string
  isOwn: boolean
  hp: number
  maxHp: number
  x: number
  y: number
}

interface GridProps {
  roomId: string
}

export default function Grid({ roomId }: GridProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const tokensRef = useRef<Map<string, Token>>(new Map())
  const dragTargetRef = useRef<Token | null>(null)
  const socketRef = useRef<any>(null)

  const [tokenCount, setTokenCount] = useState(0)
  const [connected, setConnected] = useState(false)
  const [playerId, setPlayerId] = useState('')
  const [playerName, setPlayerName] = useState('')
  const playerNameRef = useRef('')
  const [myOwnToken, setMyOwnToken] = useState<Token | null>(null)
  const speakingUsersRef = useRef<Set<string>>(new Set())
  const pendingTokensRef = useRef<any[]>([])
  const [diceRolls, setDiceRolls] = useState<any[]>([])
  const [mapData, setMapData] = useState<string | null>(null)
  const [hasMap, setHasMap] = useState(false)
  const mapSpriteRef = useRef<any>(null)

  const [isHost, setIsHost] = useState(false)
  const isHostRef = useRef(false)

  const [chatHistory, setChatHistory] = useState<any[]>([])

  const [tokenEditor, setTokenEditor] = useState<TokenEditorState | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const imageTargetTokenIdRef = useRef('')

  const [fogMode, setFogMode] = useState(false)
  const fogModeRef = useRef(false)
  const fogCellsRef = useRef<PIXI.Graphics[]>([])
  const fogDataRef = useRef<boolean[]>(new Array(GRID_CELLS * GRID_CELLS).fill(true))

  // Sync refs com state para acessar dentro dos closures do PixiJS
  useEffect(() => { isHostRef.current = isHost }, [isHost])
  useEffect(() => { fogModeRef.current = fogMode }, [fogMode])

  const { isConnected: audioConnected, isMuted, toggleMute, remoteUsers, updateSpatialAudio } = useSpatialAudio({
    channelName: roomId,
    myToken: myOwnToken,
    allTokens: tokensRef.current,
    maxDistance: 8,
    mySocketId: playerId,
    socket: socketRef.current,
  })

  const handleRollDice = (formula: string, result: number, rolls: number[], modifier: number) => {
    socketRef.current?.emit('roll-dice', { formula, result, rolls, modifier })
  }
  const handleUploadMap = (mapDataUrl: string, width: number, height: number) => {
    socketRef.current?.emit('upload-map', { mapData: mapDataUrl, width, height })
  }
  const handleRemoveMap = () => socketRef.current?.emit('remove-map', {})

  const handleSaveHp = () => {
    if (!tokenEditor || !socketRef.current) return
    socketRef.current.emit('update-token-hp', {
      tokenId: tokenEditor.tokenId,
      hp: tokenEditor.hp,
      maxHp: tokenEditor.maxHp,
    })
    setTokenEditor(null)
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !imageTargetTokenIdRef.current) return
    if (file.size > 2 * 1024 * 1024) { alert('Imagem máxima: 2MB'); return }

    const reader = new FileReader()
    reader.onload = ev => {
      const img = new Image()
      img.onload = () => {
        const MAX = 256
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = img.width * scale
        canvas.height = img.height * scale
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        const base64 = canvas.toDataURL('image/jpeg', 0.7)
        socketRef.current?.emit('update-token-image', {
          tokenId: imageTargetTokenIdRef.current,
          imageData: base64,
        })
      }
      img.src = ev.target?.result as string
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // Redesenha a barra de HP de um token no PixiJS
  const renderHpBar = (token: Token) => {
    if (!token.hpBar) return
    token.hpBar.clear()
    if (!token.maxHp || token.maxHp <= 0) { token.hpBar.visible = false; return }

    token.hpBar.visible = true
    const ratio = Math.max(0, Math.min(1, (token.hp ?? 0) / token.maxHp))
    const barW = TOKEN_RADIUS * 2
    const barH = 5
    const bx = -TOKEN_RADIUS
    const by = TOKEN_RADIUS + 28
    const color = ratio > 0.5 ? 0x2ecc71 : ratio > 0.2 ? 0xf39c12 : 0xe74c3c

    token.hpBar.rect(bx, by, barW, barH).fill(0x222222)
    if (ratio > 0) token.hpBar.rect(bx, by, barW * ratio, barH).fill(color)
  }

  // Aplica sprite de imagem ao token, mascarado em círculo
  const applyTokenImage = (token: Token, container: any) => {
    if (!token.imageUrl) return
    const img = new Image()
    img.onload = () => {
      const texture = PIXI.Texture.from(img)
      const sprite = new PIXI.Sprite(texture)
      sprite.anchor.set(0.5)
      sprite.width = TOKEN_RADIUS * 2
      sprite.height = TOKEN_RADIUS * 2
      const mask = new PIXI.Graphics()
      mask.circle(0, 0, TOKEN_RADIUS).fill(0xffffff)
      sprite.mask = mask
      container.addChild(mask)
      container.addChild(sprite)
      if (token.circleGraphic) token.circleGraphic.visible = false
    }
    img.src = token.imageUrl
  }

  // ── Pixi + Socket ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (appRef.current) return
    if (canvasRef.current?.children.length > 0) canvasRef.current.innerHTML = ''

    const socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001')
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      setPlayerId(socket.id || '')
      socket.emit('join-room', { roomId })
    })

    socket.on('room-joined', (data: any) => {
      setPlayerName(data.playerName)
      playerNameRef.current = data.playerName
      setIsHost(Boolean(data.isHost))
      isHostRef.current = Boolean(data.isHost)

      window.dispatchEvent(new CustomEvent('room-player-count', {
        detail: { count: data.players.length },
      }))

      if (data.tokens?.length > 0) pendingTokensRef.current = data.tokens
      if (data.recentRolls?.length > 0) setDiceRolls(data.recentRolls)
      if (data.chatHistory?.length > 0) setChatHistory(data.chatHistory)

      if (Array.isArray(data.fogData) && data.fogData.length === GRID_CELLS * GRID_CELLS) {
        fogDataRef.current = data.fogData
        fogCellsRef.current.forEach((cell, idx) => { cell.visible = !data.fogData[idx] })
      }

      if (data.mapUrl) {
        setMapData(data.mapUrl)
        setHasMap(true)
      }
    })

    socket.on('room-player-count', (data: { count: number }) => {
      window.dispatchEvent(new CustomEvent('room-player-count', { detail: { count: data.count } }))
    })

    socket.on('disconnect', () => setConnected(false))

    socket.on('player-speaking-update', (data: { playerId: string; isSpeaking: boolean }) => {
      const s = new Set(speakingUsersRef.current)
      data.isSpeaking ? s.add(data.playerId) : s.delete(data.playerId)
      speakingUsersRef.current = s
    })

    socket.on('dice-rolled', (data: any) => setDiceRolls(prev => [...prev, data]))

    socket.on('map-uploaded', (data: { mapData: string }) => { setMapData(data.mapData); setHasMap(true) })
    socket.on('map-removed', () => { setMapData(null); setHasMap(false) })

    socket.on('fog-updated', (data: { fogData: boolean[] }) => {
      fogDataRef.current = data.fogData
      fogCellsRef.current.forEach((cell, idx) => { cell.visible = !data.fogData[idx] })
    })

    socket.on('player-joined', () => {})
    socket.on('player-left', () => {})

    const initPixi = async () => {
      if (appRef.current) return

      const app = new PIXI.Application()
      await app.init({ width: GRID_SIZE, height: GRID_SIZE, backgroundColor: WOOD_DARK, antialias: true })
      appRef.current = app

      if (canvasRef.current) {
        canvasRef.current.innerHTML = ''
        canvasRef.current.appendChild(app.canvas)
      }

      // Layers: 0=map, 1=grid, 2=fog, 3=tokens
      const gridContainer = new PIXI.Container()
      app.stage.addChild(gridContainer)

      const mapContainer = new PIXI.Container()
      app.stage.addChildAt(mapContainer, 0)

      const fogContainer = new PIXI.Container()
      app.stage.addChildAt(fogContainer, 2)

      const tokensContainer = new PIXI.Container()
      app.stage.addChild(tokensContainer)

      // Grid lines
      const gridGraphics = new PIXI.Graphics()
      gridContainer.addChild(gridGraphics)
      const drawGrid = (withMap: boolean) => {
        gridGraphics.clear()
        const alpha = withMap ? 0.3 : 1
        for (let i = 0; i <= GRID_CELLS; i++) {
          gridGraphics.lineStyle(1, 0x444444, alpha)
          gridGraphics.moveTo(i * CELL_SIZE, 0).lineTo(i * CELL_SIZE, GRID_SIZE)
        }
        for (let i = 0; i <= GRID_CELLS; i++) {
          gridGraphics.lineStyle(1, 0x444444, alpha)
          gridGraphics.moveTo(0, i * CELL_SIZE).lineTo(GRID_SIZE, i * CELL_SIZE)
        }
      }
      drawGrid(false)

      // Info label
      const infoText = new PIXI.Text({
        text: 'Clique: criar token | Arraste: mover | Botão direito: editar',
        style: { fontFamily: 'Arial', fontSize: 10, fill: 0xaaaaaa, align: 'center' },
      })
      infoText.x = GRID_SIZE / 2 - infoText.width / 2
      infoText.y = 8
      app.stage.addChild(infoText)

      // Fog cells (all revealed initially)
      const cells: PIXI.Graphics[] = []
      for (let row = 0; row < GRID_CELLS; row++) {
        for (let col = 0; col < GRID_CELLS; col++) {
          const cell = new PIXI.Graphics()
          cell.rect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE).fill({ color: 0x000000, alpha: 0.85 })
          cell.visible = !fogDataRef.current[row * GRID_CELLS + col]
          fogContainer.addChild(cell)
          cells.push(cell)
        }
      }
      fogCellsRef.current = cells

      const pixelToGrid = (px: number) => Math.floor(px / CELL_SIZE)
      const gridToPixel = (cell: number) => cell * CELL_SIZE + CELL_SIZE / 2

      const createTokenGraphics = (token: Token, isOwn: boolean) => {
        const container = new PIXI.Container()

        const speakingIndicator = new PIXI.Graphics()
        speakingIndicator.circle(0, 0, TOKEN_RADIUS + 8).stroke({ width: 4, color: AMBER, alpha: 0.8 })
        speakingIndicator.visible = false
        token.speakingIndicator = speakingIndicator

        const circle = new PIXI.Graphics()
        circle.circle(0, 0, TOKEN_RADIUS).fill(token.color)
        circle.stroke({ width: isOwn ? 3 : 2, color: isOwn ? 0xffffff : 0x888888 })
        token.circleGraphic = circle

        const nameText = new PIXI.Text({
          text: token.playerName || 'Unknown',
          style: { fontFamily: 'Arial', fontSize: 10, fill: 0xffffff, align: 'center', stroke: { color: 0x000000, width: 2 } },
        })
        nameText.anchor.set(0.5)
        nameText.y = TOKEN_RADIUS + 15
        token.nameText = nameText

        const hpBar = new PIXI.Graphics()
        hpBar.visible = false
        token.hpBar = hpBar

        container.addChild(speakingIndicator)
        container.addChild(circle)
        container.addChild(nameText)
        container.addChild(hpBar)
        container.x = gridToPixel(token.x)
        container.y = gridToPixel(token.y)
        container.eventMode = 'static'

        if (token.imageUrl) applyTokenImage(token, container)

        // Clique direito: abre editor de HP e imagem
        container.on('rightclick', (event: PIXI.FederatedPointerEvent) => {
          if (isOwn || isHostRef.current) {
            setTokenEditor({
              tokenId: token.id,
              isOwn,
              hp: token.hp ?? 0,
              maxHp: token.maxHp ?? 0,
              x: event.client.x,
              y: event.client.y,
            })
          }
        })

        if (isOwn) {
          container.cursor = 'pointer'
          container.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation()
            dragTargetRef.current = token
            app.stage.cursor = 'grabbing'
          })
        }

        container.on('pointerover', () => {
          container.cursor = 'pointer'
          nameText.style.fontSize = 12
          nameText.style.fill = 0x4ecdc4
        })
        container.on('pointerout', () => {
          nameText.style.fontSize = 10
          nameText.style.fill = 0xffffff
        })

        return container
      }

      const addToken = (tokenData: Omit<Token, 'graphics'>, isOwn: boolean) => {
        const token: Token = { ...tokenData, isOwn, graphics: null as any }
        const container = createTokenGraphics(token, isOwn)
        token.graphics = container
        renderHpBar(token)
        tokensContainer.addChild(container)
        tokensRef.current.set(tokenData.playerId, token)
        setTokenCount(tokensRef.current.size)
        if (isOwn) setMyOwnToken(token)
      }

      if (pendingTokensRef.current.length > 0) {
        pendingTokensRef.current.forEach((t: any) => {
          if (!tokensRef.current.has(t.playerId)) addToken(t, t.playerId === socket.id)
        })
        pendingTokensRef.current = []
      }

      socket.on('token-created', (tokenData: Token) => {
        const isOwn = tokenData.playerId === socket.id
        if (!tokensRef.current.has(tokenData.playerId)) addToken(tokenData, isOwn)
      })

      socket.on('token-moved', (data: { tokenId: string; x: number; y: number; playerId: string }) => {
        const token = tokensRef.current.get(data.playerId)
        if (token && token.playerId !== socket.id) {
          token.x = data.x
          token.y = data.y
          token.graphics.x = gridToPixel(data.x)
          token.graphics.y = gridToPixel(data.y)
          updateSpatialAudio()
        }
      })

      socket.on('remove-player-tokens', (data: { playerId: string }) => {
        const token = tokensRef.current.get(data.playerId)
        if (token) { tokensContainer.removeChild(token.graphics); tokensRef.current.delete(data.playerId) }
        setTokenCount(tokensRef.current.size)
      })

      socket.on('token-hp-updated', (data: { tokenId: string; hp: number; maxHp: number }) => {
        tokensRef.current.forEach(token => {
          if (token.id === data.tokenId) {
            token.hp = data.hp
            token.maxHp = data.maxHp
            renderHpBar(token)
          }
        })
      })

      socket.on('token-image-updated', (data: { tokenId: string; imageData: string }) => {
        tokensRef.current.forEach(token => {
          if (token.id === data.tokenId) {
            token.imageUrl = data.imageData
            applyTokenImage(token, token.graphics)
          }
        })
      })

      // Stage input
      app.stage.eventMode = 'static'
      app.stage.hitArea = new PIXI.Rectangle(0, 0, GRID_SIZE, GRID_SIZE)

      app.stage.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
        if (dragTargetRef.current) return

        const pos = event.global
        const gridX = pixelToGrid(pos.x)
        const gridY = pixelToGrid(pos.y)

        // Modo névoa: clique revela/oculta célula (host apenas)
        if (fogModeRef.current && isHostRef.current) {
          if (gridX >= 0 && gridX < GRID_CELLS && gridY >= 0 && gridY < GRID_CELLS) {
            const idx = gridY * GRID_CELLS + gridX
            fogDataRef.current[idx] = !fogDataRef.current[idx]
            const cell = fogCellsRef.current[idx]
            if (cell) cell.visible = !fogDataRef.current[idx]
            socket.emit('fog-update', { fogData: [...fogDataRef.current] })
          }
          return
        }

        const isOccupied = Array.from(tokensRef.current.values()).some(t => t.x === gridX && t.y === gridY)
        if (!isOccupied && gridX >= 0 && gridX < GRID_CELLS && gridY >= 0 && gridY < GRID_CELLS) {
          const tokenId = `${socket.id}-${Date.now()}`
          const color = TOKEN_COLORS[tokensRef.current.size % TOKEN_COLORS.length]
          addToken({ id: tokenId, x: gridX, y: gridY, color, playerId: socket.id || '', playerName: playerNameRef.current || 'Unknown' }, true)
          socket.emit('create-token', { tokenId, x: gridX, y: gridY, color, playerName: playerNameRef.current || 'Unknown' })
        }
      })

      app.stage.on('pointermove', (event: PIXI.FederatedPointerEvent) => {
        if (dragTargetRef.current) {
          dragTargetRef.current.graphics.x = event.global.x
          dragTargetRef.current.graphics.y = event.global.y
        }
      })

      app.stage.on('pointerup', () => {
        if (dragTargetRef.current) {
          const token = dragTargetRef.current
          const gridX = pixelToGrid(token.graphics.x)
          const gridY = pixelToGrid(token.graphics.y)
          const cx = Math.max(0, Math.min(GRID_CELLS - 1, gridX))
          const cy = Math.max(0, Math.min(GRID_CELLS - 1, gridY))

          const occupied = Array.from(tokensRef.current.values()).find(t => t !== token && t.x === cx && t.y === cy)
          if (occupied) {
            token.graphics.x = gridToPixel(token.x)
            token.graphics.y = gridToPixel(token.y)
          } else {
            token.x = cx
            token.y = cy
            token.graphics.x = gridToPixel(cx)
            token.graphics.y = gridToPixel(cy)
            if (token.isOwn) setMyOwnToken({ ...token })
            socket.emit('move-token', { tokenId: token.id, x: cx, y: cy })
          }

          dragTargetRef.current = null
          app.stage.cursor = 'default'
        }
      })

      app.stage.on('pointerupoutside', () => {
        if (dragTargetRef.current) {
          const token = dragTargetRef.current
          token.graphics.x = gridToPixel(token.x)
          token.graphics.y = gridToPixel(token.y)
          dragTargetRef.current = null
          app.stage.cursor = 'default'
        }
      })

      // Animação do indicador de fala
      app.ticker.add(() => {
        tokensRef.current.forEach(token => {
          if (!token.speakingIndicator) return
          const speaking = speakingUsersRef.current.has(token.playerId)
          token.speakingIndicator.visible = speaking
          if (speaking) {
            const t = Date.now() / 500
            token.speakingIndicator.scale.set(1 + Math.sin(t) * 0.2)
            token.speakingIndicator.alpha = 0.5 + Math.sin(t) * 0.3
          }
        })
      })
    }

    initPixi()

    return () => {
      socketRef.current?.disconnect()
      socketRef.current = null
      appRef.current?.destroy(true, { children: true })
      appRef.current = null
      if (canvasRef.current) canvasRef.current.innerHTML = ''
    }
  }, [roomId])

  // ── Mapa: recarregar quando muda ──────────────────────────────────────────
  useEffect(() => {
    if (!appRef.current) return
    const app = appRef.current
    const mapContainer = app.stage.getChildAt(0) as any

    if (mapSpriteRef.current) {
      mapContainer.removeChild(mapSpriteRef.current)
      mapSpriteRef.current.destroy()
      mapSpriteRef.current = null
    }

    if (mapData) {
      const img = new Image()
      img.onload = () => {
        const texture = PIXI.Texture.from(img)
        const sprite = new PIXI.Sprite(texture)
        sprite.scale.set(Math.max(GRID_SIZE / img.width, GRID_SIZE / img.height))
        sprite.anchor.set(0).position.set(0, 0)
        mapContainer.addChild(sprite)
        mapSpriteRef.current = sprite
      }
      img.src = mapData
    }

    const gridContainer = app.stage.getChildAt(1) as any
    const g = gridContainer.children[0] as PIXI.Graphics
    if (g) {
      g.clear()
      const alpha = mapData ? 0.3 : 1
      for (let i = 0; i <= GRID_CELLS; i++) {
        g.lineStyle(1, 0x444444, alpha)
        g.moveTo(i * CELL_SIZE, 0).lineTo(i * CELL_SIZE, GRID_SIZE)
      }
      for (let i = 0; i <= GRID_CELLS; i++) {
        g.lineStyle(1, 0x444444, alpha)
        g.moveTo(0, i * CELL_SIZE).lineTo(GRID_SIZE, i * CELL_SIZE)
      }
    }
  }, [mapData])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', color: '#f4e4bc' }}>
      {/* Coluna do canvas */}
      <div style={{ position: 'relative' }}>
        <div
          ref={canvasRef}
          onContextMenu={e => e.preventDefault()}
          style={{ border: '4px solid #3d2b1f', borderRadius: '4px', display: 'inline-block' }}
        />

        {/* Painel editor de token (HP + imagem) */}
        {tokenEditor && (
          <div
            style={{
              position: 'fixed',
              left: tokenEditor.x + 12,
              top: tokenEditor.y,
              zIndex: 1000,
              background: '#1a0f0a',
              border: '1px solid #ff9d00',
              borderRadius: '10px',
              padding: '1rem',
              minWidth: '210px',
              boxShadow: '0 4px 24px rgba(0,0,0,0.7)',
              color: '#f4e4bc',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <strong style={{ color: '#ff9d00', fontSize: '0.9rem' }}>Editar Token</strong>
              <button onClick={() => setTokenEditor(null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {([['HP', 'hp'], ['Máx HP', 'maxHp']] as const).map(([label, field]) => (
                <div key={field}>
                  <label style={{ display: 'block', fontSize: '0.7rem', color: '#a35d1e', marginBottom: '2px' }}>{label}</label>
                  <input
                    type="number"
                    value={tokenEditor[field]}
                    min={0}
                    onChange={e => setTokenEditor(prev => prev ? { ...prev, [field]: parseInt(e.target.value) || 0 } : null)}
                    style={{ width: '72px', padding: '0.35rem', background: '#0a0508', border: '1px solid #3d2b1f', borderRadius: '4px', color: '#f4e4bc', fontSize: '0.9rem' }}
                  />
                </div>
              ))}
            </div>

            <button
              onClick={handleSaveHp}
              style={{ width: '100%', padding: '0.4rem', background: '#ff9d00', color: '#1a0f0a', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '0.5rem', fontSize: '0.85rem' }}
            >
              Salvar HP
            </button>

            {tokenEditor.isOwn && (
              <button
                onClick={() => {
                  imageTargetTokenIdRef.current = tokenEditor.tokenId
                  imageInputRef.current?.click()
                  setTokenEditor(null)
                }}
                style={{ width: '100%', padding: '0.4rem', background: 'transparent', color: '#d4af37', border: '1px solid #d4af37', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                Trocar Imagem
              </button>
            )}
          </div>
        )}

        {/* Input de imagem oculto */}
        <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageSelect} style={{ display: 'none' }} />

        {/* Status + controles */}
        <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.3)', borderRadius: '12px', fontSize: '0.85rem', color: '#888' }}>
          <p style={{ color: connected ? '#4ecdc4' : '#ff6b6b', margin: '0 0 4px' }}>
            {connected ? '✅ Conectado' : '❌ Desconectado'}
            {playerId && ` · ${playerId.slice(0, 8)}…`}
          </p>
          <p style={{ color: audioConnected ? '#ff9d00' : '#555', margin: '0 0 8px' }}>
            {audioConnected ? '🔊 Áudio espacial ativo' : '⏳ Conectando áudio…'}
          </p>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={toggleMute}
              style={{ padding: '0.4rem 0.75rem', background: isMuted ? '#555' : '#ff9d00', color: '#1a0f0a', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
            >
              {isMuted ? '🔇 Mudo' : '🎤 Ativo'}
            </button>

            {isHost && (
              <button
                onClick={() => setFogMode(v => !v)}
                style={{ padding: '0.4rem 0.75rem', background: fogMode ? '#3b82f6' : 'transparent', color: fogMode ? '#fff' : '#888', border: '1px solid #444', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem' }}
              >
                {fogMode ? '🌫️ Névoa: ON' : '🌫️ Névoa'}
              </button>
            )}
          </div>

          {fogMode && (
            <p style={{ fontSize: '0.72rem', color: '#3b82f6', margin: '6px 0 0' }}>
              Clique nas células para revelar / ocultar.
            </p>
          )}
          <p style={{ fontSize: '0.72rem', color: '#555', margin: '4px 0 0' }}>
            Botão direito no token → editar HP / imagem
          </p>
        </div>
      </div>

      {/* Painel lateral */}
      <div style={{ flex: 1, minWidth: '300px', maxWidth: '400px' }}>
        <MapUploader onUpload={handleUploadMap} onRemove={handleRemoveMap} hasMap={hasMap} isHost={isHost} />
        <DiceRoller onRoll={handleRollDice} playerName={playerName} />
        <DiceHistory rolls={diceRolls} myPlayerId={playerId} />
        <ChatBox socket={socketRef.current} myPlayerName={playerName} initialMessages={chatHistory} />
      </div>
    </div>
  )
}
