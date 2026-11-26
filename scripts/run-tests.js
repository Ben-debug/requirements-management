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
const xlsx = require('xlsx');

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
  for (const k of ['department', 'version', 'system', 'file_type', 'system_alias']) {
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
  fs.writeFileSync(path.join(verDir, '清算系统季度报表.xlsx'), 'excel');
  fs.writeFileSync(path.join(verDir, '清算系统方案汇报.pptx'), 'ppt');
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
  const filePath = path.join(verDir, '清算系统测试文档.docx');
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
    .run(v, '清算系统测试文档.docx', filePath, '清算系统测试文档');

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
  assert.equal(recs[0].file_name, '清算系统测试文档.docx');
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
    body: JSON.stringify({ systems: ['业务服务平台'] })
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
  fs.writeFileSync(path.join(verDir, '清算系统保留文档.docx'), 'keep');
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
  assert.equal(recs[0].file_name, '清算系统保留文档.docx');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM spec_document_points WHERE spec_id=?').get(staleRec.id).c, 0, '失效记录关联点应级联删除');
});
test('K. 需规扫描分类', '目录内文件全部删除后仍能清理失效记录', async () => {
  const v = '全量失效清理版本';
  const verDir = path.join(tmpRoot, 'spec', v);
  fs.mkdirSync(verDir, { recursive: true });
  const onlyFile = path.join(verDir, '清算系统唯一文档.docx');
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

// ==================================================================
// Q. 系统别名匹配
// ==================================================================
test('Q. 系统别名匹配', '文件名只含别名时仍自动匹配到标准系统并关联需求点', async () => {
  const aliasLabel = '清算系统=清算,清算平台';
  const add = await call('/api/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'system_alias', label: aliasLabel })
  });
  assert.equal(add.json().success, true);
  try {
    const v = '别名匹配测试版本';
    const verDir = path.join(tmpRoot, 'spec', v);
    fs.mkdirSync(verDir, { recursive: true });
    const aliasOnly = path.join(verDir, '清算平台对账功能.docx');
    const standard = path.join(verDir, '清算系统需求规格.docx');
    fs.writeFileSync(aliasOnly, 'alias');
    fs.writeFileSync(standard, 'standard');

    const o = db.prepare('INSERT INTO requirement_orders (order_number,name,department) VALUES (?,?,?)').run('ALIAS-01', '别名订单', '清算部');
    const oid = Number(o.lastInsertRowid);
    const pt = db.prepare('INSERT INTO requirement_points (order_id,point_number,description) VALUES (?,?,?)').run(oid, 'ALIAS-01001', '清算系统需求点');
    const pid = Number(pt.lastInsertRowid);
    db.prepare('INSERT INTO ccb_schedules (meeting_id,order_id,point_id,system,version,is_project,project_name) VALUES (?,?,?,?,?,?,?)')
      .run(meetingId, oid, pid, '清算系统', v, 0, null);

    const scan = await call('/api/specs/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: v })
    });
    assert.equal(scan.json().success, true);
    const rows = db.prepare('SELECT file_name, matched_systems, auto_matched, id FROM spec_documents WHERE version=?').all(v);
    assert.equal(rows.length, 2);
    rows.forEach(r => {
      assert.equal(r.auto_matched, 1);
      assert.equal(r.matched_systems, '清算系统', '别名命中后仍应存标准系统名');
    });
    const linked = db.prepare('SELECT spec_id, point_id FROM spec_document_points WHERE point_id=?').all(pid);
    assert.equal(linked.length, 2, '两份文档都应关联到清算系统的需求点');
  } finally {
    await call('/api/config/system_alias/' + encodeURIComponent(aliasLabel), { method: 'DELETE' });
  }
});
test('Q. 系统别名匹配', '未配置别名时行为与原来一致', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'specs.js'), 'utf8');
  assert.ok(src.includes('matchSystemsInFileName'));
  assert.ok(src.includes('getSystemAliases'));
  assert.ok(src.includes('fileName.includes(sys)'), '仍应保留标准名精确匹配');
});

// ==================================================================
// R. 临时文件、树状层级与匹配不跳页
// ==================================================================
test('R. 归档树与临时文件', '系统临时文件不产生归档记录', async () => {
  const v = '临时文件测试版本';
  const verDir = path.join(tmpRoot, 'spec', v);
  fs.mkdirSync(verDir, { recursive: true });
  ['~$临时文档.docx', '.DS_Store', 'Thumbs.db', 'desktop.ini', '缓存.tmp', '备份.bak', '清算系统正常文档.docx']
    .forEach(name => fs.writeFileSync(path.join(verDir, name), 'x'));
  const r = await call('/api/specs/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: v })
  });
  assert.equal(r.json().success, true);
  const rows = db.prepare('SELECT file_name FROM spec_documents WHERE version=?').all(v);
  assert.deepEqual(rows.map(x => x.file_name), ['清算系统正常文档.docx'], '只应归档正常文档');
});
test('R. 归档树与临时文件', '树中文档按系统→需求单→需求点展开', async () => {
  const v = '层级测试版本';
  const verDir = path.join(tmpRoot, 'spec', v);
  fs.mkdirSync(verDir, { recursive: true });
  fs.writeFileSync(path.join(verDir, '清算系统层级文档.docx'), 'doc');
  const o = db.prepare('INSERT INTO requirement_orders (order_number,name,department) VALUES (?,?,?)').run('TREE-01', '层级需求单', '清算部');
  const oid = Number(o.lastInsertRowid);
  const pt = db.prepare('INSERT INTO requirement_points (order_id,point_number,description) VALUES (?,?,?)').run(oid, 'TREE-01001', '层级需求点');
  const pid = Number(pt.lastInsertRowid);
  db.prepare('INSERT INTO ccb_schedules (meeting_id,order_id,point_id,system,version,is_project,project_name) VALUES (?,?,?,?,?,?,?)')
    .run(meetingId, oid, pid, '清算系统', v, 0, null);
  await call('/api/specs/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: v })
  });
  const d = (await call('/api/specs/tree')).json();
  const entry = d.data.find(x => x.version === v);
  assert.ok(entry, '树中应有该版本');
  const doc = entry.wordVersions.find(x => x.file_name === '清算系统层级文档.docx');
  assert.ok(doc, 'word版本分支应有该文档');
  assert.equal(doc.archive_category, 'word_version');
  assert.ok(Array.isArray(doc.allSystems), '文档应带 allSystems 层级');
  assert.equal(doc.allSystems[0].name, '清算系统');
  assert.equal(doc.allSystems[0].orders[0].order_number, 'TREE-01');
  assert.equal(doc.allSystems[0].orders[0].points[0].point_id, pid);
});
test('R. 归档树与临时文件', '手工匹配成功后原地刷新且保留展开与滚动状态', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'specs.js'), 'utf8');
  const a = src.indexOf('async function confirmSpecMatch()');
  const b = src.indexOf('async function deleteSpec(', a);
  const body = src.slice(a, b);
  assert.ok(body.length > 0);
  assert.ok(body.includes('closeModal'));
  assert.ok(body.includes('refreshSpecAfterMatch'), '匹配成功后应触发原地刷新');
  assert.ok(!body.includes('navigate('), '不应跳转页面');
  const helper = src.slice(src.indexOf('async function refreshSpecAfterMatch('), a);
  assert.ok(helper.includes('window.scrollY') && helper.includes('scrollTo'), '应保留滚动位置');
  assert.ok(helper.includes('tree-children'), '应保留分支展开状态');
  assert.ok(helper.includes('loadSpecQuery'), '文档查询 Tab 也应同步刷新');
});

