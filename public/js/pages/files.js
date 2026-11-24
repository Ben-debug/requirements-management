/**
 * 流转文件页面
 * 跨需求单统一查看、筛选、分组（按文件类型 tab 分类）
 */

var filePage = 1;
var activeFileType = '';   // 当前选中的类型 tab，'' = 全部

function gotoFilePage(p) { filePage = p; loadFiles(); }

/** 切换类型 tab（读取 data-ft 属性，'' = 全部） */
function switchFileTypeTab(el) {
  const ft = el.getAttribute('data-ft') || '';
  activeFileType = ft;
  document.querySelectorAll('#page-files .tab-item[data-ft]').forEach(t => t.classList.toggle('active', t.getAttribute('data-ft') === ft));
  filePage = 1;
  loadFiles();
}

/** 渲染类型 tab（config 顺序优先，数据库实际类型补尾）+ 回收站角标 */
async function renderFileTypeTabs(d) {
  let types = [];
  try {
    const ftRes = await api('/api/config/file_type');
    types = (ftRes.data || []).slice();
  } catch (e) {}
  const dbTypes = Object.keys(d.typeCounts || {});
  dbTypes.forEach(t => { if (types.indexOf(t) === -1) types.push(t); });

  const container = document.getElementById('file-type-tabs');
  if (container) {
    container.innerHTML = types.map(t =>
      '<div class="tab-item" data-ft="' + esc(t) + '" onclick="switchFileTypeTab(this)">' + esc(t) +
      ' <span class="tab-count">' + (d.typeCounts[t] || 0) + '</span></div>'
    ).join('');
  }
  // 同步 active 状态
  document.querySelectorAll('#page-files .tab-item[data-ft]').forEach(el => el.classList.toggle('active', el.getAttribute('data-ft') === activeFileType));
  // 「全部」tab 计数 = 当前筛选总数
  const allCount = document.querySelector('#page-files .tab-item[data-ft=""] .tab-count');
  if (allCount) allCount.textContent = d.total || 0;
  // 回收站角标
  const tc = document.getElementById('file-trash-count');
  if (tc) tc.textContent = d.trashCount || 0;
}

