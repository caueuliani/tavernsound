'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { io } from 'socket.io-client'
import Image from 'next/image'
import { apiUrl, socketUrl } from '../lib/api-url'

// Cores baseadas no seu logo
const COLORS = {
  woodDark: '#1a0f0a',     // Fundo quase preto/madeira escura
  amber: '#ff9d00',        // Brilho das ondas sonoras
  gold: '#d4af37',         // Detalhes da caneca e fone
  woodWarm: '#3d2b1f',     // Cor secundária de madeira
  textLight: '#f4e4bc',    // Bege rústico para textos
  accent: '#e67e22'        // Laranja vibrante para botões
}

export default function Home() {
  const router = useRouter()
  const [roomId, setRoomId] = useState('')
  const [roomName, setRoomName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [rooms, setRooms] = useState<{ id: string; name: string | null; isOwner: boolean }[]>([])
  const [deletingRoom, setDeletingRoom] = useState<string | null>(null)
  const [roomsError, setRoomsError] = useState('')

  useEffect(() => {
    let active = true
    fetch(apiUrl('/rooms'), { credentials: 'include', cache: 'no-store' })
      .then(async response => {
        if (response.status === 401) { router.replace('/login'); return }
        if (!response.ok) throw new Error()
        const data = await response.json()
        if (active && Array.isArray(data)) setRooms(data)
      }).catch(() => { if (active) setRoomsError('Não foi possível carregar suas salas.') })
    return () => { active = false }
  }, [router])

  const handleCreateRoom = () => {
    setIsCreating(true)
    setCreateError('')
    const socket = io(socketUrl(), { withCredentials: true })

    // Timeout de segurança: se o servidor não responder em 8s, desbloqueia o botão
    const timeout = setTimeout(() => {
      socket.disconnect()
      setIsCreating(false)
      setCreateError('Sem resposta do servidor. Tente novamente.')
    }, 8000)

    socket.on('room-error', (data: { message: string }) => {
      clearTimeout(timeout)
      socket.disconnect()
      setIsCreating(false)
      setCreateError(data.message)
    })
    socket.on('connect_error', () => {
      clearTimeout(timeout)
      socket.disconnect()
      setIsCreating(false)
      setCreateError('Não foi possível conectar. Faça login novamente ou verifique o servidor.')
    })

    socket.emit('create-room', { name: roomName || 'Nova Sala' }, (response: any) => {
      clearTimeout(timeout)
      socket.disconnect()
      if (response?.roomId) {
        router.push(`/room/${response.roomId}`)
      } else {
        setIsCreating(false)
      }
    })
  }

  const handleJoinRoom = () => {
    if (roomId.trim()) {
      router.push(`/room/${roomId.toUpperCase()}`)
    }
  }

  const handleDeleteRoom = async (room: typeof rooms[number]) => {
    if (deletingRoom || !window.confirm(`Excluir a sala “${room.name || 'Sala sem nome'}” (${room.id})?\n\nO mapa, os tokens e o histórico de dados serão apagados, e os participantes serão desconectados. Esta ação não pode ser desfeita.`)) return
    setDeletingRoom(room.id)
    setRoomsError('')
    try {
      const response = await fetch(apiUrl(`/rooms/${room.id}`), { method: 'DELETE', credentials: 'include' })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(typeof data?.message === 'string' ? data.message : 'Não foi possível excluir a sala. Tente novamente.')
      }
      setRooms(current => current.filter(item => item.id !== room.id))
    } catch (error) {
      setRoomsError(error instanceof Error ? error.message : 'Não foi possível excluir a sala.')
    } finally { setDeletingRoom(null) }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      // Gradiente que imita a iluminação de uma taverna escura
      background: `radial-gradient(circle at center, ${COLORS.woodWarm} 0%, ${COLORS.woodDark} 100%)`,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        background: 'rgba(26, 15, 10, 0.85)', // Semi-transparente para profundidade
        borderRadius: '24px',
        padding: '3rem',
        boxShadow: `0 0 50px rgba(0,0,0,0.5), 0 0 20px ${COLORS.amber}22`,
        maxWidth: '500px',
        width: '90%',
        border: `1px solid ${COLORS.woodWarm}`,
        backdropFilter: 'blur(10px)'
      }}>
        {/* Header */}
        <a href="/" style={{ color: COLORS.gold, fontSize: '0.85rem' }}>← Conhecer o TavernSound</a>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px' }}>
            <img 
              src="/assets/TavernSound_VTT_logo.png" 
              alt="Logo"
              style={{ width: '80px', height: '80px', objectFit: 'contain' }} 
            />
            <h1 style={{ 
              fontSize: '2.2rem', 
              margin: 0, 
              background: `linear-gradient(to bottom, ${COLORS.amber}, ${COLORS.gold})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontWeight: '900',
              letterSpacing: '-0.02em',
              lineHeight: '1'
            }}>
              TavernSound<br/><span style={{ fontSize: '1.2rem', opacity: 0.8 }}>VTT</span>
            </h1>
          </div>
          <p style={{ color: COLORS.textLight, opacity: 0.7, marginTop: '0.5rem' }}>
            Virtual Tabletop com Áudio Espacial 3D
          </p>
        </div>

        {/* Criar Sala */}
        <div style={{ 
          marginBottom: '2rem',
          padding: '1.5rem',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '16px',
          border: `1px solid ${COLORS.woodWarm}`,
        }}>
          <h2 style={{ fontSize: '1.1rem', marginTop: 0, marginBottom: '1rem', color: COLORS.gold }}>
             🆕 Criar Nova Sala
          </h2>
          
          <input
            type="text"
            placeholder="Nome da sala (ex: Dungeon do Dragão)"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            style={{
              width: '100%',
              padding: '0.85rem',
              background: 'rgba(0,0,0,0.2)',
              border: `1px solid ${COLORS.woodWarm}`,
              borderRadius: '10px',
              color: 'white',
              fontSize: '1rem',
              marginBottom: '1rem',
              boxSizing: 'border-box',
            }}
          />
          
          {createError && (
            <div style={{ padding: '0.6rem 0.85rem', marginBottom: '0.75rem', background: 'rgba(231,76,60,0.15)', border: '1px solid #e74c3c', borderRadius: '8px', color: '#e74c3c', fontSize: '0.85rem' }}>
              {createError}
              {createError.toLowerCase().includes('plano') && (
                <div style={{ marginTop: '0.4rem' }}>
                  <a href="/pricing" style={{ color: '#ff9d00', fontWeight: 'bold', textDecoration: 'underline' }}>
                    Ver planos e fazer upgrade ✦
                  </a>
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleCreateRoom}
            disabled={isCreating}
            style={{
              width: '100%',
              padding: '0.85rem',
              background: `linear-gradient(135deg, ${COLORS.amber} 0%, ${COLORS.accent} 100%)`,
              color: COLORS.woodDark,
              border: 'none',
              borderRadius: '10px',
              fontSize: '1rem',
              fontWeight: 'bold',
              cursor: isCreating ? 'not-allowed' : 'pointer',
              opacity: isCreating ? 0.6 : 1,
              transition: 'all 0.3s ease',
              boxShadow: `0 4px 15px ${COLORS.amber}44`
            }}
            onMouseEnter={(e) => {
              if (!isCreating) e.currentTarget.style.filter = 'brightness(1.2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = 'brightness(1)'
            }}
          >
            {isCreating ? '⏳ Preparando Taverna...' : '🔥 Abrir Taverna'}
          </button>
        </div>

        {roomsError && <p role="alert">{roomsError}</p>}
        {rooms.length > 0 && <section style={{ color: COLORS.textLight, marginTop: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem' }}>Suas salas</h2>
          <ul>{rooms.map(room => <li key={room.id} style={{ marginBottom: '0.5rem' }}>
            <button onClick={() => router.push(`/room/${room.id}`)}>{room.name || 'Sala sem nome'} · {room.id}</button>
            {room.isOwner && <button
              aria-label={`Excluir sala ${room.name || room.id}`}
              disabled={deletingRoom !== null}
              onClick={() => handleDeleteRoom(room)}
              style={{ marginLeft: '0.5rem', color: '#ffb4ab', background: '#451c18', border: '1px solid #a84b42', borderRadius: '6px', padding: '0.35rem 0.6rem', cursor: deletingRoom ? 'wait' : 'pointer' }}
            >{deletingRoom === room.id ? 'Excluindo…' : 'Excluir'}</button>}
          </li>)}</ul>
        </section>}
        {/* Divisor */}
        <div style={{ display: 'flex', alignItems: 'center', margin: '2rem 0', color: COLORS.woodWarm }}>
          <div style={{ flex: 1, height: '1px', background: COLORS.woodWarm }} />
          <span style={{ padding: '0 1rem', fontSize: '0.75rem', fontWeight: 'bold' }}>OU</span>
          <div style={{ flex: 1, height: '1px', background: COLORS.woodWarm }} />
        </div>

        {/* Entrar na Sala */}
        <div>
          <h2 style={{ fontSize: '1.1rem', marginTop: 0, marginBottom: '1rem', color: COLORS.gold }}>
            🚪 Entrar em uma Sala
          </h2>
          
          <input
            type="text"
            placeholder="CÓDIGO DA SALA"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            style={{
              width: '100%',
              padding: '0.85rem',
              background: 'rgba(0,0,0,0.2)',
              border: `1px solid ${COLORS.woodWarm}`,
              borderRadius: '10px',
              color: COLORS.amber,
              fontSize: '1.1rem',
              fontWeight: 'bold',
              textAlign: 'center',
              marginBottom: '1rem',
              boxSizing: 'border-box',
              letterSpacing: '0.2em',
            }}
          />
          
          <button
            onClick={handleJoinRoom}
            disabled={!roomId.trim()}
            style={{
              width: '100%',
              padding: '0.85rem',
              background: 'transparent',
              color: roomId.trim() ? COLORS.gold : '#555',
              border: `2px solid ${roomId.trim() ? COLORS.gold : '#333'}`,
              borderRadius: '10px',
              fontSize: '1rem',
              fontWeight: 'bold',
              cursor: roomId.trim() ? 'pointer' : 'not-allowed',
              transition: 'all 0.3s ease',
            }}
          >
            🎯 Entrar na Mesa
          </button>
        </div>

        {/* Footer Dica */}
        <div style={{
          marginTop: '2.5rem',
          padding: '1rem',
          background: 'rgba(255,157,0,0.05)',
          borderRadius: '12px',
          fontSize: '0.85rem',
          color: COLORS.textLight,
          textAlign: 'center',
          border: `1px dashed ${COLORS.amber}33`
        }}>
          💡 <strong>Dica de Mestre:</strong> Use fones de ouvido para sentir o áudio espacial 3D em sua totalidade.
        </div>

        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <a href="/pricing" style={{ color: COLORS.accent, fontSize: '0.8rem', textDecoration: 'none', opacity: 0.8 }}>
            Ver planos e preços ✦
          </a>
        </div>
      </div>
    </div>
  )
}
