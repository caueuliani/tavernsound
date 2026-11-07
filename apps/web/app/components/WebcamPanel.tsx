'use client'

import { useEffect, useRef } from 'react'

interface VideoTileProps {
  track: any
  label: string
  mirrored?: boolean
}

// Agora owns the rendered <video> element; React owns only the container.
function VideoTile({ track, label, mirrored = false }: VideoTileProps) {
  const target = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = target.current
    if (!element || !track) return
    try { track.play(element, { fit: 'cover', mirror: mirrored }) }
    catch (error) { console.warn('Não foi possível exibir webcam:', error) }
    return () => {
      try { track.stop() } catch { /* A disconnected peer might already have stopped. */ }
      if (element) element.replaceChildren()
    }
  }, [track, mirrored])

  return <div style={{ minWidth: 140, width: 170, borderRadius: 10, overflow: 'hidden', border: '1px solid #765329', background: '#120d09' }}>
    <div ref={target} style={{ width: '100%', aspectRatio: '4 / 3', overflow: 'hidden' }} />
    <p style={{ margin: 0, padding: '0.3rem', fontSize: 12, color: '#ffe1aa', overflowWrap: 'anywhere' }}>{label}</p>
  </div>
}

interface WebcamPanelProps {
  connected: boolean
  cameraEnabled: boolean
  cameraBusy: boolean
  cameraError: string
  localCameraTrack: any
  remoteVideoTracks: Map<string, any>
  toggleCamera: () => void | Promise<void>
}

export default function WebcamPanel({
  connected, cameraEnabled, cameraBusy, cameraError, localCameraTrack, remoteVideoTracks, toggleCamera,
}: WebcamPanelProps) {
  return <section aria-label="Webcams da mesa" style={{ margin: '0.75rem 0', padding: '0.75rem', background: '#261911', border: '1px solid #6e4826', borderRadius: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <strong>📹 Webcams</strong>
      <button type="button" disabled={!connected || cameraBusy} aria-pressed={cameraEnabled}
        onClick={() => void toggleCamera()}
        style={{ padding: '0.4rem 0.8rem', borderRadius: 7, background: cameraEnabled ? '#60312b' : '#42311b', color: '#ffe1aa', border: '1px solid #96633e', cursor: connected ? 'pointer' : 'not-allowed' }}>
        {cameraBusy ? 'Aguarde…' : cameraEnabled ? 'Desligar minha câmera' : 'Ativar minha câmera'}
      </button>
      <span style={{ fontSize: 12, opacity: 0.8 }}>Câmera desligada por padrão. Somente você pode ativá-la.</span>
    </div>
    {cameraError && <p role="alert" style={{ color: '#ffb4ab' }}>{cameraError}</p>}
    {(localCameraTrack || remoteVideoTracks.size > 0) && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
      {localCameraTrack && <VideoTile track={localCameraTrack} label="Você" mirrored />}
      {Array.from(remoteVideoTracks.entries()).map(([uid, track]) => <VideoTile key={uid} track={track} label={`Participante · ${uid.slice(-5)}`} />)}
    </div>}
  </section>
}
