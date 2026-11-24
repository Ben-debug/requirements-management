/**
 * 工作台账路由
 * 纪检 / BM 两类台账的 CRUD、条件查询、排序、分页与 Excel 导出
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const xlsx = require('xlsx');
const { getDatabase } = require('../database');
const { paginate, normalizeDate } = require('../utils');
const { wrap } = require('../middleware/error-handler');
const { getUploadBaseDir } = require('../paths');

const CATEGORIES = { discipline: '纪检', bm: 'BM' };

// 排序字段白名单：只取映射后的值拼 SQL，防止注入
const SORT_COLUMNS = {
  entry_date: 'entry_date',
  work_name: 'work_name',
  issuing_department: 'issuing_department',
  completion_date: 'completion_date',
  created_at: 'created_at',
  id: 'id'
};

const TEXT_FIELDS = [
  'entry_date', 'work_name', 'issuing_department', 'work_content',
  'involved_people', 'completion_date', 'related_materials', 'remarks'
];

function isValidCategory(c) {
  return Object.prototype.hasOwnProperty.call(CATEGORIES, c);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function tempFileName() {
  return `ledger-export-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.xlsx`;
}

/** 构造列表/导出共用的 WHERE + ORDER BY（category 必填且已校验） */
function buildQuery(query) {
  const where = ['category = ?'];
  const params = [query.category];
  const { keyword, department, date_from, date_to } = query;

  if (keyword) {
    const k = `%${keyword}%`;
    where.push('(work_name LIKE ? OR issuing_department LIKE ? OR involved_people LIKE ? OR work_content LIKE ? OR related_materials LIKE ? OR remarks LIKE ?)');
    params.push(k, k, k, k, k, k);
  }
  if (department) { where.push('issuing_department = ?'); params.push(department); }
  if (date_from) { where.push('entry_date >= ?'); params.push(date_from); }
  if (date_to) { where.push('entry_date <= ?'); params.push(date_to); }

  const sort = SORT_COLUMNS[query.sort] || 'entry_date';
  const order = String(query.order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const orderBy = sort === 'entry_date'
    ? `ORDER BY entry_date ${order}, id ${order}`
    : `ORDER BY ${sort} ${order}, id DESC`;

  return {
    sql: `SELECT * FROM work_ledgers WHERE ${where.join(' AND ')} ${orderBy}`,
    params
  };
}

/** 从请求体提取并规范化字段值 */
function fieldsFromBody(body) {
  const out = {};
  for (const f of TEXT_FIELDS) {
    const v = body[f] == null ? '' : String(body[f]).trim();
    out[f] = (f === 'entry_date' || f === 'completion_date') ? normalizeDate(v) : v;
  }
  return out;
}

module.exports = function (app) {

  // ---- 列表（条件查询 + 排序 + 分页）----
  app.get('/api/ledgers', wrap((req, res) => {
    if (!isValidCategory(req.query.category)) {
      return res.status(400).json({ success: false, message: '台账类别无效' });
    }
    const { sql, params } = buildQuery(req.query);
    const p = paginate(sql, params, parseInt(req.query.page) || 1, parseInt(req.query.pageSize) || 10);
    res.json({ success: true, data: p.items, total: p.total, page: p.page, pageSize: p.pageSize, totalPages: p.totalPages });
  }));

  // ---- 导出（必须注册在 /api/ledgers/:id 之前，避免被参数路由吞掉）----
  app.get('/api/ledgers/export', wrap((req, res) => {
    if (!isValidCategory(req.query.category)) {
      return res.status(400).json({ success: false, message: '台账类别无效' });
    }
    const db = getDatabase();
    const { sql, params } = buildQuery(req.query);
    const rows = db.prepare(sql).all(...params);
    const categoryName = CATEGORIES[req.query.category];

    const data = rows.map(r => ({
      '类别': categoryName,
      '录入日期': r.entry_date || '',
      '工作名称': r.work_name || '',
      '下发部门': r.issuing_department || '',
      '工作内容': r.work_content || '',
      '涉及人员': r.involved_people || '',
      '完成日期': r.completion_date || '',
      '相关材料': r.related_materials || '',
      '备注': r.remarks || ''
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(data);
    xlsx.utils.book_append_sheet(wb, ws, '工作台账');

    const now = new Date();
    const dateStr = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
    const displayName = `工作台账-${categoryName}-${dateStr}.xlsx`;
    const fp = path.join(getUploadBaseDir(), tempFileName());
    xlsx.writeFile(wb, fp);
    res.download(fp, displayName, err => {
      if (err) console.error(err);
      setTimeout(() => { try { fs.unlinkSync(fp); } catch (e) {} }, 5000);
    });
  }));

  // ---- 详情 ----
  app.get('/api/ledgers/:id', wrap((req, res) => {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM work_ledgers WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: '台账记录不存在' });
    res.json({ success: true, data: row });
  }));

  // ---- 新建 ----
  app.post('/api/ledgers', wrap((req, res) => {
    if (!isValidCategory(req.body.category)) {
      return res.status(400).json({ success: false, message: '台账类别无效' });
    }
    const f = fieldsFromBody(req.body);
    if (!f.entry_date) return res.status(400).json({ success: false, message: '请填写录入日期' });
    if (!f.work_name) return res.status(400).json({ success: false, message: '请填写工作名称' });

    const db = getDatabase();
    const cols = ['category', ...TEXT_FIELDS].join(',');
    const placeholders = ['?', ...TEXT_FIELDS.map(() => '?')].join(',');
    const r = db.prepare(`INSERT INTO work_ledgers (${cols}) VALUES (${placeholders})`)
      .run(req.body.category, ...TEXT_FIELDS.map(k => f[k]));
    res.json({ success: true, data: { id: r.lastInsertRowid } });
  }));

  // ---- 修改（类别不随编辑改变）----
  app.put('/api/ledgers/:id', wrap((req, res) => {
    const db = getDatabase();
    const exists = db.prepare('SELECT id FROM work_ledgers WHERE id=?').get(req.params.id);
    if (!exists) return res.status(404).json({ success: false, message: '台账记录不存在' });

    const f = fieldsFromBody(req.body);
    if (!f.entry_date) return res.status(400).json({ success: false, message: '请填写录入日期' });
    if (!f.work_name) return res.status(400).json({ success: false, message: '请填写工作名称' });

    const sets = TEXT_FIELDS.map(k => `${k}=?`).join(',') + ", updated_at=datetime('now','localtime')";
    db.prepare(`UPDATE work_ledgers SET ${sets} WHERE id=?`)
      .run(...TEXT_FIELDS.map(k => f[k]), req.params.id);
    res.json({ success: true });
  }));

  // ---- 删除 ----
  app.delete('/api/ledgers/:id', wrap((req, res) => {
    const db = getDatabase();
    db.prepare('DELETE FROM work_ledgers WHERE id=?').run(req.params.id);
    res.json({ success: true });
  }));

};
