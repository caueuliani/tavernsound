import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RoomAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async require(roomId: string, userId: string) {
    if (typeof roomId !== 'string' || !/^[A-Z0-9]{6}$/.test(roomId)) {
      throw new NotFoundException('Sala não encontrada.');
    }
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Sala não encontrada.');
    if (room.ownerId === userId) return room;
    const member = await this.prisma.roomMember.findFirst({
      where: { roomId, userId, leftAt: null },
    });
    if (!member && !(room.isPublic && !room.password)) {
      throw new ForbiddenException('Peça ao mestre para autorizar sua conta nesta sala.');
    }
    return room;
  }

  /**
   * Until live scene switching is implemented, only the first (active)
   * scene is eligible for per-scene RTC tokens. A staged destination is NOT
   * permission to listen to a secret scene. The VTT's legacy room channel
   * is unchanged until the client and gateway switch atomically.
   */
  async requireSceneMedia(roomId: string, userId: string, sceneId: string) {
    await this.require(roomId, userId);
    if (typeof sceneId !== 'string' || !/^[a-zA-Z0-9-]{1,120}$/.test(sceneId)) {
      throw new NotFoundException('Cena indisponível.');
    }
    const first = await this.prisma.scene.findFirst({
      where: { roomId }, orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!first || first.id !== sceneId) {
      throw new ForbiddenException('O áudio desta cena ainda não está ativo.');
    }
    return first;
  }

  async requireOwner(roomId: string, userId: string) {
    const room = await this.require(roomId, userId);
    if (room.ownerId !== userId) throw new ForbiddenException('Apenas o mestre pode gerenciar esta sala.');
    return room;
  }
}
