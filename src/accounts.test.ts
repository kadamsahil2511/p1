import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { AccountStore } from './accounts.js';

test('registration requires WhatsApp confirmation and stores separate encrypted keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p1-accounts-'));
  try {
    const path = join(dir, 'accounts.db');
    const store = new AccountStore(path, randomBytes(32).toString('base64'));
    await store.init();
    const token = await store.issueSetup('919876543210');
    const pending = await store.submitKeys(token, 'primary-secret', 'backup-secret');
    assert.equal(pending.number, '919876543210');
    assert.equal(await store.setupNumber(token), null);
    assert.equal(await store.get('919876543210'), null);
    assert.equal(await store.confirm('919876543211', pending.code), false);
    assert.equal(await store.confirm('919876543210', '000000'), false);
    assert.equal(await store.confirm('919876543210', pending.code), true);
    const account = await store.get('919876543210');
    assert.equal(account?.primaryKey, 'primary-secret');
    assert.equal(account?.backupKey, 'backup-secret');
    assert.notEqual(account?.thread, '');
    assert.doesNotMatch(await readFile(path, 'utf8'), /primary-secret|backup-secret/);
    assert.equal(await store.confirm('919876543210', pending.code), false);
    await assert.rejects(store.submitKeys(token, 'new-secret', ''), /expired|used/i);
    await store.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('owner key is seeded once and registration can replace backup independently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p1-owner-'));
  try {
    const store = new AccountStore(join(dir, 'accounts.db'), randomBytes(32).toString('base64'));
    await store.init();
    await store.ensureOwner('919876543210', 'owner-key', '', 'legacy-thread', 5);
    await store.ensureOwner('919876543210', 'other-key', '', 'other-thread', 10);
    assert.equal((await store.get('919876543210'))?.primaryKey, 'owner-key');
    assert.equal((await store.get('919876543210'))?.thread, 'legacy-thread');
    const token = await store.issueSetup('919876543210');
    const pending = await store.submitKeys(token, 'new-primary', 'new-backup');
    assert.equal((await store.get('919876543210'))?.primaryKey, 'owner-key');
    assert.equal(await store.confirm('919876543210', pending.code), true);
    assert.equal((await store.get('919876543210'))?.backupKey, 'new-backup');
    await store.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('setup sessions expire and three wrong confirmations revoke them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p1-expiry-'));
  try {
    const path = join(dir, 'accounts.db');
    const store = new AccountStore(path, randomBytes(32).toString('base64'));
    await store.init();
    const expired = await store.issueSetup('919876543210');
    const db = createClient({ url: `file:${path}` });
    await db.execute({ sql: 'UPDATE setup_tokens SET expires = ?', args: [Date.now() - 1] });
    assert.equal(await store.setupNumber(expired), null);
    await assert.rejects(store.submitKeys(expired, 'primary-secret', ''), /expired/i);
    const active = await store.issueSetup('919876543210');
    const pending = await store.submitKeys(active, 'primary-secret', 'backup-secret');
    for (let i = 0; i < 3; i++) assert.equal(await store.confirm('919876543210', pending.code === '000000' ? '111111' : '000000'), false);
    assert.equal(await store.confirm('919876543210', pending.code), false);
    db.close();
    await store.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('registered users keep separate keys and chat sessions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p1-users-'));
  try {
    const store = new AccountStore(join(dir, 'accounts.db'), randomBytes(32).toString('base64'));
    await store.init();
    for (const [number, key] of [['919876543210', 'first-secret'], ['919876543211', 'second-secret']]) {
      const token = await store.issueSetup(number);
      const pending = await store.submitKeys(token, key, '');
      assert.equal(await store.confirm(number, pending.code), true);
    }
    const first = await store.get('919876543210');
    const second = await store.get('919876543211');
    assert.equal(first?.primaryKey, 'first-secret');
    assert.equal(second?.primaryKey, 'second-secret');
    assert.notEqual(first?.thread, second?.thread);
    await store.saveSession('919876543210', 'changed-thread', 123);
    assert.equal((await store.get('919876543211'))?.thread, second?.thread);
    await store.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
