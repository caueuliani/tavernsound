import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createProxy } from './proxy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const port = Number(process.env.PORT || 8080);
const apiPort = 3101, webPort = 3100;
if ([apiPort, webPort].includes(port)) throw new Error('PORT conflicts with an internal port');
const publicOrigin = new URL(process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).origin;
if (process.env.NODE_ENV === 'production' && !publicOrigin.startsWith('https://') && !publicOrigin.startsWith('http://localhost:')) throw new Error('Production requires HTTPS');
for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'INTERNAL_API_SECRET']) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}
const env = { ...process.env, NODE_ENV: 'production', TEST_MODE: process.env.TEST_MODE || 'true', FRONTEND_URL: publicOrigin, NEXTAUTH_URL: publicOrigin, API_URL: `http://127.0.0.1:${apiPort}` };
// Agora's App ID is public and can be exposed separately; never expose the certificate.
const children = [];
let server;
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  server?.close();
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 3000).unref();
}
function launch(args, extra = {}) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...env, ...extra }, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.once('error', error => { console.error(error.message); stop(1); });
  child.once('exit', code => { if (!stopping) stop(code || 1); });
  return child;
}
// Migrations are an explicit manual release step, never run on service wake-up.
launch(['apps/api/dist/main.js'], { PORT: String(apiPort), API_BIND_HOST: '127.0.0.1' });
launch([require.resolve('next/dist/bin/next'), 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', String(webPort)]);
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
process.on('message', message => { if (message === 'stop') stop(); });
async function ready(internalPort) {
  for (let i = 0; i < 90 && !stopping; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${internalPort}${internalPort === webPort ? '/login' : '/'}`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Internal service did not become ready');
}
try {
  await Promise.all([ready(apiPort), ready(webPort)]);
  if (!stopping) {
    const tls = process.env.LOCAL_TLS_CERT && process.env.LOCAL_TLS_KEY ? {
      cert: await readFile(process.env.LOCAL_TLS_CERT), key: await readFile(process.env.LOCAL_TLS_KEY),
    } : undefined;
    server = createProxy({ apiPort, webPort, publicOrigin, tls });
    server.on('error', error => { console.error(error.message); stop(1); });
    server.listen(port, '0.0.0.0', () => console.log(`TavernSound available at ${publicOrigin}`));
  }
} catch (error) { console.error(error.message); stop(1); }
