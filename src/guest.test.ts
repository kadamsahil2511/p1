import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { handleGuest, type GuestRun } from './guest.js';

const mockReply = 'mock-reply';
const enabled = { GUEST_ENABLED: 'true', GUEST_GROQ_API_KEY: 'guest-secret', GROQ_API_KEY: 'owner-secret' };

async function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { await fn(); }
  finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withGuest(run: GuestRun, fn: (base: string) => Promise<void>): Promise<void> {
  const server = createServer((request, response) => { void handleGuest(request, response, run); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  try { await fn(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function session(base: string, headers: Record<string, string> = {}) {
  const response = await post(base, '/guest/session', {}, headers);
  assert.equal(response.status, 200);
  return response.json() as Promise<{ guestId: string; threadId: string }>;
}

test('disabled guest or missing GUEST_GROQ_API_KEY returns 503 warming up; session still issues ids', async () => {
  const run: GuestRun = async () => { throw new Error('workflow should not run'); };
  await withGuest(run, async base => {
    await withEnv({ GUEST_ENABLED: 'false', GUEST_GROQ_API_KEY: 'guest-secret', GROQ_API_KEY: 'owner-secret' }, async () => {
      const ids = await session(base);
      assert.match(ids.guestId, /^[0-9a-f-]{36}$/i);
      assert.match(ids.threadId, /^[0-9a-f-]{36}$/i);
      const chat = await post(base, '/guest/chat', { ...ids, message: 'What are the latest indexed stories?' });
      assert.equal(chat.status, 503);
      assert.deepEqual(await chat.json(), { error: 'guest demo is warming up' });
    });
    await withEnv({ GUEST_ENABLED: 'true', GUEST_GROQ_API_KEY: undefined, GROQ_API_KEY: 'owner-secret' }, async () => {
      const ids = await session(base);
      const chat = await post(base, '/guest/chat', { ...ids, message: 'hello' });
      assert.equal(chat.status, 503);
      assert.deepEqual(await chat.json(), { error: 'guest demo is warming up' });
    });
  });
});

test('guest chat uses GUEST_GROQ_API_KEY only, latest vs ask, and CORS from the landing origin', async () => {
  const calls: { data: Parameters<GuestRun>[0]; keys: Parameters<GuestRun>[1] }[] = [];
  const run: GuestRun = async (data, keys) => {
    calls.push({ data, keys });
    return mockReply;
  };
  await withEnv(enabled, async () => {
    await withGuest(run, async base => {
      const ids = await session(base);
      const latest = await post(base, '/guest/chat', { ...ids, message: 'What are the latest indexed stories?' }, {
        origin: 'https://p1.kadamsahil.com',
        'x-forwarded-for': '203.0.113.10',
      });
      assert.equal(latest.status, 200);
      assert.equal(latest.headers.get('access-control-allow-origin'), 'https://p1.kadamsahil.com');
      assert.deepEqual(await latest.json(), { reply: mockReply });
      const follow = await post(base, '/guest/chat', { ...ids, message: 'Which of those did you just mention first?' }, {
        origin: 'https://p1.kadamsahil.com',
        'x-forwarded-for': '203.0.113.10',
      });
      assert.equal(follow.status, 200);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].keys.primaryKey, 'guest-secret');
      assert.equal(calls[0].keys.backupKey, '');
      assert.equal(calls[1].keys.primaryKey, 'guest-secret');
      assert.equal(calls[0].data.mode, 'latest');
      assert.equal(calls[1].data.mode, 'ask');
      assert.equal(calls[0].data.resource, `guest:${ids.guestId}`);
      assert.equal(calls[0].data.thread, ids.threadId);
    });
  });
});

test('caps messages at 400 characters', async () => {
  const run: GuestRun = async () => mockReply;
  await withEnv(enabled, async () => {
    await withGuest(run, async base => {
      const ids = await session(base);
      const headers = { 'x-forwarded-for': '203.0.113.40' };
      const tooLong = await post(base, '/guest/chat', { ...ids, message: 'x'.repeat(401) }, headers);
      assert.equal(tooLong.status, 400);
      const allowed = await post(base, '/guest/chat', { ...ids, message: 'x'.repeat(400) }, headers);
      assert.equal(allowed.status, 200);
    });
  });
});

test('limits 8 messages per session and 12 per IP per hour', async () => {
  const run: GuestRun = async () => mockReply;
  await withEnv(enabled, async () => {
    await withGuest(run, async base => {
      const ip = { 'x-forwarded-for': '203.0.113.80, 10.0.0.1' };
      const first = await session(base);
      for (let i = 0; i < 8; i++) {
        const response = await post(base, '/guest/chat', { ...first, message: `q${i}` }, ip);
        assert.equal(response.status, 200);
      }
      const ninth = await post(base, '/guest/chat', { ...first, message: 'ninth' }, ip);
      assert.equal(ninth.status, 429);
      const second = await session(base);
      for (let i = 0; i < 4; i++) {
        const response = await post(base, '/guest/chat', { ...second, message: `more${i}` }, ip);
        assert.equal(response.status, 200);
      }
      const thirteenth = await post(base, '/guest/chat', { ...second, message: 'blocked' }, ip);
      assert.equal(thirteenth.status, 429);
    });
  });
});

test('reset issues a new thread for the same guest', async () => {
  const run: GuestRun = async () => mockReply;
  await withEnv(enabled, async () => {
    await withGuest(run, async base => {
      const ids = await session(base);
      const reset = await post(base, '/guest/reset', { guestId: ids.guestId }, { 'x-forwarded-for': '203.0.113.90' });
      assert.equal(reset.status, 200);
      const next = await reset.json() as { guestId: string; threadId: string };
      assert.equal(next.guestId, ids.guestId);
      assert.notEqual(next.threadId, ids.threadId);
      assert.match(next.threadId, /^[0-9a-f-]{36}$/i);
    });
  });
});
