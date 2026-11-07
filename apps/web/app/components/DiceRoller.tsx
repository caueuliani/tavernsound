'use client'

import { useState } from 'react'

interface DiceRollerProps {
  onRoll: (quantity: number, sides: number, modifier: number, mode: 'normal' | 'advantage' | 'disadvantage') => void
  playerName: string
}

const DICE_TYPES = [
  { sides: 4, emoji: '🔺' },
  { sides: 6, emoji: '🎲' },
  { sides: 8, emoji: '🔶' },
  { sides: 10, emoji: '🔟' },
  { sides: 12, emoji: '🌟' },
  { sides: 20, emoji: '🎯' },
  { sides: 100, emoji: '💯' },
]

export default function DiceRoller({ onRoll, playerName }: DiceRollerProps) {
  const [quantity, setQuantity] = useState(1)
  const [sides, setSides] = useState(20)
  const [modifier, setModifier] = useState(0)
  const [mode, setMode] = useState<'normal' | 'advantage' | 'disadvantage'>('normal')
  const [isRolling, setIsRolling] = useState(false)

  const rollDice = () => {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 30 || !Number.isInteger(modifier) || modifier < -1000 || modifier > 1000) return
    setIsRolling(true)

    onRoll(quantity, sides, modifier, quantity === 1 && sides === 20 ? mode : 'normal')
    setTimeout(() => setIsRolling(false), 500)
  }

  return (
    <div style={{
      background: 'rgba(26, 15, 10, 0.6)',
      padding: '1rem',
      borderRadius: '12px',
      marginTop: '1rem',
      border: '1px solid #3d2b1f',
    }}>
      <h3 style={{ margin: '0 0 1rem', color: '#ff9d00', fontSize: '1rem', letterSpacing: '0.05em' }}>
        🎲 ROLAR DADOS
      </h3>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {/* Estilo para os inputs de número */}
        {['Quantidade', 'Modificador'].map((label, idx) => (
          <div key={label}>
            <label style={{ display: 'block', fontSize: '0.7rem', marginBottom: '0.25rem', color: '#a35d1e', fontWeight: 'bold' }}>
              {label}
            </label>
            <input
              type="number"
              value={idx === 0 ? quantity : modifier}
              onChange={(e) => idx === 0 ? setQuantity(Math.max(1, Math.min(30, parseInt(e.target.value) || 1))) : setModifier(Math.max(-1000, Math.min(1000, parseInt(e.target.value) || 0)))}
              style={{
                width: '60px',
                padding: '0.5rem',
                background: '#1a0f0a',
                border: '1px solid #3d2b1f',
                borderRadius: '6px',
                color: '#f4e4bc',
                fontSize: '1rem',
              }}
            />
          </div>
        ))}

        {/* Tipo de dado */}
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: '0.7rem', marginBottom: '0.25rem', color: '#a35d1e', fontWeight: 'bold' }}>
            Tipo de Dado
          </label>
          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
            {DICE_TYPES.map(dice => (
              <button
                key={dice.sides}
                onClick={() => setSides(dice.sides)}
                style={{
                  padding: '0.4rem',
                  background: sides === dice.sides ? '#ff9d00' : '#1a0f0a',
                  border: `1px solid ${sides === dice.sides ? '#ff9d00' : '#3d2b1f'}`,
                  borderRadius: '6px',
                  color: sides === dice.sides ? '#1a0f0a' : '#f4e4bc',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  transition: 'all 0.2s',
                }}
              >
                d{dice.sides}
              </button>
            ))}
          </div>
        </div>
      </div>

      {quantity === 1 && sides === 20 && <label style={{ color: '#f4e4bc', display: 'block', marginBottom: '0.8rem' }}>
        Rolagem d20
        <select value={mode} onChange={e => setMode(e.target.value as 'normal' | 'advantage' | 'disadvantage')}
          style={{ marginLeft: '0.5rem', background: '#1a0f0a', color: '#ffcf77', padding: '0.5rem', border: '1px solid #3d2b1f', borderRadius: 8 }}>
          <option value="normal">Normal</option>
          <option value="advantage">Vantagem (2d20, maior)</option>
          <option value="disadvantage">Desvantagem (2d20, menor)</option>
        </select>
      </label>}

      {/* Preview da fórmula */}
      <div style={{
        padding: '0.5rem',
        background: '#1a0f0a',
        borderRadius: '8px',
        marginBottom: '1rem',
        textAlign: 'center',
        fontSize: '1.4rem',
        fontWeight: 'bold',
        color: '#ff9d00',
        border: '1px dashed #3d2b1f'
      }}>
        {quantity}d{sides}{modifier !== 0 ? (modifier > 0 ? `+${modifier}` : modifier) : ''}{quantity === 1 && sides === 20 && mode !== 'normal' ? ` (${mode === 'advantage' ? 'vantagem' : 'desvantagem'})` : ''}
      </div>

      <button
        onClick={rollDice}
        disabled={isRolling}
        style={{
          width: '100%',
          padding: '0.75rem',
          background: isRolling ? '#3d2b1f' : 'linear-gradient(135deg, #ff9d00 0%, #d4af37 100%)',
          color: '#1a0f0a',
          border: 'none',
          borderRadius: '8px',
          fontSize: '1rem',
          fontWeight: 'extrabold',
          cursor: isRolling ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s',
        }}
      >
        {isRolling ? '🎲 ROLANDO...' : '🎲 LANÇAR SORTE'}
      </button>
    </div>
  )
}