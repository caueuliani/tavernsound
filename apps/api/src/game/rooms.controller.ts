import { BadRequestException, Body, Controller, Delete, Get, Header, Logger, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { GameGateway } from './game.gateway';
import { readScene } from './scene.util';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoomAccessService } from './room-access.service';
import { requireTester } from '../safety/test-policy';

@Controller('rooms')
export class RoomsController {
  constructor(private prisma: PrismaService, private sessions: SessionService, private access: RoomAccessService, private gateway: GameGateway) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Req() req: Request) {
    const user = await this.sessions.require(req.headers.cookie);
    const rooms = await this.prisma.room.findMany({
      where: { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id, leftAt: null } } }] },
      select: { id: true, name: true, ownerId: true }, orderBy: { updatedAt: 'desc' }, take: 100,
    });
    return rooms.map(room => ({ ...room, isOwner: room.ownerId === user.id }));
  }

  @Delete(':roomId')
  async remove(@Param('roomId') roomId: string, @Req() req: Request) {
    const user = await this.sessions.require(req.headers.cookie);
    await this.access.requireOwner(roomId, user.id);
    // Delete returns the latest scene, including a concurrent map replacement.
    // Related tokens, memberships and dice rolls use database cascading deletes.
    const deleted = await this.prisma.room.delete({ where: { id: roomId, ownerId: user.id } }).catch(error => {
      if (error.code === 'P2025') throw new NotFoundException('Sala não encontrada.');
      throw error;
    });
    this.gateway.closeRoom(roomId);
    const file = readScene(deleted.sceneData).map?.file;
    if (file && /^[a-f0-9-]{36}\.webp$/.test(file)) {
      await unlink(path.join(path.resolve(process.env.LOCAL_UPLOAD_DIR || 'local-uploads/maps'), file)).catch(error => {
        if (error.code !== 'ENOENT') Logger.warn('Sala excluída; limpeza do arquivo de mapa pendente.', 'RoomsController');
      });
    }
    return { success: true };
  }

  @Post(':roomId/members')
  async authorize(@Param('roomId') roomId: string, @Body() body: { email?: unknown }, @Req() req: Request) {
    const user = await this.sessions.require(req.headers.cookie);
    await this.access.requireOwner(roomId, user.id);
    if (typeof body?.email !== 'string' || body.email.length > 254) throw new BadRequestException('E-mail inválido.');
    const email = body.email.trim().toLowerCase();
    requireTester(email);
    const invited = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (!invited) throw new BadRequestException('O participante precisa cadastrar uma conta primeiro.');
    const existing = await this.prisma.roomMember.findFirst({ where: { roomId, userId: invited.id, leftAt: null } });
    if (!existing) await this.prisma.roomMember.create({ data: {
      roomId, userId: invited.id, nickname: invited.name || invited.email, role: 'PLAYER',
    } });
    return { success: true };
  }
}
