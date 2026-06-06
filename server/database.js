const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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
    seedDefaultConfig();
  }
  return db;
}

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS requirement_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      department TEXT, proposer TEXT, propose_date TEXT, business_launch_date TEXT,
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
    CREATE TABLE IF NOT EXISTS config_params (
      id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, label TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(category, label)
    );
    CREATE TABLE IF NOT EXISTS upgrade_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);
}

function seedDefaultConfig() {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM config_params').get();
  if (count.cnt > 0) return;
  const defaults = [
    ['department','市场部'],['department','销售部'],['department','技术部'],
    ['department','产品部'],['department','财务部'],['department','人力资源部'],
    ['department','运营部'],['department','客服部'],['department','行政部'],
    ['version','v1.0.0'],['version','v1.1.0'],['version','v1.2.0'],
    ['version','v2.0.0'],['version','v2.1.0'],['version','v2.2.0'],['version','v3.0.0'],
    ['system','CRM系统'],['system','ERP系统'],['system','OA系统'],
    ['system','HR系统'],['system','WMS系统'],['system','订单系统'],
    ['system','财务系统'],['system','报表系统'],['system','BI系统'],['system','客服系统'],
    ['file_type','需求单'],['file_type','需求意向书'],['file_type','评估表'],
    ['file_type','技术方案'],['file_type','测试报告'],['file_type','验收报告'],
  ];
  const ins = db.prepare('INSERT OR IGNORE INTO config_params (category,label,sort_order) VALUES (?,?,?)');
  db.transaction(() => { defaults.forEach(([cat,label],i) => ins.run(cat,label,i)); })();
}

module.exports = { getDatabase };