const path = require('path');
const fs = require('fs');
const { initDatabase } = require('./schema');

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

let db;

/**
 * 重新打开数据库（用于 data_dir 热切换，无需重启服务）
 */
function reopenDatabase(newDir) {
  if (!newDir || newDir === getDataDir()) return;
  if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
  // 迁移数据库文件到新路径
  const oldPath = path.join(getDataDir(), 'requirements.db');
  const newPath = path.join(newDir, 'requirements.db');
  if (!fs.existsSync(newPath) && fs.existsSync(oldPath)) {
    if (db) db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(oldPath, newPath);
    for (const ext of ['-wal', '-shm']) {
      const f = oldPath + ext;
      if (fs.existsSync(f)) fs.copyFileSync(f, newPath + ext);
    }
  }
  // 关闭旧连接
  if (db) { try { db.close(); } catch (e) {} db = null; }
  // 切换目录
  customDataDir = newDir;
  // 重新打开
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
    initDatabase(db);
  }
  return db;
}

module.exports = { getDatabase, initDataDir, reopenDatabase };