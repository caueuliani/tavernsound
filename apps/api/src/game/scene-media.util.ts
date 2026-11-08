import { createHash } from 'node:crypto';

/**
 * Stable, bounded Agora channel per scene. The signed RTC token, not the
 * channel string, controls admission to the media session.
 */
export function sceneMediaChannel(roomId: string, sceneId: string): string {
  if (!/^[A-Z0-9]{6}$/.test(roomId) || !/^[a-zA-Z0-9-]{1,120}$/.test(sceneId)) {
    throw new Error('Invalid room or scene identifier');
  }
  const digest = createHash('sha256').update(sceneId).digest('hex').slice(0, 24);
  return `${roomId}-scene-${digest}`;
}

/**
 * Socket.IO subscription grouping is independent of the public room
 * namespace and cannot be picked arbitrarily by the browser.
 */
export function sceneSocketRoom(roomId: string, sceneId: string): string {
  return `scene:${sceneMediaChannel(roomId, sceneId)}`;
}
