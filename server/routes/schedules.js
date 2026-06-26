/**
 * 排期路由
 * 单条/批量排期、排期修改/移除、待排期列表、排期筛选
 */
const { getDatabase } = require('../database');
const config = require('../config');

module.exports = function (app) {

  // ---- 批量排期 ----
  app.post('/api/meetings/:meetingId/schedules/batch', (req, res) => {
    try {
      const db = getDatabase();
      const { schedules } = req.body;
      if (!schedules || !schedules.length) return res.status(400).json({ success: false, message: '请选择排期' });
      const ins = db.prepare('INSERT INTO ccb_schedules (meeting_id,order_id,point_id,system,version,is_project) VALUES (?,?,?,?,?,?)');
      const upd = db.prepare('UPDATE requirement_points SET system=?, version=? WHERE id=?');
      const updBatch = db.prepare('UPDATE requirement_points SET sub_batch=? WHERE id=?');
      db.transaction(() => {
        schedules.forEach(s => {
          ins.run(req.params.meetingId, s.order_id, s.point_id, s.system, s.version, s.is_project || 0);
          upd.run(s.system, s.version, s.point_id);
          if (s.sub_batch) updBatch.run(s.sub_batch, s.point_id);
        });
      })();
      res.json({ success: true, data: { count: schedules.length } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 单条排期 ----
  app.post('/api/meetings/:meetingId/schedules', (req, res) => {
    try {
      const db = getDatabase();
      const { order_id, point_id, system, version, is_project } = req.body;
      db.prepare('INSERT INTO ccb_schedules (meeting_id,order_id,point_id,system,version,is_project) VALUES (?,?,?,?,?,?)').run(req.params.meetingId, order_id, point_id, system, version, is_project || 0);
      db.prepare('UPDATE requirement_points SET system=?, version=? WHERE id=?').run(system, version, point_id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 修改排期 ----
  app.put('/api/schedules/:id', (req, res) => {
    try {
      const db = getDatabase();
      const { system, version, meeting_id, is_project } = req.body;
      const schedule = db.prepare('SELECT * FROM ccb_schedules WHERE id=?').get(req.params.id);
      if (!schedule) return res.status(404).json({ success: false });
      const pi = is_project !== undefined ? (is_project || 0) : schedule.is_project;
      if (meeting_id && meeting_id != schedule.meeting_id) {
        db.prepare('UPDATE ccb_schedules SET meeting_id=?, system=?, version=?, is_project=? WHERE id=?').run(meeting_id, system, version, pi, req.params.id);
      } else {
        db.prepare('UPDATE ccb_schedules SET system=?, version=?, is_project=? WHERE id=?').run(system, version, pi, req.params.id);
      }
      db.prepare('UPDATE requirement_points SET system=?, version=? WHERE id=?').run(system, version, schedule.point_id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 移除排期 ----
  app.delete('/api/schedules/:id', (req, res) => {
    try {
      const db = getDatabase();
      const s = db.prepare('SELECT * FROM ccb_schedules WHERE id=?').get(req.params.id);
      if (s) db.prepare('UPDATE requirement_points SET system=NULL, version=NULL WHERE id=?').run(s.point_id);
      db.prepare('DELETE FROM ccb_schedules WHERE id=?').run(req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 待排期需求点 ----
  app.get('/api/unscheduled-points', (req, res) => {
    try {
      const db = getDatabase();
      res.json({
        success: true,
        data: db.prepare(`SELECT rp.*, ro.order_number, ro.name as order_name FROM requirement_points rp JOIN requirement_orders ro ON rp.order_id=ro.id WHERE rp.id NOT IN (SELECT point_id FROM ccb_schedules) ORDER BY SUBSTR(ro.order_number, 1, 1), CAST(SUBSTR(ro.order_number, 2) AS INTEGER), rp.point_number`).all()
      });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 排期筛选查询 ----
  app.get('/api/schedules/filter', (req, res) => {
    try {
      const db = getDatabase();
      const { version, department, meeting_name, system, group_by, page = 1, pageSize = 20 } = req.query;

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
          else if (group_by === 'system') key = s.system ? s.system.split(',').map(x => x.trim()).filter(Boolean)[0] || '未指定' : '未指定';
          else key = '其他';
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(s);
        });
      }

      res.json({
        success: true, data: schedules, total, page: p, pageSize: ps,
        totalPages: Math.ceil(total / ps), grouped,
        filters: { versions: allVersions, departments: allDepartments, meetings: allMeetings.map(m => m.meeting_name), systems: allSystems }
      });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

};
