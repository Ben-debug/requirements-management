/**
 * 导航功能
 * 页面切换、Tab 切换、Hash 路由
 */

// ---- 页面导航 ----
function navigate(page) {
  state.currentPage = page;
  document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  document.querySelector('.top-nav').dataset.page = page;
  document.querySelectorAll('.page-content').forEach(e => e.style.display = 'none');
  document.getElementById(`page-${page}`).style.display = 'block';
  if (page === 'orders') { state.orderPage = 1; loadOrders(); }
  else if (page === 'meetings') { loadMeetings(); switchTab('meeting-mgmt'); }
  else if (page === 'files') loadFiles();
  else if (page === 'specs') { specPage = 1; loadSpecs(); }
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
document.addEventListener('DOMContentLoaded', function () {
  const initPage = location.hash && location.hash.slice(1) || 'orders';
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
