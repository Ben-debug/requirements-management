/**
 * 全局搜索功能
 */

// ---- 搜索防抖 ----
let searchTimeout = null;
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('global-search');
  if (!searchInput) return;
  searchInput.addEventListener('input', function (e) {
    clearTimeout(searchTimeout);
    const kw = e.target.value.trim();
    const resultsEl = document.getElementById('global-search-results');
    if (!kw) { resultsEl.classList.remove('show'); resultsEl.innerHTML = ''; return; }
    searchTimeout = setTimeout(() => doGlobalSearch(kw), 300);
  });
  searchInput.addEventListener('focus', function (e) {
    if (e.target.value.trim()) {
      document.getElementById('global-search-results').classList.add('show');
    }
  });
  document.addEventListener('click', function (e) {
    const container = document.getElementById('nav-search-container');
    if (container && !container.contains(e.target)) {
      document.getElementById('global-search-results').classList.remove('show');
    }
  });
});

async function doGlobalSearch(keyword) {
  const resultsEl = document.getElementById('global-search-results');
  resultsEl.innerHTML = '<div class="search-loading">搜索中...</div>';
  resultsEl.classList.add('show');
  try {
    const r = await api('/api/search?keyword=' + encodeURIComponent(keyword));
    const data = r.data;
    if (!data || !data.length) {
      resultsEl.innerHTML = '<div class="search-empty">🔍 未找到匹配结果</div>';
      return;
    }
    let html = '';
    data.forEach(o => {
      html += '<div class="search-dropdown-header">';
      html += '<span class="order-number">' + esc(o.order_number) + '</span>';
      html += '<span class="order-name">' + esc(o.name) + '</span>';
      html += ' <span style="font-size:11px;color:#999">[' + esc(o.department || '-') + ']</span>';
      html += '</div>';

      if (o.matchedPoints && o.matchedPoints.length) {
        o.matchedPoints.forEach(p => {
          const systems = p.schedule_system ? p.schedule_system.split(',').filter(Boolean) : [];
          const scheduled = p.schedule_system ? '✅ ' + systems.map(s => esc(s.trim())).join(',') + ' | ' + esc(p.schedule_version || '') : '⏳ 待排期';
          html += '<div class="search-dropdown-item" onclick="closeSearchAndView(' + o.id + ')">';
          html += '<div class="point-item"><span class="pt-num">' + esc(p.point_number) + '</span> ' + esc(p.description.substring(0, 60)) + (p.description.length > 60 ? '...' : '') + '</div>';
          html += '<div style="font-size:11px;color:#999;margin-top:2px">' + scheduled + '</div>';
          html += '</div>';
        });
      } else {
        html += '<div class="search-dropdown-item" onclick="closeSearchAndView(' + o.id + ')">';
        html += '<div style="font-size:13px;color:#999">(无需求点)</div></div>';
      }
    });
    resultsEl.innerHTML = html;
  } catch (e) {
    resultsEl.innerHTML = '<div class="search-empty">搜索出错</div>';
  }
}

function closeSearchAndView(orderId) {
  document.getElementById('global-search-results').classList.remove('show');
  document.getElementById('global-search').value = '';
  navigate('orders');
  setTimeout(() => viewOrder(orderId), 100);
}
