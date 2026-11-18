/**
 * 排期管理页面
 * 会议排期视图、批量排期、排期筛选查询
 */

// ---- 排期视图入口 ----
async function viewMeeting(id) {
  const d = (await api(`/api/meetings/${id}`)).data;
  document.getElementById('schedule-meeting-id').value = id;
  document.getElementById('schedule-meeting-name').textContent = d.meeting_name;
  document.getElementById('schedule-meeting-name-display').textContent = d.meeting_name;
  document.getElementById('schedule-meeting-date').textContent = d.meeting_date;
  document.getElementById('schedule-meeting-notes').textContent = d.notes || '-';
  document.getElementById('schedule-meeting-file').textContent = d.file_name || '无';
  renderMeetingSchedules(d.schedules || []);
  await loadDropdowns();
  openModal('schedule-modal');
  scanAndLinkMeetingFiles(id);
}

async function scanAndLinkMeetingFiles(meetingId) {
  try {
    const r = await fetch(`/api/meetings/${meetingId}/scan-files`);
    const d = await r.json();
    if (!d.success) return;
    if (d.linked) {
      showToast('已自动关联会议纪要文件', 'success');
      document.getElementById('schedule-meeting-file').textContent = d.linked.file_name;
    }
  } catch (e) { /* 静默 */ }
}

function renderMeetingSchedules(schedules) {
  const c = document.getElementById('schedule-list');
  if (!schedules.length) { c.innerHTML = '<div class="empty-state"><p>暂无排期记录</p></div>'; return; }
  c.innerHTML = renderScheduleHierarchy(schedules, s => renderScheduledCard(s, { showActions: true }));
}

// ---- 待排期需求点（三级弹窗，部门 tab + 分页按需加载）----
const batchState = {
  activeDept: '全部', page: 1, pageSize: 50,
  selections: {},   // pointId -> { checked, order_id, system:[], version, sub_batch }
  config: null,     // { sys:[], ver:[] }
  counts: {}, departments: [], allCount: 0,
  bound: false
};

async function openUnscheduledModal() {
  batchState.activeDept = '全部';
  batchState.page = 1;
  batchState.selections = {};
  document.getElementById('unscheduled-meeting-name').textContent =
    document.getElementById('schedule-meeting-name').textContent || '';
  if (!batchState.config) {
    const [s, v] = await Promise.all([api('/api/config/system'), api('/api/config/version')]);
    batchState.config = { sys: s.data || [], ver: v.data || [] };
  }
  if (!batchState.bound) {
    const modal = document.getElementById('unscheduled-points-modal');
    modal.addEventListener('change', captureBatchSelection);
    modal.addEventListener('input', captureBatchSelection);
    batchState.bound = true;
  }
  openModal('unscheduled-points-modal');
  await loadUnscheduledTab('全部', 1);
}

function captureBatchSelection(e) {
  const row = e.target.closest('.batch-point-item');
  if (!row) return;
  const cb = row.querySelector('.point-cb');
  if (!cb) return;
  batchState.selections[cb.value] = {
    checked: cb.checked,
    order_id: parseInt(cb.dataset.order),
    system: Array.from(row.querySelectorAll('.sys-cb:checked')).map(x => x.value),
    version: row.querySelector('.ver-select')?.value || '',
    sub_batch: row.querySelector('.batch-input')?.value.trim() || ''
  };
}

function renderBatchDeptTabs() {
  const c = document.getElementById('unscheduled-dept-tabs');
  if (!c) return;
  const tabs = [{ name: '全部', count: batchState.allCount }];
  batchState.departments.forEach(d => tabs.push({ name: d, count: batchState.counts[d] || 0 }));
  if (batchState.counts['未指定'] > 0) tabs.push({ name: '未指定', count: batchState.counts['未指定'] });
  c.innerHTML = tabs.map(t =>
    `<div class="tab-item ${t.name === batchState.activeDept ? 'active' : ''}" data-dept="${esc(t.name)}" onclick="switchUnscheduledDept(this.getAttribute('data-dept'))">${esc(t.name)} <span class="tab-count">${t.count}</span></div>`
  ).join('');
}

