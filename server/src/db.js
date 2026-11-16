/* ============================================================
   SQLite(better-sqlite3)+ WAL。全部预编译参数化语句。
   表结构见 docs/ARCHITECTURE.md §2。
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function now() {
  return Date.now();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  family_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  replaced_by TEXT,
  revoked_reason TEXT
);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  /* 每个用户都有固定 id 的「未整理」(folder-inbox),因此主键按用户隔离 */
  PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  original_name TEXT,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  thumb_key TEXT,
  regions TEXT,
  ocr_text TEXT,
  quality TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  title TEXT,
  image_count INTEGER NOT NULL DEFAULT 0,
  content_tags TEXT NOT NULL DEFAULT '[]',
  saved_at INTEGER NOT NULL,
  result TEXT NOT NULL DEFAULT '{}',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS record_images (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  upload_id TEXT REFERENCES uploads(id),
  name TEXT,
  width INTEGER,
  height INTEGER,
  size_kb INTEGER,
  legend_index INTEGER,
  quality TEXT,
  regions TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS urgent_tasks (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee TEXT,
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'todo',
  done INTEGER NOT NULL DEFAULT 0,
  src TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  record_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  /* 任务 id 可能来自客户端(如结果页 t-1),按用户隔离避免跨账号冲突 */
  PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS archives (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT,
  storage_key TEXT,
  link TEXT,
  original_name TEXT,
  mime_type TEXT,
  size INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  stage_index INTEGER NOT NULL DEFAULT 0,
  stage_label TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  error TEXT,
  result TEXT,
  scenario TEXT,
  image_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS daily_usage (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind, day)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);
CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_records_user_folder ON records(user_id, folder_id, is_deleted, saved_at);
CREATE INDEX IF NOT EXISTS idx_records_user_deleted ON records(user_id, is_deleted, deleted_at);
CREATE INDEX IF NOT EXISTS idx_record_images_record ON record_images(record_id);
CREATE INDEX IF NOT EXISTS idx_record_images_upload ON record_images(upload_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON urgent_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_archives_user ON archives(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON analysis_jobs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);
`;

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

/* 内存库(测试用) */
export function openMemoryDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/* 事务助手:fn(db) 内抛错则整体回滚 */
export function tx(db, fn) {
  const run = db.transaction(fn);
  return run();
}

/* 审计日志 */
export function audit(db, userId, action, entity, entityId = null) {
  try {
    db.prepare('INSERT INTO audit_log (id, user_id, action, entity, entity_id, created_at) VALUES (?,?,?,?,?,?)')
      .run(crypto.randomUUID(), userId, action, entity, entityId, now());
  } catch {
    /* 日志失败不影响主流程 */
  }
}

/* 每日调用计数:达到上限抛 429,未超则 +1 */
export function usageBump(db, userId, kind, dailyLimit) {
  const day = new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT calls FROM daily_usage WHERE user_id=? AND kind=? AND day=?').get(userId, kind, day);
  const used = row?.calls ?? 0;
  if (used >= dailyLimit) {
    return { ok: false, used, limit: dailyLimit };
  }
  db.prepare(
    'INSERT INTO daily_usage (user_id, kind, day, calls) VALUES (?,?,?,1) ON CONFLICT(user_id, kind, day) DO UPDATE SET calls = calls + 1'
  ).run(userId, kind, day);
  return { ok: true, used: used + 1, limit: dailyLimit };
}
