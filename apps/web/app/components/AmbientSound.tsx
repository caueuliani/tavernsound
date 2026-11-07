'use client'

import { useEffect, useRef, useState } from 'react'

type Ambience = 'off' | 'rain' | 'wind' | 'fire'

// Procedurally generated ambience: no copyrighted files or external streaming.
const AMBIENCES: Record<Exclude<Ambience, 'off'>, { label: string; lowpass: number; gain: number }> = {
  rain: { label: 'Chuva', lowpass: 3800, gain: 0.24 },
  wind: { label: 'Vento', lowpass: 580, gain: 0.28 },
  fire: { label: 'Fogueira', lowpass: 1500, gain: 0.22 },
}

export default function AmbientSound() {
  const contextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const volumeRef = useRef<GainNode | null>(null)
  const [ambience, setAmbience] = useState<Ambience>('off')
  const [volume, setVolume] = useState(35)
  const [error, setError] = useState('')

  useEffect(() => {
    const gain = volumeRef.current
    if (gain && contextRef.current) gain.gain.setTargetAtTime(volume / 100, contextRef.current.currentTime, 0.03)
  }, [volume])

  useEffect(() => {
    return () => {
      sourceRef.current?.stop()
      sourceRef.current?.disconnect()
      sourceRef.current = null
      if (contextRef.current) void contextRef.current.close().catch(() => {})
      contextRef.current = null
    }
  }, [])

  const change = async (next: Ambience) => {
    setError('')
    sourceRef.current?.stop()
    sourceRef.current?.disconnect()
    sourceRef.current = null
    setAmbience(next)
    if (next === 'off') return

    try {
      let context = contextRef.current
      if (!context || context.state === 'closed') {
        context = new AudioContext()
        contextRef.current = context
      }
      await context.resume()
      const settings = AMBIENCES[next]
      // Two seconds of generated mono noise looped locally. No media bandwidth.
      const length = Math.floor(context.sampleRate * 2)
      const buffer = context.createBuffer(1, length, context.sampleRate)
      const channel = buffer.getChannelData(0)
      for (let i = 0; i < length; i++) channel[i] = Math.random() * 2 - 1

      const source = context.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = settings.lowpass
      const master = context.createGain()
      master.gain.value = (volume / 100) * settings.gain
      source.connect(filter)
      filter.connect(master)
      master.connect(context.destination)
      volumeRef.current = master
      sourceRef.current = source
      source.start()
    } catch {
      setAmbience('off')
      setError('Não foi possível reproduzir o ambiente. Ative o áudio no navegador.')
    }
  }

  return <div aria-label="Sons ambientes" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
    <label htmlFor="ambient-selection">🌧️ Ambiente</label>
    <select id="ambient-selection" value={ambience} onChange={e => void change(e.target.value as Ambience)}
      style={{ background: '#38291e', color: '#ffe4b8', border: '1px solid #82613c', borderRadius: 6, padding: '0.4rem' }}>
      <option value="off">Desligado</option>
      {Object.entries(AMBIENCES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
    </select>
    <label htmlFor="ambient-volume">Volume</label>
    <input id="ambient-volume" type="range" min="0" max="100" value={volume}
      onChange={e => setVolume(Number(e.target.value))} aria-valuetext={`${volume}%`} />
    {ambience !== 'off' && <button type="button" onClick={() => void change('off')}>Parar ambiente</button>}
    {error && <span role="alert">{error}</span>}
  </div>
}
