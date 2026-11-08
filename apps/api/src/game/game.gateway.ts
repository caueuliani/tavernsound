import { validAmbientPreset, type AmbientPreset } from './ambient-presets';
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
import { createHash, randomInt, randomUUID } from 'crypto';
import { AudioPosition, SpatialAudioSettings } from './dto/room.dto';
import { TestSafetyService } from '../safety/test-safety.service';
import { TEST_LIMITS, betaLimits } from '../safety/test-policy';
import { sceneryNameOrFallback } from './scenery-token-name';
import { parseDiceRequest, rollDice } from './dice.util';
import { readScene } from './scene.util';
import type { SceneWall } from './scene.util';
import { sceneSocketRoom } from './scene-media.util';
import { isTokenGridCoordinate, movementSegments, tokenCenter, tokenSize, validTokenMove, validTokenPosition } from './token-movement';

interface TokenData {
  id: string;
  sceneId?: string;
  kind: 'PLAYER' | 'SCENERY';
  x: number;
  y: number;
  color: number;
  playerId: string;
  playerName?: string;
  hp?: number;
  maxHp?: number;
  imageUrl?: string;
  size?: number;
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
  sceneId?: string;
  sceneTransportV2?: boolean;
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
  walls?: SceneWall[];
  gridSize?: number;
  spatialAudioSettings?: SpatialAudioSettings;
  ambientPreset?: AmbientPreset;
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
  private initialTransport(roomId: string) {
    return sceneSocketRoom(roomId, `initial-${roomId}`);
  }
  private tokenTransport(roomId: string, token?: TokenData) {
    return sceneSocketRoom(roomId, token?.sceneId ?? `initial-${roomId}`);
  }
  private playerTransport(player: PlayerData) {
    return sceneSocketRoom(player.roomId!, player.sceneId ?? `initial-${player.roomId}`);
  }
  private sameScene(a: PlayerData, b: PlayerData) {
    return a.roomId === b.roomId && (a.sceneId ?? `initial-${a.roomId}`) === (b.sceneId ?? `initial-${b.roomId}`);
  }

  publishTokenName(roomId: string, tokenId: string, name: string) {
    const token = this.rooms.get(roomId)?.tokens.find(item => item.id === tokenId);
    if (token) token.playerName = name;
    if (token) this.server.to(this.tokenTransport(roomId, token)).emit('token-name-updated', { tokenId, name });
  }
  publishTokenSize(roomId: string, tokenId: string, size: number) {
    const token = this.rooms.get(roomId)?.tokens.find(item => item.id === tokenId);
    if (token) token.size = size;
    if (token) this.server.to(this.tokenTransport(roomId, token)).emit('token-size-updated', { tokenId, size });
  }
  publishTokenDeleted(roomId: string, tokenId: string) {
    const room = this.rooms.get(roomId);
    const deleted = room?.tokens.find(token => token.id === tokenId);
    if (room) {
      room.tokens = room.tokens.filter(token => token.id !== tokenId);
      for (const player of room.players.values()) player.tokens = player.tokens.filter(token => token.id !== tokenId);
    }
    if (deleted) this.server.to(this.tokenTransport(roomId, deleted)).emit('token-deleted', { tokenId });
  }
  publishTokenImage(roomId: string, tokenId: string, imageData: string) {
    const token = this.rooms.get(roomId)?.tokens.find(item => item.id === tokenId);
    if (token) token.imageUrl = imageData;
    if (token) this.server.to(this.tokenTransport(roomId, token)).emit('token-image-updated', { tokenId, imageData });
  }
  closeRoom(roomId: string) {
    this.server.to(roomId).emit('room-error', { message: 'Esta sala foi excluída pelo mestre. Volte para a página inicial.' });
    this.server.in(roomId).disconnectSockets(true);
    this.rooms.delete(roomId);
  }
  publishScene(roomId: string, scene: any) {
    const room = this.rooms.get(roomId);
    if (room) { room.walls = scene.walls; room.gridSize = scene.settings?.gridSize ?? 10; }
    this.server.to(this.initialTransport(roomId)).emit('scene-updated', scene);
  }
  @WebSocketServer()
  server: Server;

  constructor(private readonly prisma: PrismaService, private readonly sessions: SessionService, private readonly access: RoomAccessService, private readonly safety: TestSafetyService) {}

