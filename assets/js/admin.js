/* Merchforce admin console — RSM-style */
'use strict';

var CONFIG = {
  API_URL: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? '/api' : 'https://script.google.com/macros/s/AKfycbzf3CTREzupukc4R8En8ap0ueAGjP3N9yUYq_Svmou19NIVhB4936bArrRMhZxSUkYHFA/exec',
  API_TOKEN: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'mf-demo-token' : 'mf_jgLqzLNJjzqVZ7qXfQ3JgvYXXxJj'
};

var A = {
  key: '', settings: null,
  requests: [], products: [], brands: [], users: [], analytics: null,
  days: 90, loaded: {}, syncPreview: null
};

var STATUSES = ['New', 'Under Review', 'Quoted', 'Confirmed', 'Dispatched', 'Closed', 'Rejected', 'Expired'];

/* ---------- plumbing ---------- */
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
function qty(n) { return Number(n || 0).toLocaleString('en-IN'); }
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
function imgOf(sku) {
  var p = A.products.filter(function (x) { return x.sku === sku; })[0];
  return p && p.images[0] ? p.images[0] : '';
}
function brandName(id) {
  var b = A.brands.filter(function (x) { return x.id === id; })[0];
  return b ? b.name : (id || '—');
}

/* ---------- unlock ---------- */
function unlock() {
  A.key = $('adminKey').value.trim();
  if (!A.key) return;
  $('unlockBtn').disabled = true;
  $('lockErr').textContent = '';
  api('adminUnlock').then(function (res) {
    A.settings = res.settings;
    A.relayStatus = res.relay_status || null;
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

/* ---------- tabs ---------- */
var LOADERS = { requests: loadRequests, catalog: loadCatalog, brands: loadCatalog, users: loadUsers, analytics: loadAnalytics, settings: renderSettings };
document.querySelectorAll('#tabs .chip').forEach(function (t) {
  t.onclick = function () {
    document.querySelectorAll('#tabs .chip').forEach(function (x) { x.classList.remove('on'); });
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

function stat(v, l) { return '<div class="stat"><div class="stat-n">' + v + '</div><div class="stat-l">' + l + '</div></div>'; }

function renderRequests() {
  var open = A.requests.filter(function (r) { return ['Closed', 'Rejected', 'Expired'].indexOf(r.status) < 0; });
  $('p-requests').innerHTML =
    '<div class="stat-row">' +
      stat(A.requests.filter(function (r) { return r.status === 'New'; }).length, 'New') +
      stat(open.length, 'Open pipeline') +
      stat(A.requests.filter(function (r) { return r.status === 'Confirmed'; }).length, 'Confirmed') +
      stat(inr(open.reduce(function (s, r) { return s + r.total_est; }, 0)), 'Open value (est)') +
    '</div>' +
    '<div class="panel-head"><h2>Requests</h2><span class="sp"></span>' +
      '<select id="rFilter" style="padding:8px 12px;border:1px solid var(--line);border-radius:10px"><option value="">All statuses</option>' +
      STATUSES.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select>' +
      '<button class="btn small" id="rReload">Refresh</button></div>' +
    '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>ID</th><th>Created</th><th>Company</th><th class="num">Lines</th><th class="num">Est. value</th><th>Status</th>' +
    '</tr></thead><tbody id="rRows"></tbody></table></div>';
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
      '<td class="num">' + r.lines.length + '</td><td class="num">' + inr(r.total_est) + '</td><td>' + statusPill(r.status) + '</td>';
    tr.onclick = function () { openRequest(r); };
    tb.appendChild(tr);
  });
}

function openRequest(r) {
  openDrawer(
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
    '<div class="tbl-wrap" style="margin-bottom:14px"><table class="tbl"><thead>' +
      '<tr><th>SKU</th><th>Product</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr></thead><tbody>' +
      r.lines.map(function (l) {
        return '<tr><td>' + esc(l.sku) + '</td><td>' + esc(l.name) + '</td><td class="num">' + qty(l.qty) +
          '</td><td class="num">' + inr(l.unit_price) + '</td><td class="num">' + inr(l.line_total) + '</td></tr>';
      }).join('') +
      '<tr><td colspan="4" style="text-align:right;font-weight:800">Estimated total</td>' +
      '<td class="num" style="font-weight:800">' + inr(r.total_est) + '</td></tr>' +
    '</tbody></table></div>' +
    '<div class="field"><label>Internal notes</label><textarea id="mNotes">' + esc(r.admin_notes || '') + '</textarea></div>' +
    '<div class="field"><label>Status</label><select id="mStatus">' +
      STATUSES.map(function (s) { return '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
    '</select></div>' +
    '<p class="note">Confirmed reserves stock (checked against ATP — first confirmed wins). ' +
      'Dispatched consumes it. Rejecting or expiring a confirmed request releases the reservation.</p>' +
    '<div class="form-err" id="mErr"></div>' +
    '<button class="btn primary" id="mSave" style="width:100%;justify-content:center">Save</button>');
  $('mSave').onclick = function () {
    $('mSave').disabled = true;
    $('mErr').textContent = '';
    api('adminRequestUpdate', { id: r.id, status: $('mStatus').value, admin_notes: $('mNotes').value })
      .then(function () { closeDrawer(); toast(r.id + ' saved'); loadRequests(); })
      .catch(function (e) { $('mErr').textContent = e.message; $('mSave').disabled = false; });
  };
}

/* ================= CATALOG + BRANDS ================= */
function loadCatalog() {
  A.loaded.catalog = A.loaded.brands = true;
  $('p-catalog').innerHTML = '<div class="spin"></div>';
  $('p-brands').innerHTML = '<div class="spin"></div>';
  return api('adminCatalog').then(function (res) {
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
    '<div class="stat-row">' +
      stat(A.products.length, 'Products') +
      stat(A.products.filter(function (p) { return p.visible; }).length, 'Published') +
      stat(lowCount, 'At / below reorder point') +
    '</div>' +
    '<div class="panel-head"><h2>Catalog</h2><span class="sp"></span>' +
      '<input id="cSearch" placeholder="Search…" style="padding:8px 12px;border:1px solid var(--line);border-radius:10px">' +
      '<button class="btn small" id="cExport">Export CSV</button>' +
      '<button class="btn primary small" id="cNew">+ Product</button></div>' +
    '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th></th><th>SKU</th><th>Product</th><th>Brand</th><th class="num">MOQ</th><th class="num">MRP</th><th class="num">From</th><th class="num">On hand</th><th class="num">Reserved</th><th class="num">ATP</th><th>Visible</th>' +
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
    var from = p.tiers.length ? p.tiers[p.tiers.length - 1].price : 0;
    var tr = document.createElement('tr');
    tr.className = 'click';
    tr.innerHTML =
      '<td>' + (p.images[0] ? '<img class="prod-img" style="width:38px;height:38px" src="' + esc(p.images[0]) + '">' : '') + '</td>' +
      '<td>' + esc(p.sku) + '</td>' +
      '<td><b>' + esc(p.name) + '</b><br><small style="color:var(--ink-3)">' + esc(p.category) + '</small></td>' +
      '<td>' + esc(brandName(p.brand_id)) + '</td><td class="num">' + p.moq + '</td>' +
      '<td class="num" style="text-decoration:line-through;color:var(--ink-3)">' + (p.mrp ? inr(p.mrp) : '—') + '</td>' +
      '<td class="num">' + (from ? inr(from) : '—') + '</td>' +
      '<td class="num">' + qty(p.on_hand) + '</td><td class="num">' + qty(p.reserved) + '</td>' +
      '<td class="num" style="font-weight:800;color:' + (low ? 'var(--bad)' : 'inherit') + '">' + qty(p.atp) + (low ? ' ⚠' : '') + '</td>' +
      '<td>' + (p.visible ? '✓' : '—') + '</td>';
    tr.onclick = function () { editProduct(p); };
    tb.appendChild(tr);
  });
}

/* Product editor — RSM-style tier rows: min qty @ price, per-tier GST (blank inherits) */
function editProduct(p) {
  var isNew = !p;
  p = p || { sku: '', name: '', brand_id: '', category: '', subcategory: '', description: '', specs: '',
             images: [], moq: 1, gst_rate: 18, mrp: '', lead_time: '', on_hand: 0, reserved: 0,
             safety_stock: 0, reorder_point: 0, visible: true, show_price: true,
             tiers: [{ min: 1, price: 0, gst: '' }] };
  var draft = JSON.parse(JSON.stringify(p));
  if (!draft.tiers.length) draft.tiers = [{ min: draft.moq || 1, price: 0, gst: '' }];

  openDrawer(
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
      '<input id="eFile" type="file" accept="image/*" multiple></div>' +
    '<div class="f2">' +
      '<div class="field"><label>MOQ (1 = no minimum)</label><input id="eMoq" type="number" min="1" value="' + draft.moq + '"></div>' +
      '<div class="field"><label>Product GST %</label><input id="eGst" type="number" min="0" step="0.01" value="' + draft.gst_rate + '"></div>' +
      '<div class="field"><label>MRP ₹ (shown struck through)</label><input id="eMrp" type="number" min="0" value="' + (p.mrp || '') + '"></div>' +
      '<div class="field"><label>Lead time</label><input id="eLead" value="' + esc(p.lead_time) + '"></div>' +
      '<div class="field"><label>On hand</label><input id="eOnHand" type="number" value="' + p.on_hand + '"></div>' +
      '<div class="field"><label>Safety stock</label><input id="eSafety" type="number" value="' + p.safety_stock + '"></div>' +
      '<div class="field"><label>Reorder point</label><input id="eReorder" type="number" value="' + p.reorder_point + '"></div>' +
    '</div>' +
    (isNew ? '' : '<p class="note">Reserved: ' + p.reserved + ' (owned by the request lifecycle) · ATP: ' + p.atp + '</p>') +
    '<h3 style="margin:16px 0 4px">Price tiers</h3>' +
    '<p class="note" style="margin:0 0 10px">The first tier must start at the MOQ. GST left blank uses the product rate — set it per tier only when volume crosses a slab.</p>' +
    '<div id="tierBox"></div>' +
    '<div class="f2" style="margin-top:12px">' +
      '<label style="display:flex;gap:8px;align-items:center;font-weight:700;font-size:14px"><input id="eVisible" type="checkbox"' + (p.visible ? ' checked' : '') + '> Visible on storefront</label>' +
      '<label style="display:flex;gap:8px;align-items:center;font-weight:700;font-size:14px"><input id="eShowPrice" type="checkbox"' + (p.show_price ? ' checked' : '') + '> Show prices</label>' +
    '</div>' +
    '<div class="form-err" id="mErr"></div>' +
    '<div style="display:flex;gap:10px;margin-top:6px">' +
      (isNew ? '' : '<button class="btn danger" id="eHide">Hide from store</button>') +
      '<button class="btn primary" id="eSave" style="flex:1;justify-content:center">Save product</button>' +
    '</div>');

  function paintTiers() {
    var box = $('tierBox');
    box.innerHTML = '';
    draft.tiers.forEach(function (t, i) {
      var row = document.createElement('div');
      row.className = 'tier-row';
      row.innerHTML =
        'From <input type="number" min="1" style="width:90px" data-k="min" data-i="' + i + '" value="' + t.min + '"> units' +
        ' @ ₹ <input type="number" min="0" step="0.01" style="width:110px" data-k="price" data-i="' + i + '" value="' + t.price + '">' +
        ' GST <input type="number" min="0" step="0.01" style="width:70px" placeholder="' + draft.gst_rate + '" title="Leave blank to use the product rate" data-k="gst" data-i="' + i + '" value="' + (t.gst === '' || t.gst === null || t.gst === undefined ? '' : t.gst) + '"> %' +
        ' <button type="button" class="btn ghost small" data-rm="' + i + '">Remove</button>';
      box.appendChild(row);
    });
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn small';
    add.textContent = '+ Add tier';
    add.onclick = function () {
      var last = draft.tiers[draft.tiers.length - 1];
      draft.tiers.push({ min: last ? Number(last.min) * 2 : (Number($('eMoq').value) || 1),
                         price: last ? last.price : 0, gst: last ? last.gst : '' });
      paintTiers();
    };
    box.appendChild(add);
    box.querySelectorAll('input[data-k]').forEach(function (inp) {
      inp.oninput = function () {
        var t = draft.tiers[Number(inp.dataset.i)];
        t[inp.dataset.k] = inp.value === '' ? '' : Number(inp.value);
      };
    });
    box.querySelectorAll('button[data-rm]').forEach(function (b) {
      b.onclick = function () { draft.tiers.splice(Number(b.dataset.rm), 1); paintTiers(); };
    });
  }
  paintTiers();

  var images = p.images.slice();
  function paintImgs() {
    $('eImgs').innerHTML = images.map(function (u, i) {
      return '<span style="position:relative"><img src="' + esc(u) + '" style="width:64px;height:64px;object-fit:contain;background:var(--bg);border-radius:8px;border:1px solid var(--line)">' +
        '<button data-i="' + i + '" style="position:absolute;top:-6px;right:-6px;border:none;background:var(--bad);color:#fff;border-radius:999px;width:20px;height:20px;font-size:11px;cursor:pointer">✕</button></span>';
    }).join('');
    $('eImgs').querySelectorAll('button').forEach(function (b) {
      b.onclick = function () { images.splice(Number(b.dataset.i), 1); paintImgs(); };
    });
  }
  paintImgs();
  $('eFile').onchange = function () {
    Array.prototype.slice.call(this.files).forEach(function (f) {
      if (f.size > 4 * 1024 * 1024) { $('mErr').textContent = f.name + ' is over 4MB'; return; }
      var rd = new FileReader();
      rd.onload = function () {
        $('mErr').textContent = 'Uploading ' + f.name + '…';
        api('adminImageUpload', { data: rd.result, filename: f.name, mime: f.type })
          .then(function (res) { images.push(res.url); paintImgs(); $('mErr').textContent = ''; })
          .catch(function (e) { $('mErr').textContent = e.message; });
      };
      rd.readAsDataURL(f);
    });
  };

  if (!isNew) {
    $('eHide').onclick = function () {
      api('adminProductDelete', { sku: p.sku })
        .then(function () { closeDrawer(); toast('Hidden'); loadCatalog(); })
        .catch(function (e) { $('mErr').textContent = e.message; });
    };
  }
  $('eSave').onclick = function () {
    var tiers = draft.tiers.filter(function (t) { return Number(t.min) > 0 && Number(t.price) >= 0; })
      .map(function (t) { return { min: Number(t.min), price: Number(t.price), gst: t.gst === '' ? '' : Number(t.gst) }; })
      .sort(function (a, b) { return a.min - b.min; });
    var moq = Number($('eMoq').value) || 1;
    if (tiers.length && tiers[0].min !== moq) {
      $('mErr').textContent = 'The first tier must start at the MOQ (' + moq + ').';
      return;
    }
    var payload = {
      sku: $('eSku').value.trim(), name: $('eName').value.trim(),
      brand_id: $('eBrand').value, category: $('eCat').value.trim(), subcategory: $('eSub').value.trim(),
      description: $('eDesc').value.trim(),
      specs: $('eSpecs').value.split('\n').map(function (s) { return s.trim(); }).filter(String).join('|'),
      images: images,
      moq: moq, gst_rate: Number($('eGst').value), mrp: Number($('eMrp').value) || '', lead_time: $('eLead').value.trim(),
      on_hand: Number($('eOnHand').value), safety_stock: Number($('eSafety').value),
      reorder_point: Number($('eReorder').value),
      visible: $('eVisible').checked, show_price: $('eShowPrice').checked,
      tiers: tiers
    };
    if (!payload.sku || !payload.name) { $('mErr').textContent = 'SKU and name are required.'; return; }
    $('eSave').disabled = true;
    api('adminProductSave', { product: payload })
      .then(function () { closeDrawer(); toast(payload.sku + ' saved'); loadCatalog(); })
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
    '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>Logo</th><th>Name</th><th class="num">Products</th><th>Active</th><th class="num">Sort</th>' +
    '</tr></thead><tbody id="bRows"></tbody></table></div>';
  $('bNew').onclick = function () { editBrand(null); };
  var tb = $('bRows');
  A.brands.sort(function (a, b) { return a.sort - b.sort; }).forEach(function (b) {
    var count = A.products.filter(function (p) { return p.brand_id === b.id; }).length;
    var tr = document.createElement('tr');
    tr.className = 'click';
    tr.innerHTML =
      '<td>' + (b.logo ? '<img src="' + esc(b.logo) + '" style="width:36px;height:36px;border-radius:999px;object-fit:cover">' :
        '<span style="width:36px;height:36px;border-radius:999px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font-weight:800">' + esc(b.name.charAt(0)) + '</span>') + '</td>' +
      '<td><b>' + esc(b.name) + '</b><br><small style="color:var(--ink-3)">' + esc(b.desc || '') + '</small></td>' +
      '<td class="num">' + count + '</td><td>' + (b.active ? '✓' : '—') + '</td><td class="num">' + b.sort + '</td>';
    tr.onclick = function () { editBrand(b); };
    tb.appendChild(tr);
  });
}

function editBrand(b) {
  var isNew = !b;
  b = b || { id: '', name: '', logo: '', desc: '', active: true, sort: A.brands.length + 1 };
  openDrawer(
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
        .then(function () { closeDrawer(); toast('Deleted'); loadCatalog(); })
        .catch(function (e) { $('mErr').textContent = e.message; });
    };
  }
  $('bSave').onclick = function () {
    api('adminBrandSave', { brand: { id: b.id, name: $('bName').value.trim(), desc: $('bDesc').value.trim(), logo: logo, sort: Number($('bSort').value), active: $('bActive').checked } })
      .then(function () { closeDrawer(); toast('Brand saved'); loadCatalog(); })
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
    '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
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
  openDrawer(
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
      .then(function () { closeDrawer(); toast('User saved'); loadUsers(); })
      .catch(function (e) { $('mErr').textContent = e.message; });
  };
}

/* ================= ANALYTICS (RSM-style) ================= */
function loadAnalytics() {
  A.loaded.analytics = true;
  $('p-analytics').innerHTML = '<div class="spin"></div>';
  var ensureCatalog = A.products.length ? Promise.resolve() : api('adminCatalog').then(function (res) {
    A.products = res.products; A.brands = res.brands;
  });
  ensureCatalog.then(function () {
    return api('adminAnalytics', { days: A.days });
  }).then(function (res) {
    A.analytics = res;
    renderAnalytics();
  }).catch(function (e) { $('p-analytics').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
}

function section(title, note) {
  return '<div class="section-head"><h2>' + title + '</h2>' +
    (note ? '<div class="note-sub">' + note + '</div>' : '') + '</div>';
}
function card2(title, body, note) {
  return '<div class="panel2"><h3>' + title + '</h3>' +
    (note ? '<p class="note-sub">' + note + '</p>' : '') + body + '</div>';
}
function barList(rows, fmt) {
  if (!rows || !rows.length) return '<div class="empty" style="padding:18px 0">Nothing yet</div>';
  var max = Math.max.apply(null, rows.map(function (r) { return r.count; }));
  return '<div class="bars">' + rows.map(function (r) {
    return '<div class="brow"><span class="blabel" title="' + esc(r.key) + '">' + esc(r.key) + '</span>' +
      '<span class="bar-track"><span class="bar-fill" style="display:block;width:' + Math.max(2, Math.round(r.count / max * 100)) + '%"></span></span>' +
      '<span class="bval">' + (fmt || qty)(r.count) + '</span></div>';
  }).join('') + '</div>';
}
function productBars(rows, fmt) {
  if (!rows || !rows.length) return '<div class="empty" style="padding:18px 0">Nothing yet</div>';
  var max = Math.max.apply(null, rows.map(function (r) { return r.value !== undefined ? r.value : r.count; }));
  return '<div class="prod-rows">' + rows.map(function (r, i) {
    var v = r.value !== undefined ? r.value : r.count;
    var img = imgOf(r.sku);
    return '<div class="prod-row"><span class="prod-rank">' + (i + 1) + '</span>' +
      (img ? '<img class="prod-img" loading="lazy" src="' + esc(img) + '">' : '<span class="prod-img"></span>') +
      '<span><span class="prod-name">' + esc(r.name) + '</span><span class="prod-sku">' + esc(r.sku) + '</span>' +
        '<span class="bar-track" style="margin-top:5px;display:block"><span class="bar-fill" style="display:block;width:' + Math.max(2, Math.round(v / max * 100)) + '%"></span></span></span>' +
      '<span class="prod-val">' + fmt(v) + '</span></div>';
  }).join('') + '</div>';
}
function statusBars(byStatus) {
  var rows = Object.keys(byStatus).map(function (k) { return { key: k, count: byStatus[k] }; })
    .sort(function (a, b) { return b.count - a.count; });
  if (!rows.length) return '<div class="empty" style="padding:18px 0">No requests in this window</div>';
  var total = rows.reduce(function (s, r) { return s + r.count; }, 0);
  return '<div class="bars">' + rows.map(function (r) {
    return '<div class="brow"><span class="blabel">' + esc(r.key) + '</span>' +
      '<span class="bar-track"><span class="bar-fill" style="display:block;width:' + Math.round(r.count / total * 100) + '%"></span></span>' +
      '<span class="bval">' + r.count + ' · ' + Math.round(r.count / total * 100) + '%</span></div>';
  }).join('') + '</div>';
}
function funnelBars(steps) {
  var top = steps[0] ? steps[0].n : 0;
  return '<div class="bars">' + steps.map(function (s, i) {
    var prev = i ? steps[i - 1].n : null;
    return '<div class="brow"><span class="blabel">' + esc(s.step) + '</span>' +
      '<span class="bar-track"><span class="bar-fill" style="display:block;width:' + (top ? Math.max(2, Math.round(s.n / top * 100)) : 2) + '%"></span></span>' +
      '<span class="bval">' + qty(s.n) + (prev ? ' · ' + Math.round(s.n / prev * 100) + '%' : '') + '</span></div>';
  }).join('') + '</div>';
}
function sparkline(weeks, pick, title, fmt) {
  if (!weeks || weeks.length < 2) return '<div class="empty" style="padding:12px 0">Not enough weeks yet to draw a trend</div>';
  var w = 460, h = 86, pad = 6;
  var vals = weeks.map(pick);
  var max = Math.max.apply(null, [1].concat(vals));
  var step = (w - pad * 2) / (weeks.length - 1);
  function pt(i) { return [pad + i * step, h - pad - (vals[i] / max) * (h - pad * 2)]; }
  var line = vals.map(function (_, i) { return pt(i).join(','); }).join(' ');
  var area = pad + ',' + (h - pad) + ' ' + line + ' ' + (w - pad) + ',' + (h - pad);
  var lastPt = pt(vals.length - 1);
  return '<div style="margin-bottom:14px">' +
    '<div class="row-between"><span style="font-size:12.5px;color:var(--ink-3);font-weight:600">' + title + '</span>' +
    '<strong>' + fmt(vals[vals.length - 1]) + '</strong></div>' +
    '<svg viewBox="0 0 ' + w + ' ' + h + '" class="spark" preserveAspectRatio="none">' +
    '<polygon points="' + area + '" fill="rgba(36,71,245,.10)"></polygon>' +
    '<polyline points="' + line + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>' +
    '<circle cx="' + lastPt[0] + '" cy="' + lastPt[1] + '" r="4" fill="var(--accent)" stroke="#fff" stroke-width="2"></circle></svg>' +
    '<div class="row-between" style="font-size:12px;color:var(--ink-3)"><span>' + esc(weeks[0].week) + '</span><span>' + esc(weeks[weeks.length - 1].week) + '</span></div></div>';
}

function renderAnalytics() {
  var D = A.analytics;
  var r = D.requests, d = D.decision, t = D.traffic, pr = D.products;
  $('p-analytics').innerHTML =
    '<div class="panel-head"><h2>Analytics</h2>' +
      '<span style="color:var(--ink-3);font-size:13px;font-weight:600">Last ' + D.days + ' days · generated ' + esc(D.generated_at) + '</span>' +
      '<span class="sp"></span><div class="chips" style="margin:0" id="rangeChips">' +
      [[30, '30 days'], [90, '90 days'], [180, '6 months'], [365, '1 year']].map(function (x) {
        return '<button class="chip' + (A.days === x[0] ? ' on' : '') + '" data-d="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div></div>' +

    section('Requests', 'Every request raised through the storefront in this window.') +
    '<div class="stat-row">' +
      stat(qty(r.count), 'Requests') +
      stat(inr(r.value), 'Request value') +
      stat(inr(r.average), 'Average request') +
      stat(d.conversion_rate === null ? '—' : d.conversion_rate + '%', 'Conversion (decided)') +
      stat(d.median_hours_to_quote === null ? '—' : d.median_hours_to_quote + ' h', 'Median time to quote') +
      stat(d.median_days_to_close === null ? '—' : d.median_days_to_close + ' d', 'Median days to close') +
    '</div>' +
    (d.awaiting_over_3_days
      ? '<div class="note2 warn"><strong>' + d.awaiting_over_3_days + ' request' + (d.awaiting_over_3_days === 1 ? '' : 's') +
        ' waiting more than 3 days for a first response.</strong> ' + d.awaiting + ' awaiting review in total.</div>'
      : '') +
    '<div class="an-two">' +
      card2('Request outcome', statusBars(r.by_status)) +
      card2('Requests and value by week',
        sparkline(D.trend, function (w) { return w.requests; }, 'Requests per week', qty) +
        sparkline(D.trend, function (w) { return w.value; }, 'Request value per week', inr)) +
    '</div>' +

    section('Products', 'What buyers actually ask for, by units and by value.') +
    '<div class="an-two">' +
      card2('Top requested by units', productBars(pr.top_by_units, qty)) +
      card2('Top requested by value', productBars(pr.top_by_value, inr)) +
    '</div>' +
    card2('Never requested · ' + pr.never_requested_total + ' of ' + pr.catalogue_size + ' products',
      pr.never_requested.length
        ? '<div style="max-height:300px;overflow:auto"><table class="tbl"><thead><tr><th>SKU</th><th>Product</th><th>Category</th><th class="num">MOQ</th></tr></thead><tbody>' +
          pr.never_requested.map(function (x) {
            return '<tr><td>' + esc(x.sku) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.category) + '</td><td class="num">' + x.moq + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<div class="empty" style="padding:14px 0">Every visible product has been requested at least once.</div>',
      'A product nobody requests is wrong for the audience, priced past them, or has an unreachable MOQ.') +

    section('Traffic', 'Behaviour on the storefront, recorded from the day it shipped.') +
    '<div class="stat-row">' +
      stat(qty(t.product_views), 'Product views') +
      stat(qty(t.add_to_list), 'Added to list') +
      stat(qty(t.requests_submitted), 'Requests submitted') +
    '</div>' +
    '<div class="an-two">' +
      card2('From view to confirmed order', funnelBars(t.funnel)) +
      card2('Most viewed products', productBars(t.top_viewed, qty)) +
    '</div>' +
    (t.searches_with_nothing.length
      ? card2('Searched for, found nothing', barList(t.searches_with_nothing),
          'The most useful list here: buyers asking the catalog for products it does not carry.')
      : '') +
    (t.top_searches.length ? card2('Top searches', barList(t.top_searches)) : '');

  $('rangeChips').querySelectorAll('.chip').forEach(function (b) {
    b.onclick = function () { A.days = Number(b.dataset.d); loadAnalytics(); };
  });
}

/* ================= SETTINGS + STOCK SYNC ================= */
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
        '<div class="field"><label>Sender name on notifications</label><input id="sFromName" value="' + esc(s.mail_from_name) + '" placeholder="' + esc(s.site_name) + '"></div>' +
      '</div>' +
    '</div>' +
    '<div class="form-err" id="sErr"></div>' +
    '<button class="btn primary" id="sSave" style="margin:14px 0 10px">Save settings</button>' +
    renderMailCard(s) + renderSyncCard(s);

  $('sSave').onclick = function () {
    $('sSave').disabled = true;
    api('adminSettings', { save: {
      site_name: $('sName').value.trim(), tagline: $('sTag').value.trim(),
      access_mode: $('sMode').value, show_stock_numbers: $('sStock').value,
      notify_email: $('sNotify').value.trim(), low_stock_threshold: $('sLow').value,
      mail_from_name: $('sFromName').value.trim()
    } }).then(function (res) {
      A.settings = res.settings;
      $('sSave').disabled = false;
      toast('Settings saved — live on the storefront now');
    }).catch(function (e) { $('sErr').textContent = e.message; $('sSave').disabled = false; });
  };
  wireMailCard();
  wireSyncCard();
}

/* Where notification email is sent from: our account, or the supplier's. */
function renderMailCard(s) {
  var relay = s.mail_mode === 'relay';
  var st = A.relayStatus;
  var stTxt = !st ? 'No relay send recorded yet.'
    : st.ok
      ? 'Last relay send ' + esc(String(st.ts).slice(4, 21)) + ' — delivered' +
        (st.remaining === null || st.remaining === undefined ? '' : ' · ' + st.remaining + ' left in their daily quota today')
      : '<span style="color:var(--bad)">Last relay send failed: ' + esc(st.error || '') + '</span> — that message went out from the Merchforce account instead.';
  return section('Notification email',
      'Who the supplier\'s notifications appear to come from. Sending through their own account needs a small relay script in their Google account — no password or token is shared with us.') +
    '<div class="panel2">' +
      '<div class="field"><label>Send from</label><select id="wMode">' +
        '<option value="backend"' + (relay ? '' : ' selected') + '>The Merchforce account (replies go to the buyer)</option>' +
        '<option value="relay"' + (relay ? ' selected' : '') + '>The supplier\'s own address (via their relay)</option>' +
      '</select></div>' +
      '<div id="wRelayBox"' + (relay ? '' : ' hidden') + '>' +
        '<div class="field"><label>Relay web-app URL</label><input id="wUrl" value="' + esc(s.relay_url) + '" placeholder="https://script.google.com/macros/s/…/exec"></div>' +
        '<div class="field"><label>Shared secret</label>' +
          '<div style="display:flex;gap:8px"><input id="wSecret" value="' + esc(s.relay_secret) + '" placeholder="click Generate">' +
          '<button class="btn small" id="wGen" style="flex:none">Generate</button></div></div>' +
        '<p class="note" style="margin:0 0 10px">' + esc(stTxt).replace(/&lt;/g, '<').replace(/&gt;/g, '>') + '</p>' +
      '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
        '<button class="btn primary small" id="wSave">Save mail settings</button>' +
        '<button class="btn small" id="wScript">Get relay script</button>' +
        '<button class="btn small" id="wTest">Send test email</button>' +
        '<span id="wOut" style="font-size:13px;color:var(--ink-3)"></span>' +
      '</div>' +
    '</div>';
}

function wireMailCard() {
  $('wMode').onchange = function () { $('wRelayBox').hidden = this.value !== 'relay'; };
  $('wGen').onclick = function () {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    $('wSecret').value = 'mfr_' + Array.prototype.map.call(a, function (x) {
      return ('0' + x.toString(16)).slice(-2);
    }).join('');
  };
  $('wSave').onclick = function () {
    if ($('wMode').value === 'relay' && (!$('wUrl').value.trim() || !$('wSecret').value.trim())) {
      $('wOut').innerHTML = '<span style="color:var(--bad)">Relay needs both the URL and the secret.</span>';
      return;
    }
    $('wSave').disabled = true;
    api('adminSettings', { save: {
      mail_mode: $('wMode').value,
      relay_url: $('wUrl') ? $('wUrl').value.trim() : '',
      relay_secret: $('wSecret') ? $('wSecret').value.trim() : ''
    } }).then(function (res) {
      A.settings = res.settings;
      A.relayStatus = res.relay_status || null;
      $('wSave').disabled = false;
      toast('Mail settings saved');
      renderSettings();
    }).catch(function (e) { $('wOut').textContent = e.message; $('wSave').disabled = false; });
  };
  $('wTest').onclick = function () {
    $('wOut').textContent = 'Sending…';
    api('adminMailTest', {}).then(function (res) {
      A.relayStatus = res.status || A.relayStatus;
      $('wOut').innerHTML = 'Sent to ' + esc(res.to) + ' via <b>' + esc(res.via) + '</b>';
    }).catch(function (e) { $('wOut').innerHTML = '<span style="color:var(--bad)">' + esc(e.message) + '</span>'; });
  };
  $('wScript').onclick = openRelayScript;
}

/* The relay: a standalone Apps Script the supplier deploys in their own account. */
function openRelayScript() {
  var secret = ($('wSecret') && $('wSecret').value.trim()) || '(click Generate first)';
  var code =
"/** Merchforce mail relay — sends Merchforce notifications from THIS account. */\n" +
"var RELAY_SECRET = '" + secret + "';\n" +
"\n" +
"function doPost(e) {\n" +
"  var reply = function (o) {\n" +
"    return ContentService.createTextOutput(JSON.stringify(o))\n" +
"      .setMimeType(ContentService.MimeType.JSON);\n" +
"  };\n" +
"  var p;\n" +
"  try { p = JSON.parse(e.postData.contents); }\n" +
"  catch (err) { return reply({ ok: false, error: 'Bad JSON' }); }\n" +
"  if (String(p.secret) !== RELAY_SECRET) return reply({ ok: false, error: 'Bad secret' });\n" +
"  if (!p.to || !p.subject) return reply({ ok: false, error: 'to and subject required' });\n" +
"  try {\n" +
"    MailApp.sendEmail({\n" +
"      to: String(p.to),\n" +
"      subject: String(p.subject),\n" +
"      body: String(p.body || ''),\n" +
"      name: p.name ? String(p.name) : undefined,\n" +
"      replyTo: p.replyTo ? String(p.replyTo) : undefined\n" +
"    });\n" +
"    return reply({ ok: true, remaining: MailApp.getRemainingDailyQuota() });\n" +
"  } catch (err) {\n" +
"    return reply({ ok: false, error: String(err) });\n" +
"  }\n" +
"}";
  openDrawer(
    '<h2 style="margin:0 0 4px">Mail relay — send from the supplier\'s own address</h2>' +
    '<p class="note" style="margin:0 0 14px">This script lives in the <b>supplier\'s</b> Google account. Merchforce posts the message to it and their account does the sending, so the mail leaves their address on their own quota (100 recipients a day on a personal Gmail, 1,500 on Workspace). No password or token of theirs is shared with us, and deleting the deployment revokes it instantly.</p>' +
    '<ol style="margin:0 0 14px;padding-left:20px;font-size:14px;line-height:1.7">' +
      '<li>They open <b>script.google.com</b> → <b>New project</b> and paste the script below.</li>' +
      '<li><b>Deploy → New deployment → Web app</b>; "Execute as" <b>Me</b>, "Who has access" <b>Anyone</b>, then authorize.</li>' +
      '<li>They send you the <b>/exec</b> URL; paste it into the Relay web-app URL field with this same secret.</li>' +
      '<li>Hit <b>Send test email</b> to confirm it arrives from their address.</li>' +
    '</ol>' +
    '<p class="note">"Anyone" access is needed so our server can reach it — the shared secret is what authorizes each message, and the script can only send mail, nothing else. If the relay ever fails, Merchforce falls back to sending from its own account so nothing is lost.</p>' +
    '<textarea id="lsCode" readonly style="width:100%;height:300px;font-family:ui-monospace,monospace;font-size:12px;border:1px solid var(--line);border-radius:10px;padding:12px;white-space:pre"></textarea>' +
    '<button class="btn primary" id="lsCopy" style="width:100%;justify-content:center;margin-top:10px">Copy script</button>');
  $('lsCode').value = code;
  $('lsCopy').onclick = function () {
    $('lsCode').select();
    try { navigator.clipboard.writeText(code); } catch (e) { document.execCommand('copy'); }
    toast('Copied — the supplier pastes this into a new Apps Script project');
  };
}

var SYNC_FIELDS = [
  ['on_hand', 'Stock (on hand)'],
  ['price', 'Selling price (first tier)'],
  ['mrp', 'MRP'],
  ['moq', 'MOQ'],
  ['gst_rate', 'GST %'],
  ['name', 'Product name'],
  ['lead_time', 'Lead time'],
  ['description', 'Description'],
  ['category', 'Category'],
  ['subcategory', 'Subcategory']
];
function syncFieldLabel(f) {
  var hit = SYNC_FIELDS.filter(function (x) { return x[0] === f; })[0];
  return hit ? hit[1] : f;
}
function mapFieldsOf(m) {
  if (m.fields && m.fields.length) return m.fields;
  if (m.stock_col) return [{ col: m.stock_col, field: 'on_hand' }];
  return [];
}
/* A mapping can draw fields from several tabs of one workbook. */
function mapSourcesOf(m) {
  if (m.sources && m.sources.length) {
    return m.sources.filter(function (s) { return s.sku_col && (s.fields || []).length; });
  }
  var f = mapFieldsOf(m);
  if (!f.length || !m.sku_col) return [];
  return [{ tab: m.tab || '', sku_col: m.sku_col, fields: f }];
}

function renderSyncCard(s) {
  var maps = [];
  try { maps = JSON.parse(s.sync_maps || '[]'); } catch (e) {}
  var rows = maps.map(function (m, i) {
    var last = m.last;
    var lastTxt = !last ? '—'
      : last.error ? '<span style="color:var(--bad)">' + esc(last.error).slice(0, 60) + '</span>'
      : esc(String(last.ts).slice(4, 21)) + ' · ' + last.updated + ' updated' +
        (last.created ? ', ' + last.created + ' created' : '') +
        (last.unknown ? ', ' + last.unknown + ' unknown' : '') +
        (last.off_brand ? ', ' + last.off_brand + ' off-brand' : '');
    var srcs = mapSourcesOf(m);
    var fieldsTxt = srcs.map(function (src) {
      return '<b>' + esc(src.tab || 'first tab') + '</b> · ' + esc(src.sku_col) + ' → SKU<br>' +
        src.fields.map(function (f) {
          return '&nbsp;&nbsp;' + esc(f.col) + ' → ' + esc(syncFieldLabel(f.field));
        }).join('<br>');
    }).join('<br>');
    var push = m.mode === 'push';
    var mapped = srcs.length;
    return '<tr><td><b>' + esc(m.brand ? brandNameSafe(m.brand) : 'All brands') + '</b>' +
      '<br><span class="pill" style="font-size:10.5px;' + (push
        ? 'background:#f1e8ff;color:#7a3cf0">sheet pushes to us'
        : 'background:var(--accent-soft);color:var(--accent)">we read the sheet') + '</span>' +
      (m.create_new ? ' <span class="pill" style="background:var(--ok-soft);color:var(--ok);font-size:10.5px">auto-creates new</span>' : '') + '</td>' +
      '<td style="font-size:12px;color:var(--ink-3)">' +
        (push ? (mapped ? srcs.length + ' tab' + (srcs.length === 1 ? '' : 's') : 'sheet') + '<br>(private to supplier)'
              : '…' + esc(String(m.sheet).slice(-8))) + '</td>' +
      '<td style="font-size:12.5px">' + (mapped
        ? fieldsTxt
        : '<span style="color:var(--warn);font-weight:700">' + ((m.tabs_meta || m.headers) ? 'columns received — map them' : 'awaiting first push') + '</span>') + '</td>' +
      '<td style="font-size:12.5px">' + lastTxt + '</td>' +
      '<td style="white-space:nowrap">' +
      (push ? '<button class="btn small" data-conn="' + i + '">Connector</button> '
            : '<button class="btn small" data-sync="' + i + '">Sync</button> ') +
      '<button class="btn ghost small" data-edit="' + i + '">Edit</button> ' +
      '<button class="btn ghost small" data-del="' + i + '" style="color:var(--bad)">✕</button></td></tr>';
  }).join('');
  return section('Sheet sync — per brand',
      'The supplier keeps managing their catalog in their own Google Sheets, one per brand (like the Wenger stock sheet). ' +
      'Map any sheet column to any product field; a brand mapping only ever touches that brand\'s products.') +
    '<div class="panel2">' +
      (maps.length
        ? '<div class="tbl-wrap" style="margin-bottom:14px"><table class="tbl"><thead><tr>' +
          '<th>Brand</th><th>Sheet</th><th>Mapping</th><th>Last sync</th><th></th>' +
          '</tr></thead><tbody id="yRows">' + rows + '</tbody></table></div>'
        : '<p class="note">No sheets linked yet. Add the first brand mapping, or generate a ready-made template the supplier can copy and maintain.</p>') +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
        '<button class="btn primary small" id="yAdd">+ Add brand mapping</button>' +
        (maps.length > 1 ? '<button class="btn small" id="ySyncAll">Sync all now</button>' : '') +
        '<button class="btn small" id="yTemplate">Generate template sheet</button>' +
        '<button class="btn small" id="yLive">⚡ Instant sync setup</button>' +
        '<label style="display:flex;gap:8px;align-items:center;font-weight:700;font-size:13.5px;margin-left:auto">Auto-sync' +
          '<select id="yAuto" style="padding:6px 10px;border:1px solid var(--line);border-radius:8px">' +
            '<option value="off"' + (s.sync_auto === 'off' || !s.sync_auto ? ' selected' : '') + '>Off — manual only</option>' +
            '<option value="live5"' + (s.sync_auto === 'live5' ? ' selected' : '') + '>Near-live (every 5 min)</option>' +
            '<option value="hourly"' + (s.sync_auto === 'hourly' ? ' selected' : '') + '>Every hour</option>' +
            '<option value="daily"' + (s.sync_auto === 'daily' ? ' selected' : '') + '>Daily (~6 am)</option>' +
          '</select></label>' +
      '</div>' +
      '<p class="note" id="yTplOut" style="margin-top:10px"></p>' +
    '</div>';
}

function brandNameSafe(id) {
  var b = A.brands.filter(function (x) { return x.id === id; })[0];
  return b ? b.name : id;
}

function refreshSettings_() {
  return api('adminSettings', {}).then(function (res) {
    A.settings = res.settings;
    A.relayStatus = res.relay_status || A.relayStatus;
    renderSettings();
  });
}

function wireSyncCard() {
  var ensureBrands = A.brands.length ? Promise.resolve() : api('adminCatalog').then(function (res) {
    A.products = res.products; A.brands = res.brands;
  });

  $('yAdd').onclick = function () {
    ensureBrands.then(function () { openMapEditor(null, null); });
  };
  var syncAll = $('ySyncAll');
  if (syncAll) {
    syncAll.onclick = function () {
      syncAll.disabled = true; syncAll.textContent = 'Syncing…';
      api('adminSyncRun', {}).then(function (res) {
        var tot = res.results.reduce(function (s, r) { return s + (r.summary.updated || 0) + (r.summary.created || 0); }, 0);
        toast(tot + ' products touched across ' + res.results.length + ' sheets');
        return refreshSettings_();
      }).catch(function (e) { toast(e.message); syncAll.disabled = false; syncAll.textContent = 'Sync all now'; });
    };
  }
  $('yTemplate').onclick = function () {
    $('yTemplate').disabled = true;
    $('yTplOut').textContent = 'Building the template sheet…';
    api('adminSyncTemplate', {}).then(function (res) {
      $('yTemplate').disabled = false;
      $('yTplOut').innerHTML = 'Template ready: <a href="' + esc(res.url) + '" target="_blank">' + esc(res.name) + ' ↗</a> — one tab per brand, in the supplier\'s format (Code · Product Name · MRP · Selling Price Excluding GST · Stock). Ask the supplier to File → Make a copy and maintain theirs.';
    }).catch(function (e) { $('yTemplate').disabled = false; $('yTplOut').textContent = e.message; });
  };
  $('yLive').onclick = openLiveSyncHelp;
  var auto = $('yAuto');
  if (auto) {
    auto.onchange = function () {
      var prev = A.settings.sync_auto || 'off';
      api('adminSyncSchedule', { mode: auto.value })
        .then(function (res) {
          A.settings.sync_auto = res.mode;
          var msg = { off: 'Auto-sync off', live5: 'Near-live — pulls every 5 minutes',
                      hourly: 'Auto-sync every hour', daily: 'Auto-sync daily around 6 am' };
          toast(msg[res.mode]);
        })
        .catch(function (e) { toast(e.message); auto.value = prev; });
    };
  }
  var tb = $('yRows');
  if (tb) {
    tb.querySelectorAll('button[data-sync]').forEach(function (b) {
      b.onclick = function () {
        b.disabled = true; b.textContent = '…';
        api('adminSyncRun', { index: Number(b.dataset.sync) }).then(function (res) {
          var s = res.results[0].summary;
          toast(s.error ? s.error : s.updated + ' updated, ' + s.created + ' created, ' + s.unknown + ' unknown');
          return refreshSettings_();
        }).catch(function (e) { toast(e.message); b.disabled = false; b.textContent = 'Sync'; });
      };
    });
    tb.querySelectorAll('button[data-conn]').forEach(function (b) {
      b.onclick = function () {
        var maps = JSON.parse(A.settings.sync_maps || '[]');
        openPushConnector(maps[Number(b.dataset.conn)]);
      };
    });
    tb.querySelectorAll('button[data-edit]').forEach(function (b) {
      b.onclick = function () {
        var maps = JSON.parse(A.settings.sync_maps || '[]');
        ensureBrands.then(function () { openMapEditor(maps[Number(b.dataset.edit)], Number(b.dataset.edit)); });
      };
    });
    tb.querySelectorAll('button[data-del]').forEach(function (b) {
      b.onclick = function () {
        api('adminSyncMapDelete', { index: Number(b.dataset.del) })
          .then(refreshSettings_).catch(function (e) { toast(e.message); });
      };
    });
  }
}

/* Add/edit one brand→sheet mapping.
   Modes: pull (Merchforce reads the sheet) | push (the sheet sends to us).
   A mapping may draw fields from several TABS of the same workbook, each with
   its own SKU column — stock from one tab, prices and names from another. */
function openMapEditor(m, index) {
  var isNew = !m;
  m = m || { mode: 'pull', brand: '', sheet: '', tab: '', sku_col: '', fields: [], sources: [], create_new: false };
  var mode = m.mode === 'push' ? 'push' : 'pull';
  var draft = { sources: JSON.parse(JSON.stringify(mapSourcesOf(m))) };
  if (!draft.sources.length) draft.sources = [{ tab: m.tab || '', sku_col: '', fields: [{ col: '', field: 'on_hand' }] }];
  // What we know about the workbook: pull → after Load sheet; push → after the
  // supplier's first push. Either way: [{name, headers, sample, rows}].
  var tabsMeta = m.tabs_meta || (m.headers ? [{ name: m.tab || '', headers: m.headers, sample: m.sample || [], rows: 0 }] : null);

  openDrawer(
    '<h2 style="margin:0 0 4px">' + (isNew ? 'Link a brand sheet' : 'Edit mapping') + '</h2>' +
    '<div class="field"><label>How the data moves</label><select id="zMode">' +
      '<option value="pull"' + (mode === 'pull' ? ' selected' : '') + '>Merchforce reads the sheet — supplier shares it (Viewer)</option>' +
      '<option value="push"' + (mode === 'push' ? ' selected' : '') + '>The sheet sends to Merchforce — nothing shared, stays private</option>' +
    '</select></div>' +
    '<p class="note" id="zModeNote" style="margin:-4px 0 14px"></p>' +
    '<div class="field"><label>Brand</label><select id="zBrand">' +
      '<option value=""' + (m.brand ? '' : ' selected') + '>All brands (no restriction)</option>' +
      A.brands.map(function (b) {
        return '<option value="' + esc(b.id) + '"' + (b.id === m.brand ? ' selected' : '') + '>' + esc(b.name) + '</option>';
      }).join('') + '</select></div>' +
    '<div id="zPullBox">' +
      '<div class="field"><label>Sheet link or ID *</label><input id="zSheet" value="' + esc(m.sheet) + '" placeholder="https://docs.google.com/spreadsheets/d/…"></div>' +
      '<button class="btn small" id="zLoad">Load sheet</button> ' +
      '<span id="zStatus" style="font-size:13px;color:var(--ink-3)"></span>' +
    '</div>' +
    '<div id="zMap" style="margin-top:16px"></div>' +
    '<label style="display:flex;gap:8px;align-items:center;font-weight:700;font-size:13.5px;margin-top:14px">' +
      '<input type="checkbox" id="zCreate"' + (m.create_new ? ' checked' : '') + '> Auto-create products for new SKUs in this sheet' +
    '</label>' +
    '<p class="note" style="margin:4px 0 0">New products are created hidden (not on the storefront) under this mapping\'s brand, so you can review and publish them from the Catalog tab. Needs a specific brand selected.</p>' +
    '<div class="form-err" id="mErr"></div>' +
    '<button class="btn primary" id="zSave" style="width:100%;justify-content:center;margin-top:10px">Save mapping</button>');

  function tabNames() { return (tabsMeta || []).map(function (t) { return t.name; }); }
  function headersFor(tab) {
    if (!tabsMeta) return null;
    var hit = tabsMeta.filter(function (t) { return t.name === tab; })[0] || (tab ? null : tabsMeta[0]);
    return hit ? hit.headers : null;
  }
  function sampleFor(tab) {
    if (!tabsMeta) return null;
    var hit = tabsMeta.filter(function (t) { return t.name === tab; })[0] || (tab ? null : tabsMeta[0]);
    return hit ? { headers: hit.headers, sample: hit.sample || [], rows: hit.rows } : null;
  }
  function colField(attr, tab, val) {
    var hs = headersFor(tab);
    if (!hs) return '<input ' + attr + ' value="' + esc(val || '') + '" placeholder="Column header" style="padding:7px 9px;border:1px solid var(--line);border-radius:8px;width:180px">';
    return '<select ' + attr + ' style="padding:7px 9px;border:1px solid var(--line);border-radius:8px;max-width:200px"><option value="">—</option>' +
      hs.map(function (h) { return '<option' + (h === val ? ' selected' : '') + '>' + esc(h) + '</option>'; }).join('') + '</select>';
  }

  function paintMap() {
    var box = $('zMap');
    var waiting = ($('zMode').value === 'push' && !tabsMeta);
    var html = '';
    if (waiting) {
      html += '<div class="note2">Save this mapping first and install the connector on the supplier\'s sheet — every tab and column it finds appears here automatically, then you map them. You can also type them now if you already know them.</div>';
    }
    html += '<label style="font-size:12.5px;font-weight:700;color:var(--ink-2)">Where the data comes from</label>' +
      '<p class="note" style="margin:2px 0 10px">One block per tab. Fields can come from different tabs of the same workbook — they are joined on each tab\'s SKU column.</p>';

    draft.sources.forEach(function (src, si) {
      var s = sampleFor(src.tab);
      html += '<div class="panel2" style="padding:14px 16px;margin-bottom:10px">' +
        '<div class="tier-row" style="margin-bottom:10px">' +
          'Tab ' + (tabsMeta
            ? '<select data-zt="' + si + '" style="padding:7px 9px;border:1px solid var(--line);border-radius:8px;max-width:200px">' +
              tabNames().map(function (n) {
                return '<option' + (n === src.tab ? ' selected' : '') + '>' + esc(n) + '</option>';
              }).join('') + '</select>'
            : '<input data-zt="' + si + '" value="' + esc(src.tab) + '" placeholder="Tab name (blank = first)" style="padding:7px 9px;border:1px solid var(--line);border-radius:8px;width:180px">') +
          ' &nbsp;SKU column ' + colField('data-zs="' + si + '"', src.tab, src.sku_col) +
          (draft.sources.length > 1
            ? ' <button type="button" class="btn ghost small" data-zsrm="' + si + '" style="color:var(--bad);margin-left:auto">Remove tab</button>' : '') +
        '</div>';
      src.fields.forEach(function (f, fi) {
        html += '<div class="tier-row">' + colField('data-zc="' + si + '.' + fi + '"', src.tab, f.col) +
          ' → <select data-zf="' + si + '.' + fi + '" style="padding:7px 9px;border:1px solid var(--line);border-radius:8px">' +
          SYNC_FIELDS.map(function (x) {
            return '<option value="' + x[0] + '"' + (x[0] === f.field ? ' selected' : '') + '>' + x[1] + '</option>';
          }).join('') + '</select>' +
          ' <button type="button" class="btn ghost small" data-zrm="' + si + '.' + fi + '"' + (src.fields.length === 1 ? ' disabled' : '') + '>✕</button></div>';
      });
      html += '<button type="button" class="btn small" data-zadd="' + si + '">+ Map another field from this tab</button>';
      if (s && s.sample.length) {
        html += '<div class="tbl-wrap" style="max-height:130px;overflow:auto;margin-top:10px"><table class="tbl"><thead><tr>' +
          s.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          s.sample.map(function (row) {
            return '<tr>' + row.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>';
      }
      html += '</div>';
    });
    html += '<button type="button" class="btn small" id="zAddTab">+ Add a tab</button>';
    box.innerHTML = html;

    box.querySelectorAll('[data-zt]').forEach(function (elx) {
      elx.onchange = function () {
        var src = draft.sources[Number(elx.dataset.zt)];
        src.tab = elx.value;
        src.sku_col = '';
        src.fields.forEach(function (f) { f.col = ''; });
        guessSource(src);
        paintMap();
      };
    });
    box.querySelectorAll('[data-zs]').forEach(function (elx) {
      elx.onchange = function () { draft.sources[Number(elx.dataset.zs)].sku_col = elx.value; };
    });
    box.querySelectorAll('[data-zc]').forEach(function (elx) {
      elx.onchange = function () {
        var p = elx.dataset.zc.split('.');
        draft.sources[Number(p[0])].fields[Number(p[1])].col = elx.value;
      };
    });
    box.querySelectorAll('select[data-zf]').forEach(function (elx) {
      elx.onchange = function () {
        var p = elx.dataset.zf.split('.');
        draft.sources[Number(p[0])].fields[Number(p[1])].field = elx.value;
      };
    });
    box.querySelectorAll('button[data-zrm]').forEach(function (b) {
      b.onclick = function () {
        var p = b.dataset.zrm.split('.');
        draft.sources[Number(p[0])].fields.splice(Number(p[1]), 1);
        paintMap();
      };
    });
    box.querySelectorAll('button[data-zsrm]').forEach(function (b) {
      b.onclick = function () { draft.sources.splice(Number(b.dataset.zsrm), 1); paintMap(); };
    });
    box.querySelectorAll('button[data-zadd]').forEach(function (b) {
      b.onclick = function () {
        var src = draft.sources[Number(b.dataset.zadd)];
        var used = allUsedFields();
        var next = SYNC_FIELDS.filter(function (x) { return used.indexOf(x[0]) < 0; })[0];
        src.fields.push({ col: '', field: next ? next[0] : 'on_hand' });
        paintMap();
      };
    });
    $('zAddTab').onclick = function () {
      var names = tabNames();
      var used = draft.sources.map(function (s2) { return s2.tab; });
      var free = names.filter(function (n) { return used.indexOf(n) < 0; })[0];
      var usedF = allUsedFields();
      var nextF = SYNC_FIELDS.filter(function (x) { return usedF.indexOf(x[0]) < 0; })[0];
      var src = { tab: free !== undefined ? free : '', sku_col: '', fields: [{ col: '', field: nextF ? nextF[0] : 'on_hand' }] };
      guessSource(src);
      draft.sources.push(src);
      paintMap();
    };
  }

  function allUsedFields() {
    var out = [];
    draft.sources.forEach(function (s2) { s2.fields.forEach(function (f) { out.push(f.field); }); });
    return out;
  }

  var GUESS = { on_hand: ['stock', 'qty', 'quantity', 'on hand', 'available'],
                price: ['selling', 'dp ', 'price'], mrp: ['mrp'], name: ['name', 'product'],
                moq: ['moq'], gst_rate: ['gst'], lead_time: ['lead'], description: ['desc'],
                category: ['category'], subcategory: ['subcat'] };
  function guessSource(src) {
    var hs = headersFor(src.tab);
    if (!hs) return;
    var pick = function (cur, words) {
      if (cur) return cur;
      return hs.filter(function (h) {
        return words.some(function (w) { return h.toLowerCase().indexOf(w) >= 0; });
      })[0] || '';
    };
    src.sku_col = pick(src.sku_col, ['sku', 'code', 'item']);
    src.fields.forEach(function (f) { f.col = pick(f.col, GUESS[f.field] || []); });
  }

  function paintMode() {
    var push = $('zMode').value === 'push';
    $('zPullBox').hidden = push;
    $('zModeNote').innerHTML = push
      ? 'For suppliers who will not share their file. A small connector runs on <b>their</b> sheet and sends only the columns you map here — Merchforce never opens the file. You get the connector script right after saving.'
      : 'Merchforce opens the sheet directly. The supplier shares it with the backend account (Viewer is enough).';
    $('zSave').textContent = push ? 'Save mapping & get connector' : 'Save mapping & sync now';
    paintMap();
  }
  $('zMode').onchange = paintMode;
  if (tabsMeta) draft.sources.forEach(guessSource);
  paintMode();

  $('zLoad').onclick = function () {
    $('zStatus').textContent = 'Opening sheet…';
    api('adminSyncPreview', { sheet: $('zSheet').value.trim(), tab: '' })
      .then(function (res) {
        tabsMeta = (res.all_tabs && res.all_tabs.length)
          ? res.all_tabs
          : [{ name: res.tab, headers: res.headers, sample: res.sample, rows: res.rows }];
        $('zStatus').textContent = tabsMeta.length + ' tab' + (tabsMeta.length === 1 ? '' : 's') + ': ' +
          tabsMeta.map(function (t) { return t.name + ' (' + t.rows + ')'; }).join(', ');
        draft.sources.forEach(function (src) {
          if (!src.tab && tabsMeta.length) src.tab = tabsMeta[0].name;
          guessSource(src);
        });
        paintMap();
      })
      .catch(function (e) { $('zStatus').innerHTML = '<span style="color:var(--bad)">' + esc(e.message) + '</span>'; });
  };

  $('zSave').onclick = function () {
    var push = $('zMode').value === 'push';
    var sources = draft.sources.map(function (s2) {
      return { tab: s2.tab || '', sku_col: s2.sku_col || '',
               fields: (s2.fields || []).filter(function (f) { return f.col; }) };
    }).filter(function (s2) { return s2.sku_col && s2.fields.length; });
    if (!push && !sources.length) {
      $('mErr').textContent = 'Each tab needs its SKU column and at least one field mapping.'; return;
    }
    if (push && !$('zBrand').value) { $('mErr').textContent = 'A push mapping must be bound to one brand.'; return; }
    if ($('zCreate').checked && !$('zBrand').value) { $('mErr').textContent = 'Auto-create needs a specific brand selected.'; return; }
    $('zSave').disabled = true;
    var payload = { map: { mode: push ? 'push' : 'pull', brand: $('zBrand').value,
                           sheet: push ? '' : $('zSheet').value.trim(),
                           tab: sources[0] ? sources[0].tab : '',
                           sku_col: sources[0] ? sources[0].sku_col : '',
                           fields: sources[0] ? sources[0].fields : [],
                           sources: sources, create_new: $('zCreate').checked } };
    if (index !== null && index !== undefined) payload.index = index;
    api('adminSyncMapSave', payload).then(function (res) {
      var idx = (index !== null && index !== undefined) ? index : res.maps.length - 1;
      if (push) {
        A.settings.sync_maps = JSON.stringify(res.maps);
        closeDrawer();
        renderSettings();
        openPushConnector(res.maps[idx]);
        return null;
      }
      return api('adminSyncRun', { index: idx }).then(function (r2) {
        var s2 = r2.results[0].summary;
        toast(s2.error ? s2.error : 'Synced: ' + s2.updated + ' updated, ' + s2.created + ' created, ' + s2.unknown + ' unknown');
        closeDrawer();
        return refreshSettings_();
      });
    }).catch(function (e) { $('mErr').textContent = e.message; $('zSave').disabled = false; });
  };
}

/* The push connector: runs on the supplier's own sheet, sends only mapped columns. */
function openPushConnector(m) {
  var code =
"/** Merchforce connector — this sheet stays private; only the mapped columns are sent. */\n" +
"var MERCHFORCE_URL = '" + CONFIG.API_URL + "';\n" +
"var MERCHFORCE_TOKEN = '" + CONFIG.API_TOKEN + "';\n" +
"var PUSH_KEY = '" + (m.push_key || '') + "';\n" +
"var TABS = [];   // empty = every tab in this sheet; or e.g. ['Stock','Price List']\n" +
"\n" +
"function install() {\n" +
"  ScriptApp.getProjectTriggers().forEach(function (t) {\n" +
"    var f = t.getHandlerFunction();\n" +
"    if (f === 'merchforceOnEdit' || f === 'merchforceHourly') ScriptApp.deleteTrigger(t);\n" +
"  });\n" +
"  ScriptApp.newTrigger('merchforceOnEdit')\n" +
"    .forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();\n" +
"  ScriptApp.newTrigger('merchforceHourly').timeBased().everyHours(1).create();\n" +
"  merchforceSend();\n" +
"}\n" +
"\n" +
"function merchforceOnEdit(e) {\n" +
"  var cache = CacheService.getScriptCache();\n" +
"  if (cache.get('mf_recent')) return;   // at most one send per 30s while editing\n" +
"  cache.put('mf_recent', '1', 30);\n" +
"  merchforceSend();\n" +
"}\n" +
"\n" +
"function merchforceHourly() { merchforceSend(); }\n" +
"\n" +
"function merchforceSend() {\n" +
"  var tabs = [];\n" +
"  SpreadsheetApp.getActive().getSheets().forEach(function (sh) {\n" +
"    if (TABS.length && TABS.indexOf(sh.getName()) < 0) return;\n" +
"    var lr = sh.getLastRow(), lc = sh.getLastColumn();\n" +
"    if (lr < 1 || lc < 1) return;\n" +
"    var values = sh.getRange(1, 1, Math.min(lr, 2001), lc).getValues();\n" +
"    var headers = values.shift();\n" +
"    tabs.push({ name: sh.getName(), headers: headers, rows: values });\n" +
"  });\n" +
"  if (!tabs.length) return;\n" +
"  var res = UrlFetchApp.fetch(MERCHFORCE_URL, {\n" +
"    method: 'post', contentType: 'text/plain', muteHttpExceptions: true,\n" +
"    payload: JSON.stringify({ action: 'syncPush', token: MERCHFORCE_TOKEN,\n" +
"                              push_key: PUSH_KEY, tabs: tabs })\n" +
"  });\n" +
"  Logger.log(res.getContentText());\n" +
"}";
  openDrawer(
    '<h2 style="margin:0 0 4px">Connector for ' + esc(m.brand ? brandNameSafe(m.brand) : 'this sheet') + '</h2>' +
    '<p class="note" style="margin:0 0 14px">The supplier keeps their file entirely private — this script runs inside <b>their</b> sheet, under their own Google account, and sends only the columns mapped here. Merchforce never opens the file and needs no access to it.</p>' +
    '<ol style="margin:0 0 14px;padding-left:20px;font-size:14px;line-height:1.7">' +
      '<li>The supplier opens their sheet → <b>Extensions → Apps Script</b>.</li>' +
      '<li>They replace whatever is in the editor with the script below.</li>' +
      '<li>Save, choose the <b>install</b> function, click <b>Run</b>, approve the authorization (it is their own script, on their own file).</li>' +
      '<li>The first run sends every tab\'s column names here — then map them in this console (fields may come from different tabs).</li>' +
    '</ol>' +
    '<p class="note">After that it sends on every edit (max once per 30 seconds) plus hourly as a safety net. The push key below identifies this mapping — treat it like a password.</p>' +
    '<textarea id="lsCode" readonly style="width:100%;height:300px;font-family:ui-monospace,monospace;font-size:12px;border:1px solid var(--line);border-radius:10px;padding:12px;white-space:pre"></textarea>' +
    '<button class="btn primary" id="lsCopy" style="width:100%;justify-content:center;margin-top:10px">Copy script</button>');
  $('lsCode').value = code;
  $('lsCopy').onclick = function () {
    $('lsCode').select();
    try { navigator.clipboard.writeText(code); } catch (e) { document.execCommand('copy'); }
    toast('Copied — the supplier pastes this into Extensions → Apps Script');
  };
}

/* Instant (edit-triggered) sync: connector script for the supplier's sheet. */
function openLiveSyncHelp() {
  var code =
"/** Merchforce live-sync connector — lives on the supplier's stock sheet. */\n" +
"var MERCHFORCE_URL = '" + CONFIG.API_URL + "';\n" +
"var MERCHFORCE_TOKEN = '" + CONFIG.API_TOKEN + "';\n" +
"\n" +
"function install() {\n" +
"  ScriptApp.getProjectTriggers().forEach(function (t) {\n" +
"    if (t.getHandlerFunction() === 'merchforcePing') ScriptApp.deleteTrigger(t);\n" +
"  });\n" +
"  ScriptApp.newTrigger('merchforcePing')\n" +
"    .forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();\n" +
"}\n" +
"\n" +
"function merchforcePing(e) {\n" +
"  UrlFetchApp.fetch(MERCHFORCE_URL, {\n" +
"    method: 'post', contentType: 'text/plain', muteHttpExceptions: true,\n" +
"    payload: JSON.stringify({ action: 'syncPing', token: MERCHFORCE_TOKEN,\n" +
"                              sheet: SpreadsheetApp.getActive().getId() })\n" +
"  });\n" +
"}";
  openDrawer(
    '<h2 style="margin:0 0 4px">⚡ Instant sync</h2>' +
    '<p class="note" style="margin:0 0 14px">Google Sheets cannot push changes out by itself, so instant sync works by installing this tiny connector ON the supplier\'s sheet. The moment anyone edits a cell, it pings Merchforce and the mapped fields are pulled within seconds (pings are debounced to one per 45 seconds per sheet).</p>' +
    '<ol style="margin:0 0 14px;padding-left:20px;font-size:14px;line-height:1.7">' +
      '<li>Open the supplier\'s stock sheet (anyone with <b>edit</b> access can do this — you or the supplier).</li>' +
      '<li>Menu: <b>Extensions → Apps Script</b>.</li>' +
      '<li>Delete whatever is in the editor and paste the script below.</li>' +
      '<li>Save, pick the <b>install</b> function in the toolbar, click <b>Run</b>, and approve the authorization.</li>' +
    '</ol>' +
    '<p class="note">Done once per sheet. The sheet must already be linked as a mapping here, or pings are ignored. Keep a scheduled auto-sync on as a safety net.</p>' +
    '<textarea id="lsCode" readonly style="width:100%;height:280px;font-family:ui-monospace,monospace;font-size:12px;border:1px solid var(--line);border-radius:10px;padding:12px;white-space:pre"></textarea>' +
    '<button class="btn primary" id="lsCopy" style="width:100%;justify-content:center;margin-top:10px">Copy script</button>');
  $('lsCode').value = code;
  $('lsCopy').onclick = function () {
    $('lsCode').select();
    try { navigator.clipboard.writeText(code); } catch (e) { document.execCommand('copy'); }
    toast('Copied — paste it into Extensions → Apps Script on the sheet');
  };
}

/* ---------- drawer ---------- */
function openDrawer(html) {
  $('mBody').innerHTML = html;
  $('mOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  $('mOverlay').hidden = true;
  document.body.style.overflow = '';
}
$('mClose').onclick = closeDrawer;
$('mOverlay').addEventListener('click', function (e) { if (e.target === this) closeDrawer(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
