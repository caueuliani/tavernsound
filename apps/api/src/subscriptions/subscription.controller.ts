import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Headers,
  HttpCode,
  RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { SubscriptionService } from './subscription.service';
import { verifySession } from '../common/session.util';

@Controller('subscriptions')
export class SubscriptionController {
  constructor(private subscriptionService: SubscriptionService) {}

  @Get('me')
  async getMySubscription(@Req() req: Request) {
    const session = this.parseSessionCookie(req as any);
    if (!session?.id) return { tier: 'FREE', status: 'ACTIVE' };
    const sub = await this.subscriptionService.getSubscription(session.id);
    return sub ?? { tier: 'FREE', status: 'ACTIVE' };
  }

  @Post('checkout')
  async createCheckout(
    @Body() body: { tier: 'BASIC' | 'PRO' | 'ENTERPRISE'; successUrl: string; cancelUrl: string },
    @Req() req: Request,
  ) {
    const session = this.parseSessionCookie(req);
    if (!session?.id) {
      return { error: 'Não autenticado. Faça login para assinar.' };
    }
    const url = await this.subscriptionService.createCheckoutSession(
      session.id,
      body.tier,
      body.successUrl,
      body.cancelUrl,
    );
    return { url };
  }

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    await this.subscriptionService.handleWebhook(req.rawBody!, signature);
    return { received: true };
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
