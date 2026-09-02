import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  // rawBody: true makes req.rawBody available for Stripe webhook signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });
  
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  const prisma = app.get(PrismaService);
  const userCount = await prisma.user.count();
  console.log(`📊 Total de usuários no banco: ${userCount}`);
  

  
  // Muda para porta 3001
  await app.listen(3001);
  console.log('🚀 API rodando em http://localhost:3001');
}
bootstrap();