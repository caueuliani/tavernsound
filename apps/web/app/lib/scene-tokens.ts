export function visibleSceneTokens<T extends { sceneId: string }>(tokens: T[], sceneId: string): T[] {
  return tokens.filter(token => token.sceneId === sceneId)
}
