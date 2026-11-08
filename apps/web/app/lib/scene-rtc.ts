// The token issuer, not the browser or Socket.IO payload, chooses the Agora channel.
// A scoped channel can only be requested for the server-authorized active scene.
export interface RtcCredentials {
  token: string
  uid: string
  channelName: string
}

export function rtcTokenPath(roomId: string, sceneId?: string): string {
  const params = new URLSearchParams({ channelName: roomId })
  if (sceneId) params.set('sceneId', sceneId)
  return `/agora/token?${params.toString()}`
}

export function readRtcCredentials(result: unknown, roomId: string, sceneId?: string): RtcCredentials {
  if (!result || typeof result !== 'object') throw new Error('Resposta de voz inválida.')
  const data = result as Record<string, unknown>
  if (typeof data.token !== 'string' || !data.token ||
      typeof data.uid !== 'string' || !data.uid ||
      typeof data.channelName !== 'string') {
    throw new Error('Credenciais de voz incompletas.')
  }
  const expectedPrefix = `${roomId}-scene-`
  if (sceneId ? !data.channelName.startsWith(expectedPrefix) :
    data.channelName !== roomId) {
    throw new Error('O servidor retornou um canal de mídia incompatível com a cena.')
  }
  return { token: data.token, uid: data.uid, channelName: data.channelName }
}
