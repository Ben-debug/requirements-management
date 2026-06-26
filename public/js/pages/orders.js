/**
 * 需求单管理页面
 * 需求单列表、筛选、创建/编辑、详情弹窗、需求点管理、文件管理
 */

// ---- 筛选参数 ----
function getFilterParams() {
  const pageSize = parseInt(document.getElementById('pagination-page-size')?.value) || 10;
  const params = { page: state.orderPage, pageSize: pageSize > 0 ? pageSize : 10 };
  const dept = document.getElementById('filter-department')?.value;
  if (dept) params.department = dept;
  const df = document.getElementById('filter-date-from')?.value;
  if (df) params.date_from = df;
  const dt = document.getElementById('filter-date-to')?.value;
  if (dt) params.date_to = dt;
  const ip = document.getElementById('filter-is-project')?.value;
  if (ip) params.is_project = ip;
  const sort = document.getElementById('filter-sort')?.value;
  if (sort) params.sort = sort;
  const order = document.getElementById('filter-order')?.value;
  if (order) params.order = order;
  const group_by = document.getElementById('filter-group-orders')?.value;
  if (group_by) params.group_by = group_by;
  return params;
}

// ---- 加载需求单列表 ----
async function loadOrders() {
  try {
    const params = getFilterParams();
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const r = await api(`/api/orders?${qs}`);
    state.orders = r.items;
    document.getElementById('filter-result-info').textContent = r.total ? `共 ${r.total} 条` : '';

    const tbody = document.querySelector('#orders-table tbody');
    if (!r.items.length) {
      tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="icon">🔍</div><p>暂无匹配的需求单</p></div></td></tr>';
      renderPagination('orders-pagination', r, 'gotoOrderPage');
      return;
    }

    function orderRow(o) {
      const rds = o.related_departments ? o.related_departments.split(',').filter(Boolean) : [];
      const schedCount = (o.schedule_summary || {}).scheduled || 0, totalPoints = (o.schedule_summary || {}).total || 0;
      const projCount = (o.schedule_summary || {}).project_count || 0;
      const projHtml = projCount ? '<span class="badge badge-orange" style="margin-left:4px">📋 立项</span>' : '';
      let schedHtml = '';
      if (totalPoints === 0) schedHtml = '<span style="font-size:12px;color:#999">—</span>';
      else if (schedCount === totalPoints) schedHtml = '<span style="font-size:12px;color:#52c41a;font-weight:500">✅ ' + schedCount + '/' + totalPoints + '</span>';
      else if (schedCount > 0) schedHtml = '<span style="font-size:12px;color:#fa8c16;font-weight:500">⏳ ' + schedCount + '/' + totalPoints + '</span>';
      else schedHtml = '<span style="font-size:12px;color:#ff4d4f;font-weight:500">⏳ 0/' + totalPoints + '</span>';
      return `<tr>
        <td><a href="javascript:void(0)" onclick="window.viewOrder(${o.id})" style="color:#1890ff;font-weight:600;text-decoration:underline">${o.order_number}</a></td>
        <td>${esc(o.name)}</td><td>${esc(o.department || '-')}</td>
        <td>${rds.length ? rds.map(d => '<span class="badge badge-blue">' + esc(d.trim()) + '</span>').join(' ') : '-'}</td>
        <td>${esc(o.proposer || '-')}</td>
        <td>${o.propose_date || '-'}</td><td>${esc(o.business_launch_date || '-')}</td>
        <td style="text-align:center">${schedHtml}${projHtml}</td>
        <td><div class="action-group"><button class="btn btn-sm" onclick="window.viewOrder(${o.id})">编辑</button><button class="btn btn-sm btn-danger" onclick="window.deleteOrder(${o.id})">删除</button></div></td>
      </tr>`;
    }

    if (r.grouped) {
      const deptOrder = r.filters?.departments || [];
      const sortKeys = Object.keys(r.grouped).sort((a, b) => {
        const ia = deptOrder.indexOf(a), ib = deptOrder.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b, 'zh-CN');
      });
      let html = '';
      sortKeys.forEach(key => {
        html += `<tr class="group-header" onclick="toggleOrderGroup(this)" data-collapsed="false"><td colspan="9" style="padding:8px 12px;font-weight:600;font-size:14px;color:#1890ff;background:#e6f7ff;cursor:pointer;user-select:none">📁 ${esc(key)}（${r.grouped[key].length}条） <span class="group-arrow" style="float:right;margin-right:8px">▼</span></td></tr>`;
        r.grouped[key].forEach(o => { html += orderRow(o); });
      });
      tbody.innerHTML = html;
      document.getElementById('orders-pagination').innerHTML = '';
    } else {
      tbody.innerHTML = r.items.map(o => orderRow(o)).join('');
      renderPagination('orders-pagination', r, 'gotoOrderPage');
    }

    if (r.filters?.departments) {
      const sel = document.getElementById('filter-department');
      if (sel && sel.options.length <= 1) {
        r.filters.departments.forEach(d => { const o = document.createElement('option'); o.value = d; o.textContent = d; sel.appendChild(o); });
      }
    }
  } catch (e) { console.error("loadOrders error:", e); }
}