async function loadUnscheduledTab(dept, page) {
  batchState.activeDept = dept;
  batchState.page = page;
  const c = document.getElementById('unscheduled-points-list');
  try {
    const params = new URLSearchParams({ page: page, pageSize: batchState.pageSize });
    if (dept && dept !== '全部') params.set('department', dept);
    const r = await api('/api/unscheduled-points?' + params.toString());
    batchState.counts = r.departmentCounts || {};
    batchState.departments = (r.filters && r.filters.departments) || [];
    batchState.allCount = r.allCount || 0;
    renderBatchDeptTabs();
    const pts = r.data || [];
    if (!pts.length) {
      c.innerHTML = '<div class="empty-state"><div class="icon">✅</div><p>该范围内没有待排期需求点</p></div>';
    } else {
      c.innerHTML = buildBatchTableHTML(pts, batchState.config.sys, batchState.config.ver);
    }
    renderPagination('unscheduled-pagination', r, 'gotoUnscheduledPage');
  } catch (e) { c.innerHTML = '<div style="padding:12px;color:#999">加载失败</div>'; }
}

function switchUnscheduledDept(dept) { loadUnscheduledTab(dept, 1); }
function gotoUnscheduledPage(p) {
  const sizeSel = document.querySelector('#unscheduled-pagination select');
  if (sizeSel) batchState.pageSize = parseInt(sizeSel.value) || 50;
  loadUnscheduledTab(batchState.activeDept, p);
}

function isSelected(pointId) {
  const s = batchState.selections[pointId];
  return !!(s && s.checked);
}

function buildBatchTableHTML(pts, sys, ver) {
  const orderGroups = {};
  pts.forEach(p => {
    const key = p.order_number;
    if (!orderGroups[key]) orderGroups[key] = { order_number: p.order_number, order_name: p.order_name, points: [] };
    orderGroups[key].points.push(p);
  });
  const sortedOrderKeys = Object.keys(orderGroups).sort((a, b) => {
    const aLetter = a.charAt(0), bLetter = b.charAt(0);
    if (aLetter !== bLetter) return aLetter < bLetter ? -1 : 1;
    return parseInt(a.substring(1)) - parseInt(b.substring(1));
  });

  let html = '<div id="schedule-order-list">';
  sortedOrderKeys.forEach(okey => {
    const grp = orderGroups[okey];
    const orderPts = grp.points;
    const orderChecked = orderPts.every(p => isSelected(p.id));
    html += `<div class="schedule-order-card" data-order="${orderPts[0].order_id}" data-order-number="${esc(okey)}">
      <div class="schedule-order-header" onclick="toggleScheduleOrder(this)">
        <div class="header-left">
          <input type="checkbox" class="order-select-all" ${orderChecked ? 'checked' : ''} onclick="event.stopPropagation();toggleOrderPoints(this)" title="全选本单">
          <span class="schedule-order-arrow">▶</span>
          <span style="font-weight:600;font-size:14px;color:#1890ff">${esc(okey)}</span>
          <span style="font-size:13px;color:#333;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(grp.order_name)}</span>
          <span class="badge badge-blue">${orderPts.length}个待排期</span>
        </div>
        <div class="header-right"><span style="font-size:11px;color:#999">点击展开</span><span class="schedule-order-arrow" style="font-size:14px">▶</span></div>
      </div>
      <div class="schedule-order-body">`;

    const batched = {}, unbatched = [];
    orderPts.forEach(p => {
      if (p.sub_batch) { if (!batched[p.sub_batch]) batched[p.sub_batch] = []; batched[p.sub_batch].push(p); }
      else { unbatched.push(p); }
    });

    Object.keys(batched).sort().forEach(batch => {
      const bpts = batched[batch];
      const batchLabel = okey + '-' + batch;
      const batchChecked = bpts.every(p => isSelected(p.id));
      html += `<div class="batch-sub-card" style="border:1px solid #e8e8e8;border-radius:6px;margin-bottom:8px;overflow:hidden;background:#fff">
        <div class="batch-sub-header" onclick="toggleBatchBody(this)" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f0f5ff;border-left:3px solid #1890ff;user-select:none">
          <span class="batch-expand-arrow" style="font-size:12px;color:#999;transition:transform .2s;width:14px;text-align:center">▶</span>
          <input type="checkbox" class="point-cb batch-selector" value="${bpts[0].id}" data-order="${bpts[0].order_id}" data-batch="${batch}" ${batchChecked ? 'checked' : ''} onclick="event.stopPropagation();toggleBatchPoints(this)">
          <span style="font-weight:600;font-size:13px;color:#1890ff">📁 ${esc(batchLabel)}</span>
          <span class="badge badge-blue">${bpts.length}项</span>
          <span style="font-size:11px;color:#999;margin-left:auto">点击展开逐点设置</span>
        </div>
        <div class="batch-sub-body" style="display:none;padding:6px 10px 10px">`;
      bpts.forEach(p => { html += renderBatchSchedulePointRow(p, sys, ver, okey, batch, batchState.selections[p.id]); });
      html += `</div></div>`;
    });

    if (unbatched.length) {
      if (Object.keys(batched).length) {
        html += `<div style="padding:6px 0;font-size:12px;color:#999">📄 基础需求点（无子单，可录入批次号）</div>`;
      }
      unbatched.forEach(p => { html += renderBatchSchedulePointRow(p, sys, ver, okey, '', batchState.selections[p.id]); });
    }
    html += `</div></div>`;
  });
  return html + '</div>';
}

