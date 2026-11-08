import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Headers, NotFoundException, Param, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { RoomAccessService } from './room-access.service';
import { GameGateway } from './game.gateway';
import { publicScene, readScene, validateSceneEdit } from './scene.util';
import type { SceneData } from './scene.util';
import { appEnvironment } from '../safety/test-policy';

@Controller('rooms/:roomId/scene')
export class SceneController {
  private folder = path.resolve(process.env.LOCAL_UPLOAD_DIR || 'local-uploads/maps');
  constructor(private prisma: PrismaService, private sessions: SessionService, private access: RoomAccessService, private gateway: GameGateway) {}
  private enabled() { return appEnvironment() === 'beta' || process.env.LOCAL_MAP_UPLOADS === 'true'; }
  private async authorize(id: string, req: Request, edit = false) {
    const user = await this.sessions.require(req.headers.cookie);
    if (edit && !this.enabled()) throw new ForbiddenException('O editor de mapas não está habilitado nesta hospedagem.');
    return edit ? this.access.requireOwner(id, user.id) : this.access.require(id, user.id);
  }
  private filePath(file: string) {
    if (!/^[a-f0-9-]{36}\.webp$/.test(file)) throw new NotFoundException('Mapa indisponível.');
    return path.join(this.folder, file);
  }
  private async chosenScene(room: any, sceneId: string | undefined, userId: string, edit: boolean) {
    if (!sceneId) return null; // Existing VTT and legacy editor always use Room.
    const stored = await this.prisma.scene.findFirst({ where: { id: sceneId, roomId: room.id } });
    if (!stored) throw new NotFoundException('Cena não encontrada nesta sala.');
    if (!edit && room.ownerId !== userId) {
      // Staged assignments are GM-only preparation; never reveal draft scenes to players.
      const first = await this.prisma.scene.findFirst({ where: { roomId: room.id }, orderBy: { position: 'asc' } });
      if (sceneId !== first?.id) throw new ForbiddenException('Cena não disponível para este jogador.');
    }
    return stored;
  }
  private initialScene(room: any, stored: any) {
    return !!stored && stored.id === `initial-${room.id}`;
  }
  private async saveSelected(room: any, stored: any, scene: SceneData, revision: string | undefined, mapBytes?: Buffer | null) {
    if (!stored || this.initialScene(room, stored)) return this.save(room, scene, revision, mapBytes);
    if (revision !== String(readScene(stored.sceneData).revision)) throw new ConflictException('O cenário mudou. Recarregue antes de salvar.');
    scene.revision++;
    const result = await this.prisma.scene.updateMany({ where: { id: stored.id, roomId: room.id, updatedAt: stored.updatedAt }, data: {
      sceneData: scene as any,
      ...(mapBytes === undefined ? {} : { mapUrl: mapBytes ? `db-webp:${mapBytes.toString('base64')}` : null }),
    } });
    if (result.count !== 1) throw new ConflictException('Outra alteração foi salva. Recarregue o cenário.');
    // Draft scenes must not update the active VTT until scene activation is implemented.
    return publicScene(room.id, scene, stored.id);
  }
  private async save(room: any, scene: SceneData, revision: string | undefined, mapBytes?: Buffer | null) {
    if (revision !== String(readScene(room.sceneData).revision)) throw new ConflictException('O cenário mudou. Recarregue antes de salvar.');
    scene.revision++;
    const result = await this.prisma.room.updateMany({ where: { id: room.id, updatedAt: room.updatedAt }, data: {
      sceneData: scene as any,
      ...(mapBytes === undefined ? {} : { mapUrl: mapBytes ? `db-webp:${mapBytes.toString('base64')}` : null }),
    } });
    if (result.count !== 1) throw new ConflictException('Outra alteração foi salva. Recarregue o cenário.');
    const visible = publicScene(room.id, scene);
    this.gateway.publishScene(room.id, visible);
    return visible;
  }
  // Scene management is additive in this phase. Switching and map editing
  // continue to use the legacy room scene until the gateway is scene-aware.
  @Get('list')
  async list(@Param('roomId') roomId: string, @Req() req: Request) {
    const user = await this.sessions.require(req.headers.cookie);
    const room = await this.access.require(roomId, user.id);
    const isHost = room.ownerId === user.id;
    const scenes = await this.prisma.scene.findMany({
      where: { roomId }, orderBy: { position: 'asc' },
      select: { id: true, name: true, position: true },
    });
    if (isHost) return { scenes, currentSceneId: scenes[0]?.id ?? null, isHost };
    // Until live cutover, only the initial scene is visible to players.
    const visible = scenes[0];
    return { scenes: visible ? [visible] : [], currentSceneId: visible?.id ?? null, isHost };
  }

