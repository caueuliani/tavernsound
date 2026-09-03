'use client'

import { useEffect, useRef, useState } from 'react'
import { useVoiceDetection } from './useVoiceDetection'

interface Token {
  id: string
  x: number
  y: number
  playerId: string
}

interface WallData {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  isDoor?: boolean
  isOpen?: boolean
  blocksAudio?: boolean
}

interface SpatialAudioConfig {
  channelName: string
  myToken: Token | null
  allTokens: Map<string, Token>
  walls?: WallData[]
  maxDistance?: number
  mySocketId?: string
  socket?: any
}

interface RemoteAudioNode {
  pannerNode: PannerNode
  gainNode: GainNode
  filterNode: BiquadFilterNode
  source: MediaStreamAudioSourceNode
}

export function useSpatialAudio(config: SpatialAudioConfig) {
  const {
    channelName,
    myToken,
    allTokens,
    walls = [],
    maxDistance = 1000,
    mySocketId,
    socket,
  } = config

  const clientRef = useRef<any>(null)
  const localTrackRef = useRef<any>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const remoteAudioNodesRef = useRef<Map<string, RemoteAudioNode>>(new Map())

  const [isConnected, setIsConnected] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isDeafened, setIsDeafened] = useState(false)
  const [remoteUsers, setRemoteUsers] = useState<Set<string>>(new Set())
  const socketToAgoraMapRef = useRef<Map<string, string>>(new Map())
  const myAgoraUidRef = useRef<string>('')

  const [localAudioTrack, setLocalAudioTrack] = useState<any>(null)

  const myTokenRef = useRef<Token | null>(null)
  myTokenRef.current = myToken

  const wallsRef = useRef<WallData[]>(walls)
  wallsRef.current = walls

  const calculateDistance = (token1: Token, token2: Token): number => {
    const dx = token1.x - token2.x
    const dy = token1.y - token2.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  // Algoritmo para verificar interseção entre dois segmentos de reta (Linha de Som vs Parede)
  const checkLineIntersection = (
    p0_x: number, p0_y: number, p1_x: number, p1_y: number,
    p2_x: number, p2_y: number, p3_x: number, p3_y: number
  ): boolean => {
    const s1_x = p1_x - p0_x
    const s1_y = p1_y - p0_y
    const s2_x = p3_x - p2_x
    const s2_y = p3_y - p2_y

    const s = (-s1_y * (p0_x - p2_x) + s1_x * (p0_y - p2_y)) / (-s2_x * s1_y + s1_x * s2_y)
    const t = (s2_x * (p0_y - p2_y) - s2_y * (p0_x - p2_x)) / (-s2_x * s1_y + s1_x * s2_y)

    return s >= 0 && s <= 1 && t >= 0 && t <= 1
  }

  // Verifica se há paredes/portas fechadas bloqueando o caminho do som
  const calculateWallOcclusion = (listenerToken: Token, emitterToken: Token): { isOccluded: boolean; occlusionCount: number } => {
    let occlusionCount = 0
    const currentWalls = wallsRef.current || []

    for (const wall of currentWalls) {
      if (wall.blocksAudio === false) continue
      if (wall.isDoor && wall.isOpen) continue

      const intersects = checkLineIntersection(
        listenerToken.x, listenerToken.y,
        emitterToken.x, emitterToken.y,
        wall.x1, wall.y1,
        wall.x2, wall.y2
      )

      if (intersects) {
        occlusionCount++
      }
    }

    return {
      isOccluded: occlusionCount > 0,
      occlusionCount,
    }
  }

  const handleSpeakingChange = (isSpeaking: boolean) => {
    if (socket) {
      socket.emit('player-speaking', { isSpeaking })
    }
  }

  useVoiceDetection(localAudioTrack, {
    onSpeakingChange: handleSpeakingChange,
    threshold: 0.01,
    smoothing: 0.8,
  })

  const updateSpatialAudio = () => {
    const currentToken = myTokenRef.current
    if (!currentToken || !audioContextRef.current) return

    const audioContext = audioContextRef.current

    remoteAudioNodesRef.current.forEach((audioNode, agoraUid) => {
      const socketId = Array.from(socketToAgoraMapRef.current.entries())
        .find(([_, uid]) => uid === agoraUid)?.[0]

      if (!socketId) return

      const remoteToken = allTokens.get(socketId)
      if (!remoteToken) return

      const distance = calculateDistance(currentToken, remoteToken)

      const relativeX = (remoteToken.x - currentToken.x)
      const relativeY = 0
      const relativeZ = (remoteToken.y - currentToken.y) * -1

      audioNode.pannerNode.positionX.setValueAtTime(relativeX, audioContext.currentTime)
      audioNode.pannerNode.positionY.setValueAtTime(relativeY, audioContext.currentTime)
      audioNode.pannerNode.positionZ.setValueAtTime(relativeZ, audioContext.currentTime)

      const { isOccluded, occlusionCount } = calculateWallOcclusion(currentToken, remoteToken)

      if (distance > maxDistance || isDeafened) {
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
      console.error('❌ NEXT_PUBLIC_AGORA_APP_ID não encontrado')
      return
    }

    let AgoraRTC: any

    const initAgora = async () => {
      try {
        if (!mySocketId) {
          console.warn('⚠️ mySocketId ainda não está pronto, aguardando...')
          return
        }

        AgoraRTC = (await import('agora-rtc-sdk-ng')).default

        const client = AgoraRTC.createClient({
          mode: 'rtc',
          codec: 'vp8',
        })

        clientRef.current = client

        const audioContext = new AudioContext()
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
          if (mediaType === 'audio') {
            await client.subscribe(user, mediaType)

            const remoteAudioTrack = user.audioTrack
            if (!remoteAudioTrack || !audioContextRef.current) return

            const currentAudioContext = audioContextRef.current

            const mediaStream = new MediaStream([remoteAudioTrack.getMediaStreamTrack()])
            const source = currentAudioContext.createMediaStreamSource(mediaStream)

            const pannerNode = currentAudioContext.createPanner()
            pannerNode.panningModel = 'HRTF'
            pannerNode.distanceModel = 'inverse'
            pannerNode.refDistance = 100
            pannerNode.maxDistance = maxDistance
            pannerNode.rolloffFactor = 1

            const filterNode = currentAudioContext.createBiquadFilter()
            filterNode.type = 'lowpass'
            filterNode.frequency.setValueAtTime(20000, currentAudioContext.currentTime)

            const gainNode = currentAudioContext.createGain()
            gainNode.gain.value = 1

            source.connect(pannerNode)
            pannerNode.connect(filterNode)
            filterNode.connect(gainNode)
            gainNode.connect(currentAudioContext.destination)

            remoteAudioNodesRef.current.set(user.uid.toString(), {
              pannerNode,
              filterNode,
              gainNode,
              source,
            })

            setRemoteUsers(prev => new Set(prev).add(user.uid.toString()))

            setTimeout(() => updateSpatialAudio(), 300)
          }
        })

        client.on('user-unpublished', (user: any) => {
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

        if (socket) {
          socket.on('agora-uid-announced', (data: { socketId: string; agoraUid: string }) => {
            socketToAgoraMapRef.current.set(data.socketId, data.agoraUid)
            updateSpatialAudio()
          })

          socket.on('walls-updated', () => {
            updateSpatialAudio()
          })

          socket.on('door-toggled', () => {
            updateSpatialAudio()
          })

          socket.on('player-audio-position-updated', () => {
            updateSpatialAudio()
          })
        }

        let token = null
        let retries = 3
        while (retries > 0 && !token) {
          try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
            const tokenResponse = await fetch(
              `${apiUrl}/agora/token?channelName=${channelName}&uid=0`
            )
            const tokenData = await tokenResponse.json()

            if (tokenData.error) {
              retries--
              await new Promise(resolve => setTimeout(resolve, 500))
              continue
            }

            token = tokenData.token
            break
          } catch (error) {
            console.error('❌ Erro ao buscar token Agora:', error)
            retries--
            if (retries > 0) {
              await new Promise(resolve => setTimeout(resolve, 500))
            }
          }
        }

        if (!token) {
          console.error('❌ Falha ao gerar token após 3 tentativas')
          return
        }

        const uid = await client.join(appId, channelName, token, 0)

        myAgoraUidRef.current = uid.toString()
        if (mySocketId && socket) {
          socketToAgoraMapRef.current.set(mySocketId, uid.toString())
          socket.emit('announce-agora-uid', {
            socketId: mySocketId,
            agoraUid: uid.toString(),
          })
        }

        const localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
          encoderConfig: 'music_standard',
        })
        localTrackRef.current = localAudioTrack
        setLocalAudioTrack(localAudioTrack)

        await client.publish([localAudioTrack])
        setIsConnected(true)
      } catch (error) {
        console.error('❌ Erro ao inicializar Agora:', error)
      }
    }

    initAgora()

    return () => {
      if (socket) {
        socket.off('agora-uid-announced')
        socket.off('walls-updated')
        socket.off('door-toggled')
        socket.off('player-audio-position-updated')
      }
      remoteAudioNodesRef.current.forEach(audioNode => {
        try {
          audioNode.source.disconnect()
          audioNode.pannerNode.disconnect()
          audioNode.filterNode.disconnect()
          audioNode.gainNode.disconnect()
        } catch (e) {}
      })
      remoteAudioNodesRef.current.clear()

      if (localTrackRef.current) {
        localTrackRef.current.close()
      }
      if (clientRef.current) {
        clientRef.current.leave()
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
      setIsConnected(false)
    }
  }, [channelName, maxDistance, socket, mySocketId])

  useEffect(() => {
    updateSpatialAudio()
  }, [myToken?.x, myToken?.y, walls])

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
    const nextDeafenState = !isDeafened
    setIsDeafened(nextDeafenState)
    if (socket) {
      socket.emit('toggle-audio-deafen', { isDeafened: nextDeafenState })
    }
    updateSpatialAudio()
  }

  return {
    isConnected,
    isMuted,
    isDeafened,
    toggleMute,
    toggleDeafen,
    remoteUsers: Array.from(remoteUsers),
    updateSpatialAudio,
  }
}
