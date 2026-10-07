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
      token: { create: jest.fn(), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      scene: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue({ id: 'initial-ABC123', name: 'Cena inicial', position: 0 }), findUnique: jest.fn().mockResolvedValue({ name: 'Cena inicial', fogData: null }), findMany: jest.fn().mockResolvedValue([{ id: 'initial-ABC123', name: 'Cena inicial', position: 0 }]) },
      roomSceneAssignment: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async callback => callback(prisma)),
      diceRoll: { findMany: jest.fn().mockResolvedValue([]) },
      event: { findMany: jest.fn().mockResolvedValue([]) },
    };
    sessions = { require: jest.fn(), on: jest.fn(), voiceUid: jest.fn().mockReturnValue('allowed-uid') };
    access = { require: jest.fn(), requireOwner: jest.fn().mockResolvedValue({}) };
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
    const player: any = { id: client.id, roomId: 'room-a', isHost: true, viewedSceneId: 'initial-room-a', tokens: [] };
    const room: any = { id: 'room-a', tokens: [], players: new Map([[client.id, player]]) };
    (gateway as any).players.set(client.id, player);
    (gateway as any).rooms.set('room-a', room);
    return { player, room };
  };

  const joinPersistedRoom = async (userId: string, tokenUserId: string, sceneId = 'initial-ABC123') => {
    const tokenId = createHash('sha256').update(`ABC123:${tokenUserId}`).digest('hex');
    client.data.session = { id: userId, sid: 'session', name: userId };
    access.require.mockResolvedValue({});
    prisma.room.findUnique.mockResolvedValue({
      id: 'ABC123', name: 'Table', ownerId: 'owner', createdAt: new Date(), fogOfWarData: null, mapUrl: null,
      tokens: [{ id: tokenId, sceneId, x: 3, y: 4, color: '#ff9d00', name: tokenUserId, hp: 8, maxHp: 10 }],
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
    expect(broadcast).toHaveBeenCalledWith('token-moved', expect.objectContaining({ tokenId, playerId: tokenId }));
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

  it('restores the assigned scene and ownership of a personal token after restart', async () => {
    prisma.roomSceneAssignment.findUnique.mockResolvedValue({ sceneId: 'scene-b' });
    const { tokenId, joined, player } = await joinPersistedRoom('player', 'player', 'scene-b');
    expect(joined).toMatchObject({ sceneId: 'scene-b', tokens: [{ id: tokenId, sceneId: 'scene-b', playerId: client.id }] });
    expect(player.tokens[0].id).toBe(tokenId);
    gateway.handleMoveToken({ tokenId, x: 6, y: 6 }, client);
    expect(prisma.token.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: tokenId }, data: { x: 6, y: 6 } }));
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
      ['agora-uid-announced', { socketId: 'early', agoraUid: 'early-uid', isHost: false, sceneId: undefined }],
    ]);
    expect(broadcast).toHaveBeenCalledWith('agora-uid-announced', { socketId: client.id, agoraUid: 'allowed-uid', isHost: true, sceneId: undefined });
  });

  it('does not let a player claim global voice in the Agora announcement', () => {
    const { player } = prepareRoom();
    player.isHost = false;
    client.data.session = { id: 'player' };
    gateway.handleAnnounceAgoraUid({ socketId: client.id, agoraUid: 'allowed-uid', isHost: true } as any, client);
    expect(broadcast).toHaveBeenCalledWith('agora-uid-announced', { socketId: client.id, agoraUid: 'allowed-uid', isHost: false, sceneId: undefined });
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
    (player as any).userId = 'player';
    (player as any).sceneId = 'initial-room-a';
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

  it('lets the host transfer a player and personal token without moving an NPC', async () => {
    const { player: host, room } = prepareRoom();
    host.userId = 'owner';
    const target: any = { id: 'socket-2', userId: 'player', roomId: 'room-a', sceneId: 'initial-room-a', viewedSceneId: 'initial-room-a', isHost: false, tokens: [] };
    const personalId = createHash('sha256').update('room-a:player').digest('hex');
    const personal: any = { id: personalId, sceneId: 'initial-room-a', playerId: target.id, x: 2, y: 2 };
    const npc: any = { id: 'npc', sceneId: 'initial-room-a', playerId: 'npc', x: 4, y: 4 };
    target.tokens.push(personal);
    room.tokens.push(personal, npc);
    room.players.set(target.id, target);
    (gateway as any).players.set(target.id, target);
    prisma.scene.findFirst.mockResolvedValue({ id: 'scene-b', name: 'Subsolo', fogData: null });
    prisma.roomSceneAssignment.findUnique.mockResolvedValue({ sceneId: 'initial-room-a' });
    access.require.mockResolvedValue({});
    await gateway.handleTransferPlayerScene({ userId: 'player', sceneId: 'scene-b' }, client);
    expect(prisma.roomSceneAssignment.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { sceneId: 'scene-b' } }));
    expect(prisma.token.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: personalId, roomId: 'room-a' } }));
    expect(personal).toMatchObject({ sceneId: 'scene-b', playerId: target.id, x: 5, y: 5 });
    expect(npc).toMatchObject({ sceneId: 'initial-room-a', x: 4, y: 4 });
    expect(target).toMatchObject({ sceneId: 'scene-b', viewedSceneId: 'scene-b' });
    expect(broadcast).toHaveBeenCalledWith('scene-changed', expect.objectContaining({ sceneId: 'scene-b', tokens: [personal] }));
    gateway.handleMoveToken({ tokenId: personalId, x: 6, y: 6 }, { id: target.id } as any);
    expect(personal).toMatchObject({ x: 6, y: 6 });
  });

  it('does not let players transfer themselves or others between scenes', async () => {
    const { player } = prepareRoom();
    player.isHost = false;
    await gateway.handleTransferPlayerScene({ userId: 'player', sceneId: 'scene-b' }, client);
    await gateway.handleViewScene({ sceneId: 'scene-b' }, client);
    expect(prisma.roomSceneAssignment.upsert).not.toHaveBeenCalled();
    expect(prisma.scene.findFirst).not.toHaveBeenCalled();
    expect(player.viewedSceneId).toBe('initial-room-a');
  });

  it('rechecks room ownership before accepting a scene transfer', async () => {
    const { player } = prepareRoom();
    player.userId = 'former-owner';
    access.requireOwner.mockRejectedValue(new Error('no longer owner'));
    await gateway.handleTransferPlayerScene({ userId: 'player', sceneId: 'scene-b' }, client);
    expect(prisma.scene.findFirst).not.toHaveBeenCalled();
    expect(prisma.roomSceneAssignment.upsert).not.toHaveBeenCalled();
  });

  it('lets the host look at another scene without transferring players', async () => {
    const { player, room } = prepareRoom();
    const target: any = { id: 'socket-2', userId: 'player', sceneId: 'initial-room-a', viewedSceneId: 'initial-room-a', isHost: false };
    room.players.set(target.id, target);
    prisma.scene.findFirst.mockResolvedValue({ id: 'scene-b', name: 'Subsolo', fogData: null });
    await gateway.handleViewScene({ sceneId: 'scene-b' }, client);
    expect(player.viewedSceneId).toBe('scene-b');
    expect(target.sceneId).toBe('initial-room-a');
    expect(prisma.roomSceneAssignment.upsert).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('scene-changed', expect.objectContaining({ sceneId: 'scene-b', tokens: [] }));
  });

  it('persists fog only in the scene viewed by the host', async () => {
    const { player } = prepareRoom();
    player.viewedSceneId = 'scene-b';
    prisma.scene.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    await gateway.handleFogUpdate({ fogData: new Array(100).fill(false) }, client);
    expect(prisma.scene.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'scene-b', roomId: 'room-a' } }));
  });
});