// ==================================================================
// S. 需规扫描规则收紧：无系统跳过 / 部门名过滤需求单
// ==================================================================
test('S. 扫描规则收紧', '匹配不到系统的文档跳过归档并反馈文件名', async () => {
  const v = '无系统跳过测试版本';
  const verDir = path.join(tmpRoot, 'spec', v);
  fs.mkdirSync(verDir, { recursive: true });
  fs.writeFileSync(path.join(verDir, '无系统文档.docx'), 'skip');
  fs.writeFileSync(path.join(verDir, '清算系统正常文档.docx'), 'keep');
  // 先造一条旧记录，验证跳过的文件旧记录也会被清理
  db.prepare("INSERT INTO spec_documents (version,file_name,file_path,doc_type,archive_category,matched_systems) VALUES (?,?,?,'spec_doc','word_version','-')")
    .run(v, '无系统文档.docx', path.join(verDir, '无系统文档.docx'));

  const r = (await call('/api/specs/scan', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ version: v })
  })).json();
  assert.equal(r.success, true);
  assert.equal(r.skipped_count, 1, '应跳过 1 个未匹配系统的文档');
  assert.ok(r.skipped.includes('无系统文档.docx'));
  assert.match(r.message, /跳过 1 个未匹配到系统的文档/);
  assert.match(r.message, /改名包含系统名或系统别名/);
  assert.equal(r.count, 1, '仅归档匹配到系统的文档');

  const recs = db.prepare('SELECT file_name, matched_systems FROM spec_documents WHERE version=?').all(v);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].file_name, '清算系统正常文档.docx');
  assert.notEqual(recs[0].matched_systems, '-');
  const entry = (await call('/api/specs/tree')).json().data.find(x => x.version === v);
  assert.equal(entry.wordVersions.length, 1, '树中不应出现未匹配系统的文档');
});

test('S. 扫描规则收紧', '占位符 "-" 不被当作系统名参与匹配', async () => {
  const add = await call('/api/config', {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ category: 'system', label: '-' })
  });
  assert.equal(add.json().success, true);
  try {
    const v = '占位系统测试版本';
    const verDir = path.join(tmpRoot, 'spec', v);
    fs.mkdirSync(verDir, { recursive: true });
    fs.writeFileSync(path.join(verDir, '占位-测试.docx'), 'placeholder');
    const r = (await call('/api/specs/scan', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ version: v })
    })).json();
    assert.equal(r.skipped_count, 1, '"-" 命中不应归档');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM spec_documents WHERE version=?').get(v).c, 0);
    const sysList = (await call('/api/specs/systems?version=' + encodeURIComponent(v))).json().data.systems;
    assert.ok(!sysList.includes('-'), '下拉选项不应出现占位系统 "-"');
    const filters = (await call('/api/specs/query?page=1&pageSize=1')).json().filters;
    assert.ok(!filters.systems.includes('-'), '查询筛选不应出现占位系统 "-"');
  } finally {
    await call('/api/config/system/' + encodeURIComponent('-'), { method: 'DELETE' });
  }
});

test('S. 部门名过滤', '文件名含部门名时只关联该部门提出的需求单', async () => {
  const v = '部门过滤测试版本';
  const verDir = path.join(tmpRoot, 'spec', v);
  fs.mkdirSync(verDir, { recursive: true });
  fs.writeFileSync(path.join(verDir, '清算系统清算部需求规格.docx'), 'doc');

  const mk = (num, dept) => {
    const o = db.prepare('INSERT INTO requirement_orders (order_number,name,department) VALUES (?,?,?)').run(num, '部门过滤单', dept);
    return Number(o.lastInsertRowid);
  };
  const oidA = mk('DEP-01', '清算部');
  const oidB = mk('DEP-02', '交易中心');
  const pA = Number(db.prepare('INSERT INTO requirement_points (order_id,point_number,description) VALUES (?,?,?)')
    .run(oidA, 'DEP-01001', '清算部需求点').lastInsertRowid);
  const pB = Number(db.prepare('INSERT INTO requirement_points (order_id,point_number,description) VALUES (?,?,?)')
    .run(oidB, 'DEP-02001', '交易中心需求点').lastInsertRowid);
  for (const [oid, pid] of [[oidA, pA], [oidB, pB]]) {
    db.prepare('INSERT INTO ccb_schedules (meeting_id,order_id,point_id,system,version,is_project,project_name) VALUES (?,?,?,?,?,?,?)')
      .run(meetingId, oid, pid, '清算系统', v, 0, null);
  }

  const scan = (await call('/api/specs/scan', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ version: v })
  })).json();
  assert.equal(scan.skipped_count, 0);
  const spec = db.prepare('SELECT * FROM spec_documents WHERE version=?').get(v);
  assert.equal(spec.matched_systems, '清算系统');
  assert.equal(spec.matched_department, '清算部');
  const linked = db.prepare('SELECT point_id FROM spec_document_points WHERE spec_id=?').all(spec.id).map(x => x.point_id);
  assert.deepEqual(linked, [pA], '只应关联清算部的需求点');

  // 树层级：系统下只出现清算部的需求单
  const entry = (await call('/api/specs/tree?version=' + encodeURIComponent(v))).json().data[0];
  const doc = entry.wordVersions[0];
  assert.equal(doc.matched_department, '清算部');
  const sysNode = doc.allSystems.find(x => x.name === '清算系统');
  assert.ok(sysNode);
  assert.deepEqual(sysNode.orders.map(o => o.order_number), ['DEP-01']);
  assert.deepEqual(sysNode.orders[0].points.map(p => p.point_id), [pA]);

  // 文档查询：关联字段与部门筛选口径一致
  const q = (await call('/api/specs/query?version=' + encodeURIComponent(v))).json();
  const row = q.items.find(x => x.id === spec.id);
  assert.ok(row);
  assert.equal(row.related_orders, 'DEP-01');
  assert.equal(row.related_departments, '清算部');
  const wrong = (await call('/api/specs/query?version=' + encodeURIComponent(v) + '&department=' + encodeURIComponent('交易中心'))).json();
  assert.equal(wrong.total, 0, '交易中心不应查到限定清算部的文档');
  const right = (await call('/api/specs/query?version=' + encodeURIComponent(v) + '&department=' + encodeURIComponent('清算部'))).json();
  assert.equal(right.total, 1);

  // 匹配弹窗预览也按部门收窄
  const preview = (await call('/api/specs/systems?version=' + encodeURIComponent(v) + '&department=' + encodeURIComponent('清算部'))).json();
  assert.deepEqual(preview.data.systemGroups['清算系统'].map(p => p.id), [pA]);
});

test('S. 部门名过滤', '手动匹配不允许空系统或占位系统', async () => {
  const v = '手动校验测试版本';
  const verDir = path.join(tmpRoot, 'spec', v);
  fs.mkdirSync(verDir, { recursive: true });
  fs.writeFileSync(path.join(verDir, '清算系统手动校验.docx'), 'doc');
  await call('/api/specs/scan', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ version: v }) });
  const id = db.prepare('SELECT id FROM spec_documents WHERE version=?').get(v).id;
  const empty = await call('/api/specs/' + id + '/match', {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ systems: [] })
  });
  assert.equal(empty.status, 400, '禁止无系统匹配');
  const placeholder = await call('/api/specs/' + id + '/match', {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ systems: ['-'] })
  });
  assert.equal(placeholder.status, 400, '禁止占位符系统');
});

test('S. 扫描规则收紧', '页面规则说明已补充且不再用 "-" 充当系统占位', () => {
  const specs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'specs.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(!specs.includes('style="color:#ccc">-'), '空的匹配系统不应显示为 "-"');
  assert.ok(specs.includes('未匹配'), '应有未匹配的明确文案');
  assert.ok(html.includes('否则跳过不归档'), '目录规则应说明跳过策略');
  assert.ok(html.includes('部门名'), '目录规则应说明部门限定');
  assert.ok(html.includes('spec-match-department'), '匹配弹窗应展示部门限定');
});

// ==================================================================
// T. 会议管理分页与筛选
// ==================================================================
test('T. 会议分页筛选', '无参数仍返回全量列表，兼容下拉调用', async () => {
  // 测试库只有自动化创建的会议，这里补两场 CCB 会议作为筛选样本
  for (const m of [
    { meeting_name: 'CCB第21次会议-7月评审', meeting_date: '2026-07-15', notes: '评审Q3第一批次：交易性能优化' },
    { meeting_name: 'CCB第22次会议-8月评审', meeting_date: '2026-08-15', notes: '评审Q3第二批次：风控接口升级' }
  ]) {
    const r = await call('/api/meetings', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(m) });
    assert.equal(r.json().success, true);
  }
  const d = (await call('/api/meetings')).json();
  assert.equal(d.success, true);
  assert.ok(Array.isArray(d.data));
  assert.ok(d.data.length >= 3);
  assert.ok(d.data.every(m => m.schedule_summary), '每项带排期概要');
});

