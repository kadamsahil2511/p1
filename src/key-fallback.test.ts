import assert from 'node:assert/strict';
import test from 'node:test';
import { withBackup } from './key-fallback.js';

test('uses backup only when the primary model request fails', async () => {
  let used = 0;
  assert.equal(await withBackup(async () => 'primary', async () => { used++; return 'backup'; }), 'primary');
  assert.equal(used, 0);
  assert.equal(await withBackup(async () => { throw new Error('primary failed'); }, async () => { used++; return 'backup'; }), 'backup');
  assert.equal(used, 1);
  await assert.rejects(withBackup(async () => { throw new Error('primary failed'); }), /primary failed/);
});
