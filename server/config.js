const fs = require('fs');
const path = require('path');

const defaults = {
  department: ['交易中心', '清算部', '交割储运部'],
  version: ['2026年端午版本', '2026年国庆版本', '2027年元旦版本'],
  system: ['业务服务平台', '会员服务平台', '竞价交易系统', '清算系统'],
  file_type: ['需求服务单', '需求意向书及评估表', '项目需求书'],
  paths: { data_dir: '', flow_files_dir: '', meeting_files_dir: '', service_order_dir: '' }
};

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

module.exports = { getAll, getCategory, addItem, deleteItem, getPath, setPath, load, setConfigDir, getConfigPath };