/**
 * Excel 导入导出路由
 * 导出（全部/筛选）、导入模板下载、Excel 导入
 */
const { getDatabase } = require('../database');
const { normalizeDate } = require('../utils');
const { createUploadMiddleware } = require('../middleware/upload');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

module.exports = function (app) {

  const ROOT_DIR = path.join(__dirname, '..', '..');
  const DATA_DIR = process.pkg ? path.dirname(process.execPath) : ROOT_DIR;

  function getUploadBaseDir() {
    return path.join(DATA_DIR, 'public', 'uploads');
  }

  const uploadTemp = createUploadMiddleware(getUploadBaseDir());

  // ==================== 导出 ====================

  // ---- 筛选导出 ----
  app.get('/api/export/filtered', (req, res) => {
    try {
      const db = getDatabase();
      const { department, keyword, date_from, date_to, is_project } = req.query;
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
      sql += ' ORDER BY SUBSTR(order_number, 1, 1), CAST(SUBSTR(order_number, 2) AS INTEGER)';
      const orders = db.prepare(sql).all(...params);
      exportOrdersToExcel(orders, res);
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 全部导出 ----
  app.get('/api/export', (req, res) => {
    try {
      const db = getDatabase();
      const orders = db.prepare('SELECT * FROM requirement_orders ORDER BY SUBSTR(order_number, 1, 1), CAST(SUBSTR(order_number, 2) AS INTEGER)').all();
      exportOrdersToExcel(orders, res);
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 导入模板下载 ----
  app.get('/api/import/template', (req, res) => {
    try {
      const wb = xlsx.utils.book_new();
      const ws = xlsx.utils.aoa_to_sheet([
        ['需求单编号', '需求单名称', '业务部门', '关联部门', '提出人', '提出日期', '业务上线预期', '需求点编号', '需求点描述', '涉及系统', '上线版本', 'CCB会议', '会议日期', '会议备注', '是否立项'],
        ['A01', '示例需求', '交易中心', '清算部,交割储运部', '张三', '2026-06-01', '2026-07-15', '', '示例功能描述', '交易系统', 'v1.0', '6月CCB会议', '2026-06-20', '', '是'],
        ['A01', '', '', '', '', '', '', '', '功能二 | 功能三', '交易系统 | 清算系统', 'v1.0 | v2.0', '', '', '', '否'],
      ]);
      xlsx.utils.book_append_sheet(wb, ws, '需求单');
      const tmpPath = path.join(getUploadBaseDir(), 'template_' + Date.now() + '.xlsx');
      xlsx.writeFile(wb, tmpPath);
      res.download(tmpPath, '需求单导入模板.xlsx', () => { try { fs.unlinkSync(tmpPath); } catch (e) {} });
    } catch (err) { res.status(500).json({ success: false, message: '模板生成失败：' + err.message }); }
  });

  // ==================== 导入 ====================

  app.post('/api/import', uploadTemp.single('file'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: '请选择文件' });

      // 验证 Excel 文件
      let wb, data;
      try {
        wb = xlsx.readFile(req.file.path);
        if (!wb.Sheets || !wb.SheetNames || !wb.SheetNames[0]) throw new Error();
        const ws = wb.Sheets[wb.SheetNames[0]];
        data = xlsx.utils.sheet_to_json(ws, { raw: false, defval: '' });
      } catch (e) {
        try { fs.unlinkSync(req.file.path); } catch (ex) {}
        return res.status(400).json({ success: false, message: '文件格式无法识别，请使用 .xlsx 文件' });
      }

      if (!data || data.length === 0) {
        try { fs.unlinkSync(req.file.path); } catch (ex) {}
        return res.status(400).json({ success: false, message: 'Excel 文件中没有数据，请确认 Sheet 名称是否正确' });
      }

      if (!data[0].hasOwnProperty('需求单编号')) {
        try { fs.unlinkSync(req.file.path); } catch (ex) {}
        const cols = Object.keys(data[0]).join('、');
        return res.status(400).json({ success: false, message: `未找到"需求单编号"列。当前列名：${cols}。请使用导入模板，列名必须完全一致。` });
      }

      const db = getDatabase();
      let orderCount = 0, pointCount = 0, meetingCount = 0, scheduleCount = 0, skipped = 0;
      const warnings = [];
      const insO = db.prepare('INSERT OR IGNORE INTO requirement_orders (order_number,name,department,related_departments,proposer,propose_date,business_launch_date) VALUES (?,?,?,?,?,?,?)');
      const insP = db.prepare('INSERT INTO requirement_points (order_id,point_number,description,system,version) VALUES (?,?,?,?,?)');
      const insS = db.prepare('INSERT INTO ccb_schedules (meeting_id,order_id,point_id,system,version,is_project) VALUES (?,?,?,?,?,?)');
      const updP = db.prepare('UPDATE requirement_points SET system=?, version=? WHERE id=?');
      const orderSeqs = {};
      let rowNum = 0;

      db.transaction(() => {
        for (const row of data) {
          rowNum++;
          const on = row['需求单编号'];
          if (!on || !String(on).trim()) { continue; }
          if (!/^[A-Z]\d+$/.test(String(on))) {
            warnings.push(`第${rowNum}行：需求单编号"${on}"格式不正确（需大写字母开头+数字），已跳过`);
            skipped++;
            continue;
          }

          // --- 1. 创建/匹配需求单 ---
          const rds = row['关联部门'] ? String(row['关联部门']).trim() : '';
          const r = insO.run(on, row['需求单名称'] || '', row['业务部门'] || '', rds, row['提出人'] || '', normalizeDate(row['提出日期']), row['业务上线预期'] || '');
          const isNewOrder = r.changes > 0;
          if (isNewOrder) orderCount++;
          const order = db.prepare('SELECT id FROM requirement_orders WHERE order_number=?').get(on);
          if (!order) continue;

          if (!isNewOrder) {
            warnings.push(`第${rowNum}行：需求单"${on}"已存在，跳过该行需求点导入`);
            skipped++;
            continue;
          }

          // --- 2. 创建需求点 ---
          if (!row['需求点描述']) {
            warnings.push(`第${rowNum}行：需求单"${on}"缺少"需求点描述"，未创建需求点`);
            skipped++;
            continue;
          }

          const descs = String(row['需求点描述']).split(' | ').filter(d => d.trim());
          const sysArr = String(row['涉及系统'] || '').split(' | ');
          const verArr = String(row['上线版本'] || '').split(' | ');

          if (sysArr.length > 1 && sysArr.length !== descs.length) {
            warnings.push(`第${rowNum}行："涉及系统"数量(${sysArr.length})与"需求点描述"数量(${descs.length})不一致，缺失系统已置空`);
          }
          if (verArr.length > 1 && verArr.length !== descs.length) {
            warnings.push(`第${rowNum}行："上线版本"数量(${verArr.length})与"需求点描述"数量(${descs.length})不一致，缺失版本已置空`);
          }

          if (!orderSeqs[on]) {
            const maxP = db.prepare("SELECT point_number FROM requirement_points WHERE order_id=? ORDER BY id DESC LIMIT 1").get(order.id);
            orderSeqs[on] = maxP ? (parseInt((maxP.point_number.match(/(\d{3})$/) || [])[1]) || 0) + 1 : 1;
          }

          const rawPN = row['需求点编号'] ? String(row['需求点编号']).trim() : '';
          let useManualPN = false;
          if (rawPN) {
            const pnMatch = rawPN.match(/^[A-Z]\d{2}(\d{1,3})$/);
            if (pnMatch) {
              const userSeq = parseInt(pnMatch[1]);
              if (userSeq >= orderSeqs[on]) orderSeqs[on] = userSeq;
              useManualPN = true;
            } else {
              warnings.push(`第${rowNum}行：需求点编号"${rawPN}"格式无效（应为${on}NNN格式，如${on}001），已自动生成编号`);
            }
          }

          const createdPoints = [];
          descs.forEach((d, i) => {
            const seq = orderSeqs[on]++;
            const pointNumber = useManualPN && i === 0 ? rawPN : `${on}${String(seq).padStart(3, '0')}`;
            const result = insP.run(order.id, pointNumber, d.trim(), sysArr[i] || '', verArr[i] || '');
            createdPoints.push({ id: result.lastInsertRowid, system: sysArr[i] || '', version: verArr[i] || '' });
            pointCount++;
          });

          // --- 3. 创建排期 ---
          const meetingName = row['CCB会议'] ? String(row['CCB会议']).trim() : '';
          if (meetingName) {
            let meeting = db.prepare('SELECT id FROM ccb_meetings WHERE meeting_name=?').get(meetingName);
            if (!meeting) {
              db.prepare('INSERT INTO ccb_meetings (meeting_name,meeting_date,notes) VALUES (?,?,?)').run(meetingName, normalizeDate(row['会议日期']), row['会议备注'] || '');
              meeting = db.prepare('SELECT id FROM ccb_meetings WHERE meeting_name=?').get(meetingName);
              meetingCount++;
            }
            const isProject = row['是否立项'] ? (String(row['是否立项']).trim() === '是' ? 1 : 0) : 0;
            createdPoints.forEach(p => {
              insS.run(meeting.id, order.id, p.id, p.system, p.version, isProject);
              updP.run(p.system, p.version, p.id);
              scheduleCount++;
            });
          }
        }
      })();

      try { fs.unlinkSync(req.file.path); } catch (e) {}

      const result = { orderCount, pointCount, meetingCount, scheduleCount, skipped };
      if (warnings.length > 0) result.warnings = warnings;
      res.json({ success: true, data: result });
    } catch (err) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      res.status(500).json({ success: false, message: '导入失败：' + err.message });
    }
  });

  // ==================== 内部辅助 ====================

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function exportOrdersToExcel(orders, res) {
    const db = getDatabase();
    const wb = xlsx.utils.book_new();
    const rows = [];
    for (const o of orders) {
      const points = db.prepare('SELECT * FROM requirement_points WHERE order_id=? ORDER BY point_number').all(o.id);
      const projCols = { '是否立项': '' };
      if (points.length === 0) {
        rows.push(Object.assign({
          '需求单编号': o.order_number, '需求单名称': o.name, '业务部门': o.department || '', '关联部门': o.related_departments || '',
          '提出人': o.proposer || '', '提出日期': o.propose_date || '', '提出背景': o.background || '', '业务上线预期': o.business_launch_date || '',
          '需求点编号': '', '需求点描述': '', '涉及系统': '', '上线版本': '', 'CCB会议': '', '排期日期': ''
        }, projCols));
      } else {
        for (const p of points) {
          const sche = db.prepare(`SELECT cs.*, cm.meeting_name, cm.meeting_date FROM ccb_schedules cs JOIN ccb_meetings cm ON cs.meeting_id=cm.id WHERE cs.point_id=?`).get(p.id);
          rows.push(Object.assign({
            '需求单编号': o.order_number, '需求单名称': o.name, '业务部门': o.department || '', '关联部门': o.related_departments || '',
            '提出人': o.proposer || '', '提出日期': o.propose_date || '', '提出背景': o.background || '', '业务上线预期': o.business_launch_date || '',
            '需求点编号': p.point_number, '需求点描述': p.description,
            '涉及系统': sche ? sche.system : (p.system || ''), '上线版本': sche ? sche.version : (p.version || ''),
            'CCB会议': sche ? sche.meeting_name : '', '排期日期': sche ? sche.meeting_date : ''
          }, { '是否立项': sche ? (sche.is_project ? '是' : '否') : '' }));
        }
      }
    }
    const ws = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(wb, ws, '需求单信息');
    const now = new Date();
    const dateStr = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
    const fileName = `需求单信息-${dateStr}.xlsx`;
    const fp = path.join(getUploadBaseDir(), fileName);
    xlsx.writeFile(wb, fp);
    res.download(fp, fileName, err => {
      if (err) console.error(err);
      setTimeout(() => { try { fs.unlinkSync(fp); } catch (e) {} }, 5000);
    });
  }

};
