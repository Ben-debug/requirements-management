#!/usr/bin/env node
/**
 * 需求单信息管理系统 — 自动化回归测试
 *
 * 运行：npm test   或   node scripts/run-tests.js
 *
 * 覆盖（结合 v2.2.x 功能与 P0/P1 修复）：
 *   A. Basic Auth 鉴权 / CORS
 *   B. /api/config 路由遮蔽修复
 *   C. 重启写 upgrade_logs 移除
 *   D. EADDRINUSE 分支的 url 变量
 *   E. 上传临时文件清理
 *   F. 核心 API 回归
 *
 * 隔离策略：临时 config.json + 临时 SQLite + 随机端口。
 * 不改动 data/config.json 与 data/requirements.db，不占用 3000 端口，
 * 也不删除 public/uploads/ 下的历史文件（只清理本测试新增的）。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const UPLOADS = path.join(ROOT, 'public', 'uploads');
const PASSWORD = 'test-pass-123';
const AUTH = 'Basic ' + Buffer.from('admin:' + PASSWORD).toString('base64');

// ------------------------------------------------------------------
// 轻量 runner
// ------------------------------------------------------------------
const groups = new Map();
function test(group, name, fn) {
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push({ name, fn });
}

let tmpRoot, server, testApp, BASE, db, uploadBaseline;
let orderId, meetingId;

function listUploadFiles() {
  try {
    return fs.readdirSync(UPLOADS, { withFileTypes: true })
      .filter(e => e.isFile()).map(e => e.name).sort();
  } catch (e) { return []; }
}

function assertNoTempLeftover() {
  const added = listUploadFiles().filter(f => !uploadBaseline.includes(f));
  assert.deepEqual(added, [], 'uploads 出现未清理的临时文件: ' + added.join(', '));
}

/** 发起请求；auth 传 null 表示不带认证头 */
async function call(p, opts = {}) {
  const { auth = AUTH, method = 'GET', body, headers = {} } = opts;
  const h = { ...headers };
  if (auth !== null) h.Authorization = auth;
  const r = await fetch(BASE + p, { method, body, headers: h });
  const text = Buffer.from(await r.arrayBuffer()).toString('utf8');
  return {
    status: r.status, headers: r.headers, text,
    json() { return JSON.parse(text); }
  };
}

/** multipart 上传；fields 为附加字段，filename/content 为文件内容 */
function upload(p, fields, filename, content, opts = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', new Blob([content]), filename);
  return call(p, { ...opts, method: 'POST', body: fd });
}

async function setup() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reqmgr-test-'));

  // 预建空库：让 index.js 的「自动迁移旧数据库」跳过，测试完全隔离
  const Database = require('better-sqlite3');
  new Database(path.join(tmpRoot, 'requirements.db')).close();

  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  cfg.paths = {
    data_dir: tmpRoot,
    flow_files_dir: path.join(tmpRoot, 'flow'),
    meeting_files_dir: path.join(tmpRoot, 'meet'),
    service_order_dir: path.join(tmpRoot, 'service'),
    spec_docs_dir: path.join(tmpRoot, 'spec')
  };
  cfg.auth = { password: PASSWORD };
  fs.writeFileSync(path.join(tmpRoot, 'config.json'), JSON.stringify(cfg, null, 2), 'utf8');

  uploadBaseline = listUploadFiles();

  const config = require('../server/config.js');
  config.setConfigDir(tmpRoot);
  require('child_process').exec = () => {};   // 不真的打开浏览器

  // 监听随机端口，避免占用 3000 / 与演示实例冲突
  const express = require('express');
  const origListen = express.application.listen;
  const ready = new Promise(resolve => {
    express.application.listen = function (port, cb) {
      testApp = this;
      server = origListen.call(this, 0, () => { if (cb) cb(); resolve(); });
      return server;
    };
  });

  const origLog = console.log;
  try {
    console.log = () => {};                 // 静音启动横幅
    require('../server/index.js');
    await ready;
  } finally {
    console.log = origLog;
  }

  BASE = 'http://127.0.0.1:' + server.address().port;
  db = require('../server/database.js').getDatabase();
}

