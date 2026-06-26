// ---- 公共 API 工具 ----

/** 封装的 fetch 请求，自动处理 JSON */
async function api(url, opts={}) {
  const res = await fetch(url, { headers:{'Content-Type':'application/json', ...opts.headers}, ...opts });
  const data = await res.json();
  if (!data.success) throw new Error(data.message||'请求失败');
  return data;
}

/** Toast 提示 */
function showToast(msg, type='info') {
  const t = document.createElement('div'); t.className = `toast toast-${type}`; t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

/** HTML 转义 */
function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

/** 打开弹窗 */
function openModal(id) {
  const el = document.getElementById(id);
  el.classList.add('open');
  const openModals = document.querySelectorAll('.modal-overlay.open');
  if (openModals.length > 1) {
    el.style.zIndex = 1000 + openModals.length;
  }
}

/** 关闭弹窗（关闭详情弹窗时自动刷新列表） */
function closeModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('open');
  el.style.zIndex = '';
  if (id === 'detail-modal' && typeof loadOrders === 'function') loadOrders();
}

// 点击遮罩层关闭弹窗
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => {
    if (e.target === el) {
      el.classList.remove('open');
      if (el.id === 'detail-modal' && typeof loadOrders === 'function') loadOrders();
    }
  });
});

/** 表单内联校验：显示错误 */
function showFieldError(fieldId, message) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  el.style.borderColor = '#ff4d4f';
  el.style.boxShadow = '0 0 0 2px rgba(255,77,79,.2)';
  let errEl = el.nextElementSibling;
  if (!errEl || !errEl.classList.contains('field-error')) {
    errEl = document.createElement('div');
    errEl.className = 'field-error';
    errEl.style.cssText = 'font-size:12px;color:#ff4d4f;margin-top:4px';
    el.parentNode.insertBefore(errEl, el.nextSibling);
  }
  errEl.textContent = '❌ ' + message;
}

/** 表单内联校验：清除错误 */
function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach(el => el.remove());
  document.querySelectorAll('.form-control').forEach(el => {
    el.style.borderColor = '';
    el.style.boxShadow = '';
  });
}
