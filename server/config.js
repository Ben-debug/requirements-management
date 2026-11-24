const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const defaults = {
  department: ['交易中心', '清算部', '交割储运部'],
  version: ['2026年端午版本', '2026年国庆版本', '2027年元旦版本'],
  system: ['业务服务平台', '会员服务平台', '竞价交易系统', '清算系统'],
  file_type: ['需求服务单', '需求意向书及评估表', '项目需求书'],
  project: [],
  system_alias: [],
  // 部门/项目改名后的历史别名，格式「标准名=旧名1,旧名2」，用于匹配与筛选等价
  department_alias: [],
  project_alias: [],
  version_alias: [],
  // 导航菜单中默认显示的模块；工作台账前期不用，默认不在导航栏展示
  nav_modules: ['orders', 'meetings', 'files', 'specs', 'config'],
  paths: { data_dir: '', flow_files_dir: '', meeting_files_dir: '', service_order_dir: '', spec_docs_dir: '', backup_dir: '' }
};

// 导航模块：与 public/index.html 中 .nav-item[data-page] 一一对应
const NAV_MODULES = ['orders', 'meetings', 'files', 'specs', 'ledgers', 'config'];
const NAV_ALWAYS_VISIBLE = 'config';

/** 规范化导航模块列表：过滤未知项、去重、固定顺序、强制包含参数配置 */
function normalizeNavModules(list) {
  if (!Array.isArray(list) || list.length === 0) return [...defaults.nav_modules];
  const picked = new Set(list.filter(x => NAV_MODULES.includes(x)));
  picked.add(NAV_ALWAYS_VISIBLE);
  const out = NAV_MODULES.filter(x => picked.has(x));
  return out.length ? out : [...defaults.nav_modules];
}

// 默认配置目录：项目 data/ 或 exe 同级 data/
let configDir;
if (process.pkg) {
  configDir = path.join(path.dirname(process.execPath), 'data');
} else {
  configDir = path.join(__dirname, '..', 'data');
}

let configCache = null;

function configPath() {
  return path.join(configDir, 'config.json');
}

function ensureDefaults() {
  const cp = configPath();
  if (!fs.existsSync(cp)) {
    const data = structuredClone(defaults);
    fs.writeFileSync(cp, JSON.stringify(data, null, 2), 'utf-8');
    configCache = data;
  }
}

function load() {
  if (configCache) return configCache;
  ensureDefaults();
  const cp = configPath();
  try {
    const raw = fs.readFileSync(cp, 'utf-8');
    configCache = JSON.parse(raw);
    let changed = false;
    for (const [cat, items] of Object.entries(defaults)) {
      if (!configCache[cat]) {
        configCache[cat] = [...items];
        changed = true;
      }
    }
    if (changed) save();
    return configCache;
  } catch (e) {
    return structuredClone(defaults);
  }
}

function save() {
  if (!configCache) return;
  fs.writeFileSync(configPath(), JSON.stringify(configCache, null, 2), 'utf-8');
}

// ---- 公开 API ----

function getAll() { return load(); }

function getCategory(cat) {
  const data = load();
  return data[cat] || [];
}

function getNavModules() { return normalizeNavModules(getCategory('nav_modules')); }

function setNavModules(list) {
  const data = load();
  data.nav_modules = normalizeNavModules(list);
  save();
  return data.nav_modules.slice();
}

function addItem(cat, label) {
  const data = load();
  if (!data[cat]) data[cat] = [];
  if (data[cat].includes(label)) return false;
  data[cat].push(label);
  save();
  return true;
}

function deleteItem(cat, label) {
  const data = load();
  if (!data[cat]) return false;
  const idx = data[cat].indexOf(label);
  if (idx === -1) return false;
  data[cat].splice(idx, 1);
  save();
  return true;
}

// 可改名的分类：系统别名只影响后续扫描；部门/项目/版本改名时可自行选择是否同步更新历史数据
const EDITABLE_CATEGORIES = new Set(['system_alias', 'department', 'project', 'version']);
const ALIAS_CATEGORY = { department: 'department_alias', project: 'project_alias', version: 'version_alias' };
function isEditable(cat) { return EDITABLE_CATEGORIES.has(cat); }

/** 原地改名（保持位置不变）；newLabel 不能为空或与已有项重复 */
function updateItem(cat, oldLabel, newLabel) {
  if (!isEditable(cat)) return false;
  const data = load();
  if (!Array.isArray(data[cat])) return false;
  const idx = data[cat].indexOf(oldLabel);
  const next = String(newLabel || '').trim();
  if (idx === -1 || !next) return false;
  if (next !== oldLabel && data[cat].includes(next)) return false;
  data[cat][idx] = next;
  const aliasCat = ALIAS_CATEGORY[cat];
  if (aliasCat && next !== oldLabel) {
    // 旧标准名连同其已有别名一并挂到新标准名下，展平避免链式别名
    const entries = getAliasEntries(cat);
    const carried = [];
    const kept = [];
    let existing = null;
    for (const e of entries) {
      if (e.canonical === oldLabel) carried.push(...e.aliases);
      else if (e.canonical === next) existing = e;
      else kept.push(e);
    }
    const aliases = [...new Set([oldLabel, ...carried, ...(existing ? existing.aliases : [])])].filter(a => a !== next);
    if (aliases.length) kept.push({ canonical: next, aliases });
    data[aliasCat] = kept.map(e => `${e.canonical}=${e.aliases.join(',')}`);
  }
  save();
  return true;
}

