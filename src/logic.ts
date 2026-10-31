import { timingSafeEqual } from 'node:crypto';

export type Article = { title: string; url: string; source: string; published: string; text: string };
export type Incoming = { id: string; number: string; text: string };

export function firstLink(text: string): string | null {
  // shortcut: read the first link in a message; add multi-link support if chat requests need comparisons.
  const match = /https?:\/\/[^\s<>"']+/i.exec(text);
  return match?.[0].replace(/[.,!?;:)}\]]+$/, '') ?? null;
}

export function allowWebRead(reads: Map<string, { started: number; count: number }>, number: string, now: number): boolean {
  // shortcut: this quota resets on restart; persist it if Firecrawl spending needs a durable cap.
  const current = reads.get(number);
  if (!current || now - current.started >= 3_600_000) { reads.set(number, { started: now, count: 1 }); return true; }
  if (current.count >= 5) return false;
  current.count++;
  return true;
}

export function isWebhookPath(received: string, secret: string): boolean {
  const expected = `/webhook/${secret}`;
  const suffix = received.slice(expected.length);
  if (suffix && !/^\/[a-z-]+$/.test(suffix)) return false;
  const base = received.slice(0, expected.length);
  return Buffer.byteLength(base) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(base), Buffer.from(expected));
}

export function evolutionIsOpen(payload: any): boolean {
  return payload?.instance?.state === 'open';
}

export function parseIncoming(payload: any, owner?: string, instance?: string): Incoming | null {
  if (payload?.event !== 'messages.upsert' || (instance && payload?.instance !== instance)) return null;
  const data = payload.data;
  const key = data?.key;
  const jid = key?.remoteJid?.endsWith('@lid') ? key.remoteJidAlt : key?.remoteJid;
  const number = typeof jid === 'string' ? jid.split('@')[0].replace(/\D/g, '') : '';
  if (!key?.id || key.fromMe || !jid?.endsWith('@s.whatsapp.net') || (owner && number !== owner)) return null;
  const text = data?.message?.conversation ?? data?.message?.extendedTextMessage?.text;
  if (typeof text !== 'string' || !text.trim()) return null;
  return { id: key.id, number, text: text.trim() };
}

export function selectNew(articles: Article[], delivered: { url: string; title: string }[], today: string): Article[] {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  const earliest = cutoff.toISOString().slice(0, 10);
  const selected: Article[] = [];
  const similar = (a: { url: string; title: string }, b: { url: string; title: string }) => {
    if (a.url === b.url) return true;
    const left: string[] = a.title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const right: string[] = b.title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    if (left.length < 3 || right.length < 3) return false;
    const overlap = new Set(left.filter(word => right.includes(word))).size;
    return overlap / new Set([...left, ...right]).size >= 0.72;
  };
  for (const article of articles) {
    if (article.published < earliest || article.published > today) continue;
    if (delivered.some(item => similar(article, item)) || selected.some(item => similar(article, item))) continue;
    selected.push(article);
    if (selected.length === 5) break;
  }
  return selected;
}

export function formatDigest(day: string, stories: { title: string; summary: string; url: string; source: string }[]): string {
  return [`*P1 digest · ${day}*`, ...stories.map((story, index) =>
    `*${index + 1}. ${story.title.replace(/[*_~`]/g, '')}*\n${story.summary.replace(/[*_~`]/g, '')}\n${story.source} · ${story.url}`
  )].join('\n\n');
}

export function whatsAppText(text: string): string {
  return text.replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g, '$1: $2').replace(/\*\*([^*\n]+)\*\*/g, '*$1*');
}
