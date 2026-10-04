import { BadRequestException } from '@nestjs/common';

export interface SceneWall { id: string; x1: number; y1: number; x2: number; y2: number; isDoor: boolean; isOpen: boolean; blocksAudio: boolean }
export interface SceneData {
  revision: number;
  map: { file: string; width: number; height: number } | null;
  settings: { scale: number; x: number; y: number; gridOpacity: number };
  walls: SceneWall[];
}
export const emptyScene = (): SceneData => ({ revision: 0, map: null, settings: { scale: 1, x: 0, y: 0, gridOpacity: 0.3 }, walls: [] });
export function readScene(value: unknown): SceneData { return value ? value as SceneData : emptyScene(); }
export function validateSceneEdit(value: any): Pick<SceneData, 'settings' | 'walls'> {
  const number = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  const s = value?.settings;
  if (!s || !number(s.scale, 0.25, 4) || !number(s.x, -500, 500) || !number(s.y, -500, 500) || !number(s.gridOpacity, 0, 1)) throw new BadRequestException('Ajustes do mapa inválidos.');
  if (!Array.isArray(value.walls) || value.walls.length > 200) throw new BadRequestException('Use no máximo 200 segmentos.');
  const ids = new Set<string>();
  const walls = value.walls.map((w: any) => {
    if (!w || typeof w.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(w.id) || ids.has(w.id) ||
      ![w.x1, w.y1, w.x2, w.y2].every(n => number(n, 0, 10)) ||
      Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < 0.05 ||
      typeof w.isDoor !== 'boolean' || typeof w.isOpen !== 'boolean' || typeof w.blocksAudio !== 'boolean') throw new BadRequestException('Parede ou porta inválida.');
    ids.add(w.id);
    return { id: w.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, isDoor: w.isDoor, isOpen: w.isDoor && w.isOpen, blocksAudio: w.blocksAudio };
  });
  return { settings: { scale: s.scale, x: s.x, y: s.y, gridOpacity: s.gridOpacity }, walls };
}
export function publicScene(roomId: string, scene: SceneData) {
  return { ...scene, map: scene.map ? { width: scene.map.width, height: scene.map.height, url: `/rooms/${roomId}/scene/image?v=${scene.revision}` } : null };
}