  private players: Map<string, PlayerData> = new Map();
  private rooms: Map<string, RoomData> = new Map();
  private readonly transferPreflights = new Map<string, {
    roomId: string; userId: string; socketId: string; sceneId: string;
    expiresAt: number; status: 'pending' | 'accepted' | 'rejected';
  }>();
  private readonly transferPreflightTtlMs = 45_000;
  private readonly activationReadyMs = 90_000;
  private readonly pendingActivations = new Map<string, { sceneId: string; timer: ReturnType<typeof setTimeout> }>();
  private activationKey(roomId: string, userId: string) { return `${roomId}:${userId}`; }

  private clearPendingActivation(roomId: string, userId: string) {
    const key = this.activationKey(roomId, userId);
    const pending = this.pendingActivations.get(key);
    if (pending) clearTimeout(pending.timer);
    this.pendingActivations.delete(key);
  }

  private async rollbackUnconfirmedActivation(roomId: string, userId: string, sceneId: string) {
    const key = this.activationKey(roomId, userId);
    if (this.pendingActivations.get(key)?.sceneId !== sceneId) return;
    this.clearPendingActivation(roomId, userId);
    const playerTokenId = createHash('sha256').update(`${roomId}:${userId}`).digest('hex');
    try {
      const reverted = await this.prisma.$transaction(async tx => {
        const changed = await tx.roomSceneAssignment.updateMany({
          where: { roomId, userId, activeSceneId: sceneId },
          data: { activeSceneId: null },
        });
        if (changed.count) {
          await tx.token.updateMany({
            where: { id: playerTokenId, roomId, sceneId },
            data: { sceneId: `initial-${roomId}` },
          });
        }
        return changed.count;
      });
      if (reverted) this.recoverPlayerToInitial(roomId, userId);
    } catch (error) {
      // The GM recovery endpoint remains available even if Neon is down.
      console.error('Falha ao restaurar automaticamente a transferência de cena:', error);
    }
  }

