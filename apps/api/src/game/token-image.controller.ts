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
    await this.access.require(roomId, user.id);
    const ownId = createHash('sha256').update(`${roomId}:${user.id}`).digest('hex');
    if (tokenId !== ownId) throw new ForbiddenException('Você só pode alterar o retrato do seu personagem nesta sala.');
    if (!file?.buffer?.length || file.buffer.length > 2 * 1024 * 1024) throw new BadRequestException('Selecione uma imagem de até 2 MB.');
    let bytes: Buffer;
    try {
      const image = sharp(file.buffer, { limitInputPixels: 16777216 });
      const metadata = await image.metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) !== 1) throw new Error();
      bytes = await image.rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
      if (bytes.length > 128 * 1024) throw new Error();
    } catch { throw new BadRequestException('Use PNG, JPG ou WebP estático, até 2 MB e 16 megapixels.'); }
    const imageData = `data:image/webp;base64,${bytes.toString('base64')}`;
    const result = await this.prisma.token.updateMany({ where: { id: tokenId, roomId }, data: { imageUrl: imageData } });
    if (result.count !== 1) throw new NotFoundException('Crie seu token na mesa antes de enviar o retrato.');
    this.gateway.publishTokenImage(roomId, tokenId, imageData);
    return { tokenId, imageData };
  }
}
