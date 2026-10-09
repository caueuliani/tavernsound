'use client'

import { useEffect, useRef, useState } from 'react'
import * as PIXI from 'pixi.js'
import { io } from 'socket.io-client'
import { useSpatialAudio } from '../hooks/useSpatialAudio'
import DiceRoller from './DiceRoller'
import DiceHistory from './DiceHistory'
import type { Scene } from './SceneEditor'
import ChatBox from './ChatBox'
import RoomMembers from './RoomMembers'
import { apiUrl, socketUrl } from '../lib/api-url'
import { TOKEN_IMAGE_FALLBACK, tokenImageError } from '../lib/token-image-error'
import { openingBounds, pointOnWall, solidSegments } from '../lib/scene-geometry'
import { DEFAULT_GRID_SIZE, gridLinePositions } from '../lib/scene-grid'
import { lastValidTokenCell, movementSegments, TOKEN_SIZES, tokenCenter, tokenHudLayout, tokenRadius, tokenSize, validTokenMove, validTokenPosition } from '../lib/token-movement'
import styles from './Grid.module.css'

const GRID_SIZE = 500
const CELL_SIZE = 50
const GRID_CELLS = GRID_SIZE / CELL_SIZE
const TOKEN_RADIUS = 20

const AMBER = 0xff9d00
const WOOD_DARK = 0x1a0f0a
const WOOD_WARM = 0x3d2b1f
const displayTokenName = (name: string) => name.length > 20 ? `${name.slice(0, 19)}…` : name

const TOKEN_COLORS = [
  0xff9d00, 0xd4af37, 0xe67e22, 0xa35d1e, 0xf1c40f, 0xc0392b,
]

interface Token {
  id: string
  kind?: 'PLAYER' | 'SCENERY'
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
  size?: number
  bodyGraphic?: PIXI.Container
  portraitSprite?: PIXI.Sprite
  portraitMask?: PIXI.Graphics
  portraitRequest?: number
}

