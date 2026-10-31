import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIncoming, selectNew, formatDigest, whatsAppText, evolutionIsOpen, isWebhookPath, firstLink, allowWebRead } from './logic.js';

test('finds the first link and removes WhatsApp punctuation around it', () => {
  assert.equal(firstLink('Read this (https://example.com/story?q=1).'), 'https://example.com/story?q=1');
  assert.equal(firstLink('No link here'), null);
});

test('limits shared Firecrawl reads for each registered number', () => {
  const reads = new Map<string, { started: number; count: number }>();
  for (let i = 0; i < 5; i++) assert.equal(allowWebRead(reads, 'one', 1000), true);
  assert.equal(allowWebRead(reads, 'one', 1000), false);
  assert.equal(allowWebRead(reads, 'two', 1000), true);
  assert.equal(allowWebRead(reads, 'one', 3_601_000), true);
});

test('accepts Evolution event webhook paths with the configured secret', () => {
  assert.equal(isWebhookPath('/webhook/secret', 'secret'), true);
  assert.equal(isWebhookPath('/webhook/secret/messages-upsert', 'secret'), true);
  assert.equal(isWebhookPath('/webhook/secret/connection-update', 'secret'), true);
  assert.equal(isWebhookPath('/webhook/wrong/messages-upsert', 'secret'), false);
  assert.equal(isWebhookPath('/webhook/secret-extra/messages-upsert', 'secret'), false);
});

test('digest waits for a connected WhatsApp instance', () => {
  assert.equal(evolutionIsOpen({ instance: { state: 'connecting' } }), false);
  assert.equal(evolutionIsOpen({ instance: { state: 'open' } }), true);
  assert.equal(evolutionIsOpen({}), false);
});

test('only an inbound direct owner message is accepted', () => {
  const base = { instance: 'p1', event: 'messages.upsert', data: { key: { id: 'm1', remoteJid: '919876543210@s.whatsapp.net', fromMe: false }, message: { conversation: 'hello' } } };
  assert.deepEqual(parseIncoming(base, '919876543210', 'p1'), { id: 'm1', number: '919876543210', text: 'hello' });
  assert.deepEqual(parseIncoming(base, undefined, 'p1'), { id: 'm1', number: '919876543210', text: 'hello' });
  assert.equal(parseIncoming(base, '919876543211'), null);
  assert.equal(parseIncoming(base, '919876543210', 'wrong-instance'), null);
  assert.deepEqual(parseIncoming({ ...base, data: { ...base.data, key: { ...base.data.key, remoteJid: 'lid-number@lid', remoteJidAlt: '919876543210@s.whatsapp.net' } } }, '919876543210'), { id: 'm1', number: '919876543210', text: 'hello' });
  assert.equal(parseIncoming({ ...base, data: { ...base.data, key: { ...base.data.key, fromMe: true } } }, '919876543210'), null);
  assert.equal(parseIncoming({ ...base, data: { ...base.data, key: { ...base.data.key, remoteJid: '123@g.us' } } }, '919876543210'), null);
});

test('delivery ledger filters repeated URLs and titles', () => {
  const articles = [{ title: 'A substantial headline about chips', url: 'https://a', source: 'A', published: '2026-10-30', text: '' }, { title: 'New chip launch', url: 'https://b', source: 'B', published: '2026-10-30', text: '' }];
  assert.deepEqual(selectNew(articles, [{ title: articles[0].title, url: 'https://old' }], '2026-10-30'), [articles[1]]);
  assert.match(formatDigest('2026-10-30', [{ title: 'New chip', summary: 'Faster model.', url: 'https://b', source: 'B' }]), /\*1\. New chip\*\nFaster model\.\nB · https:\/\/b/);
});

test('digest excludes old articles and repeats within one batch', () => {
  const base = { title: 'Company releases faster AI chip', url: 'https://a', source: 'A', published: '2026-10-30', text: '' };
  assert.deepEqual(selectNew([{ ...base, published: '2026-10-01' }, base, { ...base, url: 'https://b' }], [], '2026-10-30'), [base]);
});

test('converts model Markdown to WhatsApp syntax', () => {
  assert.equal(whatsAppText('**Headline** [Read](https://example.com)'), '*Headline* Read: https://example.com');
});
