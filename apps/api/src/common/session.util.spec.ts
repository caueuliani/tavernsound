import { createHmac } from 'crypto';
import { verifySession } from './session.util';

describe('verifySession', () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalFallback = process.env.NEXTAUTH_SECRET;
  const claims = () => ({ id: 'user-1', sid: 'a'.repeat(64), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  const token = (secret: string, payload: unknown = claims()) => {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
  };

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
    if (originalFallback === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = originalFallback;
  });

  it('rejects a signature forged with an empty secret when configuration is missing', () => {
    delete process.env.SESSION_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    expect(verifySession(token(''))).toBeNull();
  });

  it('accepts the configured secret and rejects a different signature', () => {
    process.env.SESSION_SECRET = 'test-session-secret';
    expect(verifySession(token('test-session-secret'))).toMatchObject({ id: 'user-1', sid: 'a'.repeat(64) });
    expect(verifySession(token('wrong-secret'))).toBeNull();
  });

  it('supports the same legacy fallback as the web application', () => {
    delete process.env.SESSION_SECRET;
    process.env.NEXTAUTH_SECRET = 'legacy-test-secret';
    expect(verifySession(token('legacy-test-secret'))).toMatchObject({ id: 'user-1' });
  });

  it.each([
    { id: 'user-1' }, null, [],
    { ...claims(), exp: 1 },
    { ...claims(), iat: Math.floor(Date.now() / 1000) + 3600 },
    { ...claims(), sid: '' },
  ])('rejects invalid or expired signed claims: %j', payload => {
    process.env.SESSION_SECRET = 'test-session-secret';
    expect(verifySession(token('test-session-secret', payload))).toBeNull();
  });
});
