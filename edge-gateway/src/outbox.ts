import fs from 'fs';
import path from 'path';

export interface OutboxRow {
  id: number;
  msg_id: string;
  schema: string;
  machine_id: string;
  source: string;
  payload: string;
  status: 'PENDING' | 'IN_FLIGHT' | 'SENT' | 'FAILED';
  retry_count: number;
  created_at: string;
  sent_at: string | null;
  error_message: string | null;
}

export interface OutboxStats {
  pendingCount: number;
  sentCount: number;
  failedCount: number;
  totalCount: number;
  dbPath: string;
  walEnabled: boolean;
}

class SqliteOutbox {
  private db: any = null;
  private dbPath: string = '';
  private initialized: boolean = false;
  private memoryFallbackQueue: OutboxRow[] = [];
  private fallbackIdCounter: number = 1;

  public init(customDbPath?: string): void {
    if (this.initialized) return;

    this.dbPath = customDbPath || process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'data', 'sqlite', 'outbox.db');
    const dbDir = path.dirname(this.dbPath);

    try {
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Dynamically load node:sqlite (native in Node.js 22 LTS)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DatabaseSync } = require('node:sqlite');
      this.db = new DatabaseSync(this.dbPath);

      // Configure Write-Ahead Logging (WAL) for high performance & crash resiliency
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
      this.db.exec('PRAGMA temp_store = MEMORY;');
      this.db.exec('PRAGMA busy_timeout = 5000;');

      // Create Outbox Table & Indices
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS outbox_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          msg_id TEXT UNIQUE NOT NULL,
          schema TEXT NOT NULL,
          machine_id TEXT,
          source TEXT,
          payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          retry_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          sent_at TEXT,
          error_message TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_outbox_status_created ON outbox_messages(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_outbox_machine_id ON outbox_messages(machine_id);
      `);

      this.initialized = true;
      console.log(`📦 [OUTBOX] SQLite Outbox initialised with WAL mode at: ${this.dbPath}`);
    } catch (err: any) {
      console.warn(`⚠️ [OUTBOX] native node:sqlite not available (${err.message}). Using resilient in-memory queue.`);
      this.initialized = true;
    }
  }

  public enqueue(envelope: {
    schema: string;
    msgId: string;
    machineId?: string | null;
    source?: string;
    [key: string]: any;
  }): boolean {
    const now = new Date().toISOString();
    const payloadStr = JSON.stringify(envelope);
    const msgId = envelope.msgId || `${envelope.machineId || 'UNK'}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const schema = envelope.schema || 'ahi.generic/1.0';
    const machineId = envelope.machineId || null;
    const source = envelope.source || 'GATEWAY';

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO outbox_messages (msg_id, schema, machine_id, source, payload, status, retry_count, created_at)
          VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?)
          ON CONFLICT(msg_id) DO NOTHING
        `);
        stmt.run(msgId, schema, machineId, source, payloadStr, now);
        return true;
      } catch (err: any) {
        console.error(`❌ [OUTBOX] Failed to insert message ${msgId}:`, err.message);
        return false;
      }
    } else {
      // Memory fallback
      this.memoryFallbackQueue.push({
        id: this.fallbackIdCounter++,
        msg_id: msgId,
        schema,
        machine_id: machineId || '',
        source,
        payload: payloadStr,
        status: 'PENDING',
        retry_count: 0,
        created_at: now,
        sent_at: null,
        error_message: null
      });
      // Cap memory queue to prevent unbounded growth
      if (this.memoryFallbackQueue.length > 10000) {
        this.memoryFallbackQueue.shift();
      }
      return true;
    }
  }

  public getPending(limit = 100): OutboxRow[] {
    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          SELECT id, msg_id, schema, machine_id, source, payload, status, retry_count, created_at, sent_at, error_message
          FROM outbox_messages
          WHERE status = 'PENDING'
          ORDER BY id ASC
          LIMIT ?
        `);
        return stmt.all(limit) as OutboxRow[];
      } catch (err: any) {
        console.error(`❌ [OUTBOX] Query pending failed:`, err.message);
        return [];
      }
    } else {
      return this.memoryFallbackQueue
        .filter(r => r.status === 'PENDING')
        .slice(0, limit);
    }
  }

  public markSent(ids: number[]): void {
    if (ids.length === 0) return;
    const now = new Date().toISOString();

    if (this.db) {
      try {
        const placeholders = ids.map(() => '?').join(',');
        const stmt = this.db.prepare(`
          UPDATE outbox_messages 
          SET status = 'SENT', sent_at = ?
          WHERE id IN (${placeholders})
        `);
        stmt.run(now, ...ids);

        // Periodically purge sent messages older than 24 hours to keep DB compact
        this.db.exec(`
          DELETE FROM outbox_messages 
          WHERE status = 'SENT' AND datetime(sent_at) < datetime('now', '-1 day')
        `);
      } catch (err: any) {
        console.error(`❌ [OUTBOX] markSent failed:`, err.message);
      }
    } else {
      const idSet = new Set(ids);
      this.memoryFallbackQueue = this.memoryFallbackQueue.filter(r => !idSet.has(r.id));
    }
  }

  public markFailed(id: number, error: string): void {
    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          UPDATE outbox_messages 
          SET status = CASE WHEN retry_count >= 10 THEN 'FAILED' ELSE 'PENDING' END,
              retry_count = retry_count + 1,
              error_message = ?
          WHERE id = ?
        `);
        stmt.run(error, id);
      } catch (err: any) {
        console.error(`❌ [OUTBOX] markFailed failed:`, err.message);
      }
    } else {
      const item = this.memoryFallbackQueue.find(r => r.id === id);
      if (item) {
        item.retry_count++;
        item.error_message = error;
        if (item.retry_count >= 10) item.status = 'FAILED';
      }
    }
  }

  public getStats(): OutboxStats {
    if (this.db) {
      try {
        const row = this.db.prepare(`
          SELECT 
            SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pendingCount,
            SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sentCount,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failedCount,
            COUNT(*) as totalCount
          FROM outbox_messages
        `).get() as any;

        return {
          pendingCount: Number(row?.pendingCount || 0),
          sentCount: Number(row?.sentCount || 0),
          failedCount: Number(row?.failedCount || 0),
          totalCount: Number(row?.totalCount || 0),
          dbPath: this.dbPath,
          walEnabled: true
        };
      } catch {
        return {
          pendingCount: 0,
          sentCount: 0,
          failedCount: 0,
          totalCount: 0,
          dbPath: this.dbPath,
          walEnabled: true
        };
      }
    } else {
      return {
        pendingCount: this.memoryFallbackQueue.filter(r => r.status === 'PENDING').length,
        sentCount: 0,
        failedCount: this.memoryFallbackQueue.filter(r => r.status === 'FAILED').length,
        totalCount: this.memoryFallbackQueue.length,
        dbPath: 'memory://fallback',
        walEnabled: false
      };
    }
  }

  public close(): void {
    if (this.db) {
      try {
        this.db.close();
        console.log(`📦 [OUTBOX] Database connection closed cleanly.`);
      } catch (err: any) {
        console.error(`❌ [OUTBOX] Error closing database:`, err.message);
      }
    }
  }
}

export const outbox = new SqliteOutbox();
