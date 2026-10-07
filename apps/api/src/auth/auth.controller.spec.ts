import { AuthController } from './auth.controller';
import * as bcrypt from 'bcryptjs';

describe('Account authentication', () => {
  let prisma: any;
  let sessions: any;
  let controller: AuthController;
  const previousInternal = process.env.INTERNAL_API_SECRET;
  const previousEnvironment = process.env.APP_ENV;
  const previousEmails = process.env.TEST_ALLOWED_EMAILS;
  beforeEach(() => {
    prisma = { user: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() }, account: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() } };
    sessions = { create: jest.fn().mockResolvedValue('persisted-session') };
    controller = new AuthController(prisma, sessions);
    process.env.INTERNAL_API_SECRET = 'test-internal-secret';
  });
  afterAll(() => {
    if (previousInternal === undefined) delete process.env.INTERNAL_API_SECRET; else process.env.INTERNAL_API_SECRET = previousInternal;
    if (previousEnvironment === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = previousEnvironment;
    if (previousEmails === undefined) delete process.env.TEST_ALLOWED_EMAILS; else process.env.TEST_ALLOWED_EMAILS = previousEmails;
  });

  it('permits beta registration, password login and verified Google login outside the legacy allowlist', async () => {
    process.env.APP_ENV = 'beta';
    process.env.TEST_ALLOWED_EMAILS = 'owner@example.test';
    prisma.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'new-user', email: 'new@example.test', passwordHash: await bcrypt.hash('valid-password', 4),
    }).mockResolvedValueOnce(null);
    prisma.user.create.mockResolvedValueOnce({ id: 'new-user', email: 'new@example.test' })
      .mockResolvedValueOnce({ id: 'google-user', email: 'google@example.test' });

    await expect(controller.register({ email: 'new@example.test', password: 'valid-password' })).resolves.toMatchObject({ success: true });
    await expect(controller.login({ email: 'new@example.test', password: 'valid-password' })).resolves.toMatchObject({ sessionToken: 'persisted-session' });
    await expect(controller.googleLogin({ email: 'google@example.test', providerAccountId: 'google-new', emailVerified: true }, 'test-internal-secret'))
      .resolves.toMatchObject({ user: { id: 'google-user' } });
  });

  it('issues a persisted session only after verifying the password', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'owner', email: 'owner@example.test', passwordHash: await bcrypt.hash('valid-password', 4) });
    await expect(controller.login({ email: 'owner@example.test', password: 'wrong' })).rejects.toThrow();
    expect(sessions.create).not.toHaveBeenCalled();
    await expect(controller.login({ email: 'owner@example.test', password: 'valid-password' })).resolves.toMatchObject({ sessionToken: 'persisted-session' });
  });
  it('does not expose the internal Google login endpoint without its secret', async () => {
    await expect(controller.googleLogin({ email: 'owner@example.test', providerAccountId: 'google-sub' }, 'wrong')).rejects.toThrow('Não autorizado');
    expect(prisma.account.findUnique).not.toHaveBeenCalled();
  });
  it('requires a verified Google email before looking up or linking an account', async () => {
    await expect(controller.googleLogin({ email: 'owner@example.test', providerAccountId: 'google-sub' }, 'test-internal-secret')).rejects.toThrow('não verificado');
    expect(prisma.account.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
  it('links a verified Google identity to the existing password account by normalized email', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'owner', email: 'Owner@Example.Test', passwordHash: 'existing-hash' });
    await expect(controller.googleLogin({ email: ' OWNER@example.test ', providerAccountId: 'google-sub', emailVerified: true }, 'test-internal-secret')).resolves.toMatchObject({ user: { id: 'owner' } });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: { equals: 'owner@example.test', mode: 'insensitive' } }, include: { subscription: true } });
    expect(prisma.account.create).toHaveBeenCalledWith({ data: { userId: 'owner', type: 'oauth', provider: 'google', providerAccountId: 'google-sub' } });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(sessions.create).toHaveBeenCalledWith('owner');
  });
  it('creates one user and Google identity for a new verified email', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-user', email: 'new@example.test' });
    await expect(controller.googleLogin({ email: ' NEW@Example.Test ', providerAccountId: 'google-new', emailVerified: true }, 'test-internal-secret')).resolves.toMatchObject({ user: { id: 'new-user' } });
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      email: 'new@example.test', accounts: { create: { type: 'oauth', provider: 'google', providerAccountId: 'google-new' } },
    }) }));
    expect(prisma.account.create).not.toHaveBeenCalled();
  });
  it('uses the persisted provider identity for an already-linked Google account', async () => {
    prisma.account.findUnique.mockResolvedValue({ userId: 'linked-user', user: { id: 'linked-user', email: 'original@example.test' } });
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(controller.googleLogin({ email: 'changed@example.test', providerAccountId: 'google-sub', emailVerified: true }, 'test-internal-secret')).resolves.toMatchObject({ user: { id: 'linked-user' } });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.account.create).not.toHaveBeenCalled();
  });
  it('does not move an existing Google identity to a different local account', async () => {
    prisma.account.findUnique.mockResolvedValue({ userId: 'linked-user', user: { id: 'linked-user', email: 'original@example.test' } });
    prisma.user.findFirst.mockResolvedValue({ id: 'other-user', email: 'other@example.test' });
    await expect(controller.googleLogin({ email: 'other@example.test', providerAccountId: 'google-sub', emailVerified: true }, 'test-internal-secret')).rejects.toThrow('outra conta');
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(sessions.create).not.toHaveBeenCalled();
  });
});
