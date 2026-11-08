import { Controller, Get, Query, Req, Header, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';
import { SessionService } from '../auth/session.service';
import { RoomAccessService } from './room-access.service';
import { TestSafetyService } from '../safety/test-safety.service';
import { sceneMediaChannel } from './scene-media.util';

@Controller('agora')
export class GameController {
  constructor(private sessions: SessionService, private access: RoomAccessService, private safety: TestSafetyService) {}

  @Get('token')
  @Header('Cache-Control', 'no-store')
  async generateToken(
    @Query('channelName') channelName: string,
    @Req() req: Request,
    @Query('sceneId') sceneId?: string,
  ) {
    const session = await this.sessions.require(req.headers.cookie);
    if (sceneId !== undefined) {
      await this.access.requireSceneMedia(channelName, session.id, sceneId);
    } else {
      await this.access.requireLegacyMedia(channelName, session.id);
    }
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appId || !appCertificate) {
      throw new ServiceUnavailableException('Voz ainda não configurada.');
    }

    const testDeadline = await this.safety.voiceDeadline(channelName, session.id, session.sid);
    const uid = this.sessions.voiceUid(session);

    const role = RtcRole.PUBLISHER;
    const expirationTimeInSeconds = 300;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = Math.min(session.exp, currentTimestamp + expirationTimeInSeconds, testDeadline);

    const rtcChannel = sceneId === undefined ? channelName : sceneMediaChannel(channelName, sceneId);
    const token = RtcTokenBuilder.buildTokenWithAccount(
      appId,
      appCertificate,
      rtcChannel,
      uid,
      role,
      privilegeExpiredTs,
    );

    return { token, uid, expiresAt: privilegeExpiredTs, channelName: rtcChannel };
  }
}
