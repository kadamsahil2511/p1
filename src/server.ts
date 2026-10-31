import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { newsTool, disconnectMcp, clearThread } from './agent.js';
import { runNewsWorkflow } from './workflow.js';
import { allowWebRead, evolutionIsOpen, firstLink, formatDigest, isWebhookPath, parseIncoming, selectNew, whatsAppText, type Article } from './logic.js';
import { AccountStore } from './accounts.js';
import { handleSetup } from './setup-web.js';

process.umask(0o077);
const required = ['GROQ_API_KEY', 'ACCOUNT_ENCRYPTION_KEY', 'SETUP_BASE_URL', 'P1_API_TOKEN', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE', 'WHATSAPP_OWNER_NUMBER', 'WEBHOOK_SECRET'];
for (const key of required) if (!process.env[key]) throw new Error(`Set ${key} in .env`);
const owner = process.env.WHATSAPP_OWNER_NUMBER!.replace(/\D/g, '');
const dataDir = process.env.DATA_DIR ?? './data';
await mkdir(dataDir, { recursive: true });
const statePath = `${dataDir}/bot-state.json`;
type State = { thread: string; lastActive: number; delivered: { url: string; title: string }[]; handled: string[]; lastSchedule: string };
let state: State;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (error: any) { if (error.code !== 'ENOENT') throw error; state = { thread: randomUUID(), lastActive: 0, delivered: [], handled: [], lastSchedule: '' }; }
const accounts = new AccountStore(`${dataDir}/accounts.db`, process.env.ACCOUNT_ENCRYPTION_KEY!);
await accounts.init();
await accounts.ensureOwner(owner, process.env.GROQ_API_KEY!, process.env.GROQ_BACKUP_API_KEY ?? '', state.thread, state.lastActive);
async function save(): Promise<void> {
  const temp = `${statePath}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state));
  await rename(temp, statePath);
}
const help = `*P1 Assistant*\nSend any message to chat, or send a public HTTPS link to read and discuss that page. Chats reset after one idle hour.\n\n/register — set or replace your Groq keys in a private page\n/account — see whether your primary and backup keys are set\n/deleteaccount — remove your account and current chat\n/newchat — start a fresh chat\n/latest — recent tech news\n/ask <question> — ask about indexed news or a link\n/sources — approved websites\n/help — show this guide\n\nThe owner can also use /addsource, /removesource and /refresh. Owner digest: 07:00 IST.`;
const evolution = process.env.EVOLUTION_API_URL ?? 'http://127.0.0.1:8080';
async function evolutionReady(): Promise<boolean> {
  try {
    const response = await fetch(`${evolution}/instance/connectionState/${encodeURIComponent(process.env.EVOLUTION_INSTANCE!)}`, {
      headers: { apikey: process.env.EVOLUTION_API_KEY! }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Evolution connectionState returned HTTP ${response.status}`);
    return evolutionIsOpen(await response.json());
  } catch (error) {
    console.error(JSON.stringify({ stage: 'evolution.check_failed', error: String(error) }));
    return false;
  }
}
async function send(number: string, text: string): Promise<void> {
  const response = await fetch(`${evolution}/message/sendText/${encodeURIComponent(process.env.EVOLUTION_INSTANCE!)}`, {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: process.env.EVOLUTION_API_KEY! },
    body: JSON.stringify({ number, text: whatsAppText(text) }), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Evolution sendText returned HTTP ${response.status}`);
  console.log(JSON.stringify({ stage: 'whatsapp.sent', chars: text.length }));
}
async function digest(trigger: 'schedule' | 'command'): Promise<void> {
  console.log(JSON.stringify({ stage: 'digest.start', trigger }));
  const account = await accounts.get(owner);
  if (!account) throw new Error('Owner account missing');
  const refresh = await newsTool<{ added: number; errors: Record<string, string> }>('refresh_news');
  const latest = await newsTool<Article[]>('latest_news', { limit: 100 });
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const fresh = selectNew(latest, state.delivered, day);
  if (fresh.length) {
    const stories = [];
    for (const article of fresh) {
      const summary = await runNewsWorkflow({ mode: 'digest', query: 'Summarize this one article in two factual sentences (35-45 words). No heading or URL.', resource: owner, thread: `digest-${day}-${randomUUID()}`, articles: [article] }, account);
      stories.push({ title: article.title, summary, url: article.url, source: article.source });
    }
    await send(owner, formatDigest(day, stories));
    state.delivered.push(...fresh.map(({ url, title }) => ({ url, title })));
    await save();
  } else if (trigger === 'command') await send(owner, 'No new stories since the last digest.');
  if (Object.keys(refresh.errors).length) await send(owner, `Source errors: ${Object.values(refresh.errors).join('; ').slice(0, 1500)}`);
  console.log(JSON.stringify({ stage: 'digest.done', new: fresh.length, sourceErrors: Object.keys(refresh.errors).length }));
}
let digestRunning = false;
async function runDigest(trigger: 'schedule' | 'command'): Promise<void> {
  if (digestRunning) { if (trigger === 'command') await send(owner, 'A refresh is already running.'); return; }
  digestRunning = true;
  try { await digest(trigger); } finally { digestRunning = false; }
}
async function handle(number: string, text: string): Promise<void> {
  if (/gsk_[A-Za-z0-9_-]{10,}/.test(text)) return send(number, 'For your security, do not send API keys in chat. Send /register and use the private setup page. Rotate any key you already sent here.');
  const [command, ...rest] = text.startsWith('/') ? text.split(/\s+/) : ['chat', text];
  const argument = rest.join(' ').trim();
  if (command === '/register') {
    const token = await accounts.issueSetup(number);
    return send(number, `*Set up your Groq keys*\nOpen this private link within 10 minutes:\n${process.env.SETUP_BASE_URL}/setup/${token}\n\nEnter a required Primary key and an optional, different Backup key. After both are checked, confirm the code I send here. Do not send keys in chat.`);
  }
  if (command === '/confirm') {
    const confirmed = await accounts.confirm(number, argument);
    return send(number, confirmed ? `Account ready. Your keys are saved separately and encrypted.\n\n${help}` : 'That confirmation code is invalid or expired. Use /register to start again if needed.');
  }
  const account = await accounts.get(number);
  if (command === '/help' || command === '/start') return send(number, help);
  if (command === '/account') return send(number, account ? `*Your account*\nPrimary Groq key: set\nBackup Groq key: ${account.backupKey ? 'set' : 'not set'}\nUse /register to replace both.` : 'No account yet. Send /register to add your Groq keys.');
  if (command === '/deleteaccount') {
    if (number === owner) return send(number, 'The owner account is required for the scheduled digest. Use /register to replace its keys.');
    if (account) await clearThread(account.thread);
    await accounts.remove(number);
    return send(number, 'Your account and current chat were removed. Use /register to start again.');
  }
  if (!account) return send(number, 'Welcome to P1 Assistant. Send /register to set your own Groq key, then I can chat and answer questions.');
  const now = Date.now();
  if (command === '/newchat' || (account.lastActive && now - account.lastActive >= 3_600_000)) {
    await clearThread(account.thread);
    account.thread = randomUUID();
    console.log(JSON.stringify({ stage: 'session.new', reason: command === '/newchat' ? 'command' : 'idle' }));
    if (command !== '/newchat') await send(number, `Previous chat expired after one hour.\n\n${help}`);
  } else if (!account.lastActive) await send(number, help);
  account.lastActive = now;
  await accounts.saveSession(number, account.thread, now);
  if (number === owner) { state.thread = account.thread; state.lastActive = now; await save(); }
  if (command === '/newchat') return send(number, help);
  if (command === '/refresh') return number === owner ? runDigest('command') : send(number, 'Only the owner can refresh the shared source pool.');
  if (command === '/sources') {
    const sources = await newsTool<{ id: string; name: string; url: string }[]>('list_sources');
    return send(number, sources.map(item => `${item.name} · ${item.url}\nID: ${item.id}`).join('\n\n') || 'No sources yet.');
  }
  if (command === '/addsource' && argument) {
    if (number !== owner) return send(number, 'Only the owner can change the shared source pool.');
    const source = await newsTool<{ url: string; method: string }>('add_source', { url: argument });
    return send(number, `Added ${source.url} using ${source.method}.`);
  }
  if (command === '/removesource' && argument) {
    if (number !== owner) return send(number, 'Only the owner can change the shared source pool.');
    const source = await newsTool<{ url: string }>('remove_source', { source_id: argument });
    return send(number, `Removed ${source.url} and its indexed articles.`);
  }
  if (command === '/latest') {
    return send(number, await runNewsWorkflow({ mode: 'latest', query: '', resource: number, thread: account.thread }, account));
  }
  if (command === '/ask' || command === 'chat') {
    const question = command === 'chat' ? text : argument;
    if (!question) return send(number, 'Send a question after /ask.');
    const link = firstLink(question);
    if (link) {
      if (number !== owner && !allowWebRead(webReads, number, Date.now())) return send(number, 'You can read up to five links per hour. Try again later.');
      let page: Article;
      try {
        page = await newsTool<Article>('scrape_page', { url: link });
      } catch (error) {
        console.error(JSON.stringify({ stage: 'web.scrape_failed', error: error instanceof Error ? error.name : 'Error' }));
        return send(number, 'I could not read that link with Firecrawl. Send a public HTTPS page and try again.');
      }
      return send(number, await runNewsWorkflow({ mode: 'web', query: question === link ? 'Summarize this page and its key facts, then cite the URL.' : question, resource: number, thread: account.thread, articles: [page] }, account));
    }
    return send(number, await runNewsWorkflow({ mode: command === '/ask' ? 'ask' : 'chat', query: question, resource: number, thread: account.thread }, account));
  }
  return send(number, 'Unknown command. Use /help.');
}
const processing = new Set<string>();
const webReads = new Map<string, { started: number; count: number }>();
const server = createServer(async (request, response) => {
  if (request.url === '/health') { response.writeHead(200).end('ok'); return; }
  if (await handleSetup(request, response, accounts, send)) return;
  const received = request.url ?? '';
  if (request.method !== 'POST' || !isWebhookPath(received, process.env.WEBHOOK_SECRET!)) {
    response.writeHead(404).end(); return;
  }
  try {
    let raw = '';
    for await (const part of request) { raw += part; if (raw.length > 1_000_000) throw new Error('Payload too large'); }
    const incoming = parseIncoming(JSON.parse(raw), undefined, process.env.EVOLUTION_INSTANCE);
    if (incoming && !state.handled.includes(incoming.id) && !(await accounts.wasHandled(incoming.id)) && !processing.has(incoming.id)) {
      processing.add(incoming.id);
      try { await handle(incoming.number, incoming.text); await accounts.markHandled(incoming.id); if (incoming.number === owner) { state.handled.push(incoming.id); state.handled = state.handled.slice(-1000); await save(); } }
      catch (error) { console.error(JSON.stringify({ stage: 'message.failed', error: error instanceof Error ? error.name : 'Error' })); try { await send(incoming.number, 'Sorry, that request failed. Check the service logs and try again.'); } catch (sendError) { console.error(JSON.stringify({ stage: 'error_reply.failed', error: sendError instanceof Error ? sendError.name : 'Error' })); } }
      finally { processing.delete(incoming.id); }
    }
    response.writeHead(200).end('ok');
  } catch (error) { console.error(JSON.stringify({ stage: 'webhook.failed', error: String(error) })); response.writeHead(400).end(); }
});
server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1', () => console.log(JSON.stringify({ stage: 'server.ready', port: process.env.PORT ?? 3000 })));
async function schedule(): Promise<void> {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (parts >= '07:00' && state.lastSchedule !== day && !digestRunning) {
    if (!(await evolutionReady())) return;
    try { await runDigest('schedule'); state.lastSchedule = day; await save(); }
    catch (error) { console.error(JSON.stringify({ stage: 'schedule.failed', error: String(error) })); }
  }
}
setInterval(() => void schedule(), 60_000);
void schedule();
process.on('SIGTERM', () => { server.close(); void disconnectMcp(); void accounts.close(); });
