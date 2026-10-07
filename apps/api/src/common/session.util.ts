import { createHmac, timingSafeEqual } from 'crypto';

export interface SessionClaims {
  id: string;
  sid: string;
  iat: number;
  exp: number;
}

function secret(): string {
  const value = process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error('SESSION_SECRET env var não definida');
  return value;
}

export function signSession(claims: SessionClaims): string {
  const data = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${data}.${createHmac('sha256', secret()).update(data).digest('base64url')}`;
}

export function verifySession(token: string): SessionClaims | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const [data, signature, extra] = token.split('.');
  if (!data || !signature || extra !== undefined) return null;
  try {
    const actual = Buffer.from(signature, 'base64url');
    const expected = createHmac('sha256', secret()).update(data).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const claims = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (!claims || typeof claims.id !== 'string' || !claims.id ||
        typeof claims.sid !== 'string' || !/^[a-f0-9]{64}$/.test(claims.sid) ||
        !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
        claims.iat > now || claims.exp <= now || claims.exp <= claims.iat) return null;
    return claims;
  } catch { return null; }
}

export function sessionCookie(header?: string): string | null {
  for (const part of (header || '').split(';')) {
    const index = part.indexOf('=');
    if (part.slice(0, index).trim() !== 'user-session') continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); }
    catch { return null; }
  }
  return null;
}