function applyFilters() { state.orderPage = 1; loadOrders(); }
function onFilterChange() { state.orderPage = 1; loadOrders(); }
function resetFilters() {
  document.getElementById('filter-department').value = '';
  document.getElementById('filter-date-from').value = '';
  document.getElementById('filter-date-to').value = '';
  document.getElementById('filter-is-project').value = '';
  document.getElementById('filter-group-orders').value = 'department';
  document.getElementById('filter-sort').value = 'order_number';
  document.getElementById('filter-order').value = 'asc';
  state.orderPage = 1;
  loadOrders();
}

function gotoOrderPage(p) { state.orderPage = p; loadOrders(); }

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

// ---- 创建/编辑需求单 ----
function showCreateOrder() {
  state.editingOrderId = null;
  document.getElementById('order-modal-title').textContent = '新建需求单';
  document.getElementById('order-form').reset();
  document.getElementById('order_number').disabled = false;
  loadDropdowns();
  loadRelatedDeptCheckboxes([]);
  openModal('order-modal');
}

async function editOrder(id) {
  state.editingOrderId = id;
  const o = (await api(`/api/orders/${id}`)).data;
  document.getElementById('order-modal-title').textContent = '编辑需求单';
  document.getElementById('order_number').value = o.order_number;
  document.getElementById('order_number').dataset.originalNumber = o.order_number;
  document.getElementById('order_number').disabled = false;
  document.getElementById('order_name').value = o.name;
  await loadDropdowns();
  document.getElementById('department').value = o.department || '';
  document.getElementById('proposer').value = o.proposer || '';
  document.getElementById('propose_date').value = o.propose_date || '';
  document.getElementById('background').value = o.background || '';
  document.getElementById('business_launch_date').value = o.business_launch_date || '';
  const rds = o.related_departments ? o.related_departments.split(',').map(s => s.trim()).filter(Boolean) : [];
  loadRelatedDeptCheckboxes(rds);
  openModal('order-modal');
}

async function deleteOrder(id) {
  if (!confirm('确定删除？')) return;
  try { await api(`/api/orders/${id}`, { method: 'DELETE' }); showToast('已删除', 'success'); loadOrders(); } catch (e) {}
}

// ---- 需求单表单提交 ----
document.getElementById('order-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  clearFieldErrors();
  const form = e.target;
  const fd = new FormData(form);
  const data = {};
  for (const [key, val] of fd.entries()) {
    if (key === 'related_departments') { if (!data[key]) data[key] = []; data[key].push(val); }
    else data[key] = val;
  }

  let hasError = false;
  if (!data.order_number || !/^[A-Z]\d+$/.test(data.order_number)) { showFieldError('order_number', '格式：大写字母开头+数字（如 A01）'); hasError = true; }
  if (!data.name || !data.name.trim()) { showFieldError('order_name', '请输入需求单名称'); hasError = true; }
  if (!data.department) { showFieldError('department', '请选择业务部门'); hasError = true; }
  if (!data.proposer || !data.proposer.trim()) { showFieldError('proposer', '请输入提出人'); hasError = true; }
  if (!data.propose_date) { showFieldError('propose_date', '请选择提出日期'); hasError = true; }
  if (hasError) return;

  try {
    if (!state.editingOrderId) {
      const c = await (await fetch(`/api/orders/check/${data.order_number}`)).json();
      if (c.exists) { showFieldError('order_number', '该编号已被使用'); return; }
    }
    const body = JSON.stringify(data);
    if (state.editingOrderId) {
      const origNum = document.getElementById('order_number').dataset.originalNumber;
      if (origNum && data.order_number === origNum) delete data.order_number;
      await api(`/api/orders/${state.editingOrderId}`, { method: 'PUT', body });
      showToast('更新成功', 'success');
    } else {
      await api('/api/orders', { method: 'POST', body });
      showToast('创建成功', 'success');
    }
    closeModal('order-modal');
    state.editingOrderId = null;
    loadOrders();
    const detailEl = document.getElementById('detail-modal');
    if (detailEl && detailEl.classList.contains('open')) {
      viewOrder(document.getElementById('detail-order-id').value);
    }
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('编号')) showFieldError('order_number', msg);
    else showToast(msg || '保存失败', 'error');
  }
});

