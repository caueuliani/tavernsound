import { BadRequestException } from '@nestjs/common';

export const SCENERY_NAME_FALLBACK = 'Token de cenário';
const invalidCharacters = /[\u0000-\u001f\u007f]/;

export function validSceneryName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || invalidCharacters.test(name)) throw new BadRequestException('Informe um nome para o token.');
  if (name.length > 80) throw new BadRequestException('O nome deve ter no máximo 80 caracteres.');
  return name;
}

export function sceneryNameOrFallback(value: unknown): string {
  try { return validSceneryName(value); } catch { return SCENERY_NAME_FALLBACK; }
}
