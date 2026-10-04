import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { TestSafetyService } from '../safety/test-safety.service';
import { TEST_LIMITS } from '../safety/test-policy';
import { budgetDatabase } from '../safety/test-database.double';

describe('Socket and HTTP authentication integration (in-memory database double)', () => {
  let app: INestApplication;
  let sessions: SessionService;
  let url: string;
  const clients: Socket[] = [];
  const stored = new Map<string, any>();
  const previousSecret = process.env.SESSION_SECRET;
  const previousOrigin = process.env.FRONTEND_URL;
  let budget = budgetDatabase();
  const prisma = {
    $transaction: (action: any) => budget.$transaction(action),
    session: {
      create: jest.fn(async ({ data }) => { stored.set(data.sessionToken, { ...data, user: { id: data.userId, name: data.userId, email: `${data.userId}@example.test` } }); }),
      findUnique: jest.fn(async ({ where }) => stored.get(where.sessionToken) || null),
      deleteMany: jest.fn(async ({ where }) => { stored.delete(where.sessionToken); return { count: 1 }; }),
    },
    room: {
      findUnique: jest.fn(async () => ({ id: 'ABC123', name: 'Private table', ownerId: 'owner', createdAt: new Date(), isPublic: false, password: null, tokens: [] })),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    roomMember: { findFirst: jest.fn().mockResolvedValue(null) },
    subscription: { findUnique: jest.fn().mockResolvedValue(null) },
    diceRoll: { findMany: jest.fn().mockResolvedValue([]) },
    event: { findMany: jest.fn().mockResolvedValue([]) },
  };

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'integration-test-secret';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    sessions = app.get(SessionService);
  });
  afterEach(() => { clients.splice(0).forEach(client => client.disconnect()); stored.clear(); });
  afterAll(async () => {
    await app?.close();
    if (previousSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previousSecret;
    if (previousOrigin === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = previousOrigin;
  });

  function client(cookie?: string, origin = 'http://localhost:3000') {
    const socket = io(url, { autoConnect: false, transports: ['websocket'], reconnection: false, extraHeaders: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
    clients.push(socket);
    return socket;
  }
  function event(socket: Socket, name: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 2500);
      socket.once(name, data => { clearTimeout(timeout); resolve(data); });
    });
  }
  async function connect(socket: Socket) {
    const connected = event(socket, 'connect'); socket.connect(); await connected;
  }

  it('rejects an anonymous handshake', async () => {
    const socket = client(); const rejected = event(socket, 'connect_error'); socket.connect();
    expect((await rejected).message).toContain('Faça login');
  });
  it('rejects a foreign browser origin even with a valid session', async () => {
    const cookie = `user-session=${await sessions.create('owner')}`;
    const socket = client(cookie, 'https://evil.example'); const rejected = event(socket, 'connect_error'); socket.connect();
    expect((await rejected).message).toContain('Faça login');
  });
  it('does not disclose private room state to an authenticated outsider', async () => {
    const socket = client(`user-session=${await sessions.create('stranger')}`); await connect(socket);
    const joined = jest.fn(); socket.on('room-joined', joined);
    const rejected = event(socket, 'room-error'); socket.emit('join-room', { roomId: 'ABC123' });
    expect((await rejected).message).toContain('não autorizada'); expect(joined).not.toHaveBeenCalled();
  });
  it('lets the owner join and disconnects the socket when HTTP logout revokes the session', async () => {
    const cookie = `user-session=${await sessions.create('owner')}`;
    const socket = client(cookie); await connect(socket);
    const joined = event(socket, 'room-joined'); socket.emit('join-room', { roomId: 'ABC123' });
    expect(await joined).toMatchObject({ roomId: 'ABC123', isHost: true });
    const disconnected = event(socket, 'disconnect');
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookie).expect(201);
    expect(await disconnected).toBe('io server disconnect');
    await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie).expect(401);
  });
  it('revalidates an existing socket before processing another event', async () => {
    const socket = client(`user-session=${await sessions.create('owner')}`); await connect(socket);
    stored.clear();
    const disconnected = event(socket, 'disconnect'); socket.emit('create-room', { name: 'Denied' });
    await disconnected; expect(prisma.room.create).not.toHaveBeenCalled();
  });
  it('denies HTTP voice tokens for an outsider before using Agora credentials', async () => {
    const cookie = `user-session=${await sessions.create('stranger')}`;
    await request(app.getHttpServer()).get('/agora/token?channelName=ABC123&uid=forged').set('Cookie', cookie).expect(403);
  });

  describe('beta enforcement over real HTTP and WebSocket connections', () => {
    beforeEach(() => {
      budget = budgetDatabase();
      process.env.TEST_MODE = 'true';
      process.env.TEST_ALLOWED_EMAILS = 'owner@example.test';
    });
    afterEach(() => {
      process.env.TEST_MODE = 'false';
      delete process.env.TEST_ALLOWED_EMAILS;
      jest.restoreAllMocks();
    });
    it('rejects registration and existing sessions outside the allowlist', async () => {
      await request(app.getHttpServer()).post('/auth/register').send({ email: 'outsider@example.test', password: 'long-password' }).expect(403);
      const cookie = `user-session=${await sessions.create('outsider')}`;
      await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie).expect(403);
      const socket = client(cookie); const denied = event(socket, 'connect_error'); socket.connect(); await denied;
    });
    it('denies voice without a live test-room connection and disables checkout', async () => {
      const cookie = `user-session=${await sessions.create('owner')}`;
      await request(app.getHttpServer()).get('/agora/token?channelName=ABC123').set('Cookie', cookie).expect(403);
      await request(app.getHttpServer()).post('/subscriptions/checkout').set('Cookie', cookie).send({ tier: 'PRO' }).expect(403);
    });
    it('blocks upload events before persisting map data', async () => {
      const socket = client(`user-session=${await sessions.create('owner')}`); await connect(socket);
      const joined = event(socket, 'room-joined'); socket.emit('join-room', { roomId: 'ABC123' });
      expect(await joined).toMatchObject({ testMode: true, testEndsAt: null });
      const denied = event(socket, 'room-error');
      socket.emit('upload-map', { mapData: 'data:image/png;base64,AAAA', width: 10, height: 10 });
      expect((await denied).message).toContain('Uploads');
      expect(prisma.room.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mapUrl: expect.anything() }) }));
    });
    it('keeps the room connected after the voice quota is exhausted', async () => {
      const localBudget = budget;
      localBudget.state.reservedMinutes = TEST_LIMITS.dailyMinutes;
      const socket = client(`user-session=${await sessions.create('owner')}`); await connect(socket);
      const joined = event(socket, 'room-joined'); socket.emit('join-room', { roomId: 'ABC123' });
      expect(await joined).toMatchObject({ roomId: 'ABC123', testEndsAt: null });
      expect(socket.connected).toBe(true);
    });
  });
});