// ---- 需求单详情 ----
async function viewOrder(id) {
  try {
    const r = await fetch('/api/orders/' + id);
    const d = await r.json();
    if (!d.success) return;
    const o = d.data;
    state.currentOrder = o;

    for (const k of ['detail-number', 'detail-number-display']) document.getElementById(k).textContent = o.order_number;
    document.getElementById('detail-name').textContent = o.name;
    document.getElementById('detail-department').textContent = o.department || '-';
    document.getElementById('detail-proposer').textContent = o.proposer || '-';
    document.getElementById('detail-propose-date').textContent = o.propose_date || '-';
    document.getElementById('detail-background').textContent = o.background || '-';
    document.getElementById('detail-launch-date').textContent = o.business_launch_date || '-';
    document.getElementById('detail-order-id').value = o.id;

    const rds = o.related_departments ? o.related_departments.split(',').filter(Boolean) : [];
    document.getElementById('detail-related-depts').innerHTML = rds.length ? rds.map(d => '<span class="badge badge-blue">' + esc(d.trim()) + '</span>').join(' ') : '-';

    const batchSel = document.getElementById('file-batch');
    if (batchSel) {
      const batches = [...new Set((o.points || []).map(p => p.sub_batch).filter(b => b))].sort();
      batchSel.innerHTML = '<option value="">所属子单（选填）</option>' + batches.map(b => '<option value="' + b + '">' + o.order_number + '-' + b + '</option>').join('');
    }

    await loadDropdowns();
    renderDetailPoints(o.points || []);
    renderFiles(o.files || []);
    openModal('detail-modal');
    scanAndLinkOrderFiles(id);
  } catch (e) { console.error(e); }
}

async function scanAndLinkOrderFiles(orderId) {
  try {
    const r = await fetch(`/api/orders/${orderId}/scan-files`);
    const d = await r.json();
    if (!d.success) return;
    if (d.count > 0) { showToast(`已自动关联 ${d.count} 个流转文件`, 'success'); viewOrder(orderId); }
  } catch (e) { /* 静默 */ }
}

