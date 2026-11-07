import { parseDiceRequest, rollDice } from './dice.util';

describe('Authoritative dice', () => {
  it('accepts bounded supported dice', () => {
    expect(parseDiceRequest({ quantity: 2, sides: 20, modifier: -3 })).toEqual({ quantity: 2, sides: 20, modifier: -3, mode: 'normal' });
  });

  it.each([
    null, [], {}, { quantity: 0, sides: 20, modifier: 0 },
    { quantity: 31, sides: 6, modifier: 0 },
    { quantity: 1.5, sides: 6, modifier: 0 },
    { quantity: 1, sides: 999, modifier: 0 },
    { quantity: 1, sides: 20, modifier: 1001 },
    { quantity: 1, sides: 20, modifier: NaN },
    { formula: '1d20', result: 20, rolls: [20], modifier: 0 },
  ])('rejects invalid or legacy untrusted client requests: %p', invalid => {
    expect(parseDiceRequest(invalid)).toBeNull();
  });

  it('rolls two d20 on advantage and selects the highest', () => {
    const rng = jest.fn().mockReturnValueOnce(3).mockReturnValueOnce(17);
    const result = rollDice({ quantity: 1, sides: 20, modifier: 4, mode: 'advantage' }, rng);
    expect(result).toMatchObject({ rolls: [3, 17], result: 21, formula: '1d20+4 (vantagem)', mode: 'advantage' });
    expect(rng).toHaveBeenCalledTimes(2);
  });

  it('rolls two d20 on disadvantage and selects the lowest', () => {
    const rng = jest.fn().mockReturnValueOnce(18).mockReturnValueOnce(6);
    expect(rollDice({ quantity: 1, sides: 20, modifier: -1, mode: 'disadvantage' }, rng)).toMatchObject({
      rolls: [18, 6], result: 5, formula: '1d20-1 (desvantagem)',
    });
  });

  it('does not accept advantage with other dice or forged modes', () => {
    expect(parseDiceRequest({ quantity: 1, sides: 20, modifier: 0, mode: 'cheat' })).toBeNull();
    expect(parseDiceRequest({ quantity: 2, sides: 20, modifier: 0, mode: 'advantage' })).toBeNull();
    expect(parseDiceRequest({ quantity: 1, sides: 12, modifier: 0, mode: 'disadvantage' })).toBeNull();
    expect(parseDiceRequest({ quantity: 1, sides: 20, modifier: 0, mode: 'advantage' })).toMatchObject({ mode: 'advantage' });
  });

  it('calculates roll values and formatted formula from server RNG', () => {
    const random = jest.fn().mockReturnValueOnce(4).mockReturnValueOnce(7);
    expect(rollDice({ quantity: 2, sides: 20, modifier: 3 }, random)).toEqual({
      formula: '2d20+3', rolls: [4, 7], result: 14, quantity: 2, modifier: 3,
    });
    expect(random).toHaveBeenCalledTimes(2);
    expect(random).toHaveBeenCalledWith(20);
  });

  it('formats negative modifiers without trusting client results', () => {
    expect(rollDice({ quantity: 1, sides: 4, modifier: -2 }, () => 3).result).toBe(1);
    expect(rollDice({ quantity: 1, sides: 4, modifier: -2 }, () => 3).formula).toBe('1d4-2');
  });
});
