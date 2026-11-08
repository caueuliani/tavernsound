// Shared read boundary for future scene activation. A server-signed room
// identity and its active scene must match the requested snapshot exactly.
export interface SceneSnapshot {
  roomId: string
  sceneId: string
  active: false
  scene: { revision: number; map: { url: string; width: number; height: number } | null; settings: Record<string, number>; walls: unknown[] }
  fogData: boolean[] | null
  tokens: Array<{ id: string; kind: 'PLAYER' | 'SCENERY'; sceneId: string; x: number; y: number; color: string | number; playerName?: string | null; imageUrl?: string | null; size?: number | null; hp?: number | null; maxHp?: number | null }>
}

export function sceneSnapshotPath(roomId: string, sceneId: string): string {
  return `/rooms/${encodeURIComponent(roomId)}/scene/snapshot?sceneId=${encodeURIComponent(sceneId)}`
}

export function readSceneSnapshot(input: unknown, roomId: string, sceneId: string): SceneSnapshot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Snapshot do cenário inválido.')
  const data = input as Record<string, unknown>
  if (data.roomId !== roomId || data.sceneId !== sceneId || data.active !== false) {
    throw new Error('O servidor enviou um snapshot de outra cena.')
  }
  if (!data.scene || typeof data.scene !== 'object' || !Number.isInteger((data.scene as any).revision) ||
      !Array.isArray((data.scene as any).walls) || !(data.scene as any).settings ||
      !Array.isArray(data.tokens) || (data.fogData !== null &&
        (!Array.isArray(data.fogData) || data.fogData.some(value => typeof value !== 'boolean')))) {
    throw new Error('O snapshot está incompleto ou incorreto.')
  }
  for (const token of data.tokens) {
    if (!token || typeof token !== 'object' || token.sceneId !== sceneId ||
        typeof token.id !== 'string' || !['PLAYER','SCENERY'].includes(token.kind) ||
        !Number.isFinite(token.x) || !Number.isFinite(token.y)) {
      throw new Error('O snapshot contém tokens de outra cena ou dados inválidos.')
    }
  }
  return data as unknown as SceneSnapshot
}
