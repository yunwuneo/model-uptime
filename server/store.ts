import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';
import type { AlertLog, Channel, Incident, Monitor, Probe, SiteSettings } from '../shared/types.js';

export const defaults: SiteSettings = {
  title: 'Lumen',
  description: '每一次响应，都值得信赖。',
  defaultIntervalSeconds: 900,
  downAfterSeconds: 3600,
  retentionDays: 90,
  autoIncidents: true,
};
export class Store {
  db: DatabaseSync;
  private key: Buffer;
  constructor(directory: string) {
    const root = resolve(directory);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const keyPath = join(root, 'encryption.key');
    if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
    this.key = readFileSync(keyPath);
    if (this.key.length !== 32) throw new Error('Invalid encryption key file');
    this.db = new DatabaseSync(join(root, 'lumen.sqlite'));
    chmodSync(join(root, 'lumen.sqlite'), 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS monitors (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS probes (id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE, checked_at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS probes_by_monitor ON probes(monitor_id, checked_at DESC);
      CREATE INDEX IF NOT EXISTS probes_by_time ON probes(checked_at DESC);
      CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, csrf TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS casdoor_accounts (
        subject TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS casdoor_link_intents (
        token_hash TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        profile TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    if (!this.get('settings')) this.set('settings', defaults);
  }
  get<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
    return row ? (JSON.parse(row.value as string) as T) : null;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare('INSERT OR REPLACE INTO kv(key, value) VALUES (?, ?)')
      .run(key, JSON.stringify(value));
  }
  settings(): SiteSettings {
    return this.get<SiteSettings>('settings')!;
  }
  encrypt(value: unknown): string {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }
  decrypt<T>(value: string): T {
    const buf = Buffer.from(value, 'base64'),
      decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8'),
    ) as T;
  }
  private all<T>(table: 'monitors' | 'incidents' | 'channels'): T[] {
    return this.db
      .prepare(`SELECT data FROM ${table} ORDER BY rowid`)
      .all()
      .map((r) => JSON.parse(r.data as string) as T);
  }
  monitors(): Monitor[] {
    return this.all<Monitor>('monitors').map((m) => ({
      ...m,
      icon: m.icon ?? 'auto',
      revision: m.revision ?? 1,
    }));
  }
  monitor(id: string): Monitor | null {
    return this.monitors().find((m) => m.id === id) ?? null;
  }
  saveMonitor(m: Monitor) {
    this.db
      .prepare(
        'INSERT INTO monitors(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
      )
      .run(m.id, JSON.stringify(m));
  }
  deleteMonitor(id: string) {
    this.db.prepare('DELETE FROM monitors WHERE id = ?').run(id);
  }
  probes(id: string | null, since = Date.now() - 86400000): Probe[] {
    const query = id
      ? 'SELECT data FROM probes WHERE monitor_id = ? AND checked_at >= ? ORDER BY checked_at'
      : 'SELECT data FROM probes WHERE checked_at >= ? ORDER BY checked_at';
    const rows = id ? this.db.prepare(query).all(id, since) : this.db.prepare(query).all(since);
    const revision = id ? this.monitor(id)?.revision : undefined;
    return rows
      .map((r) => {
        const p = JSON.parse(r.data as string) as Probe;
        return { ...p, revision: p.revision ?? 1 };
      })
      .filter((p) => revision === undefined || p.revision === revision);
  }
  latest(id: string): Probe | null {
    const row = this.db
      .prepare(
        "SELECT data FROM probes WHERE monitor_id = ? AND COALESCE(json_extract(data, '$.revision'), 1) = ? ORDER BY checked_at DESC LIMIT 1",
      )
      .get(id, this.monitor(id)?.revision ?? 1);
    return row ? (JSON.parse(row.data as string) as Probe) : null;
  }
  saveProbe(p: Probe) {
    this.db
      .prepare('INSERT INTO probes VALUES (?, ?, ?, ?)')
      .run(p.id, p.monitorId, p.checkedAt, JSON.stringify(p));
  }
  incidents(): Incident[] {
    return this.all<Incident>('incidents').sort((a, b) => b.startedAt - a.startedAt);
  }
  saveIncident(i: Incident) {
    this.db.prepare('INSERT OR REPLACE INTO incidents VALUES (?, ?)').run(i.id, JSON.stringify(i));
  }
  deleteIncident(id: string) {
    this.db.prepare('DELETE FROM incidents WHERE id = ?').run(id);
  }
  channels(): Channel[] {
    return this.all('channels');
  }
  saveChannel(c: Channel) {
    this.db.prepare('INSERT OR REPLACE INTO channels VALUES (?, ?)').run(c.id, JSON.stringify(c));
  }
  deleteChannel(id: string) {
    this.db.prepare('DELETE FROM channels WHERE id = ?').run(id);
  }
  logAlert(log: Omit<AlertLog, 'id' | 'createdAt'>) {
    const item = { ...log, id: randomUUID(), createdAt: Date.now() };
    this.db
      .prepare('INSERT INTO alerts VALUES (?, ?, ?)')
      .run(item.id, item.createdAt, JSON.stringify(item));
  }
  alerts(): AlertLog[] {
    return this.db
      .prepare('SELECT data FROM alerts ORDER BY created_at DESC LIMIT 100')
      .all()
      .map((r) => JSON.parse(r.data as string) as AlertLog);
  }
  prune(now = Date.now()) {
    this.db
      .prepare('DELETE FROM probes WHERE checked_at < ?')
      .run(now - this.settings().retentionDays * 86400000);
    this.db
      .prepare('DELETE FROM alerts WHERE created_at < ?')
      .run(now - this.settings().retentionDays * 86400000);
    this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
    this.db.prepare('DELETE FROM casdoor_link_intents WHERE expires_at < ?').run(now);
  }
  casdoorAccount(subject: string): { subject: string; username: string } | null {
    return (
      (this.db
        .prepare('SELECT subject, username FROM casdoor_accounts WHERE subject = ?')
        .get(subject) as { subject: string; username: string } | undefined) ?? null
    );
  }
  casdoorUsername(username: string): { subject: string; username: string } | null {
    return (
      (this.db
        .prepare('SELECT subject, username FROM casdoor_accounts WHERE username = ?')
        .get(username) as { subject: string; username: string } | undefined) ?? null
    );
  }
  saveCasdoorAccount(subject: string, username: string) {
    this.db
      .prepare('INSERT INTO casdoor_accounts(subject, username, created_at) VALUES (?, ?, ?)')
      .run(subject, username, Date.now());
  }
  saveCasdoorIntent(tokenHash: string, subject: string, profile: unknown, expiresAt: number) {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO casdoor_link_intents(token_hash, subject, profile, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(tokenHash, subject, JSON.stringify(profile), expiresAt);
  }
  casdoorIntent(
    tokenHash: string,
  ): { subject: string; profile: unknown; expiresAt: number } | null {
    const row = this.db
      .prepare('SELECT subject, profile, expires_at FROM casdoor_link_intents WHERE token_hash = ?')
      .get(tokenHash) as { subject: string; profile: string; expires_at: number } | undefined;
    if (!row || row.expires_at <= Date.now()) {
      if (row)
        this.db.prepare('DELETE FROM casdoor_link_intents WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    return { subject: row.subject, profile: JSON.parse(row.profile), expiresAt: row.expires_at };
  }
  deleteCasdoorIntent(tokenHash: string) {
    this.db.prepare('DELETE FROM casdoor_link_intents WHERE token_hash = ?').run(tokenHash);
  }
  close() {
    this.db.close();
  }
}