test('T. 会议分页筛选', '仅显示CCB会议按名称过滤（不区分大小写）', async () => {
  await call('/api/meetings', { method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ meeting_name: '月度需求评审会', meeting_date: '2026-09-01', notes: '非CCB' }) });
  await call('/api/meetings', { method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ meeting_name: 'ccb第23次会议', meeting_date: '2026-09-02', notes: '小写ccb' }) });
  const all = (await call('/api/meetings')).json().data;
  assert.ok(all.some(m => m.meeting_name === '月度需求评审会'));
  const ccb = (await call('/api/meetings?ccb_only=1')).json().data;
  assert.ok(ccb.length >= 3);
  assert.ok(ccb.every(m => /ccb/i.test(m.meeting_name)), '只返回名称含CCB的会议');
  assert.ok(!ccb.some(m => m.meeting_name === '月度需求评审会'));
  assert.ok(ccb.some(m => m.meeting_name === 'ccb第23次会议'), '小写 ccb 也应命中');
});

test('T. 会议分页筛选', '关键字与日期范围筛选', async () => {
  const byName = (await call('/api/meetings?keyword=' + encodeURIComponent('第21次'))).json().data;
  assert.equal(byName.length, 1);
  assert.equal(byName[0].meeting_name, 'CCB第21次会议-7月评审');
  const byNotes = (await call('/api/meetings?keyword=' + encodeURIComponent('Q3第二批次'))).json().data;
  assert.equal(byNotes.length, 1);
  const range = (await call('/api/meetings?date_from=2026-08-01&date_to=2026-08-31')).json().data;
  assert.equal(range.length, 1);
  assert.ok(range.every(m => m.meeting_date >= '2026-08-01' && m.meeting_date <= '2026-08-31'));
});

test('T. 会议分页筛选', '分页返回页码信息且各页不重复', async () => {
  const p1 = (await call('/api/meetings?page=1&pageSize=2')).json();
  assert.equal(p1.data.length, 2);
  assert.equal(p1.page, 1);
  assert.equal(p1.pageSize, 2);
  assert.ok(p1.total >= 4);
  assert.ok(p1.totalPages >= 2);
  const p2 = (await call('/api/meetings?page=2&pageSize=2')).json();
  assert.equal(p2.data.length, 2);
  const ids1 = p1.data.map(m => m.id);
  assert.ok(p2.data.every(m => !ids1.includes(m.id)), '不同页不应重复');
  const filtered = (await call('/api/meetings?ccb_only=1&page=1&pageSize=1')).json();
  assert.equal(filtered.data.length, 1);
  assert.ok(filtered.total >= 3, '筛选后的 total 应为筛选结果数');
});

test('T. 会议分页筛选', '页面提供筛选栏与分页器', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'meetings.js'), 'utf8');
  ['mtg-keyword', 'mtg-date-from', 'mtg-date-to', 'mtg-ccb-only', 'meetings-pagination', 'meeting-result-info']
    .forEach(id => assert.ok(html.includes('id="' + id + '"'), '缺少 ' + id));
  assert.ok(html.includes('仅显示CCB会议'));
  assert.ok(js.includes("renderPagination('meetings-pagination'"));
  assert.ok(js.includes('async function loadMeetings(page)'));
  assert.ok(js.includes('resetMeetingFilter'));
});

// ==================================================================
// U. 业务参数自定义排序
// ==================================================================
test('U. 业务参数排序', '按完整顺序列表重排并持久化', async () => {
  const before = (await call('/api/config/department')).json().data;
  assert.equal(before.length, 3);
  const order = [before[2], before[0], before[1]];
  const r = await call('/api/config/department/order', {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ labels: order })
  });
  assert.equal(r.json().success, true);
  assert.deepEqual((await call('/api/config/department')).json().data, order);
  await call('/api/config/department/order', {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ labels: before })
  });
  assert.deepEqual((await call('/api/config/department')).json().data, before, '应能还原顺序');
});

test('U. 业务参数排序', '拒绝不完整/重复/未知条目', async () => {
  const before = (await call('/api/config/system')).json().data;
  const invalid = [
    before.slice(0, 1),
    [before[0], before[0], before[1], before[2]],
    [before[0], before[1], before[2], '未知系统']
  ];
  for (const labels of invalid) {
    const r = await call('/api/config/system/order', {
      method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ labels })
    });
    assert.equal(r.status, 400);
    assert.equal(r.json().success, false);
  }
  assert.deepEqual((await call('/api/config/system')).json().data, before, '非法排序不应改动配置');
});

test('U. 业务参数排序', '页面支持拖拽排序，部门与系统别名可改名', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'config.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  ['configDragStart', 'configDrop', 'configDragEnd'].forEach(fn => assert.ok(js.includes(fn), '缺少 ' + fn));
  assert.ok(js.includes("'/order'"), '应提交排序接口');
  assert.ok(js.includes('draggable="true"'));
  assert.ok(html.includes('拖拽调整顺序'));
  assert.ok(html.includes('系统别名</b>只影响后续目录扫描'));
  assert.ok(js.includes("['system_alias', 'department', 'project', 'version']"), '部门、项目、版本与系统别名显示修改按钮');
  assert.ok(js.includes('update_history'), '应提交历史数据处理选项');
  assert.ok(html.includes('config-rename-options'));
  assert.ok(js.includes('showEditConfig') && js.includes('editingConfigLabel'));
});

// ==================================================================
// V. 系统别名修改（影响可控，单独开放）
// ==================================================================
test('V. 系统别名修改', '支持原地改名并保持位置不变', async () => {
  const before = (await call('/api/config/system_alias')).json().data;
  const old = '测试别名=测试,测试简称';
  const next = '测试别名=测试,测试简写';
  await call('/api/config', { method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ category: 'system_alias', label: old }) });
  const list = (await call('/api/config/system_alias')).json().data;
  assert.ok(list.includes(old));

  const r = await call('/api/config/system_alias/' + encodeURIComponent(old), {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ label: next })
  });
  assert.equal(r.json().success, true);
  const after = (await call('/api/config/system_alias')).json().data;
  assert.ok(after.includes(next) && !after.includes(old));
  assert.deepEqual(after, list.map(x => x === old ? next : x), '改名后应保持原位置');

  await call('/api/config/system_alias/' + encodeURIComponent(next), {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ label: old })
  });
  await call('/api/config/system_alias/' + encodeURIComponent(old), { method: 'DELETE' });
  assert.deepEqual((await call('/api/config/system_alias')).json().data, before, '应还原测试前状态');
});

test('V. 系统别名修改', '拒绝空名/重复名/不存在的原名', async () => {
  for (const label of ['别名A=甲', '别名B=乙']) {
    await call('/api/config', { method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ category: 'system_alias', label }) });
  }
  const put = (oldLabel, label) => call('/api/config/system_alias/' + encodeURIComponent(oldLabel), {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ label })
  });
  assert.equal((await put('别名A=甲', '')).status, 400);
  assert.equal((await put('别名A=甲', '别名B=乙')).status, 400);
  assert.equal((await put('不存在', '新名=丙')).status, 400);
  const after = (await call('/api/config/system_alias')).json().data;
  assert.ok(after.includes('别名A=甲') && after.includes('别名B=乙'), '非法修改不应改动配置');
  for (const label of ['别名A=甲', '别名B=乙']) {
    await call('/api/config/system_alias/' + encodeURIComponent(label), { method: 'DELETE' });
  }
});

test('V. 系统别名修改', '其它业务参数分类仍禁止改名', async () => {
  const r = await call('/api/config/system/' + encodeURIComponent('清算系统'), {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ label: '系统改名测试' })
  });
  assert.equal(r.status, 400);
  assert.ok((await call('/api/config/system')).json().data.includes('清算系统'));
});

// ==================================================================
// W. 禁止处理涉密信息提醒
// ==================================================================
test('W. 安全提醒', '主界面与登录页均保留精简的涉密禁令', () => {
  const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  const login = fs.readFileSync(path.join(ROOT, 'public', 'login.html'), 'utf8');
  assert.ok(index.includes('security-notice'), '主界面应有安全提醒条');
  assert.ok(/<div class="security-notice">严禁处理涉密信息<\/div>/.test(index), '主界面提醒应精简为「严禁处理涉密信息」');
  assert.ok(/\.security-notice\{[^}]*position:sticky/.test(css), '提醒条样式应保留 position:sticky');
  assert.ok(login.includes('security-banner'), '登录页应有安全提醒');
  assert.ok(/<div class="security-banner">严禁处理涉密信息<\/div>/.test(login), '登录页提醒应精简为「严禁处理涉密信息」');
});

// ==================================================================
// Y. 部门改名与历史数据更新
// ==================================================================
const cfgModule = require('../server/config.js');

