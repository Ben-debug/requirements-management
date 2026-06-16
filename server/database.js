const path = require('path');
const fs = require('fs');

let Database;
if (process.pkg) {
  // In pkg, load better-sqlite3 from filesystem (JS wrapper + native) alongside exe
  const pkgDir = path.dirname(process.execPath);
  const modDir = path.join(pkgDir, 'node_modules', 'better-sqlite3');
  Database = require(path.join(modDir, 'lib', 'database'));
} else {
  Database = require('better-sqlite3');
}

// Determine data directory - next to executable for pkg, or in project root
let DATA_DIR;
if (process.pkg) {
  DATA_DIR = path.join(path.dirname(process.execPath), 'data');
} else {
  DATA_DIR = path.join(__dirname, '..', 'data');
}

// Allow custom data dir from main server (set via initDataDir)
let customDataDir = null;

function getDataDir() {
  return customDataDir || DATA_DIR;
}

function initDataDir(dir) {
  if (dir) customDataDir = dir;
}

const DB_PATH = path.join(getDataDir(), 'requirements.db');
let db;

/**
 * 重新打开数据库（用于 data_dir 热切换，无需重启服务）
 * 1. 将旧库复制到新路径（如果还不存在）
 * 2. 关闭旧连接，切换 customDataDir，在新路径上重建连接
 */
function reopenDatabase(newDir) {
  if (!newDir || newDir === getDataDir()) return;
  if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
  // 迁移数据库文件到新路径
  const oldPath = path.join(getDataDir(), 'requirements.db');
  const newPath = path.join(newDir, 'requirements.db');
  if (!fs.existsSync(newPath) && fs.existsSync(oldPath)) {
    // WAL 模式需先 checkpoint 确保数据完整性
    if (db) db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(oldPath, newPath);
    for (const ext of ['-wal', '-shm']) {
      const f = oldPath + ext;
      if (fs.existsSync(f)) fs.copyFileSync(f, newPath + ext);
    }
  }
  // 关闭旧连接
  if (db) { try { db.close(); } catch(e) {} db = null; }
  // 切换目录
  customDataDir = newDir;
  // 重新打开（getDatabase 会走新路径）
  getDatabase();
}

function getDatabase() {
  if (!db) {
    const dataDir = getDataDir();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(path.join(dataDir, 'requirements.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initDatabase();
  }
  return db;
}

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS requirement_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      department TEXT, related_departments TEXT, proposer TEXT, propose_date TEXT, business_launch_date TEXT,
      status TEXT DEFAULT 'draft', created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS requirement_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL,
      point_number TEXT UNIQUE NOT NULL, description TEXT NOT NULL, system TEXT, version TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (order_id) REFERENCES requirement_orders(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS flow_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL,
      file_type TEXT NOT NULL, original_name TEXT NOT NULL, stored_name TEXT NOT NULL,
      file_path TEXT NOT NULL, uploaded_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (order_id) REFERENCES requirement_orders(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS ccb_meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_name TEXT NOT NULL,
      meeting_date TEXT NOT NULL, notes TEXT, file_name TEXT, file_path TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS ccb_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL, point_id INTEGER NOT NULL, system TEXT NOT NULL,
      version TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (meeting_id) REFERENCES ccb_meetings(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES requirement_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (point_id) REFERENCES requirement_points(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS upgrade_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);
  // 兼容性迁移：旧数据库可能缺少新增列
  try { db.exec("ALTER TABLE requirement_points ADD COLUMN sub_batch TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE flow_files ADD COLUMN sub_batch TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE requirement_orders ADD COLUMN background TEXT"); } catch(e) {}
}

module.exports = { getDatabase, initDataDir, reopenDatabase };