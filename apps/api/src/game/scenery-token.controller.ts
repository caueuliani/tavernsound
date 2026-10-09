import { Body, Controller, Delete, ForbiddenException, NotFoundException, Param, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { RoomAccessService } from './room-access.service';
import { GameGateway } from './game.gateway';
import { validSceneryName } from './scenery-token-name';

@Controller('rooms/:roomId/tokens')
export class SceneryTokenController {
  private pendingRenames = new Map<string, Promise<unknown>>();
  constructor(private prisma: PrismaService, private sessions: SessionService, private access: RoomAccessService, private gateway: GameGateway) {}

  @Patch(':tokenId')
  async rename(@Param('roomId') roomId: string, @Param('tokenId') tokenId: string, @Req() req: Request, @Body() body: { name?: unknown }) {
    const user = await this.sessions.require(req.headers.cookie);
    await this.access.requireOwner(roomId, user.id);
    const name = validSceneryName(body?.name);
    const key = `${roomId}:${tokenId}`;
    const previous = this.pendingRenames.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const token = await this.prisma.token.findFirst({ where: { id: tokenId, roomId } });
      if (!token) throw new NotFoundException('Token não encontrado.');
      if (token.kind !== 'SCENERY') throw new ForbiddenException('Você não pode editar este token.');
      const updated = await this.prisma.token.updateMany({ where: { id: tokenId, roomId, kind: 'SCENERY' }, data: { name } });
      if (updated.count !== 1) throw new NotFoundException('Token não encontrado.');
      this.gateway.publishTokenName(roomId, tokenId, name);
      return { tokenId, name };
    });
    this.pendingRenames.set(key, operation);
    try { return await operation; }
    finally { if (this.pendingRenames.get(key) === operation) this.pendingRenames.delete(key); }
  }

  @Delete(':tokenId')
  async remove(@Param('roomId') roomId: string, @Param('tokenId') tokenId: string, @Req() req: Request) {
    const user = await this.sessions.require(req.headers.cookie);
    await this.access.requireOwner(roomId, user.id);
    const token = await this.prisma.token.findFirst({ where: { id: tokenId, roomId } });
    if (!token) throw new NotFoundException('Token não encontrado.');
    if (token.kind !== 'SCENERY') throw new ForbiddenException('Você não pode excluir este token.');
    const deleted = await this.prisma.token.deleteMany({ where: { id: tokenId, roomId, kind: 'SCENERY' } });
    if (deleted.count !== 1) throw new NotFoundException('Token não encontrado.');
    this.gateway.publishTokenDeleted(roomId, tokenId);
    return { tokenId };
  }
}
