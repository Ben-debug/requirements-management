const state = {
  currentPage:'orders', orders:[], currentOrder:null, meetings:[],
  editingOrderId:null, editingPointId:null, editingMeetingId:null, editingScheduleId:null,
  orderPage:1, schedulePage:1
};

async function api(url, opts={}) {
  const res = await fetch(url, { headers:{'Content-Type':'application/json', ...opts.headers}, ...opts });
  const data = await res.json();
  if (!data.success) throw new Error(data.message||'请求失败');
  return data;
}

function showToast(msg, type='info') {
  const t = document.createElement('div'); t.className = `toast toast-${type}`; t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function navigate(page) {
  state.currentPage = page;
  document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  document.querySelector('.top-nav').dataset.page = page;
  document.querySelectorAll('.page-content').forEach(e => e.style.display = 'none');
  document.getElementById(`page-${page}`).style.display = 'block';
  if (page === 'orders') { state.orderPage = 1; loadOrders(); }
  else if (page === 'meetings') { loadMeetings(); switchMeetingTab('meeting-mgmt'); }
  else if (page === 'files') loadFiles();
  else if (page === 'config') loadConfig();
}

function switchMeetingTab(tab) {
  document.querySelectorAll('#page-meetings .tab-item').forEach(t => t.classList.remove('active'));
  document.querySelector(`#page-meetings .tab-item[data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('#page-meetings .tab-content').forEach(t => t.style.display = 'none');
  document.getElementById('tab-' + tab).style.display = 'block';
  if (tab === 'schedule-query') {
    state.schedulePage = 1;
    loadScheduleFilter();
  }
}

function switchDetailTab(tab) {
  document.querySelectorAll('#detail-modal .detail-tab-item').forEach(t => t.classList.remove('active'));
  document.querySelector('#detail-modal .detail-tab-item[data-dtab="' + tab + '"]').classList.add('active');
  document.querySelectorAll('#detail-modal .detail-tab-content').forEach(t => t.style.display = 'none');
  document.getElementById('dtab-' + tab).style.display = 'block';
}

/** 显示导入/导出结果弹窗 */
function showResultModal(options) {
  const { title, type, stats, warnings, filename } = options;
  document.getElementById('result-modal-title').textContent = title || '📊 结果';
  let html = '';
  // 状态图标
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  html += `<div style="text-align:center;font-size:16px;font-weight:600;margin-bottom:16px">${icon} ${type === 'success' ? '操作成功' : type === 'error' ? '操作失败' : ''}</div>`;
  // 统计面板
  if (stats && stats.length) {
    html += '<div style="background:#f6ffed;border:1px solid #b7eb8f;border-radius:6px;padding:12px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px">';
    stats.forEach(s => {
      html += `<div style="flex:1;min-width:100px;text-align:center"><div style="font-size:22px;font-weight:700;color:#52c41a">${s.count}</div><div style="font-size:12px;color:#666">${s.label}</div></div>`;
    });
    html += '</div>';
  }
  // 文件名（导出）
  if (filename) {
    html += `<div style="background:#fff7e6;border:1px solid #ffd591;border-radius:6px;padding:10px 12px;margin-bottom:12px;font-size:13px;color:#666">📎 ${esc(filename)}</div>`;
  }
  // 警告
  if (warnings && warnings.length) {
    html += `<div style="background:#fffbe6;border:1px solid #ffe58f;border-radius:6px;padding:10px 12px">`;
    html += `<div style="font-weight:600;font-size:13px;color:#d48806;margin-bottom:6px">⚠️ 警告（${warnings.length}条）</div>`;
    html += `<div style="max-height:200px;overflow-y:auto;font-size:13px;color:#666">`;
    warnings.forEach(w => { html += `<div style="padding:2px 0">• ${esc(w)}</div>`; });
    html += '</div></div>';
  }
  document.getElementById('result-modal-body').innerHTML = html;
  openModal('result-modal');
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});

async function loadDropdowns() {
  try {
    const [depts, vers, sys, ftypes] = await Promise.all([
      api('/api/config/department'), api('/api/config/version'), api('/api/config/system'), api('/api/config/file_type')
    ]);
    fillSelect('department', depts.data, '请选择业务部门');
    fillSelect('detail-schedule-version', vers.data, '请选择版本');
    fillSelect('edit-schedule-version', vers.data, '请选择版本');
    fillSelect('file-type', ftypes.data, '选择文件类型');
  } catch(e) { console.error("loadDropdowns error:", e); }
}

function fillSelect(id, items, placeholder) {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = `<option value="">${placeholder}</option>`;
  items.forEach(i => { const o = document.createElement('option'); o.value = i; o.textContent = i; el.appendChild(o); });
}

function renderSystemCheckboxes(containerId, systems, selectedArr) {
  const container = document.getElementById(containerId); if (!container) return;
  container.innerHTML = '';
  (systems||[]).forEach(s => {
    const label = document.createElement('label');
    label.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:6px 10px;margin:3px;border:1px solid #d9d9d9;border-radius:4px;cursor:pointer;font-size:13px';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = s; cb.className = 'system-cb';
    if (selectedArr && selectedArr.includes(s)) cb.checked = true;
    label.appendChild(cb); label.appendChild(document.createTextNode(s));
    label.onmouseover = () => label.style.borderColor = '#1890ff';
    label.onmouseout = () => label.style.borderColor = '#d9d9d9';
    container.appendChild(label);
  });
}

function getSelectedSystems(containerId) {
  const root = containerId ? document.getElementById(containerId) : document;
  return Array.from(root.querySelectorAll('.system-cb:checked')).map(cb => cb.value);
}
function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

// ---- Config Accordion ----
function toggleConfigGroup(header) {
  const body = header.nextElementSibling;
  const arrow = header.querySelector('.arrow');
  body.classList.toggle('open');
  arrow.classList.toggle('open');
}

async function loadConfig() {
  try {
    const d = await api('/api/config'); const data = d.data;
    ['department','version','system','file_type'].forEach(cat => {
      const body = document.getElementById(`config-body-${cat}`);
      const count = document.getElementById(`config-${cat}-count`);
      const items = data[cat] || [];
      if (count) count.textContent = `${items.length}项`;
      if (!body) return;
      if (!items.length) { body.innerHTML = '<div class="config-item"><span style="color:#999">暂无配置</span></div><div style="margin-top:8px"><button class="btn btn-sm btn-primary" onclick="showAddConfig(\''+cat+'\')">＋ 添加</button></div>'; return; }
      body.innerHTML = items.map(item => `<div class="config-item"><span>${esc(item)}</span><button class="btn btn-sm btn-danger" onclick="deleteConfigItem('${cat}','${esc(item)}')">删除</button></div>`).join('') +
        `<div style="margin-top:8px"><button class="btn btn-sm btn-primary" onclick="showAddConfig('${cat}')">＋ 添加</button></div>`;
    });
  } catch(e) { console.error(e); }
  loadPaths();
}

function showAddConfig(cat) {
  const labels = {department:'业务部门', version:'上线版本', system:'涉及改造系统', file_type:'流转文件类型'};
  document.getElementById('config-modal-title').textContent = `添加${labels[cat]}`;
  document.getElementById('config-label-text').textContent = `${labels[cat]}名称 *`;
  document.getElementById('config-category-input').value = cat;
  document.getElementById('config-item-input').value = '';
  openModal('config-modal'); document.getElementById('config-item-input').focus();
}

async function addConfigItem() {
  const cat = document.getElementById('config-category-input').value;
  const lbl = document.getElementById('config-item-input').value.trim();
  if (!lbl) { showToast('请输入名称','error'); return; }
  try { await api('/api/config',{method:'POST',body:JSON.stringify({category:cat,label:lbl})}); showToast('添加成功','success'); closeModal('config-modal'); loadConfig(); } catch(e) {}
}

async function deleteConfigItem(cat, label) {
  if (!confirm('确定删除？')) return;
  try { await api(`/api/config/${encodeURIComponent(cat)}/${encodeURIComponent(label)}`,{method:'DELETE'}); showToast('已删除','success'); loadConfig(); } catch(e) {}
}

// ---- Path Settings ----
async function loadPaths() {
  try {
    const r = await fetch('/api/config/paths');
    const d = await r.json();
    if (!d.success) return;
    const p = d.data;
    document.getElementById('path-data-dir').value = p.data_dir || '';
    document.getElementById('path-flow-files').value = p.flow_files_dir || '';
    document.getElementById('path-meeting-files').value = p.meeting_files_dir || '';
    document.getElementById('path-data-dir').placeholder = p.defaults?.data_dir || 'data/';
    document.getElementById('path-flow-files').placeholder = p.defaults?.flow_files_dir || 'public/uploads/flow_files/';
    document.getElementById('path-meeting-files').placeholder = p.defaults?.meeting_files_dir || 'public/uploads/meeting_files/';
  } catch(e) { console.error("loadPaths error:", e); }
  document.getElementById('path-save-status').textContent = '';
}

function onPathChange() {
  document.getElementById('path-save-status').textContent = '⚠️ 已修改，点击保存';
}

async function savePaths() {
  const btn = document.querySelector('button[onclick="savePaths()"]');
  btn.disabled = true;
  btn.textContent = '保存中...';
  try {
    const r = await fetch('/api/config/paths', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        data_dir: document.getElementById('path-data-dir').value.trim(),
        flow_files_dir: document.getElementById('path-flow-files').value.trim(),
        meeting_files_dir: document.getElementById('path-meeting-files').value.trim()
      })
    });
    const d = await r.json();
    if (d.success) {
      showToast(d.message, 'success');
      document.getElementById('path-save-status').textContent = '✅ 已保存';
      loadPaths();
    } else {
      showToast(d.message, 'error');
    }
  } catch(e) {
    showToast('保存失败', 'error');
  }
  btn.disabled = false;
  btn.textContent = '保存路径设置';
}

// ---- Orders with Pagination + Filters ----
function getFilterParams() {
  const pageSize = parseInt(document.getElementById('pagination-page-size')?.value) || 10;
  const params = { page: state.orderPage, pageSize: pageSize > 0 ? pageSize : 10 };
  const dept = document.getElementById('filter-department')?.value;
  if (dept) params.department = dept;
  const df = document.getElementById('filter-date-from')?.value;
  if (df) params.date_from = df;
  const dt = document.getElementById('filter-date-to')?.value;
  if (dt) params.date_to = dt;
  const sort = document.getElementById('filter-sort')?.value;
  if (sort) params.sort = sort;
  const order = document.getElementById('filter-order')?.value;
  if (order) params.order = order;
  const group_by = document.getElementById('filter-group-orders')?.value;
  if (group_by) params.group_by = group_by;
  return params;
}

async function loadOrders() {
  try {
    const params = getFilterParams();
    const qs = Object.entries(params).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
    const r = await api(`/api/orders?${qs}`);
    state.orders = r.items;
    document.getElementById('filter-result-info').textContent = r.total ? `共 ${r.total} 条` : '';
    const tbody = document.querySelector('#orders-table tbody');
    if (!r.items.length) { tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="icon">🔍</div><p>暂无匹配的需求单</p></div></td></tr>'; renderPagination('orders-pagination', r); return; }
    
    function orderRow(o) {
      const rds = o.related_departments ? o.related_departments.split(',').filter(Boolean) : [];
      // 计算排期状态
      var schedCount = (o.schedule_summary||{}).scheduled || 0, totalPoints = (o.schedule_summary||{}).total || 0;
	      var projCount = (o.schedule_summary||{}).project_count || 0;
      var schedHtml = '';
      if (totalPoints === 0) {
        schedHtml = '<span style="font-size:12px;color:#999">—</span>';
      } else if (schedCount === totalPoints) {
        schedHtml = '<span style="font-size:12px;color:#52c41a;font-weight:500">✅ ' + schedCount + '/' + totalPoints + '</span>';
      } else if (schedCount > 0) {
        schedHtml = '<span style="font-size:12px;color:#fa8c16;font-weight:500">⏳ ' + schedCount + '/' + totalPoints + '</span>';
      } else {
        schedHtml = '<span style="font-size:12px;color:#ff4d4f;font-weight:500">⏳ 0/' + totalPoints + '</span>';
      var projHtml = projCount ? '<span class="badge badge-orange" style="margin-left:4px">📋 立项</span>' : '';
      }
      return `<tr>
      <td><a href="javascript:void(0)" onclick="window.viewOrder(${o.id})" style="color:#1890ff;font-weight:600;text-decoration:underline">${o.order_number}</a></td>
      <td>${esc(o.name)}</td><td>${esc(o.department||'-')}</td>
      <td>${rds.length ? rds.map(d=>'<span class="badge badge-blue">'+esc(d.trim())+'</span>').join(' ') : '-'}</td>
      <td>${esc(o.proposer||'-')}</td>
      <td>${o.propose_date||'-'}</td><td>${esc(o.business_launch_date||'-')}</td>
      <td style="text-align:center">${schedHtml}${projHtml}</td>
      <td><div class="action-group"><button class="btn btn-sm" onclick="window.viewOrder(${o.id})">查看</button><button class="btn btn-sm" onclick="window.editOrder(${o.id})">编辑</button><button class="btn btn-sm btn-danger" onclick="window.deleteOrder(${o.id})">删除</button></div></td>
    </tr>`;
    }
    
    if (r.grouped) {
      // 分组展示（可折叠，无分页）
      let html = '';
      Object.keys(r.grouped).sort().forEach(key => {
        html += `<tr class="group-header" onclick="toggleOrderGroup(this)" data-collapsed="false"><td colspan="9" style="padding:8px 12px;font-weight:600;font-size:14px;color:#1890ff;background:#e6f7ff;cursor:pointer;user-select:none">📁 ${esc(key)}（${r.grouped[key].length}条） <span class="group-arrow" style="float:right;margin-right:8px">▼</span></td></tr>`;
        r.grouped[key].forEach(o => { html += orderRow(o); });
      });
      tbody.innerHTML = html;
      document.getElementById('orders-pagination').innerHTML = '';
    } else {
      tbody.innerHTML = r.items.map(o => orderRow(o)).join('');
      renderPagination('orders-pagination', r);
    }
    if (r.filters?.departments) {
      const sel = document.getElementById('filter-department');
      if (sel && sel.options.length <= 1) {
        r.filters.departments.forEach(d => { const o = document.createElement('option'); o.value = d; o.textContent = d; sel.appendChild(o); });
      }
    }
  } catch(e) { console.error("loadOrders error:", e); }
}

async function applyFilters() {
  state.orderPage = 1; loadOrders();
}
function onFilterChange() {
  state.orderPage = 1; loadOrders();
}
function resetFilters() {
  document.getElementById('filter-department').value = '';
  document.getElementById('filter-date-from').value = '';
  document.getElementById('filter-date-to').value = '';
  document.getElementById('filter-group-orders').value = 'department';
  document.getElementById('filter-sort').value = 'order_number';
  document.getElementById('filter-order').value = 'asc';
  state.orderPage = 1; loadOrders();
}
function renderPagination(containerId, r) {
  const c = document.getElementById(containerId); if (!c) return;
  if (!r || r.totalPages <= 1) { c.innerHTML = ''; return; }
  c.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;width:100%">
    <div>
      <button class="page-btn" onclick="gotoOrderPage(1)" ${r.page<=1?'disabled':''}>«</button>
      <button class="page-btn" onclick="gotoOrderPage(${r.page-1})" ${r.page<=1?'disabled':''}>‹</button>
      <span class="page-info">第 ${r.page}/${r.totalPages} 页 (共${r.total}条)</span>
      <button class="page-btn" onclick="gotoOrderPage(${r.page+1})" ${r.page>=r.totalPages?'disabled':''}>›</button>
      <button class="page-btn" onclick="gotoOrderPage(${r.totalPages})" ${r.page>=r.totalPages?'disabled':''}>»</button>
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:12px;color:#999">每页</span>
      <select id="pagination-page-size" onchange="gotoOrderPage(1); loadOrders();" style="padding:4px 6px;border:1px solid #d9d9d9;border-radius:4px;font-size:12px">
        <option value="10">10</option>
        <option value="20">20</option>
        <option value="50">50</option>
        <option value="100">100</option>
      </select>
    </div>
  </div>`;
}

// 按回车触发查询
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('filter-keyword')?.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilters(); });
});

