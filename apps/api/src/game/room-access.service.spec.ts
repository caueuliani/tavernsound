import { RoomAccessService } from './room-access.service';

describe('Room permissions', () => {
  let prisma: any;
  let access: RoomAccessService;
  beforeEach(() => {
    prisma = {
      room: { findUnique: jest.fn().mockResolvedValue({ id: 'ABC123', ownerId: 'owner', isPublic: false, password: null }) },
      roomMember: { findFirst: jest.fn().mockResolvedValue(null) },
      scene: { findFirst: jest.fn().mockResolvedValue({ id: 'initial-ABC123' }) },
      roomSceneAssignment: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    access = new RoomAccessService(prisma);
  });
  it('allows the owner', async () => { await expect(access.requireOwner('ABC123', 'owner')).resolves.toMatchObject({ id: 'ABC123' }); });
  it('denies private room access to an uninvited user', async () => { await expect(access.require('ABC123', 'stranger')).rejects.toThrow('Peça ao mestre'); });
  it('allows an authorized member but denies host controls', async () => {
    prisma.roomMember.findFirst.mockResolvedValue({ role: 'HOST' });
    await expect(access.require('ABC123', 'member')).resolves.toBeDefined();
    await expect(access.requireOwner('ABC123', 'member')).rejects.toThrow('Apenas o mestre');
    expect(prisma.roomMember.findFirst).toHaveBeenCalledWith({ where: { roomId: 'ABC123', userId: 'member', leftAt: null } });
  });
  it('does not make the first visitor an owner of a legacy room', async () => {
    prisma.room.findUnique.mockResolvedValue({ ownerId: null, isPublic: true, password: null });
    await expect(access.requireOwner('ABC123', 'visitor')).rejects.toThrow('Apenas o mestre');
  });
  it('does not bypass a password simply because a room is public', async () => {
    prisma.room.findUnique.mockResolvedValue({ ownerId: 'owner', isPublic: true, password: 'protected' });
    await expect(access.require('ABC123', 'visitor')).rejects.toThrow();
  });
  it('allows only the initial scene to receive RTC credentials before live scene cutover', async () => {
    await expect(access.requireSceneMedia('ABC123', 'owner', 'initial-ABC123'))
      .resolves.toEqual({ id: 'initial-ABC123' });
    await expect(access.requireSceneMedia('ABC123', 'owner', 'secret-scene'))
      .rejects.toThrow('ainda não está ativo');
    expect(prisma.scene.findFirst).toHaveBeenCalledWith({
      where: { roomId: 'ABC123' }, orderBy: { position: 'asc' }, select: { id: true },
    });
  });
  it('distinguishes staged scenes from activated scenes for RTC permissions', async () => {
    prisma.roomMember.findFirst.mockResolvedValue({ id: 'member' });
    prisma.roomSceneAssignment.findUnique.mockResolvedValue({ activeSceneId: null, sceneId: 'secret-beach' });
    await expect(access.requireSceneMedia('ABC123', 'member', 'secret-beach')).rejects.toThrow('ainda não está ativo');
    await expect(access.requireLegacyMedia('ABC123', 'member')).resolves.toMatchObject({ id: 'ABC123' });
    prisma.roomSceneAssignment.findUnique.mockResolvedValue({ activeSceneId: 'secret-beach', sceneId: 'secret-beach' });
    prisma.scene.findFirst.mockImplementation(async ({ where }: any) => ({ id: where.id || 'initial-ABC123' }));
    await expect(access.requireSceneMedia('ABC123', 'member', 'secret-beach')).resolves.toEqual({ id: 'secret-beach' });
    await expect(access.requireSceneMedia('ABC123', 'member', 'initial-ABC123')).rejects.toThrow('ainda não está ativo');
    await expect(access.requireLegacyMedia('ABC123', 'member')).rejects.toThrow('cena ativa');
  });
  it('does not accept a staged assignment as permission to listen to a draft scene', async () => {
    prisma.roomMember.findFirst.mockResolvedValue({ id: 'membership' });
    await expect(access.requireSceneMedia('ABC123', 'member', 'secret-scene'))
      .rejects.toThrow('ainda não está ativo');
    prisma.roomMember.findFirst.mockResolvedValue(null);
    await expect(access.requireSceneMedia('ABC123', 'stranger', 'initial-ABC123'))
      .rejects.toThrow('Peça ao mestre');
  });
  it('rejects malformed room identifiers before a database query', async () => {
    await expect(access.require('../ABC123', 'visitor')).rejects.toThrow();
    expect(prisma.room.findUnique).not.toHaveBeenCalled();
  });
});
