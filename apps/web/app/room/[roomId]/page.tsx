'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Grid from '../../components/Grid'

interface SessionUser {
  id: string
  name: string | null
  email: string
}

export default function RoomPage() {
  const params = useParams()
  const router = useRouter()
  const roomId = params.roomId as string

  const [playerCount, setPlayerCount] = useState(0)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(data => { if (data.user) setCurrentUser(data.user) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const handlePlayerCount = (event: any) => {
      setPlayerCount(event.detail.count)
    }
    window.addEventListener('room-player-count', handlePlayerCount)
    return () => window.removeEventListener('room-player-count', handlePlayerCount)
  }, [])

  return (
    <div style={{ 
      minHeight: '100vh',
      // Radial gradient combinando com a Home
      background: 'radial-gradient(circle at center, #3d2b1f 0%, #1a0f0a 100%)',
      padding: '1.5rem',
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto 1.5rem',
        background: 'rgba(26, 15, 10, 0.8)', 
        border: '1px solid #3d2b1f',
        padding: '0.8rem 1.5rem',
        borderRadius: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        color: '#f4e4bc', // Texto bege rústico
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        backdropFilter: 'blur(10px)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <img src="/assets/TavernSound_VTT_logo.png" style={{ width: '40px', height: '40px' }} alt="Logo" />
          <div>
            <h1 style={{ margin: 0, fontSize: '1.2rem', color: '#ff9d00', letterSpacing: '0.05em' }}>
              TAVERN: {roomId}
            </h1>
            <p style={{ margin: 0, opacity: 0.6, fontSize: '0.75rem', fontWeight: 'bold' }}>
              {playerCount} AVENTUREIRO{playerCount !== 1 ? 'S' : ''} NA MESA
            </p>
          </div>
        </div>

        {currentUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.8rem', color: '#f4e4bc' }}>
            <span style={{ opacity: 0.6 }}>
              Jogando como <strong style={{ color: '#d4af37' }}>{currentUser.name || currentUser.email}</strong>
            </span>
            <button
              onClick={async () => {
                const response = await fetch('/api/auth/logout', { method: 'POST' })
                if (!response.ok) { alert('Não foi possível sair. Tente novamente.'); return }
                router.push('/login')
              }}
              style={{ background: 'none', border: 'none', color: '#a35d1e', cursor: 'pointer', fontSize: '0.75rem', padding: 0, textDecoration: 'underline' }}
            >
              Sair
            </button>
          </div>
        )}
        
        <button
          onClick={() => {
            if (confirm('Deseja abandonar a taverna?')) {
              router.push('/rooms')
            }
          }}
          style={{
            padding: '0.5rem 1.2rem',
            background: 'transparent',
            color: '#ff6b6b',
            border: '1px solid #ff6b6b',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '0.8rem',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,107,107,0.1)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          🚪 Abandonar
        </button>
      </div>

      <div style={{ 
        maxWidth: '1200px',
        margin: '0 auto',
      }}>
        <Grid roomId={roomId} />
      </div>
    </div>
  )
}

