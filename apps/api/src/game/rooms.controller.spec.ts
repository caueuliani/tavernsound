import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { RoomsController } from './rooms.controller';
import { GameGateway } from './game.gateway';

jest.mock('node:fs/promises', () => ({ unlink: jest.fn().mockResolvedValue(undefined) }));

describe('Room deletion', () => {
  const req = { headers: { cookie: 'session' } } as any;
  let prisma: any, sessions: any, access: any, gateway: any, controller: RoomsController;
  beforeEach(() => {
    jest.clearAllMocks();
    prisma = { room: { delete: jest.fn().mockResolvedValue({ sceneData: null }), findMany: jest.fn() } };
    sessions = { require: jest.fn().mockResolvedValue({ id: 'owner' }) };
    access = { requireOwner: jest.fn().mockResolvedValue({}) };
    gateway = { closeRoom: jest.fn() };
    controller = new RoomsController(prisma, sessions, access, gateway);
  });
  it('rejects unauthenticated requests without touching the room', async () => {
    sessions.require.mockRejectedValue(new UnauthorizedException());
    await expect(controller.remove('ABC123', req)).rejects.toThrow(UnauthorizedException);
    expect(prisma.room.delete).not.toHaveBeenCalled();
  });
  it('rejects members who do not own the room', async () => {
    access.requireOwner.mockRejectedValue(new ForbiddenException());
    await expect(controller.remove('ABC123', req)).rejects.toThrow(ForbiddenException);
    expect(prisma.room.delete).not.toHaveBeenCalled();
    expect(gateway.closeRoom).not.toHaveBeenCalled();
  });
  it('deletes with owner constraint and cleans the latest persisted map', async () => {
    const file = '12345678-1234-1234-1234-123456789abc.webp';
    prisma.room.delete.mockResolvedValue({ sceneData: { revision: 2, map: { file, width: 500, height: 500 }, settings: { scale: 1, x: 0, y: 0, gridOpacity: 0.3 }, walls: [] } });
    await expect(controller.remove('ABC123', req)).resolves.toEqual({ success: true });
    expect(access.requireOwner).toHaveBeenCalledWith('ABC123', 'owner');
    expect(prisma.room.delete).toHaveBeenCalledWith({ where: { id: 'ABC123', ownerId: 'owner' } });
    expect(gateway.closeRoom).toHaveBeenCalledWith('ABC123');
    expect(unlink).toHaveBeenCalledWith(expect.stringContaining(file));
  });
  it('does not disconnect players when database deletion fails', async () => {
    prisma.room.delete.mockRejectedValue({ code: 'P2025' });
    await expect(controller.remove('ABC123', req)).rejects.toThrow(NotFoundException);
    expect(gateway.closeRoom).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });
  it('marks only owned rooms as deletable in the list', async () => {
    prisma.room.findMany.mockResolvedValue([{ id: 'ABC123', ownerId: 'owner' }, { id: 'ABC456', ownerId: 'other' }]);
    expect((await controller.list(req)).map(room => room.isOwner)).toEqual([true, false]);
  });
  it('notifies and disconnects only the deleted room, clearing cached state', () => {
    const live = new GameGateway(prisma, sessions, access, {} as any);
    const emit = jest.fn(), disconnectSockets = jest.fn();
    live.server = { to: jest.fn().mockReturnValue({ emit }), in: jest.fn().mockReturnValue({ disconnectSockets }) } as any;
    (live as any).rooms.set('ABC123', {});
    (live as any).rooms.set('OTHER1', {});
    live.closeRoom('ABC123');
    expect(live.server.in).toHaveBeenCalledWith('ABC123');
    expect(emit).toHaveBeenCalledWith('room-error', expect.any(Object));
    expect(disconnectSockets).toHaveBeenCalledWith(true);
    expect((live as any).rooms.has('ABC123')).toBe(false);
    expect((live as any).rooms.has('OTHER1')).toBe(true);
  });
});
