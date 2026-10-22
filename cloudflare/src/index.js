// RobroTaxi HQ on Cloudflare: one container runs the game server (../mcp); this Worker fronts it.
// The container keeps results, run logs and notes in R2 by calling http://robro-store, which never
// leaves Cloudflare: the request is intercepted below and served from the STORE bucket.
import { Container, getContainer } from '@cloudflare/containers';
// needed for outbound interception (the robro-store handler)
export { ContainerProxy } from '@cloudflare/containers';

const KEY = /^(results\.jsonl|logs\/[\w-]+\.json|notes\/[\w-]+\.md)$/;
const MAX_OBJECT = 8 * 1024 * 1024;

async function store(req, env) {
  const url = new URL(req.url);
  if (url.pathname === '/list' && req.method === 'GET') {
    const prefix = url.searchParams.get('prefix') || '';
    if (!/^(notes|logs)\/$/.test(prefix)) return new Response('bad prefix', { status: 400 });
    const keys = []; let cursor;
    do { const r = await env.STORE.list({ prefix, cursor }); keys.push(...r.objects.map((o) => o.key)); cursor = r.truncated ? r.cursor : undefined; } while (cursor && keys.length < 10000);
    return Response.json(keys);
  }
  const key = url.pathname.replace(/^\/obj\//, '');
  if (!KEY.test(key)) return new Response('bad key', { status: 400 });
  if (req.method === 'GET') {
    const obj = await env.STORE.get(key);
    return obj ? new Response(obj.body) : new Response('not found', { status: 404 });
  }
  if (req.method === 'PUT') {
    const body = await req.text();
    if (body.length > MAX_OBJECT) return new Response('too large', { status: 413 });
    await env.STORE.put(key, body);
    return new Response('ok');
  }
  return new Response('method not allowed', { status: 405 });
}

export class RobroHQ extends Container {
  defaultPort = 8787;
  sleepAfter = '45m';          // games live in memory; idle games are closed after 30 min anyway
  enableInternet = false;      // the server needs nothing outside Cloudflare
  envVars = { ROBRO_STORE_URL: 'http://robro-store', ROBRO_TRUST_PROXY: 'cloudflare' };
}
// assigned after the class (not as a static field) so the package's setter registers the handler
RobroHQ.outboundByHost = { 'robro-store': (req, env) => store(req, env) };

export default {
  async fetch(request, env) {
    // one container serves every player, so live games and MCP sessions stay in one place
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') || '');
    // so watch links the server hands to models point at this public address
    const url = new URL(request.url);
    headers.set('x-forwarded-host', url.host); headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
    return getContainer(env.HQ, 'hq').fetch(new Request(request, { headers }));
  },
};
