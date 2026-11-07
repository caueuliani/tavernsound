/**
 * D&D fifth edition 2014-compatible arithmetic primitives (SRD 5.1).
 * Rules/content are versioned independently of the VTT core.
 * This module provides mechanics only; it is not a reproduction of copyrighted books.
 */
export const ABILITY_KEYS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const;
export type AbilityKey = typeof ABILITY_KEYS[number];

export type AbilityScores = Record<AbilityKey, number>;
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

export const SKILLS: Readonly<Record<string, AbilityKey>> = Object.freeze({
  acrobatics: 'DEX',
  animalHandling: 'WIS',
  arcana: 'INT',
  athletics: 'STR',
  deception: 'CHA',
  history: 'INT',
  insight: 'WIS',
  intimidation: 'CHA',
  investigation: 'INT',
  medicine: 'WIS',
  nature: 'INT',
  perception: 'WIS',
  performance: 'CHA',
  persuasion: 'CHA',
  religion: 'INT',
  sleightOfHand: 'DEX',
  stealth: 'DEX',
  survival: 'WIS',
});

export function abilityModifier(score: number): number {
  if (!Number.isInteger(score) || score < 1 || score > 30) throw new RangeError('Ability score must be 1..30');
  return Math.floor((score - 10) / 2);
}

export function proficiencyBonus(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) throw new RangeError('Level must be 1..20');
  return Math.floor((level - 1) / 4) + 2;
}

export function checkBonus(score: number, level: number, proficiency: 0 | 1 | 2 = 0): number {
  if (![0, 1, 2].includes(proficiency)) throw new RangeError('Invalid proficiency level');
  return abilityModifier(score) + proficiency * proficiencyBonus(level);
}

export function skillBonus(scores: AbilityScores, level: number, skill: string, proficiency: 0 | 1 | 2 = 0): number {
  const ability = SKILLS[skill];
  if (!ability) throw new RangeError('Unknown skill');
  return checkBonus(scores[ability], level, proficiency);
}

export function passiveScore(bonus: number): number {
  if (!Number.isInteger(bonus) || bonus < -50 || bonus > 100) throw new RangeError('Invalid skill bonus');
  return 10 + bonus;
}

export function initiativeModifier(scores: AbilityScores): number {
  return abilityModifier(scores.DEX);
}

export function validateAbilityScores(scores: unknown): scores is AbilityScores {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return false;
  const record = scores as Record<string, unknown>;
  return Object.keys(record).length === ABILITY_KEYS.length &&
    ABILITY_KEYS.every(key => typeof record[key] === 'number' &&
      Number.isInteger(record[key]) && (record[key] as number) >= 1 && (record[key] as number) <= 30);
}
