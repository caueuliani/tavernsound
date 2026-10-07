import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Headers,
  HttpCode,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SubscriptionService } from './subscription.service';
import { SessionService } from '../auth/session.service';

@Controller('subscriptions')
export class SubscriptionController {
  constructor(private subscriptionService: SubscriptionService, private sessions: SessionService) {}

  @Get('me')
  async getMySubscription(@Req() req: Request) {
    const session = await this.sessions.require(req.headers.cookie);
    const sub = await this.subscriptionService.getSubscription(session.id);
    return sub ?? { tier: 'FREE', status: 'ACTIVE' };
  }

  @Post('checkout')
  async createCheckout(
    @Body() body: { tier: 'BASIC' | 'PRO' | 'ENTERPRISE'; successUrl: string; cancelUrl: string },
    @Req() req: Request,
  ) {
    const session = await this.sessions.require(req.headers.cookie);
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

}