test('Y. 部门改名', '影响预览准确，仅改配置时历史数据保留原名且旧名成为别名', async () => {
  const snapshot = cfgModule.snapshot();
  const OLD = '改名测试部', NEW = '新测试部';
  await call('/api/config', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ category: 'department', label: OLD }) });
  const o1 = db.prepare('INSERT INTO requirement_orders (order_number,name,department,related_departments) VALUES (?,?,?,?)')
    .run('RM-RENAME-1', '改名测试单1', OLD, OLD + ',清算部').lastInsertRowid;
  const o2 = db.prepare('INSERT INTO requirement_orders (order_number,name,department) VALUES (?,?,?)')
    .run('RM-RENAME-2', '改名测试单2', OLD).lastInsertRowid;
  const d1 = db.prepare('INSERT INTO spec_documents (version,file_name,file_path,matched_department) VALUES (?,?,?,?)')
    .run('v1', 'rename.docx', '/tmp/rename.docx', OLD).lastInsertRowid;
  try {
    const impact = (await call('/api/config/department/rename-impact?label=' + encodeURIComponent(OLD))).json();
    assert.equal(impact.success, true);
    assert.deepEqual({ orders: impact.data.orders, relatedOrders: impact.data.relatedOrders, specDocs: impact.data.specDocs, total: impact.data.total },
      { orders: 2, relatedOrders: 1, specDocs: 1, total: 4 });

    const r = await call('/api/config/department/' + encodeURIComponent(OLD), {
      method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ label: NEW, update_history: false })
    });
    assert.equal(r.json().success, true);
    assert.ok((await call('/api/config/department')).json().data.includes(NEW));

    assert.equal(db.prepare('SELECT department FROM requirement_orders WHERE id=?').get(o1).department, OLD);
    assert.equal(db.prepare('SELECT related_departments FROM requirement_orders WHERE id=?').get(o1).related_departments, OLD + ',清算部');
    assert.equal(db.prepare('SELECT matched_department FROM spec_documents WHERE id=?').get(d1).matched_department, OLD);

    assert.ok((await call('/api/config')).json().data.department_alias.includes(NEW + '=' + OLD), '旧名应保留为别名');
    const list = (await call('/api/orders?department=' + encodeURIComponent(NEW))).json();
    assert.ok(list.items.some(o => o.order_number === 'RM-RENAME-1'), '按新名筛选应能查到旧名需求单');
  } finally {
    cfgModule.restore(snapshot);
    db.prepare('DELETE FROM requirement_orders WHERE id IN (?,?)').run(o1, o2);
    db.prepare('DELETE FROM spec_documents WHERE id=?').run(d1);
  }
});

test('Y. 部门改名', '同步更新历史数据，逗号分隔字段按 token 精确替换', async () => {
  const snapshot = cfgModule.snapshot();
  const OLD = '改名测试部2', NEW = '新测试部2', OLDER = '更老的名称';
  await call('/api/config', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ category: 'department', label: OLD }) });
  cfgModule.getAll().department_alias.push(OLD + '=' + OLDER); // 预置链式别名
  const o1 = db.prepare('INSERT INTO requirement_orders (order_number,name,department,related_departments) VALUES (?,?,?,?)')
    .run('RM-RENAME-3', '改名测试单3', OLD, OLD + ',清算部,改名测试部20').lastInsertRowid;
  const o2 = db.prepare('INSERT INTO requirement_orders (order_number,name,department,related_departments) VALUES (?,?,?,?)')
    .run('RM-RENAME-4', '改名测试单4', '清算部', OLD).lastInsertRowid;
  const d1 = db.prepare('INSERT INTO spec_documents (version,file_name,file_path,matched_department) VALUES (?,?,?,?)')
    .run('v1', 'rename2.docx', '/tmp/rename2.docx', OLD + ',清算部').lastInsertRowid;
  try {
    const r = await call('/api/config/department/' + encodeURIComponent(OLD), {
      method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ label: NEW, update_history: true })
    });
    assert.equal(r.json().success, true);
    assert.deepEqual(r.json().data.history, { orders: 1, relatedOrders: 2, specDocs: 1, total: 4 });

    assert.equal(db.prepare('SELECT department FROM requirement_orders WHERE id=?').get(o1).department, NEW);
    assert.equal(db.prepare('SELECT department FROM requirement_orders WHERE id=?').get(o2).department, '清算部', '非该部门的需求单不应被改动');
    assert.equal(db.prepare('SELECT related_departments FROM requirement_orders WHERE id=?').get(o1).related_departments,
      NEW + ',清算部,改名测试部20', '相似名称不应被子串替换');
    assert.equal(db.prepare('SELECT related_departments FROM requirement_orders WHERE id=?').get(o2).related_departments, NEW);
    assert.equal(db.prepare('SELECT matched_department FROM spec_documents WHERE id=?').get(d1).matched_department, NEW + ',清算部');

    const aliases = (await call('/api/config')).json().data.department_alias;
    assert.ok(aliases.includes(NEW + '=' + OLD + ',' + OLDER), '改名应合并并展平旧别名');
    assert.ok(!aliases.some(a => a.startsWith(OLD + '=')), '旧键应被移除');
    const list = (await call('/api/orders?department=' + encodeURIComponent(OLDER))).json();
    assert.ok(list.items.some(o => o.order_number === 'RM-RENAME-3'), '旧别名筛选应等价到新部门');
  } finally {
    cfgModule.restore(snapshot);
    db.prepare('DELETE FROM requirement_orders WHERE id IN (?,?)').run(o1, o2);
    db.prepare('DELETE FROM spec_documents WHERE id=?').run(d1);
  }
});

test('Y. 部门改名', '拒绝空名、重名与不存在的原名', async () => {
  const snapshot = cfgModule.snapshot();
  await call('/api/config', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ category: 'department', label: '改名校验部' }) });
  const put = (oldLabel, label) => call('/api/config/department/' + encodeURIComponent(oldLabel), {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ label, update_history: true })
  });
  try {
    assert.equal((await put('改名校验部', '')).status, 400);
    assert.equal((await put('改名校验部', '清算部')).status, 400);
    assert.equal((await put('不存在部门', '新名')).status, 400);
    const list = (await call('/api/config/department')).json().data;
    assert.ok(list.includes('改名校验部') && list.includes('清算部'), '非法改名不应改动配置');
  } finally { cfgModule.restore(snapshot); }
});

// ==================================================================
// Z. 项目改名与历史数据更新
// ==================================================================
test('Z. 项目改名', '影响预览与同步更新历史排期，旧名保留为别名', async () => {
  const snapshot = cfgModule.snapshot();
  const OLD = '改名测试项目', NEW = '新测试项目';
  await call('/api/config', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ category: 'project', label: OLD }) });
  const o = db.prepare('INSERT INTO requirement_orders (order_number,name) VALUES (?,?)').run('RM-PROJ-1', '项目改名单');
  const oid = Number(o.lastInsertRowid);
  const pt = db.prepare('INSERT INTO requirement_points (order_id,point_number,description) VALUES (?,?,?)')
    .run(oid, 'RM-PROJ-P1', '项目改名需求点');
  const pid = Number(pt.lastInsertRowid);
  const sid = db.prepare('INSERT INTO ccb_schedules (meeting_id,order_id,point_id,system,version,is_project,project_name) VALUES (?,?,?,?,?,1,?)')
    .run(meetingId, oid, pid, '清算系统', 'v1', OLD).lastInsertRowid;
  const doc = db.prepare("INSERT INTO spec_documents (version,file_name,file_path,doc_type) VALUES (?,?,?,'spec_doc')")
    .run('v1', 'proj.docx', '/tmp/proj.docx').lastInsertRowid;
  db.prepare('INSERT INTO spec_document_points (spec_id,point_id) VALUES (?,?)').run(doc, pid);
  try {
    const impact = (await call('/api/config/project/rename-impact?label=' + encodeURIComponent(OLD))).json();
    assert.deepEqual(impact.data, { schedules: 1, total: 1 });

    const r = await call('/api/config/project/' + encodeURIComponent(OLD), {
      method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ label: NEW, update_history: true })
    });
    assert.equal(r.json().success, true);
    assert.deepEqual(r.json().data.history, { schedules: 1, total: 1 });
    assert.equal(db.prepare('SELECT project_name FROM ccb_schedules WHERE id=?').get(sid).project_name, NEW);
    assert.ok((await call('/api/config')).json().data.project_alias.includes(NEW + '=' + OLD));

    const list = (await call('/api/specs/query?project_name=' + encodeURIComponent(OLD))).json();
    assert.ok(list.items.some(x => x.id === doc), '旧项目名筛选应等价到新项目');
  } finally {
    cfgModule.restore(snapshot);
    db.prepare('DELETE FROM spec_document_points WHERE spec_id=?').run(doc);
    db.prepare('DELETE FROM spec_documents WHERE id=?').run(doc);
    db.prepare('DELETE FROM requirement_orders WHERE id=?').run(oid);
  }
});

