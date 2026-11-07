'use client'

import { useEffect, useRef, useState } from 'react'
import { useVoiceDetection } from './useVoiceDetection'
import { apiUrl } from '../lib/api-url'
import { installAgoraCompatibility } from '../lib/agora-compat'
import { remoteVoiceMode, type VoiceRole } from './voice-mode'
import { wallOcclusionCount, type WallGeometry } from '../lib/scene-geometry'

interface Token {
  id: string
  x: number
  y: number
  playerId: string
}

interface WallData extends WallGeometry { id: string }

interface SpatialAudioConfig {
  onLocalSpeakingChange?: (speaking: boolean) => void
  channelName: string
  isHost: boolean
  myToken: Token | null
  allTokens: Map<string, Token>
  walls?: WallData[]
  maxDistance?: number
  mySocketId?: string
  socket?: any
}

interface RemoteAudioNode {
  spatial: boolean
  pannerNode: PannerNode
  gainNode: GainNode
  filterNode: BiquadFilterNode
  source: MediaStreamAudioSourceNode
}

export function useSpatialAudio(config: SpatialAudioConfig) {
  const {
    channelName,
    isHost,
    myToken,
    allTokens,
    walls = [],
    maxDistance = 1000,
    mySocketId,
    socket,
  } = config

  const clientRef = useRef<any>(null)
  const localTrackRef = useRef<any>(null)
  const cameraTrackRef = useRef<any>(null)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const cameraBusyRef = useRef(false)
  const [cameraBusy, setCameraBusy] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [localCameraTrack, setLocalCameraTrack] = useState<any>(null)
  const [remoteVideoTracks, setRemoteVideoTracks] = useState<Map<string, any>>(new Map())
  const audioContextRef = useRef<AudioContext | null>(null)
  const remoteAudioNodesRef = useRef<Map<string, RemoteAudioNode>>(new Map())

  const [isConnected, setIsConnected] = useState(false)
  const [playbackBlocked, setPlaybackBlocked] = useState(false)
  const enablePlayback = () => {
    const context = audioContextRef.current
    if (context && context.state !== 'closed') {
      void context.resume().catch(() => setPlaybackBlocked(true))
    }
  }
  const [audioError, setAudioError] = useState('')
  const [audioStatus, setAudioStatus] = useState('Aguardando entrada na sala…')
  const [attempt, setAttempt] = useState(0)
  const retryAudio = () => { void audioContextRef.current?.resume().catch(() => {}); setAttempt(value => value + 1) }
  const [isMuted, setIsMuted] = useState(false)
  const [isDeafened, setIsDeafened] = useState(false)
  const isDeafenedRef = useRef(false)
  isDeafenedRef.current = isDeafened
  const [remoteUsers, setRemoteUsers] = useState<Set<string>>(new Set())
  const socketToAgoraMapRef = useRef<Map<string, string>>(new Map())
  const agoraVoiceRolesRef = useRef<Map<string, VoiceRole>>(new Map())
  const myAgoraUidRef = useRef<string>('')

  const [localAudioTrack, setLocalAudioTrack] = useState<any>(null)

  const myTokenRef = useRef<Token | null>(null)
  myTokenRef.current = myToken
  const isHostRef = useRef(isHost)
  isHostRef.current = isHost

  const wallsRef = useRef<WallData[]>(walls)
  wallsRef.current = walls

  const calculateDistance = (token1: Token, token2: Token): number => {
    const dx = token1.x - token2.x
    const dy = token1.y - token2.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  // Verifica se há paredes/portas fechadas bloqueando o caminho do som
  const calculateWallOcclusion = (listenerToken: Token, emitterToken: Token): { isOccluded: boolean; occlusionCount: number } => {
    const occlusionCount = wallOcclusionCount({ x1: listenerToken.x, y1: listenerToken.y, x2: emitterToken.x, y2: emitterToken.y }, wallsRef.current || [])

    return {
      isOccluded: occlusionCount > 0,
      occlusionCount,
    }
  }

  const handleSpeakingChange = (isSpeaking: boolean) => {
    config.onLocalSpeakingChange?.(isSpeaking)
    if (socket) {
      socket.emit('player-speaking', { isSpeaking })
    }
  }

  useVoiceDetection(isConnected && !isMuted ? localAudioTrack : null, {
    onSpeakingChange: handleSpeakingChange,
    threshold: 0.01,
    smoothing: 0.8,
  })

  const updateSpatialAudio = () => {
    const currentToken = myTokenRef.current
    if (!audioContextRef.current) return

    const audioContext = audioContextRef.current

    remoteAudioNodesRef.current.forEach((audioNode, agoraUid) => {
      const socketId = Array.from(socketToAgoraMapRef.current.entries())
        .find(([_, uid]) => uid === agoraUid)?.[0]

      const remoteToken = socketId ? allTokens.get(socketId) : undefined
      const mode = remoteVoiceMode(
        isHostRef.current,
        agoraVoiceRolesRef.current.get(agoraUid),
        Boolean(currentToken),
        Boolean(remoteToken),
        isDeafenedRef.current,
      )
      if (mode === 'global') {
        // Global voices bypass both the HRTF panner and the wall filter.
        if (audioNode.spatial) {
          audioNode.source.disconnect()
          audioNode.source.connect(audioNode.gainNode)
          audioNode.spatial = false
        }
        audioNode.gainNode.gain.setValueAtTime(1, audioContext.currentTime)
        return
      }
      if (!audioNode.spatial) {
        audioNode.source.disconnect()
        audioNode.source.connect(audioNode.pannerNode)
        audioNode.spatial = true
      }
      if (mode === 'silent' || !currentToken || !remoteToken) {
        audioNode.gainNode.gain.setValueAtTime(0, audioContext.currentTime)
        return
      }

      const distance = calculateDistance(currentToken, remoteToken)

      const relativeX = (remoteToken.x - currentToken.x)
      const relativeY = 0
      const relativeZ = (remoteToken.y - currentToken.y) * -1

      audioNode.pannerNode.positionX.setValueAtTime(relativeX, audioContext.currentTime)
      audioNode.pannerNode.positionY.setValueAtTime(relativeY, audioContext.currentTime)
      audioNode.pannerNode.positionZ.setValueAtTime(relativeZ, audioContext.currentTime)

      const { isOccluded, occlusionCount } = calculateWallOcclusion(currentToken, remoteToken)

      if (distance > maxDistance) {
        audioNode.gainNode.gain.setValueAtTime(0, audioContext.currentTime)
      } else {
        // Atenuação de ganho e abafamento por paredes
        const occlusionGainReduction = isOccluded ? Math.pow(0.5, occlusionCount) : 1
        audioNode.gainNode.gain.setValueAtTime(occlusionGainReduction, audioContext.currentTime)

        // Aplica filtro passa-baixas para abafar o som se houver parede
        const cutoffFrequency = isOccluded ? Math.max(300, 3000 / (occlusionCount * 2)) : 20000
        audioNode.filterNode.frequency.setValueAtTime(cutoffFrequency, audioContext.currentTime)
      }
    })
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID
    if (!appId) {
      setAudioError('Áudio não configurado no servidor.')
      console.error('❌ NEXT_PUBLIC_AGORA_APP_ID não encontrado')
      return
    }

    let AgoraRTC: any
    let cancelled = false
    const resumeController = new AbortController()
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const delayedUpdates = new Set<ReturnType<typeof setTimeout>>()
    const socketHandlers: Array<{ event: string; handler: (...args: any[]) => void }> = []
    const listen = (event: string, handler: (...args: any[]) => void) => {
      if (!socket) return
      socket.on(event, handler)
      socketHandlers.push({ event, handler })
    }
    const fail = (message: string) => {
      if (cancelled) return
      cancelled = true
      clearTimeout(watchdog)
      setAudioError(message)
      setIsConnected(false)
      localTrackRef.current?.close()
      void clientRef.current?.leave().catch(() => {})
    }

    const initAgora = async () => {
      try {
        if (!mySocketId) {
          console.warn('⚠️ mySocketId ainda não está pronto, aguardando...')
          return
        }

        setAudioError('')
        setAudioStatus('Conectando ao serviço de áudio…')
        watchdog = setTimeout(() => fail('A conexão de áudio demorou demais. Verifique a permissão do microfone e tente novamente.'), 25000)
        installAgoraCompatibility()
        AgoraRTC = (await import('agora-rtc-sdk-ng')).default
        if (cancelled) return

        const client = AgoraRTC.createClient({
          mode: 'rtc',
          codec: 'vp8',
        })

        clientRef.current = client

        const audioContext = new AudioContext()
        const syncPlaybackState = () => {
          if (!cancelled) setPlaybackBlocked(audioContext.state !== 'running')
        }
        audioContext.addEventListener('statechange', syncPlaybackState, { signal: resumeController.signal })
        syncPlaybackState()
        const resumePlayback = () => { if (audioContext.state !== 'running') void audioContext.resume().catch(() => {}) }
        window.addEventListener('click', resumePlayback, { signal: resumeController.signal })
        window.addEventListener('touchend', resumePlayback, { signal: resumeController.signal })
        window.addEventListener('keydown', resumePlayback, { signal: resumeController.signal })
        audioContextRef.current = audioContext

        const listener = audioContext.listener
        if (listener.positionX) {
          listener.positionX.setValueAtTime(0, audioContext.currentTime)
          listener.positionY.setValueAtTime(0, audioContext.currentTime)
          listener.positionZ.setValueAtTime(0, audioContext.currentTime)
        } else {
          listener.setPosition(0, 0, 0)
        }

        if (listener.forwardX) {
          listener.forwardX.setValueAtTime(0, audioContext.currentTime)
          listener.forwardY.setValueAtTime(0, audioContext.currentTime)
          listener.forwardZ.setValueAtTime(-1, audioContext.currentTime)
          listener.upX.setValueAtTime(0, audioContext.currentTime)
          listener.upY.setValueAtTime(1, audioContext.currentTime)
          listener.upZ.setValueAtTime(0, audioContext.currentTime)
        } else {
          listener.setOrientation(0, 0, -1, 0, 1, 0)
        }

        client.on('user-published', async (user: any, mediaType: string) => {
          if (mediaType === 'video') {
            try {
              await client.subscribe(user, mediaType)
              if (!cancelled && user.videoTrack) {
                setRemoteVideoTracks(previous => new Map(previous).set(user.uid.toString(), user.videoTrack))
              }
            } catch (error) {
              if (!cancelled) console.warn('Falha ao receber vídeo remoto:', error)
            }
            return
          }
          if (mediaType === 'audio') {
            await client.subscribe(user, mediaType)
            if (cancelled) return

            const remoteAudioTrack = user.audioTrack
            if (!remoteAudioTrack || !audioContextRef.current) return

            const currentAudioContext = audioContextRef.current

            const mediaStream = new MediaStream([remoteAudioTrack.getMediaStreamTrack()])
            const source = currentAudioContext.createMediaStreamSource(mediaStream)

            const pannerNode = currentAudioContext.createPanner()
            pannerNode.panningModel = 'HRTF'
            pannerNode.distanceModel = 'inverse'
            pannerNode.refDistance = 1
            pannerNode.maxDistance = maxDistance
            pannerNode.rolloffFactor = 1

            const filterNode = currentAudioContext.createBiquadFilter()
            filterNode.type = 'lowpass'
            filterNode.frequency.setValueAtTime(20000, currentAudioContext.currentTime)

            const gainNode = currentAudioContext.createGain()
            gainNode.gain.value = 0

            source.connect(pannerNode)
            pannerNode.connect(filterNode)
            filterNode.connect(gainNode)
            gainNode.connect(currentAudioContext.destination)

            remoteAudioNodesRef.current.set(user.uid.toString(), {
              spatial: true,
              pannerNode,
              filterNode,
              gainNode,
              source,
            })

            setRemoteUsers(prev => new Set(prev).add(user.uid.toString()))

            const timer = setTimeout(() => {
              delayedUpdates.delete(timer)
              if (!cancelled) updateSpatialAudio()
            }, 300)
            delayedUpdates.add(timer)
          }
        })

        client.on('user-unpublished', (user: any, mediaType: string) => {
          if (mediaType === 'video') {
            setRemoteVideoTracks(previous => {
              const next = new Map(previous)
              next.delete(user.uid.toString())
              return next
            })
            return
          }
          const audioNode = remoteAudioNodesRef.current.get(user.uid.toString())
          if (audioNode) {
            audioNode.source.disconnect()
            audioNode.pannerNode.disconnect()
            audioNode.filterNode.disconnect()
            audioNode.gainNode.disconnect()
            remoteAudioNodesRef.current.delete(user.uid.toString())
          }
          setRemoteUsers(prev => {
            const newSet = new Set(prev)
            newSet.delete(user.uid.toString())
            return newSet
          })
        })

        client.on('user-left', (user: any) => {
          setRemoteVideoTracks(previous => {
            const next = new Map(previous)
            next.delete(user.uid.toString())
            return next
          })
        })

        if (socket) {
          listen('agora-uid-announced', (data: { socketId: string; agoraUid: string; isHost: boolean }) => {
            for (const [socketId, uid] of socketToAgoraMapRef.current) {
              if (uid === data.agoraUid && socketId !== data.socketId) socketToAgoraMapRef.current.delete(socketId)
            }
            socketToAgoraMapRef.current.set(data.socketId, data.agoraUid)
            agoraVoiceRolesRef.current.set(data.agoraUid, data.isHost === true ? 'host' : 'player')
            updateSpatialAudio()
          })

          listen('walls-updated', () => {
            updateSpatialAudio()
          })

          listen('door-toggled', () => {
            updateSpatialAudio()
          })

          listen('player-audio-position-updated', () => {
            updateSpatialAudio()
          })
          // A recycled socket must re-announce its current Agora identity after reconnecting.
          listen('connect', () => {
            if (cancelled || !myAgoraUidRef.current || !socket.connected) return
            socket.emit('announce-agora-uid', { socketId: socket.id, agoraUid: myAgoraUidRef.current })
          })
        }

        const fetchVoiceToken = async () => {
          const response = await fetch(apiUrl(`/agora/token?channelName=${encodeURIComponent(channelName)}`), {
            credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(10000),
          })
          const result = await response.json()
          if (!response.ok || typeof result.token !== 'string' || typeof result.uid !== 'string') {
            throw new Error(typeof result.message === 'string' ? result.message : 'Não foi possível autorizar a voz nesta sala.')
          }
          return result as { token: string; uid: string }
        }
        setAudioStatus('Aguardando permissão do microfone…')
        const localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
          encoderConfig: 'music_standard',
        })
        if (cancelled) { localAudioTrack.close(); await client.leave(); return }
        localTrackRef.current = localAudioTrack
        setLocalAudioTrack(localAudioTrack)

        const authorization = await fetchVoiceToken()
        if (cancelled) return
        const uid = await client.join(appId, channelName, authorization.token, authorization.uid)
        if (cancelled) { await client.leave(); return }
        client.on('token-privilege-will-expire', async () => {
          try {
            const renewed = await fetchVoiceToken()
            if (!cancelled) await client.renewToken(renewed.token)
          } catch {
            if (!cancelled) {
              fail('A autorização de áudio expirou. Tente conectar novamente.')
            }
          }
        })

        myAgoraUidRef.current = uid.toString()
        if (mySocketId && socket) {
          socketToAgoraMapRef.current.set(mySocketId, uid.toString())
          socket.emit('announce-agora-uid', {
            socketId: mySocketId,
            agoraUid: uid.toString(),
          })
        }

        await client.publish([localAudioTrack])
        if (cancelled) { localAudioTrack.close(); await client.leave(); return }
        setIsConnected(true)
        setIsMuted(false)
        clearTimeout(watchdog)
        void audioContext.resume().catch(() => {})
      } catch (error) {
        console.error('❌ Erro ao inicializar Agora:', error)
        const code = String((error as any)?.code || '')
        fail(code.includes('PERMISSION') ? 'Permita o acesso ao microfone no navegador e tente novamente.' :
          code.includes('DEVICE_NOT_FOUND') ? 'Nenhum microfone foi encontrado. Conecte um microfone e tente novamente.' :
          error instanceof Error ? error.message : 'Não foi possível conectar o áudio. Tente novamente.')
      }
    }

    initAgora()

    return () => {
      cancelled = true
      clearTimeout(watchdog)
      for (const timer of delayedUpdates) clearTimeout(timer)
      delayedUpdates.clear()
      resumeController.abort()
      for (const { event, handler } of socketHandlers) socket?.off(event, handler)
      remoteAudioNodesRef.current.forEach(audioNode => {
        try {
          audioNode.source.disconnect()
          audioNode.pannerNode.disconnect()
          audioNode.filterNode.disconnect()
          audioNode.gainNode.disconnect()
        } catch (e) {}
      })
      remoteAudioNodesRef.current.clear()
      socketToAgoraMapRef.current.clear()
      agoraVoiceRolesRef.current.clear()
      setRemoteUsers(new Set())
      setPlaybackBlocked(false)

      if (cameraTrackRef.current) {
        cameraTrackRef.current.close()
        cameraTrackRef.current = null
      }
      setCameraEnabled(false)
      setLocalCameraTrack(null)
      setRemoteVideoTracks(new Map())
      if (localTrackRef.current) {
        localTrackRef.current.close()
      }
      if (clientRef.current) {
        void clientRef.current.leave().catch(() => {})
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => {})
      }
      setIsConnected(false)
    }
  }, [channelName, maxDistance, socket, mySocketId, attempt])

  useEffect(() => {
    updateSpatialAudio()
  }, [isHost, myToken?.x, myToken?.y, walls, isDeafened])

  const toggleCamera = async () => {
    if (cameraBusyRef.current) return
    cameraBusyRef.current = true
    setCameraBusy(true)
    setCameraError('')
    try {
      const client = clientRef.current
      if (!client || !isConnected) {
        setCameraError('Conecte o áudio da mesa antes de ativar a câmera.')
        return
      }
      if (cameraTrackRef.current) {
        const track = cameraTrackRef.current
        cameraTrackRef.current = null
        setCameraEnabled(false)
        setLocalCameraTrack(null)
        try { await client.unpublish([track]) }
        catch { /* Cleanup must still run if RTC disconnected. */ }
        finally { track.close() }
        return
      }
      let track: any = null
      try {
        const AgoraRTC = (await import('agora-rtc-sdk-ng')).default
        // Video capture is only created after the player's explicit button action.
        track = await AgoraRTC.createCameraVideoTrack({ encoderConfig: '360p_4' })
        if (clientRef.current !== client || client.connectionState !== 'CONNECTED') {
          track.close()
          return
        }
        await client.publish([track])
        if (clientRef.current !== client) {
          track.close()
          return
        }
        cameraTrackRef.current = track
        setLocalCameraTrack(track)
        setCameraEnabled(true)
      } catch (error) {
        track?.close()
        setCameraError('Câmera indisponível. Confira a permissão e tente novamente.')
        console.warn('Falha ao ativar webcam:', error)
      }
    } finally {
      cameraBusyRef.current = false
      setCameraBusy(false)
    }
  }

  const toggleMute = () => {
    if (localTrackRef.current) {
      const nextMuteState = !isMuted
      localTrackRef.current.setEnabled(!nextMuteState)
      setIsMuted(nextMuteState)
      if (socket) {
        socket.emit('toggle-audio-mute', { isMuted: nextMuteState })
      }
    }
  }

  const toggleDeafen = () => {
    const nextDeafenState = !isDeafenedRef.current
    isDeafenedRef.current = nextDeafenState
    setIsDeafened(nextDeafenState)
    if (socket) {
      socket.emit('toggle-audio-deafen', { isDeafened: nextDeafenState })
    }
    updateSpatialAudio()
  }

  return {
    isConnected,
    playbackBlocked,
    enablePlayback,
    audioError,
    audioStatus,
    retryAudio,
    isMuted,
    isDeafened,
    toggleMute,
    toggleDeafen,
    remoteUsers: Array.from(remoteUsers),
    cameraEnabled,
    cameraBusy,
    cameraError,
    localCameraTrack,
    remoteVideoTracks,
    toggleCamera,
    updateSpatialAudio,
  }
}