function gotoOrderPage(p) { state.orderPage = p; loadOrders(); }
function gotoSchedulePage(p) { state.schedulePage = p; applyFilter(); }

// 折叠/展开分组
function toggleOrderGroup(header) {
  const isCollapsed = header.dataset.collapsed === 'true';
  let el = header.nextElementSibling;
  while (el && el.tagName === 'TR' && !el.classList.contains('group-header')) {
    el.style.display = isCollapsed ? '' : 'none';
    el = el.nextElementSibling;
  }
  header.dataset.collapsed = isCollapsed ? 'false' : 'true';
  header.querySelector('.group-arrow').textContent = isCollapsed ? '▼' : '▶';
}

document.getElementById('order-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  clearFieldErrors();
  const form = e.target;
  const fd = new FormData(form);
  // Convert FormData to object - handle multiple checkboxes
  const data = {};
  for (const [key, val] of fd.entries()) {
    if (key === 'related_departments') {
      if (!data[key]) data[key] = [];
      data[key].push(val);
    } else {
      data[key] = val;
    }
  }
  // 校验
  let hasError = false;
  if (!data.order_number || !/^[A-Z]\d{2}$/.test(data.order_number)) {
    showFieldError('order_number', '格式：1位大写字母+2位数字（如 A01）');
    hasError = true;
  }
  if (!data.name || !data.name.trim()) {
    showFieldError('order_name', '请输入需求单名称');
    hasError = true;
  }
  if (!data.department) {
    showFieldError('department', '请选择业务部门');
    hasError = true;
  }
  if (!data.proposer || !data.proposer.trim()) {
    showFieldError('proposer', '请输入提出人');
    hasError = true;
  }
  if (!data.propose_date) {
    showFieldError('propose_date', '请选择提出日期');
    hasError = true;
  }
  if (hasError) return;
  try {
    if (!state.editingOrderId) {
      const c = await (await fetch(`/api/orders/check/${data.order_number}`)).json();
      if (c.exists) {
        showFieldError('order_number', '该编号已被使用');
        return;
      }
    }
    const body = JSON.stringify(data);
    if (state.editingOrderId) {
      const origNum = document.getElementById('order_number').dataset.originalNumber;
      if (origNum && data.order_number === origNum) delete data.order_number;
      await api(`/api/orders/${state.editingOrderId}`,{method:'PUT',body});
      showToast('更新成功','success');
    } else {
      await api('/api/orders',{method:'POST',body});
      showToast('创建成功','success');
    }
    closeModal('order-modal'); state.editingOrderId = null; loadOrders();
  } catch(e) {
    const msg = e.message || '';
    if (msg.includes('编号')) showFieldError('order_number', msg);
    else showToast(msg||'保存失败','error');
  }
});

function updatePointBatchPreview() {
  const orderNum = document.getElementById('detail-number-display')?.textContent;
  const batch = document.getElementById('point-sub-batch')?.value?.trim();
  const preview = document.getElementById('point-batch-preview');
  if (!preview) return;
  if (batch && orderNum) {
    preview.textContent = `→ 子单 ${batch}（仅分组，编号格式为 ${orderNum}001）`;
  } else {
    preview.textContent = '';
  }
}
// 监听批次号输入
document.addEventListener('DOMContentLoaded', () => {
  const sb = document.getElementById('point-sub-batch');
  if (sb) sb.addEventListener('input', updatePointBatchPreview);
});

