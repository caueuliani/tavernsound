// Production uses the same public origin for Next, Nest and Socket.IO.
// An explicit override remains available for split local development.
export function apiUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || '/backend';
  return `${base}${path}`;
}

export function socketUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_API_URL || undefined;
}
