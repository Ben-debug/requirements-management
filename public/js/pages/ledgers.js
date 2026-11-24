/**
 * 工作台账页面
 * 纪检 / BM 两类台账的 CRUD、条件查询、排序、分页与导出
 */

const LEDGER_TAB_CATEGORY = {
  'ledger-discipline': 'discipline',
  'ledger-bm': 'bm'
};
const LEDGER_TAB_NAME = {
  discipline: '纪检台账',
  bm: 'BM台账'
};

function ledgerCategory() {
  return LEDGER_TAB_CATEGORY[state.ledgerTab] || 'discipline';
}

/** 列表与导出共用的筛选参数；includePaging 仅列表使用 */
function ledgerFilterParams(includePaging) {
  const params = new URLSearchParams();
  params.set('category', ledgerCategory());
  const keyword = document.getElementById('ledger-keyword')?.value.trim();
  const dept = document.getElementById('ledger-department')?.value.trim();
  const from = document.getElementById('ledger-date-from')?.value;
  const to = document.getElementById('ledger-date-to')?.value;
  const sort = document.getElementById('ledger-sort')?.value || 'entry_date';
  const order = document.getElementById('ledger-order')?.value || 'desc';
  if (keyword) params.set('keyword', keyword);
  if (dept) params.set('department', dept);
  if (from) params.set('date_from', from);
  if (to) params.set('date_to', to);
  params.set('sort', sort);
  params.set('order', order);
  if (includePaging) {
    params.set('page', state.ledgerPage);
    params.set('pageSize', parseInt(document.getElementById('ledgers-page-size')?.value, 10) || 10);
  }
  return params;
}

async function loadLedgers(page) {
  if (page !== undefined) state.ledgerPage = page;
  try {
    const d = await api('/api/ledgers?' + ledgerFilterParams(true).toString());
    const info = document.getElementById('ledger-result-info');
    if (info) info.textContent = d.total > 0 ? `共 ${d.total} 条` : '';
    renderPagination('ledgers-pagination', d, 'loadLedgers', 'ledgers-page-size');

    const tbody = document.getElementById('ledger-tbody');
    if (!tbody) return;
    if (!d.data.length) {
      tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="icon">🗂️</div><p>暂无符合条件的台账记录</p></div></td></tr>';
      return;
    }
    const cell = v => v
      ? `<div class="ledger-cell" title="${esc(v)}">${esc(v)}</div>`
      : '<span style="color:#bbb">—</span>';
    tbody.innerHTML = d.data.map(r => `<tr class="query-row">
      <td>${esc(r.entry_date)}</td>
      <td>${cell(r.work_name)}</td>
      <td>${cell(r.issuing_department)}</td>
      <td>${cell(r.work_content)}</td>
      <td>${cell(r.involved_people)}</td>
      <td>${r.completion_date ? esc(r.completion_date) : '<span style="color:#bbb">—</span>'}</td>
      <td>${cell(r.related_materials)}</td>
      <td>${cell(r.remarks)}</td>
      <td><button class="btn btn-sm" onclick="editLedger(${r.id})">修改</button> <button class="btn btn-sm btn-danger" onclick="deleteLedger(${r.id})">删除</button></td>
    </tr>`).join('');
  } catch (e) { showToast(e.message, 'error'); }
}

function switchLedgerTab(tab) {
  if (!LEDGER_TAB_CATEGORY[tab]) return;
  state.ledgerTab = tab;
  document.querySelectorAll('#page-ledgers .tab-item').forEach(t => t.classList.remove('active'));
  document.querySelector(`#page-ledgers .tab-item[data-tab="${tab}"]`)?.classList.add('active');
  const title = document.getElementById('ledger-tab-title');
  if (title) title.textContent = LEDGER_TAB_NAME[ledgerCategory()];
  state.ledgerPage = 1;
  loadLedgers();
}

function showCreateLedger() {
  state.editingLedgerId = null;
  document.getElementById('ledger-modal-title').textContent = '新建' + LEDGER_TAB_NAME[ledgerCategory()];
  document.getElementById('ledger-form').reset();
  document.getElementById('ledger-id').value = '';
  document.getElementById('ledger_category').value = ledgerCategory();
  const d = new Date();
  document.getElementById('ledger_entry_date').value =
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  openModal('ledger-modal');
}

async function editLedger(id) {
  try {
    const d = (await api(`/api/ledgers/${id}`)).data;
    state.editingLedgerId = id;
    document.getElementById('ledger-modal-title').textContent = '编辑' + LEDGER_TAB_NAME[ledgerCategory()];
    document.getElementById('ledger-form').reset();
    for (const f of ['entry_date', 'work_name', 'issuing_department', 'work_content',
                     'involved_people', 'completion_date', 'related_materials', 'remarks']) {
      const el = document.getElementById('ledger_' + f);
      if (el) el.value = d[f] || '';
    }
    document.getElementById('ledger_category').value = d.category;
    document.getElementById('ledger-id').value = id;
    openModal('ledger-modal');
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteLedger(id) {
  if (!confirm('确定删除该台账记录？')) return;
  try {
    await api(`/api/ledgers/${id}`, { method: 'DELETE' });
    showToast('已删除', 'success');
    loadLedgers();
  } catch (e) { showToast(e.message, 'error'); }
}

function resetLedgerFilter() {
  ['ledger-keyword', 'ledger-department', 'ledger-date-from', 'ledger-date-to'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const sort = document.getElementById('ledger-sort');
  const order = document.getElementById('ledger-order');
  if (sort) sort.value = 'entry_date';
  if (order) order.value = 'desc';
  loadLedgers(1);
}

async function fillLedgerDepartments() {
  const dl = document.getElementById('ledger-departments');
  if (!dl) return;
  try {
    const d = await api('/api/config/department');
    dl.innerHTML = (d.data || []).map(x => `<option value="${esc(x)}"></option>`).join('');
  } catch (e) { /* 配置读取失败不影响台账使用，仍可手填 */ }
}

function exportLedgerExcel() {
  doExport('/api/ledgers/export?' + ledgerFilterParams(false).toString());
}

document.getElementById('ledger-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    if (state.editingLedgerId) {
      await api(`/api/ledgers/${state.editingLedgerId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('已更新', 'success');
    } else {
      await api('/api/ledgers', { method: 'POST', body: JSON.stringify(data) });
      showToast('已创建', 'success');
    }
    closeModal('ledger-modal');
    loadLedgers();
  } catch (err) { showToast(err.message, 'error'); }
});

document.addEventListener('DOMContentLoaded', fillLedgerDepartments);
