export type VoiceRole = 'host' | 'player'
export type VoiceMode = 'silent' | 'global' | 'spatial'

export function remoteVoiceMode(
  localIsHost: boolean,
  remoteRole: VoiceRole | undefined,
  hasLocalToken: boolean,
  hasRemoteToken: boolean,
  isDeafened: boolean,
  localSceneId?: string,
  remoteSceneId?: string,
): VoiceMode {
  if (isDeafened || !remoteRole) return 'silent'
  if (localIsHost || remoteRole === 'host') return 'global'
  return localSceneId && remoteSceneId && localSceneId === remoteSceneId && hasLocalToken && hasRemoteToken ? 'spatial' : 'silent'
}
