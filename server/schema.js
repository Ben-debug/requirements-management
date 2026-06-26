/**
 * 数据库 Schema 定义
 * 所有 CREATE TABLE 和 ALTER TABLE 迁移集中管理
 */

function initDatabase(db) {
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
    CREATE TABLE IF NOT EXISTS spec_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      matched_systems TEXT DEFAULT '',
      auto_matched INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS spec_document_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spec_id INTEGER NOT NULL,
      point_id INTEGER NOT NULL,
      FOREIGN KEY (spec_id) REFERENCES spec_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (point_id) REFERENCES requirement_points(id),
      UNIQUE(spec_id, point_id)
    );
  `);

  // 兼容性迁移：旧数据库可能缺少新增列
  try { db.exec("ALTER TABLE requirement_points ADD COLUMN sub_batch TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE flow_files ADD COLUMN sub_batch TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE requirement_orders ADD COLUMN background TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE ccb_schedules ADD COLUMN is_project INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE spec_documents ADD COLUMN notes TEXT DEFAULT ''"); } catch (e) {}
}

module.exports = { initDatabase };
