import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'contract-review.db');

let SQL: SqlJsStatic;
let db: Database & { __dirty?: boolean };
let saveTimer: NodeJS.Timeout | null = null;

interface Statement {
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: any[]): any | undefined;
  all(...params: any[]): any[];
}

function wrapStmt(stmt: any): Statement {
  return {
    run(...params: any[]) {
      if (params.length) stmt.bind(params);
      const changes = stmt.step() ? 0 : 0;
      const lastId = (db as any).exec?.('SELECT last_insert_rowid() as id')?.[0]?.values?.[0]?.[0] ?? 0;
      stmt.reset();
      db.__dirty = true;
      scheduleSave();
      return { changes, lastInsertRowid: Number(lastId) };
    },
    get(...params: any[]) {
      if (params.length) stmt.bind(params);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.reset();
        return row;
      }
      stmt.reset();
      return undefined;
    },
    all(...params: any[]) {
      if (params.length) stmt.bind(params);
      const results: any[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.reset();
      return results;
    }
  };
}

function saveToDisk() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const tmpPath = dbPath + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, dbPath);
    db.__dirty = false;
  } catch (e) {
    console.error('[DB] Save failed:', e);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveToDisk();
  }, 1500);
}

function pragma(name: string, value: string) {
  try {
    db.exec(`PRAGMA ${name} = ${value}`);
  } catch (e) {
    // sql.js may not support all pragmas
  }
}

export async function initDatabase() {
  if (db) return;
  SQL = await initSqlJs({
    locateFile: (file) => {
      const wasmPath = require.resolve('sql.js/dist/' + file);
      return wasmPath;
    }
  });

  let buffer: Buffer | null = null;
  if (fs.existsSync(dbPath)) {
    try {
      buffer = fs.readFileSync(dbPath);
    } catch (e) {
      console.warn('[DB] Failed to read existing db, creating new one');
    }
  }

  db = new SQL.Database(buffer ? new Uint8Array(buffer) : undefined) as typeof db;
  db.__dirty = false;

  pragma('journal_mode', 'WAL');
  pragma('foreign_keys', 'ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'legal', 'business')),
      display_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clauses (
      id TEXT PRIMARY KEY,
      contract_id TEXT REFERENCES contracts(id) ON DELETE CASCADE,
      clause_number TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
      current_version INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clause_versions (
      id TEXT PRIMARY KEY,
      clause_id TEXT REFERENCES clauses(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'low',
      created_by TEXT REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      change_summary TEXT,
      UNIQUE(clause_id, version_number)
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id TEXT PRIMARY KEY,
      clause_id TEXT REFERENCES clauses(id) ON DELETE CASCADE,
      clause_version_id TEXT REFERENCES clause_versions(id),
      base_version INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('comment', 'amendment')),
      content TEXT NOT NULL,
      amended_title TEXT,
      amended_content TEXT,
      risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'merged')),
      created_by TEXT REFERENCES users(id),
      created_by_role TEXT NOT NULL,
      exclusive_role TEXT CHECK (exclusive_role IN ('legal', 'business', 'all')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      resolved_by TEXT REFERENCES users(id),
      decision_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS suggestion_drafts (
      id TEXT PRIMARY KEY,
      clause_id TEXT NOT NULL REFERENCES clauses(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      base_version INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('comment', 'amendment')),
      content TEXT NOT NULL DEFAULT '',
      amended_title TEXT,
      amended_content TEXT,
      risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
      exclusive_role TEXT CHECK (exclusive_role IN ('legal', 'business', 'all')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(clause_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      user_id TEXT REFERENCES users(id),
      user_role TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_clauses_contract ON clauses(contract_id);
    CREATE INDEX IF NOT EXISTS idx_clause_versions_clause ON clause_versions(clause_id);
    CREATE INDEX IF NOT EXISTS idx_suggestions_clause ON suggestions(clause_id);
    CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS idx_drafts_clause_user ON suggestion_drafts(clause_id, user_id);
  `);

  process.on('beforeExit', () => {
    if (db && db.__dirty) saveToDisk();
  });
  process.on('SIGINT', () => {
    if (db && db.__dirty) saveToDisk();
    process.exit(0);
  });
}

const proxyDb = new Proxy({} as any, {
  get(_, prop) {
    if (prop === 'prepare') {
      return (sql: string): Statement => {
        const stmt = db.prepare(sql);
        return wrapStmt(stmt);
      };
    }
    if (prop === 'exec') {
      return (sql: string) => {
        db.exec(sql);
        db.__dirty = true;
        scheduleSave();
      };
    }
    if (prop === 'pragma') {
      return pragma;
    }
    if (prop === '__raw') {
      return db;
    }
    return (db as any)[prop];
  }
});

export default proxyDb as {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  pragma(name: string, value: string): void;
};
