export interface Opening {
  id: string
  type: 'door' | 'window'
  position: number // Center along the wall, from 0 to 1.
  width: number // Fraction of the wall length.
  isOpen: boolean
}

export interface WallGeometry {
  x1: number; y1: number; x2: number; y2: number
  isDoor?: boolean; isOpen?: boolean; blocksAudio?: boolean
  openings?: Opening[]
}

export interface Segment { x1: number; y1: number; x2: number; y2: number }

export function openingBounds(opening: Opening): [number, number] {
  return [opening.position - opening.width / 2, opening.position + opening.width / 2]
}

export function validOpenings(openings: Opening[]): boolean {
  const sorted = [...openings].sort((a, b) => openingBounds(a)[0] - openingBounds(b)[0])
  return sorted.every((opening, index) => {
    const [start, end] = openingBounds(opening)
    return Number.isFinite(start) && Number.isFinite(end) && opening.width >= .04 &&
      start >= 0 && end <= 1 && (index === 0 || start >= openingBounds(sorted[index - 1])[1] + .01)
  })
}

export function projectOnWall(wall: WallGeometry, x: number, y: number): number {
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1
  return Math.max(0, Math.min(1, ((x - wall.x1) * dx + (y - wall.y1) * dy) / (dx * dx + dy * dy)))
}

export function pointOnWall(wall: WallGeometry, t: number): { x: number; y: number } {
  return { x: wall.x1 + (wall.x2 - wall.x1) * t, y: wall.y1 + (wall.y2 - wall.y1) * t }
}

function segment(wall: WallGeometry, start: number, end: number): Segment {
  const a = pointOnWall(wall, start), b = pointOnWall(wall, end)
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}

export function solidSegments(wall: WallGeometry): Segment[] {
  if (!wall.openings?.length) return [segment(wall, 0, 1)]
  const result: Segment[] = []
  let start = 0
  for (const opening of [...wall.openings].sort((a, b) => openingBounds(a)[0] - openingBounds(b)[0])) {
    const [left, right] = openingBounds(opening)
    if (left > start) result.push(segment(wall, start, left))
    start = right
  }
  if (start < 1) result.push(segment(wall, start, 1))
  return result
}

export function occlusionSegments(wall: WallGeometry): Segment[] {
  if (wall.blocksAudio === false || (wall.isDoor && wall.isOpen && !wall.openings?.length)) return []
  const result = solidSegments(wall)
  for (const opening of wall.openings || []) {
    if (opening.type === 'door' && !opening.isOpen) {
      const [start, end] = openingBounds(opening)
      result.push(segment(wall, start, end))
    }
  }
  return result
}

export function lineIntersects(a: Segment, b: Segment): boolean {
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1, ex = b.x2 - b.x1, ey = b.y2 - b.y1
  const denominator = dx * ey - dy * ex
  if (Math.abs(denominator) < 1e-9) return false
  const px = b.x1 - a.x1, py = b.y1 - a.y1
  const t = (px * ey - py * ex) / denominator, u = (px * dy - py * dx) / denominator
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

export function wallOcclusionCount(line: Segment, walls: WallGeometry[]): number {
  return walls.reduce((count, wall) => count + (occlusionSegments(wall).some(segment => lineIntersects(line, segment)) ? 1 : 0), 0)
}

export interface Polyline { start: { x: number; y: number } | null; segmentIds: string[] }
export const emptyPolyline = (): Polyline => ({ start: null, segmentIds: [] })
export function polylineShortcut(key: string): 'finish' | 'undo' | null {
  return key === 'Escape' ? 'finish' : key === 'Backspace' ? 'undo' : null
}
export function addPolylinePoint(polyline: Polyline, point: { x: number; y: number }, id: string): { polyline: Polyline; segment: Segment | null } {
  if (!polyline.start) return { polyline: { start: point, segmentIds: [] }, segment: null }
  if (Math.hypot(point.x - polyline.start.x, point.y - polyline.start.y) < .05) return { polyline, segment: null }
  return { polyline: { start: point, segmentIds: [...polyline.segmentIds, id] }, segment: { x1: polyline.start.x, y1: polyline.start.y, x2: point.x, y2: point.y } }
}

export function undoPolyline<T extends Segment & { id: string }>(polyline: Polyline, walls: T[]): { polyline: Polyline; walls: T[] } {
  const id = polyline.segmentIds.at(-1)
  if (!id) return { polyline, walls }
  const wall = walls.find(item => item.id === id)
  return { polyline: { start: wall ? { x: wall.x1, y: wall.y1 } : polyline.start, segmentIds: polyline.segmentIds.slice(0, -1) }, walls: walls.filter(item => item.id !== id) }
}
