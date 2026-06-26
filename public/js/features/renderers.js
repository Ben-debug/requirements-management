/**
 * 公共渲染工具
 * 分页、卡片、文件项等可复用渲染函数
 */

// ---- 分页渲染 ----
function renderPagination(containerId, r, gotoFn) {
  const c = document.getElementById(containerId);
  if (!c) return;
  if (!r || r.totalPages <= 1) { c.innerHTML = ''; return; }
  c.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;width:100%">
    <div>
      <button class="page-btn" onclick="${gotoFn}(1)" ${r.page <= 1 ? 'disabled' : ''}>«</button>
      <button class="page-btn" onclick="${gotoFn}(${r.page - 1})" ${r.page <= 1 ? 'disabled' : ''}>‹</button>
      <span class="page-info">第 ${r.page}/${r.totalPages} 页 (共${r.total}条)</span>
      <button class="page-btn" onclick="${gotoFn}(${r.page + 1})" ${r.page >= r.totalPages ? 'disabled' : ''}>›</button>
      <button class="page-btn" onclick="${gotoFn}(${r.totalPages})" ${r.page >= r.totalPages ? 'disabled' : ''}>»</button>
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:12px;color:#999">每页</span>
      <select onchange="${gotoFn}(1)" style="padding:4px 6px;border:1px solid #d9d9d9;border-radius:4px;font-size:12px">
        <option value="10">10</option>
        <option value="20">20</option>
        <option value="50">50</option>
        <option value="100">100</option>
      </select>
    </div>
  </div>`;
  // Set the page size select to current value
  const sel = c.querySelector('select');
  if (sel) sel.value = r.pageSize || 10;
}

// ---- 文件项 HTML ----
function fileItemHtml(f) {
  return '<div class="file-item"><div class="file-info"><span class="file-type">' + esc(f.file_type) + '</span><span><a href="/api/files/' + f.id + '/download" style="color:#333;text-decoration:none" title="点击下载" target="_blank">' + esc(f.original_name) + '</a></span></div><div class="action-group"><a class="btn btn-sm" href="/api/files/' + f.id + '/download" target="_blank" title="下载文件">📥 下载</a><button class="btn btn-sm btn-danger" onclick="deleteFile(' + f.id + ')">删除</button></div></div>';
}

// ---- 排期卡片渲染 ----
function renderScheduledCard(s, opts) {
  opts = opts || {};
  const systems = s.system ? s.system.split(',').map(x => x.trim()).filter(Boolean) : [];
  const batchTag = s.sub_batch ? ` <span style="font-size:11px;color:#1890ff;background:#f0f5ff;padding:1px 6px;border-radius:3px">${esc(s.order_number)}-${esc(s.sub_batch)}</span>` : '';
  const projTag = s.is_project ? '<span class="sched-tag">📋 已立项</span>' : '';
  return `<div class="schedule-card" style="margin-bottom:6px">
    <div class="sched-header">
      <div class="sched-title">${esc(s.point_number)}${batchTag}</div>
      ${opts.showActions ? `<div class="action-group"><button class="btn btn-sm" onclick="openEditScheduleModalFromMeeting(${s.id})">修改</button><button class="btn btn-sm btn-danger" onclick="deleteScheduleFromMeeting(${s.id})">移除</button></div>` : ''}
      ${opts.showMeeting ? `<div style="font-size:12px;color:#888">${esc(s.meeting_name)} (${s.meeting_date})</div>` : ''}
    </div>
    <div class="sched-meta">${esc(s.point_description).replace(/\n/g, '<br>')}</div>
    ${opts.showDepartment && s.department ? `<div class="sched-meta">部门: ${esc(s.department)}</div>` : ''}
    <div class="sched-tags">${systems.map(sys => `<span class="sched-tag">📦 ${esc(sys)}</span>`).join('')}<span class="sched-tag">🏷️ ${esc(s.version)}</span>${projTag}</div>
  </div>`;
}

// ---- 三级折叠列表：需求单 → 子单 → 点 ----
function renderScheduleHierarchy(schedules, renderPointFn) {
  const orderGroups = {};
  schedules.forEach(s => {
    const key = s.order_number;
    if (!orderGroups[key]) orderGroups[key] = { order_number: s.order_number, order_name: s.order_name || '', items: [] };
    orderGroups[key].items.push(s);
  });
  const sortedOrderKeys = Object.keys(orderGroups).sort((a, b) => {
    const aL = a.charAt(0), bL = b.charAt(0);
    if (aL !== bL) return aL < bL ? -1 : 1;
    return parseInt(a.substring(1)) - parseInt(b.substring(1));
  });
  let html = '<div id="schedule-scheduled-list">';
  sortedOrderKeys.forEach(okey => {
    const grp = orderGroups[okey], pts = grp.items;
    html += `<div class="schedule-order-card">
      <div class="schedule-order-header" onclick="toggleScheduleOrder(this)">
        <div class="header-left">
          <span class="schedule-order-arrow">▶</span>
          <span style="font-weight:600;font-size:14px;color:#1890ff">${esc(okey)}</span>
          <span style="font-size:13px;color:#333;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(grp.order_name)}</span>
          <span class="badge badge-green">${pts.length}个已排期</span>
        </div>
        <div class="header-right">
          <span style="font-size:11px;color:#999">点击展开</span>
          <span class="schedule-order-arrow" style="font-size:14px">▶</span>
        </div>
      </div>
      <div class="schedule-order-body">`;
    const batched = {}, unbatched = [];
    pts.forEach(s => { if (s.sub_batch) { if (!batched[s.sub_batch]) batched[s.sub_batch] = []; batched[s.sub_batch].push(s); } else { unbatched.push(s); } });
    Object.keys(batched).sort().forEach(batch => {
      const bpts = batched[batch], label = okey + '-' + batch;
      html += `<div class="batch-sub-card" style="border:1px solid #e8e8e8;border-radius:6px;margin:0 0 8px;overflow:hidden;background:#fff">
        <div class="batch-sub-header" onclick="toggleBatchBody(this)" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f0f5ff;border-left:3px solid #52c41a;user-select:none">
          <span class="batch-expand-arrow" style="font-size:12px;color:#999;transition:transform .2s;width:14px;text-align:center">▶</span>
          <span style="font-weight:600;font-size:13px;color:#1890ff">📁 ${esc(label)}</span>
          <span class="badge badge-green">${bpts.length}项</span>
          <span style="font-size:11px;color:#999;margin-left:auto">点击展开</span>
        </div>
        <div class="batch-sub-body" style="display:none;padding:6px 10px 10px">${bpts.map(s => renderPointFn(s)).join('')}</div></div>`;
    });
    unbatched.forEach(s => { html += renderPointFn(s); });
    html += `</div></div>`;
  });
  html += '</div>';
  return html;
}
