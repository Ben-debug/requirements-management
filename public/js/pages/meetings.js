/**
 * CCB 排期管理页面（会议管理 Tab）
 * 会议列表、创建、编辑、删除
 */

let meetingPage = 1;

async function loadMeetings(page) {
  if (page !== undefined) meetingPage = page;
  try {
    const params = new URLSearchParams({
      page: meetingPage,
      pageSize: parseInt(document.getElementById('meetings-page-size')?.value, 10) || 10
    });
    const keyword = document.getElementById('mtg-keyword')?.value.trim();
    const from = document.getElementById('mtg-date-from')?.value;
    const to = document.getElementById('mtg-date-to')?.value;
    const ccbOnly = document.getElementById('mtg-ccb-only')?.checked;
    if (keyword) params.set('keyword', keyword);
    if (from) params.set('date_from', from);
    if (to) params.set('date_to', to);
    if (ccbOnly) params.set('ccb_only', '1');

    const d = await api('/api/meetings?' + params.toString());
    const meetings = d.data;
    const info = document.getElementById('meeting-result-info');
    if (info) info.textContent = d.total > 0 ? `共 ${d.total} 场会议` : '';
    renderPagination('meetings-pagination', d, 'loadMeetings', 'meetings-page-size');

    const c = document.getElementById('meetings-list');
    if (!meetings.length) {
      c.innerHTML = '<div class="empty-state"><div class="icon">📅</div><p>暂无符合条件的会议</p></div>';
      return;
    }
    c.innerHTML = meetings.map(m => {
      const open = m.file_name
        ? fileOpenInfo({ id: m.id, file_name: m.file_name }, `/api/meetings/${m.id}/file`)
        : null;
      const sm = m.schedule_summary || { points: 0, projects: 0 };
      const summaryHtml = sm.points
        ? `<div class="sched-meta">📊 排期概要：${sm.points} 个需求点 · ${sm.orders} 张需求单 · ${sm.departments} 个部门 · ${sm.systems} 个系统 · ${sm.versions} 个版本${sm.projects ? ` <span class="badge badge-orange">📋 立项 ${sm.projects}</span>` : ''}</div>`
        : '<div class="sched-meta" style="color:#999">📊 暂无排期</div>';
      return `<div class="schedule-card">
        <div class="sched-header">
          <div class="sched-title">${esc(m.meeting_name)}</div>
          <div class="action-group">
            <button class="btn btn-sm" onclick="viewMeeting(${m.id})">排期管理</button>
            <button class="btn btn-sm" onclick="editMeeting(${m.id})">编辑</button>
            <button class="btn btn-sm btn-danger" onclick="deleteMeeting(${m.id})">删除</button>
          </div>
        </div>
        <div class="sched-meta">日期: ${m.meeting_date}${m.notes ? ' | ' + esc(m.notes) : ''}</div>
        ${summaryHtml}
        ${open ? `<div class="sched-tags"><span class="sched-tag">📎 <a href="${open.url}" style="color:#333;text-decoration:none" target="_blank" title="${open.title}">${esc(m.file_name)}</a></span>${open.previewable ? `<a href="${open.downloadUrl}" target="_blank" style="font-size:12px;color:#1890ff" title="下载纪要文件">📥 下载</a>` : ''}</div>` : ''}
      </div>`;
    }).join('');
  } catch (e) {}
}

function resetMeetingFilter() {
  ['mtg-keyword', 'mtg-date-from', 'mtg-date-to'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const ccb = document.getElementById('mtg-ccb-only');
  if (ccb) ccb.checked = false;
  loadMeetings(1);
}

// ---- 会议表单提交 ----
document.getElementById('meeting-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    if (state.editingMeetingId) {
      await api(`/api/meetings/${state.editingMeetingId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('已更新', 'success');
      closeModal('meeting-modal');
    } else {
      const resp = await api('/api/meetings', { method: 'POST', body: JSON.stringify(data) });
      const newId = resp.data.id;
      state.editingMeetingId = newId;
      document.getElementById('meeting-id').value = newId;
      document.getElementById('meeting-modal-title').textContent = '编辑CCB会议';
      showToast('已创建，可继续上传纪要文件', 'success');
    }
    loadMeetings();
  } catch (e) { showToast(e.message, 'error'); }
});

function showCreateMeeting() {
  state.editingMeetingId = null;
  document.getElementById('meeting-modal-title').textContent = '新建排期会议';
  document.getElementById('meeting-form').reset();
  document.getElementById('meeting-id').value = '';
  document.getElementById('meeting-current-file').style.display = 'none';
  document.getElementById('meeting-current-file').innerHTML = '';
  openModal('meeting-modal');
}

async function editMeeting(id) {
  state.editingMeetingId = id;
  const d = (await api(`/api/meetings/${id}`)).data;
  document.getElementById('meeting-modal-title').textContent = '编辑CCB会议';
  document.getElementById('meeting_name').value = d.meeting_name;
  document.getElementById('meeting_date').value = d.meeting_date;
  document.getElementById('meeting_notes').value = d.notes || '';
  document.getElementById('meeting-id').value = id;
  openModal('meeting-modal');
  refreshMeetingFileDisplay(id);
}

async function deleteMeeting(id) {
  if (!confirm('确定删除？')) return;
  try { await api(`/api/meetings/${id}`, { method: 'DELETE' }); showToast('已删除', 'success'); loadMeetings(); } catch (e) {}
}

async function uploadMeetingFile() {
  const mid = document.getElementById('meeting-id')?.value || state.editingMeetingId || document.getElementById('schedule-meeting-id')?.value;
  if (!mid) { showToast('请先保存会议，再上传文件', 'error'); return; }
  const fi = document.getElementById('meeting-file-upload');
  if (!fi.files.length) { showToast('请选择文件', 'error'); return; }
  const fd = new FormData();
  fd.append('file', fi.files[0]);
  if (!state.editingMeetingId) state.editingMeetingId = parseInt(mid);
  try {
    const r = await fetch(`/api/meetings/${mid}/file`, { method: 'POST', body: fd });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    showToast('上传成功', 'success');
    fi.value = '';
    refreshMeetingFileDisplay(mid);
    loadMeetings();
  } catch (e) { showToast(e.message, 'error'); }
}

async function refreshMeetingFileDisplay(meetingId) {
  const container = document.getElementById('meeting-current-file');
  if (!container) return;
  try {
    const d = await api(`/api/meetings/${meetingId}`);
    const data = d.data;
    if (data.file_name) {
      const open = fileOpenInfo({ id: meetingId, file_name: data.file_name }, `/api/meetings/${meetingId}/file`);
      container.style.display = 'block';
      container.innerHTML = `📎 当前文件：<a href="${open.url}" target="_blank" style="color:#1890ff;font-weight:500" title="${open.title}">${esc(data.file_name)}</a>${open.previewable ? ` <a href="${open.downloadUrl}" target="_blank" style="font-size:12px;color:#1890ff" title="下载纪要文件">📥 下载</a>` : ''}`;
    } else {
      container.style.display = 'none';
      container.innerHTML = '';
    }
  } catch (e) { container.style.display = 'none'; }
}