async function teardown() {
  // 只清理本测试新增的文件，保留历史遗留文件
  for (const f of listUploadFiles()) {
    if (!uploadBaseline.includes(f)) {
      try { fs.unlinkSync(path.join(UPLOADS, f)); } catch (e) {}
    }
  }
  if (server) {
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
  }
  if (db) { try { db.close(); } catch (e) {} }
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
}

// ==================================================================
// A. 鉴权与 CORS
// ==================================================================
test('A. 鉴权与 CORS', '未认证访问首页返回 401', async () => {
  assert.equal((await call('/', { auth: null })).status, 401);
});
test('A. 鉴权与 CORS', '401 响应带 WWW-Authenticate: Basic', async () => {
  const r = await call('/', { auth: null });
  assert.match(r.headers.get('www-authenticate') || '', /^Basic /);
});
test('A. 鉴权与 CORS', '错误口令返回 401', async () => {
  const bad = 'Basic ' + Buffer.from('admin:wrong').toString('base64');
  assert.equal((await call('/', { auth: bad })).status, 401);
});
test('A. 鉴权与 CORS', '错误用户名返回 401', async () => {
  const bad = 'Basic ' + Buffer.from('someone:' + PASSWORD).toString('base64');
  assert.equal((await call('/', { auth: bad })).status, 401);
});
test('A. 鉴权与 CORS', '正确口令可访问首页', async () => {
  const r = await call('/');
  assert.equal(r.status, 200);
  assert.match(r.text, /需求单信息管理系统/);
});
test('A. 鉴权与 CORS', '未认证访问静态 JS 返回 401（中间件挂在 static 之前）', async () => {
  assert.equal((await call('/js/app.js', { auth: null })).status, 401);
});
test('A. 鉴权与 CORS', '正确口令可访问静态 JS', async () => {
  assert.equal((await call('/js/app.js')).status, 200);
});
test('A. 鉴权与 CORS', '未认证访问 API 返回 401', async () => {
  assert.equal((await call('/api/orders', { auth: null })).status, 401);
});
test('A. 鉴权与 CORS', '正确口令访问 API 返回 200', async () => {
  const r = await call('/api/orders');
  assert.equal(r.status, 200);
  assert.equal(r.json().success, true);
});
test('A. 鉴权与 CORS', '响应不含 Access-Control-Allow-Origin（CORS 已移除）', async () => {
  assert.equal((await call('/', { auth: null })).headers.get('access-control-allow-origin'), null);
});
test('A. 鉴权与 CORS', '口令持久化在 config.json', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'config.json'), 'utf8'));
  assert.equal(cfg.auth.password, PASSWORD);
});

// ==================================================================
// B. 路由遮蔽修复
// ==================================================================
test('B. 路由遮蔽修复', 'GET /api/config/assessment-template 返回模板状态（exists 为布尔值）', async () => {
  const d = (await call('/api/config/assessment-template')).json();
  assert.equal(d.success, true);
  assert.equal(typeof d.data.exists, 'boolean', '不应被 /:category 吞掉');
  assert.equal(d.data.filename, '意向书评估表模板.docx');
});
test('B. 路由遮蔽修复', 'GET /api/config/department 仍走参数路由', async () => {
  const d = (await call('/api/config/department')).json();
  assert.equal(d.success, true);
  assert.ok(Array.isArray(d.data));
  assert.ok(d.data.includes('交易中心'));
});
test('B. 路由遮蔽修复', 'GET /api/config/paths 仍返回路径配置', async () => {
  const d = (await call('/api/config/paths')).json();
  assert.equal(d.success, true);
  assert.equal(d.data.data_dir, tmpRoot);
});
test('B. 路由遮蔽修复', '静态路由注册在 /:category 之前', () => {
  const routes = testApp._router.stack
    .filter(l => l.route && l.route.path && l.route.path.startsWith('/api/config'))
    .map(l => l.route.path);
  const iStatic = routes.indexOf('/api/config/assessment-template');
  const iParam = routes.indexOf('/api/config/:category');
  assert.ok(iStatic >= 0 && iParam >= 0 && iStatic < iParam, '静态路由必须在参数路由之前');
});

