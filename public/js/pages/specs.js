/**
 * 需规归档管理页面
 * 文档列表、扫描、系统匹配
 */

var specPage = 1;

function gotoSpectPage(p) { specPage = p; loadSpecs(); }

async function loadSpecs() {
  try {
    const params = new URLSearchParams();
    params.set('page', specPage);
    params.set('pageSize', 20);
    const v = document.getElementById('spec-version-filter')?.value;
    if (v) params.set('version', v);

    const r = await fetch('/api/specs?' + params.toString());
    const d = await r.json();
    if (!d.success) { showToast(d.message, 'error'); return; }

    const verSel = document.getElementById('spec-version-filter');
    if (verSel && verSel.options.length <= 1 && d.filters?.versions) {
      d.filters.versions.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; verSel.appendChild(o); });
    }

    const container = document.getElementById('specs-list');
    const emptyState = document.getElementById('specs-empty-state');
    const info = document.getElementById('spec-result-info');
    if (info) info.textContent = d.total ? '共 ' + d.total + ' 条' : '';

    if (!d.items.length) {
      container.innerHTML = ''; emptyState.style.display = 'block';
      document.getElementById('specs-pagination').innerHTML = ''; return;
    }
    emptyState.style.display = 'none';

    const grouped = {};
    d.items.forEach(spec => {
      const key = spec.version || '未指定版本';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(spec);
    });
    const versionOrder = d.filters?.versions || [];
    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      const ia = versionOrder.indexOf(a), ib = versionOrder.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1; if (ib !== -1) return 1;
      return b.localeCompare(a);
    });

    let html = '';
    sortedKeys.forEach(ver => {
      const specs = grouped[ver];
      html += `<div class="file-group-card">
        <div class="file-group-header" onclick="this.nextElementSibling.classList.toggle('collapsed');this.querySelector('.group-arrow').classList.toggle('collapsed')">
          <div class="group-title">🏷️ ${esc(ver)}<span class="group-count">${specs.length} 个文档</span></div>
          <span class="group-arrow">▼</span>
        </div>
        <div class="file-group-body">`;
      specs.forEach(spec => {
        const systems = spec.matched_systems ? spec.matched_systems.split(',').filter(Boolean) : [];
        const sysTags = systems.length
          ? systems.map(s => '<span class="sched-tag">📦 ' + esc(s) + '</span>').join('')
          : '<span style="font-size:12px;color:#999">未匹配系统</span>';
        const autoTag = spec.auto_matched
          ? '<span class="badge badge-green" style="margin-left:4px">🤖 自动</span>'
          : '<span class="badge badge-orange" style="margin-left:4px">✋ 手动</span>';
        html += `<div class="file-item" style="flex-direction:column;align-items:stretch">
          <div style="display:flex;justify-content:space-between;align-items:center;width:100%">
            <div class="file-info" style="flex:1;min-width:0">
              <span class="file-type">需规</span>
              <span style="font-weight:500;font-size:13px">📄 ${esc(spec.file_name)}</span>${autoTag}
            </div>
            <div class="action-group" style="flex-shrink:0">
              <button class="btn btn-sm" onclick="openSpecMatch(${spec.id})">🔗 匹配</button>
              <button class="btn btn-sm btn-danger" onclick="deleteSpec(${spec.id})">删除</button>
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:6px;padding-left:4px">
            <span style="font-size:12px;color:#999"><span>📊 关联 <b>${spec.point_count || 0}</b> 个需求点</span></span>
            ${sysTags}
            <span class="btn-link" onclick="toggleSpecPoints(${spec.id})" style="font-size:12px;color:#1890ff;cursor:pointer;user-select:none" id="spec-toggle-${spec.id}">📋 展开需求点 ▶</span>
          </div>
          <div id="spec-points-${spec.id}" style="display:none;margin-top:8px;border-top:1px dashed #e8e8e8;padding-top:8px"></div>
        </div>`;
      });
      html += '</div></div>';
    });
    container.innerHTML = html;

    const pc = document.getElementById('specs-pagination');
    pc.innerHTML = '';
    if (d.totalPages > 1) {
      pc.innerHTML =
        '<button class="page-btn" onclick="gotoSpectPage(1)" ' + (d.page <= 1 ? 'disabled' : '') + '>«</button>' +
        '<button class="page-btn" onclick="gotoSpectPage(' + (d.page - 1) + ')" ' + (d.page <= 1 ? 'disabled' : '') + '>‹</button>' +
        '<span class="page-info">第 ' + d.page + '/' + d.totalPages + ' 页 (共' + d.total + '条)</span>' +
        '<button class="page-btn" onclick="gotoSpectPage(' + (d.page + 1) + ')" ' + (d.page >= d.totalPages ? 'disabled' : '') + '>›</button>' +
        '<button class="page-btn" onclick="gotoSpectPage(' + d.totalPages + ')" ' + (d.page >= d.totalPages ? 'disabled' : '') + '>»</button>';
    }
  } catch (e) { console.error('loadSpecs error:', e); }
}

