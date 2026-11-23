/**
 * 通用工具函数
 * 从 server/index.js 中提取的跨模块共用函数
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

/** 数字补零 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 日期统一格式化：支持 2026/6/11、2026-6-11、20260611 → 2026-06-11
 * 兼容 Excel M/D/YY 和 Excel 序列号格式
 */
function normalizeDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // 兼容 Excel M/D/YY 或 M/D/YYYY 格式
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    let y = parseInt(m[3]);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return `${y}-${pad2(parseInt(m[1]))}-${pad2(parseInt(m[2]))}`;
  }
  // 兼容 Excel 序列号（如 46185 → 2026-06-12）
  const num = Number(v);
  if (!isNaN(num) && num > 1 && num < 200000) {
    const d = new Date((num - 25569) * 86400000);
    if (!isNaN(d.getTime())) return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  return s;
}

/**
 * 分页查询辅助
 * @param {string} sql - 完整查询 SQL（不含 LIMIT/OFFSET）
 * @param {any[]} params - SQL 参数
 * @param {number} page - 页码（从 1 开始）
 * @param {number} pageSize - 每页条数
 * @returns {{ items, total, page, pageSize, totalPages }}
 */
function paginate(sql, params, page, pageSize) {
  const { getDatabase } = require('./database');
  const db = getDatabase();
  const countSql = `SELECT COUNT(*) as total FROM (${sql})`;
  const total = db.prepare(countSql).get(...params).total;
  const offset = (page - 1) * pageSize;
  const items = db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/**
 * 递归遍历目录，返回所有文件的完整路径数组
 * 使用 withFileTypes 避免跟随符号链接造成死循环；单个条目异常只跳过，不让整次扫描失败
 */
function walkDir(dir, maxDepth = 32) {
  const results = [];
  if (maxDepth < 0) return results;
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return results; }
  for (const entry of list) {
    const fullPath = path.join(dir, entry.name);
    try {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) results.push(...walkDir(fullPath, maxDepth - 1));
      else if (entry.isFile()) results.push(fullPath);
    } catch (e) { /* 跳过无法访问的条目 */ }
  }
  return results;
}

/** walkDir 的异步版本：扫描期间让出事件循环，避免局域网多人操作时界面卡顿 */
async function walkDirAsync(dir, maxDepth = 32) {
  const results = [];
  if (maxDepth < 0) return results;
  let list;
  try { list = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return results; }
  for (const entry of list) {
    const fullPath = path.join(dir, entry.name);
    try {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) results.push(...await walkDirAsync(fullPath, maxDepth - 1));
      else if (entry.isFile()) results.push(fullPath);
    } catch (e) { /* 跳过无法访问的条目 */ }
  }
  return results;
}

/**
 * 修正文件名编码（latin1 → utf8）
 */
function encodeName(name) {
  try { return Buffer.from(name, 'latin1').toString('utf8'); } catch (e) { return name; }
}

/** 浏览器可原生内联渲染的类型；其余类型即使 inline 也会被浏览器下载 */
const PREVIEW_MIME = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * 在浏览器中内联打开文件；浏览器无法渲染的类型回退为附件下载
 * @returns {boolean} 是否走的内联预览
 */
function sendFileInline(res, filePath, fileName) {
  const mime = PREVIEW_MIME[path.extname(filePath).toLowerCase()];
  if (!mime) { res.download(filePath, fileName); return false; }
  res.sendFile(path.resolve(filePath), {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'X-Content-Type-Options': 'nosniff'
    }
  });
  return true;
}

/** 判断请求是否来自服务器本机（含通过本机局域网 IP 访问） */
function isLocalClient(req) {
  const raw = (req && req.socket && req.socket.remoteAddress) || '';
  const ip = raw.replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  const locals = new Set(['127.0.0.1', '::1']);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if (a && a.address) locals.add(a.address);
  }
  return locals.has(ip);
}

