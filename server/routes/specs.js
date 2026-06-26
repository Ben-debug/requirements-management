/**
 * 需规归档路由
 * 系统需求点映射、文档 CRUD、目录扫描、系统匹配
 */
const { getDatabase } = require('../database');
const config = require('../config');
const { walkDir, paginate } = require('../utils');
const path = require('path');
const fs = require('fs');

module.exports = function (app) {

  const ROOT_DIR = path.join(__dirname, '..', '..');
  const DATA_DIR = process.pkg ? path.dirname(process.execPath) : ROOT_DIR;

  function getSpecDocDir() {
    const custom = config.getPath('spec_docs_dir');
    return custom || path.join(DATA_DIR, 'public', 'uploads', 'spec_docs');
  }

  // ---- 系统+需求点映射（用于需规匹配） ----
  app.get('/api/specs/systems', (req, res) => {
    try {
      const db = getDatabase();
      const { version } = req.query;
      if (!version) return res.status(400).json({ success: false, message: '请指定版本' });
      const schedules = db.prepare(`
        SELECT cs.point_id, cs.system, rp.point_number, rp.description,
          ro.order_number, ro.name as order_name
        FROM ccb_schedules cs
        JOIN requirement_points rp ON cs.point_id = rp.id
        JOIN requirement_orders ro ON rp.order_id = ro.id
        WHERE cs.version = ?
        ORDER BY ro.order_number, rp.point_number
      `).all(version);
      const systemGroups = {};
      for (const s of schedules) {
        const systems = s.system.split(',').map(x => x.trim()).filter(Boolean);
        for (const sys of systems) {
          if (!systemGroups[sys]) systemGroups[sys] = [];
          if (!systemGroups[sys].find(p => p.id === s.point_id)) {
            systemGroups[sys].push({ id: s.point_id, point_number: s.point_number, description: s.description, order_number: s.order_number, order_name: s.order_name });
          }
        }
      }
      const allSystems = config.getCategory('system');
      res.json({ success: true, data: { systems: allSystems, systemGroups } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 需规文档列表 ----
  app.get('/api/specs', (req, res) => {
    try {
      const db = getDatabase();
      const { page = 1, pageSize = 20, version, system } = req.query;
      let sql = `SELECT sd.*, (SELECT COUNT(*) FROM spec_document_points WHERE spec_id=sd.id) as point_count FROM spec_documents sd WHERE 1=1`;
      const params = [];
      if (version) { sql += ' AND sd.version=?'; params.push(version); }
      if (system) { sql += ' AND sd.matched_systems LIKE ?'; params.push(`%${system}%`); }
      sql += ' ORDER BY sd.version DESC, sd.file_name ASC';
      const result = paginate(sql, params, parseInt(page), parseInt(pageSize));
      const allVersions = config.getCategory('version');
      res.json({ success: true, ...result, filters: { versions: allVersions } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 需规文档详情 ----
  app.get('/api/specs/:id', (req, res) => {
    try {
      const db = getDatabase();
      const spec = db.prepare('SELECT * FROM spec_documents WHERE id=?').get(req.params.id);
      if (!spec) return res.status(404).json({ success: false, message: '需规文档不存在' });
      const points = db.prepare(`
        SELECT rp.*, ro.order_number, ro.name as order_name,
          cs.system as schedule_system, cs.version as schedule_version,
          cm.meeting_name, cm.meeting_date
        FROM spec_document_points sdp
        JOIN requirement_points rp ON sdp.point_id = rp.id
        JOIN requirement_orders ro ON rp.order_id = ro.id
        LEFT JOIN ccb_schedules cs ON cs.point_id = rp.id
        LEFT JOIN ccb_meetings cm ON cm.id = cs.meeting_id
        WHERE sdp.spec_id = ?
        ORDER BY ro.order_number, rp.point_number
      `).all(req.params.id);
      res.json({ success: true, data: { ...spec, points } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 扫描需规文档目录 ----
  app.post('/api/specs/scan', (req, res) => {
    try {
      const db = getDatabase();
      const { version } = req.body;
      if (!version) return res.status(400).json({ success: false, message: '请选择版本' });
      const specDir = getSpecDocDir();
      if (!fs.existsSync(specDir)) return res.json({ success: true, data: [], count: 0 });
      const allSystems = config.getCategory('system');
      if (!allSystems.length) return res.json({ success: true, data: [], count: 0, message: '请先配置系统名称' });
      const existingPaths = new Set(db.prepare('SELECT file_path FROM spec_documents').all().map(r => path.resolve(r.file_path)));
      const allFiles = walkDir(specDir);
      const ALLOWED_EXTS = ['.docx', '.doc', '.pdf'];
      const discovered = [];
      for (const filePath of allFiles) {
        if (existingPaths.has(path.resolve(filePath))) continue;
        const ext = path.extname(filePath).toLowerCase();
        if (!ALLOWED_EXTS.includes(ext)) continue;
        const fileName = path.basename(filePath);
        const matchedSystems = allSystems.filter(sys => fileName.includes(sys));
        discovered.push({ file_name: fileName, file_path: filePath, matched_systems: matchedSystems, auto_matched: matchedSystems.length > 0 ? 1 : 0 });
      }
      let autoCount = 0;
      if (discovered.length) {
        const insSpec = db.prepare('INSERT OR IGNORE INTO spec_documents (version, file_name, file_path, matched_systems, auto_matched) VALUES (?,?,?,?,?)');
        const insPoint = db.prepare('INSERT OR IGNORE INTO spec_document_points (spec_id, point_id) VALUES (?,?)');
        const allScheduled = db.prepare('SELECT cs.point_id, cs.system FROM ccb_schedules cs WHERE cs.version = ?').all(version);
        const systemPointMap = {};
        for (const s of allScheduled) {
          const systems = s.system.split(',').map(x => x.trim()).filter(Boolean);
          for (const sys of systems) {
            if (!systemPointMap[sys]) systemPointMap[sys] = new Set();
            systemPointMap[sys].add(s.point_id);
          }
        }
        db.transaction(() => {
          for (const f of discovered) {
            const matchedStr = f.matched_systems.join(',');
            const result = insSpec.run(version, f.file_name, f.file_path, matchedStr, f.auto_matched);
            if (result.changes === 0) continue;
            const specId = result.lastInsertRowid;
            autoCount++;
            if (f.auto_matched && f.matched_systems.length > 0) {
              const associatedPointIds = new Set();
              for (const sys of f.matched_systems) {
                if (systemPointMap[sys]) { for (const pid of systemPointMap[sys]) associatedPointIds.add(pid); }
              }
              for (const pid of associatedPointIds) insPoint.run(specId, pid);
            }
          }
        })();
      }
      res.json({ success: true, data: discovered, count: autoCount });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 更新需规系统匹配 ----
  app.put('/api/specs/:id/match', (req, res) => {
    try {
      const db = getDatabase();
      const { systems } = req.body;
      const spec = db.prepare('SELECT * FROM spec_documents WHERE id=?').get(req.params.id);
      if (!spec) return res.status(404).json({ success: false, message: '需规文档不存在' });
      const matchedStr = (systems || []).join(',');
      const allScheduled = db.prepare('SELECT cs.point_id, cs.system FROM ccb_schedules cs WHERE cs.version = ?').all(spec.version);
      const systemPointMap = {};
      for (const s of allScheduled) {
        const sysArr = s.system.split(',').map(x => x.trim()).filter(Boolean);
        for (const sys of sysArr) {
          if (!systemPointMap[sys]) systemPointMap[sys] = new Set();
          systemPointMap[sys].add(s.point_id);
        }
      }
      const associatedPointIds = new Set();
      for (const sys of (systems || [])) {
        if (systemPointMap[sys]) { for (const pid of systemPointMap[sys]) associatedPointIds.add(pid); }
      }
      db.transaction(() => {
        db.prepare("UPDATE spec_documents SET matched_systems=?, auto_matched=0, updated_at=datetime('now','localtime') WHERE id=?").run(matchedStr, req.params.id);
        db.prepare('DELETE FROM spec_document_points WHERE spec_id=?').run(req.params.id);
        const ins = db.prepare('INSERT OR IGNORE INTO spec_document_points (spec_id, point_id) VALUES (?,?)');
        for (const pid of associatedPointIds) ins.run(req.params.id, pid);
      })();
      res.json({ success: true, message: '匹配已更新，已自动关联 ' + associatedPointIds.size + ' 个需求点' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 删除需规文档 ----
  app.delete('/api/specs/:id', (req, res) => {
    try {
      const db = getDatabase();
      db.prepare('DELETE FROM spec_documents WHERE id=?').run(req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

};
