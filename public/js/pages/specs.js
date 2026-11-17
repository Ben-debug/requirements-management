/**
 * 需规归档管理页面
 * 文档扫描 + 文档查询Tab（版本→文档→系统→需求单→需求点 + 评审会议纪要）
 */

function gotoSpectPage(p) {
  switchSpecTab('spec-tree');
  loadSpecTree();
}
var loadSpecs = gotoSpectPage;

// ============================================================
// Tab 切换
// ============================================================

function switchSpecTab(tab) {
  document.querySelectorAll('#page-specs .tab-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('#page-specs .tab-content').forEach(el => el.style.display = el.id === 'tab-' + tab ? 'block' : 'none');
  if (tab === 'spec-tree') loadSpecTree();
  if (tab === 'spec-query') initSpecQuery();
}

// ============================================================
// 事件委托：树节点展开/收起
// ============================================================

document.addEventListener('click', function (e) {
  const header = e.target.closest('.tree-node-header');
  if (!header) return;
  // 如果点的是链接或按钮，不处理展开收起
  if (e.target.closest('a, button, .btn-icon')) return;
  const container = header.closest('.tree-node');
  if (!container) return;
  const children = container.querySelector('.tree-children');
  const arrow = header.querySelector('.tree-arrow');
  if (!children) return;
  const isHidden = children.style.display === 'none' || !children.style.display;
  children.style.display = isHidden ? 'block' : 'none';
  if (arrow && !arrow.classList.contains('tree-arrow-empty')) {
    arrow.textContent = isHidden ? '▼' : '▶';
  }
});

// ============================================================
// 文档扫描视图
// ============================================================

async function loadSpecTree() {
  try {
    const params = new URLSearchParams();
    const v = document.getElementById('spec-version-filter')?.value;
    if (v) params.set('version', v);

    const r = await fetch('/api/specs/tree?' + params.toString());
    const d = await r.json();
    if (!d.success) { showToast(d.message, 'error'); return; }

    const verSel = document.getElementById('spec-version-filter');
    if (verSel && verSel.options.length <= 1 && d.filters?.versions) {
      d.filters.versions.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; verSel.appendChild(o); });
    }

    const container = document.getElementById('specs-list');
    const emptyState = document.getElementById('specs-empty-state');
    const info = document.getElementById('spec-result-info');

    const totalDocs = d.data.reduce((sum, vg) => sum + vg.documents.length, 0);
    const totalMts = d.data.reduce((sum, vg) => sum + (vg.meetings || []).length, 0);
    if (info) info.textContent = (totalDocs || totalMts) ? `共 ${totalDocs} 个文档，${totalMts} 份会议纪要` : '';

    if (!d.data.length) {
      container.innerHTML = ''; emptyState.style.display = 'block'; return;
    }
    emptyState.style.display = 'none';
    container.innerHTML = renderSpecTree(d.data);
  } catch (e) { console.error('loadSpecTree error:', e); }
}

