import { UnauthorizedException } from '@nestjs/common';
import { SessionAuthGuard } from './session-auth.guard';

describe('Campaign session guard', () => {
  it('uses the validated session identity instead of a supplied user', async () => {
    const sessions = { require: jest.fn().mockResolvedValue({ id: 'real-user' }) };
    const request = { headers: { cookie: 'session' }, user: { id: 'forged-user' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    expect(await new SessionAuthGuard(sessions as any).canActivate(context)).toBe(true);
    expect(request.user.id).toBe('real-user');
    expect(sessions.require).toHaveBeenCalledWith('session');
  });
  it('rejects missing or expired sessions', async () => {
    const sessions = { require: jest.fn().mockRejectedValue(new UnauthorizedException()) };
    const context = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) } as any;
    await expect(new SessionAuthGuard(sessions as any).canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