// ==================================================================
// C. upgrade_logs 移除
// ==================================================================
test('C. upgrade_logs 移除', '启动后 upgrade_logs 表为空（不再重启即写日志）', () => {
  assert.equal(db.prepare('SELECT COUNT(*) c FROM upgrade_logs').get().c, 0);
});
test('C. upgrade_logs 移除', 'GET /api/upgrade-logs 仍可读取历史', async () => {
  const d = (await call('/api/upgrade-logs')).json();
  assert.equal(d.success, true);
  assert.ok(Array.isArray(d.data));
});
test('C. upgrade_logs 移除', 'index.js 不再包含写日志代码', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  assert.ok(!src.includes('INSERT INTO upgrade_logs'));
  assert.ok(!src.includes('bumpVersion'));
});
test('C. upgrade_logs 移除', 'utils.js 不再导出 bumpVersion', () => {
  assert.equal(require('../server/utils.js').bumpVersion, undefined);
});

// ==================================================================
// D. EADDRINUSE 分支的 url
// ==================================================================
test('D. EADDRINUSE 分支', 'error 回调内 url 在使用前已定义', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const block = src.slice(src.indexOf("server.on('error'"));
  assert.ok(block.includes('const url ='), 'error 回调缺少 url 定义');
  assert.ok(block.indexOf('const url =') < block.indexOf('${url}'));
});
test('D. EADDRINUSE 分支', '模拟 win32 + 端口占用：不抛 ReferenceError 且浏览器 URL 正确', () => {
  const { spawnSync } = require('child_process');
  const script = `
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reqmgr-eaddr-'));
const blocker = net.createServer();
blocker.listen(0, () => {
  const port = blocker.address().port;
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  require('child_process').exec = (cmd) => console.log('EXEC:' + cmd);
  const express = require('express');
  const orig = express.application.listen;
  express.application.listen = function (p, cb) { return orig.call(this, port, cb); };
  const config = require('./server/config.js');
  config.setConfigDir(dir);
  require('./server/index.js');
  setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); }, 800);
});
`;
  const r = spawnSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 0, '子进程异常: ' + out);
  assert.match(out, /端口 3000 已被占用/);
  assert.match(r.stdout || '', /EXEC:cmd \/c start "" "http:\/\/localhost:3000"/);
  assert.ok(!/ReferenceError|url is not defined/.test(out), '不应出现未定义变量错误');
});