  @Post('list')
  async create(@Param('roomId') roomId: string, @Req() req: Request, @Body() body: { name?: unknown }) {
    const user = await this.sessions.require(req.headers.cookie);
    await this.access.requireOwner(roomId, user.id);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) throw new BadRequestException('Informe um nome de até 80 caracteres.');
    const scenes = await this.prisma.scene.findMany({
      where: { roomId }, select: { position: true }, orderBy: { position: 'desc' }, take: 20,
    });
    if (scenes.length >= 20) throw new BadRequestException('Limite de 20 cenas por sala.');
    const scene = await this.prisma.scene.create({
      data: { id: randomUUID(), roomId, name, position: (scenes[0]?.position ?? -1) + 1 },
      select: { id: true, name: true, position: true },
    });
    return scene;
  }

  @Put('list/:sceneId')
  async rename(@Param('roomId') roomId: string, @Param('sceneId') sceneId: string, @Req() req: Request, @Body() body: { name?: unknown }) {
    const user = await this.sessions.require(req.headers.cookie);
    await this.access.requireOwner(roomId, user.id);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) throw new BadRequestException('Informe um nome de até 80 caracteres.');
    const result = await this.prisma.scene.updateMany({ where: { roomId, id: sceneId }, data: { name } });
    if (!result.count) throw new NotFoundException('Cena não encontrada.');
    return { id: sceneId, name };
  }

  // Staging only. This assignment deliberately does not change the active
  // canvas, Socket.IO room, tokens, fog, or Agora channel. A later cutover
  // will apply scene assignments atomically to the live VTT.
  @Get('assignments')
  async assignments(@Param('roomId') roomId: string, @Req() req: Request) {
    const user = await this.sessions.require(req.headers.cookie);
    await this.access.requireOwner(roomId, user.id);
    const [members, assignments, scenes] = await Promise.all([
      this.prisma.roomMember.findMany({
        where: { roomId, leftAt: null, userId: { not: null } },
        select: { userId: true, nickname: true },
      }),
      this.prisma.roomSceneAssignment.findMany({
        where: { roomId }, select: { userId: true, sceneId: true },
      }),
      this.prisma.scene.findMany({
        where: { roomId }, orderBy: { position: 'asc' },
        select: { id: true, name: true, position: true },
      }),
    ]);
    const assigned = new Map(assignments.map(item => [item.userId, item.sceneId]));
    const seen = new Set<string>();
    return {
      scenes,
      players: members.filter(member => {
        if (!member.userId || seen.has(member.userId)) return false;
        seen.add(member.userId);
        return true;
      }).map(member => ({
        userId: member.userId!,
        nickname: member.nickname,
        sceneId: assigned.get(member.userId!) ?? scenes[0]?.id ?? null,
      })),
      mode: 'staging',
    };
  }

  @Put('assignments/:userId')
  async stagePlayerScene(
    @Param('roomId') roomId: string,
    @Param('userId') targetUserId: string,
    @Req() req: Request,
    @Body() body: { sceneId?: unknown },
  ) {
    const user = await this.sessions.require(req.headers.cookie);
    const room = await this.access.requireOwner(roomId, user.id);
    if (targetUserId === room.ownerId) throw new BadRequestException('O mestre não recebe atribuição de jogador.');
    const sceneId = typeof body?.sceneId === 'string' ? body.sceneId : '';
    if (!sceneId || sceneId.length > 120) throw new BadRequestException('Selecione uma cena válida.');
    const [member, scene] = await Promise.all([
      this.prisma.roomMember.findFirst({
        where: { roomId, userId: targetUserId, leftAt: null },
        select: { id: true },
      }),
      this.prisma.scene.findFirst({
        where: { roomId, id: sceneId }, select: { id: true },
      }),
    ]);
    if (!member) throw new NotFoundException('Jogador não é membro ativo desta sala.');
    if (!scene) throw new NotFoundException('Cena não pertence a esta sala.');
    const assignment = await this.prisma.roomSceneAssignment.upsert({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      create: { roomId, userId: targetUserId, sceneId },
      update: { sceneId },
    });
    return { userId: targetUserId, sceneId: assignment.sceneId, mode: 'staging' };
  }

  @Get()
  async get(@Param('roomId') id: string, @Query('sceneId') sceneId: string | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.sessions.require(req.headers.cookie);
    const room = await this.access.require(id, user.id);
    res.setHeader('Cache-Control', 'no-store');
    const stored = await this.chosenScene(room, sceneId, user.id, false);
    const source = stored && !this.initialScene(room, stored) ? stored.sceneData : room.sceneData;
    const scene = readScene(source);
    return { scene: publicScene(id, scene, stored && !this.initialScene(room, stored) ? stored.id : undefined),
      editingEnabled: this.enabled(), isHost: room.ownerId === user.id, sceneId: stored?.id ?? null };
  }

  @Get('image')
  async image(@Param('roomId') id: string, @Query('sceneId') sceneId: string | undefined, @Req() req: Request, @Res() res: Response) {
    const user = await this.sessions.require(req.headers.cookie);
    const room = await this.access.require(id, user.id);
    const stored = await this.chosenScene(room, sceneId, user.id, false);
    const source = stored && !this.initialScene(room, stored) ? stored : room;
    const map = readScene(source.sceneData).map;
    if (!map) throw new NotFoundException('Nenhum mapa salvo.');
    let bytes: Buffer;
    if (typeof source.mapUrl === 'string' && source.mapUrl.startsWith('db-webp:')) {
      bytes = Buffer.from(source.mapUrl.slice('db-webp:'.length), 'base64');
    } else {
      try { bytes = await readFile(this.filePath(map.file)); } catch { throw new NotFoundException('Arquivo do mapa não encontrado.'); }
    }
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(bytes);
  }

  @Put()
  async edit(@Param('roomId') id: string, @Query('sceneId') sceneId: string | undefined, @Req() req: Request, @Body() body: unknown, @Headers('if-match') revision: string) {
    const room = await this.authorize(id, req, true);
    const stored = await this.chosenScene(room, sceneId, room.ownerId!, true);
    const source = stored && !this.initialScene(room, stored) ? stored.sceneData : room.sceneData;
    return this.saveSelected(room, stored, { ...readScene(source), ...validateSceneEdit(body) }, revision);
  }

  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 0, parts: 1 } }))
  async upload(@Param('roomId') id: string, @Query('sceneId') sceneId: string | undefined, @Req() req: Request, @UploadedFile() file: { buffer: Buffer }, @Headers('if-match') revision: string) {
    const room = await this.authorize(id, req, true);
    const stored = await this.chosenScene(room, sceneId, room.ownerId!, true);
    if (!file?.buffer?.length) throw new BadRequestException('Selecione uma imagem de até 3 MB.');
    let result: { data: Buffer; info: { width: number; height: number } };
    try {
      const pipeline = sharp(file.buffer, { limitInputPixels: 16777216 });
      const metadata = await pipeline.metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) !== 1) throw new Error();
      result = await pipeline.rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    } catch { throw new BadRequestException('Use PNG, JPG ou WebP estático, com até 16 megapixels.'); }
    if (result.data.length > 3 * 1024 * 1024) throw new BadRequestException('Imagem resultante muito grande.');
    const source = stored && !this.initialScene(room, stored) ? stored.sceneData : room.sceneData;
    const scene = readScene(source);
    const filename = `${randomUUID()}.webp`;
    const saved = await this.saveSelected(room, stored, { ...scene, map: { file: filename, width: result.info.width, height: result.info.height } }, revision, result.data);
    if (scene.map) await unlink(this.filePath(scene.map.file)).catch(() => {});
    return saved;
  }

  @Delete('image')
  async remove(@Param('roomId') id: string, @Query('sceneId') sceneId: string | undefined, @Req() req: Request, @Headers('if-match') revision: string) {
    const room = await this.authorize(id, req, true);
    const stored = await this.chosenScene(room, sceneId, room.ownerId!, true);
    const source = stored && !this.initialScene(room, stored) ? stored.sceneData : room.sceneData;
    const scene = readScene(source);
    const saved = await this.saveSelected(room, stored, { ...scene, map: null }, revision, null);
    if (scene.map) await unlink(this.filePath(scene.map.file)).catch(() => {});
    return saved;
  }
}
