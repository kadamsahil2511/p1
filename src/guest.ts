import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type GuestRun = (
  data: { mode: 'ask' | 'latest'; query: string; resource: string; thread: string },
  keys: { primaryKey: string; backupKey: string },
) => Promise<string>;

const LANDING = 'https://p1.kadamsahil.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_LIMIT = 8;
const IP_LIMIT = 12;
const IP_WINDOW_MS = 3_600_000;
const MAX_MESSAGE = 400;
const sessionCounts = new Map<string, number>();
const ipCounts = new Map<string, { started: number; count: number }>();

function guestReady(): boolean {
  return process.env.GUEST_ENABLED === 'true' && !!process.env.GUEST_GROQ_API_KEY;
}

function allowedOrigin(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  if (origin === LANDING) return origin;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return origin;
  return undefined;
}

function cors(origin: string | undefined): Record<string, string> {
  const allowed = allowedOrigin(origin);
  const headers: Record<string, string> = {
    'access-control-allow-headers': 'Content-Type',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  if (allowed) {
    headers['access-control-allow-origin'] = allowed;
    headers.vary = 'Origin';
  }
  return headers;
}

function json(response: ServerResponse, status: number, body: unknown, origin: string | undefined): void {
  response.writeHead(status, { ...cors(origin), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}

function clientIp(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (value && value.trim()) return value.split(',')[0].trim();
  return request.socket.remoteAddress ?? 'unknown';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isLatest(message: string): boolean {
  const text = message.toLowerCase();
  return /\b(latest|recent)\b/.test(text) && /\b(stor(?:y|ies)|news|articles?|headlines?|indexed)\b/.test(text);
}

function sessionKey(guestId: string, threadId: string): string {
  return `${guestId}:${threadId}`;
}

function allowSession(guestId: string, threadId: string): boolean {
  const key = sessionKey(guestId, threadId);
  const count = sessionCounts.get(key) ?? 0;
  if (count >= SESSION_LIMIT) return false;
  sessionCounts.set(key, count + 1);
  return true;
}

function allowIp(ip: string, now: number): boolean {
  const current = ipCounts.get(ip);
  if (!current || now - current.started >= IP_WINDOW_MS) {
    ipCounts.set(ip, { started: now, count: 1 });
    return true;
  }
  if (current.count >= IP_LIMIT) return false;
  current.count += 1;
  return true;
}

async function readJson(request: IncomingMessage, response: ServerResponse, origin: string | undefined): Promise<unknown | undefined> {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 8192) {
      json(response, 413, { error: 'payload too large' }, origin);
      return undefined;
    }
  }
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); }
  catch {
    json(response, 400, { error: 'invalid json' }, origin);
    return undefined;
  }
}

export async function handleGuest(request: IncomingMessage, response: ServerResponse, run: GuestRun): Promise<boolean> {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (!path.startsWith('/guest')) return false;
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
  try {
    if (request.method === 'OPTIONS') {
      response.writeHead(allowedOrigin(origin) ? 204 : 403, cors(origin)).end();
      return true;
    }
    if (request.method !== 'POST') {
      json(response, 405, { error: 'method not allowed' }, origin);
      return true;
    }
    if (path === '/guest/session') {
      json(response, 200, { guestId: randomUUID(), threadId: randomUUID() }, origin);
      return true;
    }
    const body = await readJson(request, response, origin);
    if (body === undefined) return true;
    const values = asRecord(body);
    const guestId = asString(values.guestId);
    if (!UUID.test(guestId)) {
      json(response, 400, { error: 'invalid guest session' }, origin);
      return true;
    }
    if (path === '/guest/reset') {
      json(response, 200, { guestId, threadId: randomUUID() }, origin);
      return true;
    }
    if (path !== '/guest/chat') {
      json(response, 404, { error: 'not found' }, origin);
      return true;
    }
    if (!guestReady()) {
      json(response, 503, { error: 'guest demo is warming up' }, origin);
      return true;
    }
    const threadId = asString(values.threadId);
    const message = asString(values.message);
    if (!UUID.test(threadId)) {
      json(response, 400, { error: 'invalid guest session' }, origin);
      return true;
    }
    if (!message) {
      json(response, 400, { error: 'message required' }, origin);
      return true;
    }
    if (message.length > MAX_MESSAGE) {
      json(response, 400, { error: 'message too long' }, origin);
      return true;
    }
    if (!allowSession(guestId, threadId)) {
      json(response, 429, { error: 'session message limit reached' }, origin);
      return true;
    }
    if (!allowIp(clientIp(request), Date.now())) {
      const key = sessionKey(guestId, threadId);
      sessionCounts.set(key, (sessionCounts.get(key) ?? 1) - 1);
      json(response, 429, { error: 'rate limit reached' }, origin);
      return true;
    }
    const reply = await run(
      { mode: isLatest(message) ? 'latest' : 'ask', query: message, resource: `guest:${guestId}`, thread: threadId },
      { primaryKey: process.env.GUEST_GROQ_API_KEY!, backupKey: '' },
    );
    json(response, 200, { reply }, origin);
    return true;
  } catch (error) {
    console.error(JSON.stringify({ stage: 'guest.failed', error: error instanceof Error ? error.name : 'Error' }));
    json(response, 503, { error: 'guest demo is warming up' }, origin);
    return true;
  }
}