test('Z. 项目改名', '仅改配置时历史排期保留原名', async () => {
  const snapshot = cfgModule.snapshot();
  const OLD = '改名测试项目2', NEW = '新测试项目2';
  await call('/api/config', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ category: 'project', label: OLD }) });
  const o = db.prepare('INSERT INTO requirement_orders (order_number,name) VALUES (?,?)').run('RM-PROJ-2', '项目改名单2');
  const oid = Number(o.lastInsertRowid);
  const pt = db.prepare('INSERT INTO requirement_points (order_id,point_number,description) VALUES (?,?,?)')
    .run(oid, 'RM-PROJ-P2', '项目改名需求点2');
  const pid = Number(pt.lastInsertRowid);
  const sid = db.prepare('INSERT INTO ccb_schedules (meeting_id,order_id,point_id,system,version,is_project,project_name) VALUES (?,?,?,?,?,1,?)')
    .run(meetingId, oid, pid, '清算系统', 'v1', OLD).lastInsertRowid;
  try {
    const r = await call('/api/config/project/' + encodeURIComponent(OLD), {
      method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ label: NEW, update_history: false })
    });
    assert.equal(r.json().success, true);
    assert.ok((await call('/api/config/project')).json().data.includes(NEW));
    assert.equal(db.prepare('SELECT project_name FROM ccb_schedules WHERE id=?').get(sid).project_name, OLD);
    assert.ok((await call('/api/config')).json().data.project_alias.includes(NEW + '=' + OLD));
  } finally {
    cfgModule.restore(snapshot);
    db.prepare('DELETE FROM requirement_orders WHERE id=?').run(oid);
  }
});

// ==================================================================
// AA. 版本改名与历史数据更新
// ==================================================================
test('AA. 版本改名', '影响预览与同步更新历史版本，旧版本目录仍可扫描', async () => {
  const snapshot = cfgModule.snapshot();
  const OLD = '改名版本测试V', NEW = '改名版本测试V新';
  const verDir = path.join(tmpRoot, 'spec', OLD);
  fs.mkdirSync(verDir, { recursive: true });
  const fileName = '清算系统需求规格.docx';
  fs.writeFileSync(path.join(verDir, fileName), 'x');
  await call('/api/config', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ category: 'version', label: OLD }) });
  const o = db.prepare('INSERT INTO requirement_orders (order_number,name) VALUES (?,?)').run('RM-VER-1', '版本改名单');
  const oid = Number(o.lastInsertRowid);
  const pt = db.prepare('INSERT INTO requirement_points (order_id,point_number,description,version) VALUES (?,?,?,?)')
    .run(oid, 'RM-VER-P1', '版本改名需求点', OLD);
  const pid = Number(pt.lastInsertRowid);
  const sid = db.prepare('INSERT INTO ccb_schedules (meeting_id,order_id,point_id,system,version,is_project) VALUES (?,?,?,?,?,0)')
    .run(meetingId, oid, pid, '清算系统', OLD).lastInsertRowid;
  const oldDoc = db.prepare("INSERT INTO spec_documents (version,file_name,file_path,doc_type) VALUES (?,?,?,'spec_doc')")
    .run(OLD, 'old-ver.docx', path.join(verDir, 'old-ver.docx')).lastInsertRowid;
  try {
    const impact = (await call('/api/config/version/rename-impact?label=' + encodeURIComponent(OLD))).json();
    assert.deepEqual(impact.data, { points: 1, schedules: 1, specDocs: 1, total: 3 });

    const r = await call('/api/config/version/' + encodeURIComponent(OLD), {
      method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ label: NEW, update_history: true })
    });
    assert.equal(r.json().success, true);
    assert.deepEqual(r.json().data.history, { points: 1, schedules: 1, specDocs: 1, total: 3 });
    assert.equal(db.prepare('SELECT version FROM requirement_points WHERE id=?').get(pid).version, NEW);
    assert.equal(db.prepare('SELECT version FROM ccb_schedules WHERE id=?').get(sid).version, NEW);
    assert.equal(db.prepare('SELECT version FROM spec_documents WHERE id=?').get(oldDoc).version, NEW);
    assert.ok((await call('/api/config')).json().data.version_alias.includes(NEW + '=' + OLD));

    // 磁盘目录仍是旧名时，按新版本名扫描仍应命中并写入新版本名
    const scan = await call('/api/specs/scan', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ version: NEW })
    });
    assert.equal(scan.json().success, true);
    assert.notEqual(scan.json().data.skipBecauseMissingVersionDir, true);
    const scanned = db.prepare('SELECT id FROM spec_documents WHERE file_name=? AND version=?').get(fileName, NEW);
    assert.ok(scanned, '旧目录中的文件应归档到新版本名');

    const q = (await call('/api/specs/query?version=' + encodeURIComponent(OLD))).json();
    assert.ok(q.items.some(x => x.id === scanned.id), '旧版本名筛选应等价到新版本');
  } finally {
    cfgModule.restore(snapshot);
    db.prepare('DELETE FROM spec_documents WHERE version IN (?,?)').run(OLD, NEW);
    db.prepare('DELETE FROM requirement_orders WHERE id=?').run(oid);
    fs.rmSync(path.join(tmpRoot, 'spec', OLD), { recursive: true, force: true });
    fs.rmSync(path.join(tmpRoot, 'spec', NEW), { recursive: true, force: true });
  }
});

test('AA. 版本改名', '仅改配置时历史版本保留原名', async () => {
  const snapshot = cfgModule.snapshot();
  const OLD = '改名版本测试V2', NEW = '改名版本测试V2新';
  await call('/api/config', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ category: 'version', label: OLD }) });
  const o = db.prepare('INSERT INTO requirement_orders (order_number,name) VALUES (?,?)').run('RM-VER-2', '版本改名单2');
  const oid = Number(o.lastInsertRowid);
  const pt = db.prepare('INSERT INTO requirement_points (order_id,point_number,description,version) VALUES (?,?,?,?)')
    .run(oid, 'RM-VER-P2', '版本改名需求点2', OLD);
  const pid = Number(pt.lastInsertRowid);
  const sid = db.prepare('INSERT INTO ccb_schedules (meeting_id,order_id,point_id,system,version,is_project) VALUES (?,?,?,?,?,0)')
    .run(meetingId, oid, pid, '清算系统', OLD).lastInsertRowid;
  try {
    const r = await call('/api/config/version/' + encodeURIComponent(OLD), {
      method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ label: NEW, update_history: false })
    });
    assert.equal(r.json().success, true);
    assert.ok((await call('/api/config/version')).json().data.includes(NEW));
    assert.equal(db.prepare('SELECT version FROM requirement_points WHERE id=?').get(pid).version, OLD);
    assert.equal(db.prepare('SELECT version FROM ccb_schedules WHERE id=?').get(sid).version, OLD);
    assert.ok((await call('/api/config')).json().data.version_alias.includes(NEW + '=' + OLD));
    const q = (await call('/api/specs/query?version=' + encodeURIComponent(NEW))).json();
    assert.ok(Array.isArray(q.items));
  } finally {
    cfgModule.restore(snapshot);
    db.prepare('DELETE FROM requirement_orders WHERE id=?').run(oid);
  }
});

// ==================================================================
// AB. 数据备份
// ==================================================================
test('AB. 数据备份', '创建备份生成数据库快照与配置，列表/下载/删除均可用', async () => {
  const before = (await call('/api/backup/list')).json();
  assert.equal(before.success, true);

  const r = await call('/api/backup', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ include_uploads: false })
  });
  assert.equal(r.json().success, true, r.text);
  const manifest = r.json().data;
  assert.match(manifest.name, /^backup-\d{8}-\d{6}$/);
  assert.equal(manifest.include_uploads, false);
  assert.ok(manifest.size_bytes > 0);
  const bdir = path.join(tmpRoot, 'backups', manifest.name);
  assert.ok(fs.existsSync(path.join(bdir, 'requirements.db')), '应生成数据库快照');
  assert.ok(fs.existsSync(path.join(bdir, 'config.json')), '应备份配置文件');
  assert.ok(fs.existsSync(path.join(bdir, 'manifest.json')));

  const list = (await call('/api/backup/list')).json();
  assert.ok(list.data.some(b => b.name === manifest.name));

  const dl = await call('/api/backup/' + encodeURIComponent(manifest.name) + '/download');
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-type') || '', /application\/zip/);
  assert.ok(dl.text.length > 0);

  const del = await call('/api/backup/' + encodeURIComponent(manifest.name), { method: 'DELETE' });
  assert.equal(del.json().success, true);
  assert.equal(fs.existsSync(bdir), false);
  const after = (await call('/api/backup/list')).json();
  assert.ok(!after.data.some(b => b.name === manifest.name));
});

