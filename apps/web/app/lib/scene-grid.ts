export const DEFAULT_GRID_SIZE = 10

export function gridSizeOrDefault(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 4 && value <= 100 ? value : DEFAULT_GRID_SIZE
}

export function gridLinePositions(gridSize: number, extent = 500): number[] {
  const cells = gridSizeOrDefault(gridSize)
  return Array.from({ length: cells + 1 }, (_, index) => index * extent / cells)
}

export const gridStep = (gridSize: number): number => 10 / gridSizeOrDefault(gridSize)

export function snapTokenCoordinate(coordinate: number, gridSize: number): number {
  const cells = gridSizeOrDefault(gridSize)
  if (!Number.isFinite(coordinate)) return 0
  const index = Math.max(0, Math.min(cells - 1, Math.floor(coordinate / gridStep(cells) + 1e-5)))
  return Number((index * gridStep(cells)).toFixed(6))
}

export function isTokenGridCoordinate(coordinate: number, gridSize: number): boolean {
  const step = gridStep(gridSize)
  return Number.isFinite(coordinate) && coordinate >= 0 && coordinate < 10 &&
    Math.abs(coordinate / step - Math.round(coordinate / step)) < 1e-5
}

export function snapToHalfGridCell(coordinate: number, gridSize: number): number {
  const step = gridStep(gridSize) / 2 // Wall coordinates span 0–10.
  return Math.max(0, Math.min(10, Math.round(Math.round(coordinate / step) * step * 10000) / 10000))
}
