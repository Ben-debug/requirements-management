/**
 * 需求单信息管理系统 — 主入口
 *
 * 职责：Express 配置、目录初始化、路由注册、服务器启动
 * 路由逻辑已拆分到 server/routes/ 各模块
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { initDataDir } = require('./database');
const config = require('./config');
const { errorHandler, fallbackHandler } = require('./middleware/error-handler');

const app = express();
const PORT = 3000;

// ---- 基础中间件 ----
// 前后端同源，不需要 CORS；放开会让任意站点读取本机 API
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

// ---- 访问鉴权（Basic Auth）----
// 必须挂在静态资源之前，否则首页和 JS/CSS 不受保护
const crypto = require('crypto');
const AUTH_USER = 'admin';
let authPassword = config.getAuthPassword();
if (!authPassword) {
  authPassword = crypto.randomBytes(6).toString('hex');
  config.setAuthPassword(authPassword);
}
console.log('\n============================================');
console.log(`  访问认证  用户名: ${AUTH_USER}`);
console.log(`            口令:   ${authPassword}`);
console.log(`  局域网访问: http://<本机IP>:${PORT}`);
console.log(`  修改口令: ${config.getConfigPath()} 的 auth.password（重启生效）`);
console.log('============================================\n');

const deny = (res) => {
  res.set('WWW-Authenticate', 'Basic realm="Requirement Manager", charset="UTF-8"');
  return res.status(401).send('需要用户名和口令');
};

app.use((req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return deny(res);
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) return deny(res);
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  const hash = s => crypto.createHash('sha256').update(s).digest();
  if (user === AUTH_USER && crypto.timingSafeEqual(hash(pass), hash(authPassword))) return next();
  return deny(res);
});

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
      const url = `http://localhost:${PORT}`;
      if (process.platform === 'win32') cp.exec(`cmd /c start "" "${url}"`);
    } catch (e) {}
  } else {
    console.error('启动失败:', err.message);
  }
});