function renderBatchSchedulePointRow(p, sys, ver, okey, batch, sel) {
  sel = sel || {};
  const descId = 'bd-' + p.id;
  const isLong = p.description && p.description.length > 60;
  const batchValue = sel.sub_batch || batch;
  const batchInput = batchValue ? `value="${esc(batchValue)}"` : 'placeholder="子单号"';
  const selectedSystems = sel.system || [];
  return `<div class="batch-point-item" style="border:1px solid #f0f0f0;border-radius:6px;margin-bottom:6px;padding:8px 10px;background:#fff">
    <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px">
      <input type="checkbox" class="point-cb" value="${p.id}" data-order="${p.order_id}" ${sel.checked ? 'checked' : ''} style="margin-top:3px">
      <span class="point-number" style="font-size:12px;white-space:nowrap">${esc(p.point_number)}</span>
      <input type="text" class="batch-input" ${batchInput} style="width:62px;padding:1px 4px;border:1px solid #d9d9d9;border-radius:3px;font-size:11px">
      <div style="flex:1;min-width:0">
        <div id="${descId}" class="${isLong ? 'point-desc-clamped' : ''}" style="font-size:12px;color:#555;line-height:1.5">${esc(p.description).replace(/\n/g, '<br>')}</div>
        ${isLong ? `<span class="desc-toggle-btn" onclick="toggleBatchDesc('${descId}')" style="font-size:11px">展开全文 ▼</span>` : ''}
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding-left:24px">
      <span style="font-size:11px;color:#999;white-space:nowrap">涉及系统:</span>
      <div style="display:flex;flex-wrap:wrap;gap:2px">${sys.map(s => `<label style="display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border:1px solid #d9d9d9;border-radius:3px;cursor:pointer;font-size:11px;background:#fff"><input type="checkbox" class="sys-cb" value="${esc(s)}" ${selectedSystems.includes(s) ? 'checked' : ''} style="width:11px;height:11px">${esc(s)}</label>`).join('')}</div>
      <span style="font-size:11px;color:#999;white-space:nowrap">上线版本:</span>
      <select class="ver-select" style="padding:2px 6px;border:1px solid #d9d9d9;border-radius:3px;font-size:11px;min-width:90px"><option value="">请选择</option>${ver.map(v => `<option value="${esc(v)}" ${sel.version === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
    </div>
  </div>`;
}

// ---- 批量排期保存 ----
async function saveBatchSchedules() {
  const meetingId = document.getElementById('schedule-meeting-id').value;
  const schedules = [];
  Object.entries(batchState.selections).forEach(([pointId, s]) => {
    if (!s.checked || !s.system || !s.system.length || !s.version) return;
    schedules.push({
      order_id: s.order_id, point_id: parseInt(pointId),
      system: s.system.join(','), version: s.version,
      sub_batch: s.sub_batch || undefined
    });
  });

  if (!schedules.length) { showToast('请勾选需求点并选择系统与版本', 'error'); return; }
  try {
    const r = await fetch(`/api/meetings/${meetingId}/schedules/batch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedules })
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    showToast(`成功添加 ${d.data.count} 个`, 'success');
    closeModal('unscheduled-points-modal');
    batchState.selections = {};
    viewMeeting(meetingId);
  } catch (e) { showToast(e.message, 'error'); }
}