/** 允许被「打开目录」访问的根目录，防止任意路径被打开 */
function defaultAllowedRoots() {
  const config = require('./config');
  const root = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
  const roots = [path.join(root, 'public', 'uploads'), path.join(root, 'data')];
  for (const k of ['data_dir', 'flow_files_dir', 'meeting_files_dir', 'service_order_dir', 'spec_docs_dir']) {
    const v = config.getPath(k);
    if (v) roots.push(v);
  }
  return roots;
}

/** 在系统文件管理器中显示文件所在目录（只在服务器本机有意义） */
function revealInFolder(filePath) {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  const allowed = defaultAllowedRoots().map(r => path.resolve(r));
  if (!allowed.some(r => dir === r || dir.startsWith(r + path.sep))) {
    return { ok: false, message: '该目录不在允许的上传目录范围内' };
  }
  const { spawn } = require('child_process');
  const opts = { detached: true, stdio: 'ignore' };
  try {
    if (process.platform === 'win32') spawn('explorer.exe', ['/select,', resolved], opts).unref();
    else if (process.platform === 'darwin') spawn('open', ['-R', resolved], opts).unref();
    else spawn('xdg-open', [dir], opts).unref();
    return { ok: true, dir: dir };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

function htmlEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function infoPage(title, bodyHtml) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${htmlEscape(title)}</title>
<style>body{margin:0;background:#f5f7fa;font:14px/1.6 -apple-system,"Microsoft YaHei",Arial,sans-serif;color:#333;display:flex;justify-content:center;padding:60px 20px}
.card{background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:26px 30px;max-width:640px;width:100%;box-shadow:0 2px 12px rgba(0,0,0,.06)}
h2{margin:0 0 14px;font-size:20px}p{margin:8px 0;color:#666}code{display:block;background:#f7f7f7;padding:10px 12px;border-radius:4px;word-break:break-all;font-size:12px;color:#555;margin:10px 0}</style></head>
<body><div class="card">${bodyHtml}</div></body></html>`;
}

/** 文件缺失时的友好提示页（替代裸 JSON） */
function sendFileMissing(res, fileName, filePath) {
  const body = `<h2>⚠️ 文件不存在</h2>
    <p>无法打开「${htmlEscape(fileName)}」。数据库记录指向的本地文件已不在磁盘上。</p>
    <p>记录中的本地路径：</p><code>${htmlEscape(filePath)}</code>
    <p>可能原因：文件被移动、删除，或该记录是历史遗留数据。请确认该路径，或重新上传文件。</p>`;
  return res.status(404).type('html').send(infoPage('文件不存在', body));
}

/**
 * 智能打开：
 *   可预览类型            → 浏览器内联打开
 *   不可预览 + 服务器本机 → 打开本地文件目录
 *   不可预览 + 远程访问   → 下载文件
 */
function handleFileOpen(req, res, filePath, fileName) {
  if (!fs.existsSync(filePath)) return sendFileMissing(res, fileName, filePath);
  if (PREVIEW_MIME[path.extname(filePath).toLowerCase()]) return sendFileInline(res, filePath, fileName);
  if (!isLocalClient(req)) return res.download(filePath, fileName);

  const r = revealInFolder(filePath);
  const body = r.ok
    ? `<h2>📂 已在服务器打开文件目录</h2>
       <p>「${htmlEscape(fileName)}」属于浏览器无法直接预览的类型，已在服务器本机的文件管理器中打开其所在目录。</p>
       <p>目录：</p><code>${htmlEscape(r.dir)}</code>
       <p>如需下载该文件，请使用页面上的「📥 下载」按钮。</p>`
    : `<h2>⚠️ 无法打开目录</h2><p>${htmlEscape(r.message)}</p><code>${htmlEscape(path.dirname(filePath))}</code>`;
  return res.type('html').send(infoPage(r.ok ? '已打开目录' : '无法打开目录', body));
}

module.exports = {
  pad2, normalizeDate, paginate, walkDir, walkDirAsync, encodeName,
  PREVIEW_MIME, sendFileInline, isLocalClient, defaultAllowedRoots,
  revealInFolder, htmlEscape, sendFileMissing, handleFileOpen
};