function renderSpecTree(versionGroups) {
  let html = '<div class="spec-tree">';
  versionGroups.forEach(vg => {
    const hasDocs = vg.documents.length > 0;
    const hasMts = vg.meetings && vg.meetings.length > 0;
    const hasAny = hasDocs || hasMts;
    html += `<div class="tree-node tree-version">
      <div class="tree-node-header tree-version-header">
        <span class="tree-arrow">${hasAny ? '▶' : ''}</span>
        <span class="tree-icon">🏷️</span>
        <span class="tree-label tree-version-label">${esc(vg.version)}</span>
        <span class="tree-meta">
          <span class="tree-count">${vg.documents.length} 个文档</span>
          <span class="tree-count" style="margin-left:8px">${hasMts ? vg.meetings.length : 0} 份纪要</span>
        </span>
      </div>
      <div class="tree-children" style="display:none">`;

    // ---- 需规文档 ----
    if (hasDocs) {
      vg.documents.forEach(doc => {
        const hasSys = doc.allSystems && doc.allSystems.length > 0;
        const autoTag = doc.auto_matched
          ? '<span class="badge badge-green" style="font-size:11px">🤖 自动</span>'
          : '<span class="badge badge-orange" style="font-size:11px">✋ 手动</span>';
        const open = fileOpenInfo({ id: doc.id, file_name: doc.file_name }, `/api/specs/${doc.id}`);
        html += `<div class="tree-node tree-doc" data-id="${doc.id}">
          <div class="tree-node-header" data-level="doc">
            <span class="tree-arrow ${hasSys ? '' : 'tree-arrow-empty'}">${hasSys ? '▶' : ''}</span>
            <span class="tree-icon">📄</span>
            <span class="tree-label"><a href="${open.url}" class="file-link" title="${open.title}">${esc(doc.file_name)}</a>${open.previewable ? ` <a href="${open.downloadUrl}" class="file-link" style="font-size:11px" title="下载文件">📥</a>` : ''}</span>${autoTag}
            <span class="tree-meta">
              <span class="tree-count">${hasSys ? doc.allSystems.length : 0} 个系统</span>
              <button class="btn-icon" onclick="event.stopPropagation();openSpecMatch(${doc.id})" title="匹配系统">🔗</button>
              <button class="btn-icon btn-icon-danger" onclick="event.stopPropagation();deleteSpec(${doc.id})" title="删除">🗑️</button>
            </span>
          </div>
          <div class="tree-children" style="display:none">
            ${hasSys ? doc.allSystems.map(sys => `
              <div class="tree-node tree-system">
                <div class="tree-node-header" data-level="system">
                  <span class="tree-arrow ${sys.orders.length ? '' : 'tree-arrow-empty'}">${sys.orders.length ? '▶' : ''}</span>
                  <span class="tree-icon">📦</span>
                  <span class="tree-label">${esc(sys.name)}</span>
                  <span class="tree-meta"><span class="tree-count">${sys.orders.length > 0 ? sys.orders.length + ' 个需求单' : '暂无排期'}</span></span>
                </div>
                <div class="tree-children" style="display:none">
                  ${sys.orders.length > 0 ? sys.orders.map(order => `
                    <div class="tree-node tree-order">
                      <div class="tree-node-header" data-level="order">
                        <span class="tree-arrow ${order.points.length ? '' : 'tree-arrow-empty'}">${order.points.length ? '▶' : ''}</span>
                        <span class="tree-icon">📋</span>
                        <span class="tree-label">
                          <a href="javascript:void(0)" onclick="event.stopPropagation();viewOrderFromSpec(${order.order_id})" class="order-link" title="查看需求单详情">${esc(order.order_number)} ${esc(order.order_name)}</a>
                        </span>
                        <span class="tree-meta"><span class="tree-count">${order.points.length} 个需求点</span></span>
                      </div>
                      <div class="tree-children" style="display:none">
                        ${order.points.map(pt => `
                          <div class="tree-node tree-point">
                            <div class="tree-node-header" data-level="point" style="cursor:default">
                              <span class="tree-arrow tree-arrow-empty"></span>
                              <span class="tree-icon">📄</span>
                              <span class="tree-label">${esc(pt.point_number)}</span>
                              <span class="tree-desc">${esc(pt.description)}</span>
                            </div>
                          </div>
                        `).join('')}
                      </div>
                    </div>
                  `).join('') : '<div class="tree-empty-hint">暂无排期数据</div>'}
                </div>
              </div>
            `).join('') : '<div class="tree-empty-hint">未匹配系统</div>'}
          </div>
        </div>`;
      });
    }

    // ---- 评审会议纪要 ----
    html += `<div class="tree-node tree-meetings">
      <div class="tree-node-header" data-level="meetings">
        <span class="tree-arrow ${hasMts ? '' : 'tree-arrow-empty'}">${hasMts ? '▶' : ''}</span>
        <span class="tree-icon">📋</span>
        <span class="tree-label">评审会议纪要</span>
        <span class="tree-meta"><span class="tree-count">${hasMts ? vg.meetings.length : 0} 份</span></span>
      </div>
      <div class="tree-children" style="display:none">
        ${hasMts ? vg.meetings.map(m => `
          <div class="tree-node tree-meeting">
            <div class="tree-node-header" data-level="meeting" style="cursor:default">
              <span class="tree-arrow tree-arrow-empty"></span>
              <span class="tree-icon">📅</span>
              <span class="tree-label">${esc(m.meeting_name)}</span>
              <span class="tree-desc">${m.meeting_date ? esc(m.meeting_date) : ''}</span>
              <span class="tree-meta">
                <span class="tree-count">${m.file_name ? esc(m.file_name) : ''}</span>
                <button class="btn-icon btn-icon-danger" onclick="event.stopPropagation();deleteSpecMeeting(${m.id})" title="删除">🗑️</button>
              </span>
            </div>
          </div>
        `).join('') : '<div class="tree-empty-hint">暂无评审会议纪要，请将文件放入需规目录后点击「扫描目录」</div>'}
      </div>
    </div>`;

    html += '</div></div>';
  });
  html += '</div>';
  return html;
}

