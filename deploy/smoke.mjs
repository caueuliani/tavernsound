// Built application + real local PostgreSQL + actual reverse proxy.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { io } = require('socket.io-client');
const database = new URL(process.env.DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(database.hostname) || database.pathname !== '/tavernsound_test') throw new Error('Local disposable database required');
const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://localhost:18080';
const email = `smoke-${Date.now()}@example.test`, password = randomBytes(20).toString('hex');
const server = spawn(process.execPath, ['deploy/start.mjs'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: {
  ...process.env, PORT: '18080', PUBLIC_ORIGIN: origin, SESSION_SECRET: randomBytes(32).toString('hex'),
  INTERNAL_API_SECRET: randomBytes(32).toString('hex'), TEST_MODE: 'true', TEST_ALLOWED_EMAILS: email,
} });
let log = '';
server.stdout.on('data', chunk => { log = (log + chunk).slice(-8000); });
server.stderr.on('data', chunk => { log = (log + chunk).slice(-8000); });
let socket;
const event = (client, name) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 5000);
  client.once(name, value => { clearTimeout(timer); resolve(value); });
});
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error('Application exited before becoming ready');
    try { if ((await fetch(`${origin}/login`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(ready, 'App startup timed out');
  const home = await fetch(origin, { redirect: 'manual' });
  assert.equal(home.status, 200);
  const rooms = await fetch(`${origin}/rooms`, { redirect: 'manual' });
  const loginDestination = new URL(rooms.headers.get('location'));
  assert.equal(loginDestination.origin, origin);
  assert.equal(loginDestination.pathname, '/login');
  assert.equal(loginDestination.searchParams.get('callbackUrl'), '/rooms');
  const callback = await fetch(`${origin}/api/auth/google/callback?code=invalid&state=invalid`, { redirect: 'manual' });
  assert.equal(new URL(callback.headers.get('location')).origin, origin);
  const post = (path, body, cookie) => fetch(`${origin}${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post('/api/auth/register', { email, password })).status, 200);
  const login = await post('/api/auth/callback/credentials', { email, password });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(`${origin}/backend/rooms`, { headers: { Cookie: cookie } })).status, 200);
  socket = io(origin, { autoConnect: false, transports: ['websocket'], reconnection: false, extraHeaders: { Origin: origin, Cookie: cookie } });
  const connected = event(socket, 'connect'); socket.connect(); await connected;
  const created = await new Promise((resolve, reject) => socket.timeout(5000).emit('create-room', { name: 'Local smoke room' }, (error, value) => error ? reject(error) : resolve(value)));
  assert.match(created.roomId, /^[A-Z0-9]{6}$/);
  const joined = event(socket, 'room-joined'); socket.emit('join-room', { roomId: created.roomId });
  assert.equal((await joined).testMode, true);
  const disconnected = event(socket, 'disconnect');
  assert.equal((await post('/api/auth/logout', {}, cookie)).status, 200); await disconnected;
  assert.equal((await fetch(`${origin}/backend/rooms`, { headers: { Cookie: cookie } })).status, 401);
  console.log('Full local smoke passed: public redirects, registration, login cookie, HTTP API, WebSocket room creation/join, logout and replay rejection.');
} catch (error) { console.error(log); throw error; }
finally {
  socket?.disconnect();
  if (server.connected) server.send('stop');
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
}
