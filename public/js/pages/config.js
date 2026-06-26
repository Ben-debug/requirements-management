/**
 * 配置管理页面
 * 配置项 CRUD、路径设置、模板管理
 */

// ---- 加载下拉选项（页面初始化用）----
async function loadDropdowns() {
  try {
    const [depts, vers, sys, ftypes] = await Promise.all([
      api('/api/config/department'), api('/api/config/version'), api('/api/config/system'), api('/api/config/file_type')
    ]);
    fillSelect('department', depts.data, '请选择业务部门');
    fillSelect('detail-schedule-version', vers.data, '请选择版本');
    fillSelect('edit-schedule-version', vers.data, '请选择版本');
    fillSelect('file-type', ftypes.data, '选择文件类型');
  } catch (e) { console.error("loadDropdowns error:", e); }
}

// ---- 加载配置 ----
async function loadConfig() {
  try {
    const d = await api('/api/config');
    const data = d.data;
    const configPathEl = document.getElementById('config-file-path');
    if (configPathEl && d.config_path) {
      configPathEl.innerHTML = `📄 配置文件路径：<code style="background:#f5f5f5;padding:2px 8px;border-radius:4px;font-size:12px;word-break:break-all">${esc(d.config_path)}</code>`;
    }
    ['department', 'version', 'system', 'file_type'].forEach(cat => {
      const body = document.getElementById(`config-body-${cat}`);
      const count = document.getElementById(`config-${cat}-count`);
      const items = data[cat] || [];
      if (count) count.textContent = `${items.length}项`;
      if (!body) return;
      if (!items.length) {
        body.innerHTML = '<div class="config-item"><span style="color:#999">暂无配置</span></div><div style="margin-top:8px"><button class="btn btn-sm btn-primary" onclick="showAddConfig(\'' + cat + '\')">＋ 添加</button></div>';
        return;
      }
      body.innerHTML = items.map(item =>
        `<div class="config-item"><span>${esc(item)}</span><button class="btn btn-sm btn-danger" onclick="deleteConfigItem('${cat}','${esc(item)}')">删除</button></div>`
      ).join('') + `<div style="margin-top:8px"><button class="btn btn-sm btn-primary" onclick="showAddConfig('${cat}')">＋ 添加</button></div>`;
    });
  } catch (e) { console.error(e); }
  loadPaths();
  loadTemplateStatus();
}

function showAddConfig(cat) {
  const labels = { department: '业务部门', version: '上线版本', system: '涉及改造系统', file_type: '流转文件类型' };
  document.getElementById('config-modal-title').textContent = `添加${labels[cat]}`;
  document.getElementById('config-label-text').textContent = `${labels[cat]}名称 *`;
  document.getElementById('config-category-input').value = cat;
  document.getElementById('config-item-input').value = '';
  openModal('config-modal');
  document.getElementById('config-item-input').focus();
}

async function addConfigItem() {
  const cat = document.getElementById('config-category-input').value;
  const lbl = document.getElementById('config-item-input').value.trim();
  if (!lbl) { showToast('请输入名称', 'error'); return; }
  try {
    await api('/api/config', { method: 'POST', body: JSON.stringify({ category: cat, label: lbl }) });
    showToast('添加成功', 'success');
    closeModal('config-modal');
    loadConfig();
  } catch (e) {}
}

async function deleteConfigItem(cat, label) {
  if (!confirm('确定删除？')) return;
  try {
    await api(`/api/config/${encodeURIComponent(cat)}/${encodeURIComponent(label)}`, { method: 'DELETE' });
    showToast('已删除', 'success');
    loadConfig();
  } catch (e) {}
}

// ---- 关联部门复选框 ----
function loadRelatedDeptCheckboxes(selected) {
  const container = document.getElementById('related-departments');
  if (!container) return;
  const deptSel = document.getElementById('department');
  const selectedDept = deptSel ? deptSel.value : '';
  api('/api/config/department').then(d => {
    const depts = (d.data || []).filter(x => x !== selectedDept);
    container.innerHTML = depts.map(dept =>
      `<label class="checkbox-label"><input type="checkbox" name="related_departments" value="${esc(dept)}" ${selected.includes(dept) ? 'checked' : ''}> ${esc(dept)}</label>`
    ).join('');
  }).catch(() => {});
}

function onDeptChange() { loadRelatedDeptCheckboxes([]); }

// ---- 路径设置 ----
async function loadPaths() {
  try {
    const r = await fetch('/api/config/paths');
    const d = await r.json();
    if (!d.success) return;
    const p = d.data;
    document.getElementById('path-data-dir').value = p.data_dir || '';
    document.getElementById('path-flow-files').value = p.flow_files_dir || '';
    document.getElementById('path-meeting-files').value = p.meeting_files_dir || '';
    document.getElementById('path-service-order').value = p.service_order_dir || '';
    document.getElementById('path-spec-docs').value = p.spec_docs_dir || '';
    document.getElementById('path-data-dir').placeholder = p.defaults?.data_dir || 'data/';
    document.getElementById('path-flow-files').placeholder = p.defaults?.flow_files_dir || 'public/uploads/flow_files/';
    document.getElementById('path-meeting-files').placeholder = p.defaults?.meeting_files_dir || 'public/uploads/meeting_files/';
    document.getElementById('path-service-order').placeholder = p.defaults?.service_order_dir || 'public/uploads/service_orders/';
    document.getElementById('path-spec-docs').placeholder = p.defaults?.spec_docs_dir || 'public/uploads/spec_docs/';
  } catch (e) { console.error("loadPaths error:", e); }
  document.getElementById('path-save-status').textContent = '';
}

