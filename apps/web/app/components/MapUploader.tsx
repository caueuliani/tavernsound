'use client'

import { useRef } from 'react'

interface MapUploaderProps {
  onUpload: (mapData: string, width: number, height: number) => void
  onRemove: () => void
  hasMap: boolean
  isHost?: boolean
}

export default function MapUploader({ onUpload, onRemove, hasMap, isHost = false }: MapUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert('Por favor, selecione uma imagem!')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      alert('Imagem muito grande! Máximo 5MB.')
      return
    }

    const reader = new FileReader()
    reader.onerror = () => alert('Erro ao ler o arquivo.')

    reader.onload = (event) => {
      const img = new Image()
      img.onerror = () => alert('Erro ao carregar a imagem.')

      img.onload = () => {
        const MAX_SIZE = 2048
        let width = img.width
        let height = img.height

        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        if (width > MAX_SIZE || height > MAX_SIZE) {
          if (width > height) {
            height = Math.round((height / width) * MAX_SIZE)
            width = MAX_SIZE
          } else {
            width = Math.round((width / height) * MAX_SIZE)
            height = MAX_SIZE
          }
        }

        canvas.width = width
        canvas.height = height
        ctx.drawImage(img, 0, 0, width, height)

        onUpload(canvas.toDataURL('image/jpeg', 0.6), img.width, img.height)
      }

      img.src = event.target?.result as string
    }

    reader.readAsDataURL(file)
  }

  const handleButtonClick = () => fileInputRef.current?.click()
  const handleRemoveClick = () => onRemove()

    return (
    <div style={{
        background: 'rgba(26, 15, 10, 0.6)', // Fundo madeira escura
        padding: '1rem',
        borderRadius: '12px',
        marginTop: '1rem',
        border: '1px solid #3d2b1f', // Borda sutil
    }}>
        <h3 style={{ margin: '0 0 1rem', color: '#ff9d00', fontSize: '1rem', letterSpacing: '0.05em' }}>
        🗺️ MAPA DE FUNDO
        </h3>

        <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        />

        {isHost ? (
          !hasMap ? (
            <button
              onClick={handleButtonClick}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: 'linear-gradient(135deg, #ff9d00 0%, #d4af37 100%)',
                color: '#1a0f0a',
                border: 'none',
                borderRadius: '8px',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
              onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
            >
              📤 ENVIAR MAPA
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={handleButtonClick}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  background: '#3d2b1f',
                  color: '#ff9d00',
                  border: '1px solid #ff9d00',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                🔄 TROCAR
              </button>
              <button
                onClick={handleRemoveClick}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  background: 'transparent',
                  color: '#ff6b6b',
                  border: '1px solid #ff6b6b',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                🗑️ REMOVER
              </button>
            </div>
          )
        ) : (
          <p style={{ fontSize: '0.75rem', color: '#666', margin: 0, textAlign: 'center' }}>
            Somente o Mestre pode gerenciar o mapa.
          </p>
        )}

        <p style={{ 
        fontSize: '0.7rem', 
        color: '#a35d1e', 
        marginTop: '0.75rem',
        textAlign: 'center'
        }}>
        JPG, PNG, WebP | Max: 5MB
        </p>
    </div>
    )
}