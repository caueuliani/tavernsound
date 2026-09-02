export interface RoomData {
  id: string
  name: string
  createdAt: Date
  maxPlayers: number
  players: Map<string, PlayerInRoom>
  tokens: TokenData[]
}

export interface PlayerInRoom {
  id: string
  name: string
  agoraUid?: string
  isHost: boolean
  connectedAt: Date
}

export interface TokenData {
  id: string
  x: number
  y: number
  color: number
  playerId: string
  playerName?: string
}