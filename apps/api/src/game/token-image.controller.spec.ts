import { createHash } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { TokenImageController } from './token-image.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { RoomAccessService } from './room-access.service';
import { GameGateway } from './game.gateway';

describe('Character portraits', () => {
  let controller: TokenImageController, prisma: any, sessions: any, access: any, gateway: any;
  const id = createHash('sha256').update('ABC123:user').digest('hex');
  const req = { headers: { cookie: 'session' } } as any;
  beforeEach(() => {
    prisma = { token: { findFirst: jest.fn().mockResolvedValue({ id, roomId: 'ABC123', kind: 'PLAYER' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    sessions = { require: jest.fn().mockResolvedValue({ id: 'user' }) };
    access = { require: jest.fn().mockResolvedValue({ ownerId: 'other-user' }) };
    gateway = { publishTokenImage: jest.fn() };
    controller = new TokenImageController(prisma, sessions, access, gateway);
  });
  const file = async () => ({ buffer: await sharp({ create: { width: 400, height: 600, channels: 3, background: '#ea9030' } }).png().toBuffer() });
  it('persists a bounded WebP portrait for the account token in this room', async () => {
    const result = await controller.upload('ABC123', id, req, await file());
    const bytes = Buffer.from(result.imageData.split(',')[1], 'base64');
    expect(await sharp(bytes).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });
    expect(prisma.token.updateMany).toHaveBeenCalledWith({ where: { id, roomId: 'ABC123', kind: 'PLAYER' }, data: { imageUrl: result.imageData } });
    expect(gateway.publishTokenImage).toHaveBeenCalledWith('ABC123', id, result.imageData);
  });
  it('rejects another player token before updating', async () => {
    await expect(controller.upload('ABC123', 'foreign', req, await file())).rejects.toThrow('Você não pode alterar a imagem deste token.');
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });
  it('lets the room host upload a scenery token image in that room', async () => {
    access.require.mockResolvedValue({ ownerId: 'user' });
    prisma.token.findFirst.mockResolvedValue({ id: 'npc-1', roomId: 'ABC123', kind: 'SCENERY' });
    const result = await controller.upload('ABC123', 'npc-1', req, await file());
    expect(prisma.token.findFirst).toHaveBeenCalledWith({ where: { id: 'npc-1', roomId: 'ABC123' } });
    expect(prisma.token.updateMany).toHaveBeenCalledWith({ where: { id: 'npc-1', roomId: 'ABC123', kind: 'SCENERY' }, data: { imageUrl: result.imageData } });
    expect(gateway.publishTokenImage).toHaveBeenCalledWith('ABC123', 'npc-1', result.imageData);
  });
  it('does not let a player upload an NPC image', async () => {
    await expect(controller.upload('ABC123', 'npc-1', req, await file())).rejects.toThrow('Você não pode alterar a imagem deste token.');
    expect(prisma.token.findFirst).not.toHaveBeenCalled();
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });
  it('does not let the host upload a player token image', async () => {
    access.require.mockResolvedValue({ ownerId: 'user' });
    await expect(controller.upload('ABC123', id, req, await file())).rejects.toThrow('Você não pode alterar a imagem deste token.');
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });
  it('does not let a host upload an NPC from another room', async () => {
    access.require.mockResolvedValue({ ownerId: 'user' });
    prisma.token.findFirst.mockResolvedValue(null);
    await expect(controller.upload('ABC123', 'other-room-npc', req, await file())).rejects.toThrow('Token não encontrado.');
    expect(prisma.token.findFirst).toHaveBeenCalledWith({ where: { id: 'other-room-npc', roomId: 'ABC123' } });
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a token ID from another room, even when that token exists', async () => {
    const otherRoomId = createHash('sha256').update('XYZ789:user').digest('hex');
    await expect(controller.upload('ABC123', otherRoomId, req, await file())).rejects.toThrow('Você não pode alterar a imagem deste token.');
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });
  it('never lets a known token ID bypass room membership', async () => {
    access.require.mockRejectedValue(new Error('denied'));
    await expect(controller.upload('ABC123', id, req, await file())).rejects.toThrow('denied');
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });
  it('requires an authenticated session before checking room or token', async () => {
    sessions.require.mockRejectedValue(new Error('unauthenticated'));
    await expect(controller.upload('ABC123', id, req, await file())).rejects.toThrow('unauthenticated');
    expect(access.require).not.toHaveBeenCalled();
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });
  it('requires room access', async () => {
    access.require.mockRejectedValue(new Error('denied'));
    await expect(controller.upload('ABC123', id, req, await file())).rejects.toThrow('denied');
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });
  it('distinguishes unsupported formats from malformed images', async () => {
    await expect(controller.upload('ABC123', id, req, { buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>') })).rejects.toThrow('Use uma imagem PNG, JPG ou WebP.');
    await expect(controller.upload('ABC123', id, req, { buffer: Buffer.from('not an image') })).rejects.toThrow('Não foi possível processar esta imagem.');
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });
  it('rejects input larger than 2 MB before image processing', async () => {
    await expect(controller.upload('ABC123', id, req, { buffer: Buffer.alloc(2 * 1024 * 1024 + 1) })).rejects.toThrow('A imagem deve ter no máximo 2 MB.');
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });
  it('does not announce a portrait when the token was deleted', async () => {
    prisma.token.updateMany.mockResolvedValue({ count: 0 });
    await expect(controller.upload('ABC123', id, req, await file())).rejects.toThrow('Token não encontrado.');
    expect(gateway.publishTokenImage).not.toHaveBeenCalled();
  });
  it('uploads without the obsolete local-storage flag', async () => {
    const previous = process.env.LOCAL_TOKEN_UPLOADS;
    delete process.env.LOCAL_TOKEN_UPLOADS;
    try {
      await expect(controller.upload('ABC123', id, req, await file())).resolves.toMatchObject({ tokenId: id });
    } finally {
      if (previous === undefined) delete process.env.LOCAL_TOKEN_UPLOADS; else process.env.LOCAL_TOKEN_UPLOADS = previous;
    }
  });
  it('enforces the multipart transport limit for oversized files', async () => {
    const module = await Test.createTestingModule({ controllers: [TokenImageController], providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: SessionService, useValue: sessions },
      { provide: RoomAccessService, useValue: access },
      { provide: GameGateway, useValue: gateway },
    ] }).compile();
    const app = module.createNestApplication(); await app.init();
    try {
      const response = await request(app.getHttpServer()).post(`/rooms/ABC123/tokens/${id}/image`).attach('file', Buffer.alloc(2 * 1024 * 1024 + 1), 'large.png');
      expect(response.status).toBe(413);
      expect(prisma.token.updateMany).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