// ==================================================================
// E. 上传临时文件清理
// ==================================================================
test('E. 临时文件清理', '准备测试数据：创建需求单与会议', async () => {
  const o = await call('/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_number: 'T01', name: '自动化测试需求单', department: '交易中心' })
  });
  assert.equal(o.json().success, true);
  orderId = o.json().data.id;

  const m = await call('/api/meetings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meeting_name: '自动化测试会议', meeting_date: '2026-01-01' })
  });
  assert.equal(m.json().success, true);
  meetingId = m.json().data.id;
});
test('E. 临时文件清理', 'removeTempFile 对空/不存在路径幂等', () => {
  const { removeTempFile } = require('../server/middleware/upload.js');
  removeTempFile({});
  removeTempFile({ file: { path: path.join(tmpRoot, 'not-exist') } });
});
test('E. 临时文件清理', '流转文件上传缺 file_type → 400 且无残留', async () => {
  const r = await upload('/api/orders/' + orderId + '/files', {}, 'a.pdf', 'hello');
  assert.equal(r.status, 400);
  assertNoTempLeftover();
});
test('E. 临时文件清理', '流转文件上传成功 → 200、文件落盘、无残留', async () => {
  const r = await upload('/api/orders/' + orderId + '/files', { file_type: '需求服务单' }, 'a.pdf', 'hello');
  assert.equal(r.status, 200);
  assert.equal(r.json().success, true);
  assert.ok(fs.readdirSync(path.join(tmpRoot, 'flow')).length > 0, '文件应落到 flow_files_dir');
  assertNoTempLeftover();
});
test('E. 临时文件清理', '会议纪要上传（会议不存在）→ 404 且无残留', async () => {
  const r = await upload('/api/meetings/999999/file', {}, 'm.pdf', 'hello');
  assert.equal(r.status, 404);
  assertNoTempLeftover();
});
test('E. 临时文件清理', '模板上传非 .docx → 400 且无残留', async () => {
  const r = await upload('/api/config/assessment-template', {}, 'a.txt', 'hello');
  assert.equal(r.status, 400);
  assertNoTempLeftover();
});
test('E. 临时文件清理', '模板上传 .docx → 200 且无残留', async () => {
  const r = await upload('/api/config/assessment-template', {}, 'tpl.docx', 'PK');
  assert.equal(r.status, 200);
  assert.ok(fs.existsSync(path.join(tmpRoot, 'templates', '意向书评估表模板.docx')));
  assertNoTempLeftover();
});
test('E. 临时文件清理', 'Excel 导入非 Excel → 400 且无残留（回归）', async () => {
  const r = await upload('/api/import', {}, 'x.xlsx', 'not an excel file');
  assert.equal(r.status, 400);
  assertNoTempLeftover();
});
test('E. 临时文件清理', '全部上传用例结束后 uploads 无新增文件', () => {
  assertNoTempLeftover();
});

// ==================================================================
// F. 核心 API 回归
// ==================================================================
test('F. 核心 API 回归', 'GET /api/orders 返回分页数据', async () => {
  const d = (await call('/api/orders?pageSize=5')).json();
  assert.equal(d.success, true);
  assert.ok(Array.isArray(d.items));
  assert.equal(typeof d.total, 'number');
});
test('F. 核心 API 回归', '需求单详情与创建内容一致', async () => {
  const d = (await call('/api/orders/' + orderId)).json();
  assert.equal(d.success, true);
  assert.equal(d.data.order_number, 'T01');
  assert.ok(Array.isArray(d.data.points));
});
test('F. 核心 API 回归', 'GET /api/config 返回四类配置', async () => {
  const d = (await call('/api/config')).json();
  assert.equal(d.success, true);
  for (const k of ['department', 'version', 'system', 'file_type']) {
    assert.ok(Array.isArray(d.data[k]), k + ' 应为数组');
  }
});
test('F. 核心 API 回归', 'GET /api/files 返回 typeCounts 与 trashCount（v2.2.1）', async () => {
  const d = (await call('/api/files')).json();
  assert.equal(d.success, true);
  assert.equal(typeof d.typeCounts, 'object');
  assert.equal(typeof d.trashCount, 'number');
});
test('F. 核心 API 回归', 'GET /api/specs/tree 空库不报错', async () => {
  const r = await call('/api/specs/tree');
  assert.equal(r.status, 200);
  assert.equal(r.json().success, true);
});
test('F. 核心 API 回归', 'GET /api/export 返回 xlsx', async () => {
  const r = await call('/api/export');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /spreadsheet|octet-stream/);
});
test('F. 核心 API 回归', 'initDatabase 重复执行幂等', () => {
  require('../server/schema.js').initDatabase(db);
});

// ==================================================================
// G. 文件内联预览
// ==================================================================
let pdfFileId, docFileId;

