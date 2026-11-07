import { randomInt } from 'crypto';

export const ALLOWED_DICE = new Set([4, 6, 8, 10, 12, 20, 100]);

export interface DiceRequest {
  quantity: number;
  sides: number;
  modifier: number;
  mode?: 'normal' | 'advantage' | 'disadvantage';
}

export function parseDiceRequest(input: unknown): DiceRequest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  const { quantity, sides, modifier } = data;
  const mode = data.mode === undefined ? 'normal' : data.mode;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 30) return null;
  if (typeof sides !== 'number' || !ALLOWED_DICE.has(sides)) return null;
  if (typeof modifier !== 'number' || !Number.isInteger(modifier) || modifier < -1000 || modifier > 1000) return null;
  if (mode !== 'normal' && mode !== 'advantage' && mode !== 'disadvantage') return null;
  if (mode !== 'normal' && (quantity !== 1 || sides !== 20)) return null;
  return { quantity, sides, modifier, mode };
}

export function rollDice(request: DiceRequest, rng: (upper: number) => number = upper => randomInt(1, upper + 1)) {
  const mode = request.mode ?? 'normal';
  const rolls = Array.from({ length: mode === 'normal' ? request.quantity : 2 }, () => rng(request.sides));
  const chosen = mode === 'advantage' ? Math.max(...rolls) :
    mode === 'disadvantage' ? Math.min(...rolls) :
    rolls.reduce((total, roll) => total + roll, 0);
  const result = chosen + request.modifier;
  const basic = `${request.quantity}d${request.sides}${request.modifier ? request.modifier > 0 ? '+' + request.modifier : request.modifier : ''}`;
  const formula = basic + (mode === 'advantage' ? ' (vantagem)' : mode === 'disadvantage' ? ' (desvantagem)' : '');
  return { formula, rolls, result, modifier: request.modifier, quantity: request.quantity, mode };
}
