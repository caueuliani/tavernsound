import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCampaignDto,
  UpdateCampaignDto,
  CampaignMemberDto,
  InviteToCampaignDto,
  GenerateInviteLinkDto,
  CampaignDto,
  CampaignDetailDto,
  GameSessionDto,
  CreateGameSessionDto,
  UpdateGameSessionDto,
  CampaignStatus,
} from './dto/campaign.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  async createCampaign(userId: string, dto: CreateCampaignDto): Promise<CampaignDto> {
    const campaign = await this.prisma.campaign.create({
      data: {
        name: dto.name,
        description: dto.description,
        ownerId: userId,
        status: CampaignStatus.ACTIVE,
      },
    });

    return this.mapToCampaignDto(campaign);
  }

  async getCampaigns(userId: string): Promise<CampaignDto[]> {
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
        ],
      },
      include: {
        _count: {
          select: {
            members: true,
            rooms: true,
            sessions: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return campaigns.map(c => this.mapToCampaignDto(c, c._count));
  }

  async getCampaignById(campaignId: string, userId: string): Promise<CampaignDetailDto> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        rooms: {
          select: {
            id: true,
            name: true,
            lastActiveAt: true,
          },
          orderBy: { lastActiveAt: 'desc' },
        },
        sessions: {
          orderBy: { startedAt: 'desc' },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }

    const hasAccess = campaign.ownerId === userId || campaign.members.some(m => m.userId === userId);
    if (!hasAccess) {
      throw new ForbiddenException('Você não tem acesso a esta campanha');
    }

    return this.mapToCampaignDetailDto(campaign);
  }

  async updateCampaign(campaignId: string, userId: string, dto: UpdateCampaignDto): Promise<CampaignDto> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }

    if (campaign.ownerId !== userId) {
      throw new ForbiddenException('Apenas o dono pode editar a campanha');
    }

    const updated = await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { name: dto.name, description: dto.description, status: dto.status },
      include: {
        _count: {
          select: {
            members: true,
            rooms: true,
            sessions: true,
          },
        },
      },
    });

    return this.mapToCampaignDto(updated, updated._count);
  }

  async deleteCampaign(campaignId: string, userId: string): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }

    if (campaign.ownerId !== userId) {
      throw new ForbiddenException('Apenas o dono pode excluir a campanha');
    }

    await this.prisma.campaign.delete({
      where: { id: campaignId },
    });
  }

  async addMember(campaignId: string, userId: string, dto: CampaignMemberDto): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }

    if (campaign.ownerId !== userId) {
      throw new ForbiddenException('Apenas o dono pode adicionar membros');
    }

    const existingMember = await this.prisma.campaignMember.findUnique({
      where: {
        campaignId_userId: {
          campaignId,
          userId: dto.userId,
        },
      },
    });

    if (existingMember) {
      throw new ForbiddenException('Este usuário já é membro da campanha');
    }

    await this.prisma.campaignMember.create({
      data: {
        campaignId,
        userId: dto.userId,
        role: dto.role || 'PLAYER',
      },
    });
  }

  async removeMember(campaignId: string, userId: string, targetUserId: string): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }

    if (campaign.ownerId !== userId && userId !== targetUserId) {
      throw new ForbiddenException('Apenas o dono pode remover membros');
    }

    await this.prisma.campaignMember.delete({
      where: {
        campaignId_userId: {
          campaignId,
          userId: targetUserId,
        },
      },
    });
  }

  async generateInviteLink(campaignId: string, userId: string, dto: GenerateInviteLinkDto): Promise<string> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }

    if (campaign.ownerId !== userId) {
      throw new ForbiddenException('Apenas o dono pode gerar links de convite');
    }

    const inviteCode = randomBytes(8).toString('hex');
    const expiryHours = dto.expiryHours || 24;
    const inviteExpiry = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        inviteCode,
        inviteExpiry,
      },
    });

    return inviteCode;
  }

  async acceptInvite(inviteCode: string, userId: string): Promise<CampaignDto> {
    const campaign = await this.prisma.campaign.findFirst({
      where: {
        inviteCode,
        inviteExpiry: {
          gt: new Date(),
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Convite inválido ou expirado');
    }

    const existingMember = await this.prisma.campaignMember.findUnique({
      where: {
        campaignId_userId: {
          campaignId: campaign.id,
          userId,
        },
      },
    });

    if (existingMember) {
      throw new ForbiddenException('Você já é membro desta campanha');
    }

    await this.prisma.campaignMember.create({
      data: {
        campaignId: campaign.id,
        userId,
        role: 'PLAYER',
      },
    });

    const updated = await this.prisma.campaign.findUnique({
      where: { id: campaign.id },
      include: {
        _count: {
          select: {
            members: true,
            rooms: true,
            sessions: true,
          },
        },
      },
    });

    return this.mapToCampaignDto(updated!, updated!._count);
  }

  async createSession(userId: string, dto: CreateGameSessionDto): Promise<GameSessionDto> {
    const room = await this.prisma.room.findUnique({
      where: { id: dto.roomId },
    });

    if (!room) {
      throw new NotFoundException('Sala não encontrada');
    }

    if (room.ownerId !== userId) {
      throw new ForbiddenException('Apenas o dono da sala pode criar sessões');
    }

    if (dto.campaignId) {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: dto.campaignId },
      });

      if (!campaign) {
        throw new NotFoundException('Campanha não encontrada');
      }

      if (campaign.ownerId !== userId) {
        throw new ForbiddenException('Apenas o dono da campanha pode vincular sessões');
      }
    }

    const session = await this.prisma.gameSession.create({
      data: {
        roomId: dto.roomId,
        campaignId: dto.campaignId,
        name: dto.name,
        description: dto.description,
      },
    });

    return this.mapToGameSessionDto(session);
  }

  async updateSession(sessionId: string, userId: string, dto: UpdateGameSessionDto): Promise<GameSessionDto> {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      include: {
        room: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Sessão não encontrada');
    }

    if (session.room.ownerId !== userId) {
      throw new ForbiddenException('Apenas o dono da sala pode editar sessões');
    }

    const updated = await this.prisma.gameSession.update({
      where: { id: sessionId },
      data: { name: dto.name, description: dto.description, notes: dto.notes, endedAt: dto.endedAt },
    });

    return this.mapToGameSessionDto(updated);
  }

  async getSessionsByCampaign(campaignId: string, userId: string): Promise<GameSessionDto[]> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { members: { select: { userId: true } } },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }

    const hasAccess = campaign.ownerId === userId || campaign.members.some(m => m.userId === userId);
    if (!hasAccess) {
      throw new ForbiddenException('Você não tem acesso a esta campanha');
    }

    const sessions = await this.prisma.gameSession.findMany({
      where: { campaignId },
      orderBy: { startedAt: 'desc' },
    });

    return sessions.map(s => this.mapToGameSessionDto(s));
  }

  private mapToCampaignDto(campaign: any, counts?: any): CampaignDto {
    return {
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      status: campaign.status,
      ownerId: campaign.ownerId,
      inviteCode: campaign.inviteCode,
      inviteExpiry: campaign.inviteExpiry,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      memberCount: counts?.members || 0,
      roomCount: counts?.rooms || 0,
      sessionCount: counts?.sessions || 0,
    };
  }

  private mapToCampaignDetailDto(campaign: any): CampaignDetailDto {
    return {
      ...this.mapToCampaignDto(campaign),
      members: campaign.members.map((m: any) => ({
        userId: m.userId,
        userName: m.user?.name || m.user?.email,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      rooms: campaign.rooms,
      sessions: campaign.sessions.map((s: any) => ({
        id: s.id,
        name: s.name,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        participantCount: s.participantCount,
      })),
    };
  }

  private mapToGameSessionDto(session: any): GameSessionDto {
    return {
      id: session.id,
      roomId: session.roomId,
      campaignId: session.campaignId,
      name: session.name,
      description: session.description,
      notes: session.notes,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      participantCount: session.participantCount,
    };
  }
}
