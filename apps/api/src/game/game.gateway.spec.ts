import { GameGateway } from './game.gateway';
import { TestSafetyService } from '../safety/test-safety.service';
import { createHash } from 'crypto';

describe('GameGateway regressions', () => {
  let gateway: GameGateway;
  let prisma: any;
  let client: any;
  let broadcast: jest.Mock;
  let sessions: any;
  let access: any;

  beforeEach(() => {
    prisma = {
      subscription: { findUnique: jest.fn().mockResolvedValue(null) },
      room: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({}), findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      token: { create: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      diceRoll: { findMany: jest.fn().mockResolvedValue([]) },
      event: { findMany: jest.fn().mockResolvedValue([]) },
    };
    sessions = { require: jest.fn(), on: jest.fn(), voiceUid: jest.fn().mockReturnValue('allowed-uid') };
    access = { require: jest.fn() };
    gateway = new GameGateway(prisma, sessions, access, new TestSafetyService(prisma));
    client = { id: 'socket-1', data: {}, handshake: { headers: {} }, emit: jest.fn(), disconnect: jest.fn(), join: jest.fn(), to: jest.fn().mockReturnValue({ emit: jest.fn() }) };
    broadcast = jest.fn();
    gateway.server = { to: jest.fn().mockReturnValue({ emit: broadcast }), sockets: { sockets: new Map([[client.id, client]]) } } as any;
  });

  it('does not load or disclose a private room to an unauthorized account', async () => {
    client.data.session = { id: 'intruder' };
    access.require.mockRejectedValue(new Error('denied'));
    await gateway.handleJoinRoom({ roomId: 'ABC123' }, client);
    expect((gateway as any).players.size).toBe(0);
    expect(client.emit).toHaveBeenCalledWith('room-error', expect.any(Object));
  });

  it('rejects anonymous joins before checking room existence', async () => {
    await gateway.handleJoinRoom({ roomId: 'ABC123' }, client);
    expect(access.require).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('room-error', expect.any(Object));
  });

  it('does not accept another voice identity supplied by the client', () => {
    const { player } = prepareRoom();
    client.data.session = { id: 'owner' };
    gateway.handleAnnounceAgoraUid({ socketId: client.id, agoraUid: 'forged' }, client);
    expect(broadcast).not.toHaveBeenCalled();
    expect((player as any).agoraUid).toBeUndefined();
  });

  const prepareRoom = () => {
    const player = { id: client.id, roomId: 'room-a', isHost: true, tokens: [] as any[] };
    const room = { id: 'room-a', tokens: [] as any[], players: new Map([[client.id, player]]) };
    (gateway as any).players.set(client.id, player);
    (gateway as any).rooms.set('room-a', room);
    return { player, room };
  };

  const joinPersistedRoom = async (userId: string, tokenUserId: string, size = 1, sceneData: any = null) => {
    const tokenId = createHash('sha256').update(`ABC123:${tokenUserId}`).digest('hex');
    client.data.session = { id: userId, sid: 'session', name: userId };
    access.require.mockResolvedValue({});
    prisma.room.findUnique.mockResolvedValue({
      id: 'ABC123', name: 'Table', ownerId: 'owner', createdAt: new Date(), fogOfWarData: null, mapUrl: null,
      sceneData,
      tokens: [{ id: tokenId, kind: 'PLAYER', x: 3, y: 4, sizeMultiplier: size, color: '#ff9d00', name: tokenUserId, hp: 8, maxHp: 10 }],
    });
    await gateway.handleJoinRoom({ roomId: 'ABC123' }, client);
    const joined = client.emit.mock.calls.find(([event]: [string]) => event === 'room-joined')?.[1];
    expect(joined).toBeDefined();
    return { tokenId, joined, player: (gateway as any).players.get(client.id) };
  };

  it('keeps a persisted host token visible but detached from the host and its audio position', async () => {
    const { tokenId, joined, player } = await joinPersistedRoom('owner', 'owner');
    expect(joined).toMatchObject({ isHost: true, tokens: [{ id: tokenId, playerId: tokenId, playerName: 'Token antigo (sem vínculo)' }] });
    expect(player.tokens).toHaveLength(0);
    expect(player.audioPosition).toBeUndefined();
    expect(broadcast).not.toHaveBeenCalledWith('token-created', expect.anything());
    await gateway.handleCreateToken({ tokenId: 'ignored', x: 1, y: 2, color: 0xff9d00 }, client);
    const createdId = prisma.token.create.mock.calls[0][0].data.id;
    expect(createdId).toMatch(/^[a-f0-9-]{36}$/);
    expect(createdId).not.toBe(tokenId);
    expect(player.audioPosition).toBeUndefined();
    gateway.handleMoveToken({ tokenId, x: 5, y: 6 }, client);
    expect(client.to().emit).toHaveBeenCalledWith('token-moved', expect.objectContaining({ tokenId, playerId: tokenId }));
    gateway.handleUpdateAudioPosition({ position: { x: 9, y: 9, z: 0 } }, client);
    expect(player.audioPosition).toBeUndefined();
  });

  it('still reconnects a normal player to their persisted personal token', async () => {
    const { tokenId, joined, player } = await joinPersistedRoom('player', 'player');
    expect(joined).toMatchObject({ isHost: false, tokens: [{ id: tokenId, playerId: client.id }] });
    expect(player.tokens).toHaveLength(1);
    expect(player.audioPosition).toEqual({ x: 3, y: 4, z: 0 });
    gateway.handleMoveToken({ tokenId, x: 5, y: 6 }, client);
    expect(player.audioPosition).toEqual({ x: 5, y: 6, z: 0 });
  });

  it('replays existing voice identities to a late joiner without leaking other rooms', () => {
    prepareRoom();
    client.data.session = { id: 'owner' };
    const players = (gateway as any).players;
    players.set('early', { roomId: 'room-a', agoraUid: 'early-uid' });
    players.set('foreign', { roomId: 'room-b', agoraUid: 'private-uid' });
    players.set('silent', { roomId: 'room-a' });
    gateway.handleAnnounceAgoraUid({ socketId: 'forged-socket', agoraUid: 'allowed-uid' }, client);
    expect(client.emit.mock.calls).toEqual([
      ['agora-uid-announced', { socketId: 'early', agoraUid: 'early-uid', isHost: false }],
    ]);
    expect(broadcast).toHaveBeenCalledWith('agora-uid-announced', { socketId: client.id, agoraUid: 'allowed-uid', isHost: true });
  });

  it('does not let a player claim global voice in the Agora announcement', () => {
    const { player } = prepareRoom();
    player.isHost = false;
    client.data.session = { id: 'player' };
    gateway.handleAnnounceAgoraUid({ socketId: client.id, agoraUid: 'allowed-uid', isHost: true } as any, client);
    expect(broadcast).toHaveBeenCalledWith('agora-uid-announced', { socketId: client.id, agoraUid: 'allowed-uid', isHost: false });
  });

  it('relays mute state for both the host and a player', () => {
    const { player } = prepareRoom();
    gateway.handleToggleAudioMute({ isMuted: true }, client);
    expect(broadcast).toHaveBeenLastCalledWith('player-audio-mute-updated', { playerId: client.id, isMuted: true });
    player.isHost = false;
    gateway.handleToggleAudioMute({ isMuted: false }, client);
    expect(broadcast).toHaveBeenLastCalledWith('player-audio-mute-updated', { playerId: client.id, isMuted: false });
  });

  it('does not create anonymous rooms', async () => {
    await gateway.handleCreateRoom({ name: 'Room' }, client);
    expect(prisma.room.create).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('room-error', expect.any(Object));
  });

  it('keeps ownership in memory immediately after creation', async () => {
    jest.spyOn(gateway as any, 'parseSessionCookie').mockReturnValue({ id: 'owner-1' });
    const result = await gateway.handleCreateRoom({ name: 'Room' }, client);
    expect(result?.room.ownerId).toBe('owner-1');
  });

  it('does not let a host edit a token outside their room', () => {
    prepareRoom();
    gateway.handleUpdateTokenHp({ tokenId: 'foreign-token', hp: 0, maxHp: 10 }, client);
    expect(prisma.token.update).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing token or broadcast failed creation', async () => {
    const { player, room } = prepareRoom();
    prisma.token.create.mockRejectedValue({ code: 'P2002' });
    await gateway.handleCreateToken({ tokenId: 'existing-token', x: 1, y: 2, color: 0 }, client);
    expect(player.tokens).toHaveLength(0);
    expect(room.tokens).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('room-error', expect.any(Object));
  });

  it('creates only one token for concurrent clicks and keeps its identity', async () => {
    const { player, room } = prepareRoom();
    player.isHost = false;
    let finish!: () => void;
    prisma.token.create.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const input = { tokenId: 'first-click', x: 1, y: 2, color: 0 };
    const first = gateway.handleCreateToken(input, client);
    await gateway.handleCreateToken({ ...input, tokenId: 'second-click' }, client);
    expect(prisma.token.create).toHaveBeenCalledTimes(1);
    finish(); await first;
    await gateway.handleCreateToken({ ...input, tokenId: 'third-click' }, client);
    expect(prisma.token.create).toHaveBeenCalledTimes(1);
    expect(player.tokens).toHaveLength(1);
    expect(room.tokens).toHaveLength(1);
  });
  it('restores size and rejects wall crossing without persisting or broadcasting', async () => {
    const { tokenId, joined } = await joinPersistedRoom('player', 'player', 2);
    expect(joined.tokens[0]).toMatchObject({ size: 2, x: 3, y: 4, playerId: client.id });
    const room = (gateway as any).rooms.get('ABC123');
    room.walls = [{ id: 'wall', x1: 5, y1: 0, x2: 5, y2: 10, isDoor: false, isOpen: false, blocksAudio: true }];
    room.gridSize = 10;
    gateway.handleMoveToken({ tokenId, x: 6, y: 4 }, client);
    expect(prisma.token.update).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('token-moved', { tokenId, x: 3, y: 4, playerId: client.id });
    expect(client.to().emit).not.toHaveBeenCalledWith('token-moved', expect.anything());
    gateway.handleMoveToken({ tokenId, x: 3, y: 5 }, client);
    expect(prisma.token.update).toHaveBeenCalledWith({ where: { id: tokenId }, data: { x: 3, y: 5 } });
  });

  it('restores scene geometry and grid size before admitting movement after restart', async () => {
    const wall = { id: 'wall', x1: 5, y1: 0, x2: 5, y2: 10, isDoor: false, isOpen: false, blocksAudio: true };
    const sceneData = { revision: 1, map: null, settings: { scale: 1, x: 0, y: 0, gridOpacity: .3, gridSize: 20 }, walls: [wall] };
    const { tokenId } = await joinPersistedRoom('player', 'player', 1, sceneData);
    expect((gateway as any).rooms.get('ABC123')).toMatchObject({ gridSize: 20, walls: [wall] });
    gateway.handleMoveToken({ tokenId, x: 6, y: 4 }, client);
    expect(prisma.token.update).not.toHaveBeenCalled();
  });

  it('restores a persisted NPC after refresh with scenery kind and a stable visual key', async () => {
    const npcId = 'b3e0e896-6c4b-4a0b-8b20-8a97d5b55f3c';
    client.data.session = { id: 'owner', sid: 'session', name: 'owner' };
    access.require.mockResolvedValue({});
    prisma.room.findUnique.mockResolvedValue({
      id: 'ABC123', name: 'Table', ownerId: 'owner', createdAt: new Date(), fogOfWarData: null, mapUrl: null,
      tokens: [{ id: npcId, kind: 'SCENERY', x: 3, y: 4, color: '#ff9d00', name: 'Token de cenário' }],
    });
    await gateway.handleJoinRoom({ roomId: 'ABC123' }, client);
    const joined = client.emit.mock.calls.find(([event]: [string]) => event === 'room-joined')?.[1];
    expect(joined.tokens).toEqual([expect.objectContaining({ id: npcId, kind: 'SCENERY', playerId: npcId })]);
    expect((gateway as any).players.get(client.id).tokens).toHaveLength(0);
  });

  it('restores the saved NPC name, falling back only for invalid historical names', async () => {
    const npcId = 'b3e0e896-6c4b-4a0b-8b20-8a97d5b55f3c';
    client.data.session = { id: 'owner', sid: 'session', name: 'owner' };
    access.require.mockResolvedValue({});
    prisma.room.findUnique.mockResolvedValue({
      id: 'ABC123', name: 'Table', ownerId: 'owner', createdAt: new Date(), fogOfWarData: null, mapUrl: null,
      tokens: [{ id: npcId, kind: 'SCENERY', x: 3, y: 4, color: '#ff9d00', name: '  Capitão da Guarda  ' }],
    });
    await gateway.handleJoinRoom({ roomId: 'ABC123' }, client);
    const joined = client.emit.mock.calls.find(([event]: [string]) => event === 'room-joined')?.[1];
    expect(joined.tokens[0].playerName).toBe('Capitão da Guarda');
  });

  it('updates an NPC name in room memory and emits only to its room', () => {
    const { room } = prepareRoom();
    const npc = { id: 'npc', kind: 'SCENERY', playerId: 'npc', playerName: 'Token de cenário' };
    room.tokens.push(npc);
    gateway.publishTokenName('room-a', 'npc', 'Ferreiro');
    expect(npc.playerName).toBe('Ferreiro');
    expect(gateway.server.to).toHaveBeenCalledWith('room-a');
    expect(broadcast).toHaveBeenCalledWith('token-name-updated', { tokenId: 'npc', name: 'Ferreiro' });
  });

  it('creates distinct scenery tokens for repeated host clicks and broadcasts each', async () => {
    const { player, room } = prepareRoom();
    await gateway.handleCreateToken({ tokenId: 'ignored', x: 1, y: 2, color: 0 }, client);
    await gateway.handleCreateToken({ tokenId: 'ignored', x: 3, y: 4, color: 0 }, client);
    expect(prisma.token.create).toHaveBeenCalledTimes(2);
    expect(prisma.token.create.mock.calls.map(([arg]: any[]) => arg.data.kind)).toEqual(['SCENERY', 'SCENERY']);
    expect(new Set(room.tokens.map((token: any) => token.playerId)).size).toBe(2);
    expect(room.tokens.every((token: any) => token.playerId === token.id)).toBe(true);
    expect(player.tokens).toHaveLength(2);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('removes an NPC from room and host memory and broadcasts only to that room', () => {
    const { player, room } = prepareRoom();
    const npc = { id: 'npc', kind: 'SCENERY', playerId: 'npc' };
    const personal = { id: 'player-token', kind: 'PLAYER', playerId: 'player-socket' };
    room.tokens.push(npc as any, personal as any);
    player.tokens.push(npc as any);
    gateway.publishTokenDeleted('room-a', 'npc');
    expect(room.tokens).toEqual([personal]);
    expect(player.tokens).toEqual([]);
    expect(gateway.server.to).toHaveBeenCalledWith('room-a');
    expect(broadcast).toHaveBeenCalledWith('token-deleted', { tokenId: 'npc' });
  });
});
