'use client'

interface DiceRoll {
  playerId: string
  playerName: string
  formula: string
  result: number
  rolls: number[]
  modifier: number
  timestamp: number
}

interface DiceHistoryProps {
  rolls: DiceRoll[]
  myPlayerId: string
}

export default function DiceHistory({ rolls, myPlayerId }: DiceHistoryProps) {
  if (rolls.length === 0) {
    return (
      <div style={{
        background: 'rgba(255,255,255,0.05)',
        padding: '1rem',
        borderRadius: '12px',
        marginTop: '1rem',
        textAlign: 'center',
        color: '#666',
      }}>
        <p style={{ margin: 0 }}>📜 Nenhuma rolagem ainda</p>
      </div>
    )
  }

  return (
    <div style={{
      background: 'rgba(26, 15, 10, 0.4)',
      padding: '1rem',
      borderRadius: '12px',
      marginTop: '1rem',
      maxHeight: '300px',
      overflowY: 'auto',
      border: '1px solid #3d2b1f',
    }}>
      <h3 style={{ margin: '0 0 1rem', color: '#ff9d00', fontSize: '1rem', letterSpacing: '0.05em' }}>
        📜 CRÔNICA DE DADOS
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {rolls.slice().reverse().map((roll, idx) => {
          const isOwn = roll.playerId === myPlayerId
          const isCritical = roll.rolls.some(r => r === Math.max(...roll.rolls)) && roll.rolls.length === 1

          return (
            <div
              key={`${roll.timestamp}-${idx}`}
              style={{
                padding: '0.75rem',
                background: isOwn ? 'rgba(255, 157, 0, 0.05)' : 'rgba(0, 0, 0, 0.2)',
                border: `1px solid ${isOwn ? '#ff9d00' : '#3d2b1f'}`,
                borderRadius: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 'bold', color: isOwn ? '#ff9d00' : '#f4e4bc', fontSize: '0.85rem' }}>
                  {roll.playerName}
                </span>
                <span style={{ fontSize: '0.7rem', color: '#a35d1e' }}>
                  {new Date(roll.timestamp).toLocaleTimeString()}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ color: '#f4e4bc', fontSize: '0.85rem', opacity: 0.8 }}>
                    {roll.formula}
                  </span>
                  <div style={{ fontSize: '0.7rem', color: '#a35d1e', marginTop: '0.25rem' }}>
                    [{roll.rolls.join(', ')}] {roll.modifier !== 0 && `${roll.modifier > 0 ? '+' : ''}${roll.modifier}`}
                  </div>
                </div>

                <div style={{
                  fontSize: '1.4rem',
                  fontWeight: 'bold',
                  color: isCritical ? '#ffd700' : (isOwn ? '#ff9d00' : '#f4e4bc'),
                  textShadow: isCritical ? '0 0 10px rgba(255,215,0,0.5)' : 'none'
                }}>
                  {roll.result}
                  {isCritical && ' ✨'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}