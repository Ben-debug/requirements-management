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

    const countOf = key => d.data.reduce((sum, vg) => sum + (vg[key] || []).length, 0);
    const totalWord = countOf('wordVersions'), totalSigned = countOf('signedScans'), totalMts = countOf('meetings');
    if (info) info.textContent = (totalWord || totalSigned || totalMts)
      ? `共 ${totalWord} 个 word版本，${totalSigned} 份签字扫描件，${totalMts} 份会议纪要` : '';

    if (!d.data.length) {
      container.innerHTML = ''; emptyState.style.display = 'block'; return;
    }
    emptyState.style.display = 'none';
    container.innerHTML = renderSpecTree(d.data);
  } catch (e) { console.error('loadSpecTree error:', e); }
}

// 评审会议纪要分支（叶子节点）
function renderFileTypeBranch(cfg) {
  const items = cfg.items || [];
  const has = items.length > 0;
  const rows = has ? items.map(item => {
    const open = fileOpenInfo({ id: item.id, file_name: item.file_name }, '/api/specs/' + item.id);
    const label = item.meeting_name || item.file_name;
    const desc = item.meeting_date ? esc(item.meeting_date) : (item.file_name ? esc(item.file_name) : '');
    return `<div class="tree-node tree-meeting">
      <div class="tree-node-header" data-level="meeting" style="cursor:default">
        <span class="tree-arrow tree-arrow-empty"></span>
        <span class="tree-icon">📅</span>
        <span class="tree-label"><a href="${open.url}" class="file-link" target="_blank" rel="noopener noreferrer" title="${open.title}">${esc(label)}</a>${open.previewable ? ` <a href="${open.downloadUrl}" class="file-link" style="font-size:11px" title="下载文件" target="_blank" rel="noopener noreferrer">📥</a>` : ''}</span>
        ${desc ? `<span class="tree-desc">${desc}</span>` : ''}
        <span class="tree-meta">
          <button class="btn-icon btn-icon-danger" onclick="event.stopPropagation();deleteSpecMeeting(${item.id})" title="删除">🗑️</button>
        </span>
      </div>
    </div>`;
  }).join('') : `<div class="tree-empty-hint">${cfg.emptyHint}</div>`;
  return `<div class="tree-node tree-meetings">
    <div class="tree-node-header" data-level="meetings">
      <span class="tree-arrow ${has ? '' : 'tree-arrow-empty'}">${has ? '▶' : ''}</span>
      <span class="tree-icon">${cfg.icon}</span>
      <span class="tree-label">${cfg.label}</span>
      <span class="tree-meta"><span class="tree-count">${items.length} ${cfg.unit || '个'}</span></span>
    </div>
    <div class="tree-children" style="display:none">${rows}</div>
  </div>`;
}

