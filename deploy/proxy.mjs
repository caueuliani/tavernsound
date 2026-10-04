import http from 'node:http';
import https from 'node:https';

// Fixed loopback upstreams: no client-controlled proxy destination.
export function createProxy({ apiPort, webPort, publicOrigin, tls }) {
  const origin = new URL(publicOrigin);
  const target = raw => {
    // Reject ambiguous URL forms rather than normalizing them into another route.
    if (!raw?.startsWith('/') || raw.startsWith('//') || /[\\\r\n]/.test(raw)) return null;
    const pathname = raw.split('?')[0];
    if (pathname === '/backend' || pathname.startsWith('/backend/')) {
      return { port: apiPort, path: raw.slice('/backend'.length) || '/', api: true };
    }
    if (pathname.startsWith('/socket.io/')) return { port: apiPort, path: raw, socket: true };
    return { port: webPort, path: raw };
  };
  const headers = req => {
    const result = { ...req.headers, host: origin.host, 'x-forwarded-host': origin.host, 'x-forwarded-proto': origin.protocol.slice(0, -1) };
    // Never propagate forged client identity or internal credentials.
    delete result['x-forwarded-for'];
    delete result['forwarded'];
    delete result['x-internal-secret'];
    return result;
  };
  const handler = (req, res) => {
    const route = target(req.url);
    if (!route) { res.writeHead(400).end(); return; }
    // Internal OAuth exchange must be called by Next over loopback only.
    if (route.api && /^\/auth\/google-login(?:[/?]|$)/.test(route.path)) { res.writeHead(404).end(); return; }
    const upstream = http.request({ hostname: '127.0.0.1', port: route.port, path: route.path, method: req.method, headers: headers(req) }, response => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    });
    upstream.setTimeout(30_000, () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Serviço temporariamente indisponível.'); });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
    req.pipe(upstream);
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  server.on('upgrade', (req, socket, head) => {
    const route = target(req.url);
    if (!route?.socket || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
    const upstream = http.request({ hostname: '127.0.0.1', port: apiPort, path: route.path, headers: headers(req) });
    upstream.setTimeout(10_000, () => upstream.destroy());
    upstream.on('upgrade', (response, peer, upstreamHead) => {
      upstream.setTimeout(0);
      socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n`);
      for (let i = 0; i < response.rawHeaders.length; i += 2) socket.write(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`);
      socket.write('\r\n');
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) peer.write(head);
      socket.on('error', () => peer.destroy());
      peer.on('error', () => socket.destroy());
      socket.on('close', () => peer.destroy());
      peer.on('close', () => socket.destroy());
      peer.pipe(socket); socket.pipe(peer);
    });
    upstream.on('response', response => { response.resume(); socket.destroy(); });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    upstream.end();
  });
  return server;
}