// ---- 全局搜索 ----
let searchTimeout = null;
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('global-search');
  if (!searchInput) return;
  searchInput.addEventListener('input', function(e) {
    clearTimeout(searchTimeout);
    const kw = e.target.value.trim();
    const resultsEl = document.getElementById('global-search-results');
    if (!kw) { resultsEl.classList.remove('show'); resultsEl.innerHTML = ''; return; }
    searchTimeout = setTimeout(() => doGlobalSearch(kw), 300);
  });
  searchInput.addEventListener('focus', function(e) {
    if (e.target.value.trim()) {
      document.getElementById('global-search-results').classList.add('show');
    }
  });
  // 点击外部关闭搜索下拉
  document.addEventListener('click', function(e) {
    const container = document.getElementById('nav-search-container');
    if (container && !container.contains(e.target)) {
      document.getElementById('global-search-results').classList.remove('show');
    }
  });
});

async function doGlobalSearch(keyword) {
  const resultsEl = document.getElementById('global-search-results');
  resultsEl.innerHTML = '<div class="search-loading">搜索中...</div>';
  resultsEl.classList.add('show');
  try {
    const r = await api('/api/search?keyword=' + encodeURIComponent(keyword));
    const data = r.data;
    if (!data || !data.length) {
      resultsEl.innerHTML = '<div class="search-empty">🔍 未找到匹配结果</div>';
      return;
    }
    let html = '';
    data.forEach(o => {
      html += '<div class="search-dropdown-header">';
      html += '<span class="order-number">' + esc(o.order_number) + '</span>';
      html += '<span class="order-name">' + esc(o.name) + '</span>';
      html += ' <span style="font-size:11px;color:#999">[' + esc(o.department||'-') + ']</span>';
      html += '</div>';
      
      if (o.matchedPoints && o.matchedPoints.length) {
        o.matchedPoints.forEach(p => {
          const systems = p.schedule_system ? p.schedule_system.split(',').filter(Boolean) : [];
          const scheduled = p.schedule_system ? '✅ ' + systems.map(s=>esc(s.trim())).join(',') + ' | ' + esc(p.schedule_version||'') : '⏳ 待排期';
          html += '<div class="search-dropdown-item" onclick="closeSearchAndView(' + o.id + ')">';
          html += '<div class="point-item"><span class="pt-num">' + esc(p.point_number) + '</span> ' + esc(p.description.substring(0,60)) + (p.description.length>60?'...':'') + '</div>';
          html += '<div style="font-size:11px;color:#999;margin-top:2px">' + scheduled + '</div>';
          html += '</div>';
        });
      } else {
        html += '<div class="search-dropdown-item" onclick="closeSearchAndView(' + o.id + ')">';
        html += '<div style="font-size:13px;color:#999">(无需求点)</div></div>';
      }
    });
    resultsEl.innerHTML = html;
  } catch(e) {
    resultsEl.innerHTML = '<div class="search-empty">搜索出错</div>';
  }
}

function closeSearchAndView(orderId) {
  document.getElementById('global-search-results').classList.remove('show');
  document.getElementById('global-search').value = '';
  navigate('orders');
  setTimeout(() => viewOrder(orderId), 100);
}

function showCreateOrder() { state.editingOrderId = null; document.getElementById('order-modal-title').textContent = '新建需求单'; document.getElementById('order-form').reset(); document.getElementById('order_number').disabled = false; loadDropdowns(); loadRelatedDeptCheckboxes([]); openModal('order-modal'); }
async function editOrder(id) { state.editingOrderId = id; const o = (await api(`/api/orders/${id}`)).data; document.getElementById('order-modal-title').textContent = '编辑需求单'; document.getElementById('order_number').value = o.order_number; document.getElementById('order_number').dataset.originalNumber = o.order_number; document.getElementById('order_number').disabled = false; document.getElementById('order_name').value = o.name; await loadDropdowns(); document.getElementById('department').value = o.department||''; document.getElementById('proposer').value = o.proposer||''; document.getElementById('propose_date').value = o.propose_date||''; document.getElementById('background').value = o.background||''; document.getElementById('business_launch_date').value = o.business_launch_date||''; const rds = o.related_departments ? o.related_departments.split(',').map(s=>s.trim()).filter(Boolean) : []; loadRelatedDeptCheckboxes(rds); openModal('order-modal'); }
async function deleteOrder(id) { if (!confirm('确定删除？')) return; try { await api(`/api/orders/${id}`,{method:'DELETE'}); showToast('已删除','success'); loadOrders(); } catch(e) {} }

// ---- Detail ----

function loadRelatedDeptCheckboxes(selected) {
  const container = document.getElementById('related-departments');
  if (!container) return;
  const deptSel = document.getElementById('department');
  const selectedDept = deptSel ? deptSel.value : '';
  api('/api/config/department').then(d => {
    const depts = (d.data || []).filter(x => x !== selectedDept);
    container.innerHTML = depts.map(dept =>
      `<label class="checkbox-label"><input type="checkbox" name="related_departments" value="${esc(dept)}" ${selected.includes(dept)?'checked':''}> ${esc(dept)}</label>`
    ).join('');
  }).catch(() => {});
}
// ---- 文件夹选择器 ----
let folderPickerTarget = null;

async function openFolderPicker(targetInputId) {
  folderPickerTarget = targetInputId;
  document.getElementById('folder-picker-target').value = targetInputId;
  const currentPath = document.getElementById(targetInputId).value || 
    document.getElementById(targetInputId).placeholder || 
    (navigator.platform.includes('Win') ? 'C:\\' : '/');
  await browseDir(currentPath);
  openModal('folder-picker-modal');
}

async function browseDir(dirPath) {
  try {
    const r = await fetch('/api/config/browse?path=' + encodeURIComponent(dirPath));
    const d = await r.json();
    if (!d.success) { showToast(d.message, 'error'); return; }
    const data = d.data;
    document.getElementById('folder-picker-current').textContent = '📂 ' + data.current;
    
    // 上级目录按钮
    const upBtn = document.getElementById('folder-picker-up-btn');
    upBtn.style.display = data.parent ? 'inline-flex' : 'none';
    upBtn.onclick = () => browseDir(data.parent);
    
    // 选择当前文件夹按钮
    document.getElementById('folder-picker-select-btn').onclick = () => {
      document.getElementById(folderPickerTarget).value = data.current;
      document.getElementById('folder-picker-target').value = '';
      document.getElementById('path-save-status').textContent = '⚠️ 已修改，点击保存';
      closeModal('folder-picker-modal');
    };
    
    // 子目录列表
    const list = document.getElementById('folder-picker-list');
    if (!data.subdirs.length) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:#999">(空目录，无子文件夹)</div>';
      return;
    }
    var html = '';
    data.subdirs.forEach(function(dir) {
      var safePath = (data.current + '/' + dir).replace(/\\/g,'/');
      html += '<div class="folder-picker-item" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:8px" onclick="browseDir(\'' + safePath + '\')" onmouseover="this.style.background=\'#f5f5f5\'" onmouseout="this.style.background=\'\'">';
      html += '<span style="font-size:16px">📁</span> <span style="font-size:14px">' + esc(dir) + '</span></div>';
    });
    list.innerHTML = html;
  } catch(e) { showToast('无法读取目录', 'error'); }
}

// ---- 表单内联校验 ----
function showFieldError(fieldId, message) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  el.style.borderColor = '#ff4d4f';
  el.style.boxShadow = '0 0 0 2px rgba(255,77,79,.2)';
  // 查找或创建错误提示元素
  let errEl = el.nextElementSibling;
  if (!errEl || !errEl.classList.contains('field-error')) {
    errEl = document.createElement('div');
    errEl.className = 'field-error';
    errEl.style.cssText = 'font-size:12px;color:#ff4d4f;margin-top:4px';
    el.parentNode.insertBefore(errEl, el.nextSibling);
  }
  errEl.textContent = '❌ ' + message;
}

function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach(el => el.remove());
  document.querySelectorAll('.form-control').forEach(el => {
    el.style.borderColor = '';
    el.style.boxShadow = '';
  });
}

// 表单提交时自动清除旧错误
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', clearFieldErrors);
  });
});

function onDeptChange() {
  loadRelatedDeptCheckboxes([]);
}

async function viewOrder(id) {
  try {
    const r = await fetch('/api/orders/' + id);
    const d = await r.json();
    if (!d.success) { return; }
    const o = d.data;
    state.currentOrder = o;
    
    for (const k of ['detail-number','detail-number-display']) document.getElementById(k).textContent = o.order_number;
    document.getElementById('detail-name').textContent = o.name; document.getElementById('detail-department').textContent = o.department||'-';
    document.getElementById('detail-proposer').textContent = o.proposer||'-'; document.getElementById('detail-propose-date').textContent = o.propose_date||'-';
    document.getElementById('detail-background').textContent = o.background||'-'; document.getElementById('detail-launch-date').textContent = o.business_launch_date||'-'; document.getElementById('detail-order-id').value = o.id;
    
    const rds = o.related_departments ? o.related_departments.split(',').filter(Boolean) : [];
    document.getElementById('detail-related-depts').innerHTML = rds.length ? rds.map(d=>'<span class="badge badge-blue">'+esc(d.trim())+'</span>').join(' ') : '-';
    
    const batchSel = document.getElementById('file-batch');
    if (batchSel) {
      const batches = [...new Set((o.points||[]).map(p => p.sub_batch).filter(b => b))].sort();
      batchSel.innerHTML = '<option value="">\u6240\u5C5E\u5B50\u5355\uFF08\u9009\u586B\uFF09</option>' + batches.map(b => '<option value="'+b+'">'+o.order_number+'-'+b+'</option>').join('');
    }
    
    await loadDropdowns(); renderDetailPoints(o.points||[]); renderFiles(o.files||[]); openModal('detail-modal');
  } catch(e) {
    console.error(e);
  }
}