async function loadFiles() {
  try {
    const params = new URLSearchParams();
    const kw = document.getElementById('file-filter-keyword')?.value?.trim();
    if (kw) params.set('keyword', kw);
    if (activeFileType) params.set('file_type', activeFileType);
    const dept = document.getElementById('file-filter-department')?.value;
    if (dept) params.set('department', dept);
    const project = document.getElementById('file-filter-project')?.value;
    if (project) params.set('project_name', project);
    const df = document.getElementById('file-filter-date-from')?.value;
    if (df) params.set('date_from', df);
    const dt = document.getElementById('file-filter-date-to')?.value;
    if (dt) params.set('date_to', dt);
    params.set('page', filePage);
    params.set('pageSize', resolvePreference('files', 'pageSize'));

    const r = await fetch('/api/files?' + params.toString());
    const d = await r.json();
    if (!d.success) { showToast(d.message, 'error'); return; }

    // 渲染类型 tab 与回收站角标
    await renderFileTypeTabs(d);

    // 填充部门下拉
    const deptSel = document.getElementById('file-filter-department');
    if (deptSel && deptSel.options.length <= 1 && d.filters?.departments) {
      d.filters.departments.forEach(dep => { const o = document.createElement('option'); o.value = dep; o.textContent = dep; deptSel.appendChild(o); });
    }
    const projSel = document.getElementById('file-filter-project');
    if (projSel && projSel.options.length <= 1 && d.filters?.projects) {
      d.filters.projects.forEach(name => { const o = document.createElement('option'); o.value = name; o.textContent = name; projSel.appendChild(o); });
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

    const groupBy = document.getElementById('file-filter-group')?.value || 'department';
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

      const fileRows = files.map(f => {
        const filePath = f.file_path || '';
        const pathHtml = filePath ? '<div style="font-size:11px;color:#bbb;margin-top:2px;word-break:break-all" title="本地路径">📂 ' + esc(filePath) + '</div>' : '';
        const open = fileOpenInfo(f);
        const previewBtn = open.previewable
          ? `<a class="btn btn-sm" href="/api/files/${f.id}/preview" target="_blank" title="在浏览器中打开">👁 预览</a>`
          : '';
        return `<div class="file-item">
          <div class="file-info">
            <span class="file-type">${esc(f.file_type)}</span>
            <div>
              <a href="${open.url}" target="_blank" style="color:#333;text-decoration:none" title="${open.title}">📄 ${esc(f.original_name)}</a>
              <span style="font-size:11px;color:#999">— ${esc(f.order_number)}${f.order_name ? ' ' + esc(f.order_name) : ''}</span>
              ${f.sub_batch ? `<span style="font-size:11px;background:#e6f7ff;color:#1890ff;padding:0 6px;border-radius:3px">${esc(f.sub_batch)}</span>` : ''}
              ${pathHtml}
            </div>
          </div>
          <div class="action-group">
            ${previewBtn}
            <a class="btn btn-sm" href="/api/files/${f.id}/download" target="_blank" title="下载">📥 下载</a>
            <button class="btn btn-sm btn-danger" onclick="deleteFileFromList(${f.id})" title="删除">🗑 删除</button>
          </div>
        </div>`;
      }).join('');

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

function applyFileFilter() {
  savePreference('files', 'group_by', document.getElementById('file-filter-group')?.value);
  filePage = 1;
  loadFiles();
}
function resetFileFilter() {
  document.getElementById('file-filter-keyword').value = '';
  document.getElementById('file-filter-department').value = '';
  document.getElementById('file-filter-project').value = '';
  document.getElementById('file-filter-date-from').value = '';
  document.getElementById('file-filter-date-to').value = '';
  document.getElementById('file-filter-group').value = 'department';
  savePreference('files', 'group_by', 'department');
  activeFileType = '';
  document.querySelectorAll('#page-files .tab-item[data-ft]').forEach(t => t.classList.toggle('active', t.getAttribute('data-ft') === ''));
  filePage = 1;
  loadFiles();
}

async function deleteFileFromList(id) {
  if (!confirm('确定删除该文件？\n文件将被移入回收站，可随时恢复。')) return;
  try { await api('/api/files/' + id, { method: 'DELETE' }); showToast('已移入回收站', 'success'); loadFiles(); } catch (e) {}
}

// ---- 回收站管理 ----
var trashPage = 1;
const TRASH_PAGE_SIZE = 20;

async function showTrashModal() {
  trashPage = 1;
  openModal('trash-modal');
  await loadTrashFiles();
}

async function loadTrashFiles() {
  try {
    const r = await fetch('/api/files/trash?page=' + trashPage + '&pageSize=' + TRASH_PAGE_SIZE);
    const d = await r.json();
    if (!d.success) { showToast(d.message, 'error'); return; }

    const info = document.getElementById('trash-info');
    const list = document.getElementById('trash-list');
    const emptyState = document.getElementById('trash-empty-state');
    const pagination = document.getElementById('trash-pagination');

    if (info) info.textContent = d.total ? '共 ' + d.total + ' 条' : '';

    if (!d.items || !d.items.length) {
      list.innerHTML = '';
      emptyState.style.display = 'block';
      pagination.innerHTML = '';
      return;
    }
    emptyState.style.display = 'none';

    list.innerHTML = d.items.map(f => {
      const deletedDate = f.deleted_at ? f.deleted_at.replace('T', ' ') : '未知';
      return `<div class="file-item trash-item">
        <div class="file-info">
          <span class="file-type">${esc(f.file_type)}</span>
          <span style="color:#999;text-decoration:line-through">📄 ${esc(f.original_name)}</span>
          <span style="font-size:11px;color:#999">— ${esc(f.order_number || '-')}</span>
          <span style="font-size:11px;color:#ff4d4f">删除于 ${esc(deletedDate)}</span>
        </div>
        <div class="action-group">
          <button class="btn btn-sm btn-success" onclick="restoreFile(${f.id})" title="恢复到原需求单">♻️ 恢复</button>
          <button class="btn btn-sm btn-danger" onclick="permanentDeleteFile(${f.id})" title="彻底删除，不可恢复">🗑️ 永久删除</button>
        </div>
      </div>`;
    }).join('');

    // 分页
    if (d.totalPages > 1) {
      let ph = '<div class="pagination" style="margin-top:12px">';
      for (let i = 1; i <= d.totalPages; i++) {
        ph += `<a href="javascript:void(0)" class="${i === trashPage ? 'active' : ''}" onclick="gotoTrashPage(${i})">${i}</a>`;
      }
      ph += '</div>';
      pagination.innerHTML = ph;
    } else {
      pagination.innerHTML = '';
    }
  } catch (e) { console.error('loadTrashFiles error:', e); }
}

function gotoTrashPage(p) { trashPage = p; loadTrashFiles(); }

async function restoreFile(id) {
  try {
    const d = await api('/api/files/' + id + '/restore', { method: 'POST' });
    showToast(d.message || '文件已恢复', 'success');
    loadTrashFiles();
    // 刷新文件列表与角标（如果文件页打开）
    if (document.getElementById('page-files').style.display !== 'none') loadFiles();
    // 如果文件详情页打开，刷新文件列表
    const detailEl = document.getElementById('detail-modal');
    if (detailEl && detailEl.classList.contains('open')) {
      viewOrder(document.getElementById('detail-order-id').value);
    }
  } catch (e) { showToast(e.message || '恢复失败', 'error'); }
}

async function permanentDeleteFile(id) {
  if (!confirm('确定永久删除该文件？\n此操作不可恢复！')) return;
  try {
    const d = await api('/api/files/' + id + '/permanent', { method: 'DELETE' });
    showToast(d.message || '文件已永久删除', 'success');
    loadTrashFiles();
    // 刷新文件列表与角标（如果文件页打开）
    if (document.getElementById('page-files').style.display !== 'none') loadFiles();
  } catch (e) { showToast(e.message || '删除失败', 'error'); }
}

async function clearAllTrash() {
  if (!confirm('确定清空回收站？\n回收站中所有文件将被永久删除，此操作不可恢复！')) return;
  try {
    const d = await api('/api/files/trash/clear', { method: 'POST' });
    showToast(d.message || '回收站已清空', 'success');
    loadTrashFiles();
    // 刷新文件列表（如果打开）
    if (document.getElementById('page-files').style.display !== 'none') loadFiles();
    const detailEl = document.getElementById('detail-modal');
    if (detailEl && detailEl.classList.contains('open')) {
      viewOrder(document.getElementById('detail-order-id').value);
    }
  } catch (e) { showToast(e.message || '清空失败', 'error'); }
}

// 回车触发
setTimeout(function () {
  var fi = document.getElementById('file-filter-keyword');
  if (fi) fi.addEventListener('keydown', function (e) { if (e.key === 'Enter') applyFileFilter(); });
}, 0);
