import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type SheetInput = Record<string, unknown>;

function validSheet(input: unknown): SheetInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Ficha deve ser um objeto JSON.');
  }
  const sheet = input as SheetInput;
  const serialized = JSON.stringify(sheet);
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > 32 * 1024) {
    throw new BadRequestException('Ficha maior que 32 KiB.');
  }
  if (typeof sheet.level !== 'number' || !Number.isInteger(sheet.level) || sheet.level < 1 || sheet.level > 20) {
    throw new BadRequestException('Nível inválido (1 a 20).');
  }
  const attrs = sheet.abilities as Record<string, unknown> | undefined;
  const keys = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs) ||
      Object.keys(attrs).length !== 6 ||
      !keys.every(k => typeof attrs[k] === 'number' && Number.isInteger(attrs[k]) &&
        (attrs[k] as number) >= 1 && (attrs[k] as number) <= 30)) {
    throw new BadRequestException('Informe seis atributos válidos (1 a 30).');
  }
  return sheet;
}

function validName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
    throw new BadRequestException('Nome deve conter entre 1 e 80 caracteres.');
  }
  return name.trim();
}

@Injectable()
export class CharactersService {
  constructor(private readonly prisma: PrismaService) {}

  private async campaignAccess(campaignId: string, actorId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { members: { select: { userId: true } } },
    });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    if (campaign.ownerId !== actorId && !campaign.members.some(m => m.userId === actorId)) {
      throw new ForbiddenException('Sem acesso à campanha.');
    }
    return campaign;
  }

  async list(campaignId: string, actorId: string) {
    await this.campaignAccess(campaignId, actorId);
    return this.prisma.character.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(campaignId: string, actorId: string, body: { name?: unknown; sheet?: unknown }) {
    const campaign = await this.campaignAccess(campaignId, actorId);
    if (campaign.gameSystemId !== 'dnd5e-2014-srd51') {
      throw new BadRequestException('Esta campanha não utiliza D&D 5e 2014.');
    }
    const name = validName(body?.name);
    const sheet = validSheet(body?.sheet);
    return this.prisma.character.create({
      data: { campaignId, userId: actorId, name, gameSystemId: campaign.gameSystemId, sheet: sheet as any },
    });
  }

  async update(
    campaignId: string,
    characterId: string,
    actorId: string,
    body: { name?: unknown; sheet?: unknown; revision?: unknown },
  ) {
    const campaign = await this.campaignAccess(campaignId, actorId);
    const character = await this.prisma.character.findFirst({ where: { id: characterId, campaignId } });
    if (!character) throw new NotFoundException('Personagem não encontrado.');
    if (character.userId !== actorId && campaign.ownerId !== actorId) {
      throw new ForbiddenException('Apenas o jogador ou mestre pode editar esta ficha.');
    }
    if (!Number.isInteger(body?.revision) || body.revision !== character.revision) {
      throw new ConflictException('Ficha desatualizada. Recarregue antes de salvar.');
    }
    if (body.name === undefined && body.sheet === undefined) {
      throw new BadRequestException('Nenhuma alteração enviada.');
    }
    const data: { name?: string; sheet?: any; revision: { increment: number } } = {
      revision: { increment: 1 },
    };
    if (body.name !== undefined) data.name = validName(body.name);
    if (body.sheet !== undefined) data.sheet = validSheet(body.sheet);
    const changed = await this.prisma.character.updateMany({
      where: { id: characterId, campaignId, revision: character.revision },
      data,
    });
    if (changed.count !== 1) throw new ConflictException('Ficha alterada por outra conexão.');
    return this.prisma.character.findUniqueOrThrow({ where: { id: characterId } });
  }
}
