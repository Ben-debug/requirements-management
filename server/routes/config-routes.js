/**
 * 配置管理路由
 * 配置项 CRUD、路径配置、目录浏览、模板管理、升级日志
 */
const config = require('../config');
const wordGenerator = require('../word-generator');
const { getDatabase } = require('../database');
const { createUploadMiddleware, removeTempFile } = require('../middleware/upload');
const path = require('path');
const fs = require('fs');
const { wrap } = require('../middleware/error-handler');
const { getRootDir, getConfigDir, getUploadBaseDir } = require('../paths');

module.exports = function (app) {


  // ---- 改名：历史数据精确替换（按逗号分隔的 token，避免子串误伤）----
  function splitTokens(raw) {
    return String(raw || '').split(/[,，、]+/).map(s => s.trim()).filter(Boolean);
  }
  function replaceToken(raw, oldName, newName) {
    const parts = splitTokens(raw);
    if (!parts.includes(oldName)) return { value: raw, changed: false };
    return { value: parts.map(p => p === oldName ? newName : p).join(','), changed: true };
  }
  function collectRenameImpact(db, cat, label) {
    if (cat === 'project') {
      const schedules = db.prepare('SELECT COUNT(*) AS n FROM ccb_schedules WHERE project_name=?').get(label).n;
      return { schedules, total: schedules };
    }
    if (cat === 'version') {
      const points = db.prepare('SELECT COUNT(*) AS n FROM requirement_points WHERE version=?').get(label).n;
      const schedules = db.prepare('SELECT COUNT(*) AS n FROM ccb_schedules WHERE version=?').get(label).n;
      const specDocs = db.prepare('SELECT COUNT(*) AS n FROM spec_documents WHERE version=?').get(label).n;
      return { points, schedules, specDocs, total: points + schedules + specDocs };
    }
    const orders = db.prepare('SELECT COUNT(*) AS n FROM requirement_orders WHERE department=?').get(label).n;
    const rel = db.prepare('SELECT related_departments FROM requirement_orders WHERE related_departments LIKE ?').all(`%${label}%`)
      .filter(r => splitTokens(r.related_departments).includes(label)).length;
    const docs = db.prepare('SELECT matched_department FROM spec_documents WHERE matched_department LIKE ?').all(`%${label}%`)
      .filter(r => splitTokens(r.matched_department).includes(label)).length;
    return { orders, relatedOrders: rel, specDocs: docs, total: orders + rel + docs };
  }
  function applyRenameHistoryUpdate(db, cat, oldName, newName) {
    if (cat === 'project') {
      const schedules = db.prepare('UPDATE ccb_schedules SET project_name=? WHERE project_name=?').run(newName, oldName).changes;
      return { schedules, total: schedules };
    }
    if (cat === 'version') {
      const points = db.prepare('UPDATE requirement_points SET version=? WHERE version=?').run(newName, oldName).changes;
      const schedules = db.prepare('UPDATE ccb_schedules SET version=? WHERE version=?').run(newName, oldName).changes;
      const specDocs = db.prepare('UPDATE spec_documents SET version=? WHERE version=?').run(newName, oldName).changes;
      return { points, schedules, specDocs, total: points + schedules + specDocs };
    }
    const orderRows = db.prepare('SELECT id, related_departments FROM requirement_orders WHERE related_departments LIKE ?').all(`%${oldName}%`);
    const docRows = db.prepare('SELECT id, matched_department FROM spec_documents WHERE matched_department LIKE ?').all(`%${oldName}%`);
    const updOrder = db.prepare("UPDATE requirement_orders SET related_departments=?, updated_at=datetime('now','localtime') WHERE id=?");
    const updSpec = db.prepare("UPDATE spec_documents SET matched_department=?, updated_at=datetime('now','localtime') WHERE id=?");
    let relatedOrders = 0, specDocs = 0;
    for (const r of orderRows) {
      const res = replaceToken(r.related_departments, oldName, newName);
      if (res.changed) { updOrder.run(res.value, r.id); relatedOrders++; }
    }
    for (const r of docRows) {
      const res = replaceToken(r.matched_department, oldName, newName);
      if (res.changed) { updSpec.run(res.value, r.id); specDocs++; }
    }
    const orders = db.prepare("UPDATE requirement_orders SET department=?, updated_at=datetime('now','localtime') WHERE department=?").run(newName, oldName).changes;
    return { orders, relatedOrders, specDocs, total: orders + relatedOrders + specDocs };
  }

  const uploadTemp = createUploadMiddleware(getUploadBaseDir());
  const { getTemplateDir, TEMPLATE_FILENAME } = wordGenerator;

  // ---- 路径配置 ----
  app.get('/api/config/paths', wrap((req, res) => {
      res.json({
        success: true, data: {
          data_dir: config.getPath('data_dir'),
          flow_files_dir: config.getPath('flow_files_dir'),
          meeting_files_dir: config.getPath('meeting_files_dir'),
          service_order_dir: config.getPath('service_order_dir'),
          spec_docs_dir: config.getPath('spec_docs_dir'),
          backup_dir: config.getPath('backup_dir'),
          defaults: {
            data_dir: getRootDir(),
            flow_files_dir: path.join(getUploadBaseDir(), 'flow_files'),
            meeting_files_dir: path.join(getUploadBaseDir(), 'meeting_files'),
            service_order_dir: path.join(getUploadBaseDir(), 'service_orders'),
            spec_docs_dir: path.join(getUploadBaseDir(), 'spec_docs'),
            backup_dir: path.join(getConfigDir(), 'backups')
          }
        }
      });
  }));

  app.post('/api/config/paths', wrap((req, res) => {
      const { data_dir, flow_files_dir, meeting_files_dir, service_order_dir, spec_docs_dir, backup_dir } = req.body || {};
      if (data_dir !== undefined) {
        config.setPath('data_dir', data_dir);
        if (data_dir) {
          config.setConfigDir(data_dir);
          const { reopenDatabase } = require('../database');
          reopenDatabase(data_dir);
        }
      }
      if (flow_files_dir !== undefined) config.setPath('flow_files_dir', flow_files_dir);
      if (meeting_files_dir !== undefined) config.setPath('meeting_files_dir', meeting_files_dir);
      if (service_order_dir !== undefined) config.setPath('service_order_dir', service_order_dir);
      if (spec_docs_dir !== undefined) config.setPath('spec_docs_dir', spec_docs_dir);
      if (backup_dir !== undefined) config.setPath('backup_dir', backup_dir);
      [flow_files_dir, meeting_files_dir, service_order_dir, spec_docs_dir, backup_dir].forEach(d => {
        if (d && !fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      });
      res.json({ success: true, message: '路径设置已保存，已立即生效' });
  }));

  // ---- 目录浏览 ----
  app.get('/api/config/browse', wrap((req, res) => {
      let dirPath = req.query.path || (process.platform === 'win32' ? 'C:\\' : '/');
      const resolvedPath = path.resolve(dirPath);
      if (resolvedPath.includes('node_modules')) return res.json({ success: true, data: { current: dirPath, parent: null, subdirs: [] } });
      dirPath = resolvedPath;
      if (!fs.existsSync(dirPath)) return res.status(400).json({ success: false, message: '路径不存在' });
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) return res.status(400).json({ success: false, message: '不是目录' });
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      const subdirs = items.filter(item => item.isDirectory() && !item.name.startsWith('.')).map(item => item.name).sort();
      const parent = (() => {
        const resolved = path.resolve(dirPath);
        if (resolved === path.parse(resolved).root) return null;
        return path.dirname(resolved);
      })();
      res.json({ success: true, data: { current: path.resolve(dirPath), parent, subdirs } });
  }));

  // ---- 配置分类 CRUD ----
  app.get('/api/config', wrap((req, res) => {
      const { auth, ...safe } = config.getAll();   // 不向前端暴露口令
      res.json({ success: true, data: safe, config_path: config.getConfigPath() });
  }));

  // 部门/项目改名影响预览（只读，不写任何数据）
  app.get('/api/config/:category/rename-impact', wrap((req, res) => {
      const { category } = req.params;
      if (['department', 'project', 'version'].indexOf(category) === -1) {
        return res.status(400).json({ success: false, message: '该分类不支持改名预览' });
      }
      const label = String(req.query.label || '').trim();
      if (!label) return res.status(400).json({ success: false, message: '缺少名称' });
      if (!config.getCategory(category).includes(label)) {
        return res.status(400).json({ success: false, message: '该名称不在配置中' });
      }
      res.json({ success: true, data: collectRenameImpact(getDatabase(), category, label) });
  }));

  app.post('/api/config', wrap((req, res) => {
      const { category, label } = req.body;
      if (!category || !label) return res.status(400).json({ success: false, message: '不能为空' });
      if (category === 'auth') return res.status(400).json({ success: false, message: '访问口令请通过登录页或参数配置页修改' });
      config.addItem(category, label);
      res.json({ success: true });
  }));

  app.delete('/api/config/:category/:label', wrap((req, res) => {
      if (req.params.category === 'auth') return res.status(400).json({ success: false, message: '访问口令请通过参数配置页修改' });
      config.deleteItem(req.params.category, req.params.label); res.json({ success: true });
  }));

  // 自定义排序：提交该项分类的完整、不重复顺序列表
  app.put('/api/config/:category/order', wrap((req, res) => {
      const cat = req.params.category;
      if (cat === 'auth' || cat === 'paths') return res.status(400).json({ success: false, message: '该分类不支持排序' });
      const labels = req.body && req.body.labels;
      if (!config.reorderCategory(cat, labels)) {
        return res.status(400).json({ success: false, message: '排序内容无效：需提交当前所有条目的完整且不重复的顺序' });
      }
      res.json({ success: true, message: '顺序已保存' });
  }));

  // 改名：系统别名只影响后续扫描；部门可选择是否同步更新历史引用，须放在 /order 路由之后
  app.put('/api/config/:category/:label', wrap((req, res) => {
      const { category, label } = req.params;
      if (!config.isEditable(category)) {
        return res.status(400).json({ success: false, message: '该分类不支持改名（为避免历史数据引用失配）' });
      }
      const next = String((req.body && req.body.label) || '').trim();
      const current = config.getCategory(category);
      if (!current.includes(label) || !next || (next !== label && current.includes(next))) {
        return res.status(400).json({ success: false, message: '修改失败：名称不能为空或与已有项重复，且原条目必须存在' });
      }
      const hasAlias = ['department', 'project', 'version'].indexOf(category) !== -1;
      const updateHistory = hasAlias && req.body && req.body.update_history === true;
      const snapshot = config.snapshot();
      let history = null;
      try {
        const db = getDatabase();
        // 配置与数据库写入放在同一事务：数据库失败时回滚配置
        db.transaction(() => {
          if (!config.updateItem(category, label, next)) throw new Error('配置修改失败');
          if (updateHistory) history = applyRenameHistoryUpdate(db, category, label, next);
        })();
      } catch (err) {
        config.restore(snapshot);
        return res.status(500).json({ success: false, message: '改名失败，已回滚：' + err.message });
      }
      const message = updateHistory
        ? `已改名并同步更新 ${history.total} 条历史记录`
        : (hasAlias ? '已改名，历史数据保留原名（旧名已作为匹配别名）' : '已修改（仅影响后续目录扫描）');
      res.json({ success: true, message, data: { history } });
  }));

  // ---- 意向书评估表模板管理 ----
  app.get('/api/config/assessment-template', wrap((req, res) => {
      const templateDir = getTemplateDir();
      const templatePath = path.join(templateDir, TEMPLATE_FILENAME);
      const exists = fs.existsSync(templatePath);
      res.json({ success: true, data: { exists, filename: TEMPLATE_FILENAME, path: templatePath } });
  }));

  app.post('/api/config/assessment-template', uploadTemp.single('file'), wrap((req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: '请选择 Word 模板文件' });
      const name = req.file.originalname || '';
      if (!name.toLowerCase().endsWith('.docx')) {
        return res.status(400).json({ success: false, message: '仅支持 .docx 格式的 Word 模板文件' });
      }
      const templateDir = getTemplateDir();
      const destPath = path.join(templateDir, TEMPLATE_FILENAME);
      try { fs.copyFileSync(req.file.path, destPath); } catch (e) {
        return res.status(500).json({ success: false, message: '模板保存失败' });
      }
      res.json({ success: true, message: '模板上传成功' });
    } finally { removeTempFile(req); }
  }));

  app.delete('/api/config/assessment-template', wrap((req, res) => {
      const templateDir = getTemplateDir();
      const templatePath = path.join(templateDir, TEMPLATE_FILENAME);
      if (fs.existsSync(templatePath)) {
        fs.unlinkSync(templatePath);
        res.json({ success: true, message: '模板已删除' });
      } else {
        res.json({ success: false, message: '模板不存在' });
      }
  }));

  // 参数路由必须放在所有 /api/config/* 静态路由之后，否则会遮蔽具体路径
  app.get('/api/config/:category', wrap((req, res) => {
      if (req.params.category === 'auth') return res.json({ success: true, data: [] });
      res.json({ success: true, data: config.getCategory(req.params.category) });
  }));

  // ---- 升级日志 ----
  app.get('/api/upgrade-logs', wrap((req, res) => {
      const db = getDatabase();
      res.json({ success: true, data: db.prepare('SELECT * FROM upgrade_logs ORDER BY created_at DESC').all() });
  }));

};
