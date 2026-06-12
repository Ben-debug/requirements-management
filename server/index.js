const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const { getDatabase, initDataDir } = require('./database');
const config = require('./config');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
const ROOT_DIR = path.join(__dirname, '..');
// 注: pkg 环境下 __dirname 指向虚拟快照路径，public 资源通过快照访问
// 需要物理路径用于文件上传和数据存储
const DATA_DIR = process.pkg ? path.dirname(process.execPath) : ROOT_DIR;
// 如果配置了自定义 data 目录，传给数据库模块
const customDataDir = config.getPath('data_dir');
if (customDataDir) {
  initDataDir(customDataDir);
  if (!fs.existsSync(customDataDir)) fs.mkdirSync(customDataDir, { recursive: true });
}
app.use(express.static(path.join(ROOT_DIR, 'public')));

// ---- 提供首页 ----
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
});

// Upload directories - configured via params page, fallback to defaults
function getFlowFileDir() {
  const custom = config.getPath('flow_files_dir');
  return custom || path.join(DATA_DIR, 'public', 'uploads', 'flow_files');
}
function getMeetingFileDir() {
  const custom = config.getPath('meeting_files_dir');
  return custom || path.join(DATA_DIR, 'public', 'uploads', 'meeting_files');
}
function getUploadBaseDir() {
  return path.join(DATA_DIR, 'public', 'uploads');
}
// Ensure upload directories exist
function ensureUploadDirs() {
  const dirs = [getUploadBaseDir(), getFlowFileDir(), getMeetingFileDir()];
  dirs.forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
}
ensureUploadDirs();

