import { SceneryTokenController } from './scenery-token.controller';
import { sceneryNameOrFallback } from './scenery-token-name';

describe('Scenery token deletion', () => {
  let controller: SceneryTokenController;
  let prisma: any, sessions: any, access: any, gateway: any;
  const req = { headers: { cookie: 'session' } } as any;

  beforeEach(() => {
    prisma = { scene: { findFirst: jest.fn().mockResolvedValue({ id: 'beach-123', position: 1, sceneData: null }) }, token: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue({ id: 'npc', roomId: 'ABC123', kind: 'SCENERY', x: 4, y: 4 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    } };
    sessions = { require: jest.fn().mockResolvedValue({ id: 'owner' }) };
    access = { requireOwner: jest.fn().mockResolvedValue({ id: 'ABC123', ownerId: 'owner' }) };
    gateway = { publishTokenDeleted: jest.fn(), publishTokenName: jest.fn(), publishTokenSize: jest.fn(),
      publishAlternateTokenCreated: jest.fn(), publishAlternateTokenDeleted: jest.fn(),
      publishAlternateTokenHp: jest.fn(), publishAlternateTokenMoved: jest.fn() };
    controller = new SceneryTokenController(prisma, sessions, access, gateway);
  });

  it('creates a GM NPC only in the requested alternative scene', async () => {
    const npc = await controller.createInScene('ABC123', 'beach-123', req, { name: '  Goblin  ', x: 2, y: 3, hp: 6, maxHp: 10 });
    expect(npc).toMatchObject({ sceneId: 'beach-123', name: 'Goblin', hp: 6, x: 2 });
    expect(prisma.token.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      roomId: 'ABC123', sceneId: 'beach-123', kind: 'SCENERY', name: 'Goblin', hp: 6,
    }) });
    expect(gateway.publishAlternateTokenCreated).toHaveBeenCalledWith('ABC123', 'beach-123', expect.objectContaining({ sceneId: 'beach-123' }));
  });

  it('enforces GM ownership, scene ownership, grid/walls and integer HP on alternate NPC creation', async () => {
    access.requireOwner.mockRejectedValueOnce(new Error('Somente mestre'));
    await expect(controller.createInScene('ABC123', 'beach-123', req, { name: 'NPC', x: 1, y: 1 })).rejects.toThrow('Somente mestre');
    prisma.scene.findFirst.mockResolvedValueOnce(null);
    await expect(controller.createInScene('ABC123', 'foreign', req, { name: 'NPC', x: 1, y: 1 })).rejects.toThrow('Cena alternativa indisponível');
    await expect(controller.createInScene('ABC123', 'beach-123', req, { name: 'NPC', x: 11, y: 1 })).rejects.toThrow('Posição inválida');
    await expect(controller.createInScene('ABC123', 'beach-123', req, { name: 'NPC', x: 1, y: 1, hp: -2 })).rejects.toThrow('HP');
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('updates scene-qualified NPC position and HP after a valid movement', async () => {
    prisma.token.findFirst.mockResolvedValue({ id: 'npc', roomId: 'ABC123', sceneId: 'beach-123',
      kind: 'SCENERY', x: 3, y: 3, sizeMultiplier: 1, hp: 5, maxHp: 10 });
    await expect(controller.editInScene('ABC123', 'beach-123', 'npc', req, { hp: 4, maxHp: 10, x: 4, y: 3 }))
      .resolves.toMatchObject({ hp: 4, x: 4, sceneId: 'beach-123' });
    expect(prisma.token.updateMany).toHaveBeenCalledWith({
      where: { id: 'npc', roomId: 'ABC123', sceneId: 'beach-123', kind: 'SCENERY' },
      data: { hp: 4, maxHp: 10, x: 4, y: 3, positionX: 4, positionY: 3 },
    });
    expect(gateway.publishAlternateTokenMoved).toHaveBeenCalledWith('ABC123', 'beach-123', 'npc', 4, 3);
    expect(gateway.publishAlternateTokenHp).toHaveBeenCalledWith('ABC123', 'beach-123', 'npc', 4, 10);
  });

  it('does not change an NPC across a wall, missing token, or different scene', async () => {
    prisma.token.findFirst.mockResolvedValueOnce(null);
    await expect(controller.editInScene('ABC123', 'beach-123', 'wrong', req, { hp: 1 })).rejects.toThrow('NPC não encontrado');
    prisma.scene.findFirst.mockResolvedValue({ id: 'beach-123', position: 1, sceneData: {
      revision: 1, map: null, settings: { scale: 1, x: 0, y: 0, gridOpacity: .3, gridSize: 10 },
      walls: [{ id: 'wall', x1: 5, y1: 0, x2: 5, y2: 10, isDoor: false, isOpen: false, blocksAudio: true }],
    } });
    prisma.token.findFirst.mockResolvedValue({ id: 'npc', roomId: 'ABC123', sceneId: 'beach-123',
      kind: 'SCENERY', x: 3, y: 3, sizeMultiplier: 1, hp: 5, maxHp: 10 });
    await expect(controller.editInScene('ABC123', 'beach-123', 'npc', req, { x: 6, y: 3 })).rejects.toThrow('Movimento inválido');
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });

  it('deletes only scenery from the selected alternative scene', async () => {
    const result = await controller.removeInScene('ABC123', 'beach-123', 'npc', req);
    expect(result).toMatchObject({ id: 'npc', sceneId: 'beach-123', deleted: true });
    expect(prisma.token.deleteMany).toHaveBeenCalledWith({ where: { id: 'npc', roomId: 'ABC123', sceneId: 'beach-123', kind: 'SCENERY' } });
    expect(gateway.publishAlternateTokenDeleted).toHaveBeenCalledWith('ABC123', 'beach-123', 'npc');
  });

  it('deletes an owned-room NPC from the database and publishes only to its room', async () => {
    await expect(controller.remove('ABC123', 'npc', req)).resolves.toEqual({ tokenId: 'npc' });
    expect(sessions.require).toHaveBeenCalledWith('session');
    expect(access.requireOwner).toHaveBeenCalledWith('ABC123', 'owner');
    expect(prisma.token.findFirst).toHaveBeenCalledWith({ where: { id: 'npc', roomId: 'ABC123' } });
    expect(prisma.token.deleteMany).toHaveBeenCalledWith({ where: { id: 'npc', roomId: 'ABC123', kind: 'SCENERY' } });
    expect(gateway.publishTokenDeleted).toHaveBeenCalledWith('ABC123', 'npc');
  });

  it('rejects a player without room ownership before reading the token', async () => {
    access.requireOwner.mockRejectedValue(new Error('owner only'));
    await expect(controller.remove('ABC123', 'npc', req)).rejects.toThrow('owner only');
    expect(prisma.token.findFirst).not.toHaveBeenCalled();
    expect(prisma.token.deleteMany).not.toHaveBeenCalled();
  });

  it('does not delete a token from another room even if its ID is known', async () => {
    prisma.token.findFirst.mockResolvedValue(null);
    await expect(controller.remove('ABC123', 'other-room-token', req)).rejects.toThrow('Token não encontrado.');
    expect(prisma.token.findFirst).toHaveBeenCalledWith({ where: { id: 'other-room-token', roomId: 'ABC123' } });
    expect(prisma.token.deleteMany).not.toHaveBeenCalled();
    expect(gateway.publishTokenDeleted).not.toHaveBeenCalled();
  });

  it('rejects personal player tokens regardless of ID shape', async () => {
    prisma.token.findFirst.mockResolvedValue({ id: 'uuid-looking-player-token', roomId: 'ABC123', kind: 'PLAYER' });
    await expect(controller.remove('ABC123', 'uuid-looking-player-token', req)).rejects.toThrow('Você não pode excluir este token.');
    expect(prisma.token.deleteMany).not.toHaveBeenCalled();
    expect(gateway.publishTokenDeleted).not.toHaveBeenCalled();
  });

  it('handles missing or concurrently deleted tokens without broadcasting a ghost removal', async () => {
    prisma.token.findFirst.mockResolvedValueOnce(null);
    await expect(controller.remove('ABC123', 'gone', req)).rejects.toThrow('Token não encontrado.');
    prisma.token.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(controller.remove('ABC123', 'npc', req)).rejects.toThrow('Token não encontrado.');
    expect(gateway.publishTokenDeleted).not.toHaveBeenCalled();
  });

  it('renames a scenery token in the owned room, trimming before persistence and room publication', async () => {
    await expect(controller.rename('ABC123', 'npc', req, { name: '  Ferreiro  ' })).resolves.toEqual({ tokenId: 'npc', name: 'Ferreiro' });
    expect(access.requireOwner).toHaveBeenCalledWith('ABC123', 'owner');
    expect(prisma.token.updateMany).toHaveBeenCalledWith({ where: { id: 'npc', roomId: 'ABC123', kind: 'SCENERY' }, data: { name: 'Ferreiro' } });
    expect(gateway.publishTokenName).toHaveBeenCalledWith('ABC123', 'npc', 'Ferreiro');
  });
  it('persists and broadcasts an allowed NPC size, without changing player tokens', async () => {
    await expect(controller.rename('ABC123', 'npc', req, { name: 'Ferreiro', size: 2 })).resolves.toEqual({ tokenId: 'npc', name: 'Ferreiro', size: 2 });
    expect(prisma.token.updateMany).toHaveBeenCalledWith({ where: { id: 'npc', roomId: 'ABC123', kind: 'SCENERY' }, data: { name: 'Ferreiro', sizeMultiplier: 2 } });
    expect(gateway.publishTokenSize).toHaveBeenCalledWith('ABC123', 'npc', 2);
    prisma.token.findFirst.mockResolvedValue({ id: 'player', roomId: 'ABC123', kind: 'PLAYER', x: 4, y: 4 });
    await expect(controller.rename('ABC123', 'player', req, { name: 'Player', size: 2 })).rejects.toThrow('Você não pode editar este token.');
  });
  it('rejects invalid sizes or a size overlapping the map boundary', async () => {
    for (const size of [0, .75, 5, '2']) await expect(controller.rename('ABC123', 'npc', req, { name: 'NPC', size })).rejects.toThrow('Tamanho de token inválido.');
    prisma.token.findFirst.mockResolvedValue({ id: 'npc', roomId: 'ABC123', kind: 'SCENERY', x: 0, y: 0 });
    await expect(controller.rename('ABC123', 'npc', req, { name: 'NPC', size: 2 })).rejects.toThrow('Este tamanho não cabe');
    expect(gateway.publishTokenSize).not.toHaveBeenCalled();
  });

  it('rejects blank, overlong and control-character names without writing', async () => {
    for (const name of ['   ', 'x'.repeat(81), 'Guard\nCaptain']) {
      await expect(controller.rename('ABC123', 'npc', req, { name })).rejects.toThrow();
    }
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
    expect(gateway.publishTokenName).not.toHaveBeenCalled();
  });

  it('rejects a player, a token in another room, and a personal token', async () => {
    access.requireOwner.mockRejectedValueOnce(new Error('owner only'));
    await expect(controller.rename('ABC123', 'npc', req, { name: 'Goblin' })).rejects.toThrow('owner only');
    prisma.token.findFirst.mockResolvedValueOnce(null);
    await expect(controller.rename('ABC123', 'other-room', req, { name: 'Goblin' })).rejects.toThrow('Token não encontrado.');
    prisma.token.findFirst.mockResolvedValueOnce({ id: 'player', roomId: 'ABC123', kind: 'PLAYER' });
    await expect(controller.rename('ABC123', 'player', req, { name: 'Goblin' })).rejects.toThrow('Você não pode editar este token.');
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });

  it('does not publish a stale rename if the token was removed concurrently', async () => {
    prisma.token.updateMany.mockResolvedValue({ count: 0 });
    await expect(controller.rename('ABC123', 'npc', req, { name: 'Goblin' })).rejects.toThrow('Token não encontrado.');
    expect(gateway.publishTokenName).not.toHaveBeenCalled();
  });

  it('serializes concurrent renames of the same NPC so the last saved name stays in memory', async () => {
    let finishFirst!: (value: { count: number }) => void;
    prisma.token.updateMany.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    const first = controller.rename('ABC123', 'npc', req, { name: 'Ferreiro' });
    const second = controller.rename('ABC123', 'npc', req, { name: 'Capitão' });
    await new Promise(resolve => setImmediate(resolve));
    expect(prisma.token.updateMany).toHaveBeenCalledTimes(1);
    finishFirst({ count: 1 });
    await Promise.all([first, second]);
    expect(prisma.token.updateMany.mock.calls.map(([call]: any[]) => call.data.name)).toEqual(['Ferreiro', 'Capitão']);
    expect(gateway.publishTokenName.mock.calls.map(([, , name]: [string, string, string]) => name)).toEqual(['Ferreiro', 'Capitão']);
  });

  it('uses a safe fallback for an old scenery token with no valid name', () => {
    expect(sceneryNameOrFallback('  Ferreiro  ')).toBe('Ferreiro');
    expect(sceneryNameOrFallback('   ')).toBe('Token de cenário');
    expect(sceneryNameOrFallback('x'.repeat(81))).toBe('Token de cenário');
  });
});
