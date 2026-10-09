export const DEFAULT_GRID_SIZE = 10

export function gridSizeOrDefault(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 4 && value <= 100 ? value : DEFAULT_GRID_SIZE
}

export function gridLinePositions(gridSize: number, extent = 500): number[] {
  const cells = gridSizeOrDefault(gridSize)
  return Array.from({ length: cells + 1 }, (_, index) => index * extent / cells)
}

export function snapToHalfGridCell(coordinate: number, gridSize: number): number {
  const step = 5 / gridSizeOrDefault(gridSize) // Wall coordinates span 0–10; a cell spans 10/gridSize.
  return Math.max(0, Math.min(10, Math.round(Math.round(coordinate / step) * step * 10000) / 10000))
}