function onPathChange() {
  document.getElementById('path-save-status').textContent = '⚠️ 已修改，点击保存';
}

async function savePaths() {
  const btn = document.querySelector('button[onclick="savePaths()"]');
  btn.disabled = true;
  btn.textContent = '保存中...';
  try {
    const r = await fetch('/api/config/paths', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data_dir: document.getElementById('path-data-dir').value.trim(),
        flow_files_dir: document.getElementById('path-flow-files').value.trim(),
        meeting_files_dir: document.getElementById('path-meeting-files').value.trim(),
        service_order_dir: document.getElementById('path-service-order').value.trim(),
        spec_docs_dir: document.getElementById('path-spec-docs').value.trim()
      })
    });
    const d = await r.json();
    if (d.success) {
      showToast(d.message, 'success');
      document.getElementById('path-save-status').textContent = '✅ 已保存';
      loadPaths();
    } else {
      showToast(d.message, 'error');
    }
  } catch (e) {
    showToast('保存失败', 'error');
  }
  btn.disabled = false;
  btn.textContent = '保存路径设置';
}

// ---- 文件夹选择器 ----
let folderPickerTarget = null;

async function openFolderPicker(targetInputId) {
  folderPickerTarget = targetInputId;
  document.getElementById('folder-picker-target').value = targetInputId;
  const currentPath = document.getElementById(targetInputId).value ||
    document.getElementById(targetInputId).placeholder ||
    (navigator.platform.includes('Win') ? 'C:\\' : '/');
  await browseDir(currentPath);
  openModal('folder-picker-modal');
}

async function browseDir(dirPath) {
  try {
    const r = await fetch('/api/config/browse?path=' + encodeURIComponent(dirPath));
    const d = await r.json();
    if (!d.success) { showToast(d.message, 'error'); return; }
    const data = d.data;
    document.getElementById('folder-picker-current').textContent = '📂 ' + data.current;

    const upBtn = document.getElementById('folder-picker-up-btn');
    upBtn.style.display = data.parent ? 'inline-flex' : 'none';
    upBtn.onclick = () => browseDir(data.parent);

    document.getElementById('folder-picker-select-btn').onclick = () => {
      document.getElementById(folderPickerTarget).value = data.current;
      document.getElementById('folder-picker-target').value = '';
      document.getElementById('path-save-status').textContent = '⚠️ 已修改，点击保存';
      closeModal('folder-picker-modal');
    };

    const list = document.getElementById('folder-picker-list');
    if (!data.subdirs.length) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:#999">(空目录，无子文件夹)</div>';
      return;
    }
    let html = '';
    data.subdirs.forEach(function (dir) {
      var safePath = (data.current + '/' + dir).replace(/\\/g, '/');
      html += '<div class="folder-picker-item" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:8px" onclick="browseDir(\'' + safePath + '\')" onmouseover="this.style.background=\'#f5f5f5\'" onmouseout="this.style.background=\'\'">';
      html += '<span style="font-size:16px">📁</span> <span style="font-size:14px">' + esc(dir) + '</span></div>';
    });
    list.innerHTML = html;
  } catch (e) { showToast('无法读取目录', 'error'); }
}

// ---- 模板管理 ----
async function loadTemplateStatus() {
  try {
    const r = await fetch('/api/config/assessment-template');
    const d = await r.json();
    const statusEl = document.getElementById('template-status');
    const countEl = document.getElementById('config-template-status');
    if (!d.success || !d.data) return;
    if (d.data.exists) {
      statusEl.style.display = 'block';
      statusEl.innerHTML = '✅ 模板已上传，可用于生成需求意向书及评估表';
      statusEl.style.background = '#f6ffed';
      statusEl.style.borderColor = '#b7eb8f';
      if (countEl) countEl.textContent = '✅ 已上传';
    } else {
      statusEl.style.display = 'block';
      statusEl.innerHTML = '⚠️ 未上传模板。请上传 .docx 格式的 Word 模板文件';
      statusEl.style.background = '#fffbe6';
      statusEl.style.borderColor = '#ffe58f';
      if (countEl) countEl.textContent = '⚠️ 未上传';
    }
  } catch (e) { console.error('loadTemplateStatus error:', e); }
}

async function uploadTemplate() {
  const input = document.getElementById('template-upload-input');
  if (!input.files.length) { showToast('请选择 .docx 模板文件', 'error'); return; }
  const file = input.files[0];
  if (!file.name.toLowerCase().endsWith('.docx')) { showToast('仅支持 .docx 格式', 'error'); return; }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await fetch('/api/config/assessment-template', { method: 'POST', body: fd });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    showToast('模板上传成功', 'success');
    input.value = '';
    loadTemplateStatus();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteTemplate() {
  if (!confirm('确定删除模板文件？')) return;
  try {
    const r = await fetch('/api/config/assessment-template', { method: 'DELETE' });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    showToast('模板已删除', 'success');
    loadTemplateStatus();
  } catch (e) { showToast(e.message, 'error'); }
}