// 归档文档分支：文档 → 系统 → 需求单 → 需求点
function renderArchiveDocBranch(cfg) {
  const items = cfg.items || [];
  const has = items.length > 0;
  const rows = has ? items.map(doc => {
    const systems = doc.allSystems || [];
    const hasSys = systems.length > 0;
    const open = fileOpenInfo({ id: doc.id, file_name: doc.file_name }, '/api/specs/' + doc.id);
    const autoTag = doc.auto_matched
      ? '<span class="badge badge-green" style="font-size:11px">🤖 自动</span>'
      : '<span class="badge badge-orange" style="font-size:11px">✋ 手动</span>';
    const catTag = `<span class="badge" style="font-size:11px;background:#f0f5ff;color:#1890ff">${esc(cfg.label)}</span>`;
    const deptTag = doc.matched_department
      ? `<span class="badge" style="font-size:11px;background:#fff7e6;color:#fa8c16" title="仅关联该部门提出的需求单">部门：${esc(doc.matched_department)}</span>` : '';
    return `<div class="tree-node tree-doc" data-id="${doc.id}">
      <div class="tree-node-header" data-level="doc">
        <span class="tree-arrow ${hasSys ? '' : 'tree-arrow-empty'}">${hasSys ? '▶' : ''}</span>
        <span class="tree-icon">📄</span>
        <span class="tree-label"><a href="${open.url}" class="file-link" target="_blank" rel="noopener noreferrer" title="${open.title}">${esc(doc.file_name)}</a>${open.previewable ? ` <a href="${open.downloadUrl}" class="file-link" style="font-size:11px" title="下载文件" target="_blank" rel="noopener noreferrer">📥</a>` : ''}</span>${autoTag}${catTag}${deptTag}
        <span class="tree-meta">
          <span class="tree-count">${hasSys ? systems.length : 0} 个系统</span>
          <button class="btn-icon" onclick="event.stopPropagation();openSpecMatch(${doc.id})" title="匹配系统">🔗</button>
          <button class="btn-icon btn-icon-danger" onclick="event.stopPropagation();deleteSpec(${doc.id})" title="删除">🗑️</button>
        </span>
      </div>
      <div class="tree-children" style="display:none">
        ${hasSys ? systems.map(sys => `
          <div class="tree-node tree-system">
            <div class="tree-node-header" data-level="system">
              <span class="tree-arrow ${sys.orders.length ? '' : 'tree-arrow-empty'}">${sys.orders.length ? '▶' : ''}</span>
              <span class="tree-icon">📦</span>
              <span class="tree-label">${esc(sys.name)}</span>
              <span class="tree-meta"><span class="tree-count">${sys.orders.length ? sys.orders.length + ' 个需求单' : '暂无排期'}</span></span>
            </div>
            <div class="tree-children" style="display:none">
              ${sys.orders.length ? sys.orders.map(order => `
                <div class="tree-node tree-order">
                  <div class="tree-node-header" data-level="order">
                    <span class="tree-arrow ${order.points.length ? '' : 'tree-arrow-empty'}">${order.points.length ? '▶' : ''}</span>
                    <span class="tree-icon">📋</span>
                    <span class="tree-label"><a href="javascript:void(0)" onclick="event.stopPropagation();viewOrderFromSpec(${order.order_id})" class="order-link" title="查看需求单详情">${esc(order.order_number)} ${esc(order.order_name)}</a></span>
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
                      </div>`).join('')}
                  </div>
                </div>`).join('') : '<div class="tree-empty-hint">暂无排期数据</div>'}
            </div>
          </div>`).join('') : '<div class="tree-empty-hint">未匹配系统</div>'}
      </div>
    </div>`;
  }).join('') : `<div class="tree-empty-hint">${cfg.emptyHint}</div>`;
  return `<div class="tree-node tree-meetings">
    <div class="tree-node-header" data-level="meetings">
      <span class="tree-arrow ${has ? '' : 'tree-arrow-empty'}">${has ? '▶' : ''}</span>
      <span class="tree-icon">${cfg.icon}</span>
      <span class="tree-label">${cfg.label}</span>
      <span class="tree-meta"><span class="tree-count">${items.length} ${cfg.unit || '个'}</span></span>
    </div>
    <div class="tree-children" style="display:none">${rows}</div>
  </div>`;
}

function renderSpecTree(versionGroups) {
  let html = '<div class="spec-tree">';
  versionGroups.forEach(vg => {
    const meetings = vg.meetings || [];
    const words = vg.wordVersions || [];
    const signed = vg.signedScans || [];
    const hasAny = meetings.length + words.length + signed.length > 0;
    html += `<div class="tree-node tree-version">
      <div class="tree-node-header tree-version-header">
        <span class="tree-arrow">${hasAny ? '▶' : ''}</span>
        <span class="tree-icon">🏷️</span>
        <span class="tree-label tree-version-label">${esc(vg.version)}</span>
        <span class="tree-meta">
          <span class="tree-count">${words.length} 个 word版本</span>
          <span class="tree-count" style="margin-left:8px">${signed.length} 份签字扫描件</span>
          <span class="tree-count" style="margin-left:8px">${meetings.length} 份纪要</span>
        </span>
      </div>
      <div class="tree-children" style="display:none">`;

    html += renderFileTypeBranch({
      label: '评审会议纪要', icon: '📋', unit: '份', items: meetings,
      emptyHint: '暂无评审会议纪要，请将文件放入版本目录后点击「扫描目录」'
    });
    html += renderArchiveDocBranch({
      label: 'word版本', icon: '📝', unit: '个', items: words,
      emptyHint: '暂无 Word / Office 文档（非纪要、非 PDF 的文件归入此类）'
    });
    html += renderArchiveDocBranch({
      label: '签字扫描件', icon: '🖊️', unit: '份', items: signed,
      emptyHint: '暂无签字扫描件（PDF 文件归入此类）'
    });

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
  if (!confirm(`确认为版本「${version}」扫描目录？\n\n📁 文件直接放入「需规目录/${version}/」，扫描规则：\n　· 文件名含「评审」或「纪要」（或旧 meetings 目录）→ 评审会议纪要\n　· PDF → 签字扫描件\n　· 其余 Word/Office 文件 → word版本\n　· 非纪要文档的文件名必须包含系统名或系统别名，否则跳过不归档（避免出现非真实系统）\n　· 文件名含部门名时，该系统下只关联该部门提出的需求单\n💡 每个文件只保留一条归档记录，重复扫描按当前规则覆盖旧记录`)) return;
  const btn = document.querySelector('button[onclick="scanSpecDocs()"]');
  const orig = btn?.textContent || '🔍 扫描目录';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 扫描中...'; }
  try {
    const r = await fetch('/api/specs/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }) });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    if (d.skipBecauseMissingVersionDir) {
      showToast('⚠️ ' + d.message.replace(/\n/g, ' '), 'error', 8000);
    } else if (d.skipped_count > 0) {
      showToast('⚠️ ' + d.message.replace(/\n/g, ' '), 'error');
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
    const deptBox = document.getElementById('spec-match-department');
    if (deptBox) {
      deptBox.textContent = spec.matched_department
        ? `文档名含部门「${spec.matched_department}」，匹配的系统下仅关联该部门提出的需求单。`
        : '文档名未含部门名称，关联该系统下全部提出部门的需求单。';
    }
    document.getElementById('spec-match-id').value = spec.id;
    document.getElementById('spec-match-version').value = spec.version;
    document.getElementById('spec-match-preview').style.display = 'none';

    const sysRes = await fetch('/api/specs/systems?version=' + encodeURIComponent(spec.version)
      + '&department=' + encodeURIComponent(spec.matched_department || ''));
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

// 手工匹配成功后原地刷新：保留 Tab、展开状态与滚动位置，不跳转页面
async function refreshSpecAfterMatch(docId) {
  const treeTab = document.getElementById('tab-spec-tree');
  if (treeTab && treeTab.style.display !== 'none') {
    const container = document.getElementById('specs-list');
    // 用索引记录每个分支的展开状态，重绘后按同样顺序还原（不依赖节点身份）
    const expanded = container
      ? Array.from(container.querySelectorAll('.tree-children')).map(el => el.style.display !== 'none') : null;
    const scrollY = window.scrollY;
    await loadSpecTree();
    if (expanded && container) {
      const blocks = container.querySelectorAll('.tree-children');
      blocks.forEach((el, i) => {
        if (i >= expanded.length) return;
        el.style.display = expanded[i] ? 'block' : 'none';
        const arrow = el.closest('.tree-node')?.querySelector(':scope > .tree-node-header .tree-arrow');
        if (arrow && !arrow.classList.contains('tree-arrow-empty')) arrow.textContent = expanded[i] ? '▼' : '▶';
      });
    }
    window.scrollTo(0, scrollY);
    const header = container?.querySelector('.tree-doc[data-id="' + docId + '"] > .tree-node-header');
    if (header) {
      header.classList.add('spec-just-updated');
      setTimeout(() => header.classList.remove('spec-just-updated'), 2500);
    }
  } else if (typeof loadSpecQuery === 'function') {
    // 文档查询 Tab：复用当前筛选条件与页码，只刷新列表数据
    await loadSpecQuery();
  }
}

async function confirmSpecMatch() {
  const id = document.getElementById('spec-match-id').value;
  const sys = Array.from(document.querySelectorAll('#spec-match-systems .system-cb:checked')).map(cb => cb.value);
  if (!sys.length) { showToast('请至少选择一个系统', 'error'); return; }
  try {
    const d = await api('/api/specs/' + id + '/match', { method: 'PUT', body: JSON.stringify({ systems: sys }) });
    showToast(d.message || '匹配已更新', 'success');
    closeModal('spec-match-modal');
    await refreshSpecAfterMatch(id);
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
const SPEC_CATEGORY_LABELS = {
  word_version: 'word版本',
  signed_scan: '签字扫描件',
  meeting_minutes: '评审会议纪要'
};
function specCategoryLabel(c) { return SPEC_CATEGORY_LABELS[c] || '-'; }
function specBadgeList(raw) {
  const parts = String(raw || '').split(/[,，、\s]+/).filter(Boolean);
  if (!parts.length) return '<span style="color:#999">未匹配</span>';
  return parts.map(x => `<span class="badge badge-blue" title="${esc(x)}">${esc(x)}</span>`).join(' ');
}

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

function specQueryRow(item) {
  const autoTag = item.auto_matched
    ? '<span class="badge badge-green" title="按文件名自动匹配系统">🤖 自动</span>'
    : '<span class="badge badge-orange" title="手动匹配的系统">✋ 手动</span>';
  const open = fileOpenInfo({ id: item.id, file_name: item.file_name }, `/api/specs/${item.id}`);
  const deptTag = item.matched_department
    ? ` <span class="badge" style="font-size:11px;background:#fff7e6;color:#fa8c16" title="仅关联该部门提出的需求单">部门：${esc(item.matched_department)}</span>` : '';
  return `<tr class="query-row">
    <td title="${esc(item.file_name)}">
      <a href="${open.url}" class="file-link" title="${open.title}" target="_blank" rel="noopener noreferrer">${esc(item.file_name)}</a>${deptTag}${open.previewable ? ` <a href="${open.downloadUrl}" class="file-link" style="font-size:11px" title="下载文件" target="_blank" rel="noopener noreferrer">📥</a>` : ''}
    </td>
    <td>${specCategoryLabel(item.archive_category)}</td>
    <td>${specBadgeList(item.matched_systems)}</td>
    <td>${specBadgeList(item.related_orders)}</td>
    <td>${specBadgeList(item.related_departments)}</td>
    <td>${autoTag}</td>
    <td style="white-space:nowrap">
      <button class="btn-icon" onclick="event.stopPropagation();openSpecMatch(${item.id})" title="匹配系统">🔗</button>
      <button class="btn-icon btn-icon-danger" onclick="event.stopPropagation();deleteSpec(${item.id})" title="删除">🗑️</button>
    </td>
  </tr>`;
}

async function loadSpecQuery(page) {
  if (page !== undefined) specQueryPage = page;
  const pageSize = parseInt(document.getElementById('sq-page-size')?.value, 10) || 20;
  // 下拉未渲染时（首页仅一页）回退到偏好值，避免每页条数被重置
  const effectivePageSize = document.getElementById('sq-page-size') ? pageSize : resolvePreference('specs', 'pageSize');
  const group = document.getElementById('sq-group')?.value || resolvePreference('specs', 'group_by');
  const version = document.getElementById('sq-version')?.value || '';
  const system = document.getElementById('sq-system')?.value || '';
  const department = document.getElementById('sq-department')?.value || '';
  const project = document.getElementById('sq-project')?.value || '';
  const keyword = document.getElementById('sq-keyword')?.value || '';

  const params = new URLSearchParams({ page: specQueryPage, pageSize: effectivePageSize });
  if (group) params.set('group_by', group);
  if (version) params.set('version', version);
  if (system) params.set('system', system);
  if (department) params.set('department', department);
  if (project) params.set('project_name', project);
  if (keyword) params.set('keyword', keyword);

  const r = await fetch('/api/specs/query?' + params.toString());
  const d = await r.json();
  if (!d.success) { showToast(d.message, 'error'); return; }

  const tbody = document.getElementById('sq-results');
  const info = document.getElementById('sq-result-info');
  // 服务端按当前页分组，结果信息同时给出本页与总数，避免与分组标题口径混淆
  if (info) info.textContent = d.total > 0 ? `本页 ${(d.items || []).length} 条 / 共 ${d.total} 条结果` : '';
  // 接入全站共享分页器（自带每页条数下拉，仅在多页时渲染）
  renderPagination('sq-pagination', d, 'loadSpecQuery', 'sq-page-size');
  document.getElementById('sq-pagination')?.querySelector('select')?.addEventListener('change', e => {
    savePreference('specs', 'pageSize', e.target.value);
  });

  if (!d.items || !d.items.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon">🔍</div><p>暂未找到匹配的需规文档</p></div></td></tr>';
    return;
  }

  // 分组由服务端按当前页数据返回（与排期查询一致）
  let html = '';
  if (d.grouped) {
    Object.keys(d.grouped).sort().forEach(key => {
      const label = (group === 'archive_category' && SPEC_CATEGORY_LABELS[key]) ? SPEC_CATEGORY_LABELS[key] : key;
      const items = d.grouped[key];
      html += `<tr class="group-header"><td colspan="7" style="padding:8px 12px;font-weight:600;font-size:14px;color:#1890ff;background:#e6f7ff">🏷️ ${esc(label)}（本页 ${items.length} 份）</td></tr>`;
      html += items.map(specQueryRow).join('');
    });
  } else {
    html = d.items.map(specQueryRow).join('');
  }
  tbody.innerHTML = html;
}

document.getElementById('sq-group')?.addEventListener('change', e => {
  savePreference('specs', 'group_by', e.target.value);
});
