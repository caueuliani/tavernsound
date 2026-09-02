import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { GameModule } from './game/game.module';
import { AuthModule } from './auth/auth.module';
import { SubscriptionModule } from './subscriptions/subscription.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    GameModule,
    SubscriptionModule,
  ],
  controllers: [AppController],
})
export class AppModule {}