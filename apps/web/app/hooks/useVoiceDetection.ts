import { useEffect, useRef } from 'react'

interface VoiceDetectionConfig {
  onSpeakingChange: (isSpeaking: boolean) => void
  threshold?: number
  smoothing?: number
}

export function useVoiceDetection(
  audioTrack: any | null,
  config: VoiceDetectionConfig
) {
  const { onSpeakingChange, threshold = 0.01, smoothing = 0.8 } = config
  const callbackRef = useRef(onSpeakingChange)
  callbackRef.current = onSpeakingChange

  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataArrayRef = useRef<Uint8Array | null>(null)
  const isSpeakingRef = useRef(false)
  const rafIdRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (!audioTrack) return

    try {
      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      const resume = () => { void audioContext.resume().catch(() => {}) }
      window.addEventListener('pointerdown', resume)
      resume()
      
      const mediaStreamTrack = audioTrack.getMediaStreamTrack()
      const mediaStream = new MediaStream([mediaStreamTrack])
      const source = audioContext.createMediaStreamSource(mediaStream)

      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = smoothing

      source.connect(analyser)

      analyserRef.current = analyser
      const bufferLength = analyser.frequencyBinCount
      dataArrayRef.current = new Uint8Array(bufferLength)

      console.log('🎙️ Detector de voz iniciado')

      let lastVoiceAt = 0
      const detectVolume = () => {
        const analyser = analyserRef.current
        const dataArray = dataArrayRef.current
        
        if (!analyser || !dataArray) return

        // @ts-ignore - Incompatibilidade de tipos entre versões do lib.dom.d.ts
        analyser.getByteFrequencyData(dataArray)

        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
        }
        const average = sum / dataArray.length / 255

        if (average > threshold) lastVoiceAt = performance.now()
        const speaking = lastVoiceAt > 0 && performance.now() - lastVoiceAt < 220

        if (speaking !== isSpeakingRef.current) {
          isSpeakingRef.current = speaking
          callbackRef.current(speaking)
        }

        rafIdRef.current = requestAnimationFrame(detectVolume)
      }

      detectVolume()

      return () => {
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current)
        }
        source.disconnect()
        window.removeEventListener('pointerdown', resume)
        if (isSpeakingRef.current) callbackRef.current(false)
        isSpeakingRef.current = false
        if (audioContextRef.current) {
          void audioContext.close().catch(() => {})
        }
        console.log('🎙️ Detector de voz finalizado')
      }
    } catch (error) {
      console.error('❌ Erro ao iniciar detector de voz:', error)
    }
  }, [audioTrack, threshold, smoothing])
}