// 版本筛选
document.addEventListener('DOMContentLoaded', () => {
  const vf = document.getElementById('spec-version-filter');
  if (vf) { vf.addEventListener('change', function () { specPage = 1; loadSpecs(); }); }
});

async function scanSpecDocs() {
  const version = document.getElementById('spec-version-filter')?.value;
  if (!version) { showToast('请先选择版本', 'error'); return; }
  if (!confirm('确认为版本 "' + version + '" 扫描需规文档目录？')) return;
  const btn = document.querySelector('button[onclick="scanSpecDocs()"]');
  const originalText = btn?.textContent || '🔍 扫描目录';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 扫描中...'; }
  try {
    const r = await fetch('/api/specs/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }) });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    if (d.count > 0) showToast('✅ 发现并关联 ' + d.count + ' 个需规文档', 'success');
    else showToast('未发现新的需规文档', 'info');
    loadSpecs();
  } catch (e) { showToast(e.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = originalText; } }
}

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
  const selectedSystems = Array.from(document.querySelectorAll('#spec-match-systems .system-cb:checked')).map(cb => cb.value);
  if (!selectedSystems.length) { preview.style.display = 'none'; return; }
  const allPoints = [];
  const seenIds = new Set();
  selectedSystems.forEach(sys => {
    const pts = systemGroups[sys] || [];
    pts.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allPoints.push(p); } });
  });
  preview.style.display = 'block';
  preview.innerHTML = '📊 已选 <b>' + selectedSystems.length + '</b> 个系统，自动关联 <b>' + allPoints.length + '</b> 个排期需求点';
}

async function confirmSpecMatch() {
  const id = document.getElementById('spec-match-id').value;
  const systems = Array.from(document.querySelectorAll('#spec-match-systems .system-cb:checked')).map(cb => cb.value);
  if (!systems.length) { showToast('请至少选择一个系统', 'error'); return; }
  try {
    const r = await fetch('/api/specs/' + id + '/match', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systems }) });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    showToast(d.message || '匹配已更新', 'success');
    closeModal('spec-match-modal');
    loadSpecs();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteSpec(id) {
  if (!confirm('确定删除该需规文档记录？')) return;
  try { await api('/api/specs/' + id, { method: 'DELETE' }); showToast('已删除', 'success'); loadSpecs(); } catch (e) {}
}

async function toggleSpecPoints(id) {
  const container = document.getElementById('spec-points-' + id);
  const toggle = document.getElementById('spec-toggle-' + id);
  if (!container) return;
  if (container.style.display !== 'none') {
    container.style.display = 'none';
    if (toggle) toggle.innerHTML = '📋 展开需求点 ▶';
    return;
  }
  if (container.innerHTML.trim()) {
    container.style.display = 'block';
    if (toggle) toggle.innerHTML = '📋 收起需求点 ▼';
    return;
  }
  if (toggle) toggle.innerHTML = '⏳ 加载中...';
  try {
    const r = await fetch('/api/specs/' + id);
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    const spec = d.data;
    if (!spec.points || !spec.points.length) {
      container.innerHTML = '<div style="padding:8px 12px;color:#999;font-size:13px">暂无关联需求点</div>';
    } else {
      let html = '';
      spec.points.forEach(p => {
        html += '<div class="point-item" style="padding:6px 0;border-bottom:1px solid #f5f5f5">'
          + '<div class="point-info">'
          + '<div class="point-number" style="font-size:12px">' + esc(p.point_number) + '</div>'
          + '<div class="point-desc" style="font-size:13px">' + esc(p.description) + '</div>'
          + '<div class="point-meta" style="font-size:11px;color:#999">'
          + esc(p.order_number) + ' ' + esc(p.order_name)
          + (p.schedule_system ? ' | ' + esc(p.schedule_system) : '')
          + '</div></div></div>';
      });
      container.innerHTML = html;
    }
    container.style.display = 'block';
    if (toggle) toggle.innerHTML = '📋 收起需求点 ▼';
  } catch (e) {
    container.innerHTML = '<div style="padding:8px 12px;color:#ff4d4f;font-size:13px">加载失败</div>';
    container.style.display = 'block';
    if (toggle) toggle.innerHTML = '📋 展开需求点 ▶';
  }
}
