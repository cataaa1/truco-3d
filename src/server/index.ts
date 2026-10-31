import { DurableObject } from 'cloudflare:workers';
import type { PlayerCount } from '../engine/game';
import type { PublicRoom } from '../shared/protocol';
import { Room } from './room';

export { Room };

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  DIRECTORY: DurableObjectNamespace<Directory>;
}

const FAIL_WINDOW_MS = 60_000;
const MAX_FAILS = 30;
const LISTED_TTL_MS = 10 * 60_000;

/** Lista de salas públicas y límite de intentos para que no se puedan adivinar códigos. */
export class Directory extends DurableObject<Env> {
  private fails = new Map<string, { count: number; since: number }>();

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/list') return Response.json(await this.openRooms());
    const body = (await request.json()) as Record<string, string>;
    switch (url.pathname) {
      case '/upsert':
        await this.ctx.storage.put(`room:${body.code}`, { room: body, at: Date.now() });
        return new Response('ok');
      case '/remove':
        await this.ctx.storage.delete(`room:${body.code}`);
        return new Response('ok');
      case '/blocked':
        return Response.json(this.isBlocked(body.ip ?? ''));
      case '/fail':
        this.addFail(body.ip ?? '');
        return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }

  private async openRooms(): Promise<PublicRoom[]> {
    const listed = await this.ctx.storage.list<{ room: PublicRoom; at: number }>({ prefix: 'room:' });
    const now = Date.now();
    const rooms: PublicRoom[] = [];
    for (const [key, { room, at }] of listed) {
      if (now - at > LISTED_TTL_MS) await this.ctx.storage.delete(key);
      else if (room.taken < room.players) rooms.push(room);
    }
    return rooms;
  }

  private isBlocked(ip: string): boolean {
    const entry = this.fails.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.since > FAIL_WINDOW_MS) {
      this.fails.delete(ip);
      return false;
    }
    return entry.count >= MAX_FAILS;
  }

  private addFail(ip: string): void {
    const now = Date.now();
    const entry = this.fails.get(ip);
    if (!entry || now - entry.since > FAIL_WINDOW_MS) this.fails.set(ip, { count: 1, since: now });
    else entry.count += 1;
  }
}

const directory = (env: Env) => env.DIRECTORY.get(env.DIRECTORY.idFromName('main'));
const room = (env: Env, code: string) => env.ROOM.get(env.ROOM.idFromName(code));

async function createRoom(
  env: Env,
  options: { players: PlayerCount; target: 15 | 30; public: boolean; quick: boolean },
): Promise<string | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
    const response = await room(env, code).fetch('https://room/init', {
      method: 'POST',
      body: JSON.stringify({ code, ...options }),
    });
    if (response.status === 201) return code;
  }
  return null;
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const path = url.pathname;

  if (path === '/api/rooms' && request.method === 'GET') {
    return directory(env).fetch('https://directory/list');
  }

  if (path === '/api/rooms' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const players = ([2, 4, 6] as const).find((n) => n === body.players) ?? 4;
    const target = body.target === 15 ? 15 : 30;
    const code = await createRoom(env, { players, target, public: body.public === true, quick: false });
    return code ? Response.json({ code }) : new Response('sin códigos libres', { status: 503 });
  }

  if (path === '/api/quick' && request.method === 'POST') {
    const list = (await (await directory(env).fetch('https://directory/list')).json()) as PublicRoom[];
    const open = list.find((r) => r.quick);
    if (open) return Response.json({ code: open.code });
    const code = await createRoom(env, { players: 4, target: 30, public: true, quick: true });
    return code ? Response.json({ code }) : new Response('sin códigos libres', { status: 503 });
  }

  const match = /^\/api\/rooms\/(\d{4})(\/ws)?$/.exec(path);
  if (!match) return new Response('not found', { status: 404 });

  const blocked = await directory(env).fetch('https://directory/blocked', {
    method: 'POST',
    body: JSON.stringify({ ip }),
  });
  if ((await blocked.json()) === true) return new Response('demasiados intentos', { status: 429 });

  const target = new URL(match[2] ? 'https://room/ws' : 'https://room/info');
  target.search = url.search;
  const response = await room(env, match[1]!).fetch(new Request(target, request));
  if (response.status === 404) {
    await directory(env).fetch('https://directory/fail', { method: 'POST', body: JSON.stringify({ ip }) });
  }
  return response;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
