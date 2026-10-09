import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { SceneController } from './scene.controller';
import { emptyScene, readScene, validateSceneEdit } from './scene.util';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { RoomAccessService } from './room-access.service';
import { GameGateway } from './game.gateway';

describe('Scene storage and permissions', () => {
  const previousEnvironment = process.env.APP_ENV;
  let folder: string, controller: SceneController, room: any, prisma: any, access: any, gateway: any;
  const req = { headers: { cookie: 'test-cookie' } } as any;
  beforeEach(async () => {
    process.env.APP_ENV = 'development';
    folder = await mkdtemp(path.join(tmpdir(), 'tavern-scene-test-'));
    process.env.LOCAL_UPLOAD_DIR = folder; process.env.LOCAL_MAP_UPLOADS = 'true';
    room = { id: 'ABC123', updatedAt: new Date(), sceneData: null };
    access = { require: jest.fn(async () => room), requireOwner: jest.fn(async () => room) };
    prisma = { room: { updateMany: jest.fn(async ({ data }) => { room = { ...room, ...data }; return { count: 1 }; }) } };
    gateway = { publishScene: jest.fn() };
    controller = new SceneController(prisma, { require: jest.fn(async () => ({ id: 'user-1' })) } as any, access, gateway);
  });
  afterEach(async () => {
    delete process.env.LOCAL_UPLOAD_DIR; delete process.env.LOCAL_MAP_UPLOADS;
    if (previousEnvironment === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = previousEnvironment;
    if (!path.resolve(folder).startsWith(path.join(tmpdir(), 'tavern-scene-test-'))) throw new Error('Unexpected test folder');
    await rm(folder, { recursive: true, force: true });
  });
  const png = () => sharp({ create: { width: 64, height: 32, channels: 3, background: '#a87340' } }).png().toBuffer();
  it('stores WebP with the scene in PostgreSQL and reads it after a restart without local files', async () => {
    const result = await controller.upload('ABC123', req, { buffer: await png() }, '0');
    expect(result.map?.url).toContain('/rooms/ABC123/scene/image');
    expect(result.map).not.toHaveProperty('file');
    expect((await readdir(folder))).toHaveLength(0);
    expect(room.mapUrl).toMatch(/^db-webp:/);
    expect(room.sceneData.map.width).toBe(64);
    const response = { set: jest.fn().mockReturnThis(), send: jest.fn() } as any;
    const restarted = new SceneController(prisma, { require: jest.fn(async () => ({ id: 'user-1' })) } as any, access, gateway);
    await restarted.image('ABC123', req, response);
    expect((await sharp(response.send.mock.calls[0][0]).metadata()).format).toBe('webp');
    access.require.mockRejectedValueOnce(new Error('forbidden'));
    await expect(controller.image('ABC123', req, response)).rejects.toThrow('forbidden');
  });
  it('rejects player uploads before decoding or writing an image', async () => {
    access.requireOwner.mockRejectedValue(new Error('owner only'));
    await expect(controller.upload('ABC123', req, { buffer: await png() }, '0')).rejects.toThrow('owner only');
    expect(await readdir(folder)).toHaveLength(0);
    expect(prisma.room.updateMany).not.toHaveBeenCalled();
  });
  it('rejects uploaded SVG content even if submitted as an image', async () => {
    await expect(controller.upload('ABC123', req, { buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"/>') }, '0')).rejects.toThrow('PNG');
    expect(await readdir(folder)).toHaveLength(0);
  });
  it('retains the previous image on revision conflicts', async () => {
    await controller.upload('ABC123', req, { buffer: await png() }, '0');
    const oldMap = room.mapUrl;
    await expect(controller.upload('ABC123', req, { buffer: await png() }, '0')).rejects.toThrow('mudou');
    expect(room.mapUrl).toBe(oldMap);
    expect(await readdir(folder)).toHaveLength(0);
  });
  it('can still read an existing local map before backfill', async () => {
    const file = 'f09190f8-0f8c-45e9-8c4f-4df42299cd2e.webp';
    room.sceneData = { ...emptyScene(), map: { file, width: 64, height: 32 } };
    await writeFile(path.join(folder, file), await sharp(await png()).webp().toBuffer());
    const response = { set: jest.fn().mockReturnThis(), send: jest.fn() } as any;
    await controller.image('ABC123', req, response);
    expect((await sharp(response.send.mock.calls[0][0]).metadata()).format).toBe('webp');
  });
  it('removes the database image when the map is deleted', async () => {
    await controller.upload('ABC123', req, { buffer: await png() }, '0');
    await controller.remove('ABC123', req, '1');
    expect(room.mapUrl).toBeNull();
    expect(room.sceneData.map).toBeNull();
  });
  it('saves walls and door state, preserving the map and incrementing revision', async () => {
    await controller.upload('ABC123', req, { buffer: await png() }, '0');
    const edit = { settings: { ...emptyScene().settings, scale: 1.5 }, walls: [{ id: 'door', x1: 1, y1: 1, x2: 2, y2: 1, isDoor: true, isOpen: true, blocksAudio: true }] };
    const result = await controller.edit('ABC123', req, edit, '1');
    expect(result.revision).toBe(2); expect(result.map).not.toBeNull(); expect(result.walls[0].isOpen).toBe(true);
    expect(gateway.publishScene).toHaveBeenLastCalledWith('ABC123', result);
    const response = { setHeader: jest.fn() } as any;
    expect((await controller.get('ABC123', req, response)).scene).toEqual(result);
  });
  it('defaults old scenes to the former 10x10 grid without changing other settings', async () => {
    const oldScene = emptyScene();
    delete (oldScene.settings as Partial<typeof oldScene.settings>).gridSize;
    oldScene.settings.gridOpacity = 0.75;
    room.sceneData = oldScene;
    const response = { setHeader: jest.fn() } as any;
    const restored = (await controller.get('ABC123', req, response)).scene;
    expect(restored.settings).toMatchObject({ gridSize: 10, gridOpacity: 0.75 });
    expect(room.sceneData.settings).not.toHaveProperty('gridSize');
    expect(readScene(oldScene).settings.gridSize).toBe(10);
  });
  it('saves and reloads grid size independently of grid opacity', async () => {
    const edited = await controller.edit('ABC123', req, { settings: { ...emptyScene().settings, gridSize: 20, gridOpacity: 0.55 }, walls: [] }, '0');
    expect(edited.settings).toMatchObject({ gridSize: 20, gridOpacity: 0.55 });
    const response = { setHeader: jest.fn() } as any;
    expect((await controller.get('ABC123', req, response)).scene.settings).toMatchObject({ gridSize: 20, gridOpacity: 0.55 });
    expect(room.sceneData.settings.gridSize).toBe(20);
  });
  it('accepts the grid endpoints and rejects invalid or fractional cell counts', () => {
    for (const gridSize of [4, 20, 100]) {
      expect(validateSceneEdit({ ...emptyScene(), settings: { ...emptyScene().settings, gridSize } }).settings.gridSize).toBe(gridSize);
    }
    for (const gridSize of [3, 101, 20.5, NaN]) {
      expect(() => validateSceneEdit({ ...emptyScene(), settings: { ...emptyScene().settings, gridSize } })).toThrow('Tamanho da grade');
    }
    const settings = { ...emptyScene().settings } as Partial<ReturnType<typeof emptyScene>['settings']>;
    delete settings.gridSize;
    expect(validateSceneEdit({ settings, walls: [] }).settings.gridSize).toBe(10);
  });
  it('persists wall openings while keeping an older wall without openings readable', async () => {
    const oldWall = { id: 'old', x1: 0, y1: 0, x2: 5, y2: 0, isDoor: true, isOpen: true, blocksAudio: true };
    const newWall = { id: 'new', x1: 0, y1: 1, x2: 10, y2: 1, isDoor: false, isOpen: false, blocksAudio: true,
      openings: [{ id: 'door', type: 'door', position: .5, width: .2, isOpen: false }] };
    const result = await controller.edit('ABC123', req, { settings: emptyScene().settings, walls: [oldWall, newWall] }, '0');
    expect(result.walls[0]).not.toHaveProperty('openings');
    expect(result.walls[1].openings).toEqual(newWall.openings);
    expect(room.sceneData.walls).toEqual(result.walls);
  });
  it('rejects openings outside wall bounds or overlapping another opening', () => {
    const wall = { id: 'wall', x1: 0, y1: 0, x2: 10, y2: 0, isDoor: false, isOpen: false, blocksAudio: true };
    const opening = { id: 'one', type: 'door', position: .5, width: .2, isOpen: false };
    expect(() => validateSceneEdit({ ...emptyScene(), walls: [{ ...wall, openings: [{ ...opening, position: .05 }] }] })).toThrow('Aberturas');
    expect(() => validateSceneEdit({ ...emptyScene(), walls: [{ ...wall, openings: [opening, { ...opening, id: 'two', position: .55 }] }] })).toThrow('Aberturas');
  });
  it('keeps editing disabled unless explicitly enabled on the local host', async () => {
    process.env.LOCAL_MAP_UPLOADS = 'false';
    await expect(controller.edit('ABC123', req, emptyScene(), '0')).rejects.toThrow('habilitado');
  });
  it('enables hosted beta editing without a local upload flag or persistent map directory', async () => {
    process.env.APP_ENV = 'beta';
    process.env.LOCAL_MAP_UPLOADS = 'false';
    const response = { setHeader: jest.fn() } as any;
    expect((await controller.get('ABC123', req, response)).editingEnabled).toBe(true);
    await controller.upload('ABC123', req, { buffer: await png() }, '0');
    expect(room.mapUrl).toMatch(/^db-webp:/);
    expect(await readdir(folder)).toHaveLength(0);
  });
  it('rejects oversized scene geometry, invalid numbers and duplicate segments', () => {
    expect(() => validateSceneEdit({ ...emptyScene(), walls: new Array(201).fill({}) })).toThrow();
    expect(() => validateSceneEdit({ ...emptyScene(), settings: { ...emptyScene().settings, scale: Infinity } })).toThrow();
    const wall = { id: 'same', x1: 0, y1: 0, x2: 1, y2: 1, isDoor: false, isOpen: false, blocksAudio: true };
    expect(() => validateSceneEdit({ ...emptyScene(), walls: [wall, wall] })).toThrow();
  });
  it('accepts a real multipart upload and rejects files above the transport limit', async () => {
    const module = await Test.createTestingModule({ controllers: [SceneController], providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: SessionService, useValue: { require: jest.fn(async () => ({ id: 'user-1' })) } },
      { provide: RoomAccessService, useValue: access },
      { provide: GameGateway, useValue: gateway },
    ] }).compile();
    const app = module.createNestApplication(); await app.init();
    try {
      const result = await request(app.getHttpServer()).post('/rooms/ABC123/scene/image').set('If-Match', '0').attach('file', await png(), 'test.png');
      expect(result.status).toBe(201);
      expect(result.body.map.width).toBe(64);
      const large = await request(app.getHttpServer()).post('/rooms/ABC123/scene/image').set('If-Match', '1').attach('file', Buffer.alloc(3 * 1024 * 1024 + 1), 'large.png');
      expect(large.status).toBe(413);
    } finally { await app.close(); }
  });
});
