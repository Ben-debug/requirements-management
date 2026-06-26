/**
 * CCB 会议路由
 * 会议 CRUD、详情、纪要文件扫描、文件上传/下载
 */
const { getDatabase } = require('../database');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { walkDir } = require('../utils');

module.exports = function (app) {

  const ROOT_DIR = path.join(__dirname, '..', '..');
  const DATA_DIR = process.pkg ? path.dirname(process.execPath) : ROOT_DIR;

  function getMeetingFileDir() {
    const custom = config.getPath('meeting_files_dir');
    return custom || path.join(DATA_DIR, 'public', 'uploads', 'meeting_files');
  }

  // ---- 会议列表 ----
  app.get('/api/meetings', (req, res) => {
    try {
      const db = getDatabase();
      res.json({ success: true, data: db.prepare('SELECT * FROM ccb_meetings ORDER BY meeting_date DESC').all() });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 会议详情（含排期） ----
  app.get('/api/meetings/:id', (req, res) => {
    try {
      const db = getDatabase();
      const m = db.prepare('SELECT * FROM ccb_meetings WHERE id=?').get(req.params.id);
      if (!m) return res.status(404).json({ success: false });
      const s = db.prepare(`SELECT cs.*, ro.order_number, ro.name as order_name, rp.point_number, rp.sub_batch, rp.description as point_description FROM ccb_schedules cs JOIN requirement_orders ro ON cs.order_id=ro.id JOIN requirement_points rp ON cs.point_id=rp.id WHERE cs.meeting_id=? ORDER BY SUBSTR(ro.order_number, 1, 1), CAST(SUBSTR(ro.order_number, 2) AS INTEGER), rp.point_number`).all(req.params.id);
      res.json({ success: true, data: { ...m, schedules: s } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 创建会议 ----
  app.post('/api/meetings', (req, res) => {
    try {
      const db = getDatabase();
      const r = db.prepare('INSERT INTO ccb_meetings (meeting_name,meeting_date,notes) VALUES (?,?,?)').run(req.body.meeting_name, req.body.meeting_date, req.body.notes);
      res.json({ success: true, data: { id: r.lastInsertRowid } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 更新会议 ----
  app.put('/api/meetings/:id', (req, res) => {
    try {
      const db = getDatabase();
      db.prepare('UPDATE ccb_meetings SET meeting_name=?, meeting_date=?, notes=? WHERE id=?').run(req.body.meeting_name, req.body.meeting_date, req.body.notes, req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 删除会议 ----
  app.delete('/api/meetings/:id', (req, res) => {
    try {
      const db = getDatabase();
      db.prepare('DELETE FROM ccb_meetings WHERE id=?').run(req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 扫描会议纪要目录 ----
  app.get('/api/meetings/:id/scan-files', (req, res) => {
    try {
      const db = getDatabase();
      const meetingId = parseInt(req.params.id);
      const meeting = db.prepare('SELECT id, meeting_name, file_name, file_path FROM ccb_meetings WHERE id=?').get(meetingId);
      if (!meeting) return res.status(404).json({ success: false, message: '会议不存在' });
      const meetingDir = getMeetingFileDir();
      if (!fs.existsSync(meetingDir)) return res.json({ success: true, data: [], count: 0 });
      const files = fs.readdirSync(meetingDir).filter(f => fs.statSync(path.join(meetingDir, f)).isFile());
      const discovered = [];
      for (const file of files) {
        const filePath = path.resolve(path.join(meetingDir, file));
        if (meeting.file_path && path.resolve(meeting.file_path) === filePath) continue;
        if (file.includes('【会议纪要】') && file.includes(meeting.meeting_name)) {
          discovered.push({ file_name: file, file_path: filePath });
        }
      }
      let linked = null;
      if (discovered.length && !meeting.file_name) {
        const best = discovered[0];
        db.prepare('UPDATE ccb_meetings SET file_name=?, file_path=? WHERE id=?').run(best.file_name, best.file_path, meetingId);
        linked = best;
      }
      res.json({ success: true, data: discovered, linked, count: discovered.length });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

};
