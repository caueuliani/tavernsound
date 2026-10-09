import type { SceneWall } from './scene.util';

export const TOKEN_SIZES = [0.5, 1, 2, 3, 4] as const;
export const tokenSize = (value: unknown): number => TOKEN_SIZES.includes(value as any) ? value as number : 1;
export const tokenRadius = (size: unknown, gridSize: number): number => 5 * tokenSize(size) / gridSize;

interface Point { x: number; y: number }
interface Segment { a: Point; b: Point }

export function movementSegments(walls: SceneWall[]): Segment[] {
  const segments: Segment[] = [];
  for (const wall of walls) {
    if (wall.isDoor && wall.isOpen && !wall.openings?.length) continue;
    const point = (t: number): Point => ({ x: wall.x1 + (wall.x2 - wall.x1) * t, y: wall.y1 + (wall.y2 - wall.y1) * t });
    let start = 0;
    for (const opening of [...(wall.openings ?? [])].sort((a, b) => a.position - a.width / 2 - (b.position - b.width / 2))) {
      const left = opening.position - opening.width / 2;
      if (left > start) segments.push({ a: point(start), b: point(left) });
      if (opening.type === 'window' || !opening.isOpen) segments.push({ a: point(left), b: point(opening.position + opening.width / 2) });
      start = opening.position + opening.width / 2;
    }
    if (start < 1) segments.push({ a: point(start), b: point(1) });
  }
  return segments;
}

function pointSegmentDistance(point: Point, segment: Segment): number {
  const dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - segment.a.x - t * dx, point.y - segment.a.y - t * dy);
}

function intersects(a: Segment, b: Segment): boolean {
  const dx = a.b.x - a.a.x, dy = a.b.y - a.a.y, ex = b.b.x - b.a.x, ey = b.b.y - b.a.y;
  const denominator = dx * ey - dy * ex;
  if (Math.abs(denominator) < 1e-9) return false;
  const px = b.a.x - a.a.x, py = b.a.y - a.a.y;
  const t = (px * ey - py * ex) / denominator, u = (px * dy - py * dx) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function validTokenPosition(point: Point, size: unknown, gridSize: number, segments: Segment[]): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const radius = tokenRadius(size, gridSize);
  if (point.x < radius || point.y < radius || point.x > 10 - radius || point.y > 10 - radius) return false;
  return segments.every(segment => pointSegmentDistance(point, segment) >= radius - 1e-6);
}

// Token coordinates remain the legacy 10×10 cell indices; collision uses their centers in scene units.
export const tokenCenter = (x: number, y: number): Point => ({ x: x + 0.5, y: y + 0.5 });

export function validTokenMove(from: Point, to: Point, size: unknown, gridSize: number, segments: Segment[]): boolean {
  if (!validTokenPosition(to, size, gridSize, segments)) return false;
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y)) return false;
  const path = { a: from, b: to }, radius = tokenRadius(size, gridSize);
  return segments.every(wall => !intersects(path, wall) && Math.min(
    pointSegmentDistance(from, wall), pointSegmentDistance(to, wall),
    pointSegmentDistance(wall.a, path), pointSegmentDistance(wall.b, path),
  ) >= radius - 1e-6);
}
