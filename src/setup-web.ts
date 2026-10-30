import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AccountStore } from './accounts.js';

const headers = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
};
const page = (body: string) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>P1 Assistant · Groq keys</title><style>body{font:16px system-ui,sans-serif;background:#f5f7f4;color:#17221a;margin:0;padding:24px}main{max-width:430px;margin:7vh auto;background:white;padding:28px;border-radius:16px;box-shadow:0 8px 30px #0001}h1{font-size:24px}label{display:block;margin-top:18px;font-weight:600}input{box-sizing:border-box;width:100%;padding:12px;margin-top:6px;border:1px solid #aaa;border-radius:8px;font:inherit}button{margin-top:22px;padding:12px 18px;border:0;border-radius:8px;background:#176b48;color:white;font:inherit;font-weight:700}small{color:#506055}p{line-height:1.5}</style><main>${body}</main></html>`;
function reply(response: ServerResponse, status: number, body: string): void { response.writeHead(status, headers).end(page(body)); }
function cookieToken(request: IncomingMessage): string {
  return request.headers.cookie?.split(';').map(part => part.trim()).find(part => /^setup=[a-f0-9]{48}$/.test(part))?.slice(6) ?? '';
}

async function validGroqKey(key: string): Promise<boolean> {
  const response = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return false;
  const models = await response.json() as { data?: { id?: string }[] };
  return !!models.data?.some(model => model.id === (process.env.GROQ_MODEL ?? 'qwen/qwen3.8-27b'));
}

export async function handleSetup(
  request: IncomingMessage, response: ServerResponse, accounts: AccountStore,
  send: (number: string, text: string) => Promise<void>,
): Promise<boolean> {
  const path = request.url ?? '';
  if (!path.startsWith('/setup')) return false;
  try {
    const match = /^\/setup\/([a-f0-9]{48})$/.exec(path);
    if (request.method === 'GET' && match) {
      if (!(await accounts.setupNumber(match[1]))) { reply(response, 410, '<h1>Link expired</h1><p>Send /register in WhatsApp for a new link.</p>'); return true; }
      response.writeHead(303, { ...headers, location: '/setup', 'set-cookie': `setup=${match[1]}; HttpOnly; Secure; SameSite=Lax; Path=/setup; Max-Age=600` }).end();
      return true;
    }
    if (path !== '/setup') { reply(response, 404, '<h1>Page not found</h1>'); return true; }
    const token = cookieToken(request);
    const number = await accounts.setupNumber(token);
    if (!number) { reply(response, 410, '<h1>Session expired</h1><p>Send /register in WhatsApp for a new link.</p>'); return true; }
    if (request.method === 'GET') {
      reply(response, 200, `<h1>Set up Groq keys</h1><p>WhatsApp account ending in <strong>${number.slice(-4)}</strong>. This link expires after 10 minutes.</p><form method="post" action="/setup" autocomplete="off"><label for="primary">Primary Groq API key · required</label><input id="primary" name="primary" type="password" required minlength="10" maxlength="256" autocomplete="off"><label for="backup">Backup Groq API key · optional</label><input id="backup" name="backup" type="password" maxlength="256" autocomplete="off"><small>Use a different key for backup. It runs only if the primary request fails.</small><button type="submit">Check keys and continue</button></form><p><small>After validation, confirm the code in WhatsApp. Keys are encrypted on this server and never shown again.</small></p>`);
      return true;
    }
    if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) { reply(response, 405, '<h1>Request not supported</h1>'); return true; }
    if (request.headers.origin && request.headers.origin !== process.env.SETUP_BASE_URL) { reply(response, 403, '<h1>Wrong origin</h1>'); return true; }
    let raw = '';
    for await (const chunk of request) { raw += chunk; if (raw.length > 8192) { reply(response, 413, '<h1>Form too large</h1>'); return true; } }
    const values = new URLSearchParams(raw);
    const primary = (values.get('primary') ?? '').trim();
    const backup = (values.get('backup') ?? '').trim();
    if (!/^\S{10,256}$/.test(primary) || (backup && (!/^\S{10,256}$/.test(backup) || backup === primary))) {
      reply(response, 400, '<h1>Check your keys</h1><p>Primary is required. Backup is optional and must be different. Return to the form and try again.</p>'); return true;
    }
    if (!(await validGroqKey(primary)) || (backup && !(await validGroqKey(backup)))) {
      reply(response, 400, '<h1>Groq key check failed</h1><p>Check both keys and their access to the configured model, then try again.</p>'); return true;
    }
    const pending = await accounts.submitKeys(token, primary, backup);
    await send(pending.number, `*Confirm your Groq keys*\nBoth keys were checked. Reply with /confirm ${pending.code} within 10 minutes to activate them. If you did not open the setup page, ignore this and send /register for a fresh link.`);
    response.writeHead(200, { ...headers, 'set-cookie': 'setup=; HttpOnly; Secure; SameSite=Lax; Path=/setup; Max-Age=0' }).end(page('<h1>Keys checked</h1><p>Return to WhatsApp and reply with the confirmation command I just sent. Your account changes only after that reply.</p>'));
    return true;
  } catch (error) {
    console.error(JSON.stringify({ stage: 'setup.failed', error: error instanceof Error ? error.name : 'Error' }));
    reply(response, 503, '<h1>Setup unavailable</h1><p>Try /register again in WhatsApp shortly.</p>');
    return true;
  }
}
