import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import type { Request, Response, NextFunction } from 'express';
import { allowedMutationOrigin } from './common/origin.util';

async function bootstrap() {
  // rawBody: true makes req.rawBody available for Stripe webhook signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        !allowedMutationOrigin(req.headers.origin, req.headers['sec-fetch-site'] as string | undefined)) {
      res.status(403).json({ message: 'Origem não autorizada.' });
      return;
    }
    next();
  });
  
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  const prisma = app.get(PrismaService);
  const userCount = await prisma.user.count();
  console.log(`📊 Total de usuários no banco: ${userCount}`);
  

  
  // Muda para porta 3001
  const port = Number(process.env.PORT || 3001);
  app.enableShutdownHooks();
  await app.listen(port, process.env.API_BIND_HOST || '0.0.0.0');
  console.log(`🚀 API rodando na porta ${port}`);
}
bootstrap();
