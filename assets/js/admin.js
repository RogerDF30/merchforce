/* Merchforce admin console */
'use strict';

var CONFIG = {
  API_URL: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? '/api' : 'PASTE_EXEC_URL_HERE',
  API_TOKEN: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'mf-demo-token' : 'PASTE_API_TOKEN_HERE'
};

var A = {
  key: '', settings: null,
  requests: [], products: [], brands: [], users: [], analytics: null,
  win: 30, loaded: {}
};

var STATUSES = ['New', 'Under Review', 'Quoted', 'Confirmed', 'Dispatched', 'Closed', 'Rejected', 'Expired'];

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
function toast(msg) {
  var t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(function () { t.hidden = true; }, 2600);
}
function api(action, body) {
  body = body || {};
  body.action = action;
  body.token = CONFIG.API_TOKEN;
  body.adminKey = A.key;
  return fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow'
  }).then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.error || 'Request failed');
      return res;
    });
}
function statusPill(s) { return '<span class="pill st-' + esc(s).replace(/ /g, '') + '">' + esc(s) + '</span>'; }
function fmtDate(d) {
  var x = new Date(d);
  return isNaN(x) ? esc(String(d)) : x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) +
    ' ' + x.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/* ---------- unlock ---------- */
function unlock() {
  A.key = $('adminKey').value.trim();
  if (!A.key) return;
  $('unlockBtn').disabled = true;
  $('lockErr').textContent = '';
  api('adminUnlock').then(function (res) {
    A.settings = res.settings;
    $('lock').hidden = true;
    $('console').hidden = false;
    loadRequests();
  }).catch(function (e) {
    $('lockErr').textContent = e.message;
    $('unlockBtn').disabled = false;
  });
}
$('unlockBtn').onclick = unlock;
$('adminKey').addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock(); });
$('lockNow').onclick = function () { location.reload(); };

/* ---------- tabs (lazy loaders, one call per open — GAS serialises) ---------- */
var LOADERS = { requests: loadRequests, catalog: loadCatalog, brands: loadCatalog, users: loadUsers, analytics: loadAnalytics, settings: renderSettings };
document.querySelectorAll('.tab').forEach(function (t) {
  t.onclick = function () {
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('on'); });
    t.classList.add('on');
    document.querySelectorAll('.panel').forEach(function (p) { p.hidden = true; });
    var name = t.dataset.t;
    $('p-' + name).hidden = false;
    if (!A.loaded[name]) LOADERS[name]();
  };
});

