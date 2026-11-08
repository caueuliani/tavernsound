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
   * Active media authorization is independent from the GM's staged
   * destination. A NULL activeSceneId means the initial scene is active.
   * Only a future synchronized cutover may populate activeSceneId.
   */
  async activeSceneForUser(roomId: string, userId: string) {
    const room = await this.require(roomId, userId);
    const first = await this.prisma.scene.findFirst({
      where: { roomId }, orderBy: { position: 'asc' }, select: { id: true },
    });
    if (!first) throw new NotFoundException('Cena inicial indisponível.');
    if (room.ownerId === userId) return { room, sceneId: first.id, initialSceneId: first.id, isHost: true };
    const assignment = await this.prisma.roomSceneAssignment.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { activeSceneId: true },
    });
    const sceneId = assignment?.activeSceneId ?? first.id;
    if (sceneId !== first.id) {
      const actual = await this.prisma.scene.findFirst({ where: { roomId, id: sceneId }, select: { id: true } });
      if (!actual) throw new ForbiddenException('Cena ativa inválida.');
    }
    return { room, sceneId, initialSceneId: first.id, isHost: false };
  }

  async requireSceneMedia(roomId: string, userId: string, sceneId: string) {
    const current = await this.activeSceneForUser(roomId, userId);
    if (typeof sceneId !== 'string' || !/^[a-zA-Z0-9-]{1,120}$/.test(sceneId)) {
      throw new NotFoundException('Cena indisponível.');
    }
    if (current.sceneId !== sceneId) {
      throw new ForbiddenException('O áudio desta cena ainda não está ativo.');
    }
    return { id: sceneId };
  }

  async requireLegacyMedia(roomId: string, userId: string) {
    const current = await this.activeSceneForUser(roomId, userId);
    if (current.sceneId !== current.initialSceneId) {
      throw new ForbiddenException('Esta sessão requer um canal de áudio da cena ativa.');
    }
    return current.room;
  }

  async requireOwner(roomId: string, userId: string) {
    const room = await this.require(roomId, userId);
    if (room.ownerId !== userId) throw new ForbiddenException('Apenas o mestre pode gerenciar esta sala.');
    return room;
  }
}
