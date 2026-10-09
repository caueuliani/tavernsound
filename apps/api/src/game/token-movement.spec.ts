import { movementSegments, tokenCenter, tokenRadius, tokenSize, validTokenMove, validTokenPosition } from './token-movement';
import type { SceneWall } from './scene.util';

const wall = (overrides: Partial<SceneWall> = {}): SceneWall => ({ id: 'wall', x1: 5, y1: 0, x2: 5, y2: 10, isDoor: false, isOpen: false, blocksAudio: true, ...overrides });
const door = { id: 'door', type: 'door' as const, position: .5, width: .3, isOpen: true };
const from = { x: 3, y: 5 }, through = { x: 7, y: 5 };

describe('server token movement', () => {
  it('uses configured cell size and defaults old tokens to 1x', () => {
    expect(tokenSize(undefined)).toBe(1);
    expect(tokenRadius(1, 10)).toBe(.5);
    expect(tokenRadius(2, 10)).toBe(1);
    expect(tokenRadius(1, 20)).toBe(.25);
    expect(tokenSize(7)).toBe(1);
  });
  it('blocks walls, closed doors and windows, but passes an open door', () => {
    expect(validTokenMove(from, through, 1, 10, movementSegments([wall()]))).toBe(false);
    expect(validTokenMove(from, through, 1, 10, movementSegments([wall({ openings: [{ ...door, isOpen: false }] })]))).toBe(false);
    expect(validTokenMove(from, through, 1, 10, movementSegments([wall({ openings: [{ ...door, type: 'window' }] })]))).toBe(false);
    expect(validTokenMove(from, through, 1, 10, movementSegments([wall({ openings: [door] })]))).toBe(true);
    expect(validTokenMove(from, through, 1, 10, movementSegments([wall({ isDoor: true, isOpen: false })]))).toBe(false);
    expect(validTokenMove(from, through, 1, 10, movementSegments([wall({ isDoor: true, isOpen: true })]))).toBe(true);
    expect(validTokenMove({ x: 3, y: 8 }, { x: 7, y: 8 }, 1, 10, movementSegments([wall({ openings: [door] })]))).toBe(false);
  });
  it('accounts for radius, map bounds, and the swept path', () => {
    const segments = movementSegments([wall()]);
    expect(validTokenPosition({ x: 4.6, y: 5 }, 1, 10, segments)).toBe(false);
    expect(validTokenPosition({ x: 4.1, y: 5 }, 2, 10, segments)).toBe(false);
    expect(validTokenPosition({ x: .5, y: 5 }, 2, 10, [])).toBe(false);
    expect(validTokenMove({ x: 3, y: 5 }, { x: 4, y: 5 }, 1, 10, segments)).toBe(true);
    expect(validTokenMove(from, through, 1, 10, segments)).toBe(false);
    expect(tokenCenter(3, 4)).toEqual({ x: 3.5, y: 4.5 });
  });
});
