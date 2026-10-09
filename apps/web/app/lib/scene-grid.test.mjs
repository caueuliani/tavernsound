import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DEFAULT_GRID_SIZE, gridLinePositions, gridSizeOrDefault, snapToHalfGridCell } from './scene-grid.ts'

test('legacy scenes use the old 10x10 visual grid', () => {
  assert.equal(DEFAULT_GRID_SIZE, 10)
  assert.equal(gridSizeOrDefault(undefined), 10)
  assert.equal(gridLinePositions(10).length - 1, 10)
  assert.equal(gridLinePositions(10)[1], 50)
})

test('grid positions draw 4x4, 20x20 and 100x100 across the same 500-unit canvas', () => {
  for (const size of [4, 20, 100]) {
    const positions = gridLinePositions(size)
    assert.equal(positions.length - 1, size)
    assert.equal(positions[0], 0)
    assert.equal(positions.at(-1), 500)
    assert.equal(positions[1], 500 / size)
  }
})

test('snap follows half of the configured visual cell in wall coordinates', () => {
  assert.equal(snapToHalfGridCell(1.26, 10), 1.5)
  assert.equal(snapToHalfGridCell(1.26, 20), 1.25)
  assert.equal(snapToHalfGridCell(1.26, 4), 1.25)
  assert.equal(snapToHalfGridCell(9.99, 100), 10)
})

test('both scene renderers use the shared grid positions and the editor exposes both controls', async () => {
  const [table, workshop, editor] = await Promise.all([
    readFile(new URL('../components/Grid.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/SceneWorkshop.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/SceneEditor.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(table, /gridLinePositions\(scene\.settings\.gridSize/)
  assert.match(workshop, /gridLinePositions\(settings\.gridSize/)
  assert.match(editor, /Opacidade da grade/)
  assert.match(editor, /Tamanho da grade/)
  assert.match(editor, /aria-label="Opacidade da grade" type="range" min="0" max="1" step="\.05"/)
  assert.match(editor, /aria-label="Tamanho da grade" type="range" min="4" max="100" step="1"/)
  assert.match(editor, /<output>\{scene\.settings\.gridSize\}x\{scene\.settings\.gridSize\}<\/output>/)
  assert.match(editor, /snapToHalfGridCell\(n, scene\.settings\.gridSize\)/)
})
