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

const DB_PATH = path.join(DATA_DIR, 'requirements.db');
let db;

function getDatabase() {
  if (!db) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    db = new Database(DB_PATH);
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
}

module.exports = { getDatabase };