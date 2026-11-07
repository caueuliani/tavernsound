export const AMBIENT_PRESETS = ['off', 'rain', 'wind', 'fire', 'beach', 'tavern', 'forest', 'dungeon', 'combat'] as const;

export type AmbientPreset = typeof AMBIENT_PRESETS[number];

export function validAmbientPreset(value: unknown): value is AmbientPreset {
  return typeof value === 'string' && (AMBIENT_PRESETS as readonly string[]).includes(value);
}
