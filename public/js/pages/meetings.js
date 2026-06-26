/**
 * CCB 排期管理页面（会议管理 Tab）
 * 会议列表、创建、编辑、删除
 */

async function loadMeetings() {
  try {
    const meetings = (await api('/api/meetings')).data;
    const c = document.getElementById('meetings-list');
    if (!meetings.length) { c.innerHTML = '<div class="empty-state"><div class="icon">📅</div><p>暂无CCB会议</p></div>'; return; }
    c.innerHTML = meetings.map(m =>
      `<div class="schedule-card">
        <div class="sched-header">
          <div class="sched-title">${esc(m.meeting_name)}</div>
          <div class="action-group">
            <button class="btn btn-sm" onclick="viewMeeting(${m.id})">排期管理</button>
            <button class="btn btn-sm" onclick="editMeeting(${m.id})">编辑</button>
            <button class="btn btn-sm btn-danger" onclick="deleteMeeting(${m.id})">删除</button>
          </div>
        </div>
        <div class="sched-meta">日期: ${m.meeting_date}${m.notes ? ' | ' + esc(m.notes) : ''}</div>
        ${m.file_name ? '<div class="sched-tags"><span class="sched-tag">📎 <a href="/api/meetings/' + m.id + '/file/download" style="color:#333;text-decoration:none" target="_blank" title="下载纪要文件">' + esc(m.file_name) + '</a></span></div>' : ''}
      </div>`
    ).join('');
  } catch (e) {}
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
      container.style.display = 'block';
      container.innerHTML = `📎 当前文件：<a href="/api/meetings/${meetingId}/file/download" target="_blank" style="color:#1890ff;font-weight:500">${esc(data.file_name)}</a>`;
    } else {
      container.style.display = 'none';
      container.innerHTML = '';
    }
  } catch (e) { container.style.display = 'none'; }
}
