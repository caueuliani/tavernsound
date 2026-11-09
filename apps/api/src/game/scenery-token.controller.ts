import { BadRequestException, Body, Controller, Delete, ForbiddenException, NotFoundException, Param, Patch, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { RoomAccessService } from './room-access.service';
import { GameGateway } from './game.gateway';
import { validSceneryName } from './scenery-token-name';
import { readScene } from './scene.util';
import { isTokenGridCoordinate, movementSegments, TOKEN_SIZES, tokenCenter, validTokenPosition, validTokenMove } from './token-movement';

@Controller('rooms/:roomId/tokens')
export class SceneryTokenController {
  private pendingRenames = new Map<string, Promise<unknown>>();
  constructor(private prisma: PrismaService, private sessions: SessionService, private access: RoomAccessService, private gateway: GameGateway) {}

  private async alternativeScene(roomId: string, sceneId: string) {
    const scene = await this.prisma.scene.findFirst({
      where: { roomId, id: sceneId },
      select: { id: true, sceneData: true, position: true },
    });
    if (!scene || scene.position === 0) throw new NotFoundException('Cena alternativa indisponível.');
    return { ...scene, geometry: readScene(scene.sceneData) };
  }

  @Post('scenes/:sceneId/scenery')
  async createInScene(
    @Param('roomId') roomId: string, @Param('sceneId') sceneId: string,
    @Req() req: Request,
    @Body() body: { name?: unknown; x?: unknown; y?: unknown; hp?: unknown; maxHp?: unknown },
  ) {
    const user = await this.sessions.require(req.headers.cookie);
    await this.access.requireOwner(roomId, user.id);
    const scene = await this.alternativeScene(roomId, sceneId);
    const name = validSceneryName(body?.name);
    const { x, y } = body;
    const size = scene.geometry.settings.gridSize;
    if (typeof x !== 'number' || typeof y !== 'number' ||
        !isTokenGridCoordinate(x, size) || !isTokenGridCoordinate(y, size) ||
        !validTokenPosition(tokenCenter(x, y, size), 1, size, movementSegments(scene.geometry.walls))) {
      throw new BadRequestException('Posição inválida ou bloqueada no cenário.');
    }
    const maxHp = body.maxHp === undefined ? 10 : body.maxHp;
    const hp = body.hp === undefined ? maxHp : body.hp;
    if (!Number.isInteger(hp) || !Number.isInteger(maxHp) || maxHp < 1 || maxHp > 1_000_000 || hp < 0 || hp > maxHp) {
      throw new BadRequestException('HP do token inválido.');
    }
    const id = randomUUID();
    await this.prisma.token.create({ data: {
      id, roomId, sceneId, kind: 'SCENERY', name,
      x: Math.floor(x), y: Math.floor(y), positionX: x, positionY: y,
      color: '#ff9d00', hp, maxHp,
    } });
    this.gateway.publishAlternateTokenCreated(roomId, sceneId, {
      id, sceneId, kind: 'SCENERY', x, y, color: 0xff9d00,
      playerId: id, playerName: name, hp, maxHp, size: 1,
    });
    return { id, sceneId, name, x, y, hp, maxHp };
  }

  @Patch('scenes/:sceneId/scenery/:tokenId')
  async editInScene(
    @Param('roomId') roomId: string, @Param('sceneId') sceneId: string,
    @Param('tokenId') tokenId: string, @Req() req: Request,
    @Body() body: { x?: unknown; y?: unknown; hp?: unknown; maxHp?: unknown },
  ) {
    const user = await this.sessions.require(req.headers.cookie);
    await this.access.requireOwner(roomId, user.id);
    const scene = await this.alternativeScene(roomId, sceneId);
    const token = await this.prisma.token.findFirst({ where: { id: tokenId, roomId, sceneId, kind: 'SCENERY' } });
    if (!token) throw new NotFoundException('NPC não encontrado nesta cena.');
    const hp = body.hp === undefined ? token.hp ?? 10 : body.hp;
    const maxHp = body.maxHp === undefined ? token.maxHp ?? 10 : body.maxHp;
    if (!Number.isInteger(hp) || !Number.isInteger(maxHp) || maxHp < 1 || maxHp > 1_000_000 || hp < 0 || hp > maxHp) {
      throw new BadRequestException('HP do token inválido.');
    }
    const coordinates = body.x !== undefined || body.y !== undefined;
    const x = body.x === undefined ? token.positionX ?? token.x : body.x;
    const y = body.y === undefined ? token.positionY ?? token.y : body.y;
    const size = scene.geometry.settings.gridSize;
    if (coordinates && (typeof x !== 'number' || typeof y !== 'number' ||
        !isTokenGridCoordinate(x, size) || !isTokenGridCoordinate(y, size) ||
        !validTokenMove(
          tokenCenter(token.positionX ?? token.x, token.positionY ?? token.y, size),
          tokenCenter(x, y, size), token.sizeMultiplier ?? 1, size, movementSegments(scene.geometry.walls),
        ))) {
      throw new BadRequestException('Movimento inválido ou atravessa uma parede.');
    }
    const result = await this.prisma.token.updateMany({
      where: { id: tokenId, roomId, sceneId, kind: 'SCENERY' },
      data: { hp, maxHp, ...(coordinates ? { x: Math.floor(x), y: Math.floor(y), positionX: x, positionY: y } : {}) },
    });
    if (result.count !== 1) throw new NotFoundException('NPC mudou de cena.');
    this.gateway.publishAlternateTokenHp(roomId, sceneId, tokenId, hp, maxHp);
    if (coordinates) this.gateway.publishAlternateTokenMoved(roomId, sceneId, tokenId, x, y);
    return { id: tokenId, sceneId, x, y, hp, maxHp };
  }

  @Delete('scenes/:sceneId/scenery/:tokenId')
  async removeInScene(
    @Param('roomId') roomId: string, @Param('sceneId') sceneId: string,
    @Param('tokenId') tokenId: string, @Req() req: Request,
  ) {
    const user = await this.sessions.require(req.headers.cookie);
    await this.access.requireOwner(roomId, user.id);
    await this.alternativeScene(roomId, sceneId);
    const result = await this.prisma.token.deleteMany({
      where: { id: tokenId, roomId, sceneId, kind: 'SCENERY' },
    });
    if (result.count !== 1) throw new NotFoundException('NPC não encontrado nesta cena.');
    this.gateway.publishAlternateTokenDeleted(roomId, sceneId, tokenId);
    return { id: tokenId, sceneId, deleted: true };
  }

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
        if (!validTokenPosition(tokenCenter(token.positionX ?? token.x, token.positionY ?? token.y, scene.settings.gridSize), size, scene.settings.gridSize, movementSegments(scene.walls))) {
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
