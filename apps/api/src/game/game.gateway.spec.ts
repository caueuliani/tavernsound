import { GameGateway } from './game.gateway';
import { TestSafetyService } from '../safety/test-safety.service';

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
      room: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({}) },
      token: { create: jest.fn(), update: jest.fn() },
    };
    sessions = { require: jest.fn(), on: jest.fn(), voiceUid: jest.fn().mockReturnValue('allowed-uid') };
    access = { require: jest.fn() };
    gateway = new GameGateway(prisma, sessions, access, new TestSafetyService(prisma));
    client = { id: 'socket-1', data: {}, handshake: { headers: {} }, emit: jest.fn(), disconnect: jest.fn() };
    broadcast = jest.fn();
    gateway.server = { to: jest.fn().mockReturnValue({ emit: broadcast }) } as any;
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
    const player = { id: client.id, roomId: 'room-a', isHost: true, tokens: [] };
    const room = { id: 'room-a', tokens: [], players: new Map([[client.id, player]]) };
    (gateway as any).players.set(client.id, player);
    (gateway as any).rooms.set('room-a', room);
    return { player, room };
  };

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
});
