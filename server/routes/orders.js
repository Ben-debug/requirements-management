/**
 * 需求单 CRUD 路由
 * 需求单列表、详情、创建、更新、删除、文件扫描
 */
const { getDatabase } = require('../database');
const config = require('../config');
const { normalizeDate, paginate, walkDir } = require('../utils');
const path = require('path');
const fs = require('fs');

module.exports = function (app) {

  // ---- 目录路径辅助 ----
  const ROOT_DIR = path.join(__dirname, '..', '..');
  const DATA_DIR = process.pkg ? path.dirname(process.execPath) : ROOT_DIR;

  function getFlowFileDir() {
    const custom = config.getPath('flow_files_dir');
    return custom || path.join(DATA_DIR, 'public', 'uploads', 'flow_files');
  }
  function getServiceOrderDir() {
    const custom = config.getPath('service_order_dir');
    return custom || path.join(DATA_DIR, 'public', 'uploads', 'service_orders');
  }

  // ---- 需求单列表（筛选 + 分页 + 分组 + 排期摘要） ----
  app.get('/api/orders', (req, res) => {
    try {
      const db = getDatabase();
      const { page = 1, pageSize = 10, department, keyword, date_from, date_to, is_project, sort = 'created_at', order = 'desc', group_by } = req.query;
      let sql = 'SELECT * FROM requirement_orders WHERE 1=1';
      const params = [];
      if (department) { sql += ' AND department=?'; params.push(department); }
      if (keyword) { const k = `%${keyword}%`; sql += ' AND (order_number LIKE ? OR name LIKE ? OR proposer LIKE ?)'; params.push(k, k, k); }
      if (date_from) { sql += ' AND propose_date >= ?'; params.push(date_from); }
      if (date_to) { sql += ' AND propose_date <= ?'; params.push(date_to); }
      if (is_project === '1') {
        sql += " AND EXISTS (SELECT 1 FROM ccb_schedules cs JOIN requirement_points rp ON cs.point_id=rp.id WHERE rp.order_id=requirement_orders.id AND cs.is_project=1)";
      } else if (is_project === '0') {
        sql += " AND NOT EXISTS (SELECT 1 FROM ccb_schedules cs JOIN requirement_points rp ON cs.point_id=rp.id WHERE rp.order_id=requirement_orders.id AND cs.is_project=1)";
      }
      // 排序白名单
      const sortFields = { 'created_at': 'created_at', 'order_number': 'order_number', 'propose_date': 'propose_date', 'department': 'department', 'name': 'name' };
      const sortCol = sortFields[sort] || 'created_at';
      const sortDir = order === 'asc' ? 'ASC' : 'DESC';
      if (sort === 'order_number') {
        sql += ` ORDER BY SUBSTR(order_number, 1, 1) ${sortDir}, CAST(SUBSTR(order_number, 2) AS INTEGER) ${sortDir}`;
      } else {
        sql += ` ORDER BY ${sortCol} ${sortDir}`;
      }
      const result = paginate(sql, params, parseInt(page), parseInt(pageSize));

      // 分组处理
      let grouped = null;
      if (group_by && group_by === 'department') {
        const sortBy = sort === 'order_number'
          ? `SUBSTR(order_number, 1, 1) ${sortDir}, CAST(SUBSTR(order_number, 2) AS INTEGER) ${sortDir}`
          : `${sortCol} ${sortDir}`;
        const allItems = db.prepare(`SELECT * FROM (${sql.replace(/ORDER BY.*$/, '')}) ORDER BY department, ${sortBy}`).all(...params);
        grouped = {};
        allItems.forEach(o => {
          const key = o.department || '未指定';
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(o);
        });
      }

      // 排期摘要
      const allIds = [...new Set([
        ...(result.items || []).map(o => o.id),
        ...(grouped ? Object.values(grouped).flat().map(o => o.id) : [])
      ])];
      const summary = getScheduleSummary(allIds, db);
      const enrich = (o) => { o.schedule_summary = summary[o.id] || { total: 0, scheduled: 0 }; return o; };
      result.items = result.items.map(enrich);
      if (grouped) {
        Object.keys(grouped).forEach(k => { grouped[k] = grouped[k].map(enrich); });
      }

      const departments = config.getCategory('department');
      res.json({ success: true, ...result, grouped, filters: { departments } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 需求单详情 ----
  app.get('/api/orders/:id', (req, res) => {
    try {
      const db = getDatabase();
      const order = db.prepare('SELECT * FROM requirement_orders WHERE id=?').get(req.params.id);
      if (!order) return res.status(404).json({ success: false });
      const points = db.prepare('SELECT * FROM requirement_points WHERE order_id=? ORDER BY id').all(req.params.id);
      const files = db.prepare('SELECT * FROM flow_files WHERE order_id=? ORDER BY id').all(req.params.id);
      const schedules = db.prepare(`SELECT cs.*, cm.meeting_name, cm.meeting_date FROM ccb_schedules cs JOIN ccb_meetings cm ON cs.meeting_id=cm.id WHERE cs.order_id=?`).all(req.params.id);
      const pointsWithSchedule = points.map(p => {
        const s = schedules.find(x => x.point_id === p.id);
        return { ...p, schedule_system: s ? s.system : p.system, schedule_version: s ? s.version : p.version, meeting_name: s ? s.meeting_name : null, meeting_date: s ? s.meeting_date : null, schedule_id: s ? s.id : null, meeting_id: s ? s.meeting_id : null };
      });
      res.json({ success: true, data: { ...order, points: pointsWithSchedule, files, schedules } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 文件自动扫描 ----
  app.get('/api/orders/:id/scan-files', (req, res) => {
    try {
      const db = getDatabase();
      const orderId = parseInt(req.params.id);
      const order = db.prepare('SELECT id, order_number FROM requirement_orders WHERE id=?').get(orderId);
      if (!order) return res.status(404).json({ success: false, message: '需求单不存在' });
      const serviceDir = getServiceOrderDir();
      if (!fs.existsSync(serviceDir)) return res.json({ success: true, data: [], count: 0 });
      const existing = new Set(
        db.prepare('SELECT file_path FROM flow_files WHERE order_id=?').all(orderId).map(r => path.resolve(r.file_path))
      );
      const validSubBatches = new Set(
        db.prepare('SELECT DISTINCT sub_batch FROM requirement_points WHERE order_id=? AND sub_batch IS NOT NULL AND sub_batch != ?').all(orderId, '').map(r => r.sub_batch)
      );
      const allFiles = walkDir(serviceDir);
      const discovered = [];
      const orderNum = order.order_number;
      for (const filePath of allFiles) {
        if (existing.has(path.resolve(filePath))) continue;
        const fileName = path.basename(filePath);
        const ext = path.extname(fileName).toLowerCase();
        let fileType, matchStr;
        const bracketEnd = fileName.indexOf('】');
        if (bracketEnd !== -1) {
          matchStr = fileName.substring(bracketEnd + 1);
          if (!matchStr.startsWith(orderNum)) continue;
          const typeMatch = fileName.match(/【([^】]+)】/);
          fileType = typeMatch ? typeMatch[1] : '未知';
        } else if (ext === '.pdf') {
          const nameWithoutExt = path.basename(fileName, ext);
          if (!nameWithoutExt.startsWith(orderNum)) continue;
          matchStr = nameWithoutExt;
          fileType = '需求服务单';
        } else {
          continue;
        }
        let subBatch = null;
        const restAfterOrder = matchStr.substring(orderNum.length);
        const subBatchMatch = restAfterOrder.match(/^-(\d+)-\s*/);
        if (subBatchMatch) {
          const extracted = subBatchMatch[1];
          if (validSubBatches.has(extracted)) subBatch = extracted;
        }
        discovered.push({ original_name: fileName, stored_name: fileName, file_path: filePath, file_type: fileType, sub_batch: subBatch });
      }
      let count = 0;
      if (discovered.length) {
        const ins = db.prepare('INSERT OR IGNORE INTO flow_files (order_id, file_type, original_name, file_path, stored_name, sub_batch) VALUES (?,?,?,?,?,?)');
        db.transaction(() => {
          for (const f of discovered) { ins.run(orderId, f.file_type, f.original_name, f.file_path, f.stored_name, f.sub_batch); count++; }
        })();
      }
      res.json({ success: true, data: discovered, count });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 编号唯一性检查 ----
  app.get('/api/orders/check/:orderNumber', (req, res) => {
    try {
      const db = getDatabase();
      res.json({ success: true, exists: !!db.prepare('SELECT id FROM requirement_orders WHERE order_number=?').get(req.params.orderNumber) });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 创建需求单 ----
  app.post('/api/orders', (req, res) => {
    try {
      const db = getDatabase();
      const { order_number, name, department, related_departments, proposer, propose_date, business_launch_date, background } = req.body;
      if (!/^[A-Z]\d+$/.test(order_number)) return res.status(400).json({ success: false, message: '编号格式不正确（需大写字母开头+数字，如 A01）' });
      if (db.prepare('SELECT id FROM requirement_orders WHERE order_number=?').get(order_number)) return res.status(400).json({ success: false, message: '编号已存在' });
      const rds = related_departments ? (Array.isArray(related_departments) ? related_departments.join(',') : related_departments) : '';
      const nd = normalizeDate(propose_date);
      const r = db.prepare('INSERT INTO requirement_orders (order_number,name,department,related_departments,proposer,propose_date,business_launch_date,background) VALUES (?,?,?,?,?,?,?,?)').run(order_number, name, department, rds, proposer, nd, business_launch_date, background);
      res.json({ success: true, data: { id: r.lastInsertRowid } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 更新需求单 ----
  app.put('/api/orders/:id', (req, res) => {
    try {
      const db = getDatabase();
      const { order_number, name, department, related_departments, proposer, propose_date, business_launch_date, background } = req.body;
      if (order_number) {
        if (!/^[A-Z]\d+$/.test(order_number)) return res.status(400).json({ success: false, message: '编号格式不正确（需大写字母开头+数字，如 A01）' });
        const dup = db.prepare('SELECT id FROM requirement_orders WHERE order_number=? AND id!=?').get(order_number, req.params.id);
        if (dup) return res.status(400).json({ success: false, message: '该编号已被其他需求单使用' });
      }
      const rds = related_departments ? (Array.isArray(related_departments) ? related_departments.join(',') : related_departments) : '';
      const nd = normalizeDate(propose_date);
      if (order_number) {
        db.prepare("UPDATE requirement_orders SET order_number=?,name=?,department=?,related_departments=?,proposer=?,propose_date=?,business_launch_date=?,background=?,updated_at=datetime('now','localtime') WHERE id=?").run(order_number, name, department, rds, proposer, nd, business_launch_date, background, req.params.id);
      } else {
        db.prepare("UPDATE requirement_orders SET name=?,department=?,related_departments=?,proposer=?,propose_date=?,business_launch_date=?,background=?,updated_at=datetime('now','localtime') WHERE id=?").run(name, department, rds, proposer, nd, business_launch_date, background, req.params.id);
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 删除需求单 ----
  app.delete('/api/orders/:id', (req, res) => {
    try {
      const db = getDatabase();
      db.prepare('DELETE FROM requirement_orders WHERE id=?').run(req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 需求点 ----
  app.post('/api/orders/:orderId/points', (req, res) => {
    try {
      const db = getDatabase();
      const { description, sub_batch } = req.body;
      const order = db.prepare('SELECT order_number FROM requirement_orders WHERE id=?').get(req.params.orderId);
      if (!order) return res.status(404).json({ success: false, message: '需求单不存在' });
      const max = db.prepare("SELECT point_number FROM requirement_points WHERE order_id=? ORDER BY id DESC LIMIT 1").get(req.params.orderId);
      let seq = 1;
      if (max) { const m = max.point_number.match(/(\d{3})$/); seq = m ? parseInt(m[1]) + 1 : 1; }
      const pointNumber = `${order.order_number}${String(seq).padStart(3, '0')}`;
      const r = db.prepare('INSERT INTO requirement_points (order_id,point_number,description,sub_batch) VALUES (?,?,?,?)').run(req.params.orderId, pointNumber, description, sub_batch || null);
      res.json({ success: true, data: { id: r.lastInsertRowid, point_number: pointNumber } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.put('/api/points/:id', (req, res) => {
    try {
      const db = getDatabase();
      const { description, sub_batch } = req.body;
      db.prepare("UPDATE requirement_points SET description=?, sub_batch=?, updated_at=datetime('now','localtime') WHERE id=?").run(description, sub_batch || null, req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.delete('/api/points/:id', (req, res) => {
    try {
      const db = getDatabase();
      db.prepare('DELETE FROM requirement_points WHERE id=?').run(req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 搜索（保留在 orders 中，因为是对需求单的搜索） ----
  app.get('/api/search', (req, res) => {
    try {
      const db = getDatabase();
      const kw = req.query.keyword || '';
      if (!kw.trim()) return res.json({ success: true, data: [] });
      const like = `%${kw}%`;
      const orders = db.prepare(`SELECT DISTINCT ro.* FROM requirement_orders ro LEFT JOIN requirement_points rp ON ro.id=rp.order_id WHERE ro.order_number LIKE ? OR ro.name LIKE ? OR ro.department LIKE ? OR ro.proposer LIKE ? OR rp.description LIKE ? OR rp.point_number LIKE ? ORDER BY ro.created_at DESC`).all(like, like, like, like, like, like);
      const result = [];
      for (const order of orders) {
        const allPoints = db.prepare('SELECT * FROM requirement_points WHERE order_id=? ORDER BY point_number').all(order.id);
        const schedules = db.prepare(`SELECT cs.*, cm.meeting_name FROM ccb_schedules cs JOIN ccb_meetings cm ON cs.meeting_id=cm.id WHERE cs.order_id=?`).all(order.id);
        const pointsWithSchedule = allPoints.map(p => { const s = schedules.find(x => x.point_id === p.id); return { ...p, schedule_system: s ? s.system : p.system, schedule_version: s ? s.version : p.version, meeting_name: s ? s.meeting_name : null }; });
        result.push({ ...order, matchedPoints: pointsWithSchedule });
      }
      res.json({ success: true, data: result });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

};

// ---- 排期摘要（供 orders 路由内部使用） ----
function getScheduleSummary(orderIds, db) {
  if (!orderIds.length) return {};
  const placeholders = orderIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT rp.order_id, COUNT(*) as total,
    SUM(CASE WHEN cs.id IS NOT NULL THEN 1 ELSE 0 END) as scheduled,
    SUM(CASE WHEN cs.is_project THEN 1 ELSE 0 END) as project_count
    FROM requirement_points rp LEFT JOIN ccb_schedules cs ON cs.point_id=rp.id
    WHERE rp.order_id IN (${placeholders}) GROUP BY rp.order_id`).all(...orderIds);
  const map = {};
  rows.forEach(r => { map[r.order_id] = { total: r.total, scheduled: r.scheduled, project_count: r.project_count || 0 }; });
  return map;
}