test('G. 文件内联预览', '准备可预览（PDF）与不可预览（docx）测试文件', async () => {
  assert.equal((await upload('/api/orders/' + orderId + '/files',
    { file_type: '需求服务单' }, 'preview.pdf', '%PDF-1.4 test')).status, 200);
  assert.equal((await upload('/api/orders/' + orderId + '/files',
    { file_type: '项目需求书' }, 'no-preview.docx', 'PK docx')).status, 200);
  pdfFileId = db.prepare("SELECT id FROM flow_files WHERE order_id=? AND file_path LIKE '%.pdf' ORDER BY id DESC LIMIT 1").get(orderId).id;
  docFileId = db.prepare("SELECT id FROM flow_files WHERE order_id=? AND file_path LIKE '%.docx' ORDER BY id DESC LIMIT 1").get(orderId).id;
});
test('G. 文件内联预览', 'PDF 预览返回 inline + application/pdf + nosniff', async () => {
  const r = await call('/api/files/' + pdfFileId + '/preview');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') || '', /^inline/);
  assert.match(r.headers.get('content-type') || '', /application\/pdf/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.text, /^%PDF/);
});
test('G. 文件内联预览', '不可预览类型（docx）回退为附件下载', async () => {
  const r = await call('/api/files/' + docFileId + '/preview');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') || '', /^attachment/);
});
test('G. 文件内联预览', 'download 接口仍是 attachment（回归）', async () => {
  const r = await call('/api/files/' + pdfFileId + '/download');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') || '', /^attachment/);
});
test('G. 文件内联预览', '回收站文件不可预览', async () => {
  db.prepare("UPDATE flow_files SET deleted_at=datetime('now','localtime') WHERE id=?").run(docFileId);
  const r = await call('/api/files/' + docFileId + '/preview');
  db.prepare('UPDATE flow_files SET deleted_at=NULL WHERE id=?').run(docFileId);
  assert.equal(r.status, 404);
});
test('G. 文件内联预览', '不存在的文件返回 404', async () => {
  assert.equal((await call('/api/files/999999/preview')).status, 404);
});
test('G. 文件内联预览', 'fileOpenInfo 按扩展名正确分流（前端纯函数）', () => {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'features', 'renderers.js'), 'utf8');
  const ctx = { esc: s => s };
  vm.runInNewContext(src, ctx);
  assert.equal(ctx.fileOpenInfo({ id: 1, original_name: 'a.pdf' }).url, '/api/files/1/preview');
  assert.equal(ctx.fileOpenInfo({ id: 2, original_name: 'a.PNG' }).url, '/api/files/2/preview');
  assert.equal(ctx.fileOpenInfo({ id: 3, original_name: 'a.docx' }).url, '/api/files/3/open');
  assert.equal(ctx.fileOpenInfo({ id: 4, original_name: 'a.zip' }).url, '/api/files/4/open');
});
test('G. 文件内联预览', '两个文件页面都保留下载按钮', () => {
  const r = fs.readFileSync(path.join(ROOT, 'public', 'js', 'features', 'renderers.js'), 'utf8');
  const f = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'files.js'), 'utf8');
  for (const src of [r, f]) {
    assert.ok(src.includes("/download"), '应保留下载入口');
  }
  assert.ok(f.includes('fileOpenInfo(f)'), '流转文件页应使用统一的打开方式判断');
});

// ==================================================================
// H. 其余模块内联预览（会议纪要 / 需规文档）
// ==================================================================
let specPdfId, specDocxId;