test('AB. 数据备份', '拒绝非法备份名称', async () => {
  const r = await call('/api/backup/..%5Cevil/download');
  assert.equal(r.status, 400);
  const d = await call('/api/backup/not-a-backup', { method: 'DELETE' });
  assert.equal(d.status, 400);
});

// ==================================================================
// AC. 数据库索引
// ==================================================================
test('AC. 数据库索引', '高频筛选与关联字段索引已建立且初始化幂等', () => {
  const expected = [
    'idx_ro_department', 'idx_ro_propose_date', 'idx_rp_order_id', 'idx_rp_version',
    'idx_ff_order_id', 'idx_cs_order_id', 'idx_cs_point_id', 'idx_cs_meeting_id',
    'idx_cs_version', 'idx_cs_project_name', 'idx_cm_meeting_name',
    'idx_sd_version', 'idx_sd_matched_department', 'idx_sdp_point_id'
  ];
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all().map(r => r.name);
  for (const name of expected) assert.ok(names.includes(name), '缺少索引：' + name);
  assert.doesNotThrow(() => require('../server/schema.js').initDatabase(db), '重复初始化应幂等');
});

// ==================================================================
// AD. 口令哈希与登录限流
// ==================================================================
test('AD. 口令安全', '口令以加盐哈希存储，明文不再落盘', () => {
  const snapshot = cfgModule.snapshot();
  try {
    cfgModule.setAuthPassword('hash-test-pass');
    const raw = fs.readFileSync(path.join(tmpRoot, 'config.json'), 'utf8');
    assert.ok(!raw.includes('hash-test-pass'), '配置文件不应出现明文口令');
    assert.match(raw, /scrypt\$/);
    assert.equal(cfgModule.verifyPassword('hash-test-pass', cfgModule.getAuthPassword()), true);
    assert.equal(cfgModule.verifyPassword('wrong-pass', cfgModule.getAuthPassword()), false);
  } finally { cfgModule.restore(snapshot); }
});

test('AD. 口令安全', '旧明文口令登录成功后透明升级为哈希', async () => {
  const snapshot = cfgModule.snapshot();
  const authRoutes = require('../server/routes/auth-routes');
  authRoutes.resetLoginAttempts();
  try {
    snapshot.auth = { password: PASSWORD };
    cfgModule.restore(snapshot);
    const r = await call('/api/auth/login', {
      auth: null, method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ username: 'admin', password: PASSWORD })
    });
    assert.equal(r.json().success, true);
    const raw = fs.readFileSync(path.join(tmpRoot, 'config.json'), 'utf8');
    assert.ok(!raw.includes(PASSWORD), '登录后应升级为哈希');
    assert.match(raw, /scrypt\$/);
  } finally {
    cfgModule.restore(snapshot);
    authRoutes.resetLoginAttempts();
  }
});

test('AD. 口令安全', '连续失败 5 次后锁定，重置后可正常登录', async () => {
  const authRoutes = require('../server/routes/auth-routes');
  authRoutes.resetLoginAttempts();
  const login = (password) => call('/api/auth/login', {
    auth: null, method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ username: 'admin', password })
  });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await login('wrong')).status, 401);
    assert.equal((await login(PASSWORD)).status, 429, '锁定后即使口令正确也应拒绝');
  } finally { authRoutes.resetLoginAttempts(); }
  assert.equal((await login(PASSWORD)).status, 200, '重置后应恢复登录');
});

// ==================================================================
// AE. 搜索与目录遍历
// ==================================================================
test('AE. 搜索与遍历', '全局搜索限制 50 条并携带需求点', async () => {
  const KEY = '全局搜索压测关键字XYZ';
  const ins = db.prepare('INSERT INTO requirement_orders (order_number,name) VALUES (?,?)');
  db.transaction(() => {
    for (let i = 0; i < 55; i++) ins.run('SRCH' + String(i).padStart(3, '0'), KEY + '-' + i);
  })();
  try {
    const r = (await call('/api/search?keyword=' + encodeURIComponent(KEY))).json();
    assert.equal(r.success, true);
    assert.equal(r.data.length, 50, '搜索结果应限制为 50 条');
    assert.ok(r.data.every(o => Array.isArray(o.matchedPoints)), '每条结果都应带需求点数组');
  } finally {
    db.prepare("DELETE FROM requirement_orders WHERE order_number LIKE 'SRCH%'").run();
  }
});

test('AE. 搜索与遍历', 'walkDir 跳过符号链接且不因单文件异常中断', () => {
  const { walkDir } = require('../server/utils.js');
  const root = path.join(tmpRoot, 'walk-test');
  const sub = path.join(root, 'sub');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(root, 'a.txt'), 'a');
  fs.writeFileSync(path.join(sub, 'b.txt'), 'b');
  try { fs.symlinkSync(root, path.join(root, 'loop')); } catch (e) {}
  const files = walkDir(root);
  assert.equal(files.length, 2, '应只返回两个真实文件，符号链接环不应导致递归');
  assert.ok(files.some(f => f.endsWith('a.txt')) && files.some(f => f.endsWith('b.txt')));
  assert.deepEqual(walkDir(path.join(root, 'not-exist')), [], '不存在的目录应返回空数组');
});

// ==================================================================
// T. 工作台账
// ==================================================================
async function createLedger(category, workName, extra = {}) {
  const r = await call('/api/ledgers', {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({
      category,
      entry_date: extra.entry_date || '2026-11-01',
      work_name: workName,
      issuing_department: extra.issuing_department || '交易中心',
      work_content: extra.work_content || '检查内容',
      involved_people: extra.involved_people || '张三',
      completion_date: extra.completion_date || '',
      related_materials: extra.related_materials || '',
      remarks: extra.remarks || ''
    })
  });
  assert.equal(r.json().success, true, '创建台账应成功: ' + r.text);
  return r.json().data.id;
}

test('T. 工作台账', '两类台账按 category 隔离，互不串数据', async () => {
  await createLedger('discipline', '纪检检查A');
  await createLedger('discipline', '纪检检查B');
  await createLedger('bm', '保密检查A');
  const j = (await call('/api/ledgers?category=discipline')).json();
  const b = (await call('/api/ledgers?category=bm')).json();
  assert.equal(j.total, 2);
  assert.equal(b.total, 1);
  assert.ok(j.data.every(x => x.category === 'discipline'));
  assert.ok(b.data.every(x => x.category === 'bm'));
  assert.ok(j.data.some(x => x.work_name === '纪检检查A'));
  assert.ok(!j.data.some(x => x.work_name === '保密检查A'));
});

test('T. 工作台账', '关键词 / 下发部门 / 录入日期区间筛选生效', async () => {
  await createLedger('discipline', '专项督查X', {
    issuing_department: '清算部', entry_date: '2026-10-05', involved_people: '李四'
  });
  const kw = (await call('/api/ledgers?category=discipline&keyword=' + encodeURIComponent('专项督查X'))).json();
  assert.equal(kw.total, 1);
  assert.equal(kw.data[0].involved_people, '李四');

  const dept = (await call('/api/ledgers?category=discipline&department=' + encodeURIComponent('清算部'))).json();
  assert.equal(dept.total, 1);
  assert.equal(dept.data[0].work_name, '专项督查X');

  const range = (await call('/api/ledgers?category=discipline&date_from=2026-10-01&date_to=2026-10-31')).json();
  assert.equal(range.total, 1);
  assert.equal(range.data[0].work_name, '专项督查X');

  const noMatch = (await call('/api/ledgers?category=discipline&date_from=2026-01-01&date_to=2026-01-31')).json();
  assert.equal(noMatch.total, 0);
});

