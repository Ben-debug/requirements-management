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
  document.querySelectorAll('.page-content').forEach(e => e.style.display = 'none');
  document.getElementById(`page-${page}`).style.display = 'block';
  if (page === 'orders') { state.orderPage = 1; loadOrders(); }
  else if (page === 'meetings') loadMeetings();
  else if (page === 'schedules') { state.schedulePage = 1; loadScheduleFilter(); }
  else if (page === 'config') loadConfig();
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
  } catch(e) {}
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

function getSelectedSystems() { return Array.from(document.querySelectorAll('.system-cb:checked')).map(cb => cb.value); }
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
      body.innerHTML = items.map(item => `<div class="config-item"><span>${esc(item.label)}</span><button class="btn btn-sm btn-danger" onclick="deleteConfigItem(${item.id})">删除</button></div>`).join('') +
        `<div style="margin-top:8px"><button class="btn btn-sm btn-primary" onclick="showAddConfig('${cat}')">＋ 添加</button></div>`;
    });
  } catch(e) { console.error(e); }
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

async function deleteConfigItem(id) {
  if (!confirm('确定删除？')) return;
  try { await api(`/api/config/${id}`,{method:'DELETE'}); showToast('已删除','success'); loadConfig(); } catch(e) {}
}

// ---- Orders with Pagination ----
async function loadOrders() {
  try {
    const r = await api(`/api/orders?page=${state.orderPage}&pageSize=10`);
    state.orders = r.items;
    const tbody = document.querySelector('#orders-table tbody');
    if (!r.items.length) { tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon">📋</div><p>暂无需求单数据</p></div></td></tr>'; renderPagination('orders-pagination', r); return; }
    tbody.innerHTML = r.items.map(o => `<tr>
      <td><a href="javascript:void(0)" onclick="viewOrder(${o.id})" style="color:#1890ff;font-weight:600;text-decoration:underline">${o.order_number}</a></td>
      <td>${esc(o.name)}</td><td>${esc(o.department||'-')}</td><td>${esc(o.proposer||'-')}</td>
      <td>${o.propose_date||'-'}</td><td>${esc(o.business_launch_date||'-')}</td>
      <td><div class="action-group"><button class="btn btn-sm" onclick="viewOrder(${o.id})">查看</button><button class="btn btn-sm" onclick="editOrder(${o.id})">编辑</button><button class="btn btn-sm btn-danger" onclick="deleteOrder(${o.id})">删除</button></div></td>
    </tr>`).join('');
    renderPagination('orders-pagination', r);
  } catch(e) {}
}

function renderPagination(containerId, r) {
  const c = document.getElementById(containerId); if (!c) return;
  if (!r || r.totalPages <= 1) { c.innerHTML = ''; return; }
  c.innerHTML = `<button class="page-btn" onclick="gotoOrderPage(1)" ${r.page<=1?'disabled':''}>«</button>
    <button class="page-btn" onclick="gotoOrderPage(${r.page-1})" ${r.page<=1?'disabled':''}>‹</button>
    <span class="page-info">第 ${r.page}/${r.totalPages} 页 (共${r.total}条)</span>
    <button class="page-btn" onclick="gotoOrderPage(${r.page+1})" ${r.page>=r.totalPages?'disabled':''}>›</button>
    <button class="page-btn" onclick="gotoOrderPage(${r.totalPages})" ${r.page>=r.totalPages?'disabled':''}>»</button>`;
}
function gotoOrderPage(p) { state.orderPage = p; loadOrders(); }
function gotoSchedulePage(p) { state.schedulePage = p; applyFilter(); }

document.getElementById('order-form')?.addEventListener('submit', async e => {
  e.preventDefault(); const data = Object.fromEntries(new FormData(e.target));
  if (!/^[A-Z]\d{2}$/.test(data.order_number)) { showToast('格式：1大写字母+2数字','error'); return; }
  try {
    if (!state.editingOrderId) { const c = await (await fetch(`/api/orders/check/${data.order_number}`)).json(); if (c.exists) { showToast('编号已存在','error'); return; } }
    if (state.editingOrderId) { await api(`/api/orders/${state.editingOrderId}`,{method:'PUT',body:JSON.stringify(data)}); showToast('更新成功','success'); }
    else { await api('/api/orders',{method:'POST',body:JSON.stringify(data)}); showToast('创建成功','success'); }
    closeModal('order-modal'); e.target.reset(); state.editingOrderId = null; loadOrders();
  } catch(e) {}
});

function showCreateOrder() { state.editingOrderId = null; document.getElementById('order-modal-title').textContent = '新建需求单'; document.getElementById('order-form').reset(); document.getElementById('order_number').disabled = false; loadDropdowns(); openModal('order-modal'); }
async function editOrder(id) { state.editingOrderId = id; const o = (await api(`/api/orders/${id}`)).data; document.getElementById('order-modal-title').textContent = '编辑需求单'; document.getElementById('order_number').value = o.order_number; document.getElementById('order_number').disabled = true; document.getElementById('order_name').value = o.name; await loadDropdowns(); document.getElementById('department').value = o.department||''; document.getElementById('proposer').value = o.proposer||''; document.getElementById('propose_date').value = o.propose_date||''; document.getElementById('business_launch_date').value = o.business_launch_date||''; openModal('order-modal'); }
async function deleteOrder(id) { if (!confirm('确定删除？')) return; try { await api(`/api/orders/${id}`,{method:'DELETE'}); showToast('已删除','success'); loadOrders(); } catch(e) {} }

// ---- Detail ----
async function viewOrder(id) {
  const o = (await api(`/api/orders/${id}`)).data; state.currentOrder = o;
  for (const k of ['detail-number','detail-number-display']) document.getElementById(k).textContent = o.order_number;
  document.getElementById('detail-name').textContent = o.name; document.getElementById('detail-department').textContent = o.department||'-';
  document.getElementById('detail-proposer').textContent = o.proposer||'-'; document.getElementById('detail-propose-date').textContent = o.propose_date||'-';
  document.getElementById('detail-launch-date').textContent = o.business_launch_date||'-'; document.getElementById('detail-order-id').value = o.id;
  await loadDropdowns(); renderDetailPoints(o.points||[]); renderFiles(o.files||[]); openModal('detail-modal');
}

function renderDetailPoints(points) {
  const c = document.getElementById('detail-points');
  if (!points.length) { c.innerHTML = '<div class="empty-state"><p>暂无需求点</p></div>'; return; }
  const oid = document.getElementById('detail-order-id').value;
  c.innerHTML = points.map(p => {
    const has = p.schedule_system || p.schedule_id; const systems = p.schedule_system ? p.schedule_system.split(',').filter(Boolean) : [];
    return `<div class="point-item"><div class="point-info"><div class="point-number">${esc(p.point_number)}</div><div class="point-desc">${esc(p.description)}</div>
      <div class="point-meta">${has ? `<span style="color:#52c41a">✅ ${systems.map(s=>esc(s.trim())).join(', ')} | ${esc(p.schedule_version)}</span>` : '<span style="color:#fa8c16">⏳ 待排期</span>'}
      ${p.meeting_name ? ` | 📅 ${esc(p.meeting_name)} (${p.meeting_date})` : ''}</div></div>
      <div class="point-actions">
        <button class="btn btn-sm" onclick="editPoint(${p.id},${oid})">编辑</button>
        ${!has ? `<button class="btn btn-sm btn-success" onclick="showScheduleModal(${p.id},${oid})">排期</button>`
          : `<button class="btn btn-sm" onclick="openEditScheduleModal(${p.schedule_id},${oid})">修改排期</button><button class="btn btn-sm btn-danger" onclick="deleteScheduleFromDetail(${p.schedule_id})">移除排期</button>`}
        <button class="btn btn-sm btn-danger" onclick="deletePoint(${p.id})">删除</button>
      </div></div>`;
  }).join('');
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
  try { const r = await fetch(`/api/meetings/${meetingId}/schedules`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order_id:parseInt(orderId),point_id:parseInt(pointId),system:systems.join(','),version})}); const d = await r.json(); if (!d.success) throw new Error(d.message); showToast('排期成功','success'); closeModal('quick-schedule-modal'); viewOrder(parseInt(orderId)); } catch(e) { showToast(e.message,'error'); }
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
  try { const body = {system:systems.join(','), version}; if (meetingId) body.meeting_id = parseInt(meetingId); await api(`/api/schedules/${scheduleId}`,{method:'PUT',body:JSON.stringify(body)}); showToast('排期已更新','success'); closeModal('edit-schedule-modal'); const oid = document.getElementById('detail-order-id')?.value; if (oid) viewOrder(parseInt(oid)); else viewMeeting(document.getElementById('schedule-meeting-id').value); } catch(e) { showToast(e.message,'error'); }
}