// ---- 历史别名：旧名仍视为同一个部门/项目，避免改名后旧数据与筛选失配 ----
function getAliasEntries(cat) {
  const aliasCat = ALIAS_CATEGORY[cat];
  if (!aliasCat) return [];
  const out = [];
  for (const line of getCategory(aliasCat)) {
    const s = String(line || '').trim();
    const eq = s.indexOf('=');
    if (eq <= 0) continue;
    const canonical = s.slice(0, eq).trim();
    if (!canonical) continue;
    const aliases = s.slice(eq + 1).split(/[,，、]+/).map(x => x.trim()).filter(Boolean);
    if (aliases.length) out.push({ canonical, aliases });
  }
  return out;
}

function getAliases(cat) {
  const map = {};
  for (const { canonical, aliases } of getAliasEntries(cat)) {
    for (const alias of aliases) map[alias] = canonical;
  }
  return map;
}

/** 返回与该名称等价的全部名称（标准名 + 历史别名），用于筛选；未知名称原样返回 */
function expandNames(cat, name) {
  const target = String(name || '').trim();
  if (!target) return [];
  const aliases = getAliases(cat);
  let canonical = target;
  const seen = new Set();
  while (aliases[canonical] && !seen.has(canonical)) {
    seen.add(canonical);
    canonical = aliases[canonical];
  }
  const names = new Set([canonical, target]);
  for (const [alias, c] of Object.entries(aliases)) {
    if (c === canonical) names.add(alias);
  }
  return [...names];
}

/** 配置快照与恢复：用于改名时数据库更新失败后的回滚 */
function snapshot() { return structuredClone(load()); }
function restore(snap) { configCache = structuredClone(snap); save(); }

/** 按给定顺序重排分类项：labels 必须是现有条目的完整、不重复排列 */
function reorderCategory(cat, labels) {
  const data = load();
  if (!data[cat] || !Array.isArray(labels)) return false;
  if (labels.length !== data[cat].length) return false;
  if (new Set(labels).size !== labels.length) return false;
  if (labels.some(x => !data[cat].includes(x))) return false;
  data[cat] = labels.slice();
  save();
  return true;
}

function getPath(name) {
  const data = load();
  const paths = data.paths || {};
  return paths[name] || '';
}

function setPath(name, value) {
  const data = load();
  if (!data.paths) data.paths = {};
  data.paths[name] = value;
  save();
  return true;
}

/** 切换 config.json 的存放目录（配合自定义 data_dir），清空缓存 */
function setConfigDir(dir) {
  if (!dir || dir === configDir) return;
  configDir = dir;
  configCache = null;  // 强制下次 load() 重新读取新路径
}

function getConfigPath() {
  return configPath();
}

/** 读取访问口令（config.json 的 auth.password，可能是加盐哈希或旧明文） */
function getAuthPassword() {
  const data = load();
  return data.auth && data.auth.password ? String(data.auth.password) : '';
}

const PWD_PREFIX = 'scrypt$';
/** 写入访问口令：加盐 scrypt 哈希，空串表示未设置 */
function setAuthPassword(pwd) {
  const data = load();
  if (!pwd) {
    data.auth = { password: '' };
  } else {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
    data.auth = { password: `${PWD_PREFIX}${salt}$${hash}` };
  }
  save();
}

function isLegacyPassword(stored) {
  return !!stored && String(stored).indexOf(PWD_PREFIX) !== 0;
}

/** 校验口令，兼容旧明文存储（调用方登录成功后可透明升级为哈希） */
function verifyPassword(plain, stored) {
  if (!stored || plain == null) return false;
  const s = String(stored);
  if (isLegacyPassword(s)) {
    const a = Buffer.from(String(plain));
    const b = Buffer.from(s);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const parts = s.split('$');
  if (parts.length !== 3) return false;
  try {
    const actual = crypto.scryptSync(String(plain), parts[1], 32);
    const expected = Buffer.from(parts[2], 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (e) { return false; }
}

module.exports = { getAll, getCategory, addItem, deleteItem, updateItem, isEditable, reorderCategory, getAliasEntries, getAliases, expandNames, snapshot, restore, getPath, setPath, load, setConfigDir, getConfigPath, getAuthPassword, setAuthPassword, verifyPassword, isLegacyPassword, getNavModules, setNavModules, normalizeNavModules };