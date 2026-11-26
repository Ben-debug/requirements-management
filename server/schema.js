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
      doc_type TEXT DEFAULT 'spec_doc',
      archive_category TEXT DEFAULT 'word_version',
      meeting_date TEXT,
      matched_systems TEXT DEFAULT '',
      matched_department TEXT DEFAULT '',
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
    CREATE TABLE IF NOT EXISTS work_ledgers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      entry_date TEXT NOT NULL,
      work_name TEXT NOT NULL,
      issuing_department TEXT,
      work_content TEXT,
      involved_people TEXT,
      completion_date TEXT,
      related_materials TEXT,
      remarks TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  // 兼容性迁移：旧数据库可能缺少新增列
  try { db.exec("ALTER TABLE requirement_points ADD COLUMN sub_batch TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE flow_files ADD COLUMN sub_batch TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE requirement_orders ADD COLUMN background TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE ccb_schedules ADD COLUMN is_project INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE ccb_schedules ADD COLUMN project_name TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE spec_documents ADD COLUMN notes TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE spec_documents ADD COLUMN doc_type TEXT DEFAULT 'spec_doc'"); } catch (e) {}
  try { db.exec("ALTER TABLE spec_documents ADD COLUMN meeting_date TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE spec_documents ADD COLUMN archive_category TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE spec_documents ADD COLUMN matched_department TEXT DEFAULT ''"); } catch (e) {}
  // 历史记录按既有规则回填归档类别：纪要→meeting_minutes，PDF→signed_scan，其余→word_version
  try {
    db.exec("UPDATE spec_documents SET archive_category='meeting_minutes' WHERE doc_type='meeting_minutes' AND (archive_category IS NULL OR archive_category='')");
    db.exec("UPDATE spec_documents SET archive_category='signed_scan' WHERE doc_type='spec_doc' AND lower(file_name) LIKE '%.pdf' AND (archive_category IS NULL OR archive_category='')");
    db.exec("UPDATE spec_documents SET archive_category='word_version' WHERE archive_category IS NULL OR archive_category=''");
  } catch (e) {}
  try { db.exec("ALTER TABLE flow_files ADD COLUMN deleted_at TEXT"); } catch (e) {}

  // 无会议排期兜底：用一条真实的“会议”记录承载未开会直接排期的需求点，
  // 这样所有 JOIN ccb_meetings 的既有查询（筛选、详情、导出、文档生成）无需特殊分支
  try { db.exec("ALTER TABLE ccb_meetings ADD COLUMN is_fallback INTEGER DEFAULT 0"); } catch (e) {}
  try {
    if (!db.prepare('SELECT 1 FROM ccb_meetings WHERE is_fallback=1').get()) {
      const existing = db.prepare("SELECT id FROM ccb_meetings WHERE meeting_name='-'").get();
      if (existing) {
        db.prepare('UPDATE ccb_meetings SET is_fallback=1 WHERE id=?').run(existing.id);
      } else {
        db.prepare("INSERT INTO ccb_meetings (meeting_name,meeting_date,notes,is_fallback) VALUES ('-','1900-01-01','未开会排期兜底',1)").run();
      }
    }
  } catch (e) {}

  // 高频筛选与关联字段索引：放在列迁移之后，旧库首次启动自动补齐
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ro_department ON requirement_orders(department);
    CREATE INDEX IF NOT EXISTS idx_ro_propose_date ON requirement_orders(propose_date);
    CREATE INDEX IF NOT EXISTS idx_rp_order_id ON requirement_points(order_id);
    CREATE INDEX IF NOT EXISTS idx_rp_version ON requirement_points(version);
    CREATE INDEX IF NOT EXISTS idx_ff_order_id ON flow_files(order_id);
    CREATE INDEX IF NOT EXISTS idx_cs_order_id ON ccb_schedules(order_id);
    CREATE INDEX IF NOT EXISTS idx_cs_point_id ON ccb_schedules(point_id);
    CREATE INDEX IF NOT EXISTS idx_cs_meeting_id ON ccb_schedules(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_cs_version ON ccb_schedules(version);
    CREATE INDEX IF NOT EXISTS idx_cs_project_name ON ccb_schedules(project_name);
    CREATE INDEX IF NOT EXISTS idx_cm_meeting_name ON ccb_meetings(meeting_name);
    CREATE INDEX IF NOT EXISTS idx_sd_version ON spec_documents(version);
    CREATE INDEX IF NOT EXISTS idx_sd_matched_department ON spec_documents(matched_department);
    CREATE INDEX IF NOT EXISTS idx_sdp_point_id ON spec_document_points(point_id);
    CREATE INDEX IF NOT EXISTS idx_wl_category ON work_ledgers(category);
    CREATE INDEX IF NOT EXISTS idx_wl_entry_date ON work_ledgers(entry_date);
    CREATE INDEX IF NOT EXISTS idx_wl_work_name ON work_ledgers(work_name);
  `);
}

module.exports = { initDatabase };