function renderDetailPoints(points) {
  const c = document.getElementById('detail-points');
  if (!points.length) { c.innerHTML = '<div class="empty-state"><p>暂无需求点</p></div>'; return; }
  const oid = document.getElementById('detail-order-id').value;
  const orderNum = document.getElementById('detail-number-display')?.textContent || '';

  // 按 sub_batch 分组
  const batched = {}, unbatched = [];
  points.forEach(p => {
    if (p.sub_batch) {
      if (!batched[p.sub_batch]) batched[p.sub_batch] = [];
      batched[p.sub_batch].push(p);
    } else {
      unbatched.push(p);
    }
  });

  const totalScheduled = points.filter(p => p.schedule_system || p.schedule_id).length;
  const totalCount = points.length;
  const batchCount = Object.keys(batched).length;
  const pct = totalCount ? Math.round(totalScheduled / totalCount * 100) : 0;

  let html = '';

  // === 顶部汇总条 ===
  html += `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 14px;background:#fafafa;border-radius:8px;margin-bottom:16px;border:1px solid #e8e8e8">
    <span style="font-weight:600;font-size:14px;color:#333">📊 汇总</span>
    <span style="font-size:13px;color:#666">共 <b>${totalCount}</b> 项</span>
    ${batchCount ? `<span style="font-size:13px;color:#666">${batchCount} 个子单</span>` : ''}
    <span style="font-size:13px;color:#52c41a">✅ 已排期 <b>${totalScheduled}</b></span>
    <span style="font-size:13px;color:#ff4d4f">⏳ 待排期 <b>${totalCount - totalScheduled}</b></span>
    <div style="flex:1;min-width:120px;height:8px;background:#f0f0f0;border-radius:4px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#52c41a,#73d13d);border-radius:4px;transition:width .3s"></div>
    </div>
    <span style="font-size:12px;color:#999;min-width:40px;text-align:right">${pct}%</span>
  </div>`;

  const batchKeys = Object.keys(batched).sort((a,b) => parseInt(a)-parseInt(b));

  // === 有批次的子单分组 ===
  batchKeys.forEach(batch => {
    const pts = batched[batch];
    const scheduled = pts.filter(p => p.schedule_system || p.schedule_id).length;
    const allScheduled = scheduled === pts.length;
    const anyScheduled = scheduled > 0;
    const batchLabel = orderNum + '-' + batch;
    const batchPct = Math.round(scheduled / pts.length * 100);

    html += `<div class="batch-card" style="border:1px solid #e8e8e8;border-radius:8px;margin-bottom:12px;overflow:hidden">`;
    // 批次头部
    html += `<div class="batch-header" style="margin:0;border-left:4px solid ${allScheduled?'#52c41a':(anyScheduled?'#fa8c16':'#d9d9d9')};border-radius:0;cursor:pointer" onclick="this.nextElementSibling.classList.toggle('batch-collapsed')">
      <div class="batch-header-left">
        <span style="font-size:13px;color:#999;cursor:pointer" title="点击折叠/展开">▼</span>
        <span class="batch-title" style="font-size:15px">📁 ${batchLabel}</span>
        <span class="batch-count">${pts.length}项</span>
        ${allScheduled ? '<span class="badge badge-green">✅ 全部排期</span>' : (anyScheduled ? '<span class="badge badge-orange">⏳ 部分排期</span>' : '<span class="badge" style="background:#f5f5f5;color:#999;border:1px solid #d9d9d9">⏳ 待排期</span>')}
      </div>
      <div class="batch-header-right" style="display:flex;align-items:center;gap:10px">
        <div style="width:80px;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${batchPct}%;background:${allScheduled?'#52c41a':'#fa8c16'};border-radius:3px"></div>
        </div>
        <span style="font-size:11px;color:#999">${batchPct}%</span>
        ${!allScheduled ? `<button class="btn btn-sm btn-success" onclick="event.stopPropagation();batchScheduleSubOrder(${oid},'${batch}')">📋 整批排期</button>` : ''}
        <span style="font-size:11px;color:#ccc">▼</span>
      </div>
    </div>`;
    // 需求点列表
    html += `<div class="batch-points">`;
    pts.forEach(p => { html += renderPointItem(p, oid); });
    html += `</div></div>`;
  });

  // === 无批次的传统点 ===
  if (unbatched.length) {
    if (batchKeys.length) {
      html += `<div class="batch-card" style="border:1px solid #e8e8e8;border-radius:8px;margin-bottom:12px;overflow:hidden;opacity:0.85">
        <div class="batch-header" style="margin:0;border-left:4px solid #d9d9d9;border-radius:0;background:#fafafa;cursor:pointer" onclick="this.nextElementSibling.classList.toggle('batch-collapsed')">
          <div class="batch-header-left">
            <span style="font-size:13px;color:#999;cursor:pointer" title="点击折叠/展开">▼</span>
            <span style="font-size:14px;color:#999">📋 基础需求点（无子单）</span>
            <span style="font-size:12px;color:#999">${unbatched.length}项</span>
          </div>
          <div class="batch-header-right">
            <span style="font-size:11px;color:#ccc">▼</span>
          </div>
        </div>
        <div class="batch-points">`;
    }
    unbatched.forEach(p => { html += renderPointItem(p, oid); });
    if (batchKeys.length) { html += '</div></div>'; }
  }

  c.innerHTML = html;
}

function renderPointItem(p, oid) {
  const has = p.schedule_system || p.schedule_id;
  const systems = p.schedule_system ? p.schedule_system.split(',').filter(Boolean) : [];
  const tag = p.sub_batch ? `<span style="display:inline-block;font-size:11px;background:#e6f7ff;color:#1890ff;padding:0 6px;border-radius:3px;margin-left:6px;font-weight:400">子单 ${p.sub_batch}</span>` : '';
  return `<div class="point-item">
    <div class="point-info">
      <div class="point-number">${esc(p.point_number)}${tag}</div>
      <div class="point-desc">${esc(p.description)}</div>
      <div class="point-meta">${has ? `<span style="color:#52c41a">✅ ${systems.map(s=>esc(s.trim())).join(', ')} | ${esc(p.schedule_version)}</span>` : '<span style="color:#fa8c16">⏳ 待排期</span>'}
      ${p.meeting_name ? ` | 📅 ${esc(p.meeting_name)} (${p.meeting_date})` : ''}</div>
    </div>
    <div class="point-actions">
      <button class="btn btn-sm" onclick="editPoint(${p.id},${oid})">编辑</button>
      ${!has ? `<button class="btn btn-sm btn-success" onclick="showScheduleModal(${p.id},${oid})">排期</button>`
        : `<button class="btn btn-sm" onclick="openEditScheduleModal(${p.schedule_id},${oid})">修改排期</button><button class="btn btn-sm btn-danger" onclick="deleteScheduleFromDetail(${p.schedule_id})">移除排期</button>`}
      <button class="btn btn-sm btn-danger" onclick="deletePoint(${p.id})">删除</button>
    </div>
  </div>`;
}

async function batchScheduleSubOrder(orderId, batch) {
  // 获取该批次下所有未排期的点，打开批量排期弹窗
  const o = (await api(`/api/orders/${orderId}`)).data;
  const points = o.points.filter(p => p.sub_batch === batch);
  const unscheduled = points.filter(p => !(p.schedule_system || p.schedule_id));
  if (!unscheduled.length) { showToast('该批次已全部排期','info'); return; }

  // 获取会议、系统、版本列表
  const [s, v, meetings] = await Promise.all([api('/api/config/system'), api('/api/config/version'), api('/api/meetings')]);
  if (!meetings.data.length) { showToast('请先创建CCB会议','error'); navigate('meetings'); return; }

  // 填充会议下拉
  const mtgSelect = document.getElementById('batch-schedule-meeting');
  mtgSelect.innerHTML = '<option value="">请选择CCB会议</option>';
  meetings.data.forEach(m => { const o2 = document.createElement('option'); o2.value = m.id; o2.textContent = m.meeting_name+' ('+m.meeting_date+')'; mtgSelect.appendChild(o2); });

  // 渲染逐点系统/版本
  const container = document.getElementById('batch-schedule-points');
  container.innerHTML = '';
  unscheduled.forEach((p, idx) => {
    const div = document.createElement('div');
    div.style.cssText = 'padding:10px;margin-bottom:6px;background:#fafafa;border-radius:6px;border-left:3px solid #1890ff';
    div.innerHTML = `
      <div style="font-weight:600;font-size:13px;color:#333;margin-bottom:8px">
        ${esc(p.point_number)} ${esc(p.description)}
      </div>
      <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
        <div>
          <div style="font-size:12px;color:#999;margin-bottom:4px">涉及系统</div>
          <div id="bps-${p.id}" style="display:flex;flex-wrap:wrap;gap:2px"></div>
        </div>
        <div>
          <div style="font-size:12px;color:#999;margin-bottom:4px">上线版本</div>
          <select id="bpv-${p.id}" style="padding:4px 8px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;min-width:100px">
            <option value="">请选择版本</option>
          </select>
        </div>
        <div>
          <div style="font-size:12px;color:#999;margin-bottom:4px">立项</div>
          <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
            <input type="checkbox" class="bpi-cb" data-pid="${p.id}"> 已立项
          </label>
        </div>
      </div>
    `;
    container.appendChild(div);
    // 渲染该点的系统checkbox
    const sysCtr = document.getElementById('bps-'+p.id);
    (s.data||[]).forEach(sys => {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:4px 8px;margin:2px;border:1px solid #d9d9d9;border-radius:4px;cursor:pointer;font-size:12px';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = sys; cb.className = 'system-cb';
      lbl.appendChild(cb); lbl.appendChild(document.createTextNode(sys));
      lbl.onmouseover = () => lbl.style.borderColor = '#1890ff';
      lbl.onmouseout = () => lbl.style.borderColor = '#d9d9d9';
      sysCtr.appendChild(lbl);
    });
    // 渲染该点的版本下拉
    const verSel = document.getElementById('bpv-'+p.id);
    v.data.forEach(x => { const o2 = document.createElement('option'); o2.value = x; o2.textContent = x; verSel.appendChild(o2); });
  });

  // 存储批次信息
  document.getElementById('batch-schedule-order-id').value = orderId;
  document.getElementById('batch-schedule-batch').value = batch;
  document.getElementById('batch-schedule-count').textContent = `待排期 ${unscheduled.length} 项（${o.order_number}-${batch}）`;
  openModal('batch-schedule-modal');
}

