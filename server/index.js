const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const { getDatabase } = require('./database');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
const ROOT_DIR = path.dirname(process.pkg ? process.execPath : __dirname);
app.use(express.static(path.join(ROOT_DIR, 'public')));

const uploadDir = path.join(path.dirname(process.pkg ? process.execPath : __dirname), 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now()+'-'+Math.round(Math.random()*1E9)+'-'+file.originalname)
});
const upload = multer({ storage });

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
    const { page=1, pageSize=10 } = req.query;
    const result = paginate('SELECT * FROM requirement_orders ORDER BY created_at DESC', [], parseInt(page), parseInt(pageSize));
    res.json({ success: true, ...result });
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
    const { order_number, name, department, proposer, propose_date, business_launch_date } = req.body;
    if (db.prepare('SELECT id FROM requirement_orders WHERE order_number=?').get(order_number)) return res.status(400).json({ success: false, message: '编号已存在' });
    const r = db.prepare('INSERT INTO requirement_orders (order_number,name,department,proposer,propose_date,business_launch_date) VALUES (?,?,?,?,?,?)').run(order_number, name, department, proposer, propose_date, business_launch_date);
    res.json({ success: true, data: { id: r.lastInsertRowid } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.put('/api/orders/:id', (req, res) => {
  try {
    const db = getDatabase();
    const { name, department, proposer, propose_date, business_launch_date } = req.body;
    db.prepare("UPDATE requirement_orders SET name=?,department=?,proposer=?,propose_date=?,business_launch_date=?,updated_at=datetime('now','localtime') WHERE id=?").run(name, department, proposer, propose_date, business_launch_date, req.params.id);
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
    const db = getDatabase(); const { description } = req.body;
    const order = db.prepare('SELECT order_number FROM requirement_orders WHERE id=?').get(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: '需求单不存在' });
    const max = db.prepare('SELECT point_number FROM requirement_points WHERE order_id=? ORDER BY id DESC LIMIT 1').get(req.params.orderId);
    let seq = 1;
    if (max) { const parts = max.point_number.split('-'); seq = parseInt(parts[1]) + 1; }
    const pointNumber = `${order.order_number}-${String(seq).padStart(2,'0')}`;
    const r = db.prepare('INSERT INTO requirement_points (order_id,point_number,description) VALUES (?,?,?)').run(req.params.orderId, pointNumber, description);
    res.json({ success: true, data: { id: r.lastInsertRowid, point_number: pointNumber } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.put('/api/points/:id', (req, res) => {
  try { const db = getDatabase(); const { description } = req.body; db.prepare("UPDATE requirement_points SET description=?,updated_at=datetime('now','localtime') WHERE id=?").run(description, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/points/:id', (req, res) => {
  try { const db = getDatabase(); db.prepare('DELETE FROM requirement_points WHERE id=?').run(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ---- 文件 ----
app.post('/api/orders/:orderId/files', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: '请选择文件' });
  try { const db = getDatabase(); const { file_type } = req.body; db.prepare('INSERT INTO flow_files (order_id,file_type,original_name,stored_name,file_path) VALUES (?,?,?,?,?)').run(req.params.orderId, file_type, req.file.originalname, req.file.filename, req.file.path); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/orders/:orderId/files', (req, res) => {
  try { const db = getDatabase(); res.json({ success: true, data: db.prepare('SELECT * FROM flow_files WHERE order_id=? ORDER BY id').all(req.params.orderId) }); }
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
  try { const db = getDatabase(); const m = db.prepare('SELECT * FROM ccb_meetings WHERE id=?').get(req.params.id); if (!m) return res.status(404).json({ success: false }); const s = db.prepare(`SELECT cs.*, ro.order_number, ro.name as order_name, rp.point_number, rp.description as point_description FROM ccb_schedules cs JOIN requirement_orders ro ON cs.order_id=ro.id JOIN requirement_points rp ON cs.point_id=rp.id WHERE cs.meeting_id=? ORDER BY ro.order_number, rp.point_number`).all(req.params.id); res.json({ success: true, data: { ...m, schedules: s } }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/meetings', (req, res) => {
  try { const db = getDatabase(); const r = db.prepare('INSERT INTO ccb_meetings (meeting_name,meeting_date,notes) VALUES (?,?,?)').run(req.body.meeting_name, req.body.meeting_date, req.body.notes); res.json({ success: true, data: { id: r.lastInsertRowid } }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/meetings/:id/file', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false });
  try { const db = getDatabase(); db.prepare('UPDATE ccb_meetings SET file_name=?, file_path=? WHERE id=?').run(req.file.originalname, req.file.path, req.params.id); res.json({ success: true }); }
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
    
    let sql = `SELECT cs.*, ro.order_number, ro.name as order_name, ro.department, rp.point_number, rp.description as point_description, cm.meeting_name, cm.meeting_date FROM ccb_schedules cs JOIN requirement_orders ro ON cs.order_id=ro.id JOIN requirement_points rp ON cs.point_id=rp.id JOIN ccb_meetings cm ON cs.meeting_id=cm.id WHERE 1=1`;
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
    
    const allVersions = db.prepare("SELECT label FROM config_params WHERE category='version' ORDER BY sort_order").all();
    const allDepartments = db.prepare("SELECT label FROM config_params WHERE category='department' ORDER BY sort_order").all();
    const allSystems = db.prepare("SELECT label FROM config_params WHERE category='system' ORDER BY sort_order").all();
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
    
    res.json({ success: true, data: schedules, total, page: p, pageSize: ps, totalPages: Math.ceil(total/ps), grouped, filters: { versions: allVersions.map(v=>v.label), departments: allDepartments.map(d=>d.label), meetings: allMeetings.map(m=>m.meeting_name), systems: allSystems.map(s=>s.label) } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ---- Excel导出（含排期信息） ----
app.get('/api/export', (req, res) => {
  try {
    const db = getDatabase();
    const orders = db.prepare(`SELECT ro.* FROM requirement_orders ro ORDER BY ro.order_number`).all();
    
    const wb = xlsx.utils.book_new();
    const rows = [];
    
    for (const o of orders) {
      const points = db.prepare('SELECT * FROM requirement_points WHERE order_id=? ORDER BY point_number').all(o.id);
      if (points.length === 0) {
        rows.push({'需求单编号':o.order_number,'需求单名称':o.name,'业务部门':o.department||'','提出人':o.proposer||'','提出日期':o.propose_date||'','业务上线预期':o.business_launch_date||'','需求点编号':'','需求点描述':'','涉及系统':'','上线版本':'','CCB会议':'','排期日期':''});
      } else {
        for (const p of points) {
          const sche = db.prepare(`SELECT cs.*, cm.meeting_name, cm.meeting_date FROM ccb_schedules cs JOIN ccb_meetings cm ON cs.meeting_id=cm.id WHERE cs.point_id=?`).get(p.id);
          rows.push({
            '需求单编号':o.order_number,
            '需求单名称':o.name,
            '业务部门':o.department||'',
            '提出人':o.proposer||'',
            '提出日期':o.propose_date||'',
            '业务上线预期':o.business_launch_date||'',
            '需求点编号':p.point_number,
            '需求点描述':p.description,
            '涉及系统':sche ? sche.system : (p.system||''),
            '上线版本':sche ? sche.version : (p.version||''),
            'CCB会议':sche ? sche.meeting_name : '',
            '排期日期':sche ? sche.meeting_date : ''
          });
        }
      }
    }
    
    const ws = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(wb, ws, '需求单信息');
    const fp = path.join(uploadDir, 'export_'+Date.now()+'.xlsx');
    xlsx.writeFile(wb, fp);
    res.download(fp, '需求单信息导出.xlsx', err => { if (err) console.error(err); setTimeout(()=>{try{fs.unlinkSync(fp)}catch(e){}}, 5000); });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '请选择文件' });
    const wb = xlsx.readFile(req.file.path); const ws = wb.Sheets[wb.SheetNames[0]]; const data = xlsx.utils.sheet_to_json(ws);
    const db = getDatabase(); let imported=0, skipped=0;
    const insO = db.prepare('INSERT OR IGNORE INTO requirement_orders (order_number,name,department,proposer,propose_date,business_launch_date) VALUES (?,?,?,?,?,?)');
    const insP = db.prepare('INSERT INTO requirement_points (order_id,point_number,description,system,version) VALUES (?,?,?,?,?)');
    db.transaction(() => {
      for (const row of data) {
        const on = row['需求单编号']; if (!on) { skipped++; continue; }
        if (!/^[A-Z]\d{2}$/.test(String(on))) { skipped++; continue; }
        const r = insO.run(on, row['需求单名称']||'', row['业务部门']||'', row['提出人']||'', row['提出日期']||'', row['业务上线预期']||'');
        if (r.changes > 0) imported++; else skipped++;
        const o = db.prepare('SELECT id FROM requirement_orders WHERE order_number=?').get(on);
        if (o && row['需求点描述']) {
          const descs = String(row['需求点描述']).split(' | '); const sys = String(row['涉及系统']||'').split(' | '); const vers = String(row['上线版本']||'').split(' | ');
          descs.forEach((d, i) => { if (d.trim()) insP.run(o.id, `${on}-${String(i+1).padStart(2,'0')}`, d.trim(), sys[i]||'', vers[i]||''); });
        }
      }
    })();
    try { fs.unlinkSync(req.file.path); } catch(e){}
    res.json({ success: true, data: { imported, skipped } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ---- 参数配置 ----
app.get('/api/config/:category', (req, res) => {
  try { const db = getDatabase(); const items = db.prepare('SELECT id, label FROM config_params WHERE category=? ORDER BY sort_order, id').all(req.params.category); res.json({ success: true, data: items.map(i=>i.label) }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/config', (req, res) => {
  try { const db = getDatabase(); const all = db.prepare('SELECT * FROM config_params ORDER BY category, sort_order, id').all(); const g = {}; all.forEach(i => { if(!g[i.category]) g[i.category]=[]; g[i.category].push({id:i.id,label:i.label}); }); res.json({ success: true, data: g }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/config', (req, res) => {
  try { const db = getDatabase(); const {category, label} = req.body; if (!category||!label) return res.status(400).json({ success: false, message: '不能为空' }); const max = db.prepare('SELECT MAX(sort_order) as max FROM config_params WHERE category=?').get(category); db.prepare('INSERT OR IGNORE INTO config_params (category,label,sort_order) VALUES (?,?,?)').run(category, label, (max?.max??0)+1); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/config/:id', (req, res) => {
  try { const db = getDatabase(); db.prepare('DELETE FROM config_params WHERE id=?').run(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ---- 升级日志 ----
app.get('/api/upgrade-logs', (req, res) => {
  try { const db = getDatabase(); res.json({ success: true, data: db.prepare('SELECT * FROM upgrade_logs ORDER BY created_at DESC').all() }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.listen(PORT, () => console.log(`需求单信息管理系统已启动: http://localhost:${PORT}`));