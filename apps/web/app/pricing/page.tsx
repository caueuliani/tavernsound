'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

interface Plan {
  tier: 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE'
  name: string
  price: string
  features: string[]
  highlight?: boolean
}

const PLANS: Plan[] = [
  {
    tier: 'FREE',
    name: 'Aventureiro',
    price: 'Grátis',
    features: [
      '1 sala ativa',
      'Até 4 jogadores',
      'Áudio espacial',
      'Tokens e grades',
      'Fog of War',
      'Chat em tempo real',
    ],
  },
  {
    tier: 'BASIC',
    name: 'Mestre',
    price: 'R$ 19/mês',
    highlight: true,
    features: [
      'Até 5 salas ativas',
      'Até 6 jogadores por sala',
      'Tudo do plano Aventureiro',
      'Upload de mapas maiores',
      'Histórico de dados estendido',
    ],
  },
  {
    tier: 'PRO',
    name: 'Arquimago',
    price: 'R$ 39/mês',
    features: [
      'Salas ilimitadas',
      'Até 12 jogadores por sala',
      'Tudo do plano Mestre',
      'Prioridade no suporte',
      'Badge exclusivo',
    ],
  },
  {
    tier: 'ENTERPRISE',
    name: 'Lenda',
    price: 'Sob consulta',
    features: [
      'Salas e jogadores ilimitados',
      'SLA garantido',
      'Integrações personalizadas',
      'Suporte dedicado',
    ],
  },
]

export default function PricingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [userTier, setUserTier] = useState<string | null>(null)

  const success = searchParams.get('success')
  const canceled = searchParams.get('canceled')

  useEffect(() => {
    fetch(`${API_URL}/subscriptions/me`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (data.tier) setUserTier(data.tier) })
      .catch(() => {})
  }, [])

  const handleSubscribe = async (tier: string) => {
    if (tier === 'FREE') { router.push('/'); return }
    if (tier === 'ENTERPRISE') {
      window.location.href = 'mailto:contato@tavernsound.com?subject=Plano Enterprise'
      return
    }
    if (tier === userTier) return

    setLoading(tier)
    setError(null)

    try {
      const res = await fetch(`${API_URL}/subscriptions/checkout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier,
          successUrl: `${window.location.origin}/pricing?success=1`,
          cancelUrl: `${window.location.origin}/pricing?canceled=1`,
        }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      if (data.url) window.location.href = data.url
    } catch {
      setError('Erro ao conectar com o servidor. Tente novamente.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(circle at center, #3d2b1f 0%, #1a0f0a 100%)',
      padding: '3rem 1.5rem',
      color: '#f4e4bc',
    }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h1 style={{ fontSize: '2.5rem', color: '#ff9d00', letterSpacing: '0.05em', margin: '0 0 0.5rem' }}>
            PLANOS E PREÇOS
          </h1>
          <p style={{ opacity: 0.6, fontSize: '1rem' }}>
            Escolha o plano certo para sua mesa de RPG
          </p>
        </div>

        {/* Success / cancel banners */}
        {success && (
          <div style={{ background: 'rgba(46,204,113,0.15)', border: '1px solid #2ecc71', borderRadius: '8px', padding: '1rem', textAlign: 'center', marginBottom: '2rem', color: '#2ecc71' }}>
            ✅ Assinatura confirmada! Seu plano foi atualizado.
          </div>
        )}
        {canceled && (
          <div style={{ background: 'rgba(231,76,60,0.15)', border: '1px solid #e74c3c', borderRadius: '8px', padding: '1rem', textAlign: 'center', marginBottom: '2rem', color: '#e74c3c' }}>
            Pagamento cancelado. Você pode tentar novamente quando quiser.
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(231,76,60,0.15)', border: '1px solid #e74c3c', borderRadius: '8px', padding: '1rem', textAlign: 'center', marginBottom: '2rem', color: '#e74c3c' }}>
            {error}
          </div>
        )}

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1.5rem' }}>
          {PLANS.map(plan => {
            const isCurrent = userTier === plan.tier
            return (
              <div
                key={plan.tier}
                style={{
                  background: plan.highlight ? 'rgba(255,157,0,0.08)' : 'rgba(26,15,10,0.7)',
                  border: isCurrent
                    ? '2px solid #2ecc71'
                    : plan.highlight ? '2px solid #ff9d00' : '1px solid #3d2b1f',
                  borderRadius: '16px',
                  padding: '2rem 1.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  position: 'relative',
                }}
              >
                {isCurrent && (
                  <div style={{
                    position: 'absolute',
                    top: '-13px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#2ecc71',
                    color: '#1a0f0a',
                    fontSize: '0.7rem',
                    fontWeight: 'bold',
                    padding: '3px 12px',
                    borderRadius: '20px',
                    letterSpacing: '0.1em',
                    whiteSpace: 'nowrap',
                  }}>
                    PLANO ATUAL
                  </div>
                )}
                {!isCurrent && plan.highlight && (
                  <div style={{
                    position: 'absolute',
                    top: '-13px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#ff9d00',
                    color: '#1a0f0a',
                    fontSize: '0.7rem',
                    fontWeight: 'bold',
                    padding: '3px 12px',
                    borderRadius: '20px',
                    letterSpacing: '0.1em',
                  }}>
                    MAIS POPULAR
                  </div>
                )}

                <div>
                  <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.3rem', color: isCurrent ? '#2ecc71' : plan.highlight ? '#ff9d00' : '#d4af37' }}>
                    {plan.name}
                  </h2>
                  <p style={{ margin: 0, fontSize: '1.6rem', fontWeight: 'bold', color: '#f4e4bc' }}>
                    {plan.price}
                  </p>
                </div>

                <ul style={{ margin: 0, padding: '0 0 0 1rem', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {plan.features.map(f => (
                    <li key={f} style={{ fontSize: '0.85rem', color: '#c8b89a', display: 'flex', gap: '6px' }}>
                      <span style={{ color: isCurrent ? '#2ecc71' : '#ff9d00' }}>✦</span> {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleSubscribe(plan.tier)}
                  disabled={loading === plan.tier || isCurrent}
                  style={{
                    marginTop: 'auto',
                    padding: '0.75rem',
                    background: isCurrent
                      ? 'rgba(46,204,113,0.15)'
                      : plan.highlight ? 'linear-gradient(135deg, #ff9d00, #d4af37)' : 'transparent',
                    color: isCurrent ? '#2ecc71' : plan.highlight ? '#1a0f0a' : '#ff9d00',
                    border: isCurrent ? '1px solid #2ecc71' : plan.highlight ? 'none' : '1px solid #ff9d00',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    fontSize: '0.9rem',
                    cursor: (loading === plan.tier || isCurrent) ? 'default' : 'pointer',
                    opacity: loading === plan.tier ? 0.7 : 1,
                    transition: 'all 0.2s',
                  }}
                >
                  {loading === plan.tier
                    ? 'Aguarde…'
                    : isCurrent
                    ? 'Plano ativo'
                    : plan.tier === 'FREE'
                    ? 'Começar grátis'
                    : plan.tier === 'ENTERPRISE'
                    ? 'Entrar em contato'
                    : 'Assinar agora'}
                </button>
              </div>
            )
          })}
        </div>

        {/* Back link */}
        <div style={{ textAlign: 'center', marginTop: '3rem' }}>
          <a
            href="/"
            style={{ color: '#a35d1e', fontSize: '0.85rem', textDecoration: 'none' }}
          >
            ← Voltar à taverna
          </a>
        </div>
      </div>
    </div>
  )
}
