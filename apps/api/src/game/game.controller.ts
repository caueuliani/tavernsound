import { Controller, Get, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';
import { verifySession } from '../common/session.util';

@Controller('agora')
export class GameController {
  @Get('token')
  generateToken(
    @Query('channelName') channelName: string,
    @Query('uid') uid: string,
    @Req() req: Request,
  ) {
    const session = this.parseSessionCookie(req);
    if (!session?.id) {
      return { error: 'Não autenticado. Faça login para obter um token de voz.' };
    }

    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appId || !appCertificate) {
      return { error: 'Agora credentials not configured' };
    }

    const role = RtcRole.PUBLISHER;
    const expirationTimeInSeconds = 3600; // 1 hora
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      parseInt(uid),
      role,
      privilegeExpiredTs,
    );

    return { token, uid };
  }

  private parseSessionCookie(req: Request): { id: string; name: string; email: string } | null {
    const cookieHeader = req.headers?.cookie || '';
    for (const part of cookieHeader.split(';')) {
      const eqIndex = part.indexOf('=');
      if (eqIndex === -1) continue;
      const key = part.slice(0, eqIndex).trim();
      if (key !== 'user-session') continue;
      try {
        const raw = decodeURIComponent(part.slice(eqIndex + 1).trim());
        const parsed = verifySession(raw);
        if (parsed?.id) return parsed as { id: string; name: string; email: string };
      } catch { return null; }
    }
    return null;
  }
}