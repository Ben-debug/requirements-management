/**
 * 备份管理路由
 * 数据库一致性快照 + 配置 + 可选上传文件的备份、列表、下载、删除
 */
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const config = require('../config');
const { getDatabase } = require('../database');

const BACKUP_NAME = /^backup-\d{8}-\d{6}$/;

module.exports = function (app) {

  function getBackupDir() {
    return path.join(path.dirname(config.getConfigPath()), 'backups');
  }

  function stampName() {
    const n = new Date();
    const p = x => String(x).padStart(2, '0');
    return `backup-${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`;
  }

  function dirSize(dir) {
    let total = 0;
    if (!fs.existsSync(dir)) return 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSize(p);
      else if (entry.isFile()) total += fs.statSync(p).size;
    }
    return total;
  }

  function readManifest(dir) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    } catch (e) { return null; }
  }

  // ---- 创建备份 ----
  app.post('/api/backup', async (req, res) => {
    try {
      const includeUploads = !!(req.body && req.body.include_uploads);
      const name = stampName();
      const dir = path.join(getBackupDir(), name);
      if (fs.existsSync(dir)) return res.status(409).json({ success: false, message: '同一秒内已存在备份，请稍后重试' });
      fs.mkdirSync(dir, { recursive: true });

      // better-sqlite3 在线备份：一致性快照，不影响正在使用的库
      await getDatabase().backup(path.join(dir, 'requirements.db'));

      const configSrc = config.getConfigPath();
      if (fs.existsSync(configSrc)) fs.copyFileSync(configSrc, path.join(dir, 'config.json'));

      if (includeUploads) {
        const roots = new Set();
        for (const k of ['flow_files_dir', 'meeting_files_dir', 'service_order_dir', 'spec_docs_dir']) {
          const v = config.getPath(k);
          if (v && fs.existsSync(v)) roots.add(path.resolve(v));
        }
        const defaultUploads = path.join(path.dirname(config.getConfigPath()), 'public', 'uploads');
        if (fs.existsSync(defaultUploads)) roots.add(path.resolve(defaultUploads));
        // 去掉被其它根目录包含的路径，避免重复拷贝
        const unique = [...roots].filter(r => ![...roots].some(o => o !== r && r.startsWith(o + path.sep)));
        const uploadDir = path.join(dir, 'uploads');
        fs.mkdirSync(uploadDir, { recursive: true });
        for (const src of unique) {
          const dest = path.join(uploadDir, path.basename(src));
          fs.cpSync(src, dest, { recursive: true, force: true });
        }
      }

      const manifest = {
        name,
        created_at: new Date().toISOString(),
        app_version: require('../../package.json').version,
        include_uploads: includeUploads,
        size_bytes: dirSize(dir)
      };
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      res.json({ success: true, message: '备份已创建', data: manifest });
    } catch (err) {
      res.status(500).json({ success: false, message: '备份失败：' + err.message });
    }
  });

  // ---- 备份列表 ----
  app.get('/api/backup/list', (req, res) => {
    try {
      const root = getBackupDir();
      if (!fs.existsSync(root)) return res.json({ success: true, data: [] });
      const list = fs.readdirSync(root, { withFileTypes: true })
        .filter(e => e.isDirectory() && BACKUP_NAME.test(e.name))
        .map(e => readManifest(path.join(root, e.name)) || {
          name: e.name, created_at: e.name, size_bytes: dirSize(path.join(root, e.name))
        })
        .sort((a, b) => String(b.name).localeCompare(String(a.name)));
      res.json({ success: true, data: list });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 删除备份 ----
  app.delete('/api/backup/:name', (req, res) => {
    try {
      const name = req.params.name;
      if (!BACKUP_NAME.test(name)) return res.status(400).json({ success: false, message: '备份名称无效' });
      const dir = path.join(getBackupDir(), name);
      if (!fs.existsSync(dir)) return res.status(404).json({ success: false, message: '备份不存在' });
      fs.rmSync(dir, { recursive: true, force: true });
      res.json({ success: true, message: '备份已删除' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 下载备份（zip） ----
  app.get('/api/backup/:name/download', async (req, res) => {
    try {
      const name = req.params.name;
      if (!BACKUP_NAME.test(name)) return res.status(400).json({ success: false, message: '备份名称无效' });
      const dir = path.join(getBackupDir(), name);
      if (!fs.existsSync(dir)) return res.status(404).json({ success: false, message: '备份不存在' });

      const zip = new JSZip();
      const addDir = (folder, rel) => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
          const full = path.join(folder, entry.name);
          const zipPath = rel ? rel + '/' + entry.name : entry.name;
          if (entry.isDirectory()) addDir(full, zipPath);
          else if (entry.isFile()) zip.file(zipPath, fs.readFileSync(full));
        }
      };
      addDir(dir, '');
      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', `attachment; filename*="UTF-8''${encodeURIComponent(name + '.zip')}"`);
      res.send(buf);
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

};