test('H. 其余模块预览', '准备会议纪要 PDF 与需规文档（PDF / docx）', async () => {
  assert.equal((await upload('/api/meetings/' + meetingId + '/file', {}, 'minutes.pdf', '%PDF-1.4 minutes')).status, 200);

  const pdfPath = path.join(tmpRoot, 'spec-demo.pdf');
  const docxPath = path.join(tmpRoot, 'spec-demo.docx');
  fs.writeFileSync(pdfPath, '%PDF-1.4 spec');
  fs.writeFileSync(docxPath, 'PK spec');
  specPdfId = db.prepare("INSERT INTO spec_documents (version,file_name,file_path,doc_type) VALUES (?,?,?,'spec_doc')")
    .run('2026年端午版本', '需规预览.pdf', pdfPath).lastInsertRowid;
  specDocxId = db.prepare("INSERT INTO spec_documents (version,file_name,file_path,doc_type) VALUES (?,?,?,'spec_doc')")
    .run('2026年端午版本', '需规不可预览.docx', docxPath).lastInsertRowid;
});
test('H. 其余模块预览', '会议纪要 PDF 走内联预览', async () => {
  const r = await call('/api/meetings/' + meetingId + '/file/preview');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') || '', /^inline/);
  assert.match(r.headers.get('content-type') || '', /application\/pdf/);
});
test('H. 其余模块预览', '会议纪要 download 仍为附件', async () => {
  const r = await call('/api/meetings/' + meetingId + '/file/download');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') || '', /^attachment/);
});
test('H. 其余模块预览', '需规文档 PDF 走内联预览', async () => {
  const r = await call('/api/specs/' + specPdfId + '/preview');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') || '', /^inline/);
  assert.match(r.headers.get('content-type') || '', /application\/pdf/);
});
test('H. 其余模块预览', '需规文档 docx 回退为附件下载', async () => {
  const r = await call('/api/specs/' + specDocxId + '/preview');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') || '', /^attachment/);
});
test('H. 其余模块预览', '需规文档 download 仍为附件', async () => {
  const r = await call('/api/specs/' + specPdfId + '/download');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') || '', /^attachment/);
});
test('H. 其余模块预览', '不存在的需规文档 / 会议返回 404', async () => {
  assert.equal((await call('/api/specs/999999/preview')).status, 404);
  assert.equal((await call('/api/meetings/999999/file/preview')).status, 404);
});
test('H. 其余模块预览', 'fileOpenInfo 支持自定义端点（会议 / 需规）', () => {
  const vm = require('vm');
  const ctx = { esc: s => s };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'features', 'renderers.js'), 'utf8'), ctx);
  assert.equal(ctx.fileOpenInfo({ id: 3, file_name: 'a.pdf' }, '/api/meetings/3/file').url, '/api/meetings/3/file/preview');
  assert.equal(ctx.fileOpenInfo({ id: 5, file_name: 'a.docx' }, '/api/specs/5').url, '/api/specs/5/open');
  assert.equal(ctx.fileOpenInfo({ id: 5, file_name: 'a.pdf' }, '/api/specs/5').downloadUrl, '/api/specs/5/download');
});
test('H. 其余模块预览', 'meetings.js / specs.js 已改用统一分流且保留下载入口', () => {
  const m = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'meetings.js'), 'utf8');
  const s = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'specs.js'), 'utf8');
  assert.ok(m.includes('fileOpenInfo('), '会议页应使用统一分流');
  assert.ok(s.includes('fileOpenInfo('), '需规页应使用统一分流');
  assert.ok(!m.includes('/file/download"'), '会议页不应残留硬编码下载链接');
  assert.ok(!s.includes('/download" class="file-link"'), '需规页不应残留硬编码下载链接');
  assert.ok(m.includes('open.downloadUrl') && s.includes('open.downloadUrl'), '应保留下载入口');
});
test('H. 其余模块预览', '导入模板 / 导出仍保持下载语义', async () => {
  const tpl = await call('/api/import/template');
  assert.equal(tpl.status, 200);
  assert.match(tpl.headers.get('content-disposition') || '', /^attachment/);
  const exp = await call('/api/export');
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition') || '', /^attachment/);
});

// ==================================================================
// I. 智能打开 / 文件缺失友好提示
// ==================================================================
let missingFileId;

/** 拦截 spawn，避免测试时真的弹出文件管理器窗口 */
async function withSpawnStub(fn) {
  const cp = require('child_process');
  const orig = cp.spawn;
  const spawned = [];
  cp.spawn = (cmd, args) => { spawned.push([cmd, args]); return { unref() {} }; };
  try { return await fn(spawned); }
  finally { cp.spawn = orig; }
}

