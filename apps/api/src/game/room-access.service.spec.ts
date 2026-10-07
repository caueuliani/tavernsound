import { RoomAccessService } from './room-access.service';

describe('Room permissions', () => {
  let prisma: any;
  let access: RoomAccessService;
  beforeEach(() => {
    prisma = {
      room: { findUnique: jest.fn().mockResolvedValue({ id: 'ABC123', ownerId: 'owner', isPublic: false, password: null }) },
      roomMember: { findFirst: jest.fn().mockResolvedValue(null) },
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
  it('rejects malformed room identifiers before a database query', async () => {
    await expect(access.require('../ABC123', 'visitor')).rejects.toThrow();
    expect(prisma.room.findUnique).not.toHaveBeenCalled();
  });
});
