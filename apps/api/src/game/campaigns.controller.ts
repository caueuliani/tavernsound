import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import type {
  CreateCampaignDto,
  UpdateCampaignDto,
  CampaignMemberDto,
  GenerateInviteLinkDto,
  CreateGameSessionDto,
  UpdateGameSessionDto,
} from './dto/campaign.dto';
import { SessionAuthGuard } from '../auth/session-auth.guard';

@Controller('campaigns')
@UseGuards(SessionAuthGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  async create(@Request() req, @Body() dto: CreateCampaignDto) {
    return this.campaignsService.createCampaign(req.user.id, dto);
  }

  @Get()
  async findAll(@Request() req) {
    return this.campaignsService.getCampaigns(req.user.id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req) {
    return this.campaignsService.getCampaignById(id, req.user.id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Request() req, @Body() dto: UpdateCampaignDto) {
    return this.campaignsService.updateCampaign(id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @Request() req) {
    await this.campaignsService.deleteCampaign(id, req.user.id);
  }

  @Post(':id/members')
  async addMember(@Param('id') id: string, @Request() req, @Body() dto: CampaignMemberDto) {
    await this.campaignsService.addMember(id, req.user.id, dto);
    return { success: true };
  }

  @Delete(':id/members/:userId')
  async removeMember(@Param('id') id: string, @Param('userId') userId: string, @Request() req) {
    await this.campaignsService.removeMember(id, req.user.id, userId);
    return { success: true };
  }

  @Post(':id/invite')
  async generateInvite(@Param('id') id: string, @Request() req, @Body() dto: GenerateInviteLinkDto) {
    const inviteCode = await this.campaignsService.generateInviteLink(id, req.user.id, dto);
    return { inviteCode, inviteUrl: `/campaigns/join/${inviteCode}` };
  }

  @Post('join/:inviteCode')
  async acceptInvite(@Param('inviteCode') inviteCode: string, @Request() req) {
    return this.campaignsService.acceptInvite(inviteCode, req.user.id);
  }

  @Post('sessions')
  async createSession(@Request() req, @Body() dto: CreateGameSessionDto) {
    return this.campaignsService.createSession(req.user.id, dto);
  }

  @Put('sessions/:id')
  async updateSession(@Param('id') id: string, @Request() req, @Body() dto: UpdateGameSessionDto) {
    return this.campaignsService.updateSession(id, req.user.id, dto);
  }

  @Get(':id/sessions')
  async getSessions(@Param('id') id: string, @Request() req) {
    return this.campaignsService.getSessionsByCampaign(id, req.user.id);
  }
}