/* ================= REQUESTS ================= */
function loadRequests() {
  A.loaded.requests = true;
  $('p-requests').innerHTML = '<div class="spin"></div>';
  api('adminRequests').then(function (res) {
    A.requests = res.requests;
    renderRequests();
  }).catch(function (e) { $('p-requests').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
}

function renderRequests() {
  var open = A.requests.filter(function (r) { return ['Closed', 'Rejected', 'Expired'].indexOf(r.status) < 0; });
  var html =
    '<div class="kpis">' +
      kpi(A.requests.filter(function (r) { return r.status === 'New'; }).length, 'New') +
      kpi(open.length, 'Open pipeline') +
      kpi(A.requests.filter(function (r) { return r.status === 'Confirmed'; }).length, 'Confirmed') +
      kpi(inr(open.reduce(function (s, r) { return s + r.total_est; }, 0)), 'Open value (est)') +
    '</div>' +
    '<div class="panel-head"><h2>Requests</h2><span class="sp"></span>' +
      '<select id="rFilter"><option value="">All statuses</option>' +
      STATUSES.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select>' +
      '<button class="btn small" id="rReload">Refresh</button></div>' +
    '<div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>ID</th><th>Created</th><th>Company</th><th>Lines</th><th>Est. value</th><th>Status</th>' +
    '</tr></thead><tbody id="rRows"></tbody></table></div>';
  $('p-requests').innerHTML = html;
  $('rReload').onclick = loadRequests;
  $('rFilter').onchange = paintRequestRows;
  paintRequestRows();
}

function paintRequestRows() {
  var f = $('rFilter').value;
  var rows = A.requests.filter(function (r) { return !f || r.status === f; });
  var tb = $('rRows');
  tb.innerHTML = rows.length ? '' : '<tr><td colspan="6" class="empty">No requests</td></tr>';
  rows.forEach(function (r) {
    var tr = document.createElement('tr');
    tr.className = 'click';
    tr.innerHTML = '<td><b>' + esc(r.id) + '</b></td><td>' + fmtDate(r.created) + '</td>' +
      '<td>' + esc(r.company) + '<br><small style="color:var(--ink-3)">' + esc(r.contact) + '</small></td>' +
      '<td>' + r.lines.length + '</td><td>' + inr(r.total_est) + '</td><td>' + statusPill(r.status) + '</td>';
    tr.onclick = function () { openRequest(r); };
    tb.appendChild(tr);
  });
}

function kpi(v, l) { return '<div class="kpi"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }

function openRequest(r) {
  var html =
    '<h2 style="margin:0 0 2px">' + esc(r.id) + ' ' + statusPill(r.status) + '</h2>' +
    '<p style="color:var(--ink-3);margin:0 0 14px;font-size:13.5px">' + fmtDate(r.created) + '</p>' +
    '<div class="two-col" style="margin-bottom:14px">' +
      '<div class="card-block"><h3>Buyer</h3>' +
        '<b>' + esc(r.company) + '</b><br>' + esc(r.contact) + '<br>' +
        '<a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a><br>' + esc(r.phone || '') +
        (r.gstin ? '<br>GSTIN: ' + esc(r.gstin) : '') + '</div>' +
      '<div class="card-block"><h3>Buyer notes</h3><div style="font-size:13.5px;color:var(--ink-2)">' +
        (esc(r.notes) || '—') + '</div></div>' +
    '</div>' +
    '<div class="table-wrap" style="margin-bottom:14px"><table class="data"><thead>' +
      '<tr><th>SKU</th><th>Product</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>' +
      r.lines.map(function (l) {
        return '<tr><td>' + esc(l.sku) + '</td><td>' + esc(l.name) + '</td><td>' + l.qty +
          '</td><td>' + inr(l.unit_price) + '</td><td>' + inr(l.line_total) + '</td></tr>';
      }).join('') +
      '<tr><td colspan="4" style="text-align:right;font-weight:800">Estimated total</td>' +
      '<td style="font-weight:800">' + inr(r.total_est) + '</td></tr>' +
    '</tbody></table></div>' +
    '<div class="field"><label>Internal notes</label><textarea id="mNotes">' + esc(r.admin_notes || '') + '</textarea></div>' +
    '<div class="field"><label>Status</label><select id="mStatus">' +
      STATUSES.map(function (s) { return '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
    '</select></div>' +
    '<p class="note">Confirmed reserves stock (checked against ATP — first confirmed wins). ' +
      'Dispatched consumes it. Rejecting or expiring a confirmed request releases the reservation.</p>' +
    '<div class="form-err" id="mErr"></div>' +
    '<button class="btn primary" id="mSave" style="width:100%;justify-content:center">Save</button>';
  openModal(html);
  $('mSave').onclick = function () {
    $('mSave').disabled = true;
    $('mErr').textContent = '';
    api('adminRequestUpdate', { id: r.id, status: $('mStatus').value, admin_notes: $('mNotes').value })
      .then(function () { closeModal(); toast(r.id + ' saved'); loadRequests(); })
      .catch(function (e) { $('mErr').textContent = e.message; $('mSave').disabled = false; });
  };
}

/* ================= CATALOG + BRANDS ================= */
function loadCatalog() {
  A.loaded.catalog = A.loaded.brands = true;
  $('p-catalog').innerHTML = '<div class="spin"></div>';
  $('p-brands').innerHTML = '<div class="spin"></div>';
  api('adminCatalog').then(function (res) {
    A.products = res.products;
    A.brands = res.brands;
    renderCatalog();
    renderBrands();
  }).catch(function (e) {
    $('p-catalog').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
  });
}

function renderCatalog() {
  var lowCount = A.products.filter(function (p) { return p.atp <= p.reorder_point; }).length;
  $('p-catalog').innerHTML =
    '<div class="kpis">' +
      kpi(A.products.length, 'Products') +
      kpi(A.products.filter(function (p) { return p.visible; }).length, 'Published') +
      kpi(lowCount, 'At / below reorder point') +
    '</div>' +
    '<div class="panel-head"><h2>Catalog</h2><span class="sp"></span>' +
      '<input id="cSearch" placeholder="Search…" style="padding:8px 12px;border:1px solid var(--line);border-radius:10px">' +
      '<button class="btn small" id="cExport">Export CSV</button>' +
      '<button class="btn primary small" id="cNew">+ Product</button></div>' +
    '<div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>SKU</th><th>Product</th><th>Brand</th><th>MOQ</th><th>On hand</th><th>Reserved</th><th>ATP</th><th>Visible</th>' +
    '</tr></thead><tbody id="cRows"></tbody></table></div>';
  $('cNew').onclick = function () { editProduct(null); };
  $('cExport').onclick = exportProducts;
  $('cSearch').oninput = paintCatalogRows;
  paintCatalogRows();
}

function paintCatalogRows() {
  var q = ($('cSearch').value || '').toLowerCase();
  var tb = $('cRows');
  tb.innerHTML = '';
  A.products.filter(function (p) {
    return !q || (p.sku + ' ' + p.name + ' ' + p.brand_id + ' ' + p.category).toLowerCase().indexOf(q) >= 0;
  }).forEach(function (p) {
    var low = p.atp <= p.reorder_point;
    var tr = document.createElement('tr');
    tr.className = 'click';
    tr.innerHTML = '<td>' + esc(p.sku) + '</td>' +
      '<td><b>' + esc(p.name) + '</b><br><small style="color:var(--ink-3)">' + esc(p.category) + '</small></td>' +
      '<td>' + esc(brandName(p.brand_id)) + '</td><td>' + p.moq + '</td>' +
      '<td>' + p.on_hand + '</td><td>' + p.reserved + '</td>' +
      '<td style="font-weight:800;color:' + (low ? 'var(--bad)' : 'inherit') + '">' + p.atp + (low ? ' ⚠' : '') + '</td>' +
      '<td>' + (p.visible ? '✓' : '—') + '</td>';
    tr.onclick = function () { editProduct(p); };
    tb.appendChild(tr);
  });
}

function brandName(id) {
  var b = A.brands.filter(function (x) { return x.id === id; })[0];
  return b ? b.name : (id || '—');
}

function editProduct(p) {
  var isNew = !p;
  p = p || { sku: '', name: '', brand_id: '', category: '', subcategory: '', description: '', specs: '',
             images: [], moq: 25, gst_rate: 18, lead_time: '', on_hand: 0, reserved: 0,
             safety_stock: 0, reorder_point: 0, visible: true, show_price: true, tiers: [] };
  var html =
    '<h2 style="margin:0 0 14px">' + (isNew ? 'New product' : esc(p.sku)) + '</h2>' +
    '<div class="f2">' +
      '<div class="field"><label>SKU *</label><input id="eSku" value="' + esc(p.sku) + '"' + (isNew ? '' : ' readonly') + '></div>' +
      '<div class="field"><label>Brand</label><select id="eBrand"><option value="">—</option>' +
        A.brands.map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === p.brand_id ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') +
      '</select></div>' +
    '</div>' +
    '<div class="field"><label>Name *</label><input id="eName" value="' + esc(p.name) + '"></div>' +
    '<div class="f2">' +
      '<div class="field"><label>Category</label><input id="eCat" value="' + esc(p.category) + '"></div>' +
      '<div class="field"><label>Subcategory</label><input id="eSub" value="' + esc(p.subcategory) + '"></div>' +
    '</div>' +
    '<div class="field"><label>Description</label><textarea id="eDesc">' + esc(p.description) + '</textarea></div>' +
    '<div class="field"><label>Specs (one per line, "Key: value")</label><textarea id="eSpecs">' +
      esc(String(p.specs || '').split('|').join('\n')) + '</textarea></div>' +
    '<div class="field"><label>Images</label>' +
      '<div id="eImgs" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"></div>' +
      '<input id="eFile" type="file" accept="image/*"></div>' +
    '<div class="f2">' +
      '<div class="field"><label>MOQ</label><input id="eMoq" type="number" value="' + p.moq + '"></div>' +
      '<div class="field"><label>GST %</label><input id="eGst" type="number" value="' + p.gst_rate + '"></div>' +
      '<div class="field"><label>Lead time</label><input id="eLead" value="' + esc(p.lead_time) + '"></div>' +
      '<div class="field"><label>On hand</label><input id="eOnHand" type="number" value="' + p.on_hand + '"></div>' +
      '<div class="field"><label>Safety stock</label><input id="eSafety" type="number" value="' + p.safety_stock + '"></div>' +
      '<div class="field"><label>Reorder point</label><input id="eReorder" type="number" value="' + p.reorder_point + '"></div>' +
    '</div>' +
    (isNew ? '' : '<p class="note">Reserved: ' + p.reserved + ' (owned by the request lifecycle) · ATP: ' + p.atp + '</p>') +
    '<div class="field"><label>Price tiers (min qty : unit price, one per line)</label><textarea id="eTiers">' +
      p.tiers.map(function (t) { return t.min + ' : ' + t.price; }).join('\n') + '</textarea></div>' +
    '<div class="f2">' +
      '<label style="display:flex;gap:8px;align-items:center;font-weight:700;font-size:14px"><input id="eVisible" type="checkbox"' + (p.visible ? ' checked' : '') + '> Visible on storefront</label>' +
      '<label style="display:flex;gap:8px;align-items:center;font-weight:700;font-size:14px"><input id="eShowPrice" type="checkbox"' + (p.show_price ? ' checked' : '') + '> Show prices</label>' +
    '</div>' +
    '<div class="form-err" id="mErr"></div>' +
    '<div style="display:flex;gap:10px;margin-top:6px">' +
      (isNew ? '' : '<button class="btn danger" id="eHide">Hide from store</button>') +
      '<button class="btn primary" id="eSave" style="flex:1;justify-content:center">Save product</button>' +
    '</div>';
  openModal(html);

  var images = p.images.slice();
  function paintImgs() {
    $('eImgs').innerHTML = images.map(function (u, i) {
      return '<span style="position:relative"><img src="' + esc(u) + '" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--line)">' +
        '<button data-i="' + i + '" style="position:absolute;top:-6px;right:-6px;border:none;background:var(--bad);color:#fff;border-radius:999px;width:20px;height:20px;font-size:11px;cursor:pointer">✕</button></span>';
    }).join('');
    $('eImgs').querySelectorAll('button').forEach(function (b) {
      b.onclick = function () { images.splice(Number(b.dataset.i), 1); paintImgs(); };
    });
  }
  paintImgs();
  $('eFile').onchange = function () {
    var f = this.files[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { $('mErr').textContent = 'Image over 4MB'; return; }
    var rd = new FileReader();
    rd.onload = function () {
      $('mErr').textContent = 'Uploading image…';
      api('adminImageUpload', { data: rd.result, filename: f.name, mime: f.type })
        .then(function (res) { images.push(res.url); paintImgs(); $('mErr').textContent = ''; })
        .catch(function (e) { $('mErr').textContent = e.message; });
    };
    rd.readAsDataURL(f);
  };

  if (!isNew) {
    $('eHide').onclick = function () {
      api('adminProductDelete', { sku: p.sku })
        .then(function () { closeModal(); toast('Hidden'); loadCatalog(); })
        .catch(function (e) { $('mErr').textContent = e.message; });
    };
  }
  $('eSave').onclick = function () {
    var tiers = $('eTiers').value.split('\n').map(function (l) {
      var kv = l.split(':');
      return { min: Number(kv[0]), price: Number(kv[1]) };
    }).filter(function (t) { return t.min > 0 && t.price > 0; });
    var payload = {
      sku: $('eSku').value.trim(), name: $('eName').value.trim(),
      brand_id: $('eBrand').value, category: $('eCat').value.trim(), subcategory: $('eSub').value.trim(),
      description: $('eDesc').value.trim(),
      specs: $('eSpecs').value.split('\n').map(function (s) { return s.trim(); }).filter(String).join('|'),
      images: images,
      moq: Number($('eMoq').value), gst_rate: Number($('eGst').value), lead_time: $('eLead').value.trim(),
      on_hand: Number($('eOnHand').value), safety_stock: Number($('eSafety').value),
      reorder_point: Number($('eReorder').value),
      visible: $('eVisible').checked, show_price: $('eShowPrice').checked,
      tiers: tiers
    };
    if (!payload.sku || !payload.name) { $('mErr').textContent = 'SKU and name are required.'; return; }
    $('eSave').disabled = true;
    api('adminProductSave', { product: payload })
      .then(function () { closeModal(); toast(payload.sku + ' saved'); loadCatalog(); })
      .catch(function (e) { $('mErr').textContent = e.message; $('eSave').disabled = false; });
  };
}

function exportProducts() {
  api('adminExportCsv', { tab: 'Products' }).then(function (res) {
    var a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(res.csv);
    a.download = res.filename;
    a.click();
  }).catch(function (e) { toast(e.message); });
}

/* ================= BRANDS ================= */
function renderBrands() {
  $('p-brands').innerHTML =
    '<div class="panel-head"><h2>Brands</h2><span class="sp"></span>' +
      '<button class="btn primary small" id="bNew">+ Brand</button></div>' +
    '<div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>Logo</th><th>Name</th><th>Products</th><th>Active</th><th>Sort</th>' +
    '</tr></thead><tbody id="bRows"></tbody></table></div>';
  $('bNew').onclick = function () { editBrand(null); };
  var tb = $('bRows');
  A.brands.sort(function (a, b) { return a.sort - b.sort; }).forEach(function (b) {
    var count = A.products.filter(function (p) { return p.brand_id === b.id; }).length;
    var tr = document.createElement('tr');
    tr.className = 'click';
    tr.innerHTML =
      '<td>' + (b.logo ? '<img src="' + esc(b.logo) + '" style="width:36px;height:36px;border-radius:999px;object-fit:cover">' :
        '<span class="brand-dot" style="width:36px;height:36px;border-radius:999px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font-weight:800">' + esc(b.name.charAt(0)) + '</span>') + '</td>' +
      '<td><b>' + esc(b.name) + '</b><br><small style="color:var(--ink-3)">' + esc(b.desc || '') + '</small></td>' +
      '<td>' + count + '</td><td>' + (b.active ? '✓' : '—') + '</td><td>' + b.sort + '</td>';
    tr.onclick = function () { editBrand(b); };
    tb.appendChild(tr);
  });
}

function editBrand(b) {
  var isNew = !b;
  b = b || { id: '', name: '', logo: '', desc: '', active: true, sort: A.brands.length + 1 };
  openModal(
    '<h2 style="margin:0 0 14px">' + (isNew ? 'New brand' : esc(b.name)) + '</h2>' +
    '<div class="field"><label>Name *</label><input id="bName" value="' + esc(b.name) + '"></div>' +
    '<div class="field"><label>Description</label><input id="bDesc" value="' + esc(b.desc) + '"></div>' +
    '<div class="field"><label>Logo</label>' +
      '<div id="bLogoPrev" style="margin-bottom:8px">' + (b.logo ? '<img src="' + esc(b.logo) + '" style="width:56px;height:56px;border-radius:999px;object-fit:cover">' : '') + '</div>' +
      '<input id="bFile" type="file" accept="image/*"></div>' +
    '<div class="f2">' +
      '<div class="field"><label>Sort order</label><input id="bSort" type="number" value="' + b.sort + '"></div>' +
      '<label style="display:flex;gap:8px;align-items:center;font-weight:700;font-size:14px;margin-top:20px"><input id="bActive" type="checkbox"' + (b.active ? ' checked' : '') + '> Active</label>' +
    '</div>' +
    '<div class="form-err" id="mErr"></div>' +
    '<div style="display:flex;gap:10px">' +
      (isNew ? '' : '<button class="btn danger" id="bDel">Delete</button>') +
      '<button class="btn primary" id="bSave" style="flex:1;justify-content:center">Save brand</button>' +
    '</div>');
  var logo = b.logo;
  $('bFile').onchange = function () {
    var f = this.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      $('mErr').textContent = 'Uploading logo…';
      api('adminImageUpload', { data: rd.result, filename: 'brand-' + f.name, mime: f.type })
        .then(function (res) {
          logo = res.url;
          $('bLogoPrev').innerHTML = '<img src="' + esc(logo) + '" style="width:56px;height:56px;border-radius:999px;object-fit:cover">';
          $('mErr').textContent = '';
        })
        .catch(function (e) { $('mErr').textContent = e.message; });
    };
    rd.readAsDataURL(f);
  };
  if (!isNew) {
    $('bDel').onclick = function () {
      api('adminBrandDelete', { id: b.id })
        .then(function () { closeModal(); toast('Deleted'); loadCatalog(); })
        .catch(function (e) { $('mErr').textContent = e.message; });
    };
  }
  $('bSave').onclick = function () {
    api('adminBrandSave', { brand: { id: b.id, name: $('bName').value.trim(), desc: $('bDesc').value.trim(), logo: logo, sort: Number($('bSort').value), active: $('bActive').checked } })
      .then(function () { closeModal(); toast('Brand saved'); loadCatalog(); })
      .catch(function (e) { $('mErr').textContent = e.message; });
  };
}

/* ================= USERS ================= */
function loadUsers() {
  A.loaded.users = true;
  $('p-users').innerHTML = '<div class="spin"></div>';
  api('adminUsers').then(function (res) {
    A.users = res.users;
    renderUsers();
  }).catch(function (e) { $('p-users').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
}

function renderUsers() {
  $('p-users').innerHTML =
    '<div class="panel-head"><h2>Buyer accounts</h2>' +
      '<span class="pill" style="background:var(--accent-soft);color:var(--accent)">Access mode: ' + esc(A.settings.access_mode) + '</span>' +
      '<span class="sp"></span><button class="btn primary small" id="uNew">+ User</button></div>' +
    '<p class="note" style="margin-top:-6px">Accounts matter only in gated mode. In open mode anyone can browse and request; switch the mode under Settings.</p>' +
    '<div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>Email</th><th>Name</th><th>Company</th><th>Active</th><th>Last login</th>' +
    '</tr></thead><tbody id="uRows"></tbody></table></div>';
  $('uNew').onclick = function () { editUser(null); };
  var tb = $('uRows');
  if (!A.users.length) tb.innerHTML = '<tr><td colspan="5" class="empty">No accounts yet</td></tr>';
  A.users.forEach(function (u) {
    var tr = document.createElement('tr');
    tr.className = 'click';
    tr.innerHTML = '<td><b>' + esc(u.email) + '</b></td><td>' + esc(u.name) + '</td><td>' + esc(u.company) + '</td>' +
      '<td>' + (u.active ? '✓' : '—') + '</td><td>' + (u.last_login ? fmtDate(u.last_login) : '—') + '</td>';
    tr.onclick = function () { editUser(u); };
    tb.appendChild(tr);
  });
}

function editUser(u) {
  var isNew = !u;
  u = u || { email: '', name: '', company: '', active: true };
  openModal(
    '<h2 style="margin:0 0 14px">' + (isNew ? 'New buyer account' : esc(u.email)) + '</h2>' +
    '<div class="field"><label>Email *</label><input id="uEmail" value="' + esc(u.email) + '"' + (isNew ? '' : ' readonly') + '></div>' +
    '<div class="f2">' +
      '<div class="field"><label>Name</label><input id="uName" value="' + esc(u.name) + '"></div>' +
      '<div class="field"><label>Company</label><input id="uCompany" value="' + esc(u.company) + '"></div>' +
    '</div>' +
    '<div class="field"><label>' + (isNew ? 'Password * (10+ chars)' : 'New password (leave blank to keep)') + '</label><input id="uPass" type="text"></div>' +
    '<label style="display:flex;gap:8px;align-items:center;font-weight:700;font-size:14px"><input id="uActive" type="checkbox"' + (u.active ? ' checked' : '') + '> Active</label>' +
    '<div class="form-err" id="mErr"></div>' +
    '<button class="btn primary" id="uSave" style="width:100%;justify-content:center">Save user</button>');
  $('uSave').onclick = function () {
    api('adminUserSave', { user: { email: $('uEmail').value.trim(), name: $('uName').value.trim(), company: $('uCompany').value.trim(), password: $('uPass').value, active: $('uActive').checked } })
      .then(function () { closeModal(); toast('User saved'); loadUsers(); })
      .catch(function (e) { $('mErr').textContent = e.message; });
  };
}

/* ================= ANALYTICS ================= */
function loadAnalytics() {
  A.loaded.analytics = true;
  $('p-analytics').innerHTML = '<div class="spin"></div>';
  api('adminAnalytics').then(function (res) {
    A.analytics = res;
    renderAnalytics();
  }).catch(function (e) { $('p-analytics').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
}

function renderAnalytics() {
  var an = A.analytics;
  var f = an.funnel;
  var reqTotal = Object.keys(f).reduce(function (s, k) { return s + f[k]; }, 0);
  var conf = (f.Confirmed || 0) + (f.Dispatched || 0) + (f.Closed || 0);
  $('p-analytics').innerHTML =
    '<div class="kpis">' +
      kpi(reqTotal, 'Requests, all time') +
      kpi(f.New || 0, 'Awaiting review') +
      kpi(conf, 'Converted (confirmed+)') +
      kpi(reqTotal ? Math.round(conf / reqTotal * 100) + '%' : '—', 'Conversion') +
    '</div>' +
    '<div class="panel-head"><h2>Product trends</h2><span class="sp"></span>' +
      '<div class="seg" id="winSeg">' +
        [30, 60, 90].map(function (w) {
          return '<button data-w="' + w + '" class="' + (A.win === w ? 'on' : '') + '">' + w + ' days</button>';
        }).join('') + '</div></div>' +
    '<div class="two-col">' +
      '<div class="card-block"><h3>Top requested (units)</h3><div id="topReq"></div></div>' +
      '<div class="card-block"><h3>Most viewed / clicked</h3><div id="topClick"></div></div>' +
    '</div>';
  $('winSeg').querySelectorAll('button').forEach(function (b) {
    b.onclick = function () { A.win = Number(b.dataset.w); renderAnalytics(); };
  });
  paintBars($('topReq'), an.top_requested[A.win] || [], function (x) { return x.value + ' u · ' + x.reqs + ' req'; });
  paintBars($('topClick'), an.top_clicked[A.win] || [], function (x) { return x.value; });
}

function paintBars(elx, list, fmt) {
  if (!list.length) { elx.innerHTML = '<div class="empty" style="padding:24px 0">No data in this window</div>'; return; }
  var max = list[0].value;
  elx.innerHTML = list.map(function (x) {
    return '<div class="bar-row"><span class="lbl" title="' + esc(x.name) + '">' + esc(x.name) + '</span>' +
      '<span class="track"><span class="bar" style="display:block;width:' + Math.max(3, Math.round(x.value / max * 100)) + '%"></span></span>' +
      '<span class="num">' + fmt(x) + '</span></div>';
  }).join('');
}

/* ================= SETTINGS ================= */
function renderSettings() {
  A.loaded.settings = true;
  var s = A.settings;
  $('p-settings').innerHTML =
    '<div class="panel-head"><h2>Site settings</h2></div>' +
    '<div class="two-col">' +
      '<div class="card-block"><h3>Storefront</h3>' +
        '<div class="field"><label>Site name</label><input id="sName" value="' + esc(s.site_name) + '"></div>' +
        '<div class="field"><label>Tagline</label><input id="sTag" value="' + esc(s.tagline) + '"></div>' +
        '<div class="field"><label>Access mode</label><select id="sMode">' +
          '<option value="open"' + (s.access_mode === 'open' ? ' selected' : '') + '>Open — anyone can browse and request</option>' +
          '<option value="gated"' + (s.access_mode === 'gated' ? ' selected' : '') + '>Gated — sign-in required</option>' +
        '</select></div>' +
        '<div class="field"><label>Stock display</label><select id="sStock">' +
          '<option value="badge"' + (s.show_stock_numbers === 'badge' ? ' selected' : '') + '>Badge only (In / Low / Out)</option>' +
          '<option value="exact"' + (s.show_stock_numbers === 'exact' ? ' selected' : '') + '>Exact ATP numbers</option>' +
        '</select></div>' +
      '</div>' +
      '<div class="card-block"><h3>Operations</h3>' +
        '<div class="field"><label>New-request notification email</label><input id="sNotify" value="' + esc(s.notify_email) + '" placeholder="you@company.com"></div>' +
        '<div class="field"><label>Low-stock badge threshold (ATP ≤)</label><input id="sLow" type="number" value="' + esc(s.low_stock_threshold) + '"></div>' +
      '</div>' +
    '</div>' +
    '<div class="form-err" id="sErr"></div>' +
    '<button class="btn primary" id="sSave" style="margin-top:14px">Save settings</button>';
  $('sSave').onclick = function () {
    $('sSave').disabled = true;
    api('adminSettings', { save: {
      site_name: $('sName').value.trim(), tagline: $('sTag').value.trim(),
      access_mode: $('sMode').value, show_stock_numbers: $('sStock').value,
      notify_email: $('sNotify').value.trim(), low_stock_threshold: $('sLow').value
    } }).then(function (res) {
      A.settings = res.settings;
      $('sSave').disabled = false;
      toast('Settings saved');
    }).catch(function (e) { $('sErr').textContent = e.message; $('sSave').disabled = false; });
  };
}

/* ---------- modal ---------- */
function openModal(html) {
  $('mBody').innerHTML = html;
  $('mOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('mOverlay').hidden = true;
  document.body.style.overflow = '';
}
$('mClose').onclick = closeModal;
$('mOverlay').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
