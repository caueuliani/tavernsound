import { AuthController } from './auth.controller';
import * as bcrypt from 'bcryptjs';

describe('Account authentication', () => {
  let prisma: any;
  let sessions: any;
  let controller: AuthController;
  const previousInternal = process.env.INTERNAL_API_SECRET;
  beforeEach(() => {
    prisma = { user: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() }, account: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() } };
    sessions = { create: jest.fn().mockResolvedValue('persisted-session') };
    controller = new AuthController(prisma, sessions);
    process.env.INTERNAL_API_SECRET = 'test-internal-secret';
  });
  afterAll(() => { if (previousInternal === undefined) delete process.env.INTERNAL_API_SECRET; else process.env.INTERNAL_API_SECRET = previousInternal; });

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
  it('does not automatically link Google to an existing password account', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'owner', passwordHash: 'existing-hash' });
    await expect(controller.googleLogin({ email: 'owner@example.test', providerAccountId: 'google-sub' }, 'test-internal-secret')).rejects.toThrow('Vinculação Google');
    expect(sessions.create).not.toHaveBeenCalled();
  });
  it('uses the persisted provider identity for an already-linked Google account', async () => {
    prisma.account.findUnique.mockResolvedValue({ user: { id: 'linked-user', email: 'original@example.test' } });
    await expect(controller.googleLogin({ email: 'changed@example.test', providerAccountId: 'google-sub' }, 'test-internal-secret')).resolves.toMatchObject({ user: { id: 'linked-user' } });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