function orderNumDisplay() {
  return document.getElementById('detail-number-display')?.textContent || '';
}

async function confirmBatchSchedule() {
  const meetingId = document.getElementById('batch-schedule-meeting').value;
  const orderId = parseInt(document.getElementById('batch-schedule-order-id').value);
  const batch = document.getElementById('batch-schedule-batch').value;

  if (!meetingId) { showToast('请选择CCB会议','error'); return; }

  // 找到该批次下所有未排期点
  const o = (await api(`/api/orders/${orderId}`)).data;
  const unscheduled = o.points.filter(p => p.sub_batch === batch && !(p.schedule_system || p.schedule_id));
  if (!unscheduled.length) { showToast('暂无待排期项','info'); closeModal('batch-schedule-modal'); return; }

  // 逐点读取系统和版本
  const schedules = [];
  const skipped = [];
  unscheduled.forEach(p => {
    const systems = getSelectedSystems('bps-'+p.id);
    const version = document.getElementById('bpv-'+p.id).value;
    const bpiCb = document.querySelector(`.bpi-cb[data-pid="${p.id}"]`);
    const isProject = bpiCb ? (bpiCb.checked ? 1 : 0) : 0;
    if (!systems.length || !version) {
      skipped.push(`${p.point_number}（${!systems.length ? '缺系统' : ''}${!systems.length && !version ? '、' : ''}${!version ? '缺版本' : ''}）`);
      return;
    }
    schedules.push({
      order_id: orderId,
      point_id: p.id,
      system: systems.join(','),
      version,
      is_project: isProject,
    });
  });

  if (!schedules.length) { showToast('未配置任何需求点的系统和版本，请逐点填写','error'); return; }

  // 批量提交排期
  try {
    const r = await fetch(`/api/meetings/${meetingId}/schedules/batch`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({schedules})
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    let msg = `排期成功：${d.data.count} 项`;
    if (skipped.length) msg += `，跳过 ${skipped.length} 项（${skipped.join('；')}）`;
    showToast(msg, 'success');
    closeModal('batch-schedule-modal');
    viewOrder(orderId);
  } catch(e) { showToast(e.message,'error'); }
}

async function showScheduleModal(pointId, orderId) {
  const [s, v, m] = await Promise.all([api('/api/config/system'), api('/api/config/version'), api('/api/meetings')]);
  const sys = s.data, vers = v.data, meetings = m.data;
  if (!meetings.length) { showToast('请先创建CCB会议','error'); navigate('meetings'); return; }
  const mtgSelect = document.getElementById('detail-schedule-meeting');
  mtgSelect.innerHTML = '<option value="">请选择CCB会议</option>';
  meetings.forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = `${m.meeting_name} (${m.meeting_date})`; mtgSelect.appendChild(o); });
  renderSystemCheckboxes('detail-schedule-systems', sys, []); fillSelect('detail-schedule-version', vers, '请选择版本');
  document.getElementById('schedule-point-id').value = pointId; document.getElementById('schedule-order-id').value = orderId;
  openModal('quick-schedule-modal');
}

async function confirmQuickSchedule() {
  const pointId = document.getElementById('schedule-point-id').value, orderId = document.getElementById('schedule-order-id').value;
  const meetingId = document.getElementById('detail-schedule-meeting').value, systems = getSelectedSystems(), version = document.getElementById('detail-schedule-version').value;
  if (!meetingId) { showToast('请选择CCB会议','error'); return; } if (!systems.length) { showToast('请至少选择一个系统','error'); return; } if (!version) { showToast('请选择版本','error'); return; }
  const isProject = document.getElementById('detail-schedule-is-project').checked ? 1 : 0;
  try {
    const r = await fetch(`/api/meetings/${meetingId}/schedules`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order_id:parseInt(orderId),point_id:parseInt(pointId),system:systems.join(','),version,is_project:isProject})});
    const d = await r.json(); if (!d.success) throw new Error(d.message); showToast('排期成功','success'); closeModal('quick-schedule-modal'); viewOrder(parseInt(orderId));
  } catch(e) { showToast(e.message,'error'); }
}

// 【修复2】修改排期时预填当前值
async function openEditScheduleModal(scheduleId, orderId) {
  const [s, v, meetings, orderData] = await Promise.all([
    api('/api/config/system'), api('/api/config/version'), api('/api/meetings'),
    orderId ? api(`/api/orders/${orderId}`) : Promise.resolve(null)
  ]);
  const sys = s.data, vers = v.data;
  
  // Find current schedule info from order data
  let currentSchedule = null;
  if (orderData && orderData.data) {
    currentSchedule = orderData.data.schedules?.find(x => x.id === scheduleId);
  }
  if (!currentSchedule && meetings.data) {
    // Find from meetings
    for (const m of meetings.data) {
      const detail = await api(`/api/meetings/${m.id}`);
      currentSchedule = detail.data.schedules?.find(x => x.id === scheduleId);
      if (currentSchedule) break;
    }
  }
  
  const currentSystems = currentSchedule ? currentSchedule.system.split(',').map(s=>s.trim()).filter(Boolean) : [];
  const currentVersion = currentSchedule ? currentSchedule.version : '';
  const currentMeetingId = currentSchedule ? currentSchedule.meeting_id : '';
  const currentIsProject = currentSchedule ? currentSchedule.is_project : 0;
  document.getElementById('edit-schedule-is-project').checked = currentIsProject ? true : false;

  // Fill meeting dropdown
  const mtgSelect = document.getElementById('edit-schedule-meeting');
  mtgSelect.innerHTML = '<option value="">不修改会议</option>';
  meetings.data.forEach(m => {
    const o = document.createElement('option'); o.value = m.id; o.textContent = `${m.meeting_name} (${m.meeting_date})`;
    if (m.id === currentMeetingId) o.selected = true;
    mtgSelect.appendChild(o);
  });
  
  renderSystemCheckboxes('edit-schedule-systems', sys, currentSystems);
  fillSelect('edit-schedule-version', vers, '请选择版本');
  document.getElementById('edit-schedule-version').value = currentVersion;
  document.getElementById('edit-schedule-id').value = scheduleId;
  openModal('edit-schedule-modal');
}

async function confirmEditSchedule() {
  const scheduleId = document.getElementById('edit-schedule-id').value, meetingId = document.getElementById('edit-schedule-meeting').value;
  const systems = getSelectedSystems(), version = document.getElementById('edit-schedule-version').value;
  if (!systems.length) { showToast('请至少选择一个系统','error'); return; } if (!version) { showToast('请选择版本','error'); return; }
  const isProject = document.getElementById('edit-schedule-is-project').checked ? 1 : 0;
  try {
    const body = {system:systems.join(','), version, is_project:isProject};
    if (meetingId) body.meeting_id = parseInt(meetingId);
    await api(`/api/schedules/${scheduleId}`,{method:'PUT',body:JSON.stringify(body)});
    showToast('排期已更新','success'); closeModal('edit-schedule-modal');
    const oid = document.getElementById('detail-order-id')?.value;
    if (oid) viewOrder(parseInt(oid)); else viewMeeting(document.getElementById('schedule-meeting-id').value);
  } catch(e) { showToast(e.message,'error'); }
}

async function deleteScheduleFromDetail(id) { if (!confirm('确定移除？')) return; try { await api(`/api/schedules/${id}`,{method:'DELETE'}); showToast('已移除','success'); viewOrder(document.getElementById('detail-order-id').value); } catch(e) {} }

function renderFiles(files) {
  const c = document.getElementById('detail-files');
  if (!files.length) { c.innerHTML = '<div class="empty-state"><p>暂无流转文件</p></div>'; return; }
  // 按子单批次分组
  var grouped = {}, ungrouped = [];
  files.forEach(function(f) { if (f.sub_batch) { if(!grouped[f.sub_batch]) grouped[f.sub_batch]=[]; grouped[f.sub_batch].push(f); } else ungrouped.push(f); });
  var html = '', orderNum = document.getElementById('detail-number-display')?.textContent || '';
  Object.keys(grouped).sort().forEach(function(batch) {
    html += '<div style="padding:6px 12px;margin:8px 0 4px;background:#f0f5ff;border-radius:4px;font-size:13px;color:#1890ff;font-weight:500">\uD83D\uDCC1 ' + orderNum + '-' + batch + '</div>';
    grouped[batch].forEach(function(f) { html += fileItemHtml(f); });
  });
  if (ungrouped.length) {
    if (Object.keys(grouped).length) html += '<div style="padding:6px 12px;margin:8px 0 4px;font-size:13px;color:#999;font-weight:500">\uD83D\uDCCE \u901A\u7528\u6587\u4EF6\uFF08\u65E0\u5173\u8054\u5B50\u5355\uFF09</div>';
    ungrouped.forEach(function(f) { html += fileItemHtml(f); });
  }
  c.innerHTML = html;
}
function fileItemHtml(f) {
  return '<div class="file-item"><div class="file-info"><span class="file-type">' + esc(f.file_type) + '</span><span><a href="/api/files/' + f.id + '/download" style="color:#333;text-decoration:none" title="\u70b9\u51fb\u4e0b\u8f7d" target="_blank">' + esc(f.original_name) + '</a></span></div><div class="action-group"><a class="btn btn-sm" href="/api/files/' + f.id + '/download" target="_blank" title="\u4e0b\u8f7d\u6587\u4ef6">\ud83d\udce5 \u4e0b\u8f7d</a><button class="btn btn-sm btn-danger" onclick="deleteFile(' + f.id + ')">\u5220\u9664</button></div></div>';
}

