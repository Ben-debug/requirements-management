/**
 * 文件上传/下载路由
 * 流转文件、会议纪要文件的上传、下载、列表、删除
 */
const { getDatabase } = require('../database');
const config = require('../config');
const { encodeName, sendFileInline, sendFileMissing, handleFileOpen, uniqueFilePath } = require('../utils');
const { wrap } = require('../middleware/error-handler');
const path = require('path');
const fs = require('fs');
const { createUploadMiddleware, removeTempFile } = require('../middleware/upload');
const { getFlowFileDir, getMeetingFileDir, getUploadBaseDir } = require('../paths');

module.exports = function (app) {


  const uploadTemp = createUploadMiddleware(getUploadBaseDir());

  // ---- 文件列表（跨需求单，分页+筛选） ----
  app.get('/api/files', wrap((req, res) => {
      const db = getDatabase();
      const { page = 1, pageSize = 20, keyword, file_type, department, date_from, date_to, project_name } = req.query;

      // 基础筛选条件（不含类型，供列表与类型计数共用）
      const conds = ["f.deleted_at IS NULL"];
      const params = [];
      if (keyword) { const k = `%${keyword}%`; conds.push('(ro.order_number LIKE ? OR ro.name LIKE ? OR f.original_name LIKE ?)'); params.push(k, k, k); }
      if (department) {
        const names = config.expandNames('department', department);
        conds.push(`ro.department IN (${names.map(() => '?').join(',')})`);
        params.push(...names);
      }
      if (date_from) { conds.push('f.uploaded_at >= ?'); params.push(date_from); }
      if (date_to) { conds.push('f.uploaded_at <= ?'); params.push(date_to); }
      if (project_name) {
        const names = config.expandNames('project', project_name);
        conds.push(`EXISTS (SELECT 1 FROM ccb_schedules cs WHERE cs.order_id=ro.id AND cs.is_project=1 AND cs.project_name IN (${names.map(() => '?').join(',')}))`);
        params.push(...names);
      }
      const whereBase = conds.join(' AND ');

      // 各类型计数（tab 徽标，与当前非类型筛选保持一致）
      const typeCounts = {};
      db.prepare(`SELECT file_type, COUNT(*) AS c FROM flow_files f LEFT JOIN requirement_orders ro ON f.order_id=ro.id WHERE ${whereBase} GROUP BY file_type`)
        .all(...params)
        .forEach(r => { if (r.file_type) typeCounts[r.file_type] = r.c; });

      // 回收站计数（角标）
      const trashCount = db.prepare('SELECT COUNT(*) AS c FROM flow_files WHERE deleted_at IS NOT NULL').get().c;

      // 列表查询（在基础条件上叠加类型筛选）
      const listParams = [...params];
      let sql = `SELECT f.*, ro.order_number, ro.name AS order_name, ro.department
        FROM flow_files f LEFT JOIN requirement_orders ro ON f.order_id=ro.id
        WHERE ${whereBase}`;
      if (file_type) { sql += ' AND f.file_type=?'; listParams.push(file_type); }
      sql += ' ORDER BY f.uploaded_at DESC';

      const { paginate } = require('../utils');
      const result = paginate(sql, listParams, parseInt(page), parseInt(pageSize));
      const departments = db.prepare('SELECT DISTINCT department FROM requirement_orders WHERE department IS NOT NULL ORDER BY department').all().map(r => r.department);
      const usedProjects = db.prepare("SELECT DISTINCT project_name FROM ccb_schedules WHERE is_project=1 AND project_name IS NOT NULL AND project_name!='' ORDER BY project_name").all().map(r => r.project_name);
      const projects = [...new Set([...config.getCategory('project'), ...usedProjects])];
      res.json({ success: true, ...result, filters: { departments, projects }, typeCounts, trashCount });
  }));

  // ---- 上传流转文件 ----
  app.post('/api/orders/:orderId/files', uploadTemp.single('file'), wrap((req, res) => {
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
      const destPath = uniqueFilePath(flowDir, fixedName);
      try { fs.copyFileSync(req.file.path, destPath); } catch (e) {
        return res.status(500).json({ success: false, message: '文件保存失败' });
      }
      const fileBatch = req.body.sub_batch || '';
      db.prepare('INSERT INTO flow_files (order_id,file_type,original_name,stored_name,file_path,sub_batch) VALUES (?,?,?,?,?,?)')
        .run(req.params.orderId, file_type, fixedName, path.basename(destPath), destPath, fileBatch);
      res.json({ success: true, data: { file_name: path.basename(destPath) } });
    } finally { removeTempFile(req); }
  }));

  // ---- 订单文件列表 ----
  app.get('/api/orders/:orderId/files', wrap((req, res) => {
      const db = getDatabase();
      res.json({ success: true, data: db.prepare('SELECT * FROM flow_files WHERE order_id=? AND deleted_at IS NULL ORDER BY id').all(req.params.orderId) });
  }));

  // ---- 文件下载 ----
  app.get('/api/files/:id/download', wrap((req, res) => {
      const db = getDatabase();
      const f = db.prepare('SELECT * FROM flow_files WHERE id=?').get(req.params.id);
      if (!f) return res.status(404).json({ success: false });
      if (!fs.existsSync(f.file_path)) return sendFileMissing(res, f.original_name, f.file_path);
      res.download(f.file_path, f.original_name);
  }));

  // ---- 文件在线预览（浏览器内联打开）----
  app.get('/api/files/:id/preview', wrap((req, res) => {
      const db = getDatabase();
      const f = db.prepare('SELECT * FROM flow_files WHERE id=? AND deleted_at IS NULL').get(req.params.id);
      if (!f) return res.status(404).json({ success: false, message: '文件不存在' });
      if (!fs.existsSync(f.file_path)) return sendFileMissing(res, f.original_name, f.file_path);
      sendFileInline(res, f.file_path, f.original_name);
  }));

  // ---- 智能打开：本机开目录 / 远程下载 / 可预览内联 ----
  app.get('/api/files/:id/open', wrap((req, res) => {
      const db = getDatabase();
      const f = db.prepare('SELECT * FROM flow_files WHERE id=? AND deleted_at IS NULL').get(req.params.id);
      if (!f) return res.status(404).json({ success: false, message: '文件不存在' });
      handleFileOpen(req, res, f.file_path, f.original_name);
  }));

  // ---- 删除文件（移入回收站） ----
  app.delete('/api/files/:id', wrap((req, res) => {
      const db = getDatabase();
      const f = db.prepare('SELECT * FROM flow_files WHERE id=?').get(req.params.id);
      if (!f) return res.status(404).json({ success: false, message: '文件不存在' });
      if (f.deleted_at) return res.status(400).json({ success: false, message: '文件已在回收站中' });

      // 将文件移入回收站目录
      const trashDir = path.join(getUploadBaseDir(), 'trash');
      if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });

      const timestamp = Date.now();
      const ext = path.extname(f.file_path);
      const base = path.basename(f.file_path, ext);
      const trashName = `${base}_${timestamp}${ext}`;
      const trashPath = path.join(trashDir, trashName);

      if (fs.existsSync(f.file_path)) {
        fs.renameSync(f.file_path, trashPath);
      }

      db.prepare("UPDATE flow_files SET deleted_at=datetime('now','localtime'), file_path=? WHERE id=?")
        .run(trashPath, req.params.id);
      res.json({ success: true, message: '已移入回收站' });
  }));

  // ---- 回收站：列出已删除文件 ----
  app.get('/api/files/trash', wrap((req, res) => {
      const db = getDatabase();
      const { page = 1, pageSize = 20 } = req.query;
      const { paginate } = require('../utils');
      const sql = `SELECT f.*, ro.order_number, ro.name AS order_name, ro.department
        FROM flow_files f LEFT JOIN requirement_orders ro ON f.order_id=ro.id
        WHERE f.deleted_at IS NOT NULL ORDER BY f.deleted_at DESC`;
      const result = paginate(sql, [], parseInt(page), parseInt(pageSize));
      res.json({ success: true, ...result });
  }));

  // ---- 从回收站恢复文件 ----
  app.post('/api/files/:id/restore', wrap((req, res) => {
      const db = getDatabase();
      const f = db.prepare('SELECT * FROM flow_files WHERE id=?').get(req.params.id);
      if (!f) return res.status(404).json({ success: false, message: '文件不存在' });
      if (!f.deleted_at) return res.status(400).json({ success: false, message: '文件不在回收站中' });

      // 从回收站路径恢复到原目录
      const flowDir = getFlowFileDir();
      if (!fs.existsSync(flowDir)) fs.mkdirSync(flowDir, { recursive: true });

      // 初始候选为回收站中的文件名；冲突时改用原始 stored_name 加序号，保持既有恢复语义
      const restoredPath = uniqueFilePath(flowDir, path.basename(f.file_path), f.stored_name || path.basename(f.file_path));

      if (fs.existsSync(f.file_path)) {
        fs.renameSync(f.file_path, restoredPath);
      }

      db.prepare('UPDATE flow_files SET deleted_at=NULL, file_path=? WHERE id=?')
        .run(restoredPath, req.params.id);
      res.json({ success: true, message: '文件已恢复' });
  }));

  // ---- 彻底删除文件（从回收站永久删除） ----
  app.delete('/api/files/:id/permanent', wrap((req, res) => {
      const db = getDatabase();
      const f = db.prepare('SELECT * FROM flow_files WHERE id=?').get(req.params.id);
      if (!f) return res.status(404).json({ success: false, message: '文件不存在' });
      if (!f.deleted_at) return res.status(400).json({ success: false, message: '只能彻底删除回收站中的文件，请先移入回收站' });

      if (fs.existsSync(f.file_path)) fs.unlinkSync(f.file_path);
      db.prepare('DELETE FROM flow_files WHERE id=?').run(req.params.id);
      res.json({ success: true, message: '文件已永久删除' });
  }));

  // ---- 清空回收站 ----
  app.post('/api/files/trash/clear', wrap((req, res) => {
      const db = getDatabase();
      const trashedFiles = db.prepare('SELECT * FROM flow_files WHERE deleted_at IS NOT NULL').all();
      let count = 0;
      db.transaction(() => {
        for (const f of trashedFiles) {
          if (fs.existsSync(f.file_path)) { fs.unlinkSync(f.file_path); count++; }
          db.prepare('DELETE FROM flow_files WHERE id=?').run(f.id);
        }
      })();
      res.json({ success: true, message: `回收站已清空，删除 ${count} 个文件` });
  }));

  // ---- 上传会议纪要文件 ----
  app.post('/api/meetings/:id/file', uploadTemp.single('file'), wrap((req, res) => {
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
      const destPath = uniqueFilePath(meetingDir, name);
      try { fs.copyFileSync(req.file.path, destPath); } catch (e) {
        return res.status(500).json({ success: false, message: '文件保存失败' });
      }
      db.prepare('UPDATE ccb_meetings SET file_name=?, file_path=? WHERE id=?').run(path.basename(destPath), destPath, req.params.id);
      res.json({ success: true, data: { file_name: path.basename(destPath) } });
    } finally { removeTempFile(req); }
  }));

  // ---- 会议纪要文件下载 ----
  app.get('/api/meetings/:id/file/download', wrap((req, res) => {
      const db = getDatabase();
      const m = db.prepare('SELECT * FROM ccb_meetings WHERE id=?').get(req.params.id);
      if (!m || !m.file_path) return res.status(404).json({ success: false, message: '文件不存在' });
      if (!fs.existsSync(m.file_path)) return sendFileMissing(res, m.file_name, m.file_path);
      res.download(m.file_path, m.file_name);
  }));

  // ---- 会议纪要在线预览 ----
  app.get('/api/meetings/:id/file/preview', wrap((req, res) => {
      const db = getDatabase();
      const m = db.prepare('SELECT * FROM ccb_meetings WHERE id=?').get(req.params.id);
      if (!m || !m.file_path) return res.status(404).json({ success: false, message: '文件不存在' });
      if (!fs.existsSync(m.file_path)) return sendFileMissing(res, m.file_name, m.file_path);
      sendFileInline(res, m.file_path, m.file_name);
  }));

  // ---- 会议纪要智能打开 ----
  app.get('/api/meetings/:id/file/open', wrap((req, res) => {
      const db = getDatabase();
      const m = db.prepare('SELECT * FROM ccb_meetings WHERE id=?').get(req.params.id);
      if (!m || !m.file_path) return res.status(404).json({ success: false, message: '文件不存在' });
      handleFileOpen(req, res, m.file_path, m.file_name);
  }));

};