test('T. 工作台账', '排序按字段升降序生效，非法 sort 回退默认', async () => {
  for (const name of ['排序丙', '排序甲', '排序乙']) {
    await createLedger('bm', name);
  }
  const asc = (await call('/api/ledgers?category=bm&sort=work_name&order=asc&pageSize=100')).json();
  const desc = (await call('/api/ledgers?category=bm&sort=work_name&order=desc&pageSize=100')).json();
  const names = asc.data.map(x => x.work_name);
  assert.deepEqual(names, [...names].sort(), '升序应按字段值排列');
  assert.deepEqual(desc.data.map(x => x.work_name), [...names].reverse(), '降序应为升序的逆序');

  const bad = (await call('/api/ledgers?category=bm&sort=' + encodeURIComponent('id; DROP TABLE work_ledgers'))).json();
  assert.equal(bad.success, true, '非法排序字段不应报错');
  assert.ok(db.prepare('SELECT COUNT(*) c FROM work_ledgers').get().c > 0, '表不应被注入破坏');
});

test('T. 工作台账', '分页 total / totalPages / 每页条数正确', async () => {
  for (let i = 1; i <= 5; i++) await createLedger('discipline', '分页记录' + i);
  const p1 = (await call('/api/ledgers?category=discipline&page=1&pageSize=3')).json();
  const p2 = (await call('/api/ledgers?category=discipline&page=2&pageSize=3')).json();
  assert.equal(p1.pageSize, 3);
  assert.equal(p1.data.length, 3);
  assert.equal(p2.data.length, 3);
  assert.equal(p1.totalPages, Math.ceil(p1.total / 3));
  assert.equal(p1.page, 1);
  assert.equal(p2.page, 2);
  assert.ok(p1.total > 6, '应有足够数据覆盖多页');
  assert.equal(new Set([...p1.data, ...p2.data].map(x => x.id)).size, 6, '前两页不应出现重复记录');
});

test('T. 工作台账', '修改与删除后列表同步，编辑不改变类别', async () => {
  const id = await createLedger('bm', '待修改台账');
  const u = await call('/api/ledgers/' + id, {
    method: 'PUT', headers: jsonHeaders,
    body: JSON.stringify({
      entry_date: '2026-11-20', work_name: '已修改台账', issuing_department: '交割储运部',
      work_content: '新内容', involved_people: '王五', completion_date: '2026-11-21',
      related_materials: '材料X', remarks: '备注X'
    })
  });
  assert.equal(u.json().success, true);
  const d = (await call('/api/ledgers/' + id)).json().data;
  assert.equal(d.work_name, '已修改台账');
  assert.equal(d.category, 'bm', '编辑不应改变类别');
  assert.equal(d.entry_date, '2026-11-20');
  assert.equal(d.related_materials, '材料X');

  const del = await call('/api/ledgers/' + id, { method: 'DELETE' });
  assert.equal(del.json().success, true);
  assert.equal((await call('/api/ledgers/' + id)).status, 404);
});

test('T. 工作台账', '非法 category 与缺失必填字段返回 400', async () => {
  assert.equal((await call('/api/ledgers?category=hack')).status, 400);
  assert.equal((await call('/api/ledgers/export?category=hack')).status, 400);
  const r = await call('/api/ledgers', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ category: 'bm' })
  });
  assert.equal(r.status, 400);
});

test('T. 工作台账', '导出路由注册在参数路由之前', () => {
  const routes = testApp._router.stack
    .filter(l => l.route && l.route.path && l.route.path.startsWith('/api/ledgers'))
    .map(l => l.route.path);
  const iExport = routes.indexOf('/api/ledgers/export');
  const iParam = routes.indexOf('/api/ledgers/:id');
  assert.ok(iExport >= 0 && iParam >= 0 && iExport < iParam, '导出路由必须注册在 :id 之前');
});

test('T. 工作台账', '导出返回 xlsx 附件且包含筛选结果', async () => {
  await createLedger('bm', '导出验证台账', {
    issuing_department: '会员部', work_content: '导出内容', related_materials: '附件名称A'
  });
  const r = await fetch(BASE + '/api/ledgers/export?category=bm&keyword=' + encodeURIComponent('导出验证台账'), {
    headers: { Authorization: AUTH }
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /spreadsheet|octet-stream/);
  assert.match(r.headers.get('content-disposition') || '', /^attachment/);
  const wb = xlsx.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  assert.equal(rows.length, 1, '按查询结果导出应只含匹配行，且忽略分页');
  assert.equal(rows[0]['工作名称'], '导出验证台账');
  assert.equal(rows[0]['下发部门'], '会员部');
  assert.equal(rows[0]['相关材料'], '附件名称A');
  assert.equal(rows[0]['类别'], 'BM');
});

test('T. 工作台账', '前端导航、页面与脚本已接入', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  const nav = fs.readFileSync(path.join(ROOT, 'public', 'js', 'features', 'navigation.js'), 'utf8');
  assert.ok(html.includes('data-page="ledgers"'), '缺少导航项');
  assert.ok(html.includes('id="page-ledgers"') && html.includes('id="ledger-modal"'), '缺少页面或弹窗');
  assert.ok(html.includes('/js/pages/ledgers.js'), '缺少脚本引用');
  assert.ok(app.includes('window.loadLedgers = loadLedgers'), '缺少全局函数注册');
  assert.ok(nav.includes("page === 'ledgers'"), 'navigate 未接入台账页');
});

// ==================================================================
// AF. 导航菜单配置
// ==================================================================
test('AF. 导航菜单配置', '默认只显示五个模块，工作台账默认隐藏', async () => {
  await call('/api/nav-modules', {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ modules: [] })
  });
  const r = (await call('/api/nav-modules')).json();
  assert.equal(r.success, true);
  assert.deepEqual(r.data, ['orders', 'meetings', 'files', 'specs', 'config']);
  assert.ok(!r.data.includes('ledgers'), '工作台账默认应隐藏');
  assert.ok(r.data.includes('config'), '参数配置应始终可见');
});

test('AF. 导航菜单配置', 'PUT 过滤未知模块、去重并强制保留参数配置', async () => {
  const r = await call('/api/nav-modules', {
    method: 'PUT', headers: jsonHeaders,
    body: JSON.stringify({ modules: ['ledgers', 'bogus', 'orders', 'orders'] })
  });
  const d = r.json();
  assert.equal(d.success, true);
  assert.deepEqual(d.data, ['orders', 'ledgers', 'config']);
  const again = (await call('/api/nav-modules')).json();
  assert.deepEqual(again.data, d.data, '配置应持久化');
});

test('AF. 导航菜单配置', '空列表回退默认，非数组返回 400', async () => {
  const empty = await call('/api/nav-modules', {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ modules: [] })
  });
  assert.deepEqual(empty.json().data, ['orders', 'meetings', 'files', 'specs', 'config']);
  const bad = await call('/api/nav-modules', {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ modules: 'orders' })
  });
  assert.equal(bad.status, 400);
});

test('AF. 导航菜单配置', 'GET /api/config 包含 nav_modules 且不泄露 auth', async () => {
  const d = (await call('/api/config')).json();
  assert.ok(Array.isArray(d.data.nav_modules));
  assert.equal(d.data.auth, undefined);
});

test('AF. 导航菜单配置', '前端导航项、配置 UI 与显隐逻辑已接入', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  const nav = fs.readFileSync(path.join(ROOT, 'public', 'js', 'features', 'navigation.js'), 'utf8');
  const cfg = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'config.js'), 'utf8');
  for (const p of ['orders', 'meetings', 'files', 'specs', 'ledgers', 'config']) {
    assert.ok(html.includes(`data-page="${p}"`), `缺少导航项 ${p}`);
  }
  assert.ok(html.includes('id="config-body-nav"') && html.includes('id="nav-modules-list"'));
  assert.ok(app.includes('window.saveNavModules = saveNavModules'));
  assert.ok(nav.includes('function applyNavVisibility') && nav.includes('isNavModuleVisible'));
  assert.ok(cfg.includes('async function loadNavModules') && cfg.includes('async function saveNavModules'));
});

// ==================================================================
// AG. 需求点复制与编辑
// ==================================================================
const pointPageSrc = () => fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'orders.js'), 'utf8');

