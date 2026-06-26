/**
 * 需求单信息管理系统 — 主入口
 *
 * 职责：Express 配置、目录初始化、路由注册、服务器启动
 * 路由逻辑已拆分到 server/routes/ 各模块
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { getDatabase, initDataDir, reopenDatabase } = require('./database');
const config = require('./config');
const { errorHandler, fallbackHandler } = require('./middleware/error-handler');
const { bumpVersion } = require('./utils');

const app = express();
const PORT = 3000;

// ---- 基础中间件 ----
app.use(cors());
app.use(express.json());

// ---- 目录路径解析 ----
const ROOT_DIR = path.join(__dirname, '..');
// pkg 环境下 __dirname 指向虚拟快照路径，需要物理路径用于文件上传和数据存储
const DATA_DIR = process.pkg ? path.dirname(process.execPath) : ROOT_DIR;

// ---- 自定义 data 目录初始化与数据迁移 ----
const customDataDir = config.getPath('data_dir');
if (customDataDir) {
  initDataDir(customDataDir);
  if (!fs.existsSync(customDataDir)) fs.mkdirSync(customDataDir, { recursive: true });

  // 自动迁移旧 config.json
  const oldCfg = path.join(ROOT_DIR, 'data', 'config.json');
  const newCfg = path.join(customDataDir, 'config.json');
  if (!fs.existsSync(newCfg) && fs.existsSync(oldCfg)) {
    try { fs.copyFileSync(oldCfg, newCfg); console.log(`已迁移配置到: ${customDataDir}`); } catch (e) { console.error(`配置迁移失败: ${e.message}`); }
  }
  config.setConfigDir(customDataDir);

  // 自动迁移旧数据库
  const oldDb = path.join(ROOT_DIR, 'data', 'requirements.db');
  const newDb = path.join(customDataDir, 'requirements.db');
  if (!fs.existsSync(newDb) && fs.existsSync(oldDb)) {
    try {
      fs.copyFileSync(oldDb, newDb);
      for (const ext of ['-wal', '-shm']) {
        const f = oldDb + ext;
        if (fs.existsSync(f)) fs.copyFileSync(f, newDb + ext);
      }
      console.log(`已迁移数据库到: ${customDataDir}`);
    } catch (e) { console.error(`数据库迁移失败: ${e.message}`); }
  }
}

// ---- 静态文件 ----
app.use(express.static(path.join(ROOT_DIR, 'public'), { maxAge: 0, etag: false }));

// ---- 首页 ----
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
});

// ---- 上传目录辅助与初始化 ----
function getFlowFileDir() {
  const custom = config.getPath('flow_files_dir');
  return custom || path.join(DATA_DIR, 'public', 'uploads', 'flow_files');
}
function getMeetingFileDir() {
  const custom = config.getPath('meeting_files_dir');
  return custom || path.join(DATA_DIR, 'public', 'uploads', 'meeting_files');
}
function getServiceOrderDir() {
  const custom = config.getPath('service_order_dir');
  return custom || path.join(DATA_DIR, 'public', 'uploads', 'service_orders');
}
function getSpecDocDir() {
  const custom = config.getPath('spec_docs_dir');
  return custom || path.join(DATA_DIR, 'public', 'uploads', 'spec_docs');
}
function getUploadBaseDir() {
  return path.join(DATA_DIR, 'public', 'uploads');
}
function ensureUploadDirs() {
  const dirs = [getUploadBaseDir(), getFlowFileDir(), getMeetingFileDir(), getServiceOrderDir(), getSpecDocDir()];
  dirs.forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
}
ensureUploadDirs();

// ---- 自动记录升级日志 ----
try {
  const db = getDatabase();
  const lastLog = db.prepare('SELECT version FROM upgrade_logs ORDER BY id DESC LIMIT 1').get();
  const ver = lastLog ? bumpVersion(lastLog.version) : 'v1.0.0';
  db.prepare("INSERT INTO upgrade_logs (version,title,content) VALUES (?,?,?)").run(ver, `系统重新启动 ${ver}`, '服务重启自动记录');
} catch (e) {}

// ============================================================
// 路由注册
// ============================================================
require('./routes/orders')(app);
require('./routes/meetings')(app);
require('./routes/schedules')(app);
require('./routes/files')(app);
require('./routes/specs')(app);
require('./routes/config-routes')(app);
require('./routes/import-export')(app);
require('./routes/assessment')(app);

// ============================================================
// 错误处理
// ============================================================
app.use(errorHandler);
app.use(fallbackHandler);

// ============================================================
// 启动服务器
// ============================================================
const server = app.listen(PORT, () => {
  console.log(`需求单信息管理系统已启动: http://localhost:${PORT}`);
  // Auto-open browser
  setTimeout(() => {
    try {
      const url = `http://localhost:${PORT}`;
      const cp = require('child_process');
      if (process.platform === 'win32') cp.exec(`cmd /c start "" "${url}"`);
      else if (process.platform === 'darwin') cp.exec(`open "${url}"`);
      else cp.exec(`xdg-open "${url}"`);
    } catch (e) {}
  }, 500);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n错误: 端口 ${PORT} 已被占用！`);
    console.error('请关闭占用该端口的程序后重试。');
    console.error(`\n如果浏览器已打开，请直接访问: http://localhost:${PORT}`);
    try {
      const cp = require('child_process');
      if (process.platform === 'win32') cp.exec(`cmd /c start "" "${url}"`);
    } catch (e) {}
  } else {
    console.error('启动失败:', err.message);
  }
});
