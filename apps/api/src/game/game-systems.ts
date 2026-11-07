import { BadRequestException } from '@nestjs/common';

// Keep versioned IDs stable: character sheets and compendia will depend on them.
export const GAME_SYSTEMS = {
  GENERIC: { id: 'generic', name: 'Sistema genérico', version: '1' },
  DND_5E_2014: { id: 'dnd5e-2014-srd51', name: '5E 2014 (SRD 5.1)', version: '1' },
} as const;

export type GameSystemId = typeof GAME_SYSTEMS[keyof typeof GAME_SYSTEMS]['id'];

export function gameSystemId(value: unknown, fallback: GameSystemId = 'generic'): GameSystemId {
  if (value === undefined || value === null) return fallback;
  if (value === GAME_SYSTEMS.GENERIC.id || value === GAME_SYSTEMS.DND_5E_2014.id) return value;
  throw new BadRequestException('Sistema de RPG não suportado.');
}

export function listGameSystems() {
  return Object.values(GAME_SYSTEMS);
}