test('AG. 需求点复制与编辑', '需求点详情逐点提供复制按钮且保留描述换行', () => {
  const vm = require('vm');
  const ctx = { esc: s => String(s == null ? '' : s), document: { getElementById: () => null } };
  vm.runInNewContext(pointPageSrc(), ctx);
  const html = ctx.renderPointItem({ id: 7, point_number: 'A01001', description: '第一行\n第二行', sub_batch: '' }, 3);
  assert.ok(html.includes('onclick="copyPointDesc(7)"'), '应提供逐点复制按钮');
  assert.ok(html.includes('第一行<br>第二行'), '描述换行应正常展示');
  assert.ok(html.includes('onclick="editPoint(7,3)"'), '原有编辑入口应保留');
});

test('AG. 需求点复制与编辑', 'copyPointDesc 复制当前需求点描述原文并按结果提示', async () => {
  const vm = require('vm');
  let copied = '', toast = null;
  const ctx = {
    esc: s => String(s == null ? '' : s),
    document: { getElementById: () => null },
    state: { currentOrder: { points: [{ id: 7, description: '第一条\n第二条' }] } },
    copyText: async t => { copied = t; return true; },
    showToast: (msg, type) => { toast = { msg, type }; }
  };
  vm.runInNewContext(pointPageSrc(), ctx);
  await ctx.copyPointDesc(7);
  assert.equal(copied, '第一条\n第二条', '应复制不含 HTML 的描述原文');
  assert.deepEqual(toast, { msg: '已复制该需求点内容', type: 'success' });
  await ctx.copyPointDesc(999);
  assert.equal(copied, '第一条\n第二条', '空内容不应触发复制');
  ctx.copyText = async () => false;
  await ctx.copyPointDesc(7);
  assert.equal(toast.type, 'error', '复制失败应提示错误');
});

test('AG. 需求点复制与编辑', '长文本自适应高度、字数统计与放大切换可用', () => {
  const vm = require('vm');
  const ta = { value: 'line\n'.repeat(30), style: {}, focus() { this.focused = true; }, addEventListener() {} };
  const counter = { textContent: '' };
  const btn = { textContent: '', title: '' };
  const classes = new Set();
  const modal = { classList: {
    toggle(c) { if (classes.has(c)) { classes.delete(c); return false; } classes.add(c); return true; },
    remove(c) { classes.delete(c); },
    contains(c) { return classes.has(c); }
  } };
  const ctx = {
    esc: s => String(s == null ? '' : s),
    document: {
      getElementById: id => id === 'point-description' ? ta : (id === 'point-desc-count' ? counter : (id === 'point-expand-btn' ? btn : null)),
      querySelector: () => modal
    }
  };
  vm.runInNewContext(pointPageSrc(), ctx);
  ctx.fitPointEditor(ta.value);
  assert.equal(ta.style.height, '520px', '多行内容应自动增高且有上限');
  assert.match(counter.textContent, /31 行/, '应显示行数');
  ctx.togglePointEditorExpand();
  assert.ok(classes.has('point-editor-expanded'));
  assert.equal(btn.textContent, '⤡ 还原窗口');
  assert.ok(ta.focused, '放大后应聚焦编辑框');
  ctx.togglePointEditorExpand();
  assert.ok(!classes.has('point-editor-expanded'));
  assert.equal(btn.textContent, '⤢ 放大编辑');
});

test('AG. 需求点复制与编辑', '编辑弹窗、全局函数与放大样式已接入', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  const modal = html.slice(html.indexOf('id="point-modal"'), html.indexOf('<!-- Quick Schedule Modal -->'));
  assert.ok(modal.includes('class="modal modal-point"'), '编辑弹窗应使用专属宽版样式');
  assert.ok(modal.includes('id="point-expand-btn"'));
  assert.ok(modal.includes('id="point-desc-count"'));
  for (const fn of ['copyPointDesc', 'togglePointEditorExpand', 'updatePointDescCount']) {
    assert.ok(app.includes(`window.${fn} = ${fn}`), `缺少全局函数 ${fn}`);
  }
  assert.ok(css.includes('.modal-point.point-editor-expanded'), '缺少放大编辑样式');
});

test('AG. 需求点复制与编辑', 'copyText 在局域网 http 非安全上下文回退 execCommand', async () => {
  const vm = require('vm');
  let copied = null;
  const ta = { style: {}, focus() {}, select() {}, remove() {}, setAttribute() {}, set value(v) { copied = v; } };
  const ctx = {
    window: { isSecureContext: false, fetch: () => Promise.resolve() },
    navigator: {}, location: { pathname: '/' }, console,
    document: {
      activeElement: null, createElement: () => ta, body: { appendChild() {} },
      execCommand: () => true, querySelectorAll: () => [], getElementById: () => null
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'api.js'), 'utf8'), ctx);
  assert.equal(await ctx.copyText('hello'), true);
  assert.equal(copied, 'hello');
});

// ==================================================================
// AH. 兜底会议（无会议排期）
// ==================================================================
async function getFallbackMeeting() {
  const all = (await call('/api/meetings?include_fallback=1')).json().data;
  return all.find(m => m.meeting_name === '-');
}

test('AH. 兜底会议', '启动自动创建兜底会议，管理列表默认隐藏', async () => {
  const fb = await getFallbackMeeting();
  assert.ok(fb, '应自动创建名称为 - 的兜底会议');
  assert.equal(fb.is_fallback, 1);
  assert.equal(fb.meeting_date, '1900-01-01');
  const list = (await call('/api/meetings')).json().data;
  assert.ok(!list.some(m => m.id === fb.id), '兜底会议不应出现在管理列表');
});

test('AH. 兜底会议', '兜底会议不可新建、改名或删除', async () => {
  const fb = await getFallbackMeeting();
  const create = await call('/api/meetings', { method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ meeting_name: '-', meeting_date: '2026-01-01' }) });
  assert.equal(create.status, 400);
  const edit = await call('/api/meetings/' + fb.id, { method: 'PUT', headers: jsonHeaders,
    body: JSON.stringify({ meeting_name: '-', meeting_date: '2026-01-01', notes: '修改尝试' }) });
  assert.equal(edit.status, 400);
  const del = await call('/api/meetings/' + fb.id, { method: 'DELETE' });
  assert.equal(del.status, 400);
  assert.ok(await getFallbackMeeting(), '兜底会议应仍然存在');
});

test('AH. 兜底会议', '需求点可排入兜底会议且筛选 "-" 精确命中', async () => {
  const fb = await getFallbackMeeting();
  const o = await call('/api/orders', { method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ order_number: 'F01', name: '无会议排期需求', department: '交易中心' }) });
  assert.equal(o.json().success, true);
  const oid = o.json().data.id;
  const p = await call('/api/orders/' + oid + '/points', { method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ description: '未开会直接排期' }) });
  const pid = p.json().data.id;
  const s = await call('/api/meetings/' + fb.id + '/schedules', { method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ order_id: oid, point_id: pid, system: '交易系统', version: 'v1' }) });
  assert.equal(s.json().success, true);

  const f = (await call('/api/schedules/filter?meeting_name=-')).json();
  assert.ok(f.data.some(x => x.point_id === pid), '兜底排期应被检出');
  assert.ok(f.data.every(x => x.meeting_name === '-'), '筛选 "-" 不应命中含连字符的其它会议');
  const ol = (await call('/api/orders?meeting_name=-')).json();
  assert.ok(ol.items.some(x => x.id === oid), '需求单列表按 "-" 筛选应命中');
  assert.equal((await call('/api/export/filtered?meeting_name=-')).status, 200, '导出按 "-" 筛选应可用');
});

test('AH. 兜底会议', '重复初始化不会生成重复兜底记录', () => {
  require('../server/schema.js').initDatabase(db);
  const rows = db.prepare("SELECT id FROM ccb_meetings WHERE meeting_name='-' OR is_fallback=1").all();
  assert.equal(rows.length, 1);
});

test('AH. 兜底会议', '前端下拉与展示已接入兜底会议', () => {
  const sch = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'schedules.js'), 'utf8');
  const ord = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'orders.js'), 'utf8');
  const comp = fs.readFileSync(path.join(ROOT, 'public', 'js', 'components.js'), 'utf8');
  const ren = fs.readFileSync(path.join(ROOT, 'public', 'js', 'features', 'renderers.js'), 'utf8');
  assert.ok((sch.match(/include_fallback=1/g) || []).length >= 3, '排期页 3 处下拉应含兜底会议');
  assert.ok(ord.includes('include_fallback=1'), '整批排期下拉应含兜底会议');
  assert.ok(comp.includes("name === '-' ? '-（未开会排期）'"), '缺少统一展示文案');
  assert.ok(ren.includes('formatMeetingLabel') && ord.includes('formatMeetingLabel'));
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
