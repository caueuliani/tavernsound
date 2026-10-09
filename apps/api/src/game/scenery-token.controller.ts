import { BadRequestException, Body, Controller, Delete, ForbiddenException, NotFoundException, Param, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { RoomAccessService } from './room-access.service';
import { GameGateway } from './game.gateway';
import { validSceneryName } from './scenery-token-name';
import { readScene } from './scene.util';
import { movementSegments, TOKEN_SIZES, tokenCenter, validTokenPosition } from './token-movement';

@Controller('rooms/:roomId/tokens')
export class SceneryTokenController {
  private pendingRenames = new Map<string, Promise<unknown>>();
  constructor(private prisma: PrismaService, private sessions: SessionService, private access: RoomAccessService, private gateway: GameGateway) {}

  @Patch(':tokenId')
  async rename(@Param('roomId') roomId: string, @Param('tokenId') tokenId: string, @Req() req: Request, @Body() body: { name?: unknown; size?: unknown }) {
    const user = await this.sessions.require(req.headers.cookie);
    const room = await this.access.requireOwner(roomId, user.id);
    const name = validSceneryName(body?.name);
    const size = body?.size === undefined ? undefined : body.size;
    if (size !== undefined && !TOKEN_SIZES.includes(size as any)) throw new BadRequestException('Tamanho de token inválido.');
    const key = `${roomId}:${tokenId}`;
    const previous = this.pendingRenames.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const token = await this.prisma.token.findFirst({ where: { id: tokenId, roomId } });
      if (!token) throw new NotFoundException('Token não encontrado.');
      if (token.kind !== 'SCENERY') throw new ForbiddenException('Você não pode editar este token.');
      if (size !== undefined) {
        const scene = readScene(room.sceneData);
        if (!validTokenPosition(tokenCenter(token.x, token.y), size, scene.settings.gridSize, movementSegments(scene.walls))) {
          throw new BadRequestException('Este tamanho não cabe na posição atual do token.');
        }
      }
      const updated = await this.prisma.token.updateMany({ where: { id: tokenId, roomId, kind: 'SCENERY' }, data: { name, ...(size === undefined ? {} : { sizeMultiplier: size as number }) } });
      if (updated.count !== 1) throw new NotFoundException('Token não encontrado.');
      this.gateway.publishTokenName(roomId, tokenId, name);
      if (size !== undefined) this.gateway.publishTokenSize(roomId, tokenId, size as number);
      return { tokenId, name, ...(size === undefined ? {} : { size }) };
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
