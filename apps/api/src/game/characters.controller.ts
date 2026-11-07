import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CharactersService } from './characters.service';

@Controller('campaigns/:campaignId/characters')
@UseGuards(SessionAuthGuard)
export class CharactersController {
  constructor(private readonly characters: CharactersService) {}

  @Get()
  list(@Param('campaignId') campaignId: string, @Req() req: Request & { user: { id: string } }) {
    return this.characters.list(campaignId, req.user.id);
  }

  @Post()
  create(
    @Param('campaignId') campaignId: string,
    @Req() req: Request & { user: { id: string } },
    @Body() body: { name: unknown; sheet: unknown },
  ) {
    return this.characters.create(campaignId, req.user.id, body);
  }

  @Patch(':characterId')
  update(
    @Param('campaignId') campaignId: string,
    @Param('characterId') characterId: string,
    @Req() req: Request & { user: { id: string } },
    @Body() body: { name?: unknown; sheet?: unknown; revision?: unknown },
  ) {
    return this.characters.update(campaignId, characterId, req.user.id, body);
  }
}
