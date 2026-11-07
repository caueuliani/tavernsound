'use client'

import { useEffect, useRef, useState } from 'react'

export const AMBIENCE_OPTIONS = {
  off: { label: 'Silêncio', icon: '🔇', filter: 0, depth: 0, rate: 0, level: 0 },
  rain: { label: 'Chuva', icon: '🌧️', filter: 4800, depth: 0.10, rate: 0.9, level: 0.19 },
  wind: { label: 'Vento', icon: '🍃', filter: 750, depth: 0.48, rate: 0.22, level: 0.32 },
  fire: { label: 'Fogueira', icon: '🔥', filter: 2400, depth: 0.2, rate: 1.5, level: 0.16 },
  beach: { label: 'Praia e ondas do mar', icon: '🏖️', filter: 1100, depth: 0.85, rate: 0.115, level: 0.30 },
  tavern: { label: 'Taverna', icon: '🍺', filter: 550, depth: 0.2, rate: 0.4, level: 0.26 },
  forest: { label: 'Floresta', icon: '🌲', filter: 1700, depth: 0.28, rate: 0.19, level: 0.23 },
  dungeon: { label: 'Masmorra', icon: '🕯️', filter: 170, depth: 0.33, rate: 0.13, level: 0.37 },
  combat: { label: 'Combate', icon: '⚔️', filter: 1100, depth: 0.30, rate: 1.2, level: 0.28 },
} as const

export type AmbientPreset = keyof typeof AMBIENCE_OPTIONS

interface AmbientSoundProps {
  preset: AmbientPreset
  isHost: boolean
  connected: boolean
  onChangePreset: (preset: AmbientPreset) => void
}

interface AudioEngine {
  context: AudioContext
  source: AudioBufferSourceNode
  filter: BiquadFilterNode
  modulation: OscillatorNode
  modulationGain: GainNode
  master: GainNode
  accentTimer?: ReturnType<typeof setInterval>
}

function stopEngine(engine: AudioEngine | null) {
  if (!engine) return
  if (engine.accentTimer) clearInterval(engine.accentTimer)
  try { engine.source.stop() } catch { /* Already stopped. */ }
  try { engine.modulation.stop() } catch { /* Already stopped. */ }
  void engine.context.close().catch(() => {})
}

function accent(engine: AudioEngine, preset: AmbientPreset) {
  if (engine.context.state !== 'running') return
  if (!['forest', 'tavern', 'fire', 'combat'].includes(preset)) return
  const ctx = engine.context
  const now = ctx.currentTime
  const oscillator = ctx.createOscillator()
  const envelope = ctx.createGain()
  const duration = preset === 'combat' ? 0.13 : preset === 'tavern' ? 0.12 : 0.20
  const base = preset === 'forest' ? 1450 : preset === 'tavern' ? 1100 : preset === 'fire' ? 85 : 125
  oscillator.type = preset === 'combat' || preset === 'fire' ? 'triangle' : 'sine'
  oscillator.frequency.setValueAtTime(base, now)
  oscillator.frequency.exponentialRampToValueAtTime(preset === 'forest' ? 2000 : Math.max(40, base * 0.65), now + duration)
  envelope.gain.setValueAtTime(0.0001, now)
  envelope.gain.exponentialRampToValueAtTime(preset === 'combat' ? 0.11 : 0.035, now + 0.012)
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  oscillator.connect(envelope).connect(engine.master)
  oscillator.start(now)
  oscillator.stop(now + duration + 0.01)
  oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect() }
}

function buildEngine(preset: AmbientPreset, volume: number): AudioEngine {
  const config = AMBIENCE_OPTIONS[preset]
  const context = new AudioContext()
  const seconds = 6
  const frameCount = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(1, frameCount, context.sampleRate)
  const channel = buffer.getChannelData(0)
  // Original, generated noise; no downloads, streams or licensed music.
  for (let i = 0; i < frameCount; i++) channel[i] = Math.random() * 2 - 1

  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = true

  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = config.filter

  const master = context.createGain()
  master.gain.value = (volume / 100) * config.level

  const modulationGain = context.createGain()
  modulationGain.gain.value = config.depth * 0.5
  const modulation = context.createOscillator()
  modulation.type = 'sine'
  modulation.frequency.value = config.rate
  // The LFO moves the background bed, especially the receding ocean waves.
  const bed = context.createGain()
  bed.gain.value = 1 - config.depth * 0.5
  modulation.connect(modulationGain).connect(bed.gain)
  source.connect(filter).connect(bed).connect(master).connect(context.destination)

  source.start()
  modulation.start()

  const engine: AudioEngine = { context, source, filter, modulation, modulationGain, master }
  if (['forest', 'tavern', 'fire', 'combat'].includes(preset)) {
    const interval = preset === 'forest' ? 2600 : preset === 'tavern' ? 1800 : preset === 'combat' ? 600 : 900
    engine.accentTimer = setInterval(() => accent(engine, preset), interval)
  }
  return engine
}

export default function AmbientSound({ preset, isHost, connected, onChangePreset }: AmbientSoundProps) {
  const engineRef = useRef<AudioEngine | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [volume, setVolume] = useState(35)
  const [error, setError] = useState('')

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.master.gain.setTargetAtTime((volume / 100) * AMBIENCE_OPTIONS[preset].level, engine.context.currentTime, 0.08)
  }, [volume, preset])

  useEffect(() => {
    stopEngine(engineRef.current)
    engineRef.current = null
    if (!enabled || preset === 'off' || !connected) return
    try {
      const engine = buildEngine(preset, volume)
      engineRef.current = engine
      void engine.context.resume().catch(() => {
        setError('O navegador bloqueou o som. Toque novamente em Ouvir ambiente.')
        setEnabled(false)
      })
      setError('')
    } catch {
      setError('O som ambiente não pôde ser iniciado neste dispositivo.')
      setEnabled(false)
    }
    return () => { stopEngine(engineRef.current); engineRef.current = null }
  }, [preset, enabled, connected])

  useEffect(() => () => { stopEngine(engineRef.current); engineRef.current = null }, [])

  const active = enabled && preset !== 'off' && connected
  return <div aria-label="Sons ambientes" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
    <label htmlFor="ambient-selection">🎶 Som ambiente</label>
    {isHost ? <select id="ambient-selection" value={preset} disabled={!connected}
      onChange={e => onChangePreset(e.target.value as AmbientPreset)}
      style={{ background: '#38291e', color: '#ffe4b8', border: '1px solid #82613c', borderRadius: 6, padding: '0.4rem' }}>
      {Object.entries(AMBIENCE_OPTIONS).map(([id, option]) =>
        <option key={id} value={id}>{option.icon} {option.label}</option>)}
    </select> : <span id="ambient-selection">{AMBIENCE_OPTIONS[preset].icon} {AMBIENCE_OPTIONS[preset].label} · definido pelo mestre</span>}
    <button type="button" disabled={!connected || preset === 'off'}
      onClick={() => setEnabled(value => !value)}>
      {active ? 'Silenciar ambiente' : 'Ouvir ambiente'}
    </button>
    <label htmlFor="ambient-volume">Volume individual</label>
    <input id="ambient-volume" type="range" min="0" max="100" value={volume}
      onChange={e => setVolume(Number(e.target.value))} aria-valuetext={`${volume}%`} />
    {error && <span role="alert">{error}</span>}
  </div>
}