document.getElementById('point-form')?.addEventListener('submit', async e => {
  e.preventDefault(); const desc = document.getElementById('point-description').value;
  const subBatch = document.getElementById('point-sub-batch')?.value?.trim() || '';
  try { if (state.editingPointId) { await api(`/api/points/${state.editingPointId}`,{method:'PUT',body:JSON.stringify({description:desc, sub_batch:subBatch||null})}); showToast('已更新','success'); } else { const body = {description:desc}; if (subBatch) body.sub_batch = subBatch; await api(`/api/orders/${document.getElementById('detail-order-id').value}/points`,{method:'POST',body:JSON.stringify(body)}); showToast('已添加','success'); } closeModal('point-modal'); document.getElementById('point-form').reset(); state.editingPointId = null; viewOrder(document.getElementById('detail-order-id').value); } catch(e) {}
});
function showAddPoint() {
  state.editingPointId = null;
  document.getElementById('point-modal-title').textContent = '添加需求点';
  document.getElementById('point-description').value = '';
  document.getElementById('point-batch-group').style.display = 'block';
  document.getElementById('point-sub-batch').value = '';
  document.getElementById('point-batch-preview').textContent = '';
  openModal('point-modal');
}
async function editPoint(id, oid) {
  state.editingPointId = id;
  const o = (await api(`/api/orders/${oid}`)).data;
  const p = o.points.find(x=>x.id===id);
  if (!p) return;
  document.getElementById('point-modal-title').textContent = `编辑 - ${p.point_number}`;
  document.getElementById('point-description').value = p.description;
  document.getElementById('point-batch-group').style.display = 'block';
  document.getElementById('point-sub-batch').value = p.sub_batch || '';
  updatePointBatchPreview();
  openModal('point-modal');
}
async function deletePoint(id) { if (!confirm('确定删除？')) return; try { await api(`/api/points/${id}`,{method:'DELETE'}); showToast('已删除','success'); viewOrder(document.getElementById('detail-order-id').value); } catch(e) {} }

async function uploadFile() {
  const oid = document.getElementById('detail-order-id').value, fi = document.getElementById('file-upload'), ft = document.getElementById('file-type').value;
  if (!fi.files.length) { showToast('请选择文件','error'); return; } if (!ft) { showToast('请选择文件类型','error'); return; }
  const fd = new FormData(); fd.append('file',fi.files[0]); fd.append('file_type',ft);
  const fb = document.getElementById('file-batch')?.value;
  if (fb) fd.append('sub_batch', fb);
  try { const r = await fetch(`/api/orders/${oid}/files`,{method:'POST',body:fd}); const d = await r.json(); if (!d.success) throw new Error(d.message); showToast('上传成功','success'); fi.value=''; viewOrder(oid); } catch(e) { showToast(e.message,'error'); }
}
async function deleteFile(id) { if (!confirm('确定删除？')) return; try { await api(`/api/files/${id}`,{method:'DELETE'}); showToast('已删除','success'); viewOrder(document.getElementById('detail-order-id').value); } catch(e) {} }

// ---- Meetings ----
async function loadMeetings() {
  try { const meetings = (await api('/api/meetings')).data; const c = document.getElementById('meetings-list'); if (!meetings.length) { c.innerHTML = '<div class="empty-state"><div class="icon">📅</div><p>暂无CCB会议</p></div>'; return; } c.innerHTML = meetings.map(m => `<div class="schedule-card"><div class="sched-header"><div class="sched-title">${esc(m.meeting_name)}</div><div class="action-group"><button class="btn btn-sm" onclick="viewMeeting(${m.id})">排期管理</button><button class="btn btn-sm" onclick="editMeeting(${m.id})">编辑</button><button class="btn btn-sm btn-danger" onclick="deleteMeeting(${m.id})">删除</button></div></div><div class="sched-meta">日期: ${m.meeting_date}${m.notes?' | '+esc(m.notes):''}</div>${m.file_name?'<div class="sched-tags"><span class="sched-tag">📎 <a href="/api/meetings/'+m.id+'/file/download" style="color:#333;text-decoration:none" target="_blank" title="下载纪要文件">'+esc(m.file_name)+'</a></span></div>':''}</div>`).join(''); } catch(e) {}
}
document.getElementById('meeting-form')?.addEventListener('submit', async e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target)); try { if (state.editingMeetingId) { await api(`/api/meetings/${state.editingMeetingId}`,{method:'PUT',body:JSON.stringify(data)}); showToast('已更新','success'); } else { await api('/api/meetings',{method:'POST',body:JSON.stringify(data)}); showToast('已创建','success'); } closeModal('meeting-modal'); e.target.reset(); state.editingMeetingId = null; loadMeetings(); } catch(e) {} });
function showCreateMeeting() { state.editingMeetingId = null; document.getElementById('meeting-modal-title').textContent = '新建CCB会议'; document.getElementById('meeting-form').reset(); openModal('meeting-modal'); }
async function editMeeting(id) { state.editingMeetingId = id; const d = (await api(`/api/meetings/${id}`)).data; document.getElementById('meeting-modal-title').textContent = '编辑CCB会议'; document.getElementById('meeting_name').value = d.meeting_name; document.getElementById('meeting_date').value = d.meeting_date; document.getElementById('meeting_notes').value = d.notes||''; openModal('meeting-modal'); }
async function deleteMeeting(id) { if (!confirm('确定删除？')) return; try { await api(`/api/meetings/${id}`,{method:'DELETE'}); showToast('已删除','success'); loadMeetings(); } catch(e) {} }
async function uploadMeetingFile() { const mid = state.editingMeetingId || document.getElementById('schedule-meeting-id')?.value; if (!mid) { showToast('请先选择会议','error'); return; } const fi = document.getElementById('meeting-file-upload'); if (!fi.files.length) { showToast('请选择文件','error'); return; } const fd = new FormData(); fd.append('file',fi.files[0]); try { const r = await fetch(`/api/meetings/${mid}/file`,{method:'POST',body:fd}); const d = await r.json(); if (!d.success) throw new Error(d.message); showToast('上传成功','success'); fi.value=''; loadMeetings(); } catch(e) { showToast(e.message,'error'); } }

