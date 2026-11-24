/**
 * 导航功能
 * 页面切换、Tab 切换、Hash 路由
 */

// ---- 导航菜单显隐（服务端全局配置）----
let visibleNavModules = null;

function applyNavVisibility(modules) {
  const picked = new Set(Array.isArray(modules) ? modules : []);
  picked.add('config');  // 参数配置始终保留，避免隐藏后无法从界面恢复
  visibleNavModules = ['orders', 'meetings', 'files', 'specs', 'ledgers', 'config'].filter(m => picked.has(m));
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.style.display = visibleNavModules.includes(el.dataset.page) ? '' : 'none';
  });
}

function isNavModuleVisible(page) {
  if (page === 'config') return true;
  if (!visibleNavModules) return true;  // 配置尚未加载时放行，避免首屏误跳转
  return visibleNavModules.includes(page);
}

function getFirstVisibleModule() {
  const items = Array.from(document.querySelectorAll('.nav-item[data-page]'));
  const first = items.find(el => el.style.display !== 'none');
  return first ? first.dataset.page : 'orders';
}

// ---- 页面导航 ----
function navigate(page) {
  if (!isNavModuleVisible(page)) {
    showToast('该模块未在导航菜单中启用，已切换到可用模块', 'info');
    page = getFirstVisibleModule();
  }
  state.currentPage = page;
  document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  document.querySelector('.top-nav').dataset.page = page;
  document.querySelectorAll('.page-content').forEach(e => e.style.display = 'none');
  document.getElementById(`page-${page}`).style.display = 'block';
  if (page === 'orders') { state.orderPage = 1; loadOrders(); }
  else if (page === 'meetings') { loadMeetings(); switchTab('meeting-mgmt'); }
  else if (page === 'files') loadFiles();
  else if (page === 'specs') { specPage = 1; loadSpecs(); }
  else if (page === 'ledgers') loadLedgers();
  else if (page === 'config') loadConfig();
  if (location.hash !== '#' + page) location.hash = '#' + page;
}

// ---- 排期管理页 Tab 切换 ----
function switchTab(tab) {
  document.querySelectorAll('#page-meetings .tab-item').forEach(t => t.classList.remove('active'));
  document.querySelector(`#page-meetings .tab-item[data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('#page-meetings .tab-content').forEach(t => t.style.display = 'none');
  document.getElementById('tab-' + tab).style.display = 'block';
  if (tab === 'schedule-query') {
    state.schedulePage = 1;
    loadScheduleFilter();
  }
}

// ---- 需求单详情 Tab 切换 ----
function switchDetailTab(tab) {
  document.querySelectorAll('#detail-modal .detail-tab-item').forEach(t => t.classList.remove('active'));
  document.querySelector('#detail-modal .detail-tab-item[data-dtab="' + tab + '"]').classList.add('active');
  document.querySelectorAll('#detail-modal .detail-tab-content').forEach(t => t.style.display = 'none');
  document.getElementById('dtab-' + tab).style.display = 'block';
}

// ---- Hash 路由 ----
document.addEventListener('DOMContentLoaded', async function () {
  // 先读取导航菜单配置并应用显隐，再决定初始页面（隐藏模块的 hash 会自动回退）
  try { const d = await api('/api/nav-modules'); applyNavVisibility(d.data); } catch (e) {}
  const initPage = location.hash && location.hash.slice(1) || 'orders';
  initPreferences();   // 先恢复排序/分组/每页条数，再触发首个列表请求
  loadDropdowns();
  navigate(initPage);
});
window.addEventListener('hashchange', function () {
  const page = location.hash && location.hash.slice(1);
  if (page && page !== state.currentPage) navigate(page);
});

// ---- 全局回车触发的绑定 ----
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('filter-keyword')?.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilters(); });
  const sb = document.getElementById('point-sub-batch');
  if (sb) sb.addEventListener('input', updatePointBatchPreview);
});

// ---- 表单提交自动清理错误 ----
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', clearFieldErrors);
  });
});
