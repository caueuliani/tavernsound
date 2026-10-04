import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { createProxy } from './proxy.mjs';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { Server } = apiRequire('socket.io');
const { io } = webRequire('socket.io-client');
let api, web, proxy, sockets, url;
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
before(async () => {
  const echo = label => async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Set-Cookie', 'test-session=opaque; HttpOnly; Path=/; SameSite=Lax');
    res.end(JSON.stringify({ label, path: req.url, cookie: req.headers.cookie, host: req.headers.host, forwarded: req.headers['x-forwarded-for'], secret: req.headers['x-internal-secret'], body: Buffer.concat(chunks).toString() }));
  };
  api = http.createServer(echo('api')); web = http.createServer(echo('web'));
  sockets = new Server(api);
  sockets.on('connection', socket => socket.emit('identity', { cookie: socket.handshake.headers.cookie }));
  await Promise.all([listen(api), listen(web)]);
  proxy = createProxy({ apiPort: api.address().port, webPort: web.address().port, publicOrigin: 'https://tavernsound.example' });
  await listen(proxy); url = `http://127.0.0.1:${proxy.address().port}`;
});
after(async () => {
  await new Promise(resolve => sockets.close(resolve));
  await Promise.all([web, proxy].map(server => new Promise(resolve => server.close(resolve))));
});
test('routes Next auth and Nest HTTP through the same cookie origin', async () => {
  const response = await fetch(`${url}/api/auth/me`, { headers: { Cookie: 'user-session=test' } });
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await response.json()).label, 'web');
  const backend = await fetch(`${url}/backend/rooms?test=1`, { method: 'POST', body: 'example', headers: { Cookie: 'user-session=test', 'x-forwarded-for': 'spoofed', 'x-internal-secret': 'spoofed' } });
  assert.deepEqual(await backend.json(), { label: 'api', path: '/rooms?test=1', cookie: 'user-session=test', host: 'tavernsound.example', body: 'example' });
});
test('does not expose the internal Google identity exchange', async () => {
  assert.equal((await fetch(`${url}/backend/auth/google-login`, { method: 'POST' })).status, 404);
});
test('forwards a real WebSocket upgrade and its session cookie', async () => {
  const socket = io(url, { transports: ['websocket'], reconnection: false, extraHeaders: { Cookie: 'user-session=test' } });
  try {
    const identity = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket timeout')), 3000);
      socket.once('identity', value => { clearTimeout(timer); resolve(value); });
      socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
    });
    assert.deepEqual(identity, { cookie: 'user-session=test' });
  } finally { socket.disconnect(); }
});
