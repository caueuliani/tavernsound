export function allowedMutationOrigin(origin: string | undefined, fetchSite: string | undefined): boolean {
  const expected = process.env.FRONTEND_URL || 'http://localhost:3000';
  if (origin) return origin === expected;
  // Requests from the web server/CLI have no browser metadata.
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none';
}
