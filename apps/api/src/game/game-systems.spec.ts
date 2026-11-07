import { gameSystemId, listGameSystems } from './game-systems';

describe('Game system registry', () => {
  it('keeps existing campaigns on generic rules', () => {
    expect(gameSystemId(undefined)).toBe('generic');
    expect(gameSystemId(null)).toBe('generic');
  });
  it('exposes a stable versioned D&D 5e 2014 identifier', () => {
    expect(gameSystemId('dnd5e-2014-srd51')).toBe('dnd5e-2014-srd51');
    expect(listGameSystems()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'generic' }),
      expect.objectContaining({ id: 'dnd5e-2014-srd51' }),
    ]));
  });
  it('rejects unknown or non-string system identifiers', () => {
    expect(() => gameSystemId('dnd5e-2024')).toThrow('não suportado');
    expect(() => gameSystemId({ id: 'generic' })).toThrow('não suportado');
  });
});
