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
  private async selected(roomId: string, userId: string, isHost: boolean, requested?: string) {
    const first = await this.prisma.scene.findFirst({ where: { roomId }, orderBy: { position: 'asc' } });
    if (!first) throw new NotFoundException('Cena indisponível. Execute a migration de cenas.');
    const assignment = isHost ? null : await this.prisma.roomSceneAssignment.findUnique({ where: { roomId_userId: { roomId, userId } } });
    const sceneId = isHost ? requested || first.id : assignment?.sceneId || first.id;
    const scene = await this.prisma.scene.findFirst({ where: { id: sceneId, roomId } });
    if (!scene) throw new NotFoundException('Cena não encontrada.');
    return scene;
  }
  @Get('list')
  async list(@Param('roomId') id: string, @Req() req: Request) {
    const user = await this.sessions.require(req.headers.cookie);
    const room = await this.access.require(id, user.id);
    const isHost = room.ownerId === user.id;
    const scenes = await this.prisma.scene.findMany({ where: { roomId: id }, orderBy: { position: 'asc' }, select: { id: true, name: true, position: true } });
    const current = await this.selected(id, user.id, isHost);
    return { scenes: isHost ? scenes : scenes.filter(scene => scene.id === current.id), currentSceneId: current.id, isHost };
  }
  @Post('list')
  async create(@Param('roomId') id: string, @Req() req: Request, @Body() body: { name?: string }) {
    const user = await this.sessions.require(req.headers.cookie);
    await this.access.requireOwner(id, user.id);
    const name = body?.name?.trim();
    if (!name || name.length > 80) throw new BadRequestException('Informe um nome de até 80 caracteres.');
    const last = await this.prisma.scene.findFirst({ where: { roomId: id }, orderBy: { position: 'desc' } });
    const scene = await this.prisma.scene.create({ data: { roomId: id, name, position: (last?.position ?? -1) + 1 } });
    this.gateway.publishSceneList(id, { id: scene.id, name: scene.name, position: scene.position });
    return { id: scene.id, name: scene.name, position: scene.position };
  }
  @Put('list/:sceneId')
  async rename(@Param('roomId') id: string, @Param('sceneId') sceneId: string, @Req() req: Request, @Body() body: { name?: string }) {
    const user = await this.sessions.require(req.headers.cookie);
    await this.access.requireOwner(id, user.id);
    const name = body?.name?.trim();
    if (!name || name.length > 80) throw new BadRequestException('Informe um nome de até 80 caracteres.');
    const result = await this.prisma.scene.updateMany({ where: { id: sceneId, roomId: id }, data: { name } });
    if (!result.count) throw new NotFoundException('Cena não encontrada.');
    this.gateway.publishSceneList(id, { id: sceneId, name });
    return { id: sceneId, name };
  }
  private async save(room: any, stored: any, scene: SceneData, revision: string | undefined, mapBytes?: Buffer | null) {
    if (revision !== String(readScene(stored.sceneData).revision)) throw new ConflictException('O cenário mudou. Recarregue antes de salvar.');
    scene.revision++;
    const result = await this.prisma.scene.updateMany({ where: { id: stored.id, updatedAt: stored.updatedAt }, data: {
      sceneData: scene as any,
      ...(mapBytes === undefined ? {} : { mapUrl: mapBytes ? `db-webp:${mapBytes.toString('base64')}` : null }),
    } });
    if (result.count !== 1) throw new ConflictException('Outra alteração foi salva. Recarregue o cenário.');
    const visible = publicScene(room.id, scene, stored.id);
    this.gateway.publishScene(room.id, stored.id, visible);
    return visible;
  }
  @Get()
  async get(@Param('roomId') id: string, @Query('sceneId') sceneId: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.sessions.require(req.headers.cookie);
    const room = await this.access.require(id, user.id);
    res.setHeader('Cache-Control', 'no-store');
    const stored = await this.selected(id, user.id, room.ownerId === user.id, sceneId);
    return { scene: publicScene(id, readScene(stored.sceneData), stored.id), sceneId: stored.id, name: stored.name, editingEnabled: this.enabled(), isHost: room.ownerId === user.id };
  }
  @Get('image')
  async image(@Param('roomId') id: string, @Query('sceneId') sceneId: string, @Req() req: Request, @Res() res: Response) {
    const room = await this.authorize(id, req);
    const user = await this.sessions.require(req.headers.cookie);
    const stored = await this.selected(id, user.id, room.ownerId === user.id, sceneId);
    const map = readScene(stored.sceneData).map;
    if (!map) throw new NotFoundException('Nenhum mapa salvo.');
    let bytes: Buffer;
    if (typeof stored.mapUrl === 'string' && stored.mapUrl.startsWith('db-webp:')) {
      bytes = Buffer.from(stored.mapUrl.slice('db-webp:'.length), 'base64');
    } else {
      try { bytes = await readFile(this.filePath(map.file)); } catch { throw new NotFoundException('Arquivo do mapa não encontrado.'); }
    }
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(bytes);
  }
  @Put()
  async edit(@Param('roomId') id: string, @Query('sceneId') sceneId: string, @Req() req: Request, @Body() body: unknown, @Headers('if-match') revision: string) {
    const room = await this.authorize(id, req, true);
    const stored = await this.selected(id, room.ownerId!, true, sceneId);
    return this.save(room, stored, { ...readScene(stored.sceneData), ...validateSceneEdit(body) }, revision);
  }
  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 0, parts: 1 } }))
  async upload(@Param('roomId') id: string, @Query('sceneId') sceneId: string, @Req() req: Request, @UploadedFile() file: { buffer: Buffer }, @Headers('if-match') revision: string) {
    const room = await this.authorize(id, req, true);
    const stored = await this.selected(id, room.ownerId!, true, sceneId);
    if (!file?.buffer?.length) throw new BadRequestException('Selecione uma imagem de até 3 MB.');
    let result: { data: Buffer; info: { width: number; height: number } };
    try {
      const pipeline = sharp(file.buffer, { limitInputPixels: 16777216 });
      const metadata = await pipeline.metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) !== 1) throw new Error();
      result = await pipeline.rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    } catch { throw new BadRequestException('Use PNG, JPG ou WebP estático, com até 16 megapixels.'); }
    if (result.data.length > 3 * 1024 * 1024) throw new BadRequestException('Imagem resultante muito grande.');
    const scene = readScene(stored.sceneData);
    const filename = `${randomUUID()}.webp`;
    const saved = await this.save(room, stored, { ...scene, map: { file: filename, width: result.info.width, height: result.info.height } }, revision, result.data);
    if (scene.map) await unlink(this.filePath(scene.map.file)).catch(() => {});
    return saved;
  }
  @Delete('image')
  async remove(@Param('roomId') id: string, @Query('sceneId') sceneId: string, @Req() req: Request, @Headers('if-match') revision: string) {
    const room = await this.authorize(id, req, true);
    const stored = await this.selected(id, room.ownerId!, true, sceneId);
    const scene = readScene(stored.sceneData);
    const saved = await this.save(room, stored, { ...scene, map: null }, revision, null);
    if (scene.map) await unlink(this.filePath(scene.map.file)).catch(() => {});
    return saved;
  }
}