async function deleteScheduleFromDetail(id) { if (!confirm('确定移除？')) return; try { await api(`/api/schedules/${id}`,{method:'DELETE'}); showToast('已移除','success'); viewOrder(document.getElementById('detail-order-id').value); } catch(e) {} }

function renderFiles(files) {
  const c = document.getElementById('detail-files');
  if (!files.length) { c.innerHTML = '<div class="empty-state"><p>暂无流转文件</p></div>'; return; }
  c.innerHTML = files.map(f => `<div class="file-item"><div class="file-info"><span class="file-type">${esc(f.file_type)}</span><span>${esc(f.original_name)}</span></div><div class="action-group"><button class="btn btn-sm btn-danger" onclick="deleteFile(${f.id})">删除</button></div></div>`).join('');
}

document.getElementById('point-form')?.addEventListener('submit', async e => {
  e.preventDefault(); const desc = document.getElementById('point-description').value;
  try { if (state.editingPointId) { await api(`/api/points/${state.editingPointId}`,{method:'PUT',body:JSON.stringify({description:desc})}); showToast('已更新','success'); } else { await api(`/api/orders/${document.getElementById('detail-order-id').value}/points`,{method:'POST',body:JSON.stringify({description:desc})}); showToast('已添加','success'); } closeModal('point-modal'); document.getElementById('point-form').reset(); state.editingPointId = null; viewOrder(document.getElementById('detail-order-id').value); } catch(e) {}
});
function showAddPoint() { state.editingPointId = null; document.getElementById('point-modal-title').textContent = '添加需求点'; document.getElementById('point-description').value = ''; openModal('point-modal'); }
async function editPoint(id, oid) { state.editingPointId = id; const o = (await api(`/api/orders/${oid}`)).data; const p = o.points.find(x=>x.id===id); if (!p) return; document.getElementById('point-modal-title').textContent = `编辑 - ${p.point_number}`; document.getElementById('point-description').value = p.description; openModal('point-modal'); }
async function deletePoint(id) { if (!confirm('确定删除？')) return; try { await api(`/api/points/${id}`,{method:'DELETE'}); showToast('已删除','success'); viewOrder(document.getElementById('detail-order-id').value); } catch(e) {} }