  @SubscribeMessage('scene-client-ready')
  async handleSceneClientReady(
    @MessageBody() data: { sceneId?: unknown },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player?.roomId || !player.userId || !player.sceneTransportV2 ||
        typeof data?.sceneId !== 'string' || player.sceneId !== data.sceneId) return;
    const key = this.activationKey(player.roomId, player.userId);
    if (this.pendingActivations.get(key)?.sceneId !== data.sceneId) return;
    // The browser ACK is accepted only after checking the persisted active
    // scene. Client-side media readiness remains an end-to-end test concern.
    try {
      const active = await this.access.activeSceneForUser(player.roomId, player.userId);
      if (active.sceneId !== data.sceneId) return;
    } catch { return; }
    this.clearPendingActivation(player.roomId, player.userId);
    client.emit('scene-activation-confirmed', { sceneId: data.sceneId });
  }



  requestSceneTransferPreflight(roomId: string, userId: string, sceneId: string) {
    // Only the authenticated HTTP controller may call this method, after
    // checking GM ownership, active membership and staged scene ownership.
    const player = Array.from(this.players.values()).find(p =>
      p.roomId === roomId && p.userId === userId && p.sceneId === `initial-${roomId}`);
    if (!player) return { status: 'offline' as const };
    const socket = this.server?.sockets?.sockets?.get(player.id);
    if (!socket?.connected) return { status: 'offline' as const };
    for (const [id, request] of this.transferPreflights) {
      if (request.expiresAt <= Date.now() || (request.roomId === roomId && request.userId === userId)) {
        this.transferPreflights.delete(id);
      }
    }
    const requestId = randomUUID();
    const expiresAt = Date.now() + this.transferPreflightTtlMs;
    this.transferPreflights.set(requestId, { roomId, userId, socketId: player.id, sceneId, expiresAt, status: 'pending' });
    socket.emit('scene-transfer-preflight', { requestId, sceneId, expiresAt });
    return { requestId, status: 'pending' as const, expiresAt };
  }

  /**
   * Reset any pending transfer requests and disconnect the target's existing
   * socket after a GM-authorized database recovery. A fresh join reloads
   * the initial scene instead of retaining stale RTC / map state.
   */
  recoverPlayerToInitial(roomId: string, userId: string) {
    this.clearPendingActivation(roomId, userId);
    for (const [id, request] of this.transferPreflights) {
      if (request.roomId === roomId && request.userId === userId) this.transferPreflights.delete(id);
    }
    for (const player of this.players.values()) {
      if (player.roomId !== roomId || player.userId !== userId) continue;
      const socket = this.server?.sockets?.sockets?.get(player.id);
      if (!socket) continue;
      socket.emit('scene-recovery-required', {
        sceneId: `initial-${roomId}`,
        message: 'O mestre restaurou sua Cena inicial. Reconecte à mesa.',
      });
      socket.disconnect(true);
    }
  }

  verifiedSceneTransferPreflight(roomId: string, userId: string, sceneId: string, requestId: string): boolean {
    const request = this.transferPreflights.get(requestId);
    if (!request || request.roomId !== roomId || request.userId !== userId ||
        request.sceneId !== sceneId || request.status !== 'accepted' || request.expiresAt <= Date.now()) return false;
    const player = this.players.get(request.socketId);
    const socket = this.server?.sockets?.sockets?.get(request.socketId);
    return !!socket?.connected && !!player?.sceneTransportV2 &&
      player.roomId === roomId && player.userId === userId && player.sceneId === `initial-${roomId}`;
  }

  finalizeSceneActivation(roomId: string, userId: string, requestId: string, sceneId: string) {
    const request = this.transferPreflights.get(requestId);
    if (!request || request.roomId !== roomId || request.userId !== userId || request.sceneId !== sceneId) return;
    this.transferPreflights.delete(requestId);
    this.clearPendingActivation(roomId, userId);
    const timer = setTimeout(() => {
      void this.rollbackUnconfirmedActivation(roomId, userId, sceneId);
    }, this.activationReadyMs);
    timer.unref();
    this.pendingActivations.set(this.activationKey(roomId, userId), { sceneId, timer });
    // Even if the original socket disconnected after DB commit, the timeout
    // restores initial scene+token unless the new scene sends a valid ACK.
    const socket = this.server?.sockets?.sockets?.get(request.socketId);
    if (socket?.connected) socket.emit('scene-activation-required', { sceneId, mode: 'reload-required' });
  }

  sceneTransferPreflightStatus(roomId: string, requestId: string) {
    const request = this.transferPreflights.get(requestId);
    if (!request || request.roomId !== roomId) return null;
    if (request.expiresAt <= Date.now()) {
      this.transferPreflights.delete(requestId);
      return { requestId, status: 'expired' as const };
    }
    return { requestId, status: request.status, expiresAt: request.expiresAt };
  }

  @SubscribeMessage('scene-transfer-preflight-response')
  handleSceneTransferPreflightResponse(
    @MessageBody() data: { requestId?: unknown; accepted?: unknown },
    @ConnectedSocket() client: Socket,
  ) {
    if (typeof data?.requestId !== 'string' || typeof data?.accepted !== 'boolean') return;
    const request = this.transferPreflights.get(data.requestId);
    const player = this.players.get(client.id);
    if (!request || !player || request.status !== 'pending' || request.expiresAt <= Date.now()) return;
    if (request.socketId !== client.id || request.userId !== player.userId ||
        request.roomId !== player.roomId || request.sceneId === player.sceneId) return;
    request.status = data.accepted ? 'accepted' : 'rejected';
    // An acknowledgement is NOT authority to activate a scene. Neither
    // activeSceneId nor Agora/Socket.IO membership changes in this PR.
  }


  private parseSessionCookie(client: Socket) {
    return client.data.session as Awaited<ReturnType<SessionService['resolve']>>;
  }

  afterInit(server: Server) {
    server.use(async (client, next) => {
      try {
        this.safety.rate(`connect:${client.handshake.address}`, 10);
        if (this.safety.enabled && server.sockets.sockets.size >= Math.max(10, betaLimits().participants * 2)) throw new Error();
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
    for (const [id, request] of this.transferPreflights) {
      if (request.socketId === client.id) this.transferPreflights.delete(id);
    }

    if (player.roomId) {
      const room = this.rooms.get(player.roomId);
      if (room) {
        room.players.delete(client.id);

        client.to(this.playerTransport(player)).emit('player-left', {
          playerId: client.id,
          playerName: player.name,
        });

        // Remove tokens da memória, mas NÃO do banco — o estado do mapa persiste
        const tokenIds = player.tokens.map(t => t.id);
        room.tokens.forEach(t => { if (t.playerId === client.id) t.playerId = t.id; });
        client.to(this.initialTransport(player.roomId)).emit('remove-player-tokens', {
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
      gridSize: 10,
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
    @MessageBody() data: { roomId: string; sceneTransportV2?: boolean },
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

  private async joinRoom(data: { roomId: string; sceneTransportV2?: boolean }, client: Socket) {
    const session = this.parseSessionCookie(client);
    if (!session?.id) {
      client.emit('room-error', { message: 'Faça login para entrar na sala.' });
      return;
    }
    if (this.players.has(client.id)) {
      client.emit('room-error', { message: 'Este cliente já entrou em uma sala.' });
      return;
    }
    let activeScene: Awaited<ReturnType<RoomAccessService['activeSceneForUser']>>;
    try { activeScene = await this.access.activeSceneForUser(data?.roomId, session.id); }
    catch {
      client.emit('room-error', { message: 'Sala indisponível ou conta não autorizada. Peça acesso ao mestre.' });
      return;
    }
    // Alternative admission is an explicitly coordinated, default-OFF
    // protocol. Legacy clients must never enter an alternative scene while
    // their Agora client is still on the shared room-wide audio/video channel.
    const alternative = activeScene.sceneId !== activeScene.initialSceneId;
    if (alternative && (process.env.SCENE_SCOPED_ADMISSION !== 'true' || data?.sceneTransportV2 !== true)) {
      client.emit('room-error', { message: 'Esta cena requer a atualização do protocolo da mesa. Retorne à cena inicial com o mestre.' });
      return;
    }
    const activeSocketRoom = sceneSocketRoom(data.roomId, activeScene.sceneId);
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

      const legacyHostTokenId = dbRoom.ownerId
        ? createHash('sha256').update(`${data.roomId}:${dbRoom.ownerId}`).digest('hex')
        : null;
      // Tokens do banco usam o próprio id como playerId para garantir chaves únicas no frontend
      const restoredScene = readScene(dbRoom.sceneData);
      const restoredTokens: TokenData[] = dbRoom.tokens.filter(t => !t.sceneId || t.sceneId === activeScene.initialSceneId).map(t => ({
        id: t.id,
        sceneId: t.sceneId ?? `initial-${data.roomId}`,
        kind: t.kind,
        x: t.positionX ?? t.x,
        y: t.positionY ?? t.y,
        color: parseInt((t.color || '#ff9d00').replace('#', ''), 16),
        playerId: t.id,
        playerName: t.kind === 'SCENERY' ? sceneryNameOrFallback(t.name) : t.id === legacyHostTokenId ? 'Token antigo (sem vínculo)' : t.name,
        hp: t.hp ?? undefined,
        maxHp: t.maxHp ?? undefined,
        imageUrl: t.imageUrl ?? undefined,
        size: tokenSize(t.sizeMultiplier),
      }));

      room = {
        id: dbRoom.id,
        name: dbRoom.name || 'Sala sem nome',
        createdAt: dbRoom.createdAt,
        players: new Map(),
        tokens: restoredTokens,
        fogData: Array.isArray(dbRoom.fogOfWarData) ? (dbRoom.fogOfWarData as boolean[]) : undefined,
        mapUrl: dbRoom.mapUrl?.startsWith('db-webp:') ? undefined : dbRoom.mapUrl ?? undefined,
        ownerId: dbRoom.ownerId,
        walls: restoredScene.walls,
        gridSize: restoredScene.settings.gridSize,
        spatialAudioSettings: {
          maxDistance: 1000,
          attenuationFactor: 1,
          wallOcclusionFactor: 0.5,
        },
      };

      this.rooms.set(data.roomId, room);
      console.log(`🔄 Sala ${data.roomId} restaurada do banco com ${restoredTokens.length} token(s)`);
    }

    // RoomData is the legacy initial-scene cache. Never copy its tokens or
    // geometry into an alternative scene: load the authorized scene directly.
    const alternativeScene = alternative
      ? await this.prisma.scene.findFirst({
          where: { roomId: data.roomId, id: activeScene.sceneId },
          select: { id: true, sceneData: true, fogData: true },
        })
      : null;
    if (alternative && !alternativeScene) {
      client.emit('room-error', { message: 'Cena ativa indisponível. Peça ao mestre para restaurar a Cena inicial.' });
      return;
    }
    const sceneTokens: TokenData[] = alternative
      ? (await this.prisma.token.findMany({
          where: { roomId: data.roomId, sceneId: activeScene.sceneId },
        })).map(t => ({
          id: t.id, sceneId: activeScene.sceneId, kind: t.kind,
          x: t.positionX ?? t.x, y: t.positionY ?? t.y,
          color: parseInt((t.color || '#ff9d00').replace('#', ''), 16),
          playerId: t.id,
          playerName: t.kind === 'SCENERY' ? sceneryNameOrFallback(t.name) : t.name,
          hp: t.hp ?? undefined, maxHp: t.maxHp ?? undefined,
          imageUrl: t.imageUrl ?? undefined, size: tokenSize(t.sizeMultiplier),
        }))
      : room.tokens;
    const sceneGeometry = alternative ? readScene(alternativeScene!.sceneData) : null;

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
      const limit = this.safety.enabled ? betaLimits().participants : (PLAYER_LIMITS as Record<string, number>)[activeTier] || 4;

      if (room.players.size >= limit) {
        client.emit('room-error', {
          message: `Sala cheia! Limite de ${limit} jogadores para este plano.`,
        });
        return;
      }
    }

    // The Founders Beta runs one API instance; sockets absent here are leases left by a restart.
    await this.safety.admit(data.roomId, session.id, session.sid, client.id, new Set(this.server.sockets.sockets.keys()));
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
      sceneId: activeScene.sceneId,
      sceneTransportV2: data.sceneTransportV2 === true,
      userId: session?.id,
      isHost,
      audioPosition: isHost ? undefined : { x: 0, y: 0, z: 0 },
      isMuted: false,
      isDeafened: false,
      isSpeaking: false,
    };

    const persistentTokenId = createHash('sha256').update(`${data.roomId}:${session.id}`).digest('hex');
    const ownToken = sceneTokens.find(t => t.id === persistentTokenId);
    if (ownToken && !isHost) {
      this.server.to(this.tokenTransport(data.roomId, ownToken)).emit('remove-player-tokens', { playerId: ownToken.playerId });
      ownToken.playerId = client.id;
      playerData.tokens.push(ownToken);
      playerData.audioPosition = { x: ownToken.x, y: ownToken.y, z: 0 };
      this.server.to(this.tokenTransport(data.roomId, ownToken)).emit('token-created', ownToken);
    }
    this.players.set(client.id, playerData);
    room.players.set(client.id, playerData);
    client.join(data.roomId);
    client.join(activeSocketRoom);
    client.emit('scene-transport-ready', alternative
      ? { sceneId: activeScene.sceneId, isolated: false, socketScoped: true }
      : { sceneId: activeScene.sceneId, isolated: false });

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
      sceneId: activeScene.sceneId,
      playerName,
      isHost,
      players: Array.from(room.players.values()).filter(p => this.sameScene(p, playerData)).map(p => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost === true,
        agoraUid: p.agoraUid,
        audioPosition: p.audioPosition,
        isMuted: p.isMuted,
        isDeafened: p.isDeafened,
        isSpeaking: p.isSpeaking,
      })),
      tokens: sceneTokens,
      walls: alternative ? sceneGeometry!.walls : room.walls ?? [],
      spatialAudioSettings: room.spatialAudioSettings,
      ambientPreset: alternative ? 'off' : room.ambientPreset ?? 'off',
      // Dice rows are legacy room-wide: do not disclose them to a different scene.
      recentRolls: (alternative ? [] : recentRolls.reverse()).map(r => ({
        playerId: '',
        playerName: r.playerName,
        formula: r.diceType,
        result: r.result,
        rolls: r.rolls,
        modifier: r.modifier,
        timestamp: r.timestamp.getTime(),
      })),
      // Legacy CHAT rows have no sceneId and belong to the initial scene.
      // Never return chat from a different scene in a room-joined snapshot.
      chatHistory: chatEvents.reverse().filter(e => {
        const meta = e.metadata as any;
        return (meta?.sceneId ?? activeScene.initialSceneId) === activeScene.sceneId;
      }).map(e => {
        const meta = e.metadata as any;
        return {
          playerName: meta?.playerName ?? 'Jogador',
          text: meta?.text ?? '',
          timestamp: e.timestamp.getTime(),
        };
      }),
      fogData: alternative ? (Array.isArray(alternativeScene!.fogData) ? alternativeScene!.fogData : null) : room.fogData ?? null,
      mapUrl: alternative ? null : room.mapUrl ?? null,
    });

    client.to(this.playerTransport(playerData)).emit('player-joined', {
      playerId: client.id,
      playerName,
      isHost,
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
    if (!player || !player.roomId || player.isHost) return;

    player.audioPosition = data.position;

    client.to(this.playerTransport(player)).emit('player-audio-position-updated', {
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

    this.server.to(this.playerTransport(player)).emit('player-audio-mute-updated', {
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

    this.server.to(this.playerTransport(player)).emit('player-audio-deafen-updated', {
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

    this.server.to(this.playerTransport(player)).emit('spatial-audio-settings-updated', {
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
    // Alternative scene gameplay mutation requires the per-scene rules engine.
    // Until then, entry is read-only to avoid writing to initial-scene tokens.
    if (player.sceneId && player.sceneId !== `initial-${player.roomId}`) {
      client.emit('room-error', { message: 'Tokens nesta cena ainda estão em modo somente leitura.' });
      return;
    }

    const room = this.rooms.get(player.roomId);
    if (!room) return;

    const id = player.isHost ? randomUUID() : createHash('sha256').update(`${player.roomId}:${player.userId}`).digest('hex');
    const token: TokenData = {
      id,
      sceneId: `initial-${player.roomId}`,
      kind: player.isHost ? 'SCENERY' : 'PLAYER',
      x: data.x,
      y: data.y,
      color: data.color,
      playerId: player.isHost ? id : client.id,
      playerName: player.isHost ? 'Token de cenário' : data.playerName || player.name,
      size: 1,
    };

    if (!player.isHost && player.tokens.length) {
      client.emit('token-created', player.tokens[0]);
      return { ok: true };
    }
    if (!isTokenGridCoordinate(data.x, room.gridSize ?? 10) || !isTokenGridCoordinate(data.y, room.gridSize ?? 10) || !validTokenPosition(tokenCenter(data.x, data.y, room.gridSize ?? 10), 1, room.gridSize ?? 10, movementSegments(room.walls ?? []))) {
      client.emit('room-error', { message: 'Posição indisponível para criar o token.' });
      return { ok: false };
    }
    if (player.creatingToken) return { ok: false };
    player.creatingToken = true;
    try {
      await this.prisma.token.create({
        data: {
          id: token.id,
          roomId: player.roomId,
          sceneId: token.sceneId,
          kind: token.kind,
          name: token.playerName || 'Token',
          x: Math.floor(data.x),
          y: Math.floor(data.y),
          positionX: data.x,
          positionY: data.y,
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

    this.server.to(this.tokenTransport(player.roomId, token)).emit('token-created', token);
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
    // Alternative token editing will be enabled only after scene-aware
    // ownership, persistence and movement validation are fully coordinated.
    if (player.sceneId && player.sceneId !== `initial-${player.roomId}`) {
      client.emit('room-error', { message: 'Tokens nesta cena ainda estão em modo somente leitura.' });
      return;
    }

    const room = this.rooms.get(player.roomId);
    if (!room) return;

    const token = player.isHost
      ? room.tokens.find(t => t.id === data.tokenId && t.playerId === t.id)
      : player.tokens.find(t => t.id === data.tokenId && t.kind === 'PLAYER');
    if (!token) return;

    const segments = movementSegments(room.walls ?? []);
    if (!isTokenGridCoordinate(data.x, room.gridSize ?? 10) || !isTokenGridCoordinate(data.y, room.gridSize ?? 10) ||
      !validTokenMove(tokenCenter(token.x, token.y, room.gridSize ?? 10), tokenCenter(data.x, data.y, room.gridSize ?? 10), token.size, room.gridSize ?? 10, segments)) {
      client.emit('token-moved', { tokenId: token.id, x: token.x, y: token.y, playerId: token.playerId });
      return;
    }

    token.x = data.x;
    token.y = data.y;

    const roomToken = room.tokens.find(t => t.id === data.tokenId);
    if (roomToken) {
      roomToken.x = data.x;
      roomToken.y = data.y;
    }

    // Se o token for do próprio jogador, atualizamos sua posição de áudio correspondente
    if (!player.isHost) player.audioPosition = { x: data.x, y: data.y, z: 0 };

    client.to(this.tokenTransport(player.roomId, token)).emit('token-moved', {
      tokenId: data.tokenId,
      x: data.x,
      y: data.y,
      playerId: token.playerId,
    });

    this.prisma.token
      .update({ where: { id: data.tokenId }, data: { x: Math.floor(data.x), y: Math.floor(data.y), positionX: data.x, positionY: data.y } })
      .catch(() => {});
  }

  @SubscribeMessage('set-ambient-preset')
  handleSetAmbientPreset(
    @MessageBody() data: { preset?: unknown },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player?.roomId || !player.isHost) return;
    if (!validAmbientPreset(data?.preset)) {
      client.emit('room-error', { message: 'Som ambiente inválido.' });
      return;
    }
    const room = this.rooms.get(player.roomId);
    if (!room) return;
    room.ambientPreset = data.preset;
    this.server.to(this.playerTransport(player)).emit('ambient-preset-updated', { preset: data.preset });
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
      if (socketId !== client.id && this.sameScene(peer, player) && peer.agoraUid) {
        client.emit('agora-uid-announced', { socketId, agoraUid: peer.agoraUid, isHost: peer.isHost === true });
      }
    }

    this.server.to(this.playerTransport(player)).emit('agora-uid-announced', {
      socketId: client.id,
      agoraUid: data.agoraUid,
      isHost: player.isHost === true,
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

    client.to(this.playerTransport(player)).emit('player-speaking-update', {
      playerId: client.id,
      isSpeaking: data.isSpeaking,
    });
  }

  @SubscribeMessage('roll-dice')
  async handleRollDice(
    @MessageBody() data: unknown,
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player?.roomId) return;
    // DiceRoll rows currently lack sceneId. Persisting dice from another
    // scene would leak their results to legacy initial-scene history.
    if (player.sceneId && player.sceneId !== `initial-${player.roomId}`) {
      client.emit('room-error', { message: 'Rolagens nesta cena estarão disponíveis após o histórico por cenário.' });
      return;
    }
    const request = parseDiceRequest(data);
    if (!request) {
      client.emit('room-error', { message: 'Rolagem inválida. Escolha entre 1 e 30 dados e um modificador de -1000 a 1000.' });
      return;
    }

    const rolled = rollDice(request);
    const rollData = {
      playerId: client.id,
      playerName: player.name,
      formula: rolled.formula,
      result: rolled.result,
      rolls: rolled.rolls,
      modifier: rolled.modifier,
      timestamp: Date.now(),
    };
    try {
      await this.prisma.diceRoll.create({
        data: {
          roomId: player.roomId,
          userId: player.userId ?? null,
          playerName: player.name || 'Jogador',
          diceType: rolled.formula,
          quantity: rolled.quantity,
          modifier: rolled.modifier,
          result: rolled.result,
          rolls: rolled.rolls,
        },
      });
      this.server.to(this.playerTransport(player)).emit('dice-rolled', rollData);
    } catch {
      client.emit('room-error', { message: 'A rolagem não pôde ser registrada. Tente novamente.' });
    }
  }

  @SubscribeMessage('update-token-hp')
  handleUpdateTokenHp(
    @MessageBody() data: { tokenId: string; hp: number; maxHp: number },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.players.get(client.id);
    if (!player || !player.roomId) return;
    // Alternative token editing will be enabled only after scene-aware
    // ownership, persistence and movement validation are fully coordinated.
    if (player.sceneId && player.sceneId !== `initial-${player.roomId}`) {
      client.emit('room-error', { message: 'Tokens nesta cena ainda estão em modo somente leitura.' });
      return;
    }

    const room = this.rooms.get(player.roomId);
    if (!room) return;

    const ownsToken = player.tokens.some(t => t.id === data.tokenId);
    if (!player.isHost && !ownsToken) return;

    const token = room.tokens.find(t => t.id === data.tokenId);
    if (!token) return;
    token.hp = data.hp;
    token.maxHp = data.maxHp;

    this.server.to(this.tokenTransport(player.roomId, token)).emit('token-hp-updated', {
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

    this.server.to(this.playerTransport(player)).emit('chat-message-received', message);

    this.prisma.event
      .create({
        data: {
          eventType: 'CHAT',
          userId: player.userId ?? null,
          metadata: { roomId: player.roomId, sceneId: player.sceneId ?? `initial-${player.roomId}`, playerName: message.playerName, text: message.text },
        },
      })
      .catch(() => {});
  }

  private generateRoomId(): string {
    return Array.from({ length: 6 }, () => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[randomInt(36)]).join('');
  }
}

