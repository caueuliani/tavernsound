import {
  ABILITY_KEYS, STANDARD_ARRAY, SKILLS,
  abilityModifier, proficiencyBonus, checkBonus, skillBonus,
  passiveScore, initiativeModifier, validateAbilityScores,
} from './rules';

const scores = { STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 };

describe('D&D 5e (2014) SRD 5.1 core math', () => {
  it('uses the official standard array and 6 ability scores', () => {
    expect(STANDARD_ARRAY).toEqual([15, 14, 13, 12, 10, 8]);
    expect(ABILITY_KEYS).toHaveLength(6);
    expect(validateAbilityScores(scores)).toBe(true);
    expect(validateAbilityScores({ ...scores, WIS: 31 })).toBe(false);
    expect(validateAbilityScores({ ...scores, OTHER: 12 })).toBe(false);
  });

  it.each([[1,-5],[8,-1],[9,-1],[10,0],[11,0],[14,2],[15,2],[20,5],[30,10]])('ability %i maps to %i', (score, expected) => {
    expect(abilityModifier(score)).toBe(expected);
  });

  it.each([[1,2],[4,2],[5,3],[8,3],[9,4],[12,4],[13,5],[16,5],[17,6],[20,6]])('level %i has +%i proficiency', (level, bonus) => {
    expect(proficiencyBonus(level)).toBe(bonus);
  });

  it('supports untrained, proficient and expertise bonuses', () => {
    expect(checkBonus(14, 5, 0)).toBe(2);
    expect(checkBonus(14, 5, 1)).toBe(5);
    expect(checkBonus(14, 5, 2)).toBe(8);
  });

  it('covers the 18 skills with correct ability mappings', () => {
    expect(Object.keys(SKILLS)).toHaveLength(18);
    expect(skillBonus(scores, 1, 'athletics', 1)).toBe(4);
    expect(skillBonus(scores, 1, 'perception', 1)).toBe(2);
    expect(skillBonus(scores, 1, 'arcana')).toBe(1);
    expect(passiveScore(skillBonus(scores, 1, 'perception', 1))).toBe(12);
    expect(initiativeModifier(scores)).toBe(2);
  });

  it('rejects invalid scores, levels, and unknown skill identifiers', () => {
    expect(() => abilityModifier(0)).toThrow();
    expect(() => proficiencyBonus(21)).toThrow();
    expect(() => checkBonus(10, 1, 3 as any)).toThrow();
    expect(() => skillBonus(scores, 1, 'fake')).toThrow();
  });
});