interface TokenEditorState {
  tokenId: string
  kind?: 'PLAYER' | 'SCENERY'
  name: string
  isOwn: boolean
  hp: number
  maxHp: number
  size: number
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
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null)
  const socketRef = useRef<any>(null)

  const [tokenCount, setTokenCount] = useState(0)
  const [connected, setConnected] = useState(false)
  const [roomError, setRoomError] = useState('')
  const [portraitError, setPortraitError] = useState('')
  const [testMode, setTestMode] = useState(true)
  const [testEndsAt, setTestEndsAt] = useState<number | null>(null)
  const [playerId, setPlayerId] = useState('')
  const [playerName, setPlayerName] = useState('')
  const playerNameRef = useRef('')
  const [myOwnToken, setMyOwnToken] = useState<Token | null>(null)
  const speakingUsersRef = useRef<Set<string>>(new Set())
  const hostSocketIdsRef = useRef<Set<string>>(new Set())
  const pendingTokensRef = useRef<any[]>([])
  const creatingTokenRef = useRef(false)
  const addTokenRef = useRef<((token: any, own: boolean) => void) | null>(null)
  const [diceRolls, setDiceRolls] = useState<any[]>([])
  const [mapData, setMapData] = useState<string | null>(null)
  const [scene, setScene] = useState<Scene | null>(null)
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const [canvasReady, setCanvasReady] = useState(false)
  const mapSpriteRef = useRef<any>(null)

  const [isHost, setIsHost] = useState(false)
  const isHostRef = useRef(false)

  const [chatHistory, setChatHistory] = useState<any[]>([])
  const [panelsOpen, setPanelsOpen] = useState(true)
  const [mobileTab, setMobileTab] = useState<'chat' | 'dice'>('chat')

  const [tokenEditor, setTokenEditor] = useState<TokenEditorState | null>(null)
  const [tokenEditorError, setTokenEditorError] = useState('')
  const [deletingToken, setDeletingToken] = useState(false)
  const [savingToken, setSavingToken] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const imageTargetTokenIdRef = useRef('')

  const [fogMode, setFogMode] = useState(false)
  const fogModeRef = useRef(false)
  const fogCellsRef = useRef<PIXI.Graphics[]>([])
  const fogDataRef = useRef<boolean[]>(new Array(GRID_CELLS * GRID_CELLS).fill(true))

  // Sync refs com state para acessar dentro dos closures do PixiJS
  useEffect(() => { isHostRef.current = isHost }, [isHost])
  useEffect(() => { fogModeRef.current = fogMode }, [fogMode])

  const { isConnected: audioConnected, playbackBlocked, enablePlayback, audioError, audioStatus, retryAudio, isMuted, toggleMute, remoteUsers, updateSpatialAudio } = useSpatialAudio({
    channelName: roomId,
    isHost,
    myToken: isHost ? null : myOwnToken,
    allTokens: tokensRef.current,
    walls: scene?.walls || [],
    maxDistance: 8,
    mySocketId: playerId,
    socket: socketRef.current,
    onLocalSpeakingChange: speaking => {
      const id = socketRef.current?.id
      if (id) {
        if (speaking) speakingUsersRef.current.add(id)
        else speakingUsersRef.current.delete(id)
      }
    },
  })

  const handleRollDice = (formula: string, result: number, rolls: number[], modifier: number) => {
    socketRef.current?.emit('roll-dice', { formula, result, rolls, modifier })
  }
  const handleSaveHp = () => {
    if (!tokenEditor || !socketRef.current) return
    socketRef.current.emit('update-token-hp', {
      tokenId: tokenEditor.tokenId,
      hp: tokenEditor.hp,
      maxHp: tokenEditor.maxHp,
    })
    setTokenEditor(null)
  }

  const updateTokenNameById = (tokenId: string, name: string) => {
    for (const token of tokensRef.current.values()) {
      if (token.id !== tokenId) continue
      token.playerName = name
      if (token.nameText) token.nameText.text = displayTokenName(name)
    }
  }

  const handleSaveToken = async () => {
    if (!tokenEditor || !isHost || tokenEditor.kind !== 'SCENERY' || savingToken || !socketRef.current) return
    const name = tokenEditor.name.trim()
    if (!name) { setTokenEditorError('Informe um nome para o token.'); return }
    if (name.length > 80) { setTokenEditorError('O nome deve ter no máximo 80 caracteres.'); return }
    setSavingToken(true)
    setTokenEditorError('')
    try {
      const response = await fetch(apiUrl(`/rooms/${roomId}/tokens/${tokenEditor.tokenId}`), {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, size: tokenEditor.size }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) {
        const safeMessages = ['Informe um nome para o token.', 'O nome deve ter no máximo 80 caracteres.', 'Você não pode editar este token.', 'Token não encontrado.', 'Tamanho de token inválido.', 'Este tamanho não cabe na posição atual do token.']
        setTokenEditorError(safeMessages.includes(result?.message) ? result.message : 'Não foi possível salvar as alterações.')
        return
      }
      if (typeof result?.name !== 'string') { setTokenEditorError('Não foi possível salvar as alterações.'); return }
      updateTokenNameById(tokenEditor.tokenId, result.name)
      if (typeof result.size === 'number') updateTokenSizeById(tokenEditor.tokenId, result.size)
      socketRef.current.emit('update-token-hp', { tokenId: tokenEditor.tokenId, hp: tokenEditor.hp, maxHp: tokenEditor.maxHp })
      setTokenEditor(null)
    } catch { setTokenEditorError('Não foi possível salvar as alterações.') }
    finally { setSavingToken(false) }
  }

  const removeTokenById = (tokenId: string) => {
    pendingTokensRef.current = pendingTokensRef.current.filter(token => token.id !== tokenId)
    for (const [playerId, token] of tokensRef.current) {
      if (token.id !== tokenId) continue
      if (dragTargetRef.current?.id === tokenId) dragTargetRef.current = null
      token.graphics.parent?.removeChild(token.graphics)
      token.graphics.destroy({ children: true })
      tokensRef.current.delete(playerId)
      setTokenCount(tokensRef.current.size)
    }
    setTokenEditor(current => current?.tokenId === tokenId ? null : current)
  }

  const handleDeleteToken = async () => {
    if (!tokenEditor || !isHost || tokenEditor.kind !== 'SCENERY' || deletingToken) return
    if (!window.confirm('Deseja excluir este token do cenário?')) return
    setDeletingToken(true)
    setTokenEditorError('')
    try {
      const tokenId = tokenEditor.tokenId
      const response = await fetch(apiUrl(`/rooms/${roomId}/tokens/${tokenId}`), { method: 'DELETE', credentials: 'include' })
      if (response.status === 404) { removeTokenById(tokenId); return }
      if (!response.ok) { setTokenEditorError(response.status === 403 ? 'Você não pode excluir este token.' : 'Não foi possível excluir o token.'); return }
      removeTokenById(tokenId)
    } catch { setTokenEditorError('Não foi possível excluir o token.') }
    finally { setDeletingToken(false) }
  }

  const [uploadingPortrait, setUploadingPortrait] = useState(false)
  const clearLongPress = () => {
    if (longPressRef.current) clearTimeout(longPressRef.current)
    longPressRef.current = null
    longPressStartRef.current = null
  }
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const tokenId = imageTargetTokenIdRef.current
    e.target.value = ''
    if (!file || !tokenId || uploadingPortrait) return
    setPortraitError('')
    if (file.size > 2 * 1024 * 1024) { setPortraitError('A imagem deve ter no máximo 2 MB.'); return }
    if (file.type && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setPortraitError('Use uma imagem PNG, JPG ou WebP.'); return }
    setUploadingPortrait(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch(apiUrl(`/rooms/${roomId}/tokens/${tokenId}/image`), { method: 'POST', credentials: 'include', body })
      const result = await response.json().catch(() => null)
      if (!response.ok) { setPortraitError(tokenImageError(response.status, result)); return }
      if (typeof result?.imageData !== 'string') { setPortraitError(TOKEN_IMAGE_FALLBACK); return }
      for (const token of tokensRef.current.values()) {
        if (token.id === tokenId) { token.imageUrl = result.imageData; applyTokenImage(token, token.graphics) }
      }
    } catch { setPortraitError(TOKEN_IMAGE_FALLBACK) }
    finally { setUploadingPortrait(false) }
  }
  // Redesenha a barra de HP de um token no PixiJS
  const tokenPixelRadius = (token: Token) => tokenRadius(token.size, sceneRef.current?.settings.gridSize ?? DEFAULT_GRID_SIZE) * CELL_SIZE
  const updateTokenSizeById = (tokenId: string, size: number) => {
    for (const token of tokensRef.current.values()) {
      if (token.id !== tokenId) continue
      token.size = tokenSize(size)
      const { radius, nameY } = tokenHudLayout(token.size, sceneRef.current?.settings.gridSize ?? DEFAULT_GRID_SIZE, GRID_SIZE)
      token.bodyGraphic?.scale.set(radius / TOKEN_RADIUS)
      if (token.graphics) token.graphics.hitArea = new PIXI.Circle(0, 0, Math.max(12, radius))
      if (token.nameText) token.nameText.y = nameY
      renderHpBar(token)
    }
  }
  const renderHpBar = (token: Token) => {
    if (!token.hpBar) return
    token.hpBar.clear()
    if (!token.maxHp || token.maxHp <= 0) { token.hpBar.visible = false; return }

    token.hpBar.visible = true
    const ratio = Math.max(0, Math.min(1, (token.hp ?? 0) / token.maxHp))
    const { hpWidth: barW, hpY: by } = tokenHudLayout(token.size, sceneRef.current?.settings.gridSize ?? DEFAULT_GRID_SIZE, GRID_SIZE)
    const barH = 5
    const bx = -barW / 2
    const color = ratio > 0.5 ? 0x2ecc71 : ratio > 0.2 ? 0xf39c12 : 0xe74c3c

    token.hpBar.rect(bx, by, barW, barH).fill(0x222222)
    if (ratio > 0) token.hpBar.rect(bx, by, barW * ratio, barH).fill(color)
  }

  // Aplica sprite de imagem ao token, mascarado em círculo
  const applyTokenImage = (token: Token, container: any) => {
    if (!token.imageUrl) return
    const version = token.portraitRequest = (token.portraitRequest || 0) + 1
    const img = new Image()
    img.onload = () => {
      if (token.portraitRequest !== version || container.destroyed) return
      token.portraitSprite?.destroy({ texture: true, textureSource: true })
      token.portraitMask?.destroy()
      const texture = PIXI.Texture.from(img)
      const sprite = new PIXI.Sprite(texture)
      sprite.anchor.set(0.5)
      // Fill the circular portrait without stretching the character image.
      sprite.scale.set(Math.max(TOKEN_RADIUS * 2 / img.naturalWidth, TOKEN_RADIUS * 2 / img.naturalHeight))
      const mask = new PIXI.Graphics()
      mask.circle(0, 0, TOKEN_RADIUS).fill(0xffffff)
      sprite.mask = mask
      const body = token.bodyGraphic || container
      body.addChild(mask)
      body.addChild(sprite)
      token.portraitSprite = sprite
      token.portraitMask = mask
      if (token.circleGraphic) token.circleGraphic.visible = false
    }
    img.src = token.imageUrl
  }

  // ── Pixi + Socket ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (appRef.current) return
    if (canvasRef.current && canvasRef.current.children.length > 0) canvasRef.current.innerHTML = ''

    const socket = io(socketUrl(), { withCredentials: true })
    socketRef.current = socket

    socket.on('connect', () => {
      setRoomError('')
      socket.emit('join-room', { roomId })
    })

    socket.on('connect_error', () => setRoomError('Não foi possível conectar. Faça login novamente ou verifique o servidor.'))
    socket.on('room-error', (data: { message: string }) => { creatingTokenRef.current = false; setRoomError(data.message) })

    socket.on('room-joined', (data: any) => {
      setTestMode(data.testMode !== false)
      setTestEndsAt(data.testEndsAt ?? null)
      setConnected(true)
      setPlayerId(socket.id || '')
      setPlayerName(data.playerName)
      playerNameRef.current = data.playerName
      setIsHost(Boolean(data.isHost))
      isHostRef.current = Boolean(data.isHost)
      hostSocketIdsRef.current = new Set(
        (data.players || []).filter((player: { isHost?: boolean }) => player.isHost === true).map((player: { id: string }) => player.id),
      )
      if (data.isHost && socket.id) hostSocketIdsRef.current.add(socket.id)

      window.dispatchEvent(new CustomEvent('room-player-count', {
        detail: { count: data.players.length },
      }))

      tokensRef.current.forEach(token => token.graphics.destroy({ children: true }))
      tokensRef.current.clear()
      setMyOwnToken(null)
      creatingTokenRef.current = false
      pendingTokensRef.current = data.tokens || []
      if (addTokenRef.current) {
        pendingTokensRef.current.forEach(t => addTokenRef.current!(t, t.playerId === socket.id))
        pendingTokensRef.current = []
      }
      if (data.recentRolls?.length > 0) setDiceRolls(data.recentRolls)
      if (data.chatHistory?.length > 0) setChatHistory(data.chatHistory)

      if (Array.isArray(data.fogData) && data.fogData.length === GRID_CELLS * GRID_CELLS) {
        fogDataRef.current = data.fogData
        fogCellsRef.current.forEach((cell, idx) => { cell.visible = !data.fogData[idx] })
      }

      if (data.mapUrl && !data.mapUrl.startsWith('db-webp:')) {
        setMapData(data.mapUrl)
      }
    })

    socket.on('room-player-count', (data: { count: number }) => {
      window.dispatchEvent(new CustomEvent('room-player-count', { detail: { count: data.count } }))
    })

    socket.on('disconnect', () => { setConnected(false); setPlayerId(''); hostSocketIdsRef.current.clear() })

    socket.on('agora-uid-announced', (data: { socketId: string; isHost: boolean }) => {
      if (data.isHost === true) hostSocketIdsRef.current.add(data.socketId)
      else hostSocketIdsRef.current.delete(data.socketId)
    })

    socket.on('player-speaking-update', (data: { playerId: string; isSpeaking: boolean }) => {
      const s = new Set(speakingUsersRef.current)
      data.isSpeaking ? s.add(data.playerId) : s.delete(data.playerId)
      speakingUsersRef.current = s
    })

    socket.on('dice-rolled', (data: any) => setDiceRolls(prev => [...prev, data]))

    socket.on('map-uploaded', (data: { mapData: string }) => setMapData(data.mapData))
    socket.on('map-removed', () => setMapData(null))

    socket.on('fog-updated', (data: { fogData: boolean[] }) => {
      fogDataRef.current = data.fogData
      fogCellsRef.current.forEach((cell, idx) => { cell.visible = !data.fogData[idx] })
    })

    socket.on('player-joined', (data: { playerId: string; isHost?: boolean }) => {
      if (data.isHost === true) hostSocketIdsRef.current.add(data.playerId)
    })
    socket.on('player-left', (data: { playerId: string }) => { hostSocketIdsRef.current.delete(data.playerId) })

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
        for (const position of gridLinePositions(DEFAULT_GRID_SIZE, GRID_SIZE)) {
          gridGraphics.moveTo(position, 0).lineTo(position, GRID_SIZE)
          gridGraphics.moveTo(0, position).lineTo(GRID_SIZE, position)
        }
        gridGraphics.stroke({ width: 1, color: 0xb8a88a, alpha })
      }
      drawGrid(false)

      // Info label
      const infoText = new PIXI.Text({
        text: 'Primeiro clique: criar | Próximos cliques ou arraste: mover',
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
        const body = new PIXI.Container()
        token.bodyGraphic = body
        const radius = tokenPixelRadius(token)
        body.scale.set(radius / TOKEN_RADIUS)

        const speakingIndicator = new PIXI.Graphics()
        speakingIndicator.circle(0, 0, TOKEN_RADIUS + 13).fill({ color: AMBER, alpha: 0.14 })
        speakingIndicator.circle(0, 0, TOKEN_RADIUS + 9).stroke({ width: 2, color: AMBER, alpha: 0.45 })
        speakingIndicator.circle(0, 0, TOKEN_RADIUS + 4).stroke({ width: 3, color: 0xffdf80, alpha: 1 })
        speakingIndicator.visible = false
        token.speakingIndicator = speakingIndicator

        const circle = new PIXI.Graphics()
        circle.circle(0, 0, TOKEN_RADIUS).fill(token.color)
        circle.stroke({ width: isOwn ? 3 : 2, color: isOwn ? 0xffffff : 0x888888 })
        token.circleGraphic = circle

        const nameText = new PIXI.Text({
          text: displayTokenName(token.playerName || 'Unknown'),
          style: { fontFamily: 'Arial', fontSize: 10, fill: 0xffffff, align: 'center', stroke: { color: 0x000000, width: 2 } },
        })
        nameText.anchor.set(0.5)
        nameText.y = tokenHudLayout(token.size, sceneRef.current?.settings.gridSize ?? DEFAULT_GRID_SIZE, GRID_SIZE).nameY
        nameText.eventMode = 'none'
        token.nameText = nameText

        const hpBar = new PIXI.Graphics()
        hpBar.visible = false
        hpBar.eventMode = 'none'
        token.hpBar = hpBar

        body.addChild(speakingIndicator)
        body.addChild(circle)
        container.addChild(body)
        container.addChild(nameText)
        container.addChild(hpBar)
        container.x = gridToPixel(token.x)
        container.y = gridToPixel(token.y)
        container.eventMode = 'static'
        container.hitArea = new PIXI.Circle(0, 0, Math.max(12, radius))

        if (token.imageUrl) applyTokenImage(token, container)

        const openEditor = (x: number, y: number) => {
          if (isOwn || isHostRef.current) {
            setTokenEditorError('')
            setTokenEditor({
              tokenId: token.id,
              kind: token.kind,
              name: token.playerName || 'Token de cenário',
              isOwn,
              hp: token.hp ?? 0,
              maxHp: token.maxHp ?? 0,
              size: tokenSize(token.size),
              x, y,
            })
          }
        }

        // Right-click on desktop; long press on touch screens.
        container.on('rightclick', (event: PIXI.FederatedPointerEvent) => {
          clearLongPress()
          openEditor(event.client.x, event.client.y)
        })

        if (isOwn || isHostRef.current) {
          container.cursor = 'pointer'
          container.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation()
            dragTargetRef.current = token
            app.stage.cursor = 'grabbing'
            if (event.pointerType === 'touch') {
              clearLongPress()
              longPressStartRef.current = { x: event.global.x, y: event.global.y }
              const { x, y } = event.client
              longPressRef.current = setTimeout(() => {
                dragTargetRef.current = null
                token.graphics.position.set(gridToPixel(token.x), gridToPixel(token.y))
                app.stage.cursor = 'default'
                openEditor(x, y)
                clearLongPress()
              }, 600)
            }
          })
        }

        container.on('pointerover', () => {
          container.cursor = 'pointer'
          nameText.style.fill = 0x4ecdc4
        })
        container.on('pointerout', () => {
          nameText.style.fill = 0xffffff
        })

        return container
      }

      const addToken = (tokenData: Omit<Token, 'graphics'>, isOwn: boolean) => {
        if (tokensRef.current.has(tokenData.playerId)) return
        const token: Token = { ...tokenData, isOwn, graphics: null as any }
        const container = createTokenGraphics(token, isOwn)
        token.graphics = container
        renderHpBar(token)
        tokensContainer.addChild(container)
        tokensRef.current.set(tokenData.playerId, token)
        setTokenCount(tokensRef.current.size)
        if (isOwn && !isHostRef.current) setMyOwnToken(token)
      }
      addTokenRef.current = addToken

      if (pendingTokensRef.current.length > 0) {
        pendingTokensRef.current.forEach((t: any) => {
          if (!tokensRef.current.has(t.playerId)) addToken(t, t.playerId === socket.id)
        })
        pendingTokensRef.current = []
      }

      socket.on('token-created', (tokenData: Token) => {
        const isOwn = tokenData.playerId === socket.id
        if (isOwn) creatingTokenRef.current = false
        if (!tokensRef.current.has(tokenData.playerId)) addToken(tokenData, isOwn)
      })

      socket.on('token-moved', (data: { tokenId: string; x: number; y: number; playerId: string }) => {
        const token = tokensRef.current.get(data.playerId)
        if (token) {
          token.x = data.x
          token.y = data.y
          token.graphics.x = gridToPixel(data.x)
          token.graphics.y = gridToPixel(data.y)
          if (token.isOwn && !isHostRef.current) setMyOwnToken({ ...token })
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

      socket.on('token-name-updated', (data: { tokenId: string; name: string }) => updateTokenNameById(data.tokenId, data.name))
      socket.on('token-size-updated', (data: { tokenId: string; size: number }) => updateTokenSizeById(data.tokenId, data.size))

      socket.on('token-deleted', (data: { tokenId: string }) => removeTokenById(data.tokenId))

      // Stage input
      app.stage.eventMode = 'static'
      app.stage.hitArea = new PIXI.Rectangle(0, 0, GRID_SIZE, GRID_SIZE)

      app.stage.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
        if (dragTargetRef.current || event.button !== 0 || !socket.connected) return

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

        if (gridX >= 0 && gridX < GRID_CELLS && gridY >= 0 && gridY < GRID_CELLS) {
          const own = tokensRef.current.get(socket.id || '')
          const segments = movementSegments(sceneRef.current?.walls ?? [])
          const gridSize = sceneRef.current?.settings.gridSize ?? DEFAULT_GRID_SIZE
          if (own) {
            const destination = lastValidTokenCell(own, { x: gridX, y: gridY }, own.size, gridSize, segments, (x, y) => Array.from(tokensRef.current.values()).some(t => t !== own && t.x === x && t.y === y))
            if (destination.x === own.x && destination.y === own.y) return
            own.x = destination.x
            own.y = destination.y
            own.graphics.position.set(gridToPixel(destination.x), gridToPixel(destination.y))
            if (!isHostRef.current) setMyOwnToken({ ...own })
            socket.emit('move-token', { tokenId: own.id, x: destination.x, y: destination.y })
            return
          }
          if (Array.from(tokensRef.current.values()).some(t => t.x === gridX && t.y === gridY)) return
          if (creatingTokenRef.current) return
          if (!validTokenPosition(tokenCenter(gridX, gridY), 1, gridSize, segments)) return
          creatingTokenRef.current = true
          const tokenId = `${socket.id}-${Date.now()}`
          const color = TOKEN_COLORS[tokensRef.current.size % TOKEN_COLORS.length]
          socket.timeout(5000).emit('create-token', { tokenId, x: gridX, y: gridY, color, playerName: playerNameRef.current || 'Unknown' }, (error: Error | null) => {
            creatingTokenRef.current = false
            if (error && !tokensRef.current.has(socket.id || '')) setRoomError('Não foi possível confirmar o token. Tente novamente.')
          })
        }
      })

      app.stage.on('pointermove', (event: PIXI.FederatedPointerEvent) => {
        if (dragTargetRef.current) {
          if (longPressStartRef.current && Math.hypot(event.global.x - longPressStartRef.current.x, event.global.y - longPressStartRef.current.y) > 8) clearLongPress()
          const token = dragTargetRef.current
          const segments = movementSegments(sceneRef.current?.walls ?? [])
          const gridSize = sceneRef.current?.settings.gridSize ?? DEFAULT_GRID_SIZE
          if (validTokenMove(tokenCenter(token.x, token.y), { x: event.global.x / CELL_SIZE, y: event.global.y / CELL_SIZE }, token.size, gridSize, segments)) {
            token.graphics.x = event.global.x
            token.graphics.y = event.global.y
          }
        }
      })

      app.stage.on('pointerup', () => {
        clearLongPress()
        if (dragTargetRef.current) {
          const token = dragTargetRef.current
          const gridX = pixelToGrid(token.graphics.x)
          const gridY = pixelToGrid(token.graphics.y)
          const cx = Math.max(0, Math.min(GRID_CELLS - 1, gridX))
          const cy = Math.max(0, Math.min(GRID_CELLS - 1, gridY))

          const destination = lastValidTokenCell(token, { x: cx, y: cy }, token.size, sceneRef.current?.settings.gridSize ?? DEFAULT_GRID_SIZE, movementSegments(sceneRef.current?.walls ?? []), (x, y) => Array.from(tokensRef.current.values()).some(t => t !== token && t.x === x && t.y === y))
          if (destination.x === token.x && destination.y === token.y) {
            token.graphics.x = gridToPixel(token.x)
            token.graphics.y = gridToPixel(token.y)
          } else {
            token.x = destination.x
            token.y = destination.y
            token.graphics.x = gridToPixel(destination.x)
            token.graphics.y = gridToPixel(destination.y)
            if (token.isOwn && !isHostRef.current) setMyOwnToken({ ...token })
            socket.emit('move-token', { tokenId: token.id, x: destination.x, y: destination.y })
          }

          dragTargetRef.current = null
          app.stage.cursor = 'default'
        }
      })

      app.stage.on('pointerupoutside', () => {
        clearLongPress()
        if (dragTargetRef.current) {
          const token = dragTargetRef.current
          token.graphics.x = gridToPixel(token.x)
          token.graphics.y = gridToPixel(token.y)
          dragTargetRef.current = null
          app.stage.cursor = 'default'
        }
      })

      // Keep a steady ring for users who prefer reduced motion.
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
      // Animação do indicador de fala
      app.ticker.add(() => {
        tokensRef.current.forEach(token => {
          if (!token.speakingIndicator) return
          const speaking = !hostSocketIdsRef.current.has(token.playerId) && speakingUsersRef.current.has(token.playerId)
          token.speakingIndicator.visible = speaking
          if (speaking) {
            const t = Date.now() / 500
            token.speakingIndicator.scale.set(reducedMotion.matches ? 1 : 1 + Math.sin(t) * 0.07)
            token.speakingIndicator.alpha = reducedMotion.matches ? 1 : 0.85 + Math.sin(t) * 0.15
          }
        })
      })
    }

    void initPixi().then(() => setCanvasReady(true))

    return () => {
      clearLongPress()
      addTokenRef.current = null
      socketRef.current?.disconnect()
      socketRef.current = null
      appRef.current?.destroy(true, { children: true })
      appRef.current = null
      if (canvasRef.current) canvasRef.current.innerHTML = ''
    }
  }, [roomId])

  useEffect(() => {
    if (!connected || !socketRef.current) return
    const socket = socketRef.current
    let disposed = false
    const applyScene = (value: Scene) => {
      if (!disposed) setScene(previous => previous && previous.revision > value.revision ? previous : value)
    }
    socket.on('scene-updated', applyScene)
    fetch(apiUrl(`/rooms/${roomId}/scene`), { credentials: 'include', cache: 'no-store' })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Não foi possível carregar o cenário.')
        applyScene(data.scene)
      })
      .catch(error => { if (!disposed) setRoomError(error.message) })
    return () => { disposed = true; socket.off('scene-updated', applyScene) }
  }, [roomId, connected])

  // ── Mapa: recarregar quando muda ──────────────────────────────────────────
  useEffect(() => {
    if (!appRef.current || !canvasReady) return
    const app = appRef.current
    const mapContainer = app.stage.getChildAt(0) as any
    let cancelled = false
    const source = scene ? scene.map ? apiUrl(scene.map.url) : null : mapData
    const settings = scene?.settings || { scale: 1, x: 0, y: 0, gridOpacity: .3, gridSize: DEFAULT_GRID_SIZE }

    if (mapSpriteRef.current) {
      mapContainer.removeChild(mapSpriteRef.current)
      mapSpriteRef.current.destroy()
      mapSpriteRef.current = null
    }

    if (source) {
      const img = new Image()
      img.onload = () => {
        if (cancelled || appRef.current !== app) return
        const texture = PIXI.Texture.from(img)
        const sprite = new PIXI.Sprite(texture)
        const current = sceneRef.current?.settings || settings
        sprite.scale.set(Math.min(GRID_SIZE / img.width, GRID_SIZE / img.height) * current.scale)
        sprite.anchor.set(0)
        sprite.position.set(current.x, current.y)
        mapContainer.addChild(sprite)
        mapSpriteRef.current = sprite
      }
      img.onerror = () => { if (!cancelled) setRoomError('Não foi possível carregar a imagem do mapa. Recarregue o cenário.') }
      img.src = source
    }

    const gridContainer = app.stage.getChildAt(1) as any
    const g = gridContainer.children[0] as PIXI.Graphics
    if (g) {
      g.clear()
      const alpha = settings.gridOpacity
      for (const position of gridLinePositions(settings.gridSize, GRID_SIZE)) {
        g.moveTo(position, 0).lineTo(position, GRID_SIZE)
        g.moveTo(0, position).lineTo(GRID_SIZE, position)
      }
      g.stroke({ width: 1, color: 0xb8a88a, alpha })
    }
    return () => { cancelled = true }
  }, [mapData, scene?.map?.url, canvasReady])

  useEffect(() => {
    if (!canvasReady || !appRef.current || !scene) return
    const sprite = mapSpriteRef.current
    if (sprite) {
      sprite.scale.set(Math.min(GRID_SIZE / sprite.texture.width, GRID_SIZE / sprite.texture.height) * scene.settings.scale)
      sprite.position.set(scene.settings.x, scene.settings.y)
    }
    const grid = (appRef.current.stage.getChildAt(1) as PIXI.Container).children[0] as PIXI.Graphics
    grid.clear()
    for (const position of gridLinePositions(scene.settings.gridSize, GRID_SIZE)) {
      grid.moveTo(position, 0).lineTo(position, GRID_SIZE)
      grid.moveTo(0, position).lineTo(GRID_SIZE, position)
    }
    grid.stroke({ width: 1, color: 0xb8a88a, alpha: scene.settings.gridOpacity })
    for (const token of tokensRef.current.values()) updateTokenSizeById(token.id, token.size ?? 1)
  }, [canvasReady, scene?.settings])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.layout}>
      <div className={styles.tableSection}>
        {roomError && <p role="alert" style={{ color: '#ffb4ab' }}>{roomError}</p>}
        <div className={styles.toolbar} aria-label="Controles da mesa">
          <div className={styles.toolbarStatus}>
            <span role="status" className={connected ? styles.online : styles.offline}>{connected ? '● Conectado' : '● Desconectado'}</span>
            <span role="status" className={audioConnected ? styles.audioOnline : styles.audioOffline}>
              {audioConnected ? '🔊 Áudio ativo' : audioError ? '⚠️ Áudio indisponível' : audioStatus}
            </span>
            {testMode && <span className={styles.betaStatus}>Beta · até 5 participantes{testEndsAt && ` · termina ${new Date(testEndsAt).toLocaleTimeString()}`}</span>}
          </div>
          <div className={styles.toolbarActions}>
            {!audioConnected && <button onClick={retryAudio} disabled={!connected}>Conectar áudio</button>}
            <button onClick={toggleMute} disabled={!audioConnected} aria-label={!audioConnected ? 'Microfone desligado' : isMuted ? 'Ativar microfone' : 'Silenciar microfone'}>
              {!audioConnected ? '🎤 Desligado' : isMuted ? '🔇 Mudo' : '🎤 Ativo'}
            </button>
            {isHost && <button onClick={() => setFogMode(v => !v)} aria-pressed={fogMode}>{fogMode ? '🌫️ Névoa: ON' : '🌫️ Névoa'}</button>}
            {myOwnToken && <button disabled={uploadingPortrait || !connected} onClick={() => { imageTargetTokenIdRef.current = myOwnToken.id; imageInputRef.current?.click() }}>
              {uploadingPortrait ? 'Enviando retrato…' : 'Trocar retrato'}
            </button>}
            {isHost && <a href={`/room/${roomId}/scene`}>Preparar cenário (sem áudio) →</a>}
          </div>
          {portraitError && (!tokenEditor || imageTargetTokenIdRef.current !== tokenEditor.tokenId) && <p role="alert" className={styles.portraitError}>{portraitError}</p>}
          {(audioError || playbackBlocked || fogMode) && <div className={styles.toolbarNote}>
            {audioError && <span role="alert">{audioError}</span>}
            {audioConnected && playbackBlocked && <span>O navegador pausou a reprodução. <button onClick={enablePlayback}>Ativar som</button></span>}
            {fogMode && <span>Toque nas células para revelar ou ocultar a névoa.</span>}
          </div>}
        </div>
        <div className={styles.table}>
          <div
            ref={canvasRef}
            onContextMenu={e => e.preventDefault()}
            className={styles.canvasHost}
          />
          <svg aria-label="Paredes e portas do cenário" viewBox="0 0 500 500" className={styles.wallOverlay}>
            {scene?.walls.map(wall => <g key={wall.id}>
              {solidSegments(wall).map((segment, index) => <g key={index}>
                <line x1={segment.x1 * 50} y1={segment.y1 * 50} x2={segment.x2 * 50} y2={segment.y2 * 50} stroke="#120d09" strokeWidth="7" opacity=".8" />
                <line x1={segment.x1 * 50} y1={segment.y1 * 50} x2={segment.x2 * 50} y2={segment.y2 * 50} stroke={wall.isDoor ? wall.isOpen ? '#64d7a2' : '#ffbf62' : '#a3b4ca'} strokeWidth="3" strokeDasharray={wall.isOpen ? '7 7' : undefined} />
              </g>)}
              {wall.isDoor && <text x={(wall.x1 + wall.x2) * 25 + 5} y={(wall.y1 + wall.y2) * 25 - 5} fill={wall.isOpen ? '#64d7a2' : '#ffbf62'} fontSize="11" stroke="#120d09" strokeWidth="3" paintOrder="stroke">{wall.isOpen ? 'Aberta' : 'Porta'}</text>}
              {wall.openings?.map(item => {
                const [left, right] = openingBounds(item), a = pointOnWall(wall, left), b = pointOnWall(wall, right)
                return <line key={item.id} x1={a.x * 50} y1={a.y * 50} x2={b.x * 50} y2={b.y * 50} stroke={item.type === 'window' ? '#8fd3ff' : item.isOpen ? '#64d7a2' : '#ffbf62'} strokeWidth="4" strokeDasharray={item.isOpen ? '7 7' : undefined} />
              })}
            </g>)}
          </svg>
        </div>

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

            {isHost && tokenEditor.kind === 'SCENERY' && <label style={{ display: 'block', marginBottom: '0.75rem', fontSize: '0.8rem' }}>
              Nome
              <input type="text" maxLength={80} value={tokenEditor.name} onChange={e => { setTokenEditor(current => current ? { ...current, name: e.target.value } : current); setTokenEditorError('') }} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '0.3rem', padding: '0.4rem', background: '#0a0508', color: '#f4e4bc', border: '1px solid #82613c', borderRadius: '4px' }} />
            </label>}

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

            {isHost && tokenEditor.kind === 'SCENERY' && <label style={{ display: 'block', marginBottom: '0.75rem', fontSize: '0.8rem' }}>
              Tamanho em células
              <select value={tokenEditor.size} onChange={e => { setTokenEditor(current => current ? { ...current, size: Number(e.target.value) } : current); setTokenEditorError('') }} style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.4rem', background: '#0a0508', color: '#f4e4bc', border: '1px solid #82613c', borderRadius: '4px' }}>
                {TOKEN_SIZES.map(size => <option key={size} value={size}>{size}x</option>)}
              </select>
            </label>}

            <button
              onClick={isHost && tokenEditor.kind === 'SCENERY' ? handleSaveToken : handleSaveHp}
              disabled={savingToken}
              style={{ width: '100%', padding: '0.4rem', background: '#ff9d00', color: '#1a0f0a', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '0.5rem', fontSize: '0.85rem' }}
            >
              {isHost && tokenEditor.kind === 'SCENERY' ? savingToken ? 'Salvando…' : 'Salvar alterações' : 'Salvar HP'}
            </button>

            {((tokenEditor.isOwn && !isHost) || (isHost && tokenEditor.kind === 'SCENERY')) && (
              <button
                disabled={uploadingPortrait}
                onClick={() => {
                  imageTargetTokenIdRef.current = tokenEditor.tokenId
                  setPortraitError('')
                  imageInputRef.current?.click()
                }}
                style={{ width: '100%', padding: '0.4rem', background: 'transparent', color: '#d4af37', border: '1px solid #d4af37', borderRadius: '6px', cursor: uploadingPortrait ? 'default' : 'pointer', fontSize: '0.85rem' }}
              >
                {uploadingPortrait ? 'Enviando imagem…' : 'Trocar imagem'}
              </button>
            )}
            {portraitError && imageTargetTokenIdRef.current === tokenEditor.tokenId && <p role="alert" style={{ color: '#ffb4ab', fontSize: '0.8rem' }}>{portraitError}</p>}

            {isHost && tokenEditor.kind === 'SCENERY' && <div style={{ borderTop: '1px solid #66482a', marginTop: '0.75rem', paddingTop: '0.75rem' }}>
              <button onClick={handleDeleteToken} disabled={deletingToken} style={{ width: '100%', padding: '0.4rem', background: 'transparent', color: '#ffb4ab', border: '1px solid #a34747', borderRadius: '6px', fontSize: '0.85rem', cursor: deletingToken ? 'default' : 'pointer' }}>
                {deletingToken ? 'Excluindo…' : 'Excluir token'}
              </button>
            </div>}
            {tokenEditorError && <p role="alert" style={{ color: '#ffb4ab', fontSize: '0.8rem' }}>{tokenEditorError}</p>}

          </div>
        )}

        {/* Input de imagem oculto */}
        <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageSelect} style={{ display: 'none' }} />
      </div>

      <section className={styles.secondary} data-open={panelsOpen} aria-label="Chat e dados">
        <button className={styles.panelToggle} onClick={() => setPanelsOpen(value => !value)} aria-expanded={panelsOpen}>
          {panelsOpen ? 'Ocultar chat e dados' : 'Mostrar chat e dados'}
        </button>
        <div className={styles.tabs} role="tablist" aria-label="Painéis da sala">
          <button role="tab" aria-selected={mobileTab === 'chat'} onClick={() => setMobileTab('chat')}>Chat</button>
          <button role="tab" aria-selected={mobileTab === 'dice'} onClick={() => setMobileTab('dice')}>Dados</button>
        </div>
        <div className={styles.panels}>
          <div className={`${styles.panel} ${styles.chatPanel}`} data-active={mobileTab === 'chat'}>
            <ChatBox socket={socketRef.current} myPlayerName={playerName} initialMessages={chatHistory} />
          </div>
          <div className={`${styles.panel} ${styles.dicePanel}`} data-active={mobileTab === 'dice'}>
            <DiceRoller onRoll={handleRollDice} playerName={playerName} />
            <DiceHistory rolls={diceRolls} myPlayerId={playerId} />
          </div>
        </div>
      </section>
      {isHost && connected && <details className={styles.members}>
        <summary>Autorizar participantes</summary>
        <RoomMembers roomId={roomId} />
      </details>}
    </div>
  )
}

