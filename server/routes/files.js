/**
 * 文件上传/下载路由
 * 流转文件、会议纪要文件的上传、下载、列表、删除
 */
const { getDatabase } = require('../database');
const config = require('../config');
const { encodeName } = require('../utils');
const path = require('path');
const fs = require('fs');
const { createUploadMiddleware } = require('../middleware/upload');

module.exports = function (app) {

  const ROOT_DIR = path.join(__dirname, '..', '..');
  const DATA_DIR = process.pkg ? path.dirname(process.execPath) : ROOT_DIR;

  // ---- 文件存储目录辅助 ----
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

  const uploadTemp = createUploadMiddleware(getUploadBaseDir());

  // ---- 文件列表（跨需求单，分页+筛选） ----
  app.get('/api/files', (req, res) => {
    try {
      const db = getDatabase();
      const { page = 1, pageSize = 20, keyword, file_type, department, date_from, date_to } = req.query;
      let sql = `SELECT f.*, ro.order_number, ro.name AS order_name, ro.department
        FROM flow_files f LEFT JOIN requirement_orders ro ON f.order_id=ro.id
        WHERE 1=1`;
      const params = [];
      if (keyword) { const k = `%${keyword}%`; sql += ' AND (ro.order_number LIKE ? OR ro.name LIKE ? OR f.original_name LIKE ?)'; params.push(k, k, k); }
      if (file_type) { sql += ' AND f.file_type=?'; params.push(file_type); }
      if (department) { sql += ' AND ro.department=?'; params.push(department); }
      if (date_from) { sql += ' AND f.uploaded_at >= ?'; params.push(date_from); }
      if (date_to) { sql += ' AND f.uploaded_at <= ?'; params.push(date_to); }
      sql += ' ORDER BY f.uploaded_at DESC';

      const { paginate } = require('../utils');
      const result = paginate(sql, params, parseInt(page), parseInt(pageSize));
      const departments = db.prepare('SELECT DISTINCT department FROM requirement_orders WHERE department IS NOT NULL ORDER BY department').all().map(r => r.department);
      res.json({ success: true, ...result, filters: { departments } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 上传流转文件 ----
  app.post('/api/orders/:orderId/files', uploadTemp.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: '请选择文件' });
    try {
      const db = getDatabase();
      const { file_type } = req.body;
      if (!file_type) return res.status(400).json({ success: false, message: '请选择文件类型' });
      const name = encodeName(req.file.originalname);
      const order = db.prepare('SELECT order_number, name FROM requirement_orders WHERE id=?').get(req.params.orderId);
      if (!order) return res.status(404).json({ success: false, message: '需求单不存在' });

      let fixedName = name;
      if (!fixedName.startsWith(`【${file_type}】`)) {
        fixedName = `【${file_type}】${order.order_number}-${order.name}${path.extname(name)}`;
      }
      const flowDir = getFlowFileDir();
      if (!fs.existsSync(flowDir)) fs.mkdirSync(flowDir, { recursive: true });
      const storedName = fixedName;
      let destPath = path.join(flowDir, storedName);
      let counter = 1;
      while (fs.existsSync(destPath)) {
        const ext = path.extname(storedName);
        const base = path.basename(storedName, ext);
        destPath = path.join(flowDir, `${base}(${counter++})${ext}`);
      }
      try { fs.copyFileSync(req.file.path, destPath); fs.unlinkSync(req.file.path); } catch (e) {
        return res.status(500).json({ success: false, message: '文件保存失败' });
      }
      const fileBatch = req.body.sub_batch || '';
      db.prepare('INSERT INTO flow_files (order_id,file_type,original_name,stored_name,file_path,sub_batch) VALUES (?,?,?,?,?,?)')
        .run(req.params.orderId, file_type, fixedName, path.basename(destPath), destPath, fileBatch);
      res.json({ success: true, data: { file_name: path.basename(destPath) } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 订单文件列表 ----
  app.get('/api/orders/:orderId/files', (req, res) => {
    try {
      const db = getDatabase();
      res.json({ success: true, data: db.prepare('SELECT * FROM flow_files WHERE order_id=? ORDER BY id').all(req.params.orderId) });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 文件下载 ----
  app.get('/api/files/:id/download', (req, res) => {
    try {
      const db = getDatabase();
      const f = db.prepare('SELECT * FROM flow_files WHERE id=?').get(req.params.id);
      if (!f) return res.status(404).json({ success: false });
      if (!fs.existsSync(f.file_path)) return res.status(404).json({ success: false, message: '文件已不存在' });
      res.download(f.file_path, f.original_name);
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 删除文件 ----
  app.delete('/api/files/:id', (req, res) => {
    try {
      const db = getDatabase();
      const f = db.prepare('SELECT * FROM flow_files WHERE id=?').get(req.params.id);
      if (f && fs.existsSync(f.file_path)) fs.unlinkSync(f.file_path);
      db.prepare('DELETE FROM flow_files WHERE id=?').run(req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 上传会议纪要文件 ----
  app.post('/api/meetings/:id/file', uploadTemp.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false });
    try {
      const db = getDatabase();
      const meeting = db.prepare('SELECT meeting_name FROM ccb_meetings WHERE id=?').get(req.params.id);
      if (!meeting) return res.status(404).json({ success: false, message: '会议不存在' });
      let name = encodeName(req.file.originalname);
      if (!name.startsWith('【会议纪要】')) {
        name = `【会议纪要】${meeting.meeting_name}${path.extname(name)}`;
      }
      const meetingDir = getMeetingFileDir();
      if (!fs.existsSync(meetingDir)) fs.mkdirSync(meetingDir, { recursive: true });
      const storedName = name;
      let destPath = path.join(meetingDir, storedName);
      let counter = 1;
      while (fs.existsSync(destPath)) {
        const ext = path.extname(storedName);
        const base = path.basename(storedName, ext);
        destPath = path.join(meetingDir, `${base}(${counter++})${ext}`);
      }
      try { fs.copyFileSync(req.file.path, destPath); fs.unlinkSync(req.file.path); } catch (e) {
        return res.status(500).json({ success: false, message: '文件保存失败' });
      }
      db.prepare('UPDATE ccb_meetings SET file_name=?, file_path=? WHERE id=?').run(path.basename(destPath), destPath, req.params.id);
      res.json({ success: true, data: { file_name: path.basename(destPath) } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 会议纪要文件下载 ----
  app.get('/api/meetings/:id/file/download', (req, res) => {
    try {
      const db = getDatabase();
      const m = db.prepare('SELECT * FROM ccb_meetings WHERE id=?').get(req.params.id);
      if (!m || !m.file_path) return res.status(404).json({ success: false, message: '文件不存在' });
      if (!fs.existsSync(m.file_path)) return res.status(404).json({ success: false, message: '文件已不存在' });
      res.download(m.file_path, m.file_name);
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

};
