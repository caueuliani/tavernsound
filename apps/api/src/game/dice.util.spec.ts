import { parseDiceRequest, rollDice } from './dice.util';

describe('Authoritative dice', () => {
  it('accepts bounded supported dice', () => {
    expect(parseDiceRequest({ quantity: 2, sides: 20, modifier: -3 })).toEqual({ quantity: 2, sides: 20, modifier: -3 });
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
