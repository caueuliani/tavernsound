import { SessionService } from './session.service';
import { verifySession } from '../common/session.util';

describe('Persisted sessions', () => {
  const oldSecret = process.env.SESSION_SECRET;
  let saved: any;
  let prisma: any;
  let service: SessionService;
  beforeEach(() => {
    process.env.SESSION_SECRET = 'unit-test-secret';
    saved = null;
    prisma = { session: {
      create: jest.fn(async ({ data }) => { saved = { ...data, user: { id: data.userId, name: 'Player', email: 'player@example.test' } }; }),
      findUnique: jest.fn(async ({ where }) => saved?.sessionToken === where.sessionToken ? saved : null),
      deleteMany: jest.fn(async () => { saved = null; }),
    } };
    service = new SessionService(prisma);
  });
  afterAll(() => { if (oldSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = oldSecret; });

  it('stores only a hash and authenticates against the database', async () => {
    const token = await service.create('user-1');
    expect(saved.sessionToken).not.toBe(verifySession(token)?.sid);
    expect(await service.require(`user-session=${token}`)).toMatchObject({ id: 'user-1' });
  });

  it('rejects a previously valid cookie after logout and signals connected sockets', async () => {
    const token = await service.create('user-1');
    const revoked = jest.fn(); service.on('revoked', revoked);
    await service.revoke(`user-session=${token}`);
    expect(revoked).toHaveBeenCalledWith(verifySession(token)?.sid);
    await expect(service.require(`user-session=${token}`)).rejects.toThrow('Sessão expirada');
  });

  it('rejects server-expired sessions even if the signed token is still valid', async () => {
    const token = await service.create('user-1');
    saved.expires = new Date(0);
    expect(await service.resolve(`user-session=${token}`)).toBeNull();
  });

  it('rejects a session whose database owner does not match the signed identity', async () => {
    const token = await service.create('user-1'); saved.userId = 'other-user';
    expect(await service.resolve(`user-session=${token}`)).toBeNull();
  });
});