function viewOrderFromSpec(orderId) {
  if (typeof viewOrder === 'function') {
    viewOrder(orderId);   // 在需规页直接打开详情弹窗，不跳转到需求单管理页
  } else {
    showToast('无法打开需求单详情', 'error');
  }
}

function expandAllTree() {
  document.querySelectorAll('.spec-tree .tree-children').forEach(el => el.style.display = 'block');
  document.querySelectorAll('.spec-tree .tree-arrow:not(.tree-arrow-empty)').forEach(el => el.textContent = '▼');
}

function collapseAllTree() {
  document.querySelectorAll('.spec-tree .tree-children').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.spec-tree .tree-arrow:not(.tree-arrow-empty)').forEach(el => el.textContent = '▶');
}

document.addEventListener('DOMContentLoaded', () => {
  const vf = document.getElementById('spec-version-filter');
  if (vf) { vf.addEventListener('change', function () { loadSpecTree(); }); }
});

// ============================================================
// 扫描目录（需规文档 + 评审会议纪要）
// ============================================================

async function scanSpecDocs() {
  const version = document.getElementById('spec-version-filter')?.value;
  if (!version) { showToast('请先选择版本', 'error'); return; }
  if (!confirm(`确认为版本「${version}」扫描目录？\n\n📁 需规文件 → 「需规目录/${version}/」\n📁 纪要文件 → 「需规目录/${version}/meetings/」\n💡 手动匹配的需规文档不会被覆盖`)) return;
  const btn = document.querySelector('button[onclick="scanSpecDocs()"]');
  const orig = btn?.textContent || '🔍 扫描目录';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 扫描中...'; }
  try {
    const r = await fetch('/api/specs/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }) });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    if (d.skipBecauseMissingVersionDir) {
      showToast('⚠️ ' + d.message.replace(/\n/g, ' '), 'error', 8000);
    } else if (d.count > 0 || d.meeting_count > 0) {
      showToast(d.message || ('✅ 发现 ' + d.count + ' 个文档，' + d.meeting_count + ' 份纪要'), 'success');
    } else {
      showToast(d.message || '目录中没有发现需规文档或评审纪要', 'info');
    }
    loadSpecTree();
  } catch (e) { showToast(e.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = orig; } }
}

// ============================================================
// 文档匹配 / 删除
// ============================================================

async function openSpecMatch(id) {
  try {
    const r = await fetch('/api/specs/' + id);
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    const spec = d.data;
    document.getElementById('spec-match-filename').textContent = spec.file_name;
    document.getElementById('spec-match-version-display').textContent = spec.version;
    document.getElementById('spec-match-id').value = spec.id;
    document.getElementById('spec-match-version').value = spec.version;
    document.getElementById('spec-match-preview').style.display = 'none';

    const sysRes = await fetch('/api/specs/systems?version=' + encodeURIComponent(spec.version));
    const sysData = await sysRes.json();
    if (!sysData.success) throw new Error(sysData.message);

    const currentSystems = spec.matched_systems ? spec.matched_systems.split(',').filter(Boolean) : [];
    const sysContainer = document.getElementById('spec-match-systems');
    sysContainer.innerHTML = '';
    (sysData.data.systems || []).forEach(sys => {
      const label = document.createElement('label');
      label.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:6px 10px;margin:3px;border:1px solid #d9d9d9;border-radius:4px;cursor:pointer;font-size:13px';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = sys; cb.className = 'system-cb';
      if (currentSystems.includes(sys)) cb.checked = true;
      cb.addEventListener('change', function () { updateSpecMatchPreview(sysData.data.systemGroups); });
      label.appendChild(cb); label.appendChild(document.createTextNode(sys));
      label.onmouseover = () => label.style.borderColor = '#13c2c2';
      label.onmouseout = () => label.style.borderColor = '#d9d9d9';
      sysContainer.appendChild(label);
    });
    updateSpecMatchPreview(sysData.data.systemGroups);
    openModal('spec-match-modal');
  } catch (e) { showToast('加载匹配信息失败', 'error'); }
}

