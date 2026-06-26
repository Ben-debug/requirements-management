// ---- 公共 UI 组件 ----

/** 填充下拉框 */
function fillSelect(id, items, placeholder) {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = `<option value="">${placeholder}</option>`;
  items.forEach(i => { const o = document.createElement('option'); o.value = i; o.textContent = i; el.appendChild(o); });
}

/** 渲染系统多选复选框 */
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

/** 获取选中的系统列表 */
function getSelectedSystems(containerId) {
  const root = containerId ? document.getElementById(containerId) : document;
  return Array.from(root.querySelectorAll('.system-cb:checked')).map(cb => cb.value);
}

/** 参数配置折叠/展开 */
function toggleConfigGroup(header) {
  const body = header.nextElementSibling;
  const arrow = header.querySelector('.arrow');
  body.classList.toggle('open');
  arrow.classList.toggle('open');
}

/** 显示导入/导出结果弹窗 */
function showResultModal(options) {
  const { title, type, stats, warnings, filename } = options;
  document.getElementById('result-modal-title').textContent = title || '📊 结果';
  let html = '';
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  html += `<div style="text-align:center;font-size:16px;font-weight:600;margin-bottom:16px">${icon} ${type === 'success' ? '操作成功' : type === 'error' ? '操作失败' : ''}</div>`;
  if (stats && stats.length) {
    html += '<div style="background:#f6ffed;border:1px solid #b7eb8f;border-radius:6px;padding:12px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px">';
    stats.forEach(s => {
      html += `<div style="flex:1;min-width:100px;text-align:center"><div style="font-size:22px;font-weight:700;color:#52c41a">${s.count}</div><div style="font-size:12px;color:#666">${s.label}</div></div>`;
    });
    html += '</div>';
  }
  if (filename) {
    html += `<div style="background:#fff7e6;border:1px solid #ffd591;border-radius:6px;padding:10px 12px;margin-bottom:12px;font-size:13px;color:#666">📎 ${esc(filename)}</div>`;
  }
  if (warnings && warnings.length) {
    html += `<div style="background:#fffbe6;border:1px solid #ffe58f;border-radius:6px;padding:10px 12px">`;
    html += `<div style="font-weight:600;font-size:13px;color:#d48806;margin-bottom:6px">⚠️ 警告（${warnings.length}条）</div>`;
    html += `<div style="max-height:200px;overflow-y:auto;font-size:13px;color:#666">`;
    warnings.forEach(w => { html += `<div style="padding:2px 0">• ${esc(w)}</div>`; });
    html += '</div></div>';
  }
  document.getElementById('result-modal-body').innerHTML = html;
  openModal('result-modal');
}

/** 填充筛选下拉框（排期查询页用） */
function fillFilter(id, items, placeholder) {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = `<option value="">${placeholder}</option>`;
  (items||[]).forEach(i => { const o = document.createElement('option'); o.value = i; o.textContent = i; el.appendChild(o); });
}
