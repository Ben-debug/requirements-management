/**
 * 流转文件页面
 * 跨需求单统一查看、筛选、分组
 */

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
      try {
        const ftRes = await api('/api/config/file_type');
        (ftRes.data || []).forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; typeSel.appendChild(o); });
      } catch (e) {}
    }
    // 填充部门下拉
    const deptSel = document.getElementById('file-filter-department');
    if (deptSel && deptSel.options.length <= 1 && d.filters?.departments) {
      d.filters.departments.forEach(dep => { const o = document.createElement('option'); o.value = dep; o.textContent = dep; deptSel.appendChild(o); });
    }

    const groupsContainer = document.getElementById('files-groups');
    const emptyState = document.getElementById('files-empty-state');
    const info = document.getElementById('file-result-info');
    if (info) info.textContent = d.total ? '共 ' + d.total + ' 条' : '';

    if (!d.items.length) {
      groupsContainer.innerHTML = '';
      emptyState.style.display = 'block';
      document.getElementById('files-pagination').innerHTML = '';
      return;
    }
    emptyState.style.display = 'none';

    const groupBy = document.getElementById('file-filter-group')?.value || 'type';
    const grouped = {};
    d.items.forEach(f => {
      let key;
      if (groupBy === 'department') key = f.department || '未指定部门';
      else if (groupBy === 'type') key = f.file_type || '未分类';
      else key = '_all';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(f);
    });
    const groupKeys = groupBy === '' ? ['_all'] : Object.keys(grouped).sort();

    groupsContainer.innerHTML = groupKeys.map(key => {
      const files = grouped[key];
      let groupLabel, groupIcon;
      if (groupBy === 'department') { groupLabel = key === '_all' ? '全部文件' : key; groupIcon = '🏢'; }
      else if (groupBy === 'type') { groupLabel = key; groupIcon = '📁'; }
      else { groupLabel = '全部文件'; groupIcon = '📎'; }

      const fileRows = files.map(f =>
        `<div class="file-item">
          <div class="file-info">
            <span class="file-type">${esc(f.file_type)}</span>
            <a href="/api/files/${f.id}/download" target="_blank" style="color:#333;text-decoration:none" title="点击下载">📄 ${esc(f.original_name)}</a>
            <span style="font-size:11px;color:#999">— ${esc(f.order_number)}${f.order_name ? ' ' + esc(f.order_name) : ''}</span>
            ${f.sub_batch ? `<span style="font-size:11px;background:#e6f7ff;color:#1890ff;padding:0 6px;border-radius:3px">${esc(f.sub_batch)}</span>` : ''}
          </div>
          <div class="action-group">
            <a class="btn btn-sm" href="/api/files/${f.id}/download" target="_blank" title="下载">📥 下载</a>
            <button class="btn btn-sm btn-danger" onclick="deleteFileFromList(${f.id})" title="删除">🗑 删除</button>
          </div>
        </div>`
      ).join('');

      return `<div class="file-group-card">
        <div class="file-group-header" onclick="this.nextElementSibling.classList.toggle('collapsed');this.querySelector('.group-arrow').classList.toggle('collapsed')">
          <div class="group-title">${groupIcon} ${esc(groupLabel)} <span class="group-count">${files.length} 个文件</span></div>
          <span class="group-arrow">▼</span>
        </div>
        <div class="file-group-body">${fileRows}</div>
      </div>`;
    }).join('');

    const pc = document.getElementById('files-pagination');
    pc.innerHTML = '';
    if (d.totalPages > 1) {
      pc.innerHTML =
        '<button class="page-btn" onclick="gotoFilePage(1)" ' + (d.page <= 1 ? 'disabled' : '') + '>«</button>' +
        '<button class="page-btn" onclick="gotoFilePage(' + (d.page - 1) + ')" ' + (d.page <= 1 ? 'disabled' : '') + '>‹</button>' +
        '<span class="page-info">第 ' + d.page + '/' + d.totalPages + ' 页 (共' + d.total + '条)</span>' +
        '<button class="page-btn" onclick="gotoFilePage(' + (d.page + 1) + ')" ' + (d.page >= d.totalPages ? 'disabled' : '') + '>›</button>' +
        '<button class="page-btn" onclick="gotoFilePage(' + d.totalPages + ')" ' + (d.page >= d.totalPages ? 'disabled' : '') + '>»</button>';
    }
  } catch (e) { console.error(e); }
}

function applyFileFilter() { filePage = 1; loadFiles(); }
function resetFileFilter() {
  document.getElementById('file-filter-keyword').value = '';
  document.getElementById('file-filter-type').value = '';
  document.getElementById('file-filter-department').value = '';
  document.getElementById('file-filter-date-from').value = '';
  document.getElementById('file-filter-date-to').value = '';
  document.getElementById('file-filter-group').value = 'type';
  filePage = 1;
  loadFiles();
}

async function deleteFileFromList(id) {
  if (!confirm('确定删除该文件？')) return;
  try { await api('/api/files/' + id, { method: 'DELETE' }); showToast('已删除', 'success'); loadFiles(); } catch (e) {}
}

// 回车触发
setTimeout(function () {
  var fi = document.getElementById('file-filter-keyword');
  if (fi) fi.addEventListener('keydown', function (e) { if (e.key === 'Enter') applyFileFilter(); });
}, 0);
