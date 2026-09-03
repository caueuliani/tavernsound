export interface AudioPosition {
  x: number;
  y: number;
  z?: number;
  forwardX?: number;
  forwardY?: number;
  forwardZ?: number;
}

export interface SpatialAudioSettings {
  maxDistance: number; // Distância máxima do áudio em pixels/unidades
  attenuationFactor: number; // Fator de atenuação por distância
  wallOcclusionFactor: number; // Porcentagem de atenuação causada por parede/porta fechada
}

export interface WallData {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isDoor?: boolean;
  isOpen?: boolean;
  blocksAudio?: boolean;
}

export interface PlayerInRoom {
  id: string;
  name: string;
  agoraUid?: string;
  isHost: boolean;
  connectedAt: Date;
  audioPosition?: AudioPosition;
  isMuted?: boolean;
  isDeafened?: boolean;
  isSpeaking?: boolean;
}

export interface TokenData {
  id: string;
  x: number;
  y: number;
  color: number;
  playerId: string;
  playerName?: string;
  hp?: number;
  maxHp?: number;
  imageUrl?: string;
  audioEmitter?: boolean; // Se o token emite um som ambiental/efeito
  audioUrl?: string;
}

export interface RoomData {
  id: string;
  name: string;
  createdAt: Date;
  maxPlayers: number;
  players: Map<string, PlayerInRoom>;
  tokens: TokenData[];
  walls?: WallData[];
  spatialAudioSettings?: SpatialAudioSettings;
}