function updateSpecMatchPreview(systemGroups) {
  const preview = document.getElementById('spec-match-preview');
  const selected = Array.from(document.querySelectorAll('#spec-match-systems .system-cb:checked')).map(cb => cb.value);
  if (!selected.length) { preview.style.display = 'none'; return; }
  const allPoints = []; const seen = new Set();
  selected.forEach(sys => { (systemGroups[sys] || []).forEach(p => { if (!seen.has(p.id)) { seen.add(p.id); allPoints.push(p); } }); });
  preview.style.display = 'block';
  preview.innerHTML = '📊 已选 <b>' + selected.length + '</b> 个系统，自动关联 <b>' + allPoints.length + '</b> 个排期需求点';
}

async function confirmSpecMatch() {
  const id = document.getElementById('spec-match-id').value;
  const sys = Array.from(document.querySelectorAll('#spec-match-systems .system-cb:checked')).map(cb => cb.value);
  if (!sys.length) { showToast('请至少选择一个系统', 'error'); return; }
  try {
    const d = await api('/api/specs/' + id + '/match', { method: 'PUT', body: JSON.stringify({ systems: sys }) });
    showToast(d.message || '匹配已更新', 'success');
    closeModal('spec-match-modal');
    loadSpecTree();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteSpec(id) {
  if (!confirm('确定删除该需规文档记录？')) return;
  try { await api('/api/specs/' + id, { method: 'DELETE' }); showToast('已删除', 'success'); loadSpecTree(); } catch (e) {}
}

// ============================================================
// 评审会议纪要 — 删除
// ============================================================

async function deleteSpecMeeting(id) {
  if (!confirm('确定删除该评审会议纪要？')) return;
  try { await api('/api/specs/meetings/' + id, { method: 'DELETE' }); showToast('已删除', 'success'); loadSpecTree(); } catch (e) {}
}

// ============================================================
// 需规文档查询 Tab（按版本/系统/部门，结果按版本分组）
// ============================================================

let specQueryPage = 1;
const SPEC_QUERY_PAGE_SIZE = 50;

async function initSpecQuery() {
  const r = await fetch('/api/specs/query?page=1&pageSize=1');
  const d = await r.json();
  if (!d.success) return;
  const f = d.filters || {};

  const verSel = document.getElementById('sq-version');
  if (verSel && verSel.options.length <= 1 && f.versions) {
    f.versions.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; verSel.appendChild(o); });
  }
  const sysSel = document.getElementById('sq-system');
  if (sysSel && sysSel.options.length <= 1 && f.systems) {
    f.systems.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sysSel.appendChild(o); });
  }
  const deptSel = document.getElementById('sq-department');
  if (deptSel && deptSel.options.length <= 1 && f.departments) {
    f.departments.forEach(d => { const o = document.createElement('option'); o.value = d; o.textContent = d; deptSel.appendChild(o); });
  }
  const projSel = document.getElementById('sq-project');
  if (projSel) {
    const current = projSel.value;
    projSel.innerHTML = '<option value="">全部项目</option>';
    (f.projects || []).forEach(name => { const o = document.createElement('option'); o.value = name; o.textContent = name; projSel.appendChild(o); });
    if (current && Array.from(projSel.options).some(o => o.value === current)) projSel.value = current;
  }
  specQueryPage = 1;
  await loadSpecQuery();
}

