import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient, type Client } from '@libsql/client';

export type Account = { number: string; primaryKey: string; backupKey: string; thread: string; lastActive: number };

export class AccountStore {
  private db: Client;
  private secret: Buffer;

  constructor(path: string, encryptionKey: string) {
    this.secret = Buffer.from(encryptionKey, 'base64');
    if (this.secret.length !== 32) throw new Error('ACCOUNT_ENCRYPTION_KEY must be 32 bytes encoded as base64');
    this.db = createClient({ url: `file:${path}` });
  }

  async init(): Promise<void> {
    await this.db.execute('CREATE TABLE IF NOT EXISTS accounts (number TEXT PRIMARY KEY, primary_key TEXT NOT NULL, backup_key TEXT NOT NULL, thread TEXT NOT NULL, last_active INTEGER NOT NULL)');
    await this.db.execute('CREATE TABLE IF NOT EXISTS setup_tokens (hash TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL, primary_key TEXT, backup_key TEXT, code_hash TEXT, attempts INTEGER NOT NULL DEFAULT 0)');
    await this.db.execute('CREATE TABLE IF NOT EXISTS handled_messages (id TEXT PRIMARY KEY, received INTEGER NOT NULL)');
  }

  private encrypt(value: string): string {
    if (!value) return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.secret, iv);
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map(part => part.toString('base64url')).join('.');
  }

  private decrypt(value: string): string {
    if (!value) return '';
    const [iv, tag, body] = value.split('.').map(part => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.secret, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  }

  async ensureOwner(number: string, primaryKey: string, backupKey: string, thread: string, lastActive: number): Promise<void> {
    await this.db.execute({ sql: 'INSERT OR IGNORE INTO accounts VALUES (?, ?, ?, ?, ?)', args: [number, this.encrypt(primaryKey), this.encrypt(backupKey), thread, lastActive] });
  }

  async get(number: string): Promise<Account | null> {
    const result = await this.db.execute({ sql: 'SELECT * FROM accounts WHERE number = ?', args: [number] });
    const row = result.rows[0];
    if (!row) return null;
    return { number, primaryKey: this.decrypt(String(row.primary_key)), backupKey: this.decrypt(String(row.backup_key)), thread: String(row.thread), lastActive: Number(row.last_active) };
  }

  async issueSetup(number: string): Promise<string> {
    if (!/^\d{10,15}$/.test(number)) throw new Error('Invalid WhatsApp number');
    const token = randomBytes(24).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    await this.db.batch([
      { sql: 'DELETE FROM setup_tokens WHERE number = ?', args: [number] },
      { sql: 'INSERT INTO setup_tokens (hash, number, expires) VALUES (?, ?, ?)', args: [hash, number, Date.now() + 10 * 60_000] },
    ], 'write');
    return token;
  }

  async setupNumber(token: string): Promise<string | null> {
    if (!/^[a-f0-9]{48}$/.test(token)) return null;
    const hash = createHash('sha256').update(token).digest('hex');
    const result = await this.db.execute({ sql: 'SELECT number FROM setup_tokens WHERE hash = ? AND expires > ? AND code_hash IS NULL', args: [hash, Date.now()] });
    return result.rows[0] ? String(result.rows[0].number) : null;
  }

  async submitKeys(token: string, primaryKey: string, backupKey: string): Promise<{ number: string; code: string }> {
    if (!primaryKey || (backupKey && backupKey === primaryKey)) throw new Error('Invalid or duplicate keys');
    const number = await this.setupNumber(token);
    if (!number) throw new Error('Setup link expired or used');
    const hash = createHash('sha256').update(token).digest('hex');
    const code = String(randomInt(100000, 1000000));
    const codeHash = createHmac('sha256', this.secret).update(`${hash}:${code}`).digest('hex');
    const result = await this.db.execute({
      sql: 'UPDATE setup_tokens SET primary_key = ?, backup_key = ?, code_hash = ?, attempts = 0 WHERE hash = ? AND expires > ? AND code_hash IS NULL',
      args: [this.encrypt(primaryKey), this.encrypt(backupKey), codeHash, hash, Date.now()],
    });
    if (!result.rowsAffected) throw new Error('Setup link expired or used');
    return { number, code };
  }

  async confirm(number: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const transaction = await this.db.transaction('write');
    try {
      const result = await transaction.execute({ sql: 'SELECT * FROM setup_tokens WHERE number = ? AND expires > ? AND code_hash IS NOT NULL', args: [number, Date.now()] });
      const row = result.rows[0];
      if (!row) { await transaction.rollback(); return false; }
      const expected = Buffer.from(String(row.code_hash), 'hex');
      const actual = createHmac('sha256', this.secret).update(`${row.hash}:${code}`).digest();
      if (!timingSafeEqual(expected, actual)) {
        if (Number(row.attempts) >= 2) await transaction.execute({ sql: 'DELETE FROM setup_tokens WHERE number = ?', args: [number] });
        else await transaction.execute({ sql: 'UPDATE setup_tokens SET attempts = attempts + 1 WHERE number = ?', args: [number] });
        await transaction.commit();
        return false;
      }
      await transaction.execute({
        sql: 'INSERT INTO accounts VALUES (?, ?, ?, ?, 0) ON CONFLICT(number) DO UPDATE SET primary_key = excluded.primary_key, backup_key = excluded.backup_key',
        args: [number, String(row.primary_key), String(row.backup_key), randomUUID()],
      });
      await transaction.execute({ sql: 'DELETE FROM setup_tokens WHERE number = ?', args: [number] });
      await transaction.commit();
      return true;
    } catch (error) { await transaction.rollback(); throw error; }
  }

  async saveSession(number: string, thread: string, lastActive: number): Promise<void> {
    await this.db.execute({ sql: 'UPDATE accounts SET thread = ?, last_active = ? WHERE number = ?', args: [thread, lastActive, number] });
  }

  async remove(number: string): Promise<void> {
    await this.db.batch([
      { sql: 'DELETE FROM accounts WHERE number = ?', args: [number] },
      { sql: 'DELETE FROM setup_tokens WHERE number = ?', args: [number] },
    ], 'write');
  }

  async wasHandled(id: string): Promise<boolean> {
    const result = await this.db.execute({ sql: 'SELECT 1 FROM handled_messages WHERE id = ?', args: [id] });
    return result.rows.length > 0;
  }

  async markHandled(id: string): Promise<void> {
    await this.db.execute({ sql: 'INSERT OR IGNORE INTO handled_messages VALUES (?, ?)', args: [id, Date.now()] });
  }

  async close(): Promise<void> { this.db.close(); }
}
