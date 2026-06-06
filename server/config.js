const fs = require('fs');
const path = require('path');

let DATA_DIR;
if (process.pkg) {
  DATA_DIR = path.join(path.dirname(process.execPath), 'data');
} else {
  DATA_DIR = path.join(__dirname, '..', 'data');
}

const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
let configCache = null;
let configDirty = false;

const defaults = {
  department: ['交易中心', '清算部', '交割储运部'],
  version: ['2026年端午版本', '2026年国庆版本', '2027年元旦版本'],
  system: ['业务服务平台', '会员服务平台', '竞价交易系统', '清算系统'],
  file_type: ['需求服务单', '需求意向书及评估表', '项目需求书']
};

function ensureDefaults() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const data = structuredClone(defaults);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
    configCache = data;
  }
}

function load() {
  if (configCache) return configCache;
  ensureDefaults();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    configCache = JSON.parse(raw);
    // Merge missing categories with defaults
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
    configCache = structuredClone(defaults);
    return configCache;
  }
}

function save() {
  if (!configCache) return;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(configCache, null, 2), 'utf-8');
}

function getAll() {
  return load();
}

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

module.exports = { getAll, getCategory, addItem, deleteItem, load };