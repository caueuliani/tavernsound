import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { verifySession } from '../common/session.util';
import { AudioPosition, SpatialAudioSettings, WallData } from './dto/room.dto';

interface TokenData {
  id: string;
  x: number;
  y: number;
  color: number;
  playerId: string;
  playerName?: string;
  hp?: number;
  maxHp?: number;
  imageUrl?: string;
  audioEmitter?: boolean;
  audioUrl?: string;
}

interface PlayerData {
  id: string;
  tokens: TokenData[];
  agoraUid?: string;
  name?: string;
  roomId?: string;
  userId?: string;
  isHost?: boolean;
  audioPosition?: AudioPosition;
  isMuted?: boolean;
  isDeafened?: boolean;
  isSpeaking?: boolean;
}

interface RoomData {
  id: string;
  name: string;
  createdAt: Date;
  players: Map<string, PlayerData>;
  tokens: TokenData[];
  fogData?: boolean[];
  mapUrl?: string;
  ownerId?: string | null;
  walls?: WallData[];
  spatialAudioSettings?: SpatialAudioSettings;
}

@WebSocketGateway({
  cors: {
    // Função avaliada por request — lê a env var após o .env ter sido carregado
    origin: (_origin: string, cb: (err: Error | null, ok: boolean) => void) => {
      const allowed = process.env.FRONTEND_URL || 'http://localhost:3000';
      cb(null, !_origin || _origin === allowed);
    },
    credentials: true,
  },
  maxHttpBufferSize: 10 * 1024 * 1024,
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly prisma: PrismaService) {}

  private players: Map<string, PlayerData> = new Map();
  private rooms: Map<string, RoomData> = new Map();

  // Lê e verifica (HMAC) o cookie user-session do handshake do Socket.IO
  private parseSessionCookie(client: Socket): { id: string; name: string; email: string } | null {
    const cookieHeader = client.handshake.headers.cookie || '';
    for (const part of cookieHeader.split(';')) {
      const eqIndex = part.indexOf('=');
      if (eqIndex === -1) continue;
      const key = part.slice(0, eqIndex).trim();
      if (key !== 'user-session') continue;
      try {
        const raw = decodeURIComponent(part.slice(eqIndex + 1).trim());
        const parsed = verifySession(raw);
        if (parsed?.id) return parsed as { id: string; name: string; email: string };
      } catch {
        return null;
      }
    }
    return null;
  }

  handleConnection(client: Socket) {
    console.log(`🟢 Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`🔴 Cliente desconectado: ${client.id}`);

    const player = this.players.get(client.id);
    if (!player) return;

    if (player.roomId) {
      const room = this.rooms.get(player.roomId);
      if (room) {
        room.players.delete(client.id);

        client.to(player.roomId).emit('player-left', {
          playerId: client.id,
          playerName: player.name,
        });

        // Remove tokens da memória, mas NÃO do banco — o estado do mapa persiste
        const tokenIds = player.tokens.map(t => t.id);
        room.tokens = room.tokens.filter(t => t.playerId !== client.id);
        client.to(player.roomId).emit('remove-player-tokens', {
          playerId: client.id,
          tokenIds,
        });

        this.server.to(player.roomId).emit('room-player-count', {
          count: room.players.size,
        });

        if (room.players.size === 0) {
          if (player.roomId) this.rooms.delete(player.roomId);
          console.log(`💤 Sala ${player.roomId ?? 'desconhecida'} removida da memória`);
        }
      }
    }

    this.players.delete(client.id);
  }

  @SubscribeMessage('create-room')
  async handleCreateRoom(
    @MessageBody() data: { name: string; maxPlayers?: number },
    @ConnectedSocket() client: Socket,
  ) {
    const roomId = this.generateRoomId();
    const roomName = data.name || `Sala de ${client.id.slice(0, 4)}`;

    const session = this.parseSessionCookie(client);

    // FREE tier: at most 1 active room per user
    if (session?.id) {
      const sub = await this.prisma.subscription.findUnique({
        where: { userId: session.id },
        select: { tier: true, status: true },
      });

      // Se a assinatura não estiver ativa, retrocede para o tier FREE
      const isSubActive = sub?.status === 'ACTIVE' || sub?.status === 'TRIALING';
      const tier = isSubActive ? (sub?.tier ?? 'FREE') : 'FREE';

      if (tier === 'FREE') {
        const existingCount = await this.prisma.room.count({ where: { ownerId: session.id } });
        if (existingCount >= 1) {
          client.emit('room-error', {
            message: 'Plano FREE permite apenas 1 sala ativa. Acesse /pricing para fazer upgrade.',
          });
          return null;
        }
      } else if (tier === 'BASIC') {
        const existingCount = await this.prisma.room.count({ where: { ownerId: session.id } });
        if (existingCount >= 5) {
          client.emit('room-error', {
            message: 'Plano BASIC permite até 5 salas ativas. Faça upgrade para PRO para salas ilimitadas.',
          });
          return null;
        }
      }
    }

    await this.prisma.room.create({
      data: { id: roomId, name: roomName, ownerId: session?.id ?? null },
    });

    const room: RoomData = {
      id: roomId,
      name: roomName,
      createdAt: new Date(),
      players: new Map(),
      tokens: [],
      walls: [],
      spatialAudioSettings: {
        maxDistance: 1000,
        attenuationFactor: 1,
        wallOcclusionFactor: 0.5,
      },
    };

    this.rooms.set(roomId, room);
    console.log(`🏠 Sala criada: ${roomId} - "${roomName}"`);

    return { roomId, room };
  }

  @SubscribeMessage('join-room')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    let room = this.rooms.get(data.roomId);

    // Sala não está na memória: servidor foi reiniciado, recarregar do banco
    if (!room) {
      const dbRoom = await this.prisma.room.findUnique({
        where: { id: data.roomId },
        include: { tokens: true },
      });

      if (!dbRoom) {
        client.emit('room-error', { message: 'Sala não encontrada' });
        return;
      }

      // Tokens do banco usam o próprio id como playerId para garantir chaves únicas no frontend
      const restoredTokens: TokenData[] = dbRoom.tokens.map(t => ({
        id: t.id,
        x: t.x,
        y: t.y,
        color: parseInt((t.color || '#ff9d00').replace('#', ''), 16),
        playerId: t.id,
        playerName: t.name,
        hp: t.hp ?? undefined,
        maxHp: t.maxHp ?? undefined,
        imageUrl: t.imageUrl ?? undefined,
      }));

      room = {
        id: dbRoom.id,
        name: dbRoom.name || 'Sala sem nome',
        createdAt: dbRoom.createdAt,
        players: new Map(),
        tokens: restoredTokens,
        fogData: Array.isArray(dbRoom.fogOfWarData) ? (dbRoom.fogOfWarData as boolean[]) : undefined,
        mapUrl: dbRoom.mapUrl ?? undefined,
        ownerId: dbRoom.ownerId,
        walls: [],
        spatialAudioSettings: {
          maxDistance: 1000,
          attenuationFactor: 1,
          wallOcclusionFactor: 0.5,
        },
      };

      this.rooms.set(data.roomId, room);
      console.log(`🔄 Sala ${data.roomId} restaurada do banco com ${restoredTokens.length} token(s)`);
    }

    const session = this.parseSessionCookie(client);

    let playerName: string;
    if (session?.name) {
      playerName = session.name;
    } else {
      const randomNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'];
      playerName =
        randomNames[Math.floor(Math.random() * randomNames.length)] +
        '#' +
        client.id.slice(0, 4);
    }

    const ownerId = room.ownerId;
    const isHost = ownerId ? ownerId === session?.id : room.players.size === 0;

    const PLAYER_LIMITS: Record<string, number> = { FREE: 4, BASIC: 6, PRO: 12, ENTERPRISE: 100 };
    if (ownerId) {
      const ownerSub = await this.prisma.subscription.findUnique({
        where: { userId: ownerId },
        select: { tier: true, status: true },
      });

      const isSubActive = ownerSub?.status === 'ACTIVE' || ownerSub?.status === 'TRIALING';
      const activeTier = isSubActive ? (ownerSub?.tier ?? 'FREE') : 'FREE';
      const limit = (PLAYER_LIMITS as Record<string, number>)[activeTier] || 4;

      if (room.players.size >= limit) {
        client.emit('room-error', {
          message: `Sala cheia! Limite de ${limit} jogadores para este plano.`,
        });
        return;
      }
    }

    const playerData: PlayerData = {
      id: client.id,
      tokens: [],
      name: playerName,
      roomId: data.roomId,
      userId: session?.id,
      isHost,
      audioPosition: { x: 0, y: 0, z: 0 },
      isMuted: false,
      isDeafened: false,
      isSpeaking: false,
    };

    this.players.set(client.id, playerData);
    room.players.set(client.id, playerData);
    client.join(data.roomId);

    if (session?.id) {
      this.prisma.roomMember.create({
        data: {
          roomId: data.roomId,
          userId: session.id,
          nickname: playerName,
          role: isHost ? 'HOST' : 'PLAYER',
        },
      }).catch(() => {});
    }

    const [recentRolls, chatEvents] = await Promise.all([
      this.prisma.diceRoll.findMany({
        where: { roomId: data.roomId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.event.findMany({
        where: {
          eventType: 'CHAT',
          metadata: { equals: { roomId: data.roomId } } as any,
        },
        orderBy: { timestamp: 'desc' },
        take: 50,
      }),
    ]);

    client.emit('room-joined', {
      roomId: data.roomId,
      roomName: room.name,
      playerName,
      isHost,
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        agoraUid: p.agoraUid,
        audioPosition: p.audioPosition,
        isMuted: p.isMuted,
        isDeafened: p.isDeafened,
        isSpeaking: p.isSpeaking,
      })),
      tokens: room.tokens,
      walls: room.walls ?? [],
      spatialAudioSettings: room.spatialAudioSettings,
      recentRolls: recentRolls.reverse().map(r => ({
        playerId: '',
        playerName: r.playerName,
        formula: r.diceType,
        result: r.result,
        rolls: r.rolls,
        modifier: r.modifier,
        timestamp: r.createdAt.getTime(),
      })),
      chatHistory: chatEvents.reverse().map(e => {
        const meta = e.metadata as any;
        return {
          playerName: meta?.playerName ?? 'Jogador',
          text: meta?.text ?? '',
          timestamp: e.timestamp.getTime(),
        };
      }),
      fogData: room.fogData ?? null,
      mapUrl: room.mapUrl ?? null,
    });

    client.to(data.roomId).emit('player-joined', {
      playerId: client.id,
      playerName,
      audioPosition: playerData.audioPosition,
    });

    this.server.to(data.roomId).emit('room-player-count', {
      count: room.players.size,
    });

    this.prisma.room
      .update({ where: { id: data.roomId }, data: { updatedAt: new Date() } })
      .catch(() => {});

    console.log(`👤 ${playerName} entrou na sala ${data.roomId}`);
  }

  @SubscribeMessage('update-audio-position')
  handleUpdateAudioPosition(
    @MessageBody() data: { position: AudioPosition },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId) return;

    player.audioPosition = data.position;

    client.to(player.roomId).emit('player-audio-position-updated', {
      playerId: client.id,
      position: data.position,
    });
  }

  @SubscribeMessage('toggle-audio-mute')
  handleToggleAudioMute(
    @MessageBody() data: { isMuted: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId) return;

    player.isMuted = data.isMuted;

    this.server.to(player.roomId).emit('player-audio-mute-updated', {
      playerId: client.id,
      isMuted: data.isMuted,
    });
  }

  @SubscribeMessage('toggle-audio-deafen')
  handleToggleAudioDeafen(
    @MessageBody() data: { isDeafened: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId) return;

    player.isDeafened = data.isDeafened;

    this.server.to(player.roomId).emit('player-audio-deafen-updated', {
      playerId: client.id,
      isDeafened: data.isDeafened,
    });
  }

  @SubscribeMessage('update-audio-settings')
  handleUpdateAudioSettings(
    @MessageBody() data: { settings: SpatialAudioSettings },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId || !player.isHost) return;

    const room = this.rooms.get(player.roomId);
    if (!room) return;

    room.spatialAudioSettings = data.settings;

    this.server.to(player.roomId).emit('spatial-audio-settings-updated', {
      settings: data.settings,
    });
  }

  @SubscribeMessage('sync-walls')
  handleSyncWalls(
    @MessageBody() data: { walls: WallData[] },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId || !player.isHost) return;

    const room = this.rooms.get(player.roomId);
    if (!room) return;

    room.walls = data.walls;

    this.server.to(player.roomId).emit('walls-updated', {
      walls: data.walls,
    });
  }

  @SubscribeMessage('toggle-door')
  handleToggleDoor(
    @MessageBody() data: { wallId: string; isOpen: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId) return;

    const room = this.rooms.get(player.roomId);
    if (!room || !room.walls) return;

    const wall = room.walls.find(w => w.id === data.wallId);
    if (wall && wall.isDoor) {
      wall.isOpen = data.isOpen;

      this.server.to(player.roomId).emit('door-toggled', {
        wallId: data.wallId,
        isOpen: data.isOpen,
        toggledBy: player.name,
      });
    }
  }

  @SubscribeMessage('create-token')
  async handleCreateToken(
    @MessageBody() data: {
      x: number;
      y: number;
      color: number;
      tokenId: string;
      playerName?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId) return;

    const room = this.rooms.get(player.roomId);
    if (!room) return;

    const token: TokenData = {
      id: data.tokenId,
      x: data.x,
      y: data.y,
      color: data.color,
      playerId: client.id,
      playerName: data.playerName || player.name,
    };

    player.tokens.push(token);
    room.tokens.push(token);

    await this.prisma.token.upsert({
      where: { id: data.tokenId },
      create: {
        id: data.tokenId,
        roomId: player.roomId,
        name: token.playerName || 'Token',
        x: data.x,
        y: data.y,
        color: `#${data.color.toString(16).padStart(6, '0')}`,
      },
      update: { x: data.x, y: data.y },
    });

    this.server.to(player.roomId).emit('token-created', token);
    console.log(`🎯 Token criado por ${token.playerName} em (${data.x},${data.y}) na sala ${player.roomId}`);
  }

  @SubscribeMessage('move-token')
  handleMoveToken(
    @MessageBody() data: { tokenId: string; x: number; y: number },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId) return;

    const room = this.rooms.get(player.roomId);
    if (!room) return;

    const token = player.tokens.find(t => t.id === data.tokenId);
    if (!token) return;

    token.x = data.x;
    token.y = data.y;

    const roomToken = room.tokens.find(t => t.id === data.tokenId);
    if (roomToken) {
      roomToken.x = data.x;
      roomToken.y = data.y;
    }

    // Se o token for do próprio jogador, atualizamos sua posição de áudio correspondente
    player.audioPosition = { x: data.x, y: data.y, z: 0 };

    client.to(player.roomId).emit('token-moved', {
      tokenId: data.tokenId,
      x: data.x,
      y: data.y,
      playerId: client.id,
    });

    this.prisma.token
      .update({ where: { id: data.tokenId }, data: { x: data.x, y: data.y } })
      .catch(() => {});
  }

  @SubscribeMessage('announce-agora-uid')
  handleAnnounceAgoraUid(
    @MessageBody() data: { socketId: string; agoraUid: string },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId) return;

    player.agoraUid = data.agoraUid;

    this.server.to(player.roomId).emit('agora-uid-announced', {
      socketId: client.id,
      agoraUid: data.agoraUid,
    });
  }

  @SubscribeMessage('player-speaking')
  handlePlayerSpeaking(
    @MessageBody() data: { isSpeaking: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId) return;

    player.isSpeaking = data.isSpeaking;

    client.to(player.roomId).emit('player-speaking-update', {
      playerId: client.id,
      isSpeaking: data.isSpeaking,
    });
  }

  @SubscribeMessage('roll-dice')
  handleRollDice(
    @MessageBody() data: {
      formula: string;
      result: number;
      rolls: number[];
      modifier: number;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId) return;

    const rollData = {
      playerId: client.id,
      playerName: player.name,
      formula: data.formula,
      result: data.result,
      rolls: data.rolls,
      modifier: data.modifier,
      timestamp: Date.now(),
    };

    this.server.to(player.roomId).emit('dice-rolled', rollData);

    this.prisma.diceRoll
      .create({
        data: {
          roomId: player.roomId,
          userId: player.userId ?? null,
          playerName: player.name || 'Jogador',
          diceType: data.formula,
          quantity: 1,
          modifier: data.modifier,
          result: data.result,
          rolls: data.rolls,
        },
      })
      .catch(() => {});
  }

  @SubscribeMessage('upload-map')
  handleUploadMap(
    @MessageBody() data: { mapData: string; width: number; height: number },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId) return;
    if (!player.isHost) {
      client.emit('room-error', { message: 'Apenas o host pode alterar o mapa.' });
      return;
    }

    const room = this.rooms.get(player.roomId);
    if (room) room.mapUrl = data.mapData;

    this.server.to(player.roomId).emit('map-uploaded', {
      mapData: data.mapData,
      width: data.width,
      height: data.height,
      uploadedBy: player.name,
    });

    this.prisma.room
      .update({ where: { id: player.roomId }, data: { mapUrl: data.mapData } })
      .catch(() => {});

    console.log(`🗺️ ${player.name} enviou mapa (${data.width}x${data.height}) para sala ${player.roomId}`);
  }

  @SubscribeMessage('remove-map')
  handleRemoveMap(
    @MessageBody() _data: Record<string, never>,
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId) return;
    if (!player.isHost) {
      client.emit('room-error', { message: 'Apenas o host pode remover o mapa.' });
      return;
    }

    const room = this.rooms.get(player.roomId);
    if (room) room.mapUrl = undefined;

    this.server.to(player.roomId).emit('map-removed', { removedBy: player.name });

    this.prisma.room
      .update({ where: { id: player.roomId }, data: { mapUrl: null } })
      .catch(() => {});
  }

  @SubscribeMessage('update-token-hp')
  handleUpdateTokenHp(
    @MessageBody() data: { tokenId: string; hp: number; maxHp: number },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId) return;

    const room = this.rooms.get(player.roomId);
    if (!room) return;

    const ownsToken = player.tokens.some(t => t.id === data.tokenId);
    if (!player.isHost && !ownsToken) return;

    const token = room.tokens.find(t => t.id === data.tokenId);
    if (token) {
      token.hp = data.hp;
      token.maxHp = data.maxHp;
    }

    this.server.to(player.roomId).emit('token-hp-updated', {
      tokenId: data.tokenId,
      hp: data.hp,
      maxHp: data.maxHp,
    });

    this.prisma.token
      .update({ where: { id: data.tokenId }, data: { hp: data.hp, maxHp: data.maxHp } })
      .catch(() => {});
  }

  @SubscribeMessage('update-token-image')
  handleUpdateTokenImage(
    @MessageBody() data: { tokenId: string; imageData: string },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId) return;

    const room = this.rooms.get(player.roomId);
    if (!room) return;

    const ownsToken = player.tokens.some(t => t.id === data.tokenId);
    if (!player.isHost && !ownsToken) return;

    const token = room.tokens.find(t => t.id === data.tokenId);
    if (token) token.imageUrl = data.imageData;

    this.server.to(player.roomId).emit('token-image-updated', {
      tokenId: data.tokenId,
      imageData: data.imageData,
    });

    this.prisma.token
      .update({ where: { id: data.tokenId }, data: { imageUrl: data.imageData } })
      .catch(() => {});
  }

  @SubscribeMessage('chat-message')
  handleChatMessage(
    @MessageBody() data: { text: string },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId || !data.text?.trim()) return;

    const message = {
      playerName: player.name || 'Jogador',
      text: data.text.trim().slice(0, 500),
      timestamp: Date.now(),
    };

    this.server.to(player.roomId).emit('chat-message-received', message);

    this.prisma.event
      .create({
        data: {
          eventType: 'CHAT',
          userId: player.userId ?? null,
          metadata: { roomId: player.roomId, playerName: message.playerName, text: message.text },
        },
      })
      .catch(() => {});
  }

  private generateRoomId(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }
}