test('I. 智能打开', '准备一条磁盘文件缺失的记录', () => {
  const p = path.join(tmpRoot, 'gone.docx');
  missingFileId = db.prepare('INSERT INTO flow_files (order_id,file_type,original_name,stored_name,file_path) VALUES (?,?,?,?,?)')
    .run(orderId, '需求服务单', '已丢失文件.docx', '已丢失文件.docx', p).lastInsertRowid;
});
test('I. 智能打开', '文件缺失时 download 返回友好 HTML（含文件名与本地路径）', async () => {
  const r = await call('/api/files/' + missingFileId + '/download');
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type') || '', /text\/html/);
  assert.match(r.text, /文件不存在/);
  assert.match(r.text, /已丢失文件\.docx/);
  assert.match(r.text, /gone\.docx/);
});
test('I. 智能打开', '文件缺失时 open / preview 同样是友好 HTML', async () => {
  for (const ep of ['open', 'preview']) {
    const r = await call('/api/files/' + missingFileId + '/' + ep);
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type') || '', /text\/html/);
    assert.match(r.text, /文件不存在/);
  }
});
test('I. 智能打开', '本机 + 不可预览文件 → 打开所在目录（触发 spawn，返回提示页）', async () => {
  await withSpawnStub(async spawned => {
    const r = await call('/api/files/' + docFileId + '/open');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/html/);
    assert.match(r.text, /已在服务器打开文件目录/);
    assert.equal(spawned.length, 1, '应调用一次系统命令打开目录');
  });
});
test('I. 智能打开', '本机 + 可预览文件 → 仍内联打开', async () => {
  const r = await call('/api/files/' + pdfFileId + '/open');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') || '', /^inline/);
});
test('I. 智能打开', '会议纪要 / 需规文档的 open 端点同样工作', async () => {
  await withSpawnStub(async () => {
    const a = await call('/api/meetings/' + meetingId + '/file/open');
    assert.equal(a.status, 200);
    assert.match(a.headers.get('content-disposition') || '', /^inline/);
    const b = await call('/api/specs/' + specDocxId + '/open');
    assert.equal(b.status, 200);
    assert.match(b.text, /已在服务器打开文件目录/);
  });
});
test('I. 智能打开', '远程 + 不可预览文件 → 直接下载（不打开目录）', () => {
  const utils = require('../server/utils.js');
  const p = path.join(tmpRoot, 'remote-demo.docx');
  fs.writeFileSync(p, 'PK remote');
  const calls = [];
  const fakeRes = {
    download(fp, name) { calls.push(['download', fp, name]); },
    type() { return this; }, status() { return this; }, send() { calls.push(['send']); },
    setHeader() {}, sendFile() {}
  };
  utils.handleFileOpen({ socket: { remoteAddress: '203.0.113.77' } }, fakeRes, p, 'remote.docx');
  assert.deepEqual(calls[0], ['download', p, 'remote.docx']);
});
test('I. 智能打开', 'isLocalClient 正确识别本机 / 远程', () => {
  const u = require('../server/utils.js');
  assert.equal(u.isLocalClient({ socket: { remoteAddress: '127.0.0.1' } }), true);
  assert.equal(u.isLocalClient({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
  assert.equal(u.isLocalClient({ socket: { remoteAddress: '::1' } }), true);
  assert.equal(u.isLocalClient({ socket: { remoteAddress: '203.0.113.77' } }), false);
});
test('I. 智能打开', '打开目录限制在允许根目录内 + HTML 转义', () => {
  const u = require('../server/utils.js');
  assert.equal(u.revealInFolder('/etc/passwd').ok, false);
  assert.match(u.htmlEscape('<script>alert(1)</script>'), /&lt;script&gt;/);
});

// ------------------------------------------------------------------
(async () => {
  let passed = 0, failed = 0;
  console.log('需求单信息管理系统 — 自动化回归测试\n');
  await setup();
  for (const [group, list] of groups) {
    console.log(`── ${group} ──`);
    for (const c of list) {
      try { await c.fn(); console.log('  ✅ ' + c.name); passed++; }
      catch (e) { console.log('  ❌ ' + c.name + '\n     ' + e.message); failed++; }
    }
  }
  await teardown();
  console.log(`\n结果：${passed} 通过 / ${failed} 失败 / 共 ${passed + failed} 项`);
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error('测试框架异常:', e);
  await teardown().catch(() => {});
  process.exit(1);
});