// ---- Batch Schedule ----
async function viewMeeting(id) {
  const d = (await api(`/api/meetings/${id}`)).data;
  document.getElementById('schedule-meeting-id').value = id; document.getElementById('schedule-meeting-name').textContent = d.meeting_name; document.getElementById('schedule-meeting-name-display').textContent = d.meeting_name; document.getElementById('schedule-meeting-date').textContent = d.meeting_date; document.getElementById('schedule-meeting-notes').textContent = d.notes||'-'; document.getElementById('schedule-meeting-file').textContent = d.file_name||'无';
  renderMeetingSchedules(d.schedules||[]); await loadDropdowns(); await loadBatchScheduleTable(); openModal('schedule-modal');
}
async function loadBatchScheduleTable() {
  const c = document.getElementById('schedule-batch-table');
  try {
    const [points, sysOpts, verOpts] = await Promise.all([api('/api/unscheduled-points'), api('/api/config/system'), api('/api/config/version')]);
    const pts = points.data || points, sys = sysOpts.data || sysOpts, ver = verOpts.data || verOpts;
    if (!pts.length) { c.innerHTML = '<div style="padding:20px;text-align:center;color:#999">✅ 所有需求点已完成排期</div>'; return; }
    
    // 按(需求单, 子单批次)分组
    const groups = {};
    pts.forEach(p => {
      const key = p.order_number + '|' + (p.sub_batch || '');
      if(!groups[key]) groups[key] = { order_number: p.order_number, order_name: p.order_name, sub_batch: p.sub_batch || '', points: [] };
      groups[key].points.push(p);
    });
    const sortedKeys = Object.keys(groups).sort((a,b) => {
      const [oa, ba] = a.split('|'), [ob, bb] = b.split('|');
      if (oa !== ob) return oa < ob ? -1 : 1;
      return (parseInt(ba)||0) - (parseInt(bb)||0);
    });
    
    let html = '<table style="width:100%;font-size:13px"><thead><tr><th style="padding:6px 8px;width:30px"><input type="checkbox" id="batch-select-all" onchange="toggleAllBatch()"></th><th style="padding:6px 8px">需求点</th><th style="padding:6px 8px">描述</th><th style="padding:6px 8px;min-width:180px">涉及系统</th><th style="padding:6px 8px;width:120px">版本</th></tr></thead><tbody>';
    
    sortedKeys.forEach(key => {
      const grp = groups[key];
      const pts = grp.points;
      
      if (grp.sub_batch) {
        // 有批次号的子单组：显示为一行，整批选系统/版本
        const batchLabel = grp.order_number + '-' + grp.sub_batch;
        html += `<tr style="background:#f0f5ff"><td style="padding:6px 8px;text-align:center"><input type="checkbox" class="batch-point-cb" value="${pts[0].id}" data-order="${pts[0].order_id}" data-batch="${grp.sub_batch}" onchange="toggleBatchGroup(this)"></td>`;
        html += `<td style="padding:6px 8px" colspan="2"><span style="font-weight:600;color:#1890ff;font-size:13px">📁 ${batchLabel}</span> <span style="font-size:11px;color:#999">(${pts.length}项)</span></td>`;
        html += `<td style="padding:6px 8px"><div class="batch-sys-container" style="display:flex;flex-wrap:wrap;gap:2px">${sys.map(s => `<label style="display:inline-flex;align-items:center;gap:2px;padding:2px 6px;margin:1px;border:1px solid #d9d9d9;border-radius:3px;cursor:pointer;font-size:11px;background:#fff"><input type="checkbox" class="batch-sys-cb" value="${s}" style="width:12px;height:12px">${s}</label>`).join('')}</div></td>`;
        html += `<td style="padding:6px 8px"><select class="batch-version" style="width:100%;padding:4px 6px;border:1px solid #d9d9d9;border-radius:4px;font-size:12px"><option value="">选择..</option>${ver.map(v => `<option value="${v}">${v}</option>`).join('')}</select></td></tr>`;
      } else {
        // 无批次号：逐个显示
        html += `<tr style="background:#f5f5f5"><td colspan="5" style="padding:6px 8px;font-weight:600;font-size:13px">${grp.order_number} - ${esc(grp.order_name)}</td></tr>`;
        pts.forEach(p => {
          html += `<tr><td style="padding:6px 8px;text-align:center"><input type="checkbox" class="batch-point-cb" value="${p.id}" data-order="${p.order_id}"></td>`;
          html += `<td style="padding:6px 8px"><span style="color:#1890ff;font-weight:500">${esc(p.point_number)}</span></td>`;
          html += `<td style="padding:6px 8px;color:#666">${esc(p.description.substring(0,40))}${p.description.length>40?'...':''}</td>`;
          html += `<td style="padding:6px 8px"><div class="batch-sys-container" style="display:flex;flex-wrap:wrap;gap:2px">${sys.map(s => `<label style="display:inline-flex;align-items:center;gap:2px;padding:2px 6px;margin:1px;border:1px solid #d9d9d9;border-radius:3px;cursor:pointer;font-size:11px;background:#fff"><input type="checkbox" class="batch-sys-cb" value="${s}" style="width:12px;height:12px">${s}</label>`).join('')}</div></td>`;
          html += `<td style="padding:6px 8px"><select class="batch-version" style="width:100%;padding:4px 6px;border:1px solid #d9d9d9;border-radius:4px;font-size:12px"><option value="">选择..</option>${ver.map(v => `<option value="${v}">${v}</option>`).join('')}</select></td></tr>`;
        });
      }
    });
    
    html += '</tbody></table><div style="margin-top:12px"><button class="btn btn-primary" onclick="saveBatchSchedules()">💾 批量保存</button></div>';
    c.innerHTML = html;
  } catch(e) { c.innerHTML = '<div style="padding:12px;color:#999">加载失败</div>'; }
}
function toggleAllBatch() {
  const checked = document.getElementById('batch-select-all')?.checked;
  document.querySelectorAll('.batch-point-cb').forEach(cb => cb.checked = !!checked);
}
function getBatchSystems(row) { return Array.from(row.querySelectorAll('.batch-sys-cb:checked')).map(cb => cb.value); }
async function saveBatchSchedules() {
  const meetingId = document.getElementById('schedule-meeting-id').value;
  const orderId = document.getElementById('schedule-meeting-id').dataset.orderId;
  const checkboxes = document.querySelectorAll('.batch-point-cb');
  const schedules = [];
  
  for (const cb of checkboxes) {
    if (!cb.checked) continue;
    const tr = cb.closest('tr');
    const systems = getBatchSystems(tr);
    const version = tr.querySelector('.batch-version')?.value;
    if (!systems.length || !version) continue;
    
    const batch = cb.dataset.batch;
    const order_id = parseInt(cb.dataset.order);
    if (batch) {
      // 批量勾选：获取该订单+批次下所有未排期点
      const unscheduledResp = await fetch('/api/unscheduled-points');
      const unscheduledData = await unscheduledResp.json();
      const unscheduledPoints = unscheduledData.data || unscheduledData;
      const batchPoints = unscheduledPoints.filter(p => p.order_id === order_id && p.sub_batch === batch);
      batchPoints.forEach(p => {
        schedules.push({order_id, point_id: p.id, system: systems.join(','), version});
      });
    } else {
      schedules.push({order_id, point_id: parseInt(cb.value), system: systems.join(','), version});
    }
  }
  
  if (!schedules.length) { showToast('请勾选并完善','error'); return; }
  try {
    const r = await fetch(`/api/meetings/${meetingId}/schedules/batch`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({schedules})
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    showToast(`成功添加 ${d.data.count} 个`,'success');
    viewMeeting(meetingId);
  } catch(e) { showToast(e.message,'error'); }
}

function toggleBatchGroup(cb) {
  // 当批次行被勾选/取消时，同步同批次内各点的勾选状态
  if (!cb.checked) return;
  const batch = cb.dataset.batch;
  const orderId = cb.dataset.order;
  if (batch) {
    // 本批次已通过批次行处理，无需额外操作
  }
}
function renderMeetingSchedules(schedules) {
  const c = document.getElementById('schedule-list'); if (!schedules.length) { c.innerHTML = '<div class="empty-state"><p>暂无排期记录</p></div>'; return; }
  // 按子单批次分组
  const groups = {};
  schedules.forEach(s => {
    const key = s.sub_batch ? s.order_number+'-'+s.sub_batch : s.order_number+'_'+s.point_number;
    if (!groups[key]) groups[key] = { label: s.sub_batch ? s.order_number+'-'+s.sub_batch : '', items: [] };
    groups[key].items.push(s);
  });
  let html = '';
  Object.keys(groups).sort().forEach(key => {
    const g = groups[key];
    if (g.label) {
      html += `<div style="padding:6px 12px;margin-top:12px;background:#f0f5ff;border-radius:6px;font-weight:600;font-size:14px;color:#1890ff;border-left:4px solid #1890ff">📁 ${esc(g.label)}</div>`;
    }
    g.items.forEach(s => {
      const systems = s.system ? s.system.split(',').map(x=>x.trim()).filter(Boolean) : [];
      const projTag = s.is_project ? '<span class="sched-tag">📋 已立项</span>' : '';
      html += `<div class="schedule-card"><div class="sched-header"><div class="sched-title">${esc(s.order_number)} - ${esc(s.point_number)}</div><div class="action-group"><button class="btn btn-sm" onclick="openEditScheduleModalFromMeeting(${s.id})">修改</button><button class="btn btn-sm btn-danger" onclick="deleteScheduleFromMeeting(${s.id})">移除</button></div></div><div class="sched-meta">${esc(s.point_description)}</div><div class="sched-tags">${systems.map(sys => `<span class="sched-tag">📦 ${esc(sys)}</span>`).join('')}<span class="sched-tag">🏷️ ${esc(s.version)}</span>${projTag}</div></div>`;
    });
  });
  c.innerHTML = html;
}
async function deleteScheduleFromMeeting(id) { if (!confirm('确定移除？')) return; try { await api(`/api/schedules/${id}`,{method:'DELETE'}); showToast('已移除','success'); viewMeeting(document.getElementById('schedule-meeting-id').value); } catch(e) {} }
async function openEditScheduleModalFromMeeting(scheduleId) {
  // Lookup meeting schedule info
  const meetingId = document.getElementById('schedule-meeting-id').value;
  const d = await api(`/api/meetings/${meetingId}`);
  const schedule = d.data.schedules?.find(x => x.id === scheduleId);
  const currentSystems = schedule ? schedule.system.split(',').map(s=>s.trim()).filter(Boolean) : [];
  const currentVersion = schedule ? schedule.version : '';
  
  const [sys, vers, meetings] = await Promise.all([api('/api/config/system'), api('/api/config/version'), api('/api/meetings')]);
  
  const mtgSelect = document.getElementById('edit-schedule-meeting');
  mtgSelect.innerHTML = '<option value="">不修改会议</option>';
  meetings.data.forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = `${m.meeting_name} (${m.meeting_date})`; if (m.id === schedule?.meeting_id) o.selected = true; mtgSelect.appendChild(o); });
  
  renderSystemCheckboxes('edit-schedule-systems', sys.data, currentSystems);
  fillSelect('edit-schedule-version', vers.data, '请选择版本');
  document.getElementById('edit-schedule-version').value = currentVersion;
  document.getElementById('edit-schedule-id').value = scheduleId;
  openModal('edit-schedule-modal');
}

// ---- Schedule Filter with Pagination ----
async function loadScheduleFilter() {
  try {
    const r = await fetch(`/api/schedules/filter?group_by=version&page=${state.schedulePage}&pageSize=20`); const result = await r.json();
    if (!result.success) throw new Error(result.message);
    fillFilter('filter-version', result.filters.versions, '全部版本'); fillFilter('filter-schedule-department', result.filters.departments, '全部部门'); fillFilter('filter-meeting', result.filters.meetings, '全部会议'); fillFilter('filter-system', result.filters.systems, '全部系统');
    renderScheduleResults(result);
  } catch(e) { console.error(e); }
}

function fillFilter(id, items, placeholder) {
  const el = document.getElementById(id); if (!el) return; el.innerHTML = `<option value="">${placeholder}</option>`; (items||[]).forEach(i => { const o = document.createElement('option'); o.value = i; o.textContent = i; el.appendChild(o); });
}

async function applyFilter() {
  const params = new URLSearchParams(); const v = document.getElementById('filter-version').value; if (v) params.set('version', v); const d = document.getElementById('filter-schedule-department').value; if (d) params.set('department', d); const m = document.getElementById('filter-meeting').value; if (m) params.set('meeting_name', m); const s = document.getElementById('filter-system').value; if (s) params.set('system', s); const g = document.getElementById('filter-group').value; if (g) params.set('group_by', g); params.set('page', state.schedulePage); params.set('pageSize', '20');
  try { const r = await fetch(`/api/schedules/filter?${params}`); const result = await r.json(); if (!result.success) throw new Error(result.message); renderScheduleResults(result); } catch(e) { showToast(e.message,'error'); }
}

function resetFilter() { document.querySelectorAll('.filter-row select').forEach(el => el.value = ''); state.schedulePage = 1; applyFilter(); }

