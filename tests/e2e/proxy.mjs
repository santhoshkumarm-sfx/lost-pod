// Local stand-in for the Supabase gateway: forwards /rest/v1 to PostgREST and answers the few
// GoTrue endpoints the app calls during page rendering (GET /auth/v1/user) from the JWT itself.
import http from 'node:http';

const PGRST = 'http://127.0.0.1:3001';
const decode = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    try {
      const c = decode(token);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: c.sub, aud: 'authenticated', role: 'authenticated', email: c.email, app_metadata: {}, user_metadata: {}, created_at: '2026-09-01T00:00:00Z' }));
    } catch {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ message: 'invalid token' }));
    }
  }
  if (url.pathname.startsWith('/auth/v1/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{}');
  }
  if (!url.pathname.startsWith('/rest/v1')) {
    res.writeHead(404);
    return res.end();
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  const r = await fetch(PGRST + url.pathname.slice('/rest/v1'.length) + url.search, {
    method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const out = Buffer.from(await r.arrayBuffer());
  const h = {};
  r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k)) h[k] = v; });
  res.writeHead(r.status, h);
  res.end(out);
}).listen(54321, () => console.log('proxy on 54321'));