// ---- 需求点渲染 ----
function renderDetailPoints(points) {
  const c = document.getElementById('detail-points');
  if (!points.length) { c.innerHTML = '<div class="empty-state"><p>暂无需求点</p></div>'; return; }
  const oid = document.getElementById('detail-order-id').value;
  const orderNum = document.getElementById('detail-number-display')?.textContent || '';

  const batched = {}, unbatched = [];
  points.forEach(p => {
    if (p.sub_batch) { if (!batched[p.sub_batch]) batched[p.sub_batch] = []; batched[p.sub_batch].push(p); }
    else { unbatched.push(p); }
  });

  const totalScheduled = points.filter(p => p.schedule_system || p.schedule_id).length;
  const totalCount = points.length;
  const batchCount = Object.keys(batched).length;
  const pct = totalCount ? Math.round(totalScheduled / totalCount * 100) : 0;

  let html = '';
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

  const batchKeys = Object.keys(batched).sort((a, b) => parseInt(a) - parseInt(b));

  batchKeys.forEach(batch => {
    const pts = batched[batch];
    const scheduled = pts.filter(p => p.schedule_system || p.schedule_id).length;
    const allScheduled = scheduled === pts.length;
    const anyScheduled = scheduled > 0;
    const batchLabel = orderNum + '-' + batch;
    const batchPct = Math.round(scheduled / pts.length * 100);

    html += `<div class="batch-card" style="border:1px solid #e8e8e8;border-radius:8px;margin-bottom:12px;overflow:hidden">`;
    html += `<div class="batch-header" style="margin:0;border-left:4px solid ${allScheduled ? '#52c41a' : (anyScheduled ? '#fa8c16' : '#d9d9d9')};border-radius:0;cursor:pointer" onclick="this.nextElementSibling.classList.toggle('batch-collapsed')">
      <div class="batch-header-left">
        <span style="font-size:13px;color:#999;cursor:pointer" title="点击折叠/展开">▼</span>
        <span class="batch-title" style="font-size:15px">📁 ${batchLabel}</span>
        <span class="batch-count">${pts.length}项</span>
        ${allScheduled ? '<span class="badge badge-green">✅ 全部排期</span>' : (anyScheduled ? '<span class="badge badge-orange">⏳ 部分排期</span>' : '<span class="badge" style="background:#f5f5f5;color:#999;border:1px solid #d9d9d9">⏳ 待排期</span>')}
      </div>
      <div class="batch-header-right" style="display:flex;align-items:center;gap:10px">
        <div style="width:80px;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${batchPct}%;background:${allScheduled ? '#52c41a' : '#fa8c16'};border-radius:3px"></div>
        </div>
        <span style="font-size:11px;color:#999">${batchPct}%</span>
        ${!allScheduled ? `<button class="btn btn-sm btn-success" onclick="event.stopPropagation();batchScheduleSubOrder(${oid},'${batch}')">📋 整批排期</button>` : ''}
        <span style="font-size:11px;color:#ccc">▼</span>
      </div>
    </div>`;
    html += `<div class="batch-points">`;
    pts.forEach(p => { html += renderPointItem(p, oid); });
    html += `</div></div>`;
  });

  if (unbatched.length) {
    if (batchKeys.length) {
      html += `<div class="batch-card" style="border:1px solid #e8e8e8;border-radius:8px;margin-bottom:12px;overflow:hidden;opacity:0.85">
        <div class="batch-header" style="margin:0;border-left:4px solid #d9d9d9;border-radius:0;background:#fafafa;cursor:pointer" onclick="this.nextElementSibling.classList.toggle('batch-collapsed')">
          <div class="batch-header-left">
            <span style="font-size:13px;color:#999;cursor:pointer" title="点击折叠/展开">▼</span>
            <span style="font-size:14px;color:#999">📋 基础需求点（无子单）</span>
            <span style="font-size:12px;color:#999">${unbatched.length}项</span>
          </div>
          <div class="batch-header-right"><span style="font-size:11px;color:#ccc">▼</span></div>
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
  const descId = `pd-${p.id}`;
  const isLong = p.description && p.description.length > 80;
  return `<div class="point-item">
    <div class="point-info">
      <div class="point-number">${esc(p.point_number)}${tag}</div>
      <div id="${descId}" class="point-desc ${isLong ? 'point-desc-clamped' : ''}" onclick="${isLong ? `togglePointDesc('${descId}')` : ''}">${esc(p.description).replace(/\n/g, '<br>')}</div>
      ${isLong ? `<span class="desc-toggle-btn" onclick="togglePointDesc('${descId}')">展开全文 ▼</span>` : ''}
      <div class="point-meta">${has ? `<span style="color:#52c41a">✅ ${systems.map(s => esc(s.trim())).join(', ')} | ${esc(p.schedule_version)}</span>` : '<span style="color:#fa8c16">⏳ 待排期</span>'}
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

function togglePointDesc(descId) {
  const el = document.getElementById(descId);
  if (!el) return;
  const isClamped = el.classList.contains('point-desc-clamped');
  const btn = el.parentElement.querySelector('.desc-toggle-btn');
  if (isClamped) { el.classList.remove('point-desc-clamped'); if (btn) btn.textContent = '收起 ▲'; }
  else { el.classList.add('point-desc-clamped'); if (btn) btn.textContent = '展开全文 ▼'; }
}

// ---- 需求点表单提交 ----
document.getElementById('point-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const desc = document.getElementById('point-description').value;
  const subBatch = document.getElementById('point-sub-batch')?.value?.trim() || '';
  try {
    if (state.editingPointId) {
      await api(`/api/points/${state.editingPointId}`, { method: 'PUT', body: JSON.stringify({ description: desc, sub_batch: subBatch || null }) });
      showToast('已更新', 'success');
    } else {
      const body = { description: desc };
      if (subBatch) body.sub_batch = subBatch;
      await api(`/api/orders/${document.getElementById('detail-order-id').value}/points`, { method: 'POST', body: JSON.stringify(body) });
      showToast('已添加', 'success');
    }
    closeModal('point-modal');
    document.getElementById('point-form').reset();
    state.editingPointId = null;
    viewOrder(document.getElementById('detail-order-id').value);
  } catch (e) {}
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
  const p = o.points.find(x => x.id === id);
  if (!p) return;
  document.getElementById('point-modal-title').textContent = `编辑 - ${p.point_number}`;
  document.getElementById('point-description').value = p.description;
  document.getElementById('point-batch-group').style.display = 'block';
  document.getElementById('point-sub-batch').value = p.sub_batch || '';
  updatePointBatchPreview();
  openModal('point-modal');
}

async function deletePoint(id) {
  if (!confirm('确定删除？')) return;
  try {
    await api(`/api/points/${id}`, { method: 'DELETE' });
    showToast('已删除', 'success');
    viewOrder(document.getElementById('detail-order-id').value);
  } catch (e) {}
}

function updatePointBatchPreview() {
  const orderNum = document.getElementById('detail-number-display')?.textContent;
  const batch = document.getElementById('point-sub-batch')?.value?.trim();
  const preview = document.getElementById('point-batch-preview');
  if (!preview) return;
  if (batch && orderNum) { preview.textContent = `→ 子单 ${batch}（仅分组，编号格式为 ${orderNum}001）`; }
  else { preview.textContent = ''; }
}

// ---- 文件管理 ----
function renderFiles(files) {
  const c = document.getElementById('detail-files');
  if (!files.length) { c.innerHTML = '<div class="empty-state"><p>暂无流转文件</p></div>'; return; }
  const grouped = {}, ungrouped = [];
  files.forEach(function (f) { if (f.sub_batch) { if (!grouped[f.sub_batch]) grouped[f.sub_batch] = []; grouped[f.sub_batch].push(f); } else ungrouped.push(f); });
  let html = '', orderNum = document.getElementById('detail-number-display')?.textContent || '';
  Object.keys(grouped).sort().forEach(function (batch) {
    html += '<div style="padding:6px 12px;margin:8px 0 4px;background:#f0f5ff;border-radius:4px;font-size:13px;color:#1890ff;font-weight:500">📁 ' + orderNum + '-' + batch + '</div>';
    grouped[batch].forEach(function (f) { html += fileItemHtml(f); });
  });
  if (ungrouped.length) {
    if (Object.keys(grouped).length) html += '<div style="padding:6px 12px;margin:8px 0 4px;font-size:13px;color:#999;font-weight:500">📎 通用文件（无关联子单）</div>';
    ungrouped.forEach(function (f) { html += fileItemHtml(f); });
  }
  c.innerHTML = html;
}

async function uploadFile() {
  const oid = document.getElementById('detail-order-id').value, fi = document.getElementById('file-upload'), ft = document.getElementById('file-type').value;
  if (!fi.files.length) { showToast('请选择文件', 'error'); return; }
  if (!ft) { showToast('请选择文件类型', 'error'); return; }
  const fd = new FormData();
  fd.append('file', fi.files[0]);
  fd.append('file_type', ft);
  const fb = document.getElementById('file-batch')?.value;
  if (fb) fd.append('sub_batch', fb);
  try {
    const r = await fetch(`/api/orders/${oid}/files`, { method: 'POST', body: fd });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    showToast('上传成功', 'success');
    fi.value = '';
    viewOrder(oid);
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteFile(id) {
  if (!confirm('确定删除？')) return;
  try {
    await api(`/api/files/${id}`, { method: 'DELETE' });
    showToast('已删除', 'success');
    viewOrder(document.getElementById('detail-order-id').value);
  } catch (e) {}
}

// ---- 整批排期（子单维度）----
async function batchScheduleSubOrder(orderId, batch) {
  const o = (await api(`/api/orders/${orderId}`)).data;
  const points = o.points.filter(p => p.sub_batch === batch);
  const unscheduled = points.filter(p => !(p.schedule_system || p.schedule_id));
  if (!unscheduled.length) { showToast('该批次已全部排期', 'info'); return; }

  const [s, v, meetings] = await Promise.all([api('/api/config/system'), api('/api/config/version'), api('/api/meetings')]);
  if (!meetings.data.length) { showToast('请先创建CCB会议', 'error'); navigate('meetings'); return; }

  const mtgSelect = document.getElementById('batch-schedule-meeting');
  mtgSelect.innerHTML = '<option value="">请选择CCB会议</option>';
  meetings.data.forEach(m => { const o2 = document.createElement('option'); o2.value = m.id; o2.textContent = m.meeting_name + ' (' + m.meeting_date + ')'; mtgSelect.appendChild(o2); });

  const container = document.getElementById('batch-schedule-points');
  container.innerHTML = '';
  unscheduled.forEach((p, idx) => {
    const div = document.createElement('div');
    div.style.cssText = 'padding:10px;margin-bottom:6px;background:#fafafa;border-radius:6px;border-left:3px solid #1890ff';
    div.innerHTML = `
      <div style="font-weight:600;font-size:13px;color:#333;margin-bottom:8px">${esc(p.point_number)} ${esc(p.description).replace(/\n/g, '<br>')}</div>
      <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
        <div><div style="font-size:12px;color:#999;margin-bottom:4px">涉及系统</div><div id="bps-${p.id}" style="display:flex;flex-wrap:wrap;gap:2px"></div></div>
        <div><div style="font-size:12px;color:#999;margin-bottom:4px">上线版本</div><select id="bpv-${p.id}" style="padding:4px 8px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;min-width:100px"><option value="">请选择版本</option></select></div>
        <div><div style="font-size:12px;color:#999;margin-bottom:4px">立项</div><label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;cursor:pointer"><input type="checkbox" class="bpi-cb" data-pid="${p.id}"> 已立项</label></div>
      </div>`;
    container.appendChild(div);

    const sysCtr = document.getElementById('bps-' + p.id);
    (s.data || []).forEach(sys => {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:4px 8px;margin:2px;border:1px solid #d9d9d9;border-radius:4px;cursor:pointer;font-size:12px';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = sys; cb.className = 'system-cb';
      lbl.appendChild(cb); lbl.appendChild(document.createTextNode(sys));
      lbl.onmouseover = () => lbl.style.borderColor = '#1890ff';
      lbl.onmouseout = () => lbl.style.borderColor = '#d9d9d9';
      sysCtr.appendChild(lbl);
    });
    const verSel = document.getElementById('bpv-' + p.id);
    v.data.forEach(x => { const o2 = document.createElement('option'); o2.value = x; o2.textContent = x; verSel.appendChild(o2); });
  });

  document.getElementById('batch-schedule-order-id').value = orderId;
  document.getElementById('batch-schedule-batch').value = batch;
  document.getElementById('batch-schedule-count').textContent = `待排期 ${unscheduled.length} 项（${o.order_number}-${batch}）`;
  openModal('batch-schedule-modal');
}

async function confirmBatchSchedule() {
  const meetingId = document.getElementById('batch-schedule-meeting').value;
  const orderId = parseInt(document.getElementById('batch-schedule-order-id').value);
  const batch = document.getElementById('batch-schedule-batch').value;
  if (!meetingId) { showToast('请选择CCB会议', 'error'); return; }

  const o = (await api(`/api/orders/${orderId}`)).data;
  const unscheduled = o.points.filter(p => p.sub_batch === batch && !(p.schedule_system || p.schedule_id));
  if (!unscheduled.length) { showToast('暂无待排期项', 'info'); closeModal('batch-schedule-modal'); return; }

  const schedules = [];
  const skipped = [];
  unscheduled.forEach(p => {
    const systems = getSelectedSystems('bps-' + p.id);
    const version = document.getElementById('bpv-' + p.id).value;
    const bpiCb = document.querySelector(`.bpi-cb[data-pid="${p.id}"]`);
    const isProject = bpiCb ? (bpiCb.checked ? 1 : 0) : 0;
    if (!systems.length || !version) {
      skipped.push(`${p.point_number}（${!systems.length ? '缺系统' : ''}${!systems.length && !version ? '、' : ''}${!version ? '缺版本' : ''}）`);
      return;
    }
    schedules.push({ order_id: orderId, point_id: p.id, system: systems.join(','), version, is_project: isProject });
  });

  if (!schedules.length) { showToast('未配置任何需求点的系统和版本，请逐点填写', 'error'); return; }
  try {
    const r = await fetch(`/api/meetings/${meetingId}/schedules/batch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedules })
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    let msg = `排期成功：${d.data.count} 项`;
    if (skipped.length) msg += `，跳过 ${skipped.length} 项（${skipped.join('；')}）`;
    showToast(msg, 'success');
    closeModal('batch-schedule-modal');
    viewOrder(orderId);
  } catch (e) { showToast(e.message, 'error'); }
}
