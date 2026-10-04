import { safeReturnPath, trustedMutation } from '../../../web/app/lib/auth-security';
import { createOAuthAttempt, readOAuthAttempt } from '../../../web/app/lib/oauth';
import { verifySession as verifyWebSession } from '../../../web/app/lib/session';
import { signSession } from './session.util';
import { allowedMutationOrigin } from './origin.util';

describe('Browser authentication boundary', () => {
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/\nevil'])('rejects external return path %s', value => {
    expect(safeReturnPath(value)).toBe('/');
  });
  it('keeps an internal destination', () => {
    expect(safeReturnPath('/room/ABC123?tab=chat')).toBe('/room/ABC123?tab=chat');
  });
  it('requires matching browser origin for web mutations', () => {
    const origin = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    expect(trustedMutation(new Request(`${origin}/api/auth/logout`, { headers: { origin: new URL(origin).origin } }))).toBe(true);
    expect(trustedMutation(new Request(`${origin}/api/auth/logout`, { headers: { origin: 'https://evil.example' } }))).toBe(false);
    expect(trustedMutation(new Request(`${origin}/api/auth/logout`))).toBe(false);
  });
  it('rejects cross-site API mutations while allowing server requests', () => {
    expect(allowedMutationOrigin('https://evil.example', 'cross-site')).toBe(false);
    expect(allowedMutationOrigin(undefined, 'cross-site')).toBe(false);
    expect(allowedMutationOrigin(undefined, undefined)).toBe(true);
  });
  it('binds Google state to the originating browser and rejects expiry', () => {
    const first = createOAuthAttempt('/room/ABC123');
    const second = createOAuthAttempt('/');
    expect(readOAuthAttempt(first.cookie, first.state)?.returnTo).toBe('/room/ABC123');
    expect(readOAuthAttempt(first.cookie, second.state)).toBeNull();
    expect(readOAuthAttempt(undefined, first.state)).toBeNull();
    expect(readOAuthAttempt(JSON.stringify({ ...JSON.parse(first.cookie), expires: 0 }), first.state)).toBeNull();
    expect(first.challenge).not.toBe(JSON.parse(first.cookie).verifier);
  });
  it('accepts API sessions in the web verifier but rejects old and expired cookies', () => {
    const previous = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'cross-app-test-secret';
    try {
      const now = Math.floor(Date.now() / 1000);
      const claims = { id: 'player', sid: 'b'.repeat(64), iat: now, exp: now + 60 };
      expect(verifyWebSession(signSession(claims))).toEqual(claims);
      expect(verifyWebSession(signSession({ ...claims, exp: now - 1 }))).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous;
    }
  });
});
