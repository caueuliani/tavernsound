import { BadRequestException } from '@nestjs/common';

export interface SceneOpening { id: string; type: 'door' | 'window'; position: number; width: number; isOpen: boolean }
export interface SceneWall { id: string; x1: number; y1: number; x2: number; y2: number; isDoor: boolean; isOpen: boolean; blocksAudio: boolean; openings?: SceneOpening[] }
export interface SceneData {
  revision: number;
  map: { file: string; width: number; height: number } | null;
  settings: { scale: number; x: number; y: number; gridOpacity: number; gridSize: number };
  walls: SceneWall[];
}
export const emptyScene = (): SceneData => ({ revision: 0, map: null, settings: { scale: 1, x: 0, y: 0, gridOpacity: 0.3, gridSize: 10 }, walls: [] });
export function readScene(value: unknown): SceneData {
  if (!value) return emptyScene();
  const scene = value as SceneData;
  const size = scene.settings?.gridSize;
  return { ...scene, settings: { ...scene.settings, gridSize: Number.isInteger(size) && size >= 4 && size <= 100 ? size : 10 } };
}
export function validateSceneEdit(value: any): Pick<SceneData, 'settings' | 'walls'> {
  const number = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  const s = value?.settings;
  if (!s || !number(s.scale, 0.25, 4) || !number(s.x, -500, 500) || !number(s.y, -500, 500) || !number(s.gridOpacity, 0, 1)) throw new BadRequestException('Ajustes do mapa inválidos.');
  const gridSize = s.gridSize === undefined ? 10 : s.gridSize;
  if (!Number.isInteger(gridSize) || !number(gridSize, 4, 100)) throw new BadRequestException('Tamanho da grade inválido.');
  if (!Array.isArray(value.walls) || value.walls.length > 200) throw new BadRequestException('Use no máximo 200 segmentos.');
  const ids = new Set<string>();
  const walls = value.walls.map((w: any) => {
    if (!w || typeof w.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(w.id) || ids.has(w.id) ||
      ![w.x1, w.y1, w.x2, w.y2].every(n => number(n, 0, 10)) ||
      Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < 0.05 ||
      typeof w.isDoor !== 'boolean' || typeof w.isOpen !== 'boolean' || typeof w.blocksAudio !== 'boolean') throw new BadRequestException('Parede ou porta inválida.');
    ids.add(w.id);
    if (w.openings !== undefined && (!Array.isArray(w.openings) || w.openings.length > 20 || w.isDoor)) throw new BadRequestException('Aberturas inválidas.');
    const openings: SceneOpening[] = (w.openings || []).map((opening: any) => {
      if (!opening || typeof opening.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(opening.id) ||
        !['door', 'window'].includes(opening.type) || !number(opening.position, 0, 1) || !number(opening.width, .04, 1) ||
        typeof opening.isOpen !== 'boolean') throw new BadRequestException('Abertura inválida.');
      return { id: opening.id, type: opening.type, position: opening.position, width: opening.width, isOpen: opening.type === 'door' && opening.isOpen };
    });
    const sorted = [...openings].sort((a, b) => a.position - a.width / 2 - (b.position - b.width / 2));
    if (new Set(openings.map(opening => opening.id)).size !== openings.length || sorted.some((opening, index) =>
      opening.position - opening.width / 2 < 0 || opening.position + opening.width / 2 > 1 ||
      (index > 0 && opening.position - opening.width / 2 < sorted[index - 1].position + sorted[index - 1].width / 2 + .01))) {
      throw new BadRequestException('Aberturas sobrepostas ou fora da parede.');
    }
    return { id: w.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, isDoor: w.isDoor, isOpen: w.isDoor && w.isOpen, blocksAudio: w.blocksAudio, ...(w.openings === undefined ? {} : { openings }) };
  });
  return { settings: { scale: s.scale, x: s.x, y: s.y, gridOpacity: s.gridOpacity, gridSize }, walls };
}
export function publicScene(roomId: string, scene: SceneData) {
  return { ...scene, map: scene.map ? { width: scene.map.width, height: scene.map.height, url: `/rooms/${roomId}/scene/image?v=${scene.revision}` } : null };
}