async function loadSpecQuery(page) {
  if (page !== undefined) specQueryPage = page;
  const version = document.getElementById('sq-version')?.value || '';
  const system = document.getElementById('sq-system')?.value || '';
  const department = document.getElementById('sq-department')?.value || '';
  const project = document.getElementById('sq-project')?.value || '';
  const keyword = document.getElementById('sq-keyword')?.value || '';

  const params = new URLSearchParams({ page: specQueryPage, pageSize: SPEC_QUERY_PAGE_SIZE });
  if (version) params.set('version', version);
  if (system) params.set('system', system);
  if (department) params.set('department', department);
  if (project) params.set('project_name', project);
  if (keyword) params.set('keyword', keyword);

  const r = await fetch('/api/specs/query?' + params.toString());
  const d = await r.json();
  if (!d.success) { showToast(d.message, 'error'); return; }

  const container = document.getElementById('sq-results');
  const info = document.getElementById('sq-result-info');
  const pagination = document.getElementById('sq-pagination');

  if (info) info.textContent = d.total > 0 ? `共 ${d.total} 条结果` : '';
  if (!d.items || !d.items.length) {
    container.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>暂未找到匹配的需规文档</p></div>';
    pagination.innerHTML = '';
    return;
  }

  // 按版本分组渲染
  let html = '';
  let currentVersion = '';
  d.items.forEach(item => {
    if (item.version !== currentVersion) {
      if (currentVersion) html += '</div></div>';
      currentVersion = item.version;
      html += `<div class="tree-node tree-version" style="margin-top:12px">
        <div class="tree-node-header tree-version-header" style="cursor:default">
          <span class="tree-icon">🏷️</span>
          <span class="tree-label tree-version-label">${esc(item.version)}</span>
        </div>
        <div class="tree-children" style="display:block">`;
    }
    const autoTag = item.auto_matched
      ? '<span class="badge badge-green" style="font-size:11px">🤖 自动</span>'
      : '<span class="badge badge-orange" style="font-size:11px">✋ 手动</span>';
    const systems = item.matched_systems ? item.matched_systems.split(',').filter(Boolean) : [];
    const open = fileOpenInfo({ id: item.id, file_name: item.file_name }, `/api/specs/${item.id}`);
    html += `<div class="query-row" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #f0f0f0">
      <span style="flex:2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        <a href="${open.url}" class="file-link" title="${open.title}">${esc(item.file_name)}</a>${open.previewable ? ` <a href="${open.downloadUrl}" class="file-link" style="font-size:11px" title="下载文件">📥</a>` : ''}
      </span>
      <span style="flex:1">${systems.length ? systems.map(s => '<span class="badge" style="font-size:11px">' + esc(s) + '</span>').join(' ') : '<span style="color:#ccc">-</span>'}</span>
      <span style="flex:1;font-size:12px;color:#666">${item.related_orders ? esc(item.related_orders) : '-'}</span>
      <span style="flex:1;font-size:12px;color:#666">${item.related_departments ? esc(item.related_departments) : '-'}</span>
      <span style="flex:none">${autoTag}</span>
      <span style="flex:none;white-space:nowrap">
        <button class="btn-icon" onclick="event.stopPropagation();openSpecMatch(${item.id})" title="匹配系统">🔗</button>
        <button class="btn-icon btn-icon-danger" onclick="event.stopPropagation();deleteSpec(${item.id})" title="删除">🗑️</button>
      </span>
    </div>`;
  });
  if (currentVersion) html += '</div></div>';
  container.innerHTML = html;

  // 分页
  if (d.totalPages > 1) {
    let phtml = '<div class="pagination" style="margin-top:12px">';
    for (let i = 1; i <= d.totalPages; i++) {
      phtml += `<a href="javascript:void(0)" class="${i === specQueryPage ? 'active' : ''}" onclick="loadSpecQuery(${i})">${i}</a>`;
    }
    phtml += '</div>';
    pagination.innerHTML = phtml;
  } else {
    pagination.innerHTML = '';
  }
}
