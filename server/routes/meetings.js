/**
 * CCB 会议路由
 * 会议 CRUD、详情、纪要文件扫描、文件上传/下载
 */
const { getDatabase } = require('../database');
const path = require('path');
const fs = require('fs');
const { walkDir, paginate } = require('../utils');
const { wrap } = require('../middleware/error-handler');
const { getMeetingFileDir } = require('../paths');

module.exports = function (app) {


  // ---- 会议列表（支持筛选 + 分页；不传分页参数时仍返回全量，兼容各页面下拉）----
  app.get('/api/meetings', wrap((req, res) => {
      const db = getDatabase();
      const { keyword, ccb_only, date_from, date_to, page, pageSize, include_fallback } = req.query;
      const where = [], params = [];
      // 兜底会议默认不在管理列表展示；下拉/筛选显式传 include_fallback=1 才包含
      if (include_fallback !== '1' && include_fallback !== 'true') where.push('COALESCE(is_fallback,0)=0');
      if (keyword) {
        where.push('(meeting_name LIKE ? OR notes LIKE ?)');
        const k = `%${keyword}%`; params.push(k, k);
      }
      if (ccb_only === '1' || ccb_only === 'true') where.push("UPPER(meeting_name) LIKE '%CCB%'");
      if (date_from) { where.push('meeting_date >= ?'); params.push(date_from); }
      if (date_to) { where.push('meeting_date <= ?'); params.push(date_to); }
      const baseSql = 'SELECT * FROM ccb_meetings'
        + (where.length ? ' WHERE ' + where.join(' AND ') : '')
        + ' ORDER BY meeting_date DESC, id DESC';
      const zero = { points: 0, orders: 0, departments: 0, systems: 0, versions: 0, projects: 0 };
      // 一次聚合查询取得当前页会议的排期概要，避免逐会议查询
      const withSummary = rows => {
        if (!rows.length) return rows;
        const ph = rows.map(() => '?').join(',');
        const summaryRows = db.prepare(`SELECT cs.meeting_id,
            COUNT(*) AS points,
            COUNT(DISTINCT cs.order_id) AS orders,
            COUNT(DISTINCT ro.department) AS departments,
            COUNT(DISTINCT cs.system) AS systems,
            COUNT(DISTINCT cs.version) AS versions,
            SUM(COALESCE(cs.is_project, 0)) AS projects
          FROM ccb_schedules cs
          JOIN requirement_orders ro ON ro.id = cs.order_id
          WHERE cs.meeting_id IN (${ph})
          GROUP BY cs.meeting_id`).all(...rows.map(r => r.id));
        const summaryMap = {};
        summaryRows.forEach(r => { summaryMap[r.meeting_id] = r; });
        return rows.map(m => ({ ...m, schedule_summary: summaryMap[m.id] || zero }));
      };

      if (page === undefined && pageSize === undefined) {
        return res.json({ success: true, data: withSummary(db.prepare(baseSql).all(...params)) });
      }
      const p = paginate(baseSql, params, parseInt(page) || 1, parseInt(pageSize) || 10);
      res.json({ success: true, data: withSummary(p.items),
        total: p.total, page: p.page, pageSize: p.pageSize, totalPages: p.totalPages });
  }));

  // ---- 会议详情（含排期） ----
  app.get('/api/meetings/:id', wrap((req, res) => {
      const db = getDatabase();
      const m = db.prepare('SELECT * FROM ccb_meetings WHERE id=?').get(req.params.id);
      if (!m) return res.status(404).json({ success: false });
      const s = db.prepare(`SELECT cs.*, ro.order_number, ro.name as order_name, rp.point_number, rp.sub_batch, rp.description as point_description FROM ccb_schedules cs JOIN requirement_orders ro ON cs.order_id=ro.id JOIN requirement_points rp ON cs.point_id=rp.id WHERE cs.meeting_id=? ORDER BY SUBSTR(ro.order_number, 1, 1), CAST(SUBSTR(ro.order_number, 2) AS INTEGER), rp.point_number`).all(req.params.id);
      res.json({ success: true, data: { ...m, schedules: s } });
  }));

  // ---- 创建会议 ----
  app.post('/api/meetings', wrap((req, res) => {
      const db = getDatabase();
      if (String(req.body.meeting_name || '').trim() === '-') {
        return res.status(400).json({ success: false, message: '“-”为系统兜底会议，不能新建' });
      }
      const r = db.prepare('INSERT INTO ccb_meetings (meeting_name,meeting_date,notes) VALUES (?,?,?)').run(req.body.meeting_name, req.body.meeting_date, req.body.notes);
      res.json({ success: true, data: { id: r.lastInsertRowid } });
  }));

  // ---- 更新会议 ----
  app.put('/api/meetings/:id', wrap((req, res) => {
      const db = getDatabase();
      const m = db.prepare('SELECT is_fallback FROM ccb_meetings WHERE id=?').get(req.params.id);
      if (!m) return res.status(404).json({ success: false });
      if (m.is_fallback) return res.status(400).json({ success: false, message: '兜底会议不能修改' });
      if (String(req.body.meeting_name || '').trim() === '-') {
        return res.status(400).json({ success: false, message: '“-”为系统兜底会议，不能作为会议名' });
      }
      db.prepare('UPDATE ccb_meetings SET meeting_name=?, meeting_date=?, notes=? WHERE id=?').run(req.body.meeting_name, req.body.meeting_date, req.body.notes, req.params.id);
      res.json({ success: true });
  }));

  // ---- 删除会议 ----
  app.delete('/api/meetings/:id', wrap((req, res) => {
      const db = getDatabase();
      const m = db.prepare('SELECT is_fallback FROM ccb_meetings WHERE id=?').get(req.params.id);
      if (!m) return res.status(404).json({ success: false });
      // 兜底会议被删除会级联清掉所有无会议排期
      if (m.is_fallback) return res.status(400).json({ success: false, message: '兜底会议不能删除' });
      db.prepare('DELETE FROM ccb_meetings WHERE id=?').run(req.params.id);
      res.json({ success: true });
  }));

  // ---- 扫描会议纪要目录 ----
  app.get('/api/meetings/:id/scan-files', wrap((req, res) => {
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
  }));

};
