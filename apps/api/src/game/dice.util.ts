import { randomInt } from 'crypto';

export const ALLOWED_DICE = new Set([4, 6, 8, 10, 12, 20, 100]);

export interface DiceRequest {
  quantity: number;
  sides: number;
  modifier: number;
}

export function parseDiceRequest(input: unknown): DiceRequest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  const { quantity, sides, modifier } = data;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 30) return null;
  if (typeof sides !== 'number' || !ALLOWED_DICE.has(sides)) return null;
  if (typeof modifier !== 'number' || !Number.isInteger(modifier) || modifier < -1000 || modifier > 1000) return null;
  return { quantity, sides, modifier };
}

export function rollDice(request: DiceRequest, rng: (upper: number) => number = upper => randomInt(1, upper + 1)) {
  const rolls = Array.from({ length: request.quantity }, () => rng(request.sides));
  const result = rolls.reduce((total, roll) => total + roll, request.modifier);
  const formula = `${request.quantity}d${request.sides}${request.modifier ? request.modifier > 0 ? '+' + request.modifier : request.modifier : ''}`;
  return { formula, rolls, result, modifier: request.modifier, quantity: request.quantity };
}