// ---- 折叠/展开辅助函数 ----
function toggleScheduleOrder(header) {
  const body = header.nextElementSibling;
  const arrows = header.querySelectorAll('.schedule-order-arrow');
  body.classList.toggle('expanded');
  arrows.forEach(a => a.classList.toggle('expanded'));
}
function toggleOrderPoints(selectAll) {
  const card = selectAll.closest('.schedule-order-card');
  const checked = selectAll.checked;
  card.querySelectorAll('.point-cb').forEach(cb => cb.checked = checked);
}
function toggleBatchBody(header) {
  const body = header.nextElementSibling;
  const arrow = header.querySelector('.batch-expand-arrow');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
}
function toggleBatchPoints(selectAll) {
  const card = selectAll.closest('.batch-sub-card');
  const checked = selectAll.checked;
  if (card) card.querySelectorAll('.point-cb').forEach(cb => cb.checked = checked);
}
function toggleBatchDesc(descId) {
  const el = document.getElementById(descId);
  if (!el) return;
  const isClamped = el.classList.contains('point-desc-clamped');
  const btn = el.parentElement.querySelector('.desc-toggle-btn');
  if (isClamped) { el.classList.remove('point-desc-clamped'); if (btn) btn.textContent = '收起 ▲'; }
  else { el.classList.add('point-desc-clamped'); if (btn) btn.textContent = '展开全文 ▼'; }
}

// ---- 项目名称下拉（已立项时使用）----
function toggleProjectRow(checkboxId, rowId) {
  const row = document.getElementById(rowId), cb = document.getElementById(checkboxId);
  if (row && cb) row.style.display = cb.checked ? 'flex' : 'none';
}

function fillProjectSelect(selectId, projects, current) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">请选择项目</option>';
  (projects || []).forEach(name => {
    const o = document.createElement('option'); o.value = name; o.textContent = name; sel.appendChild(o);
  });
  if (current) {
    let opt = Array.from(sel.options).find(o => o.value === current);
    if (!opt) { opt = document.createElement('option'); opt.value = current; opt.textContent = current; sel.appendChild(opt); }
    sel.value = current;
  }
}

async function createProjectFor(selectId) {
  const name = prompt('请输入新项目名称');
  if (!name || !name.trim()) return;
  const label = name.trim();
  try {
    await api('/api/config', { method: 'POST', body: JSON.stringify({ category: 'project', label }) });
    const sel = document.getElementById(selectId);
    let opt = Array.from(sel.options).find(o => o.value === label);
    if (!opt) { opt = document.createElement('option'); opt.value = label; opt.textContent = label; sel.appendChild(opt); }
    sel.value = label;
    showToast('项目已创建', 'success');
  } catch (e) { showToast(e.message || '创建失败', 'error'); }
}

