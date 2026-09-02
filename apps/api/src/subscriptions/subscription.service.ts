import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubscriptionService {
  private stripe: Stripe;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY') || 'sk_test_placeholder');
  }

  async createCheckoutSession(
    userId: string,
    tier: 'BASIC' | 'PRO' | 'ENTERPRISE',
    successUrl: string,
    cancelUrl: string,
  ): Promise<string> {
    // Lido aqui (runtime) para garantir que o ConfigModule já processou o .env
    const priceId = this.config.get<string>(`STRIPE_PRICE_${tier}`) || '';
    if (!priceId) {
      throw new BadRequestException(`Plano inválido ou não configurado — defina STRIPE_PRICE_${tier}`);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });
    if (!user) throw new BadRequestException('Usuário não encontrado');

    let customerId = user.subscription?.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: user.email,
        name: user.name ?? undefined,
        metadata: { userId },
      });
      customerId = customer.id;
      // Persist customer ID before checkout so webhook can look it up
      if (user.subscription) {
        await this.prisma.subscription.update({
          where: { userId },
          data: { stripeCustomerId: customerId },
        });
      } else {
        await this.prisma.subscription.create({
          data: { userId, stripeCustomerId: customerId, tier: 'FREE', status: 'ACTIVE' },
        });
      }
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId, tier },
    });

    return session.url!;
  }

  async getSubscription(userId: string): Promise<{ tier: string; status: string } | null> {
    return this.prisma.subscription.findUnique({
      where: { userId },
      select: { tier: true, status: true },
    });
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException('Assinatura de webhook inválida');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const tier = session.metadata?.tier;
      const customerId = typeof session.customer === 'string' ? session.customer : null;
      const stripeSubId = typeof session.subscription === 'string' ? session.subscription : null;

      if (userId && tier && customerId && stripeSubId) {
        await this.prisma.subscription.upsert({
          where: { userId },
          create: {
            userId,
            tier: tier as any,
            status: 'ACTIVE',
            stripeCustomerId: customerId,
            stripeSubscriptionId: stripeSubId,
          },
          update: {
            tier: tier as any,
            status: 'ACTIVE',
            stripeCustomerId: customerId,
            stripeSubscriptionId: stripeSubId,
          },
        });
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === 'string' ? sub.customer : null;
      if (customerId) {
        await this.prisma.subscription.updateMany({
          where: { stripeCustomerId: customerId },
          data: { tier: 'FREE', status: 'CANCELED' },
        });
      }
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === 'string' ? sub.customer : null;
      if (customerId) {
        const status = sub.status === 'active' ? 'ACTIVE' : sub.status === 'past_due' ? 'PAST_DUE' : 'CANCELED';
        await this.prisma.subscription.updateMany({
          where: { stripeCustomerId: customerId },
          data: { status: status as any },
        });
      }
    }
  }
}
