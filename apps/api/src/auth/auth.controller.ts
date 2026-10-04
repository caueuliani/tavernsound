// apps/api/src/auth/auth.controller.ts

import { Controller, Get, Post, Body, HttpException, HttpStatus, Headers, Req, Header } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from './session.service';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { credentials } from './credentials.util';
import { requireTester } from '../safety/test-policy';

@Controller('auth')
export class AuthController {
  constructor(private prisma: PrismaService, private sessions: SessionService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  async me(@Req() req: Request) {
    const session = await this.sessions.require(req.headers.cookie);
    return { user: { id: session.id, name: session.name, email: session.email } };
  }

  @Post('logout')
  async logout(@Req() req: Request) {
    await this.sessions.revoke(req.headers.cookie);
    return { success: true };
  }

  @Post('register')
  async register(
    @Body() body: { email: string; password: string; name?: string },
  ) {
    const { email, password, name } = credentials(body, true);
    requireTester(email);

    if (!email || !password) {
      throw new HttpException(
        'Email e senha são obrigatórios',
        HttpStatus.BAD_REQUEST,
      );
    }

    const existingUser = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    if (existingUser) {
      throw new HttpException('Email já cadastrado', HttpStatus.BAD_REQUEST);
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        email,
        name: name || email.split('@')[0],
        passwordHash,
        subscription: {
          create: {
            tier: 'FREE',
            status: 'ACTIVE',
          },
        },
      },
      include: {
        subscription: true,
      },
    });

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        subscription: user.subscription,
      },
    };
  }

  @Post('login')
  @Header('Cache-Control', 'no-store')
  async login(@Body() body: { email: string; password: string }) {
    const { email, password } = credentials(body);
    requireTester(email);

    if (!email || !password) {
      throw new HttpException(
        'Email e senha são obrigatórios',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { subscription: true },
    });

    if (!user || !user.passwordHash) {
      throw new HttpException(
        'Email ou senha incorretos',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new HttpException(
        'Email ou senha incorretos',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return {
      success: true,
      sessionToken: await this.sessions.create(user.id),
      user: { id: user.id, email: user.email, name: user.name, subscription: user.subscription },
    };
  }

  @Post('google-login')
  @Header('Cache-Control', 'no-store')
  async googleLogin(
    @Body() body: { email: string; name?: string; avatarUrl?: string; providerAccountId?: string },
    @Headers('x-internal-secret') internalSecret: string,
  ) {
    const expected = process.env.INTERNAL_API_SECRET;
    if (!expected || internalSecret !== expected) {
      throw new HttpException('Não autorizado', HttpStatus.UNAUTHORIZED);
    }

    const { email, name, avatarUrl, providerAccountId } = body;
    requireTester(email);

    if (!email || typeof providerAccountId !== 'string' || !providerAccountId) {
      throw new HttpException('Email é obrigatório', HttpStatus.BAD_REQUEST);
    }

    const account = await this.prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: 'google', providerAccountId } },
      include: { user: { include: { subscription: true } } },
    });
    let user = account?.user ?? await this.prisma.user.findUnique({
      where: { email }, include: { subscription: true },
    });

    if (!account && user?.passwordHash) {
      throw new HttpException('Entre com a senha desta conta. Vinculação Google deve ser explícita.', HttpStatus.CONFLICT);
    }

    if (!user) {
      // Cria novo usuário via Google
      user = await this.prisma.user.create({
        data: {
          email,
          name: name || email.split('@')[0],
          avatarUrl,
          accounts: { create: { type: 'oauth', provider: 'google', providerAccountId } },
          subscription: {
            create: {
              tier: 'FREE',
              status: 'ACTIVE',
            },
          },
        },
        include: {
          subscription: true,
        },
      });
    } else if (!account) {
      await this.prisma.account.create({ data: { userId: user.id, type: 'oauth', provider: 'google', providerAccountId } });
    }

    requireTester(user.email);

    return {
      success: true,
      sessionToken: await this.sessions.create(user.id),
      user: { id: user.id, email: user.email, name: user.name, subscription: user.subscription },
    };
  }
}
