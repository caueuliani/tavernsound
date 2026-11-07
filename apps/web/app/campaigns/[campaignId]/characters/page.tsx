'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { apiUrl } from '../../../lib/api-url'

type Abilities = Record<'STR'|'DEX'|'CON'|'INT'|'WIS'|'CHA', number>
type Sheet = {
  level: number
  abilities: Abilities
  className?: string
  species?: string
  background?: string
  hitPoints?: number
  armorClass?: number
}
type Character = { id: string; name: string; userId: string; revision: number; sheet: Sheet }
const defaultSheet: Sheet = {
  level: 1,
  abilities: { STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 },
  className: '', species: '', background: '', hitPoints: 10, armorClass: 10,
}
const abilities = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const
const modifier = (score: number) => Math.floor((score - 10) / 2)
const formattedBonus = (bonus: number) => bonus >= 0 ? `+${bonus}` : String(bonus)
const fieldStyle = { width: '100%', padding: '0.65rem', borderRadius: 8, border: '1px solid #765a34', background: '#261a12', color: '#f4e4bc' }
const btnStyle = { padding: '0.7rem 1rem', borderRadius: 8, border: '1px solid #c49c55', background: '#4e3217', color: '#ffde9a', cursor: 'pointer' }

export default function CharacterSheetsPage() {
  const { campaignId } = useParams<{ campaignId: string }>()
  const [campaign, setCampaign] = useState<{ name: string; ownerId: string; gameSystemId: string } | null>(null)
  const [characters, setCharacters] = useState<Character[]>([])
  const [userId, setUserId] = useState('')
  const [selected, setSelected] = useState<Character | null>(null)
  const [name, setName] = useState('')
  const [sheet, setSheet] = useState<Sheet>(defaultSheet)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    const [campaignRes, charactersRes, meRes] = await Promise.all([
      fetch(apiUrl(`/campaigns/${campaignId}`), { credentials: 'include', cache: 'no-store' }),
      fetch(apiUrl(`/campaigns/${campaignId}/characters`), { credentials: 'include', cache: 'no-store' }),
      fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' }),
    ])
    if (!campaignRes.ok || !charactersRes.ok) throw new Error('Não foi possível carregar a campanha e suas fichas.')
    const [campaignData, characterData, me] = await Promise.all([campaignRes.json(), charactersRes.json(), meRes.json()])
    setCampaign(campaignData)
    setCharacters(characterData)
    setUserId(me?.user?.id || '')
  }

  useEffect(() => {
    let active = true
    Promise.all([
      fetch(apiUrl(`/campaigns/${campaignId}`), { credentials: 'include', cache: 'no-store' }),
      fetch(apiUrl(`/campaigns/${campaignId}/characters`), { credentials: 'include', cache: 'no-store' }),
      fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' }),
    ]).then(async ([campaignRes, charactersRes, meRes]) => {
      if (!campaignRes.ok || !charactersRes.ok) throw new Error('Acesso negado ou campanha indisponível.')
      const [campaignData, characterData, me] = await Promise.all([campaignRes.json(), charactersRes.json(), meRes.json()])
      if (!active) return
      setCampaign(campaignData)
      setCharacters(characterData)
      setUserId(me?.user?.id || '')
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : 'Erro ao carregar fichas.') })
    return () => { active = false }
  }, [campaignId])

  const edit = (character: Character | null) => {
    setSelected(character)
    setName(character?.name || '')
    setSheet(character ? structuredClone(character.sheet) : structuredClone(defaultSheet))
    setError('')
    setNotice('')
  }

  const updateAbility = (ability: keyof Abilities, raw: string) => {
    const parsed = Number(raw)
    if (!Number.isInteger(parsed)) return
    setSheet(previous => ({ ...previous, abilities: { ...previous.abilities, [ability]: Math.max(1, Math.min(30, parsed)) } }))
  }

  const save = async () => {
    if (!name.trim()) { setError('Informe o nome do personagem.'); return }
    if (selected && selected.userId !== userId && campaign?.ownerId !== userId) {
      setError('Esta ficha só pode ser editada pelo jogador ou mestre.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const url = selected ? `/campaigns/${campaignId}/characters/${selected.id}` : `/campaigns/${campaignId}/characters`
      const response = await fetch(apiUrl(url), {
        credentials: 'include',
        method: selected ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), sheet, ...(selected ? { revision: selected.revision } : {}) }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(', ') : result.message || 'Erro ao salvar ficha.')
      await load()
      setSelected(result)
      setNotice('Ficha salva com sucesso.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar ficha.')
    } finally { setBusy(false) }
  }

  if (!campaign) return <main style={{ padding: 24, color: '#f4e4bc', background: '#1a0f0a', minHeight: '100vh' }}>{error || 'Carregando fichas…'}</main>

  const canEdit = !selected || selected.userId === userId || campaign.ownerId === userId
  const proficiency = 2 + Math.floor((sheet.level - 1) / 4)

  return (
    <main style={{ minHeight: '100vh', padding: '2rem max(1rem, 5vw)', background: '#1a0f0a', color: '#f4e4bc' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <a href="/rooms" style={{ color: '#e3b568' }}>← Salas</a>
        <h1 style={{ color: '#ff9d00' }}>Fichas — {campaign.name}</h1>
        {campaign.gameSystemId !== 'dnd5e-2014-srd51' ? <p>Esta campanha utiliza o sistema genérico. Configure o sistema D&D 5e 2014 antes de criar fichas.</p> : <>
          <p>5E 2014 (SRD 5.1) · Ficha básica. Regras especiais da mesa e compêndios ainda não estão automatizados.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
            <button style={btnStyle} onClick={() => edit(null)}>Novo personagem</button>
            {characters.map(character => <button key={character.id} style={btnStyle} onClick={() => edit(character)}>{character.name}</button>)}
          </div>
          <section style={{ background: '#322219', padding: 20, borderRadius: 14, border: '1px solid #765a34' }}>
            <h2 style={{ color: '#ffcf79' }}>{selected ? `Editar: ${selected.name}` : 'Novo personagem'}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <label>Nome<input style={fieldStyle} value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
              {(['species', 'className', 'background'] as const).map(key =>
                <label key={key}>{key === 'species' ? 'Raça / espécie' : key === 'className' ? 'Classe' : 'Antecedente'}
                  <input style={fieldStyle} value={sheet[key] || ''} maxLength={120} onChange={e => setSheet(s => ({ ...s, [key]: e.target.value }))} />
                </label>)}
              <label>Nível<input style={fieldStyle} type="number" min={1} max={20} value={sheet.level} onChange={e => setSheet(s => ({ ...s, level: Math.max(1, Math.min(20, Number(e.target.value) || 1)) }))} /></label>
              <label>PV atuais<input style={fieldStyle} type="number" value={sheet.hitPoints ?? 0} onChange={e => setSheet(s => ({ ...s, hitPoints: Number(e.target.value) || 0 }))} /></label>
              <label>Classe de Armadura<input style={fieldStyle} type="number" value={sheet.armorClass ?? 10} onChange={e => setSheet(s => ({ ...s, armorClass: Number(e.target.value) || 10 }))} /></label>
            </div>
            <h3 style={{ color: '#ffcf79' }}>Atributos</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))', gap: 12 }}>
              {abilities.map(ability => <label key={ability} style={{ textAlign: 'center' }}>
                <strong>{ability}</strong>
                <input style={{ ...fieldStyle, textAlign: 'center' }} type="number" min={1} max={30} value={sheet.abilities[ability]} onChange={e => updateAbility(ability, e.target.value)} />
                <span style={{ display: 'block', marginTop: 6, color: '#ffcf79' }}>{formattedBonus(modifier(sheet.abilities[ability]))}</span>
              </label>)}
            </div>
            <p>Bônus de proficiência: <strong>{formattedBonus(proficiency)}</strong> · Iniciativa: <strong>{formattedBonus(modifier(sheet.abilities.DEX))}</strong></p>
            {error && <p role="alert" style={{ color: '#ff8e8e' }}>{error}</p>}
            {notice && <p role="status" style={{ color: '#a0e3a0' }}>{notice}</p>}
            <button style={{ ...btnStyle, opacity: busy || !canEdit ? 0.5 : 1 }} disabled={busy || !canEdit} onClick={save}>{busy ? 'Salvando…' : 'Salvar ficha'}</button>
          </section>
        </>}
        <p style={{ marginTop: 30, fontSize: 12 }}><a href="/legal/srd51" style={{ color: '#ffcf79' }}>Licença e atribuição SRD 5.1 (CC BY 4.0)</a></p>
      </div>
    </main>
  )
}