function renderScheduleResults(result) {
  const { data: schedules, grouped, total, page, totalPages } = result;
  const c = document.getElementById('schedule-results'); const pc = document.getElementById('schedules-pagination');
  if (!schedules||!schedules.length) { c.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>暂无匹配的排期信息</p></div>'; pc.innerHTML = ''; return; }
  function schedCard(s) {
    const systems = s.system ? s.system.split(',').map(x=>x.trim()).filter(Boolean) : [];
    const batchTag = s.sub_batch ? ` <span style="font-size:11px;color:#1890ff;background:#f0f5ff;padding:1px 6px;border-radius:3px">${esc(s.order_number)}-${esc(s.sub_batch)}</span>` : '';
    const projTag2 = s.is_project ? '<span class="sched-tag">📋 已立项</span>' : '';
    return `<div class="schedule-card"><div class="sched-header"><div class="sched-title">${esc(s.order_number)} - ${esc(s.point_number)}${batchTag}</div><div class="sched-meta">${esc(s.meeting_name)} (${s.meeting_date})</div></div><div class="sched-meta">${esc(s.point_description)}</div><div class="sched-meta">部门: ${esc(s.department||'-')}</div><div class="sched-tags">${systems.map(sys => `<span class="sched-tag">📦 ${esc(sys)}</span>`).join('')}<span class="sched-tag">🏷️ ${esc(s.version)}</span>${projTag2}</div></div>`;
  }
  if (grouped) {
    let html = ''; Object.keys(grouped).sort().forEach(key => { const items = grouped[key]; html += `<div style="margin:16px 0 8px;padding:8px 12px;background:#e6f7ff;border-radius:6px;font-weight:600;font-size:14px;color:#1890ff">📁 ${esc(key)} (${items.length}条)</div>`; html += items.map(s => schedCard(s)).join(''); }); c.innerHTML = html;
  } else {
    c.innerHTML = schedules.map(s => schedCard(s)).join('');
  }
  if (totalPages > 1) { pc.innerHTML = `<button class="page-btn" onclick="gotoSchedulePage(1)" ${page<=1?'disabled':''}>«</button><button class="page-btn" onclick="gotoSchedulePage(${page-1})" ${page<=1?'disabled':''}>‹</button><span class="page-info">第 ${page}/${totalPages} 页 (共${total}条)</span><button class="page-btn" onclick="gotoSchedulePage(${page+1})" ${page>=totalPages?'disabled':''}>›</button><button class="page-btn" onclick="gotoSchedulePage(${totalPages})" ${page>=totalPages?'disabled':''}>»</button>`; }
  else pc.innerHTML = '';
}

document.getElementById('filter-group')?.addEventListener('change', () => { state.schedulePage = 1; applyFilter(); });
function exportExcel() { doExport('/api/export'); }
function exportFiltered() {
  const params = getFilterParams();
  delete params.page;
  delete params.pageSize;
  const qs = Object.entries(params).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
  doExport(qs ? `/api/export/filtered?${qs}` : '/api/export');
}
async function doExport(url) {
  showToast('正在导出...','info');
  try {
    const r = await fetch(url);
    if (!r.ok) { const e = await r.json().catch(()=>{}); throw new Error(e?.message || '导出失败'); }
    const blob = await r.blob();
    // 从 Content-Disposition 或 URL 提取文件名
    const cd = r.headers.get('Content-Disposition');
    let filename = `需求单信息-${new Date().toISOString().slice(0,10)}.xlsx`;
    if (cd) { const m = cd.match(/filename\*?=(?:UTF-8'')?([^;\s]+)/i); if (m) filename = decodeURIComponent(m[1]); }
    // 触发下载
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    showResultModal({
      title: '📤 导出完成',
      type: 'success',
      stats: [{ label: '导出文件', count: 1 }],
      filename
    });
  } catch(e) { showToast(e.message, 'error'); }
}

// ---- 流转文件管理 ----
var filePage = 1;
function gotoFilePage(p) { filePage = p; loadFiles(); }

async function loadFiles() {
  try {
    const params = new URLSearchParams();
    const kw = document.getElementById('file-filter-keyword')?.value?.trim();
    if (kw) params.set('keyword', kw);
    const ft = document.getElementById('file-filter-type')?.value;
    if (ft) params.set('file_type', ft);
    const dept = document.getElementById('file-filter-department')?.value;
    if (dept) params.set('department', dept);
    const df = document.getElementById('file-filter-date-from')?.value;
    if (df) params.set('date_from', df);
    const dt = document.getElementById('file-filter-date-to')?.value;
    if (dt) params.set('date_to', dt);
    params.set('page', filePage);
    params.set('pageSize', 20);

    const r = await fetch('/api/files?' + params.toString());
    const d = await r.json();
    if (!d.success) { showToast(d.message, 'error'); return; }

    // 填充类型下拉
    const typeSel = document.getElementById('file-filter-type');
    if (typeSel && typeSel.options.length <= 1) {
      try { const ftRes = await api('/api/config/file_type');
        (ftRes.data || []).forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; typeSel.appendChild(o); });
      } catch(e) {}
    }
    // 填充部门下拉
    const deptSel = document.getElementById('file-filter-department');
    if (deptSel && deptSel.options.length <= 1 && d.filters?.departments) {
      d.filters.departments.forEach(dep => { const o = document.createElement('option'); o.value = dep; o.textContent = dep; deptSel.appendChild(o); });
    }

    const tbody = document.querySelector('#files-table tbody');
    const info = document.getElementById('file-result-info');
    if (info) info.textContent = d.total ? '共 ' + d.total + ' 条' : '';

    if (!d.items.length) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon">📎</div><p>暂无流转文件</p></div></td></tr>';
      document.getElementById('files-pagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = d.items.map(function(f) {
      return '<tr>' +
        '<td><a href="/api/files/' + f.id + '/download" target="_blank" style="color:#333;text-decoration:none" title="点击下载">📄 ' + esc(f.original_name) + '</a></td>' +
        '<td><span class="file-type">' + esc(f.file_type) + '</span></td>' +
        '<td><a href="javascript:void(0)" onclick="navigate(\'orders\');setTimeout(function(){viewOrder(' + f.order_id + ')},100)" style="color:#1890ff;font-weight:500">' + esc(f.order_number) + '</a><br><span style="font-size:11px;color:#999">' + esc(f.order_name || '') + '</span></td>' +
        '<td>' + esc(f.department || '-') + '</td>' +
        '<td>' + (f.sub_batch ? '<span style="font-size:11px;background:#e6f7ff;color:#1890ff;padding:0 6px;border-radius:3px">' + esc(f.sub_batch) + '</span>' : '-') + '</td>' +
        '<td style="font-size:12px;color:#999">' + (f.uploaded_at || '-') + '</td>' +
        '<td><a class="btn btn-sm" href="/api/files/' + f.id + '/download" target="_blank" title="下载">📥</a> <button class="btn btn-sm btn-danger" onclick="deleteFileFromList(' + f.id + ')" title="删除">🗑</button></td>' +
        '</tr>';
    }).join('');

    // 分页
    var pc = document.getElementById('files-pagination'); pc.innerHTML = '';
    if (d.totalPages > 1) {
      pc.innerHTML =
        '<button class="page-btn" onclick="gotoFilePage(1)" ' + (d.page<=1?'disabled':'') + '>«</button>' +
        '<button class="page-btn" onclick="gotoFilePage(' + (d.page-1) + ')" ' + (d.page<=1?'disabled':'') + '>‹</button>' +
        '<span class="page-info">第 ' + d.page + '/' + d.totalPages + ' 页 (共' + d.total + '条)</span>' +
        '<button class="page-btn" onclick="gotoFilePage(' + (d.page+1) + ')" ' + (d.page>=d.totalPages?'disabled':'') + '>›</button>' +
        '<button class="page-btn" onclick="gotoFilePage(' + d.totalPages + ')" ' + (d.page>=d.totalPages?'disabled':'') + '>»</button>';
    }
  } catch(e) { console.error(e); }
}

function applyFileFilter() { filePage = 1; loadFiles(); }
function resetFileFilter() {
  document.getElementById('file-filter-keyword').value = '';
  document.getElementById('file-filter-type').value = '';
  document.getElementById('file-filter-department').value = '';
  document.getElementById('file-filter-date-from').value = '';
  document.getElementById('file-filter-date-to').value = '';
  filePage = 1; loadFiles();
}
async function deleteFileFromList(id) {
  if (!confirm('确定删除该文件？')) return;
  try { await api('/api/files/' + id, { method: 'DELETE' }); showToast('已删除', 'success'); loadFiles(); } catch(e) {}
}

// 回车触发文件筛选
setTimeout(function() {
  var fi = document.getElementById('file-filter-keyword');
  if (fi) fi.addEventListener('keydown', function(e) { if (e.key === 'Enter') applyFileFilter(); });
}, 0);

function importExcel() { document.getElementById('import-file').click(); }
function downloadTemplate() { window.open('/api/import/template','_blank'); }

document.getElementById('import-file')?.addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const fd = new FormData(); fd.append('file',f);
  showToast('正在导入...','info');
  try {
    const r = await fetch('/api/import',{method:'POST',body:fd});
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    const stats = [
      { label: '需求单', count: d.data.orderCount },
      { label: '需求点', count: d.data.pointCount }
    ];
    if (d.data.meetingCount) stats.push({ label: '会议', count: d.data.meetingCount });
    if (d.data.scheduleCount) stats.push({ label: '排期', count: d.data.scheduleCount });
    showResultModal({
      title: '📊 导入结果',
      type: 'success',
      stats,
      warnings: d.data.warnings
    });
    e.target.value=''; loadOrders();
  } catch(e) { showToast(e.message,'error'); }
});

// 强制绑定到 window（确保内联 onclick 能找到）
window.viewOrder = viewOrder;
window.editOrder = editOrder;
window.deleteOrder = deleteOrder;

document.addEventListener('DOMContentLoaded', function() {
  loadOrders(); loadDropdowns();
});

