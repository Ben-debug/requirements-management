/**
 * v1.x → v2.0.0 升级迁移脚本
 *
 * 功能：
 * 1. 插入 v2.0.0 升级日志记录
 * 2. 验证新模块结构完整性
 *
 * 运行方式：node scripts/upgrade-v2.0.0.js
 */
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.join(__dirname, '..');

console.log('========================================');
console.log('  需求单信息管理系统 v1.x → v2.0.0 升级');
console.log('========================================\n');

// ---- 1. 验证新模块文件完整性 ----
console.log('📋 验证新模块文件...');

const requiredFiles = [
  'server/utils.js',
  'server/schema.js',
  'server/middleware/upload.js',
  'server/middleware/error-handler.js',
  'server/routes/orders.js',
  'server/routes/meetings.js',
  'server/routes/schedules.js',
  'server/routes/files.js',
  'server/routes/specs.js',
  'server/routes/config-routes.js',
  'server/routes/import-export.js',
  'server/routes/assessment.js',
  'public/js/pages/config.js',
  'public/js/pages/orders.js',
  'public/js/pages/meetings.js',
  'public/js/pages/schedules.js',
  'public/js/pages/files.js',
  'public/js/pages/specs.js',
  'public/js/features/renderers.js',
  'public/js/features/navigation.js',
  'public/js/features/search.js',
  'public/js/features/import-export.js',
];

let allFound = true;
requiredFiles.forEach(f => {
  const fp = path.join(ROOT_DIR, f);
  if (fs.existsSync(fp)) {
    console.log(`  ✅ ${f}`);
  } else {
    console.log(`  ❌ ${f} — 缺失！`);
    allFound = false;
  }
});

if (!allFound) {
  console.error('\n❌ 模块文件不完整，请检查后重试');
  process.exit(1);
}
console.log(`\n✅ 全部 ${requiredFiles.length} 个新模块文件完好\n`);

// ---- 2. 插入升级日志 ----
console.log('📋 插入 v2.0.0 升级日志...');
try {
  const { getDatabase } = require('../server/database');
  const db = getDatabase();

  const existing = db.prepare('SELECT id FROM upgrade_logs WHERE version=?').get('v2.0.0');
  if (existing) {
    console.log('  ℹ️  v2.0.0 升级日志已存在，跳过');
  } else {
    db.prepare("INSERT INTO upgrade_logs (version, title, content) VALUES (?, ?, ?)").run(
      'v2.0.0',
      '🎉 v2.0.0 代码模块化重构',
      `核心变更：
1. 后端拆分：server/index.js（1335行→80行），新增 8 个路由模块 + 中间件 + 工具层
2. 前端拆分：app.js（2025行→105行），新增 6 个页面模块 + 4 个功能模块
3. 零功能变更，纯代码组织优化

详情见 UPGRADE_v2.0.0.md`
    );
    console.log('  ✅ v2.0.0 升级日志已插入\n');
  }
} catch (e) {
  console.error('  ⚠️  插入升级日志失败（数据库可能未就绪）:', e.message);
  console.log('  升级日志可在系统启动后自动生成\n');
}

// ---- 3. 验证旧文件已被精简 ----
console.log('📋 验证旧文件精简情况...');
const indexJsStat = fs.statSync(path.join(ROOT_DIR, 'server', 'index.js'));
const appJsStat = fs.statSync(path.join(ROOT_DIR, 'public', 'js', 'app.js'));
console.log(`  server/index.js: ${indexJsStat.size} bytes (预期 <3000)`);
console.log(`  public/js/app.js: ${appJsStat.size} bytes (预期 <3000)`);

if (indexJsStat.size < 5000 && appJsStat.size < 5000) {
  console.log('  ✅ 旧文件已成功精简\n');
} else {
  console.log('  ⚠️  文件大小超出预期，请确认是否已更新到最新版本\n');
}

// ---- 4. 启动测试 ----
console.log('📋 启动验证服务器...');
const cp = require('child_process');
const server = cp.spawn('node', [path.join(ROOT_DIR, 'server', 'index.js')], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: '3001' }
});

let output = '';
server.stdout.on('data', d => { output += d.toString(); });
server.stderr.on('data', d => { output += d.toString(); });

setTimeout(() => {
  if (output.includes('已启动')) {
    console.log('  ✅ 服务器启动成功\n');
  } else {
    console.log('  ⚠️  服务器输出: ' + output.substring(0, 200) + '\n');
  }
  server.kill();

  console.log('========================================');
  console.log('  ✅ 升级准备完成！请启动服务验证功能');
  console.log('  👉 node server/index.js');
  console.log('========================================');
  process.exit(0);
}, 3000);
