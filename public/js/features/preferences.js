/**
 * 用户偏好：排序 / 分组 / 每页条数（localStorage，按浏览器保存）
 *
 * 兼容策略：
 * - 键名带版本；旧版本没有此键时全部走内置默认，行为与旧版一致
 * - URL 显式参数优先于已保存偏好，但不写回存储（旧书签不会悄悄改掉用户设置）
 * - 读取时逐字段合并 + 白名单校验，损坏 JSON / 隐私模式均安全回退
 */
const PREF_KEY = 'reqmgr.preferences.v1';

// 与 public/index.html 中各下拉的 selected 默认值及现有硬编码 pageSize 对齐
const PREF_DEFAULTS = {
  orders: { sort: 'order_number', order: 'asc', group_by: 'none', pageSize: 10 },
  schedules: { group_by: 'version', pageSize: 20 },
  specs: { group_by: 'version', pageSize: 20 },
  files: { group_by: 'department', pageSize: 20 }
};

const PREF_WHITELIST = {
  'orders.sort': ['created_at', 'order_number', 'propose_date', 'department', 'name'],
  'orders.order': ['asc', 'desc'],
  'orders.group_by': ['none', 'department'],
  'schedules.group_by': ['', 'version', 'department', 'meeting', 'system'],
  'specs.group_by': ['', 'version', 'department', 'system', 'archive_category'],
  'files.group_by': ['', 'department', 'type']
};
const PREF_PAGE_SIZES = [10, 20, 50, 100];

function normalizePreference(page, key, value) {
  const def = PREF_DEFAULTS[page] && PREF_DEFAULTS[page][key];
  if (def === undefined) return undefined;
  if (key === 'pageSize') {
    const n = Number(value);
    return PREF_PAGE_SIZES.includes(n) ? n : def;
  }
  const list = PREF_WHITELIST[page + '.' + key];
  const s = String(value == null ? '' : value);
  return list && list.includes(s) ? s : def;
}

function loadPreferences() {
  const out = {};
  for (const page of Object.keys(PREF_DEFAULTS)) {
    out[page] = {};
    for (const key of Object.keys(PREF_DEFAULTS[page])) out[page][key] = PREF_DEFAULTS[page][key];
  }
  let raw;
  try { raw = localStorage.getItem(PREF_KEY); } catch (e) { return out; }
  if (!raw) return out;
  try {
    const stored = JSON.parse(raw);
    if (!stored || typeof stored !== 'object') return out;
    for (const page of Object.keys(PREF_DEFAULTS)) {
      const src = stored[page];
      if (!src || typeof src !== 'object') continue;
      for (const key of Object.keys(PREF_DEFAULTS[page])) {
        if (Object.prototype.hasOwnProperty.call(src, key)) {
          out[page][key] = normalizePreference(page, key, src[key]);
        }
      }
    }
  } catch (e) { /* 损坏数据整体回退默认 */ }
  return out;
}

/** 保存单项偏好；每次重读存储，避免多标签页互相覆盖 */
function savePreference(page, key, value) {
  if (!PREF_DEFAULTS[page] || !Object.prototype.hasOwnProperty.call(PREF_DEFAULTS[page], key)) return undefined;
  const prefs = loadPreferences();
  const normalized = normalizePreference(page, key, value);
  prefs[page][key] = normalized;
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {}
  if (typeof state !== 'undefined' && state.prefs) state.prefs[page][key] = normalized;
  return normalized;
}

/**
 * 取值优先级：URL 显式参数 > 已保存偏好 > 内置默认。
 * 用 has() 区分「显式传入」与「没传」，不能用 get() || 默认。
 */
function resolvePreference(page, key, urlParams) {
  const url = urlParams || (typeof location !== 'undefined' ? new URLSearchParams(location.search) : null);
  if (url && typeof url.has === 'function' && url.has(key)) {
    return normalizePreference(page, key, url.get(key));
  }
  if (typeof state !== 'undefined' && state.prefs && state.prefs[page]) {
    return normalizePreference(page, key, state.prefs[page][key]);
  }
  return normalizePreference(page, key, loadPreferences()[page][key]);
}

/** 首次加载时把偏好写回静态控件；URL 显式值覆盖控件但不写回存储 */
function initPreferences() {
  const url = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const prefs = loadPreferences();
  if (typeof state !== 'undefined') state.prefs = prefs;
  const controls = [
    ['filter-sort', 'orders', 'sort'],
    ['filter-order', 'orders', 'order'],
    ['filter-group-orders', 'orders', 'group_by'],
    ['pagination-page-size', 'orders', 'pageSize'],
    ['filter-group', 'schedules', 'group_by'],
    ['sq-group', 'specs', 'group_by'],
    ['sq-page-size', 'specs', 'pageSize'],
    ['file-filter-group', 'files', 'group_by']
  ];
  for (const [id, page, key] of controls) {
    const el = document.getElementById(id);
    if (!el) continue; // orders 的 pageSize 下拉是分页渲染时动态生成的，交给 getFilterParams 兜底
    const raw = (url && url.has(key)) ? url.get(key) : prefs[page][key];
    const value = String(normalizePreference(page, key, raw));
    if (el.tagName === 'SELECT' && !Array.from(el.options || []).some(o => o.value === value)) continue;
    el.value = value;
  }
  return prefs;
}