async function uploadFile() {
  const oid = document.getElementById('detail-order-id').value, fi = document.getElementById('file-upload'), ft = document.getElementById('file-type').value;
  if (!fi.files.length) { showToast('请选择文件','error'); return; } if (!ft) { showToast('请选择文件类型','error'); return; }
  const fd = new FormData(); fd.append('file',fi.files[0]); fd.append('file_type',ft);
  try { const r = await fetch(`/api/orders/${oid}/files`,{method:'POST',body:fd}); const d = await r.json(); if (!d.success) throw new Error(d.message); showToast('上传成功','success'); fi.value=''; viewOrder(oid); } catch(e) { showToast(e.message,'error'); }
}
async function deleteFile(id) { if (!confirm('确定删除？')) return; try { await api(`/api/files/${id}`,{method:'DELETE'}); showToast('已删除','success'); viewOrder(document.getElementById('detail-order-id').value); } catch(e) {} }

// ---- Meetings ----
async function loadMeetings() {
  try { const meetings = (await api('/api/meetings')).data; const c = document.getElementById('meetings-list'); if (!meetings.length) { c.innerHTML = '<div class="empty-state"><div class="icon">📅</div><p>暂无CCB会议</p></div>'; return; } c.innerHTML = meetings.map(m => `<div class="schedule-card"><div class="sched-header"><div class="sched-title">${esc(m.meeting_name)}</div><div class="action-group"><button class="btn btn-sm" onclick="viewMeeting(${m.id})">排期管理</button><button class="btn btn-sm" onclick="editMeeting(${m.id})">编辑</button><button class="btn btn-sm btn-danger" onclick="deleteMeeting(${m.id})">删除</button></div></div><div class="sched-meta">日期: ${m.meeting_date}${m.notes?' | '+esc(m.notes):''}</div>${m.file_name?'<div class="sched-tags"><span class="sched-tag">📎 '+esc(m.file_name)+'</span></div>':''}</div>`).join(''); } catch(e) {}
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
    const groups = {}; pts.forEach(p => { if(!groups[p.order_number]) groups[p.order_number]=[]; groups[p.order_number].push(p); });
    let html = '<table style="width:100%;font-size:13px"><thead><tr><th style="padding:6px 8px;width:30px"><input type="checkbox" id="batch-select-all" onchange="toggleAllBatch()"></th><th style="padding:6px 8px">需求点</th><th style="padding:6px 8px">描述</th><th style="padding:6px 8px;min-width:180px">涉及系统</th><th style="padding:6px 8px;width:120px">版本</th></tr></thead><tbody>';
    Object.keys(groups).sort().forEach(orderNum => {
      const first = groups[orderNum][0]; html += `<tr style="background:#f5f5f5"><td colspan="5" style="padding:6px 8px;font-weight:600;font-size:13px">${orderNum} - ${esc(first.order_name)}</td></tr>`;
      groups[orderNum].forEach(p => { html += `<tr><td style="padding:6px 8px;text-align:center"><input type="checkbox" class="batch-point-cb" value="${p.id}" data-order="${p.order_id}"></td><td style="padding:6px 8px"><span style="color:#1890ff;font-weight:500">${esc(p.point_number)}</span></td><td style="padding:6px 8px;color:#666">${esc(p.description.substring(0,40))}${p.description.length>40?'...':''}</td><td style="padding:6px 8px"><div class="batch-sys-container" style="display:flex;flex-wrap:wrap;gap:2px">${sys.map(s => `<label style="display:inline-flex;align-items:center;gap:2px;padding:2px 6px;margin:1px;border:1px solid #d9d9d9;border-radius:3px;cursor:pointer;font-size:11px;background:#fff"><input type="checkbox" class="batch-sys-cb" value="${s}" style="width:12px;height:12px">${s}</label>`).join('')}</div></td><td style="padding:6px 8px"><select class="batch-version" style="width:100%;padding:4px 6px;border:1px solid #d9d9d9;border-radius:4px;font-size:12px"><option value="">选择..</option>${ver.map(v => `<option value="${v}">${v}</option>`).join('')}</select></td></tr>`; });
    });
    html += '</tbody></table><div style="margin-top:12px"><button class="btn btn-primary" onclick="saveBatchSchedules()">💾 批量保存</button></div>';
    c.innerHTML = html;
  } catch(e) { c.innerHTML = '<div style="padding:12px;color:#999">加载失败</div>'; }
}
function toggleAllBatch() { const checked = document.getElementById('batch-select-all')?.checked; document.querySelectorAll('.batch-point-cb').forEach(cb => cb.checked = !!checked); }
function getBatchSystems(row) { return Array.from(row.querySelectorAll('.batch-sys-cb:checked')).map(cb => cb.value); }
async function saveBatchSchedules() {
  const meetingId = document.getElementById('schedule-meeting-id').value; const rows = document.querySelectorAll('.batch-point-cb'); const schedules = [];
  rows.forEach(cb => { if (cb.checked) { const tr = cb.closest('tr'); const systems = getBatchSystems(tr); const version = tr.querySelector('.batch-version')?.value; if (systems.length && version) schedules.push({order_id:parseInt(cb.dataset.order), point_id:parseInt(cb.value), system:systems.join(','), version}); } });
  if (!schedules.length) { showToast('请勾选并完善','error'); return; }
  try { const r = await fetch(`/api/meetings/${meetingId}/schedules/batch`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schedules})}); const d = await r.json(); if (!d.success) throw new Error(d.message); showToast(`成功添加 ${d.data.count} 个`,'success'); viewMeeting(meetingId); } catch(e) { showToast(e.message,'error'); }
}
function renderMeetingSchedules(schedules) {
  const c = document.getElementById('schedule-list'); if (!schedules.length) { c.innerHTML = '<div class="empty-state"><p>暂无排期记录</p></div>'; return; }
  c.innerHTML = schedules.map(s => { const systems = s.system ? s.system.split(',').map(x=>x.trim()).filter(Boolean) : []; return `<div class="schedule-card"><div class="sched-header"><div class="sched-title">${esc(s.order_number)} - ${esc(s.point_number)}</div><div class="action-group"><button class="btn btn-sm" onclick="openEditScheduleModalFromMeeting(${s.id})">修改</button><button class="btn btn-sm btn-danger" onclick="deleteScheduleFromMeeting(${s.id})">移除</button></div></div><div class="sched-meta">${esc(s.point_description)}</div><div class="sched-tags">${systems.map(sys => `<span class="sched-tag">📦 ${esc(sys)}</span>`).join('')}<span class="sched-tag">🏷️ ${esc(s.version)}</span></div></div>`; }).join('');
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
    fillFilter('filter-version', result.filters.versions, '全部版本'); fillFilter('filter-department', result.filters.departments, '全部部门'); fillFilter('filter-meeting', result.filters.meetings, '全部会议'); fillFilter('filter-system', result.filters.systems, '全部系统');
    renderScheduleResults(result);
  } catch(e) { console.error(e); }
}

