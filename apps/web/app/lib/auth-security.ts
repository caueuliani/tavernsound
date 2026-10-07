export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/';
  try {
    const url = new URL(value, 'https://tavernsound.invalid');
    return url.origin === 'https://tavernsound.invalid' ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch { return '/'; }
}

export function isSessionClaims(value: unknown): value is { id: string; sid: string; iat: number; exp: number } {
  if (!value || typeof value !== 'object') return false;
  const claims = value as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  return typeof claims.id === 'string' && claims.id.length > 0 &&
    typeof claims.sid === 'string' && /^[a-f0-9]{64}$/.test(claims.sid) &&
    typeof claims.iat === 'number' && Number.isSafeInteger(claims.iat) && claims.iat <= now &&
    typeof claims.exp === 'number' && Number.isSafeInteger(claims.exp) && claims.exp > now && claims.exp > claims.iat;
}

export function trustedMutation(request: Request): boolean {
  const expected = new URL(process.env.NEXTAUTH_URL || request.url).origin;
  return request.headers.get('origin') === expected;
}
