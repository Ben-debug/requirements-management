#!/usr/bin/env node
/**
 * 我的工作平台 — 自动化回归测试
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
  const { auth = AUTH, method = 'GET', body, headers = {}, redirect } = opts;
  const h = { ...headers };
  if (auth !== null) h.Authorization = auth;
  const r = await fetch(BASE + p, { method, body, headers: h, ...(redirect ? { redirect } : {}) });
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
test('A. 鉴权与 CORS', '不发送 WWW-Authenticate（不弹浏览器原生登录框）', async () => {
  const r = await call('/', { auth: null });
  assert.equal(r.headers.get('www-authenticate'), null);
});
test('A. 鉴权与 CORS', '浏览器页面请求未登录时跳转 /login', async () => {
  const r = await call('/', { auth: null, headers: { Accept: 'text/html' }, redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');
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
  assert.match(r.text, /我的工作平台/);
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

// ==================================================================
// J. 待排期点按需加载（部门 tab + 分页）
// ==================================================================
let uDeptOrderId, uPointIds = [];

test('J. 待排期点按需加载', '准备多部门待排期测试数据', async () => {
  const mkOrder = async (num, dept) => {
    const r = await call('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_number: num, name: '待排期测试', department: dept })
    });
    assert.equal(r.json().success, true);
    return r.json().data.id;
  };
  uDeptOrderId = await mkOrder('U01', '清算部');
  const noDeptOrderId = await mkOrder('U02', '');

  const mkPoint = async (oid, desc) => {
    const r = await call('/api/orders/' + oid + '/points', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc })
    });
    assert.equal(r.json().success, true);
    return r.json().data.id;
  };
  uPointIds = [
    await mkPoint(uDeptOrderId, '部门点1'),
    await mkPoint(uDeptOrderId, '部门点2'),
    await mkPoint(noDeptOrderId, '未指定点')
  ];
});
test('J. 待排期点按需加载', '无参数仍返回 data 数组 + 计数与部门列表', async () => {
  const d = (await call('/api/unscheduled-points')).json();
  assert.equal(d.success, true);
  assert.ok(Array.isArray(d.data));
  assert.equal(d.data.length, 3);
  assert.equal(d.allCount, 3);
  assert.equal(d.departmentCounts['清算部'], 2);
  assert.equal(d.departmentCounts['未指定'], 1);
  assert.ok(Array.isArray(d.filters.departments));
});
test('J. 待排期点按需加载', '按部门过滤与未指定桶', async () => {
  const a = (await call('/api/unscheduled-points?department=' + encodeURIComponent('清算部'))).json();
  assert.equal(a.total, 2);
  assert.ok(a.data.every(p => p.department === '清算部'));
  const b = (await call('/api/unscheduled-points?department=' + encodeURIComponent('未指定'))).json();
  assert.equal(b.total, 1);
  assert.ok(b.data.every(p => !p.department));
});
test('J. 待排期点按需加载', '分页生效且计数不受分页影响', async () => {
  const d = (await call('/api/unscheduled-points?page=2&pageSize=1')).json();
  assert.equal(d.data.length, 1);
  assert.equal(d.page, 2);
  assert.equal(d.total, 3);
  assert.equal(d.totalPages, 3);
  assert.equal(d.allCount, 3);
});
test('J. 待排期点按需加载', '批量保存后对应需求点移出待排期列表', async () => {
  const r = await call('/api/meetings/' + meetingId + '/schedules/batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schedules: [{
      order_id: uDeptOrderId, point_id: uPointIds[0], system: '清算系统', version: 'v1'
    }] })
  });
  assert.equal(r.json().success, true);
  const d = (await call('/api/unscheduled-points')).json();
  assert.equal(d.total, 2);
  assert.ok(!d.data.some(p => p.id === uPointIds[0]));
});

// ==================================================================
// K. 需规扫描分类（三类归档 / 唯一记录 / 覆盖旧记录）
// ==================================================================
const scanVersion = '扫描测试版本';
test('K. 需规扫描分类', '准备版本目录文件（纪要 / word / 签字扫描件 / 扩展名）', () => {
  const verDir = path.join(tmpRoot, 'spec', scanVersion);
  fs.mkdirSync(verDir, { recursive: true });
  fs.writeFileSync(path.join(verDir, '需求规格评审会.docx'), 'minutes');
  fs.writeFileSync(path.join(verDir, '清算系统需求规格.docx'), 'word');
  fs.writeFileSync(path.join(verDir, '清算系统需求规格.pdf'), 'pdf');
  fs.writeFileSync(path.join(verDir, '季度报表.xlsx'), 'excel');
  fs.writeFileSync(path.join(verDir, '方案汇报.pptx'), 'ppt');
  const legacyDir = path.join(tmpRoot, 'spec', '旧版本', 'meetings');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, '旧版评审纪要.pdf'), 'legacy minutes');
});
test('K. 需规扫描分类', '扫描后仅三类分支且每条记录带归档类别', async () => {
  const r = await call('/api/specs/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: scanVersion })
  });
  assert.equal(r.json().success, true);
  const d = (await call('/api/specs/tree')).json();
  const entry = d.data.find(v => v.version === scanVersion);
  assert.ok(entry, '树中应包含扫描版本');
  assert.equal(entry.meetings.length, 1, '纪要 1 份');
  assert.equal(entry.wordVersions.length, 3, 'word版本含 docx/xlsx/pptx 共 3 个');
  assert.equal(entry.signedScans.length, 1, '签字扫描件 1 份 (PDF)');
  assert.equal(entry.documents.length, 0, '层级树分支已移除');
  assert.ok(entry.wordVersions.some(x => x.file_name.endsWith('.xlsx')));
  assert.ok(entry.wordVersions.some(x => x.file_name.endsWith('.pptx')));
  assert.ok(entry.signedScans[0].file_name.endsWith('.pdf'));
  const recs = db.prepare('SELECT file_name, archive_category FROM spec_documents WHERE version=?').all(scanVersion);
  assert.equal(recs.length, 5, '每个文件仅一条记录');
  assert.equal(recs.filter(x => x.archive_category === 'word_version').length, 3);
  assert.equal(recs.filter(x => x.archive_category === 'signed_scan').length, 1);
  assert.equal(recs.filter(x => x.archive_category === 'meeting_minutes').length, 1);
});
test('K. 需规扫描分类', '同文件已有记录时按新规则覆盖，仍只保留唯一一条', async () => {
  const v = '覆盖测试版本';
  const verDir = path.join(tmpRoot, 'spec', v);
  fs.mkdirSync(verDir, { recursive: true });
  const filePath = path.join(verDir, '测试文档.docx');
  fs.writeFileSync(filePath, 'draft');
  await call('/api/specs/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: v })
  });
  let rec = db.prepare('SELECT id, archive_category FROM spec_documents WHERE version=?').get(v);
  assert.equal(rec.archive_category, 'word_version');

  // 模拟历史遗留：同一路径误存为「评审会议纪要」类别的旧记录
  db.prepare('DELETE FROM spec_documents WHERE id=?').run(rec.id);
  db.prepare("INSERT INTO spec_documents (version, file_name, file_path, doc_type, archive_category, notes) VALUES (?,?,?,'meeting_minutes','meeting_minutes',?)")
    .run(v, '测试文档.docx', filePath, '测试文档');

  await call('/api/specs/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: v })
  });
  const e = (await call('/api/specs/tree?version=' + encodeURIComponent(v))).json().data[0];
  assert.equal(e.meetings.length, 0, '旧纪要类别记录已被覆盖');
  assert.equal(e.wordVersions.length, 1, '文件按新规则归入 word版本');
  const recs = db.prepare('SELECT id, file_name, archive_category FROM spec_documents WHERE version=?').all(v);
  assert.equal(recs.length, 1, '仅保留一条归档记录');
  assert.equal(recs[0].archive_category, 'word_version');
  assert.equal(recs[0].file_name, '测试文档.docx');
});
test('K. 需规扫描分类', '手动匹配在重新扫描后按新规则覆盖', async () => {
  const v = '手动覆盖测试版本';
  const verDir = path.join(tmpRoot, 'spec', v);
  fs.mkdirSync(verDir, { recursive: true });
  fs.writeFileSync(path.join(verDir, '清算系统手动匹配.docx'), 'doc');
  await call('/api/specs/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: v })
  });
  let rec = db.prepare('SELECT id, auto_matched FROM spec_documents WHERE version=?').get(v);
  assert.equal(rec.auto_matched, 1, '首次扫描自动匹配到清算系统');
  const mr = await call('/api/specs/' + rec.id + '/match', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systems: [] })
  });
  assert.equal(mr.json().success, true);
  rec = db.prepare('SELECT id, auto_matched FROM spec_documents WHERE version=?').get(v);
  assert.equal(rec.auto_matched, 0, '手动匹配已生效');
  await call('/api/specs/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: v })
  });
  rec = db.prepare('SELECT id, auto_matched, archive_category FROM spec_documents WHERE version=?').get(v);
  assert.equal(rec.auto_matched, 1, '重新扫描后按新规则覆盖手动匹配');
  assert.equal(rec.archive_category, 'word_version');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM spec_documents WHERE version=?').get(v).c, 1);
});
test('K. 需规扫描分类', '旧 meetings/ 子目录仍识别为纪要', async () => {
  await call('/api/specs/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: '旧版本' })
  });
  const d = (await call('/api/specs/tree')).json();
  const entry = d.data.find(v => v.version === '旧版本');
  assert.ok(entry);
  assert.equal(entry.meetings.length, 1);
  assert.equal(entry.documents.length, 0);
});

// ==================================================================
// L. 登录页与会话
test('K. 需规扫描分类', '扫描清理磁盘文件已不存在的失效记录（含关联点级联删除）', async () => {
  const v = '失效清理测试版本';
  const verDir = path.join(tmpRoot, 'spec', v);
  fs.mkdirSync(verDir, { recursive: true });
  const staleFile = path.join(verDir, '清算系统即将删除.docx');
  fs.writeFileSync(staleFile, 'stale');
  fs.writeFileSync(path.join(verDir, '保留文档.docx'), 'keep');
  await call('/api/specs/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: v })
  });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM spec_documents WHERE version=?').get(v).c, 2);
  const staleRec = db.prepare("SELECT id, auto_matched FROM spec_documents WHERE file_name='清算系统即将删除.docx'").get();
  assert.equal(staleRec.auto_matched, 1);
  // 手动挂一条关联点，验证删除失效记录时外键级联生效
  const anyPoint = db.prepare('SELECT id FROM requirement_points LIMIT 1').get();
  db.prepare('INSERT OR IGNORE INTO spec_document_points (spec_id, point_id) VALUES (?,?)').run(staleRec.id, anyPoint.id);
  const pointCount = db.prepare('SELECT COUNT(*) c FROM spec_document_points WHERE spec_id=?').get(staleRec.id).c;
  assert.ok(pointCount > 0, '失效记录应有关联需求点，用于验证级联删除');

  fs.unlinkSync(staleFile);
  const r = await call('/api/specs/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: v })
  });
  assert.equal(r.json().stale_count, 1, '应报告清理 1 条失效记录');
  assert.match(r.json().message, /失效记录/);
  const recs = db.prepare('SELECT file_name FROM spec_documents WHERE version=?').all(v);
  assert.equal(recs.length, 1, '仅保留仍在磁盘上的文档');
  assert.equal(recs[0].file_name, '保留文档.docx');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM spec_document_points WHERE spec_id=?').get(staleRec.id).c, 0, '失效记录关联点应级联删除');
});
test('K. 需规扫描分类', '目录内文件全部删除后仍能清理失效记录', async () => {
  const v = '全量失效清理版本';
  const verDir = path.join(tmpRoot, 'spec', v);
  fs.mkdirSync(verDir, { recursive: true });
  const onlyFile = path.join(verDir, '唯一文档.docx');
  fs.writeFileSync(onlyFile, 'only');
  await call('/api/specs/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: v })
  });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM spec_documents WHERE version=?').get(v).c, 1);
  fs.unlinkSync(onlyFile);
  const r = await call('/api/specs/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: v })
  });
  assert.equal(r.json().success, true);
  assert.equal(r.json().stale_count, 1, '无文件时也应清理失效记录');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM spec_documents WHERE version=?').get(v).c, 0);
  const entry = (await call('/api/specs/tree')).json().data.find(x => x.version === v);
  assert.equal(entry, undefined, '该版本已无任何归档记录，不再出现在树中');
});

// ==================================================================
let loginCookie, changedCookie, restoredCookie;
const jsonHeaders = { 'Content-Type': 'application/json' };

test('L. 登录页与会话', '登录页免认证可访问', async () => {
  const r = await call('/login', { auth: null });
  assert.equal(r.status, 200);
  assert.match(r.text, /id="login-form"/);
});
test('L. 登录页与会话', '状态接口返回 needsSetup=false', async () => {
  const d = (await call('/api/auth/status', { auth: null })).json();
  assert.equal(d.success, true);
  assert.equal(d.data.needsSetup, false);
  assert.equal(d.data.username, 'admin');
});
test('L. 登录页与会话', '错误凭据返回 401 且无挑战头', async () => {
  const r = await call('/api/auth/login', {
    auth: null, method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ username: 'admin', password: 'wrong' })
  });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('www-authenticate'), null);
  assert.equal(r.json().success, false);
});
test('L. 登录页与会话', '正确登录下发 8 小时 HttpOnly Cookie', async () => {
  const r = await call('/api/auth/login', {
    auth: null, method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ username: 'admin', password: PASSWORD })
  });
  assert.equal(r.status, 200);
  assert.equal(r.json().success, true);
  const sc = r.headers.get('set-cookie') || '';
  loginCookie = sc.split(';')[0];
  assert.match(loginCookie, /^session=/);
  assert.match(sc, /HttpOnly/i);
  assert.match(sc, /SameSite=Lax/i);
  assert.match(sc, /Max-Age=28800/);
  assert.match(sc, /Path=\//);
  assert.doesNotMatch(sc, /Secure/i);
});
test('L. 登录页与会话', '会话 Cookie 可访问受保护资源', async () => {
  assert.equal((await call('/', { auth: null, headers: { Cookie: loginCookie } })).status, 200);
});
test('L. 登录页与会话', '过期签名 Token 被拒绝', async () => {
  const { createSessionToken } = require('../server/middleware/auth');
  const bad = 'session=' + createSessionToken(PASSWORD, Math.floor(Date.now() / 1000) - 10);
  assert.equal((await call('/api/orders', { auth: null, headers: { Cookie: bad } })).status, 401);
});
test('L. 登录页与会话', 'logout 清除 Cookie', async () => {
  const r = await call('/api/auth/logout', { auth: null, method: 'POST', headers: { Cookie: loginCookie } });
  assert.equal(r.json().success, true);
  const sc = r.headers.get('set-cookie') || '';
  assert.match(sc, /session=;/);
  assert.match(sc, /Max-Age=0|01 Jan 1970/i);
});
test('L. 登录页与会话', '修改口令后旧会话失效、新会话有效，随后恢复原口令', async () => {
  const NEW = 'new-pass-456';
  const r = await call('/api/auth/password', {
    auth: null, method: 'POST', headers: { ...jsonHeaders, Cookie: loginCookie },
    body: JSON.stringify({ current: PASSWORD, password: NEW, confirm: NEW })
  });
  assert.equal(r.json().success, true);
  changedCookie = (r.headers.get('set-cookie') || '').split(';')[0];
  assert.equal((await call('/api/orders', { auth: null, headers: { Cookie: loginCookie } })).status, 401);
  assert.equal((await call('/api/orders', { auth: null, headers: { Cookie: changedCookie } })).status, 200);
  const back = await call('/api/auth/password', {
    auth: null, method: 'POST', headers: { ...jsonHeaders, Cookie: changedCookie },
    body: JSON.stringify({ current: NEW, password: PASSWORD, confirm: PASSWORD })
  });
  assert.equal(back.json().success, true);
  restoredCookie = (back.headers.get('set-cookie') || '').split(';')[0];
  assert.equal((await call('/api/orders', { auth: null, headers: { Cookie: restoredCookie } })).status, 200);
});
test('L. 登录页与会话', '当前口令错误时不修改', async () => {
  const r = await call('/api/auth/password', {
    auth: null, method: 'POST', headers: { ...jsonHeaders, Cookie: restoredCookie },
    body: JSON.stringify({ current: 'wrong', password: 'abcdef', confirm: 'abcdef' })
  });
  assert.equal(r.status, 400);
  assert.equal((await call('/api/orders', { auth: null, headers: { Cookie: restoredCookie } })).status, 200);
});
test('L. 登录页与会话', '首次设置流程（清空口令后设置）', async () => {
  const config = require('../server/config.js');
  config.setAuthPassword('');
  try {
    const st = (await call('/api/auth/status', { auth: null })).json();
    assert.equal(st.data.needsSetup, true);
    const r = await call('/api/auth/setup', {
      auth: null, method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ password: 'setup-pass-123', confirm: 'setup-pass-123' })
    });
    assert.equal(r.json().success, true);
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    assert.equal((await call('/api/orders', { auth: null, headers: { Cookie: cookie } })).status, 200);
    const again = await call('/api/auth/setup', {
      auth: null, method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ password: 'another-pass', confirm: 'another-pass' })
    });
    assert.equal(again.status, 409);
  } finally { config.setAuthPassword(PASSWORD); }
});
test('L. 登录页与会话', '配置接口不泄露 auth 口令', async () => {
  const d = (await call('/api/config')).json();
  assert.equal(d.data.auth, undefined);
  const c = (await call('/api/config/auth')).json();
  assert.deepEqual(c.data, []);
});
test('L. 登录页与会话', '启动代码不再打印口令、不再随机生成、不发挑战头', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  assert.doesNotMatch(src, /WWW-Authenticate/);
  assert.doesNotMatch(src, /randomBytes/);
  assert.doesNotMatch(src, /口令:\s*\$\{/);
  const login = fs.readFileSync(path.join(ROOT, 'public', 'login.html'), 'utf8');
  assert.match(login, /首次使用/);
});

// ==================================================================
// M. 列表首屏与配置页 UI 优化
// ==================================================================
test('M. UI 优化', '默认不分组时正常分页，按部门分组仍返回 grouped', async () => {
  const plain = (await call('/api/orders?group_by=none&pageSize=10')).json();
  assert.equal(plain.success, true);
  assert.ok(!plain.grouped, '不分组时不应返回 grouped');
  assert.ok(plain.items.length <= 10, '不分组时每页不超过 10 条');
  const grouped = (await call('/api/orders?group_by=department')).json();
  assert.ok(grouped.grouped && typeof grouped.grouped === 'object', '按部门分组时返回 grouped');
});
test('M. UI 优化', '列表行不含 background 大字段，会议下拉数据仍是数组', async () => {
  const d = (await call('/api/orders?pageSize=10')).json();
  d.items.forEach(o => assert.ok(!Object.prototype.hasOwnProperty.call(o, 'background'), '列表行不应包含 background'));
  assert.ok(Array.isArray(d.filters.meetings), 'filters.meetings 应为数组');
});
test('M. UI 优化', '筛选栏两行带标签，默认不分组且重置回不分组', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const orders = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'orders.js'), 'utf8');
  const ordersPage = html.slice(html.indexOf('id="page-orders"'), html.indexOf('id="page-meetings"'));
  assert.ok(ordersPage.includes('class="filter-bar"') && !ordersPage.includes('class="filter-bar" style='), '需求单筛选栏样式应移到 CSS');
  assert.ok((html.match(/class="filter-field"/g) || []).length >= 8, '筛选项应带标签');
  assert.match(html, /<option value="none" selected>不分组<\/option>/);
  assert.ok(orders.includes(".value = 'none'"), '重置应回到不分组');
  assert.match(orders, /renderPagination\('orders-pagination', r, 'gotoOrderPage', 'pagination-page-size'\)/);
});
test('M. UI 优化', '分页器生成带 id 的每页条数下拉', () => {
  const vm = require('vm');
  let html = '';
  const container = {
    set innerHTML(v) { html = v; },
    get innerHTML() { return html; },
    querySelector() { return { value: '' }; }
  };
  const ctx = { document: { getElementById: () => container } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'features', 'renderers.js'), 'utf8'), ctx);
  ctx.renderPagination('orders-pagination', { total: 25, totalPages: 3, page: 1, pageSize: 10 }, 'gotoOrderPage', 'pagination-page-size');
  assert.match(html, /id="pagination-page-size"/);
});
test('M. UI 优化', '参数配置拆为业务参数 / 系统配置两个 Tab', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const cfg = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'config.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  assert.ok(html.includes("switchConfigTab('config-business')"));
  assert.ok(html.includes("switchConfigTab('config-system')"));
  assert.ok(html.indexOf('config-body-template') < html.indexOf('id="tab-config-system"'), '模板应在业务 Tab');
  assert.ok(html.indexOf('id="tab-config-system"') < html.indexOf('config-body-paths'), '路径应在系统 Tab');
  assert.ok(html.indexOf('config-body-password') > html.indexOf('id="tab-config-system"'), '口令应在系统 Tab');
  assert.ok(cfg.includes('function switchConfigTab'));
  assert.ok(app.includes('window.switchConfigTab = switchConfigTab'));
});

// ==================================================================
// N. 品牌与文档查询 UI
// ==================================================================
test('N. 品牌与文档查询 UI', '系统名称已全面改为我的工作平台 / MY WORKSPACE', () => {
  const files = ['public/index.html', 'public/login.html', 'start.bat', 'server/index.js', 'CLAUDE.md'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(src.includes('我的工作平台'), f + ' 应包含新系统名');
    assert.ok(!src.includes('需求单信息管理系统'), f + ' 不应残留旧系统名');
  }
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const login = fs.readFileSync(path.join(ROOT, 'public', 'login.html'), 'utf8');
  assert.match(html, /<title>我的工作平台<\/title>/);
  assert.ok(html.includes('<span>MY WORKSPACE</span>'));
  assert.match(login, /<title>登录 - 我的工作平台<\/title>/);
  assert.ok(login.includes('MY WORKSPACE'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.description, '我的工作平台');
  assert.ok(pkg.scripts.build.includes('Release/我的工作平台.exe'));
});
test('N. 品牌与文档查询 UI', 'footer 与登录页均有本地部署不联网小字', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
  assert.ok(footer.includes('本地部署') && footer.includes('不联网'), 'footer 应有本地部署小字');
  const login = fs.readFileSync(path.join(ROOT, 'public', 'login.html'), 'utf8');
  assert.ok(login.includes('本地部署') && login.includes('不联网'), '登录页应有本地部署小字');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.ok(css.includes('.app-footer .footer-note'));
});
test('N. 品牌与文档查询 UI', '登录页说明文字排在卡片下方而非并排', () => {
  const login = fs.readFileSync(path.join(ROOT, 'public', 'login.html'), 'utf8');
  assert.ok(login.indexOf('class="login-wrap"') < login.indexOf('class="login-card"'), '应有外层列布局容器');
  assert.ok(/<\/div>\s*<div class="footer-note">🔒 本地部署/.test(login), '卡片下方应是本地部署小字');
  assert.ok(login.indexOf('本地部署') < login.indexOf('登录会话有效期'), '说明文字应纵向排列在卡片下方');
  assert.ok(login.includes('.login-wrap'));
  assert.ok(login.includes('登录会话有效期 8 小时'));
  assert.ok(login.includes('id="login-form"') && login.includes('首次使用'));
});
test('N. 品牌与文档查询 UI', '文档查询列表为带归档类别列的表格并使用共享分页', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const tabStart = html.indexOf('id="tab-spec-query"');
  const tab = html.slice(tabStart, tabStart + 2500);
  assert.ok(tab.includes('<table') && tab.includes('<thead>'), '文档查询应为语义化表格');
  for (const label of ['文件名', '归档类别', '匹配系统', '关联需求单', '关联部门', '匹配方式', '操作']) {
    assert.ok(tab.includes('<th>' + label + '</th>'), '缺少表头列：' + label);
  }
  assert.match(tab, /<tbody id="sq-results">/);
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'specs.js'), 'utf8');
  assert.ok(!src.includes('SPEC_QUERY_PAGE_SIZE'));
  assert.ok(src.includes("renderPagination('sq-pagination', d, 'loadSpecQuery', 'sq-page-size')"));
  assert.ok(src.includes("word_version: 'word版本'") && src.includes("signed_scan: '签字扫描件'"));
  assert.ok(src.includes('class="query-row"'));
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.ok(css.includes('.query-row .btn-icon{opacity:1}'), '操作按钮不应长期半透明');
});
test('N. 品牌与文档查询 UI', '文档查询分页器生成 sq-page-size 下拉', () => {
  const vm = require('vm');
  let html = '';
  const container = {
    set innerHTML(v) { html = v; },
    get innerHTML() { return html; },
    querySelector() { return { value: '' }; }
  };
  const ctx = { document: { getElementById: () => container } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'features', 'renderers.js'), 'utf8'), ctx);
  ctx.renderPagination('sq-pagination', { total: 120, totalPages: 3, page: 1, pageSize: 50 }, 'loadSpecQuery', 'sq-page-size');
  assert.match(html, /id="sq-page-size"/);
});

// ==================================================================
// O. 文件筛选 / 文档查询分组 / 会议概要
// ==================================================================
test('O. 列表与概要修复', '流转文件筛选栏恢复两行带标签布局', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const a = html.indexOf('id="page-files"');
  const b = html.indexOf('id="page-specs"', a);
  const page = html.slice(a, b);
  assert.ok(page.includes('class="filter-bar"') && !page.includes('class="filter-bar" style='), '流转文件筛选栏不应有行内样式');
  assert.ok((page.match(/class="filter-row"/g) || []).length >= 2, '应为两行');
  assert.ok((page.match(/class="filter-field"/g) || []).length >= 5, '筛选项应带标签');
  const files = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'files.js'), 'utf8');
  assert.ok(!files.includes('projSel.innerHTML'), '项目下拉不应每次重建');
  assert.ok(files.includes("projSel.options.length <= 1"), '项目下拉应只填充一次');
});
test('O. 列表与概要修复', '文档查询支持五种分组且每页默认 20', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const a = html.indexOf('id="tab-spec-query"');
  const tab = html.slice(a, a + 2500);
  assert.ok(tab.includes('id="sq-group"'));
  for (const opt of ['按版本分组', '按部门分组', '按系统分组', '按归档类别分组', '不分组']) {
    assert.ok(tab.includes(opt), '缺少分组选项：' + opt);
  }
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'specs.js'), 'utf8');
  assert.ok(src.includes("|| 20"), '每页条数默认值应为 20');
  assert.ok(src.includes("params.set('group_by', group)"));
  assert.ok(src.includes('d.grouped'));
});
test('O. 列表与概要修复', '文档查询 group_by 返回分组且关联字段仍完整', async () => {
  const grouped = (await call('/api/specs/query?group_by=archive_category&pageSize=20')).json();
  assert.equal(grouped.success, true);
  assert.ok(grouped.grouped && typeof grouped.grouped === 'object', '应返回 grouped');
  grouped.items.forEach(it => {
    assert.ok(Object.prototype.hasOwnProperty.call(it, 'related_orders'));
    assert.ok(Object.prototype.hasOwnProperty.call(it, 'related_departments'));
  });
  const plain = (await call('/api/specs/query?group_by=none&pageSize=20')).json();
  assert.equal(plain.grouped, null, '不分组时 grouped 为 null');
  assert.ok(plain.items.length <= 20);
});
test('O. 列表与概要修复', '会议列表带排期概要，卡片渲染概要行', async () => {
  const d = (await call('/api/meetings')).json();
  assert.equal(d.success, true);
  d.data.forEach(m => {
    assert.ok(m.schedule_summary, '会议应带 schedule_summary');
    for (const k of ['points', 'orders', 'departments', 'systems', 'versions', 'projects']) {
      assert.ok(typeof m.schedule_summary[k] === 'number', '缺少概要字段：' + k);
    }
  });
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'meetings.js'), 'utf8');
  assert.ok(src.includes('排期概要'));
  assert.ok(src.includes('暂无排期'));
  assert.ok(src.includes('fileOpenInfo(') && src.includes('open.downloadUrl'));
});

// ------------------------------------------------------------------
(async () => {
  let passed = 0, failed = 0;
  console.log('我的工作平台 — 自动化回归测试\n');
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
