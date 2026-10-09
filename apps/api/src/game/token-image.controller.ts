import { BadRequestException, Controller, ForbiddenException, NotFoundException, Param, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { RoomAccessService } from './room-access.service';
import { GameGateway } from './game.gateway';

@Controller('rooms/:roomId/tokens/:tokenId/image')
export class TokenImageController {
  constructor(private prisma: PrismaService, private sessions: SessionService, private access: RoomAccessService, private gateway: GameGateway) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0, parts: 1 } }))
  async upload(@Param('roomId') roomId: string, @Param('tokenId') tokenId: string, @Req() req: Request, @UploadedFile() file: { buffer: Buffer }) {
    const user = await this.sessions.require(req.headers.cookie);
    const room = await this.access.require(roomId, user.id);
    const ownId = createHash('sha256').update(`${roomId}:${user.id}`).digest('hex');
    const isHost = room.ownerId === user.id;
    if (!isHost && tokenId !== ownId) throw new ForbiddenException('Você não pode alterar a imagem deste token.');
    const kind = isHost ? 'SCENERY' : 'PLAYER';
    const token = await this.prisma.token.findFirst({ where: { id: tokenId, roomId } });
    if (!token) throw new NotFoundException('Token não encontrado.');
    if (token.kind !== kind) throw new ForbiddenException('Você não pode alterar a imagem deste token.');
    if (!file?.buffer?.length || file.buffer.length > 2 * 1024 * 1024) throw new BadRequestException('A imagem deve ter no máximo 2 MB.');
    let bytes: Buffer;
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(file.buffer, { limitInputPixels: 16777216 }).metadata();
    } catch { throw new BadRequestException('Não foi possível processar esta imagem.'); }
    if (!['png', 'jpeg', 'webp'].includes(metadata.format || '')) throw new BadRequestException('Use uma imagem PNG, JPG ou WebP.');
    if ((metadata.pages || 1) !== 1) throw new BadRequestException('Não foi possível processar esta imagem.');
    try {
      bytes = await sharp(file.buffer, { limitInputPixels: 16777216 }).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
      if (bytes.length > 128 * 1024) throw new Error();
    } catch { throw new BadRequestException('Não foi possível processar esta imagem.'); }
    const imageData = `data:image/webp;base64,${bytes.toString('base64')}`;
    const result = await this.prisma.token.updateMany({ where: { id: tokenId, roomId, kind }, data: { imageUrl: imageData } });
    if (result.count !== 1) throw new NotFoundException('Token não encontrado.');
    this.gateway.publishTokenImage(roomId, tokenId, imageData);
    return { tokenId, imageData };
  }
}
