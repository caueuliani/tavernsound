// apps/api/src/prisma/prisma.module.ts

import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // Torna disponível em todo o app
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}