// ---- 单条排期 ----
async function showScheduleModal(pointId, orderId) {
  const [s, v, m, p] = await Promise.all([api('/api/config/system'), api('/api/config/version'), api('/api/meetings'), api('/api/config/project')]);
  const sys = s.data, vers = v.data, meetings = m.data;
  if (!meetings.length) { showToast('请先创建CCB会议', 'error'); navigate('meetings'); return; }
  const mtgSelect = document.getElementById('detail-schedule-meeting');
  mtgSelect.innerHTML = '<option value="">请选择CCB会议</option>';
  meetings.forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = `${m.meeting_name} (${m.meeting_date})`; mtgSelect.appendChild(o); });
  renderSystemCheckboxes('detail-schedule-systems', sys, []);
  fillSelect('detail-schedule-version', vers, '请选择版本');
  document.getElementById('detail-schedule-is-project').checked = false;
  toggleProjectRow('detail-schedule-is-project', 'detail-project-row');
  fillProjectSelect('detail-schedule-project', p.data, '');
  document.getElementById('schedule-point-id').value = pointId;
  document.getElementById('schedule-order-id').value = orderId;
  openModal('quick-schedule-modal');
}

async function confirmQuickSchedule() {
  const pointId = document.getElementById('schedule-point-id').value, orderId = document.getElementById('schedule-order-id').value;
  const meetingId = document.getElementById('detail-schedule-meeting').value;
  const systems = getSelectedSystems('detail-schedule-systems');
  const version = document.getElementById('detail-schedule-version').value;
  if (!meetingId) { showToast('请选择CCB会议', 'error'); return; }
  if (!systems.length) { showToast('请至少选择一个系统', 'error'); return; }
  if (!version) { showToast('请选择版本', 'error'); return; }
  const isProject = document.getElementById('detail-schedule-is-project').checked ? 1 : 0;
  const projectName = isProject ? document.getElementById('detail-schedule-project').value : null;
  try {
    const r = await fetch(`/api/meetings/${meetingId}/schedules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: parseInt(orderId), point_id: parseInt(pointId), system: systems.join(','), version, is_project: isProject, project_name: projectName })
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    showToast('排期成功', 'success');
    closeModal('quick-schedule-modal');
    viewOrder(parseInt(orderId));
  } catch (e) { showToast(e.message, 'error'); }
}

// ---- 修改排期 ----
async function openEditScheduleModal(scheduleId, orderId) {
  const [s, v, meetings, orderData, p] = await Promise.all([
    api('/api/config/system'), api('/api/config/version'), api('/api/meetings'),
    orderId ? api(`/api/orders/${orderId}`) : Promise.resolve(null),
    api('/api/config/project')
  ]);
  const sys = s.data, vers = v.data;
  let currentSchedule = null;
  if (orderData && orderData.data) {
    currentSchedule = orderData.data.schedules?.find(x => x.id === scheduleId);
  }
  if (!currentSchedule && meetings.data) {
    for (const m of meetings.data) {
      const detail = await api(`/api/meetings/${m.id}`);
      currentSchedule = detail.data.schedules?.find(x => x.id === scheduleId);
      if (currentSchedule) break;
    }
  }
  const currentSystems = currentSchedule ? currentSchedule.system.split(',').map(s => s.trim()).filter(Boolean) : [];
  const currentVersion = currentSchedule ? currentSchedule.version : '';
  const currentMeetingId = currentSchedule ? currentSchedule.meeting_id : '';
  const currentIsProject = currentSchedule ? currentSchedule.is_project : 0;
  const currentProjectName = currentSchedule ? currentSchedule.project_name : null;
  document.getElementById('edit-schedule-is-project').checked = currentIsProject ? true : false;
  toggleProjectRow('edit-schedule-is-project', 'edit-project-row');
  fillProjectSelect('edit-schedule-project', p.data, currentProjectName);

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
  const systems = getSelectedSystems('edit-schedule-systems'), version = document.getElementById('edit-schedule-version').value;
  if (!systems.length) { showToast('请至少选择一个系统', 'error'); return; }
  if (!version) { showToast('请选择版本', 'error'); return; }
  const isProject = document.getElementById('edit-schedule-is-project').checked ? 1 : 0;
  const projectName = isProject ? document.getElementById('edit-schedule-project').value : null;
  try {
    const body = { system: systems.join(','), version, is_project: isProject, project_name: projectName };
    if (meetingId) body.meeting_id = parseInt(meetingId);
    await api(`/api/schedules/${scheduleId}`, { method: 'PUT', body: JSON.stringify(body) });
    showToast('排期已更新', 'success');
    closeModal('edit-schedule-modal');
    const oid = document.getElementById('detail-order-id')?.value;
    if (oid) viewOrder(parseInt(oid));
    else viewMeeting(document.getElementById('schedule-meeting-id').value);
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteScheduleFromDetail(id) {
  if (!confirm('确定移除？')) return;
  try {
    await api(`/api/schedules/${id}`, { method: 'DELETE' });
    showToast('已移除', 'success');
    viewOrder(document.getElementById('detail-order-id').value);
  } catch (e) {}
}

async function deleteScheduleFromMeeting(id) {
  if (!confirm('确定移除？')) return;
  try {
    await api(`/api/schedules/${id}`, { method: 'DELETE' });
    showToast('已移除', 'success');
    viewMeeting(document.getElementById('schedule-meeting-id').value);
  } catch (e) {}
}

async function openEditScheduleModalFromMeeting(scheduleId) {
  const meetingId = document.getElementById('schedule-meeting-id').value;
  const d = await api(`/api/meetings/${meetingId}`);
  const schedule = d.data.schedules?.find(x => x.id === scheduleId);
  const currentSystems = schedule ? schedule.system.split(',').map(s => s.trim()).filter(Boolean) : [];
  const currentVersion = schedule ? schedule.version : '';

  const [sys, vers, meetings] = await Promise.all([api('/api/config/system'), api('/api/config/version'), api('/api/meetings')]);

  const mtgSelect = document.getElementById('edit-schedule-meeting');
  mtgSelect.innerHTML = '<option value="">不修改会议</option>';
  meetings.data.forEach(m => {
    const o = document.createElement('option'); o.value = m.id; o.textContent = `${m.meeting_name} (${m.meeting_date})`;
    if (m.id === schedule?.meeting_id) o.selected = true;
    mtgSelect.appendChild(o);
  });
  renderSystemCheckboxes('edit-schedule-systems', sys.data, currentSystems);
  fillSelect('edit-schedule-version', vers.data, '请选择版本');
  document.getElementById('edit-schedule-version').value = currentVersion;
  document.getElementById('edit-schedule-id').value = scheduleId;
  openModal('edit-schedule-modal');
}

async function batchGenerateAssessments() {
  const meetingId = document.getElementById('schedule-meeting-id').value;
  if (!meetingId) { showToast('请先选择会议', 'error'); return; }
  if (!confirm('确定为该会议中已排期的需求单生成意向书及评估表？已存在的将自动跳过。')) return;
  const btn = event?.target || document.querySelector('button[onclick="batchGenerateAssessments()"]');
  const originalText = btn?.textContent || '📝 批量生成意向书评估表';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 批量生成中...'; }
  try {
    const r = await fetch(`/api/meetings/${meetingId}/generate-assessments`, { method: 'POST' });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    const details = (d.data?.results || []).map(r => '  ' + (r.generated ? '✅' : '⏭️') + ' ' + r.message).join('\n');
    showToast(`✅ ${d.message}`, 'success');
    alert(`处理结果：\n${d.message}\n\n${details}`);
  } catch (e) { showToast(e.message || '批量生成失败', 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = originalText; } }
}

// ======== 排期查询 Tab ========

async function loadScheduleFilter() {
  try {
    const r = await fetch(`/api/schedules/filter?group_by=version&page=${state.schedulePage}&pageSize=20`);
    const result = await r.json();
    if (!result.success) throw new Error(result.message);
    fillFilter('filter-version', result.filters.versions, '全部版本');
    fillFilter('filter-schedule-department', result.filters.departments, '全部部门');
    fillFilter('filter-meeting', result.filters.meetings, '全部会议');
    fillFilter('filter-system', result.filters.systems, '全部系统');
    renderScheduleResults(result);
  } catch (e) { console.error(e); }
}

async function applyFilter() {
  const params = new URLSearchParams();
  const v = document.getElementById('filter-version').value;
  if (v) params.set('version', v);
  const d = document.getElementById('filter-schedule-department').value;
  if (d) params.set('department', d);
  const m = document.getElementById('filter-meeting').value;
  if (m) params.set('meeting_name', m);
  const s = document.getElementById('filter-system').value;
  if (s) params.set('system', s);
  const g = document.getElementById('filter-group').value;
  if (g) params.set('group_by', g);
  params.set('page', state.schedulePage);
  params.set('pageSize', '20');
  try {
    const r = await fetch(`/api/schedules/filter?${params}`);
    const result = await r.json();
    if (!result.success) throw new Error(result.message);
    renderScheduleResults(result);
  } catch (e) { showToast(e.message, 'error'); }
}

function resetFilter() {
  document.querySelectorAll('.filter-row select').forEach(el => el.value = '');
  state.schedulePage = 1;
  applyFilter();
}

function renderScheduleResults(result) {
  const { data: schedules, grouped, total, page, totalPages } = result;
  const c = document.getElementById('schedule-results');
  const pc = document.getElementById('schedules-pagination');
  if (!schedules || !schedules.length) { c.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>暂无匹配的排期信息</p></div>'; pc.innerHTML = ''; return; }

  const projCount = schedules.filter(s => s.is_project).length;
  const pct = total ? Math.round(projCount / total * 100) : 0;
  c.innerHTML = `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 14px;background:#fafafa;border-radius:8px;margin-bottom:12px;border:1px solid #e8e8e8">
    <span style="font-weight:600;font-size:14px;color:#333">📊 汇总</span>
    <span style="font-size:13px;color:#666">共 <b>${total}</b> 条</span>
    <span style="font-size:13px;color:#52c41a">📋 已立项 <b>${projCount}</b></span>
    <span style="font-size:13px;color:#999">未立项 <b>${total - projCount}</b></span>
    <div style="flex:1;min-width:100px;height:8px;background:#f0f0f0;border-radius:4px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#52c41a,#73d13d);border-radius:4px;transition:width .3s"></div>
    </div>
    <span style="font-size:12px;color:#999;min-width:40px;text-align:right">${pct}%</span>
  </div>`;

  if (grouped) {
    let html = '';
    Object.keys(grouped).sort().forEach(key => {
      const items = grouped[key];
      html += `<div style="margin:16px 0 8px;padding:8px 12px;background:#e6f7ff;border-radius:6px;font-weight:600;font-size:14px;color:#1890ff">📁 ${esc(key)} (${items.length}条)</div>`;
      html += renderScheduleResultsGrouped(items);
    });
    c.innerHTML = html;
  } else {
    c.innerHTML = renderScheduleResultsGrouped(schedules);
  }

  if (totalPages > 1) {
    pc.innerHTML = `<button class="page-btn" onclick="gotoSchedulePage(1)" ${page <= 1 ? 'disabled' : ''}>«</button><button class="page-btn" onclick="gotoSchedulePage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>‹</button><span class="page-info">第 ${page}/${totalPages} 页 (共${total}条)</span><button class="page-btn" onclick="gotoSchedulePage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>›</button><button class="page-btn" onclick="gotoSchedulePage(${totalPages})" ${page >= totalPages ? 'disabled' : ''}>»</button>`;
  } else pc.innerHTML = '';
}

function renderScheduleResultsGrouped(schedules) {
  return renderScheduleHierarchy(schedules, s => renderScheduledCard(s, { showMeeting: true, showDepartment: true }));
}

function gotoSchedulePage(p) { state.schedulePage = p; applyFilter(); }

document.getElementById('filter-group')?.addEventListener('change', () => { state.schedulePage = 1; applyFilter(); });