function fillFilter(id, items, placeholder) {
  const el = document.getElementById(id); if (!el) return; el.innerHTML = `<option value="">${placeholder}</option>`; (items||[]).forEach(i => { const o = document.createElement('option'); o.value = i; o.textContent = i; el.appendChild(o); });
}

async function applyFilter() {
  const params = new URLSearchParams(); const v = document.getElementById('filter-version').value; if (v) params.set('version', v); const d = document.getElementById('filter-department').value; if (d) params.set('department', d); const m = document.getElementById('filter-meeting').value; if (m) params.set('meeting_name', m); const s = document.getElementById('filter-system').value; if (s) params.set('system', s); const g = document.getElementById('filter-group').value; if (g) params.set('group_by', g); params.set('page', state.schedulePage); params.set('pageSize', '20');
  try { const r = await fetch(`/api/schedules/filter?${params}`); const result = await r.json(); if (!result.success) throw new Error(result.message); renderScheduleResults(result); } catch(e) { showToast(e.message,'error'); }
}

function resetFilter() { document.querySelectorAll('.filter-row select').forEach(el => el.value = ''); state.schedulePage = 1; applyFilter(); }

function renderScheduleResults(result) {
  const { data: schedules, grouped, total, page, totalPages } = result;
  const c = document.getElementById('schedule-results'); const pc = document.getElementById('schedules-pagination');
  if (!schedules||!schedules.length) { c.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>暂无匹配的排期信息</p></div>'; pc.innerHTML = ''; return; }
  if (grouped) {
    let html = ''; Object.keys(grouped).sort().forEach(key => { const items = grouped[key]; html += `<div style="margin:16px 0 8px;padding:8px 12px;background:#e6f7ff;border-radius:6px;font-weight:600;font-size:14px;color:#1890ff">📁 ${esc(key)} (${items.length}条)</div>`; html += items.map(s => { const systems = s.system ? s.system.split(',').map(x=>x.trim()).filter(Boolean) : []; return `<div class="schedule-card"><div class="sched-header"><div class="sched-title">${esc(s.order_number)} - ${esc(s.point_number)}</div><div class="sched-meta">${esc(s.meeting_name)} (${s.meeting_date})</div></div><div class="sched-meta">${esc(s.point_description)}</div><div class="sched-meta">部门: ${esc(s.department||'-')}</div><div class="sched-tags">${systems.map(sys => `<span class="sched-tag">📦 ${esc(sys)}</span>`).join('')}<span class="sched-tag">🏷️ ${esc(s.version)}</span></div></div>`; }).join(''); }); c.innerHTML = html;
  } else {
    c.innerHTML = schedules.map(s => { const systems = s.system ? s.system.split(',').map(x=>x.trim()).filter(Boolean) : []; return `<div class="schedule-card"><div class="sched-header"><div class="sched-title">${esc(s.order_number)} - ${esc(s.point_number)}</div><div class="sched-meta">${esc(s.meeting_name)} (${s.meeting_date})</div></div><div class="sched-meta">${esc(s.point_description)}</div><div class="sched-meta">部门: ${esc(s.department||'-')}</div><div class="sched-tags">${systems.map(sys => `<span class="sched-tag">📦 ${esc(sys)}</span>`).join('')}<span class="sched-tag">🏷️ ${esc(s.version)}</span></div></div>`; }).join('');
  }
  if (totalPages > 1) { pc.innerHTML = `<button class="page-btn" onclick="gotoSchedulePage(1)" ${page<=1?'disabled':''}>«</button><button class="page-btn" onclick="gotoSchedulePage(${page-1})" ${page<=1?'disabled':''}>‹</button><span class="page-info">第 ${page}/${totalPages} 页 (共${total}条)</span><button class="page-btn" onclick="gotoSchedulePage(${page+1})" ${page>=totalPages?'disabled':''}>›</button><button class="page-btn" onclick="gotoSchedulePage(${totalPages})" ${page>=totalPages?'disabled':''}>»</button>`; }
  else pc.innerHTML = '';
}

document.getElementById('filter-group')?.addEventListener('change', () => { state.schedulePage = 1; applyFilter(); });

// ---- Search ----
let searchTimeout = null;
document.getElementById('global-search')?.addEventListener('input', e => { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => doSearch(e.target.value), 300); });
async function doSearch(keyword) {
  const c = document.querySelector('#search-results'); if (!keyword.trim()) { c.innerHTML = ''; c.classList.remove('has-results'); return; }
  try {
    const data = (await api(`/api/search?keyword=${encodeURIComponent(keyword)}`)).data;
    if (!data.length) { c.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>未找到匹配结果</p></div>'; c.classList.add('has-results'); return; }
    c.innerHTML = data.map(o => {
      const pts = (o.matchedPoints&&o.matchedPoints.length) ? `<div style="margin-top:8px;padding:8px;background:#f9f9f9;border-radius:4px">${o.matchedPoints.map(p => { const systems = p.schedule_system ? p.schedule_system.split(',').filter(Boolean) : []; return `<div style="padding:4px 0;font-size:13px;border-bottom:1px solid #f0f0f0"><span style="color:#1890ff;font-weight:500">${esc(p.point_number)}</span><span style="color:#666"> ${esc(p.description.substring(0,60))}${p.description.length>60?'...':''}</span>${p.schedule_system?`<span style="color:#52c41a"> | ✅ ${systems.map(s=>esc(s.trim())).join(', ')}</span>`:''}${p.schedule_version?`<span style="color:#52c41a"> | ${esc(p.schedule_version)}</span>`:''}${p.meeting_name?`<span> | 📅 ${esc(p.meeting_name)}</span>`:''}</div>`; }).join('')}</div>` : '';
      return `<div class="schedule-card" onclick="viewOrder(${o.id})" style="cursor:pointer"><div class="sched-header"><div class="sched-title">${esc(o.order_number)} - ${esc(o.name)}</div><span class="badge badge-blue">${esc(o.department||'-')}</span></div><div class="sched-meta">提出人: ${esc(o.proposer||'-')} | 日期: ${o.propose_date||'-'}</div>${pts}</div>`;
    }).join(''); c.classList.add('has-results');
  } catch(e) {}
}

// ---- Excel ----
function exportExcel() { window.open('/api/export','_blank'); showToast('正在导出...','info'); }
function importExcel() { document.getElementById('import-file').click(); }
document.getElementById('import-file')?.addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file',f); try { const r = await fetch('/api/import',{method:'POST',body:fd}); const d = await r.json(); if (!d.success) throw new Error(d.message); showToast(`导入成功: ${d.data.imported} 条, 跳过: ${d.data.skipped} 条`,'success'); e.target.value=''; loadOrders(); } catch(e) { showToast(e.message,'error'); } });

document.addEventListener('DOMContentLoaded', () => { loadOrders(); loadDropdowns(); });