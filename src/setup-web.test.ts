import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from './accounts.js';
import { handleSetup } from './setup-web.js';

test('setup link becomes a secure cookie; keys are checked and confirmed in WhatsApp', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p1-setup-'));
  const store = new AccountStore(join(dir, 'accounts.db'), randomBytes(32).toString('base64'));
  await store.init();
  const sent: { number: string; text: string }[] = [];
  const server = createServer((request, response) => { void handleSetup(request, response, store, async (number, text) => { sent.push({ number, text }); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  const base = `http://127.0.0.1:${address.port}`;
  const previousOrigin = process.env.SETUP_BASE_URL;
  const previousFetch = globalThis.fetch;
  process.env.SETUP_BASE_URL = base;
  globalThis.fetch = ((url: string | URL | Request, options?: RequestInit) => String(url).includes('api.groq.com')
    ? Promise.resolve(new Response(JSON.stringify({ data: [{ id: process.env.GROQ_MODEL ?? 'qwen/qwen3.8-27b' }] }), { status: 200 }))
    : previousFetch(url, options)) as typeof fetch;
  try {
    const token = await store.issueSetup('919876543210');
    const redirect = await previousFetch(`${base}/setup/${token}`, { redirect: 'manual' });
    assert.equal(redirect.status, 303);
    assert.equal(redirect.headers.get('location'), '/setup');
    const cookie = redirect.headers.get('set-cookie') ?? '';
    assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
    const form = await previousFetch(`${base}/setup`, { headers: { cookie } });
    assert.equal(form.status, 200);
    assert.doesNotMatch(await form.text(), /919876543210|primary-secret/);
    const submitted = await previousFetch(`${base}/setup`, {
      method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ primary: 'primary-secret', backup: 'backup-secret' }),
    });
    assert.equal(submitted.status, 200);
    assert.equal(sent[0].number, '919876543210');
    assert.doesNotMatch(sent[0].text, /primary-secret|backup-secret/);
    assert.equal(await store.get('919876543210'), null);
    const code = /\/confirm (\d{6})/.exec(sent[0].text)?.[1];
    assert.ok(code);
    assert.equal(await store.confirm('919876543210', code), true);
    assert.equal((await store.get('919876543210'))?.backupKey, 'backup-secret');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousOrigin === undefined) delete process.env.SETUP_BASE_URL; else process.env.SETUP_BASE_URL = previousOrigin;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
