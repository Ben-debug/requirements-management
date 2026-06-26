/**
 * 配置管理路由
 * 配置项 CRUD、路径配置、目录浏览、模板管理、升级日志
 */
const config = require('../config');
const wordGenerator = require('../word-generator');
const { getDatabase } = require('../database');
const { createUploadMiddleware } = require('../middleware/upload');
const path = require('path');
const fs = require('fs');

module.exports = function (app) {

  const ROOT_DIR = path.join(__dirname, '..', '..');
  const DATA_DIR = process.pkg ? path.dirname(process.execPath) : ROOT_DIR;

  function getUploadBaseDir() {
    return path.join(DATA_DIR, 'public', 'uploads');
  }

  const uploadTemp = createUploadMiddleware(getUploadBaseDir());
  const { getTemplateDir, TEMPLATE_FILENAME } = wordGenerator;

  // ---- 路径配置 ----
  app.get('/api/config/paths', (req, res) => {
    try {
      res.json({
        success: true, data: {
          data_dir: config.getPath('data_dir'),
          flow_files_dir: config.getPath('flow_files_dir'),
          meeting_files_dir: config.getPath('meeting_files_dir'),
          service_order_dir: config.getPath('service_order_dir'),
          spec_docs_dir: config.getPath('spec_docs_dir'),
          defaults: {
            data_dir: DATA_DIR,
            flow_files_dir: path.join(DATA_DIR, 'public', 'uploads', 'flow_files'),
            meeting_files_dir: path.join(DATA_DIR, 'public', 'uploads', 'meeting_files'),
            service_order_dir: path.join(DATA_DIR, 'public', 'uploads', 'service_orders'),
            spec_docs_dir: path.join(DATA_DIR, 'public', 'uploads', 'spec_docs')
          }
        }
      });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.post('/api/config/paths', (req, res) => {
    try {
      const { data_dir, flow_files_dir, meeting_files_dir, service_order_dir, spec_docs_dir } = req.body || {};
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
      [flow_files_dir, meeting_files_dir, service_order_dir, spec_docs_dir].forEach(d => {
        if (d && !fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      });
      res.json({ success: true, message: '路径设置已保存，已立即生效' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 目录浏览 ----
  app.get('/api/config/browse', (req, res) => {
    try {
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
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 配置分类 CRUD ----
  app.get('/api/config/:category', (req, res) => {
    try { res.json({ success: true, data: config.getCategory(req.params.category) }); }
    catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.get('/api/config', (req, res) => {
    try { res.json({ success: true, data: config.getAll(), config_path: config.getConfigPath() }); }
    catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.post('/api/config', (req, res) => {
    try {
      const { category, label } = req.body;
      if (!category || !label) return res.status(400).json({ success: false, message: '不能为空' });
      config.addItem(category, label);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.delete('/api/config/:category/:label', (req, res) => {
    try { config.deleteItem(req.params.category, req.params.label); res.json({ success: true }); }
    catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 意向书评估表模板管理 ----
  app.get('/api/config/assessment-template', (req, res) => {
    try {
      const templateDir = getTemplateDir();
      const templatePath = path.join(templateDir, TEMPLATE_FILENAME);
      const exists = fs.existsSync(templatePath);
      res.json({ success: true, data: { exists, filename: TEMPLATE_FILENAME, path: templatePath } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.post('/api/config/assessment-template', uploadTemp.single('file'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: '请选择 Word 模板文件' });
      const name = req.file.originalname || '';
      if (!name.toLowerCase().endsWith('.docx')) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
        return res.status(400).json({ success: false, message: '仅支持 .docx 格式的 Word 模板文件' });
      }
      const templateDir = getTemplateDir();
      const destPath = path.join(templateDir, TEMPLATE_FILENAME);
      try { fs.copyFileSync(req.file.path, destPath); fs.unlinkSync(req.file.path); } catch (e) {
        return res.status(500).json({ success: false, message: '模板保存失败' });
      }
      res.json({ success: true, message: '模板上传成功' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.delete('/api/config/assessment-template', (req, res) => {
    try {
      const templateDir = getTemplateDir();
      const templatePath = path.join(templateDir, TEMPLATE_FILENAME);
      if (fs.existsSync(templatePath)) {
        fs.unlinkSync(templatePath);
        res.json({ success: true, message: '模板已删除' });
      } else {
        res.json({ success: false, message: '模板不存在' });
      }
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 升级日志 ----
  app.get('/api/upgrade-logs', (req, res) => {
    try {
      const db = getDatabase();
      res.json({ success: true, data: db.prepare('SELECT * FROM upgrade_logs ORDER BY created_at DESC').all() });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

};
