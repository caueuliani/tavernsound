import { BadRequestException } from '@nestjs/common';

export function credentials(body: unknown, registering = false) {
  if (!body || typeof body !== 'object') throw new BadRequestException('Credenciais inválidas.');
  const value = body as Record<string, unknown>;
  if (typeof value.email !== 'string' || value.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim()) ||
      typeof value.password !== 'string' || !value.password || Buffer.byteLength(value.password, 'utf8') > 72) {
    throw new BadRequestException('E-mail ou senha inválidos. A senha deve ter até 72 bytes.');
  }
  if (registering && value.password.length < 12) throw new BadRequestException('Use uma senha com pelo menos 12 caracteres.');
  if (registering && value.name !== undefined && (typeof value.name !== 'string' || value.name.length > 100)) {
    throw new BadRequestException('Nome inválido.');
  }
  return { email: value.email.trim().toLowerCase(), password: value.password, name: typeof value.name === 'string' ? value.name.trim() : undefined };
}