// Rename helper: rename uploaded file with proper name under correct dir
function renameUploadedFile(oldPath, targetDir, newName) {
  const ext = path.extname(oldPath);
  const safeName = newName.replace(/[<>:"/\\|?*]/g, '_');
  const newPath = path.join(targetDir, Date.now()+'-'+safeName+ext);
  try {
    fs.renameSync(oldPath, newPath);
    return newPath;
  } catch(e) { return oldPath; }
}

const uploadTemp = multer({ dest: getUploadBaseDir() });

// ---- Auto create upgrade log on restart ----
try {
  const db = getDatabase();
  const lastLog = db.prepare('SELECT version FROM upgrade_logs ORDER BY id DESC LIMIT 1').get();
  const ver = lastLog ? bumpVersion(lastLog.version) : 'v1.0.0';
  db.prepare("INSERT INTO upgrade_logs (version,title,content) VALUES (?,?,?)").run(ver, `系统升级 ${ver}`, '系统自动记录启动更新');
} catch(e) {}

function bumpVersion(v) {
  const m = v.match(/v(\d+)\.(\d+)\.(\d+)/);
  if (!m) return 'v1.0.1';
  return `v${m[1]}.${m[2]}.${parseInt(m[3])+1}`;
}

// ---- 分页辅助 ----
function paginate(sql, params, page, pageSize) {
  const db = getDatabase();
  const countSql = `SELECT COUNT(*) as total FROM (${sql})`;
  const total = db.prepare(countSql).get(...params).total;
  const offset = (page - 1) * pageSize;
  const items = db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

// ---- 需求单 CRUD ----
app.get('/api/orders', (req, res) => {
  try {
    const db = getDatabase();
    const { page=1, pageSize=10, department, keyword, date_from, date_to, sort='created_at', order='desc', group_by } = req.query;
    let sql = 'SELECT * FROM requirement_orders WHERE 1=1';
    const params = [];
    if (department) { sql += ' AND department=?'; params.push(department); }
    if (keyword) { const k = `%${keyword}%`; sql += ' AND (order_number LIKE ? OR name LIKE ? OR proposer LIKE ?)'; params.push(k, k, k); }
    if (date_from) { sql += ' AND propose_date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND propose_date <= ?'; params.push(date_to); }
    // 排序白名单
    const sortFields = { 'created_at':'created_at', 'order_number':'order_number', 'propose_date':'propose_date', 'department':'department', 'name':'name' };
    const sortCol = sortFields[sort] || 'created_at';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortCol} ${sortDir}`;
    const result = paginate(sql, params, parseInt(page), parseInt(pageSize));
    
    // 分组处理（取全部匹配数据分组，但分页仍按当前页）
    let grouped = null;
    if (group_by && group_by === 'department') {
      const allSql = sql.replace(/LIMIT.*/, '');
      const allItems = db.prepare(`SELECT * FROM (${sql.replace(/ORDER BY.*$/, '')}) ORDER BY department, ${sortCol} ${sortDir}`).all(...params);
      grouped = {};
      allItems.forEach(o => {
        const key = o.department || '未指定';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(o);
      });
    }
    
    // 为每个需求单补充排期摘要（总点数/已排期点数）
    const scheduleSummary = (orderIds) => {
      if (!orderIds.length) return {};
      const placeholders = orderIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT rp.order_id, COUNT(*) as total, SUM(CASE WHEN cs.id IS NOT NULL THEN 1 ELSE 0 END) as scheduled
        FROM requirement_points rp LEFT JOIN ccb_schedules cs ON cs.point_id=rp.id
        WHERE rp.order_id IN (${placeholders}) GROUP BY rp.order_id`).all(...orderIds);
      const map = {};
      rows.forEach(r => { map[r.order_id] = { total: r.total, scheduled: r.scheduled }; });
      return map;
    };
    const allIds = (result.items || []).map(o => o.id);
    if (grouped) Object.values(grouped).forEach(arr => arr.forEach(o => allIds.push(o.id)));
    const uniqueIds = [...new Set(allIds)];
    const summary = scheduleSummary(uniqueIds);
    const enrich = (o) => { o.schedule_summary = summary[o.id] || { total: 0, scheduled: 0 }; return o; };
    result.items = result.items.map(enrich);
    if (grouped) {
      Object.keys(grouped).forEach(k => { grouped[k] = grouped[k].map(enrich); });
    }
    
    const departments = config.getCategory('department');
    res.json({ success: true, ...result, grouped, filters: { departments } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

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

app.get('/api/orders/check/:orderNumber', (req, res) => {
  try { const db = getDatabase(); res.json({ success: true, exists: !!db.prepare('SELECT id FROM requirement_orders WHERE order_number=?').get(req.params.orderNumber) }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/orders', (req, res) => {
  try {
    const db = getDatabase();
    const { order_number, name, department, related_departments, proposer, propose_date, business_launch_date, background } = req.body;
    if (db.prepare('SELECT id FROM requirement_orders WHERE order_number=?').get(order_number)) return res.status(400).json({ success: false, message: '编号已存在' });
    const rds = related_departments ? (Array.isArray(related_departments) ? related_departments.join(',') : related_departments) : '';
    const nd = normalizeDate(propose_date);
    const r = db.prepare('INSERT INTO requirement_orders (order_number,name,department,related_departments,proposer,propose_date,business_launch_date,background) VALUES (?,?,?,?,?,?,?,?)').run(order_number, name, department, rds, proposer, nd, business_launch_date, background);
    res.json({ success: true, data: { id: r.lastInsertRowid } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.put('/api/orders/:id', (req, res) => {
  try {
    const db = getDatabase();
    const { order_number, name, department, related_departments, proposer, propose_date, business_launch_date, background } = req.body;
    // 如果修改了编号，检查唯一性
    if (order_number) {
      if (!/^[A-Z]\d{2}$/.test(order_number)) return res.status(400).json({ success: false, message: '编号格式不正确（需1大写字母+2数字）' });
      const dup = db.prepare('SELECT id FROM requirement_orders WHERE order_number=? AND id!=?').get(order_number, req.params.id);
      if (dup) return res.status(400).json({ success: false, message: '该编号已被其他需求单使用' });
    }
    const rds = related_departments ? (Array.isArray(related_departments) ? related_departments.join(',') : related_departments) : '';
    if (order_number) {
      const nd = normalizeDate(propose_date);
      db.prepare("UPDATE requirement_orders SET order_number=?,name=?,department=?,related_departments=?,proposer=?,propose_date=?,business_launch_date=?,background=?,updated_at=datetime('now','localtime') WHERE id=?").run(order_number, name, department, rds, proposer, nd, business_launch_date, background, req.params.id);
    } else {
      const nd = normalizeDate(propose_date);
      db.prepare("UPDATE requirement_orders SET name=?,department=?,related_departments=?,proposer=?,propose_date=?,business_launch_date=?,background=?,updated_at=datetime('now','localtime') WHERE id=?").run(name, department, rds, proposer, nd, business_launch_date, background, req.params.id);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/orders/:id', (req, res) => {
  try { const db = getDatabase(); db.prepare('DELETE FROM requirement_orders WHERE id=?').run(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ---- 需求点 ----
app.post('/api/orders/:orderId/points', (req, res) => {
  try {
    const db = getDatabase(); const { description, sub_batch } = req.body;
    const order = db.prepare('SELECT order_number FROM requirement_orders WHERE id=?').get(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: '需求单不存在' });
    if (sub_batch !== undefined && sub_batch !== null && sub_batch !== '') {
      // 有批次号 → 子单模式：编号 A01-1-1
      if (!/^\d+$/.test(sub_batch)) return res.status(400).json({ success: false, message: '批次号应为纯数字' });
      const max = db.prepare("SELECT point_number FROM requirement_points WHERE order_id=? AND sub_batch=? ORDER BY id DESC LIMIT 1").get(req.params.orderId, sub_batch);
      let seq = 1;
      if (max) { const parts = max.point_number.split('-'); seq = parseInt(parts[2]) + 1; }
      const pointNumber = `${order.order_number}-${sub_batch}-${String(seq)}`;
      const r = db.prepare('INSERT INTO requirement_points (order_id,point_number,description,sub_batch) VALUES (?,?,?,?)').run(req.params.orderId, pointNumber, description, sub_batch);
      res.json({ success: true, data: { id: r.lastInsertRowid, point_number: pointNumber } });
    } else {
      // 无批次号 → 传统模式：编号 A01-1
      const max = db.prepare("SELECT point_number FROM requirement_points WHERE order_id=? AND sub_batch IS NULL AND point_number NOT LIKE '%-%-%' ORDER BY id DESC LIMIT 1").get(req.params.orderId);
      let seq = 1;
      if (max) { const parts = max.point_number.split('-'); seq = parseInt(parts[1]) + 1; }
      const pointNumber = `${order.order_number}-${String(seq)}`;
      const r = db.prepare('INSERT INTO requirement_points (order_id,point_number,description) VALUES (?,?,?)').run(req.params.orderId, pointNumber, description);
      res.json({ success: true, data: { id: r.lastInsertRowid, point_number: pointNumber } });
    }
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.put('/api/points/:id', (req, res) => {
  try { const db = getDatabase(); const { description } = req.body; db.prepare("UPDATE requirement_points SET description=?,updated_at=datetime('now','localtime') WHERE id=?").run(description, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 修改需求点编号
app.put('/api/points/:id/number', (req, res) => {
  try {
    const db = getDatabase(); const { point_number } = req.body;
    if (!point_number || !/^[A-Z]\d{2}(-\d+){1,2}$/.test(point_number)) return res.status(400).json({ success: false, message: '编号格式不正确（需如 A01-1 或 A01-1-1）' });
    const dup = db.prepare('SELECT id FROM requirement_points WHERE point_number=? AND id!=?').get(point_number, req.params.id);
    if (dup) return res.status(400).json({ success: false, message: '该编号已被其他需求点使用' });
    const point = db.prepare('SELECT id, order_id FROM requirement_points WHERE id=?').get(req.params.id);
    if (!point) return res.status(404).json({ success: false, message: '需求点不存在' });
    // 同步更新 ccb_schedules 中的引用显示（如果已排期）
    db.prepare("UPDATE requirement_points SET point_number=?, updated_at=datetime('now','localtime') WHERE id=?").run(point_number, req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/points/:id', (req, res) => {
  try { const db = getDatabase(); db.prepare('DELETE FROM requirement_points WHERE id=?').run(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ---- 文件 ----
function encodeName(name) { try { return Buffer.from(name, 'latin1').toString('utf8'); } catch(e) { return name; } }

// 需求单流转文件
app.post('/api/orders/:orderId/files', uploadTemp.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: '请选择文件' });
  try { const db = getDatabase(); const { file_type } = req.body; if (!file_type) return res.status(400).json({ success: false, message: '请选择文件类型' });
    const name = encodeName(req.file.originalname);
    const order = db.prepare('SELECT order_number, name FROM requirement_orders WHERE id=?').get(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: '需求单不存在' });
    // 自动修正文件名：若不以【文件类型】开头，自动按"【类型】编号-名称.扩展名"格式修正
    let fixedName = name;
    if (!fixedName.startsWith(`【${file_type}】`)) {
      fixedName = `【${file_type}】${order.order_number}-${order.name}${path.extname(name)}`;
    }
    // 以"订单ID-文件名"方式存储到 flow_files 根目录，避免不同订单文件重名
    const flowDir = getFlowFileDir();
    if (!fs.existsSync(flowDir)) fs.mkdirSync(flowDir, { recursive: true });
    const storedName = fixedName;
    const destPath = path.join(flowDir, storedName);
    // 同名文件处理：追加数字后缀
    let finalPath = destPath;
    let counter = 1;
    while (fs.existsSync(finalPath)) {
      const ext = path.extname(storedName);
      const base = path.basename(storedName, ext);
      finalPath = path.join(flowDir, `${base}(${counter++})${ext}`);
    }
    try { fs.copyFileSync(req.file.path, finalPath); fs.unlinkSync(req.file.path); } catch(e) { return res.status(500).json({ success: false, message: '文件保存失败' }); }
    db.prepare('INSERT INTO flow_files (order_id,file_type,original_name,stored_name,file_path) VALUES (?,?,?,?,?)').run(req.params.orderId, file_type, fixedName, path.basename(finalPath), finalPath);
    res.json({ success: true, data: { file_name: path.basename(finalPath) } }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/orders/:orderId/files', (req, res) => {
  try { const db = getDatabase(); res.json({ success: true, data: db.prepare('SELECT * FROM flow_files WHERE order_id=? ORDER BY id').all(req.params.orderId) }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 文件下载：用原始文件名返回
app.get('/api/files/:id/download', (req, res) => {
  try { const db = getDatabase(); const f = db.prepare('SELECT * FROM flow_files WHERE id=?').get(req.params.id); if (!f) return res.status(404).json({ success: false }); if (!fs.existsSync(f.file_path)) return res.status(404).json({ success: false, message: '文件已不存在' }); res.download(f.file_path, f.original_name); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/files/:id', (req, res) => {
  try { const db = getDatabase(); const f = db.prepare('SELECT * FROM flow_files WHERE id=?').get(req.params.id); if (f && fs.existsSync(f.file_path)) fs.unlinkSync(f.file_path); db.prepare('DELETE FROM flow_files WHERE id=?').run(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ---- CCB ----
app.get('/api/meetings', (req, res) => {
  try { const db = getDatabase(); res.json({ success: true, data: db.prepare('SELECT * FROM ccb_meetings ORDER BY meeting_date DESC').all() }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/meetings/:id', (req, res) => {
  try { const db = getDatabase(); const m = db.prepare('SELECT * FROM ccb_meetings WHERE id=?').get(req.params.id); if (!m) return res.status(404).json({ success: false }); const s = db.prepare(`SELECT cs.*, ro.order_number, ro.name as order_name, rp.point_number, rp.sub_batch, rp.description as point_description FROM ccb_schedules cs JOIN requirement_orders ro ON cs.order_id=ro.id JOIN requirement_points rp ON cs.point_id=rp.id WHERE cs.meeting_id=? ORDER BY ro.order_number, rp.point_number`).all(req.params.id); res.json({ success: true, data: { ...m, schedules: s } }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/meetings', (req, res) => {
  try { const db = getDatabase(); const r = db.prepare('INSERT INTO ccb_meetings (meeting_name,meeting_date,notes) VALUES (?,?,?)').run(req.body.meeting_name, req.body.meeting_date, req.body.notes); res.json({ success: true, data: { id: r.lastInsertRowid } }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// CCB会议纪要: 按会议ID分目录存储，保持原始文件名
app.post('/api/meetings/:id/file', uploadTemp.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false });
  try { const db = getDatabase();
    const meeting = db.prepare('SELECT meeting_name FROM ccb_meetings WHERE id=?').get(req.params.id);
    if (!meeting) return res.status(404).json({ success: false, message: '会议不存在' });
    let name = encodeName(req.file.originalname);
    // 自动修正文件名：若不以【会议纪要】开头，自动按"【会议纪要】会议名称.扩展名"格式修正
    if (!name.startsWith('【会议纪要】')) {
      name = `【会议纪要】${meeting.meeting_name}${path.extname(name)}`;
    }
    const meetingDir = getMeetingFileDir();
    if (!fs.existsSync(meetingDir)) fs.mkdirSync(meetingDir, { recursive: true });
    // 以"会议ID-原文件名"方式存储，避免不同会议的文件重名覆盖
    const storedName = name;
    const destPath = path.join(meetingDir, storedName);
    // 同名文件处理：追加数字后缀
    let finalPath = destPath;
    let counter = 1;
    while (fs.existsSync(finalPath)) {
      const ext = path.extname(storedName);
      const base = path.basename(storedName, ext);
      finalPath = path.join(meetingDir, `${base}(${counter++})${ext}`);
    }
    try { fs.copyFileSync(req.file.path, finalPath); fs.unlinkSync(req.file.path); } catch(e) { return res.status(500).json({ success: false, message: '文件保存失败' }); }
    db.prepare('UPDATE ccb_meetings SET file_name=?, file_path=? WHERE id=?').run(path.basename(finalPath), finalPath, req.params.id);
    res.json({ success: true, data: { file_name: path.basename(finalPath) } }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.put('/api/meetings/:id', (req, res) => {
  try { const db = getDatabase(); db.prepare('UPDATE ccb_meetings SET meeting_name=?, meeting_date=?, notes=? WHERE id=?').run(req.body.meeting_name, req.body.meeting_date, req.body.notes, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/meetings/:id', (req, res) => {
  try { const db = getDatabase(); db.prepare('DELETE FROM ccb_meetings WHERE id=?').run(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ---- 排期 ----
app.post('/api/meetings/:meetingId/schedules/batch', (req, res) => {
  try {
    const db = getDatabase(); const { schedules } = req.body;
    if (!schedules||!schedules.length) return res.status(400).json({ success: false, message: '请选择排期' });
    const ins = db.prepare('INSERT INTO ccb_schedules (meeting_id,order_id,point_id,system,version) VALUES (?,?,?,?,?)');
    const upd = db.prepare('UPDATE requirement_points SET system=?, version=? WHERE id=?');
    db.transaction(() => { schedules.forEach(s => { ins.run(req.params.meetingId, s.order_id, s.point_id, s.system, s.version); upd.run(s.system, s.version, s.point_id); }); })();
    res.json({ success: true, data: { count: schedules.length } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/meetings/:meetingId/schedules', (req, res) => {
  try { const db = getDatabase(); const { order_id, point_id, system, version } = req.body; db.prepare('INSERT INTO ccb_schedules (meeting_id,order_id,point_id,system,version) VALUES (?,?,?,?,?)').run(req.params.meetingId, order_id, point_id, system, version); db.prepare('UPDATE requirement_points SET system=?, version=? WHERE id=?').run(system, version, point_id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.put('/api/schedules/:id', (req, res) => {
  try {
    const db = getDatabase(); const { system, version, meeting_id } = req.body;
    const schedule = db.prepare('SELECT * FROM ccb_schedules WHERE id=?').get(req.params.id);
    if (!schedule) return res.status(404).json({ success: false });
    if (meeting_id && meeting_id != schedule.meeting_id) db.prepare('UPDATE ccb_schedules SET meeting_id=?, system=?, version=? WHERE id=?').run(meeting_id, system, version, req.params.id);
    else db.prepare('UPDATE ccb_schedules SET system=?, version=? WHERE id=?').run(system, version, req.params.id);
    db.prepare('UPDATE requirement_points SET system=?, version=? WHERE id=?').run(system, version, schedule.point_id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/schedules/:id', (req, res) => {
  try { const db = getDatabase(); const s = db.prepare('SELECT * FROM ccb_schedules WHERE id=?').get(req.params.id); if (s) db.prepare('UPDATE requirement_points SET system=NULL, version=NULL WHERE id=?').run(s.point_id); db.prepare('DELETE FROM ccb_schedules WHERE id=?').run(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/unscheduled-points', (req, res) => {
  try { const db = getDatabase(); res.json({ success: true, data: db.prepare(`SELECT rp.*, ro.order_number, ro.name as order_name FROM requirement_points rp JOIN requirement_orders ro ON rp.order_id=ro.id WHERE rp.id NOT IN (SELECT point_id FROM ccb_schedules) ORDER BY ro.order_number, rp.point_number`).all() }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ---- 全局搜索 ----
app.get('/api/search', (req, res) => {
  try {
    const db = getDatabase(); const kw = req.query.keyword||'';
    if (!kw.trim()) return res.json({ success: true, data: [] });
    const like = `%${kw}%`;
    const orders = db.prepare(`SELECT DISTINCT ro.* FROM requirement_orders ro LEFT JOIN requirement_points rp ON ro.id=rp.order_id WHERE ro.order_number LIKE ? OR ro.name LIKE ? OR ro.department LIKE ? OR ro.proposer LIKE ? OR rp.description LIKE ? OR rp.point_number LIKE ? ORDER BY ro.created_at DESC`).all(like, like, like, like, like, like);
    const result = [];
    for (const order of orders) {
      const allPoints = db.prepare('SELECT * FROM requirement_points WHERE order_id=? ORDER BY point_number').all(order.id);
      const schedules = db.prepare(`SELECT cs.*, cm.meeting_name FROM ccb_schedules cs JOIN ccb_meetings cm ON cs.meeting_id=cm.id WHERE cs.order_id=?`).all(order.id);
      const pointsWithSchedule = allPoints.map(p => { const s = schedules.find(x => x.point_id===p.id); return {...p, schedule_system: s?s.system:p.system, schedule_version: s?s.version:p.version, meeting_name: s?s.meeting_name:null}; });
      result.push({ ...order, matchedPoints: pointsWithSchedule });
    }
    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ---- 排期筛选 ----
app.get('/api/schedules/filter', (req, res) => {
  try {
    const db = getDatabase();
    const { version, department, meeting_name, system, group_by, page=1, pageSize=20 } = req.query;
    
    let sql = `SELECT cs.*, ro.order_number, ro.name as order_name, ro.department, rp.point_number, rp.sub_batch, rp.description as point_description, cm.meeting_name, cm.meeting_date FROM ccb_schedules cs JOIN requirement_orders ro ON cs.order_id=ro.id JOIN requirement_points rp ON cs.point_id=rp.id JOIN ccb_meetings cm ON cs.meeting_id=cm.id WHERE 1=1`;
    const params = [];
    if (version) { sql += ' AND cs.version=?'; params.push(version); }
    if (department) { sql += ' AND ro.department=?'; params.push(department); }
    if (meeting_name) { sql += ' AND cm.meeting_name LIKE ?'; params.push(`%${meeting_name}%`); }
    if (system) { sql += ' AND cs.system LIKE ?'; params.push(`%${system}%`); }
    sql += ' ORDER BY cm.meeting_date DESC';
    
    const countSql = `SELECT COUNT(*) as total FROM (${sql})`;
    const total = db.prepare(countSql).all(...params)[0].total;
    const p = parseInt(page), ps = parseInt(pageSize);
    const offset = (p - 1) * ps;
    const schedules = db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...params, ps, offset);
    
    const allVersions = config.getCategory('version');
    const allDepartments = config.getCategory('department');
    const allSystems = config.getCategory('system');
    const allMeetings = db.prepare('SELECT DISTINCT meeting_name FROM ccb_meetings ORDER BY meeting_name').all();
    
    let grouped = null;
    if (group_by && group_by !== 'none') {
      grouped = {};
      schedules.forEach(s => {
        let key;
        if (group_by === 'version') key = s.version || '未指定';
        else if (group_by === 'department') key = s.department || '未指定';
        else if (group_by === 'meeting') key = s.meeting_name || '未指定';
        else if (group_by === 'system') key = s.system ? s.system.split(',').map(x=>x.trim()).filter(Boolean)[0] || '未指定' : '未指定';
        else key = '其他';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(s);
      });
    }
    
    res.json({ success: true, data: schedules, total, page: p, pageSize: ps, totalPages: Math.ceil(total/ps), grouped, filters: { versions: allVersions, departments: allDepartments, meetings: allMeetings.map(m=>m.meeting_name), systems: allSystems } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ---- Excel导出（含排期信息） ----
// 筛选导出：接受与 /api/orders 相同的筛选参数，导出匹配结果
app.get('/api/export/filtered', (req, res) => {
  try {
    const db = getDatabase();
    const { department, keyword, date_from, date_to } = req.query;
    let sql = 'SELECT * FROM requirement_orders WHERE 1=1';
    const params = [];
    if (department) { sql += ' AND department=?'; params.push(department); }
    if (keyword) { const k = `%${keyword}%`; sql += ' AND (order_number LIKE ? OR name LIKE ? OR proposer LIKE ?)'; params.push(k, k, k); }
    if (date_from) { sql += ' AND propose_date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND propose_date <= ?'; params.push(date_to); }
    sql += ' ORDER BY order_number';
    const orders = db.prepare(sql).all(...params);
    exportOrdersToExcel(orders, res);
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

function pad2(n) { return String(n).padStart(2,'0'); }

// 日期统一格式化：支持 2026/6/11、2026-6-11、20260611 → 2026-06-11
function normalizeDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // 兼容 Excel M/D/YY 或 M/D/YYYY 格式（如 5/26/26、5/26/2026）
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    let y = parseInt(m[3]);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return `${y}-${pad2(parseInt(m[1]))}-${pad2(parseInt(m[2]))}`;
  }
  // 兼容 Excel 序列号（如 46185 → 2026-06-12）
  const num = Number(v);
  if (!isNaN(num) && num > 1 && num < 200000) {
    const d = new Date((num - 25569) * 86400000);
    if (!isNaN(d.getTime())) return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  }
  return s;
}

function exportOrdersToExcel(orders, res) {
  const db = getDatabase();
  const wb = xlsx.utils.book_new();
  const rows = [];
  for (const o of orders) {
    const points = db.prepare('SELECT * FROM requirement_points WHERE order_id=? ORDER BY point_number').all(o.id);
    if (points.length === 0) {
      rows.push({'需求单编号':o.order_number,'需求单名称':o.name,'业务部门':o.department||'','关联部门':o.related_departments||'','提出人':o.proposer||'','提出日期':o.propose_date||'','提出背景':o.background||'','提出背景':o.background||'', '业务上线预期':o.business_launch_date||'','需求点编号':'','需求点描述':'','涉及系统':'','上线版本':'','CCB会议':'','排期日期':''});
    } else {
      for (const p of points) {
        const sche = db.prepare(`SELECT cs.*, cm.meeting_name, cm.meeting_date FROM ccb_schedules cs JOIN ccb_meetings cm ON cs.meeting_id=cm.id WHERE cs.point_id=?`).get(p.id);
        rows.push({
          '需求单编号':o.order_number, '需求单名称':o.name, '业务部门':o.department||'', '关联部门':o.related_departments||'',
          '提出人':o.proposer||'', '提出日期':o.propose_date||'', '业务上线预期':o.business_launch_date||'',
          '需求点编号':p.point_number, '需求点描述':p.description,
          '涉及系统':sche ? sche.system : (p.system||''), '上线版本':sche ? sche.version : (p.version||''),
          'CCB会议':sche ? sche.meeting_name : '', '排期日期':sche ? sche.meeting_date : ''
        });
      }
    }
  }
  const ws = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, '需求单信息');
  const now = new Date();
  const dateStr = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}`;
  const fileName = `需求单信息-${dateStr}.xlsx`;
  const fp = path.join(getUploadBaseDir(), fileName);
  xlsx.writeFile(wb, fp);
  res.download(fp, fileName, err => { if (err) console.error(err); setTimeout(()=>{try{fs.unlinkSync(fp)}catch(e){}}, 5000); });
}

// 简化原有导出为调用公共函数
app.get('/api/export', (req, res) => {
  try {
    const db = getDatabase();
    const orders = db.prepare('SELECT * FROM requirement_orders ORDER BY order_number').all();
    exportOrdersToExcel(orders, res);
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 导入模板下载
app.get('/api/import/template', (req, res) => {
  try {
    const templateDir = path.join(ROOT_DIR, 'Release');
    const possiblePaths = [
      path.join(templateDir, '需求单导入模板.xlsx'),
      path.join(ROOT_DIR, '需求单导入模板.xlsx'),
    ];
    for (const fp of possiblePaths) {
      if (fs.existsSync(fp)) {
        return res.download(fp, '需求单导入模板.xlsx');
      }
    }
    res.status(404).json({ success: false, message: '模板文件不存在，请联系管理员' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/import', uploadTemp.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '请选择文件' });

    // 验证 Excel 文件
    let wb, data;
    try {
      wb = xlsx.readFile(req.file.path);
      if (!wb.Sheets || !wb.SheetNames || !wb.SheetNames[0]) throw new Error();
      const ws = wb.Sheets[wb.SheetNames[0]];
      data = xlsx.utils.sheet_to_json(ws, {raw: false, defval: ''});
    } catch (e) {
      try { fs.unlinkSync(req.file.path); } catch(ex){}
      return res.status(400).json({ success: false, message: '文件格式无法识别，请使用 .xlsx 文件' });
    }

    if (!data || data.length === 0) {
      try { fs.unlinkSync(req.file.path); } catch(ex){}
      return res.status(400).json({ success: false, message: 'Excel 文件中没有数据，请确认 Sheet 名称是否正确' });
    }

    // 检查关键列名是否存在
    if (!data[0].hasOwnProperty('需求单编号')) {
      try { fs.unlinkSync(req.file.path); } catch(ex){}
      const cols = Object.keys(data[0]).join('、');
      return res.status(400).json({ success: false, message: `未找到"需求单编号"列。当前列名：${cols}。请使用导入模板，列名必须完全一致。` });
    }

    const db = getDatabase();
    let orderCount = 0, pointCount = 0, meetingCount = 0, scheduleCount = 0, skipped = 0;
    const warnings = [];
    const insO = db.prepare('INSERT OR IGNORE INTO requirement_orders (order_number,name,department,proposer,propose_date,business_launch_date) VALUES (?,?,?,?,?,?)');
    const insP = db.prepare('INSERT INTO requirement_points (order_id,point_number,description,system,version) VALUES (?,?,?,?,?)');
    const insS = db.prepare('INSERT INTO ccb_schedules (meeting_id,order_id,point_id,system,version) VALUES (?,?,?,?,?)');
    const updP = db.prepare('UPDATE requirement_points SET system=?, version=? WHERE id=?');
    const orderSeqs = {};
    let rowNum = 0;

    db.transaction(() => {
      for (const row of data) {
        rowNum++;
        const on = row['需求单编号'];
        if (!on || !String(on).trim()) { continue; }
        if (!/^[A-Z]\d{2}$/.test(String(on))) {
          warnings.push(`第${rowNum}行：需求单编号"${on}"格式不正确（需1大写字母+2数字），已跳过`);
          skipped++;
          continue;
        }

        // --- 1. 创建/匹配需求单 ---
        const r = insO.run(on, row['需求单名称']||'', row['业务部门']||'', row['提出人']||'', normalizeDate(row['提出日期']), row['业务上线预期']||'');
        if (r.changes > 0) orderCount++;
        const order = db.prepare('SELECT id FROM requirement_orders WHERE order_number=?').get(on);
        if (!order) continue;

        // --- 2. 创建需求点 ---
        if (!row['需求点描述']) {
          warnings.push(`第${rowNum}行：需求单"${on}"缺少"需求点描述"，未创建需求点`);
          skipped++;
          continue;
        }

        const descs = String(row['需求点描述']).split(' | ').filter(d => d.trim());
        const sysArr = String(row['涉及系统']||'').split(' | ');
        const verArr = String(row['上线版本']||'').split(' | ');

        // 检查 | 分隔数量是否匹配
        if (sysArr.length > 1 && sysArr.length !== descs.length) {
          warnings.push(`第${rowNum}行："涉及系统"数量(${sysArr.length})与"需求点描述"数量(${descs.length})不一致，缺失系统已置空`);
        }
        if (verArr.length > 1 && verArr.length !== descs.length) {
          warnings.push(`第${rowNum}行："上线版本"数量(${verArr.length})与"需求点描述"数量(${descs.length})不一致，缺失版本已置空`);
        }

        // 初始化序号
        if (!orderSeqs[on]) {
          const maxP = db.prepare("SELECT point_number FROM requirement_points WHERE order_id=? ORDER BY id DESC LIMIT 1").get(order.id);
          orderSeqs[on] = maxP ? parseInt(maxP.point_number.split('-')[1]) + 1 : 1;
        }

        // 用户指定需求点编号处理
        const rawPN = row['需求点编号'] ? String(row['需求点编号']).trim() : '';
        let useManualPN = false;
        if (rawPN) {
          const pnMatch = rawPN.match(/^[A-Z]\d{2}-(\d+)$/);
          if (pnMatch) {
            const userSeq = parseInt(pnMatch[1]);
            if (userSeq >= orderSeqs[on]) orderSeqs[on] = userSeq;
            useManualPN = true;
          } else {
            warnings.push(`第${rowNum}行：需求点编号"${rawPN}"格式无效（应为${on}-N格式），已自动生成编号`);
          }
        }

        // 创建需求点
        const createdPoints = [];
        descs.forEach((d, i) => {
          const seq = orderSeqs[on]++;
          const pointNumber = useManualPN && i === 0 ? rawPN : `${on}-${String(seq)}`;
          const result = insP.run(order.id, pointNumber, d.trim(), sysArr[i]||'', verArr[i]||'');
          createdPoints.push({ id: result.lastInsertRowid, system: sysArr[i]||'', version: verArr[i]||'' });
          pointCount++;
        });

        // --- 3. 创建排期 ---
        const meetingName = row['CCB会议'] ? String(row['CCB会议']).trim() : '';
        if (meetingName) {
          let meeting = db.prepare('SELECT id FROM ccb_meetings WHERE meeting_name=?').get(meetingName);
          if (!meeting) {
            db.prepare('INSERT INTO ccb_meetings (meeting_name,meeting_date,notes) VALUES (?,?,?)').run(meetingName, normalizeDate(row['会议日期']), row['会议备注']||'');
            meeting = db.prepare('SELECT id FROM ccb_meetings WHERE meeting_name=?').get(meetingName);
            meetingCount++;
          }
          createdPoints.forEach(p => {
            insS.run(meeting.id, order.id, p.id, p.system, p.version);
            updP.run(p.system, p.version, p.id);
            scheduleCount++;
          });
        }
      }
    })();

    try { fs.unlinkSync(req.file.path); } catch(e){}

    const result = { orderCount, pointCount, meetingCount, scheduleCount, skipped };
    if (warnings.length > 0) result.warnings = warnings;
    res.json({ success: true, data: result });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch(e){}
    res.status(500).json({ success: false, message: '导入失败：' + err.message });
  }
});

// ---- 目录浏览（供前端文件夹选择器使用） ----
app.get('/api/config/browse', (req, res) => {
  try {
    const dirPath = req.query.path || (process.platform === 'win32' ? 'C:\\' : '/');
    // 安全检查：禁止浏览 node_modules
    if (dirPath.includes('node_modules')) return res.json({ success: true, data: { current: dirPath, parent: null, subdirs: [] } });
    if (!fs.existsSync(dirPath)) return res.status(400).json({ success: false, message: '路径不存在' });
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return res.status(400).json({ success: false, message: '不是目录' });
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const subdirs = items.filter(item => item.isDirectory() && !item.name.startsWith('.')).map(item => item.name).sort();
    // 计算父目录路径
    const parent = (() => {
      const resolved = path.resolve(dirPath);
      if (resolved === path.parse(resolved).root) return null;
      return path.dirname(resolved);
    })();
    res.json({ success: true, data: { current: path.resolve(dirPath), parent, subdirs } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ---- 参数配置 (JSON文件存储) ----

// 路径配置路由必须在 /api/config/:category 之前注册（避免被通配匹配）
app.get('/api/config/paths', (req, res) => {
  try {
    res.json({ success: true, data: {
      data_dir: config.getPath('data_dir'),
      flow_files_dir: config.getPath('flow_files_dir'),
      meeting_files_dir: config.getPath('meeting_files_dir'),
      defaults: {
        data_dir: DATA_DIR,
        flow_files_dir: path.join(DATA_DIR, 'public', 'uploads', 'flow_files'),
        meeting_files_dir: path.join(DATA_DIR, 'public', 'uploads', 'meeting_files')
      }
    }});
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/config/paths', (req, res) => {
  try {
    const { data_dir, flow_files_dir, meeting_files_dir } = req.body || {};
    if (data_dir !== undefined) config.setPath('data_dir', data_dir);
    if (flow_files_dir !== undefined) config.setPath('flow_files_dir', flow_files_dir);
    if (meeting_files_dir !== undefined) config.setPath('meeting_files_dir', meeting_files_dir);
    // 确保新目录存在
    if (flow_files_dir && !fs.existsSync(flow_files_dir)) fs.mkdirSync(flow_files_dir, { recursive: true });
    if (meeting_files_dir && !fs.existsSync(meeting_files_dir)) fs.mkdirSync(meeting_files_dir, { recursive: true });
    res.json({ success: true, message: '路径设置已保存，部分修改需重启服务后生效' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/config/:category', (req, res) => {
  try { res.json({ success: true, data: config.getCategory(req.params.category) }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/config', (req, res) => {
  try { res.json({ success: true, data: config.getAll() }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/config', (req, res) => {
  try { const {category, label} = req.body; if (!category||!label) return res.status(400).json({ success: false, message: '不能为空' }); config.addItem(category, label); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/config/:category/:label', (req, res) => {
  try { config.deleteItem(req.params.category, req.params.label); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ---- 升级日志 ----
app.get('/api/upgrade-logs', (req, res) => {
  try { const db = getDatabase(); res.json({ success: true, data: db.prepare('SELECT * FROM upgrade_logs ORDER BY created_at DESC').all() }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ---- 兜底：所有未匹配 API 的路由返回 index.html（支持前端路由） ----
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ success: false, message: 'API 不存在' });
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`需求单信息管理系统已启动: http://localhost:${PORT}`);
  // Auto-open browser (delayed to ensure server ready)
  setTimeout(() => {
    try {
      const url = `http://localhost:${PORT}`;
      const cp = require('child_process');
      if (process.platform === 'win32') {
        cp.exec(`cmd /c start "" "${url}"`);
      } else if (process.platform === 'darwin') {
        cp.exec(`open "${url}"`);
      } else {
        cp.exec(`xdg-open "${url}"`);
      }
    } catch(e) {}
  }, 500);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n错误: 端口 ${PORT} 已被占用！`);
    console.error('请关闭占用该端口的程序后重试。');
    console.error(`\n如果浏览器已打开，请直接访问: http://localhost:${PORT}`);
    try {
      const url = `http://localhost:${PORT}`;
      const cp = require('child_process');
      if (process.platform === 'win32') cp.exec(`cmd /c start "" "${url}"`);
    } catch(e) {}
  } else {
    console.error('启动失败:', err.message);
  }
});
