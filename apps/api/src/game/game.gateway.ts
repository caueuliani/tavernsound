import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { RoomAccessService } from './room-access.service';
import { createHash, randomInt } from 'crypto';
import { AudioPosition, SpatialAudioSettings, WallData } from './dto/room.dto';
import { TestSafetyService } from '../safety/test-safety.service';
import { TEST_LIMITS } from '../safety/test-policy';

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
  creatingToken?: boolean;
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
  maxHttpBufferSize: 16 * 1024,
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  publishTokenImage(roomId: string, tokenId: string, imageData: string) {
    const token = this.rooms.get(roomId)?.tokens.find(item => item.id === tokenId);
    if (token) token.imageUrl = imageData;
    this.server.to(roomId).emit('token-image-updated', { tokenId, imageData });
  }
  closeRoom(roomId: string) {
    this.server.to(roomId).emit('room-error', { message: 'Esta sala foi excluída pelo mestre. Volte para a página inicial.' });
    this.server.in(roomId).disconnectSockets(true);
    this.rooms.delete(roomId);
  }
  publishScene(roomId: string, scene: any) {
    const room = this.rooms.get(roomId);
    if (room) room.walls = scene.walls;
    this.server.to(roomId).emit('scene-updated', scene);
  }
  @WebSocketServer()
  server: Server;

  constructor(private readonly prisma: PrismaService, private readonly sessions: SessionService, private readonly access: RoomAccessService, private readonly safety: TestSafetyService) {}

  private players: Map<string, PlayerData> = new Map();
  private rooms: Map<string, RoomData> = new Map();

  private parseSessionCookie(client: Socket) {
    return client.data.session as Awaited<ReturnType<SessionService['resolve']>>;
  }

  afterInit(server: Server) {
    server.use(async (client, next) => {
      try {
        this.safety.rate(`connect:${client.handshake.address}`, 10);
        if (this.safety.enabled && server.sockets.sockets.size >= 10) throw new Error();
        const origin = client.handshake.headers.origin;
        if (origin && origin !== (process.env.FRONTEND_URL || 'http://localhost:3000')) throw new Error();
        client.data.session = await this.sessions.require(client.handshake.headers.cookie);
        await this.safety.consumeOperation();
        next();
      } catch { next(new Error('Faça login para conectar à mesa.')); }
    });
    this.sessions.on('revoked', (sid: string) => {
      for (const client of server.sockets.sockets.values()) {
        if (client.data.session?.sid === sid) client.disconnect(true);
      }
    });
  }

  handleConnection(client: Socket) {
    const session = this.parseSessionCookie(client);
    if (!session) { client.disconnect(true); return; }
    const expiry = setTimeout(() => client.disconnect(true), Math.max(0, session.exp * 1000 - Date.now()));
    expiry.unref();
    client.once('disconnect', () => clearTimeout(expiry));
    if (this.safety.enabled) {
      client.data.lobbyTimer = setTimeout(() => {
        if (!this.players.has(client.id)) {
          client.emit('room-error', { message: 'Conexão ociosa encerrada. Atualize a página para continuar.' });
          client.disconnect(true);
        }
      }, TEST_LIMITS.lobbyMs);
      client.data.lobbyTimer.unref();
    }
    client.use(async (_packet, next) => {
      try {
        this.safety.rate(`socket-ip:${client.handshake.address}`, 60, 1000);
        this.safety.rate(`socket-user:${session.id}`, 20, 1000);
        if (this.safety.enabled && ['upload-map', 'update-token-image'].includes(_packet[0])) this.safety.requireUploads();
        await this.safety.consumeOperation();
        client.data.session = await this.sessions.require(client.handshake.headers.cookie);
        const roomId = this.players.get(client.id)?.roomId;
        if (roomId) await this.access.require(roomId, client.data.session.id);
        if (!client.connected) throw new Error('Conexão encerrada.');
        next();
      } catch (error) {
        client.emit('room-error', { message: error instanceof Error ? error.message : 'Sessão ou acesso à sala não é mais válido.' });
        client.disconnect(true);
        next(new Error('Não autorizado'));
      }
    });
    console.log(`🟢 Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    clearTimeout(client.data.lobbyTimer);
    clearTimeout(client.data.testTimer);
    clearInterval(client.data.testHeartbeat);
    // Expiring leases are the fallback if the database is temporarily unavailable.
    if (this.safety.enabled) void this.safety.release(client.id).catch(() => {});
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
        room.tokens.forEach(t => { if (t.playerId === client.id) t.playerId = t.id; });
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

    if (!session?.id) {
      client.emit('room-error', { message: 'Faça login para criar uma sala.' });
      return null;
    }

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

    try {
      await this.safety.createRoom({ id: roomId, name: String(roomName).slice(0, 100), ownerId: session.id });
    } catch (error) {
      client.emit('room-error', { message: error instanceof Error ? error.message : 'Não foi possível criar a sala.' });
      return null;
    }

    const room: RoomData = {
      id: roomId,
      name: roomName,
      createdAt: new Date(),
      players: new Map(),
      tokens: [],
      ownerId: session?.id ?? null,
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
    if (client.data.joining) return;
    client.data.joining = true;
    try { await this.joinRoom(data, client); }
    catch (error) {
      client.emit('room-error', { message: error instanceof Error ? error.message : 'Não foi possível entrar na sala.' });
      client.disconnect(true);
    } finally { client.data.joining = false; }
  }

  private async joinRoom(data: { roomId: string }, client: Socket) {
    const session = this.parseSessionCookie(client);
    if (!session?.id) {
      client.emit('room-error', { message: 'Faça login para entrar na sala.' });
      return;
    }
    if (this.players.has(client.id)) {
      client.emit('room-error', { message: 'Este cliente já entrou em uma sala.' });
      return;
    }
    try { await this.access.require(data?.roomId, session.id); }
    catch {
      client.emit('room-error', { message: 'Sala indisponível ou conta não autorizada. Peça acesso ao mestre.' });
      return;
    }
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
    const isHost = Boolean(ownerId && ownerId === session.id);

    const PLAYER_LIMITS: Record<string, number> = { FREE: 4, BASIC: 6, PRO: 12, ENTERPRISE: 100 };
    if (ownerId) {
      const ownerSub = await this.prisma.subscription.findUnique({
        where: { userId: ownerId },
        select: { tier: true, status: true },
      });

      const isSubActive = ownerSub?.status === 'ACTIVE' || ownerSub?.status === 'TRIALING';
      const activeTier = isSubActive ? (ownerSub?.tier ?? 'FREE') : 'FREE';
      const limit = this.safety.enabled ? TEST_LIMITS.participants : (PLAYER_LIMITS as Record<string, number>)[activeTier] || 4;

      if (room.players.size >= limit) {
        client.emit('room-error', {
          message: `Sala cheia! Limite de ${limit} jogadores para este plano.`,
        });
        return;
      }
    }

    await this.safety.admit(data.roomId, session.id, session.sid, client.id);
    if (this.safety.enabled) {
      if (!client.connected) { await this.safety.release(client.id); return; }
      clearTimeout(client.data.lobbyTimer);
      const stop = (message: string) => {
        client.emit('room-error', { message });
        client.disconnect(true);
      };
      let checking = false;
      client.data.testHeartbeat = setInterval(async () => {
        if (checking) return;
        checking = true;
        try {
          await this.sessions.require(client.handshake.headers.cookie);
          await this.access.require(data.roomId, session.id);
          await this.safety.heartbeat(client.id);
        } catch { stop('Sessão de testes encerrada ou indisponível.'); }
        finally { checking = false; }
      }, TEST_LIMITS.heartbeatMs);
      client.data.testHeartbeat.unref();
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

    const persistentTokenId = createHash('sha256').update(`${data.roomId}:${session.id}`).digest('hex');
    const ownToken = room.tokens.find(t => t.id === persistentTokenId);
    if (ownToken) {
      this.server.to(data.roomId).emit('remove-player-tokens', { playerId: ownToken.playerId });
      ownToken.playerId = client.id;
      playerData.tokens.push(ownToken);
      playerData.audioPosition = { x: ownToken.x, y: ownToken.y, z: 0 };
      this.server.to(data.roomId).emit('token-created', ownToken);
    }
    this.players.set(client.id, playerData);
    room.players.set(client.id, playerData);
    client.join(data.roomId);

    const [recentRolls, chatEvents] = await Promise.all([
      this.prisma.diceRoll.findMany({
        where: { roomId: data.roomId },
        orderBy: { timestamp: 'desc' },
        take: 30,
      }),
      this.prisma.event.findMany({
        where: {
          eventType: 'CHAT',
          metadata: { path: ['roomId'], equals: data.roomId },
        },
        orderBy: { timestamp: 'desc' },
        take: 50,
      }),
    ]);

    client.emit('room-joined', {
      testMode: this.safety.enabled,
      testEndsAt: null,
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
        timestamp: r.timestamp.getTime(),
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
      id: createHash('sha256').update(`${player.roomId}:${player.userId}`).digest('hex'),
      x: data.x,
      y: data.y,
      color: data.color,
      playerId: client.id,
      playerName: data.playerName || player.name,
    };

    if (player.tokens.length) {
      client.emit('token-created', player.tokens[0]);
      return { ok: true };
    }
    if (player.creatingToken) return { ok: false };
    player.creatingToken = true;
    try {
      await this.prisma.token.create({
        data: {
          id: token.id,
          roomId: player.roomId,
          name: token.playerName || 'Token',
          x: data.x,
          y: data.y,
          color: `#${data.color.toString(16).padStart(6, '0')}`,
        },
      });
    } catch {
      client.emit('room-error', { message: 'Não foi possível criar o token.' });
      return { ok: false };
    } finally {
      player.creatingToken = false;
    }

    player.tokens.push(token);
    room.tokens.push(token);

    this.server.to(player.roomId).emit('token-created', token);
    console.log(`🎯 Token criado por ${token.playerName} em (${data.x},${data.y}) na sala ${player.roomId}`);
    return { ok: true };
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

    const session = this.parseSessionCookie(client);
    if (!session || data.agoraUid !== this.sessions.voiceUid(session)) return;
    player.agoraUid = this.sessions.voiceUid(session);

    // The audio listener starts after room-joined. Replay existing peers only
    // once this client has joined Agora and is ready to receive their IDs.
    for (const [socketId, peer] of this.players) {
      if (socketId !== client.id && peer.roomId === player.roomId && peer.agoraUid) {
        client.emit('agora-uid-announced', { socketId, agoraUid: peer.agoraUid });
      }
    }

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
    if (!token) return;
    token.hp = data.hp;
    token.maxHp = data.maxHp;

    this.server.to(player.roomId).emit('token-hp-updated', {
      tokenId: data.tokenId,
      hp: data.hp,
      maxHp: data.maxHp,
    });

    this.prisma.token
      .update({ where: { id: data.tokenId }, data: { hp: data.hp, maxHp: data.maxHp } })
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
    return Array.from({ length: 6 }, () => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[randomInt(36)]).join('');
  }
}

