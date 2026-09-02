// apps/api/src/auth/auth.controller.ts

import { Controller, Post, Body, HttpException, HttpStatus, Headers } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Controller('auth')
export class AuthController {
  constructor(private prisma: PrismaService) {}

  @Post('register')
  async register(
    @Body() body: { email: string; password: string; name?: string },
  ) {
    const { email, password, name } = body;

    if (!email || !password) {
      throw new HttpException(
        'Email e senha são obrigatórios',
        HttpStatus.BAD_REQUEST,
      );
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
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
  async login(@Body() body: { email: string; password: string }) {
    const { email, password } = body;

    if (!email || !password) {
      throw new HttpException(
        'Email e senha são obrigatórios',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
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
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        subscription: user.subscription,
      },
    };
  }

  @Post('google-login')
  async googleLogin(
    @Body() body: { email: string; name?: string; avatarUrl?: string },
    @Headers('x-internal-secret') internalSecret: string,
  ) {
    const expected = process.env.INTERNAL_API_SECRET;
    if (!expected || internalSecret !== expected) {
      throw new HttpException('Não autorizado', HttpStatus.UNAUTHORIZED);
    }

    const { email, name, avatarUrl } = body;

    if (!email) {
      throw new HttpException('Email é obrigatório', HttpStatus.BAD_REQUEST);
    }

    // Busca ou cria usuário
    let user = await this.prisma.user.findUnique({
      where: { email },
      include: { subscription: true },
    });

    if (!user) {
      // Cria novo usuário via Google
      user = await this.prisma.user.create({
        data: {
          email,
          name: name || email.split('@')[0],
          avatarUrl,
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
    }

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
}