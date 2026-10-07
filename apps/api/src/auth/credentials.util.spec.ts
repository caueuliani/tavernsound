import { credentials } from './credentials.util';

describe('Credential input validation', () => {
  it.each([null, {}, { email: {}, password: 'password' }, { email: 'a@b.test', password: [] }, { email: 'a@b.test', password: '🔒'.repeat(30) }])('rejects malformed input %j', value => {
    expect(() => credentials(value)).toThrow();
  });
  it('normalizes email and requires a stronger password only for registration', () => {
    expect(credentials({ email: ' Player@Example.test ', password: 'legacy' }).email).toBe('player@example.test');
    expect(() => credentials({ email: 'a@b.test', password: 'short' }, true)).toThrow('12 caracteres');
    expect(credentials({ email: 'a@b.test', password: 'longer-password' }, true).password).toBe('longer-password');
  });
});
