import { SceneryTokenController } from './scenery-token.controller';
import { sceneryNameOrFallback } from './scenery-token-name';

describe('Scenery token deletion', () => {
  let controller: SceneryTokenController;
  let prisma: any, sessions: any, access: any, gateway: any;
  const req = { headers: { cookie: 'session' } } as any;

  beforeEach(() => {
    prisma = { token: {
      findFirst: jest.fn().mockResolvedValue({ id: 'npc', roomId: 'ABC123', kind: 'SCENERY' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    } };
    sessions = { require: jest.fn().mockResolvedValue({ id: 'owner' }) };
    access = { requireOwner: jest.fn().mockResolvedValue({ id: 'ABC123', ownerId: 'owner' }) };
    gateway = { publishTokenDeleted: jest.fn(), publishTokenName: jest.fn() };
    controller = new SceneryTokenController(prisma, sessions, access, gateway);
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
