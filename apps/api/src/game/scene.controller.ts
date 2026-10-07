import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Headers, NotFoundException, Param, Post, Put, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
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
  @Get()
  async get(@Param('roomId') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.sessions.require(req.headers.cookie);
    const room = await this.access.require(id, user.id);
    res.setHeader('Cache-Control', 'no-store');
    return { scene: publicScene(id, readScene(room.sceneData)), editingEnabled: this.enabled(), isHost: room.ownerId === user.id };
  }
  @Get('image')
  async image(@Param('roomId') id: string, @Req() req: Request, @Res() res: Response) {
    const room = await this.authorize(id, req);
    const map = readScene(room.sceneData).map;
    if (!map) throw new NotFoundException('Nenhum mapa salvo.');
    let bytes: Buffer;
    if (typeof room.mapUrl === 'string' && room.mapUrl.startsWith('db-webp:')) {
      bytes = Buffer.from(room.mapUrl.slice('db-webp:'.length), 'base64');
    } else {
      try { bytes = await readFile(this.filePath(map.file)); } catch { throw new NotFoundException('Arquivo do mapa não encontrado.'); }
    }
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(bytes);
  }
  @Put()
  async edit(@Param('roomId') id: string, @Req() req: Request, @Body() body: unknown, @Headers('if-match') revision: string) {
    const room = await this.authorize(id, req, true);
    return this.save(room, { ...readScene(room.sceneData), ...validateSceneEdit(body) }, revision);
  }
  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 0, parts: 1 } }))
  async upload(@Param('roomId') id: string, @Req() req: Request, @UploadedFile() file: { buffer: Buffer }, @Headers('if-match') revision: string) {
    const room = await this.authorize(id, req, true);
    if (!file?.buffer?.length) throw new BadRequestException('Selecione uma imagem de até 3 MB.');
    let result: { data: Buffer; info: { width: number; height: number } };
    try {
      const pipeline = sharp(file.buffer, { limitInputPixels: 16777216 });
      const metadata = await pipeline.metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) !== 1) throw new Error();
      result = await pipeline.rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    } catch { throw new BadRequestException('Use PNG, JPG ou WebP estático, com até 16 megapixels.'); }
    if (result.data.length > 3 * 1024 * 1024) throw new BadRequestException('Imagem resultante muito grande.');
    const scene = readScene(room.sceneData);
    const filename = `${randomUUID()}.webp`;
    const saved = await this.save(room, { ...scene, map: { file: filename, width: result.info.width, height: result.info.height } }, revision, result.data);
    if (scene.map) await unlink(this.filePath(scene.map.file)).catch(() => {});
    return saved;
  }
  @Delete('image')
  async remove(@Param('roomId') id: string, @Req() req: Request, @Headers('if-match') revision: string) {
    const room = await this.authorize(id, req, true);
    const scene = readScene(room.sceneData);
    const saved = await this.save(room, { ...scene, map: null }, revision, null);
    if (scene.map) await unlink(this.filePath(scene.map.file)).catch(() => {});
    return saved;
  }
}
