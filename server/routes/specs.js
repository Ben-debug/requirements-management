/**
 * 需规归档路由
 * 文档 CRUD、目录扫描、系统匹配、评审会议纪要
 */
const { getDatabase } = require('../database');
const config = require('../config');
const { walkDir, paginate, sendFileInline, sendFileMissing, handleFileOpen } = require('../utils');
const path = require('path');
const fs = require('fs');

module.exports = function (app) {

  const ROOT_DIR = path.join(__dirname, '..', '..');
  const DATA_DIR = process.pkg ? path.dirname(process.execPath) : ROOT_DIR;

  function getSpecDocDir() {
    const custom = config.getPath('spec_docs_dir');
    return custom || path.join(DATA_DIR, 'public', 'uploads', 'spec_docs');
  }

  // ============================================================
  // 系统+需求点映射（用于需规匹配）
  // ============================================================
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

  // ============================================================
  // 树状数据（版本→文档→系统→需求单→需求点 + 会议纪要）
  // ============================================================
  app.get('/api/specs/tree', (req, res) => {
    try {
      const db = getDatabase();
      const { version } = req.query;

      // --- 需规文档树 ---
      let sql = `
        SELECT sd.id as spec_id, sd.file_name, sd.version, sd.matched_systems, sd.auto_matched,
               sdp.point_id,
               rp.point_number, rp.description,
               ro.id as order_id, ro.order_number, ro.name as order_name,
               cs.system as sched_system
        FROM spec_documents sd
        LEFT JOIN spec_document_points sdp ON sdp.spec_id = sd.id
        LEFT JOIN requirement_points rp ON rp.id = sdp.point_id
        LEFT JOIN requirement_orders ro ON rp.order_id = ro.id
        LEFT JOIN ccb_schedules cs ON cs.point_id = rp.id AND cs.version = sd.version
        WHERE sd.doc_type='spec_doc'
      `;
      const params = [];
      if (version) { sql += ' AND sd.version=?'; params.push(version); }
      sql += ' ORDER BY sd.file_name, cs.system, ro.order_number, rp.point_number';

      const rows = db.prepare(sql).all(...params);

      // 按 version 分组
      const versionMap = new Map();
      for (const row of rows) {
        if (!versionMap.has(row.version)) {
          versionMap.set(row.version, { version: row.version, docMap: new Map() });
        }
        const verObj = versionMap.get(row.version);
        if (!verObj.docMap.has(row.spec_id)) {
          verObj.docMap.set(row.spec_id, {
            id: row.spec_id,
            file_name: row.file_name,
            version: row.version,
            matched_systems: row.matched_systems || '',
            auto_matched: row.auto_matched || 0,
            systems: new Map()
          });
        }
        const spec = verObj.docMap.get(row.spec_id);
        if (!row.point_id) continue;

        const pointSystems = row.sched_system
          ? row.sched_system.split(',').map(x => x.trim()).filter(Boolean) : [];
        const docSystems = (row.matched_systems || '').split(',').map(x => x.trim()).filter(Boolean);
        const effectiveSystems = pointSystems.filter(s => docSystems.includes(s));
        if (!effectiveSystems.length) continue;

        for (const sys of effectiveSystems) {
          if (!spec.systems.has(sys)) spec.systems.set(sys, { name: sys, orders: new Map() });
          const sysObj = spec.systems.get(sys);
          const orderKey = row.order_number || '';
          if (!sysObj.orders.has(orderKey)) {
            sysObj.orders.set(orderKey, { order_id: row.order_id, order_number: row.order_number || '', order_name: row.order_name || '', points: [] });
          }
          const order = sysObj.orders.get(orderKey);
          if (!order.points.find(p => p.point_id === row.point_id)) {
            order.points.push({ point_id: row.point_id, point_number: row.point_number || '', description: row.description || '' });
          }
        }
      }

      // --- 评审会议纪要（来自 spec_documents，按 doc_type 区分） ---
      const meetings = db.prepare(
        "SELECT id, version, file_name, file_path, notes as meeting_name, meeting_date, created_at FROM spec_documents WHERE doc_type='meeting_minutes' AND (? IS NULL OR version=?) ORDER BY meeting_date DESC, created_at DESC"
      ).all(version || null, version || null);
      const meetingsByVersion = {};
      for (const m of meetings) {
        if (!meetingsByVersion[m.version]) meetingsByVersion[m.version] = [];
        meetingsByVersion[m.version].push(m);
      }

      // 补全 matched_systems 中缺乏排期数据的系统，确保它们在树中可见
      for (const verObj of versionMap.values()) {
        for (const spec of verObj.docMap.values()) {
          const docSystems = (spec.matched_systems || '').split(',').map(s => s.trim()).filter(Boolean);
          for (const sys of docSystems) {
            if (!spec.systems.has(sys)) {
              spec.systems.set(sys, { name: sys, orders: new Map() });
            }
          }
        }
      }

      // 组装输出
      const allVersions = config.getCategory('version');
      const versionOrder = allVersions.reduce((acc, v, i) => { acc[v] = i; return acc; }, {});
      const sorted = [], unsorted = [];

      for (const verObj of versionMap.values()) {
        const entry = { version: verObj.version, documents: [], meetings: meetingsByVersion[verObj.version] || [] };
        for (const spec of verObj.docMap.values()) {
          const systemsArr = [];
          for (const sys of spec.systems.values()) {
            const ordersArr = [];
            for (const order of sys.orders.values()) ordersArr.push(order);
            ordersArr.sort((a, b) => a.order_number.localeCompare(b.order_number));
            systemsArr.push({ name: sys.name, orders: ordersArr });
          }
          systemsArr.sort((a, b) => a.name.localeCompare(b.name));
          entry.documents.push({ id: spec.id, file_name: spec.file_name, version: spec.version, matched_systems: spec.matched_systems, auto_matched: spec.auto_matched, allSystems: systemsArr });
        }
        entry.documents.sort((a, b) => a.file_name.localeCompare(b.file_name));
        (verObj.version in versionOrder ? sorted[versionOrder[verObj.version]] = entry : unsorted.push(entry));
      }

      // 没有文档但有关联会议纪要的版本也要显示
      for (const m of meetings) {
        if (!versionMap.has(m.version)) {
          (m.version in versionOrder ? sorted[versionOrder[m.version]] = { version: m.version, documents: [], meetings: meetingsByVersion[m.version] || [] } : null);
        }
      }

      const tree = sorted.filter(Boolean).concat(unsorted);
      res.json({ success: true, data: tree, filters: { versions: allVersions } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ============================================================
  // 需规文档查询（按版本/系统/部门/关键字）
  // ============================================================
  app.get('/api/specs/query', (req, res) => {
    try {
      const db = getDatabase();
      const { version, system, department, keyword, project_name, page = 1, pageSize = 20 } = req.query;

      let sql = `
        SELECT sd.*,
          (SELECT GROUP_CONCAT(DISTINCT ro.order_number)
           FROM spec_document_points sdp
           JOIN requirement_points rp ON rp.id = sdp.point_id
           JOIN requirement_orders ro ON ro.id = rp.order_id
           WHERE sdp.spec_id = sd.id) as related_orders,
          (SELECT GROUP_CONCAT(DISTINCT ro.department)
           FROM spec_document_points sdp
           JOIN requirement_points rp ON rp.id = sdp.point_id
           JOIN requirement_orders ro ON ro.id = rp.order_id
           WHERE sdp.spec_id = sd.id) as related_departments
        FROM spec_documents sd
        WHERE sd.doc_type='spec_doc'
      `;
      const params = [];
      if (version) { sql += ' AND sd.version=?'; params.push(version); }
      if (system) { sql += ' AND sd.matched_systems LIKE ?'; params.push(`%${system}%`); }
      if (keyword) { sql += ' AND (sd.file_name LIKE ? OR sd.notes LIKE ?)'; const k = `%${keyword}%`; params.push(k, k); }
      if (department) {
        sql += ` AND EXISTS (SELECT 1 FROM spec_document_points sdp2
                 JOIN requirement_points rp2 ON rp2.id = sdp2.point_id
                 JOIN requirement_orders ro2 ON ro2.id = rp2.order_id
                 WHERE sdp2.spec_id = sd.id AND ro2.department = ?)`;
        params.push(department);
      }
      if (project_name) {
        sql += ` AND EXISTS (SELECT 1 FROM spec_document_points sdp3
                 JOIN ccb_schedules cs3 ON cs3.point_id = sdp3.point_id
                 WHERE sdp3.spec_id = sd.id AND cs3.is_project=1 AND cs3.project_name = ?)`;
        params.push(project_name);
      }
      sql += ' ORDER BY sd.version DESC, sd.file_name';

      const result = paginate(sql, params, parseInt(page), parseInt(pageSize));
      const versions = config.getCategory('version');
      const systems = config.getCategory('system');
      const departments = config.getCategory('department');
      const usedProjects = db.prepare("SELECT DISTINCT project_name FROM ccb_schedules WHERE is_project=1 AND project_name IS NOT NULL AND project_name!='' ORDER BY project_name").all().map(r => r.project_name);
      const projects = [...new Set([...config.getCategory('project'), ...usedProjects])];
      res.json({ success: true, ...result, filters: { versions, systems, departments, projects } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ============================================================
  // 扫描目录（自动发现需规文档 + 评审会议纪要）
  // ============================================================
  app.post('/api/specs/scan', (req, res) => {
    try {
      const db = getDatabase();
      const { version } = req.body;
      if (!version) return res.status(400).json({ success: false, message: '请选择版本' });

      const specBaseDir = getSpecDocDir();
      const versionDir = path.join(specBaseDir, version);
      if (!fs.existsSync(versionDir) || !fs.statSync(versionDir).isDirectory()) {
        return res.json({ success: true, data: [], count: 0, meeting_count: 0, skipBecauseMissingVersionDir: true,
          message: `需规目录中不存在版本「${version}」对应的文件夹。\n请将需规文档放入需规目录下的「${version}」子文件夹中，会议纪要放入「${version}/meetings/」子文件夹。\n\n当前需规目录: ${specBaseDir}` });
      }

      const ALLOWED_EXTS = ['.docx', '.doc', '.pdf'];
      const ALLOWED_EXTS_SET = new Set(ALLOWED_EXTS);
      const SEP = path.sep;

      // ---- 遍历版本目录，按路径分离需规文档和会议纪要 ----
      const allFiles = walkDir(versionDir);
      const specFiles = [], meetingFiles = [];
      for (const filePath of allFiles) {
        const ext = path.extname(filePath).toLowerCase();
        if (!ALLOWED_EXTS_SET.has(ext)) continue;
        const rel = path.relative(versionDir, filePath);
        if (rel.startsWith('meetings' + SEP) || rel.startsWith('meetings/')) {
          meetingFiles.push(filePath);
        } else {
          specFiles.push(filePath);
        }
      }

      const allSystems = config.getCategory('system');

      // ---- 处理需规文档 ----
      const specDiscovered = [];
      for (const filePath of specFiles) {
        const fileName = path.basename(filePath);
        const matchedSystems = allSystems.filter(sys => fileName.includes(sys));
        specDiscovered.push({ file_name: fileName, file_path: filePath, matchedSystems, auto_matched: matchedSystems.length > 0 ? 1 : 0 });
      }

      // 预加载已有需规文档记录（保留手动匹配）
      const existingSpecRecords = db.prepare("SELECT id, file_path, auto_matched, matched_systems FROM spec_documents WHERE version=? AND doc_type='spec_doc'").all(version);
      const existingSpecMap = new Map();
      for (const r of existingSpecRecords) existingSpecMap.set(path.resolve(r.file_path), r);

      const delSpec = db.prepare('DELETE FROM spec_documents WHERE id=?');
      const insSpec = db.prepare("INSERT INTO spec_documents (version, file_name, file_path, matched_systems, auto_matched, doc_type) VALUES (?,?,?,?,?,'spec_doc')");
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

      let autoCount = 0, manualPreserved = 0;
      db.transaction(() => {
        for (const f of specDiscovered) {
          const resolvedPath = path.resolve(f.file_path);
          const existing = existingSpecMap.get(resolvedPath);
          if (existing && existing.auto_matched === 0) { manualPreserved++; continue; }
          if (existing) delSpec.run(existing.id);
          const result = insSpec.run(version, f.file_name, f.file_path, f.matchedSystems.join(','), f.auto_matched);
          const specId = result.lastInsertRowid; autoCount++;
          if (f.auto_matched && f.matchedSystems.length > 0) {
            const pointIds = new Set();
            for (const sys of f.matchedSystems) { if (systemPointMap[sys]) for (const pid of systemPointMap[sys]) pointIds.add(pid); }
            for (const pid of pointIds) insPoint.run(specId, pid);
          }
        }
      })();

      // ---- 处理评审会议纪要 ----
      const existingMeetingPaths = new Set(
        db.prepare("SELECT file_path FROM spec_documents WHERE version=? AND doc_type='meeting_minutes'").all(version).map(r => path.resolve(r.file_path))
      );
      let meetingAutoCount = 0;
      if (meetingFiles.length) {
        const insMeeting = db.prepare("INSERT INTO spec_documents (version, file_name, file_path, doc_type, notes) VALUES (?,?,?,'meeting_minutes',?)");
        db.transaction(() => {
          for (const filePath of meetingFiles) {
            if (existingMeetingPaths.has(path.resolve(filePath))) continue;
            const fileName = path.basename(filePath);
            const meetingName = path.basename(fileName, path.extname(fileName));
            insMeeting.run(version, fileName, filePath, meetingName);
            meetingAutoCount++;
          }
        })();
      }

      // ---- 组装返回 ----
      let hasSpec = specDiscovered.length > 0, hasMeeting = meetingFiles.length > 0;
      if (!hasSpec && !hasMeeting) {
        return res.json({ success: true, data: [], count: 0, meeting_count: 0, message: '在版本目录中未发现需规文档或评审纪要' });
      }

      let msg = `扫描完成：${autoCount} 个文档已处理`;
      if (meetingAutoCount > 0) msg += `，${meetingAutoCount} 份评审纪要已关联`;
      if (manualPreserved > 0) msg += `，${manualPreserved} 个手动匹配文档已保留`;
      if (autoCount === 0 && meetingAutoCount === 0 && manualPreserved > 0) msg = `扫描完成：${manualPreserved} 个手动匹配文档已保留，未发现新文件`;
      res.json({ success: true, data: specDiscovered, count: autoCount, meeting_count: meetingAutoCount, message: msg });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ============================================================
  // 评审会议纪要 — 删除（保留，树状图中可删除）
  // ============================================================
  app.delete('/api/specs/meetings/:id', (req, res) => {
    try {
      const db = getDatabase();
      const m = db.prepare("SELECT * FROM spec_documents WHERE id=? AND doc_type='meeting_minutes'").get(req.params.id);
      if (!m) return res.status(404).json({ success: false, message: '会议纪要不存在' });
      if (m.file_path && fs.existsSync(m.file_path)) fs.unlinkSync(m.file_path);
      db.prepare('DELETE FROM spec_documents WHERE id=?').run(req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ============================================================
  // 需规文档下载 / 在线预览
  // ============================================================
  app.get('/api/specs/:id/download', (req, res) => {
    try {
      const db = getDatabase();
      const spec = db.prepare("SELECT * FROM spec_documents WHERE id=? AND doc_type='spec_doc'").get(req.params.id);
      if (!spec) return res.status(404).json({ success: false, message: '需规文档不存在' });
      if (!spec.file_path || !fs.existsSync(spec.file_path)) return sendFileMissing(res, spec.file_name, spec.file_path);
      res.download(spec.file_path, spec.file_name);
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.get('/api/specs/:id/preview', (req, res) => {
    try {
      const db = getDatabase();
      const spec = db.prepare("SELECT * FROM spec_documents WHERE id=? AND doc_type='spec_doc'").get(req.params.id);
      if (!spec) return res.status(404).json({ success: false, message: '需规文档不存在' });
      if (!spec.file_path || !fs.existsSync(spec.file_path)) return sendFileMissing(res, spec.file_name, spec.file_path);
      sendFileInline(res, spec.file_path, spec.file_name);
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 需规文档智能打开 ----
  app.get('/api/specs/:id/open', (req, res) => {
    try {
      const db = getDatabase();
      const spec = db.prepare("SELECT * FROM spec_documents WHERE id=? AND doc_type='spec_doc'").get(req.params.id);
      if (!spec) return res.status(404).json({ success: false, message: '需规文档不存在' });
      handleFileOpen(req, res, spec.file_path, spec.file_name);
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ============================================================
  // 需规文档详情 / 匹配 / 删除
  // ============================================================
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
        for (const sys of s.system.split(',').map(x => x.trim()).filter(Boolean)) {
          if (!systemPointMap[sys]) systemPointMap[sys] = new Set();
          systemPointMap[sys].add(s.point_id);
        }
      }
      const pointIds = new Set();
      for (const sys of (systems || [])) { if (systemPointMap[sys]) for (const pid of systemPointMap[sys]) pointIds.add(pid); }
      db.transaction(() => {
        db.prepare("UPDATE spec_documents SET matched_systems=?, auto_matched=0, updated_at=datetime('now','localtime') WHERE id=?").run(matchedStr, req.params.id);
        db.prepare('DELETE FROM spec_document_points WHERE spec_id=?').run(req.params.id);
        const ins = db.prepare('INSERT OR IGNORE INTO spec_document_points (spec_id, point_id) VALUES (?,?)');
        for (const pid of pointIds) ins.run(req.params.id, pid);
      })();
      res.json({ success: true, message: '手动匹配已更新，已关联 ' + pointIds.size + ' 个需求点（后续扫描将保留此匹配）' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.delete('/api/specs/:id', (req, res) => {
    try {
      const db = getDatabase();
      db.prepare("DELETE FROM spec_documents WHERE id=? AND doc_type='spec_doc'").run(req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

};
