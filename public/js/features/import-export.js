/**
 * Excel 导出/导入功能
 */

function exportExcel() { doExport('/api/export'); }

function exportFiltered() {
  const params = getFilterParams();
  delete params.page;
  delete params.pageSize;
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  doExport(qs ? `/api/export/filtered?${qs}` : '/api/export');
}

async function doExport(url) {
  showToast('正在导出...', 'info');
  try {
    const r = await fetch(url);
    if (!r.ok) { const e = await r.json().catch(() => {}); throw new Error(e?.message || '导出失败'); }
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition');
    let filename = `需求单信息-${new Date().toISOString().slice(0, 10)}.xlsx`;
    if (cd) {
      let m = cd.match(/filename\*=(?:UTF-8'')?([^;\s]+)/i);
      if (m) {
        filename = decodeURIComponent(m[1]);
      } else {
        m = cd.match(/filename=(?:"([^"]+)"|([^;\s]+))/i);
        if (m) filename = m[1] || m[2];
      }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    showResultModal({ title: '📤 导出完成', type: 'success', stats: [{ label: '导出文件', count: 1 }], filename });
  } catch (e) { showToast(e.message, 'error'); }
}

function importExcel() { document.getElementById('import-file').click(); }
function downloadTemplate() { window.open('/api/import/template', '_blank'); }

// ---- 导入文件监听 ----
document.getElementById('import-file')?.addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const fd = new FormData(); fd.append('file', f);
  showToast('正在导入...', 'info');
  try {
    const r = await fetch('/api/import', { method: 'POST', body: fd });
    const d = await r.json();
    if (!d.success) throw new Error(d.message);
    const stats = [
      { label: '需求单', count: d.data.orderCount },
      { label: '需求点', count: d.data.pointCount }
    ];
    if (d.data.meetingCount) stats.push({ label: '会议', count: d.data.meetingCount });
    if (d.data.scheduleCount) stats.push({ label: '排期', count: d.data.scheduleCount });
    showResultModal({ title: '📊 导入结果', type: 'success', stats, warnings: d.data.warnings });
    e.target.value = ''; loadOrders();
  } catch (e) { showToast(e.message, 'error'); }
});
