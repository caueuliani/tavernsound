import { openingBounds, pointOnWall, solidSegments } from './scene-geometry.ts'
import type { WallGeometry } from './scene-geometry.ts'
import { gridStep, snapTokenCoordinate } from './scene-grid.ts'

export const TOKEN_SIZES = [0.5, 1, 2, 3, 4] as const
export const tokenSize = (value: unknown): number => TOKEN_SIZES.includes(value as any) ? value as number : 1
export const tokenRadius = (size: unknown, gridSize: number): number => 5 * tokenSize(size) / gridSize
export function tokenHudLayout(size: unknown, gridSize: number, boardSize = 500) {
  const radius = tokenRadius(size, gridSize) * boardSize / 10
  return { radius, nameY: radius + 8, hpY: radius + 18, hpWidth: Math.max(20, radius * 2) }
}

interface Point { x: number; y: number }
interface Segment { a: Point; b: Point }

export function movementSegments(walls: WallGeometry[]): Segment[] {
  const segments: Segment[] = []
  for (const wall of walls) {
    if (wall.isDoor && wall.isOpen && !wall.openings?.length) continue
    for (const solid of solidSegments(wall)) segments.push({ a: { x: solid.x1, y: solid.y1 }, b: { x: solid.x2, y: solid.y2 } })
    for (const opening of wall.openings ?? []) {
      if (opening.type === 'door' && opening.isOpen) continue
      const [left, right] = openingBounds(opening)
      segments.push({ a: pointOnWall(wall, left), b: pointOnWall(wall, right) })
    }
  }
  return segments
}

function pointSegmentDistance(point: Point, segment: Segment): number {
  const dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared)) : 0
  return Math.hypot(point.x - segment.a.x - t * dx, point.y - segment.a.y - t * dy)
}

function intersects(a: Segment, b: Segment): boolean {
  const dx = a.b.x - a.a.x, dy = a.b.y - a.a.y, ex = b.b.x - b.a.x, ey = b.b.y - b.a.y
  const denominator = dx * ey - dy * ex
  if (Math.abs(denominator) < 1e-9) return false
  const px = b.a.x - a.a.x, py = b.a.y - a.a.y
  const t = (px * ey - py * ex) / denominator, u = (px * dy - py * dx) / denominator
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

export function validTokenPosition(point: Point, size: unknown, gridSize: number, segments: Segment[]): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false
  const radius = tokenRadius(size, gridSize)
  if (point.x < radius || point.y < radius || point.x > 10 - radius || point.y > 10 - radius) return false
  return segments.every(segment => pointSegmentDistance(point, segment) >= radius - 1e-6)
}

export const tokenCenter = (x: number, y: number, gridSize = 10): Point => ({ x: x + gridStep(gridSize) / 2, y: y + gridStep(gridSize) / 2 })

export function arrowDestination(from: Point, key: string, gridSize: number): Point | null {
  const step = gridStep(gridSize)
  const directions: Record<string, Point> = { ArrowRight: { x: 1, y: 0 }, ArrowLeft: { x: -1, y: 0 }, ArrowDown: { x: 0, y: 1 }, ArrowUp: { x: 0, y: -1 } }
  const direction = directions[key]
  if (!direction) return null
  return { x: Number((from.x + direction.x * step).toFixed(6)), y: Number((from.y + direction.y * step).toFixed(6)) }
}

export function keyboardToken<T extends { id: string; kind?: 'PLAYER' | 'SCENERY'; isOwn?: boolean }>(tokens: Iterable<T>, isHost: boolean, selectedTokenId: string | null): T | null {
  for (const token of tokens) {
    if (isHost ? token.kind === 'SCENERY' && token.id === selectedTokenId : token.kind === 'PLAYER' && token.isOwn === true) return token
  }
  return null
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]'))
}

export function validTokenMove(from: Point, to: Point, size: unknown, gridSize: number, segments: Segment[]): boolean {
  if (!validTokenPosition(to, size, gridSize, segments)) return false
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y)) return false
  const path = { a: from, b: to }, radius = tokenRadius(size, gridSize)
  return segments.every(wall => !intersects(path, wall) && Math.min(
    pointSegmentDistance(from, wall), pointSegmentDistance(to, wall),
    pointSegmentDistance(wall.a, path), pointSegmentDistance(wall.b, path),
  ) >= radius - 1e-6)
}

export function lastValidTokenCell(from: Point, desired: Point, size: unknown, gridSize: number, segments: Segment[], occupied: (x: number, y: number) => boolean): Point {
  let last = from
  const steps = Math.max(1, Math.ceil(Math.hypot(desired.x - from.x, desired.y - from.y) / gridStep(gridSize) * 10))
  for (let i = 1; i <= steps; i++) {
    const candidate = { x: snapTokenCoordinate(from.x + (desired.x - from.x) * i / steps, gridSize), y: snapTokenCoordinate(from.y + (desired.y - from.y) * i / steps, gridSize) }
    if (candidate.x === last.x && candidate.y === last.y) continue
    if (occupied(candidate.x, candidate.y) || !validTokenMove(tokenCenter(last.x, last.y, gridSize), tokenCenter(candidate.x, candidate.y, gridSize), size, gridSize, segments)) break
    last = candidate
  }
  return last
}
