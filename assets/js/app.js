/* Merchforce storefront */
'use strict';

var CONFIG = {
  // Set API_URL to the Apps Script /exec URL after deployment.
  API_URL: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? '/api' : 'PASTE_EXEC_URL_HERE',
  API_TOKEN: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'mf-demo-token' : 'PASTE_API_TOKEN_HERE'
};

var S = {
  site: null, brands: [], categories: [], products: [],
  brand: '', cat: '', sub: '', stock: '', sort: '', budget: '', q: '',
  cart: [], session: null, user: null,
  trackQueue: [], viewed: {}
};

/* ---------- api ---------- */
function api(action, body) {
  body = body || {};
  body.action = action;
  body.token = CONFIG.API_TOKEN;
  if (S.session) body.session = S.session;
  return fetch(CONFIG.API_URL, {
    method: 'POST',
    // text/plain avoids a CORS preflight, which Apps Script cannot answer
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow'
  }).then(function (r) { return r.json(); });
}

/* ---------- helpers ---------- */
function $(id) { return document.getElementById(id); }
function el(tag, cls, html) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function inr(n) {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function toast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(function () { t.hidden = true; }, 2600);
}
function badgeHtml(p) {
  var map = { in: 'In stock', low: 'Low stock', out: 'Out of stock' };
  var label = map[p.stock_badge] || '';
  if (p.stock !== null && p.stock !== undefined && p.stock_badge !== 'out') {
    label = p.stock + ' in stock';
  }
  return '<span class="badge ' + p.stock_badge + '">' + label + '</span>';
}
function fromPrice(p) {
  if (!p.show_price || !p.tiers.length) return '';
  var min = p.tiers[p.tiers.length - 1].price;
  return '<span class="price">' + inr(min) + ' <small>/ unit</small></span>';
}
function tierFor(p, qty) {
  var price = p.tiers.length ? p.tiers[0].price : 0;
  p.tiers.forEach(function (t) { if (qty >= t.min) price = t.price; });
  return price;
}
function brandName(id) {
  var b = S.brands.filter(function (x) { return x.id === id; })[0];
  return b ? b.name : id;
}

/* ---------- tracking (batched) ---------- */
function track(sku, type) {
  S.trackQueue.push({ sku: sku, type: type });
  clearTimeout(track._h);
  track._h = setTimeout(flushTrack, 4000);
}
function flushTrack() {
  if (!S.trackQueue.length) return;
  var events = S.trackQueue.splice(0, 50);
  api('track', { events: events }).catch(function () {});
}
window.addEventListener('pagehide', function () {
  if (!S.trackQueue.length) return;
  try {
    navigator.sendBeacon(CONFIG.API_URL, JSON.stringify({
      action: 'track', token: CONFIG.API_TOKEN, events: S.trackQueue
    }));
  } catch (e) {}
});

/* ---------- boot ---------- */
function boot() {
  try { S.session = sessionStorage.getItem('mf_session') || null; } catch (e) {}
  api('site').then(function (res) {
    if (!res.ok) throw new Error(res.error);
    S.site = res.site;
    S.brands = res.brands;
    S.categories = res.categories;
    $('siteName').textContent = res.site.name;
    $('siteName2').textContent = res.site.name;
    document.title = res.site.name + ' — ' + res.site.tagline;
    renderBrandBar();
    renderCatOptions();
    if (res.site.access_mode === 'gated' && !S.session) {
      $('loginOverlay').hidden = false;
      $('grid').innerHTML = '<div class="empty">Sign in to browse the catalog</div>';
      return;
    }
    loadCatalog();
  }).catch(function (e) {
    $('grid').innerHTML = '<div class="empty">Could not reach the catalog. ' + esc(e.message) + '</div>';
  });
}

function loadCatalog() {
  api('catalog').then(function (res) {
    if (!res.ok) {
      if (/Sign-in/.test(res.error || '')) { $('loginOverlay').hidden = false; return; }
      throw new Error(res.error);
    }
    S.products = res.products;
    restoreCart();
    render();
  }).catch(function (e) {
    $('grid').innerHTML = '<div class="empty">Could not load products. ' + esc(e.message) + '</div>';
  });
}

/* ---------- brand bar ---------- */
function renderBrandBar() {
  if (S.brands.length < 2) return; // single brand: no bar
  var bar = $('brandChips');
  bar.innerHTML = '';
  var all = el('button', 'brand-chip' + (S.brand ? '' : ' on'),
    '<span class="brand-dot">✦</span> All brands');
  all.onclick = function () { S.brand = ''; syncBrandBar(); render(); };
  bar.appendChild(all);
  S.brands.forEach(function (b) {
    var icon = b.logo
      ? '<img src="' + esc(b.logo) + '" alt="">'
      : '<span class="brand-dot">' + esc(b.name.charAt(0)) + '</span>';
    var c = el('button', 'brand-chip' + (S.brand === b.id ? ' on' : ''), icon + ' ' + esc(b.name));
    c.dataset.id = b.id;
    c.onclick = function () {
      S.brand = (S.brand === b.id) ? '' : b.id;
      syncBrandBar(); render();
    };
    bar.appendChild(c);
  });
  $('brandbar').hidden = false;
}
function syncBrandBar() {
  var chips = $('brandChips').children;
  for (var i = 0; i < chips.length; i++) {
    var id = chips[i].dataset.id || '';
    chips[i].classList.toggle('on', id === S.brand);
  }
}

function renderCatOptions() {
  var sel = $('fCat');
  S.categories.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c.name; o.textContent = c.name;
    sel.appendChild(o);
  });
}

/* ---------- filtering + grid ---------- */
function filtered() {
  var q = S.q.toLowerCase();
  var list = S.products.filter(function (p) {
    if (S.brand && p.brand !== S.brand) return false;
    if (S.cat && p.category !== S.cat) return false;
    if (S.sub && p.subcategory !== S.sub) return false;
    if (S.stock === 'in' && p.stock_badge === 'out') return false;
    if (S.stock === 'low' && p.stock_badge !== 'low') return false;
    if (S.budget && p.tiers.length && p.tiers[p.tiers.length - 1].price > Number(S.budget)) return false;
    if (q && (p.name + ' ' + p.sku + ' ' + p.category + ' ' + p.subcategory + ' ' + brandName(p.brand))
        .toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  var minP = function (p) { return p.tiers.length ? p.tiers[p.tiers.length - 1].price : 0; };
  if (S.sort === 'price-asc') list.sort(function (a, b) { return minP(a) - minP(b); });
  if (S.sort === 'price-desc') list.sort(function (a, b) { return minP(b) - minP(a); });
  if (S.sort === 'moq-asc') list.sort(function (a, b) { return a.moq - b.moq; });
  if (S.sort === 'name') list.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return list;
}

function render() {
  var list = filtered();
  $('resCount').textContent = list.length + ' product' + (list.length === 1 ? '' : 's');
  renderActiveChips();
  var grid = $('grid');
  grid.innerHTML = '';
  if (!list.length) {
    grid.appendChild(el('div', 'empty', 'No products match these filters'));
    return;
  }
  list.forEach(function (p) {
    var c = el('article', 'card');
    c.innerHTML =
      '<div class="ph">' + (p.images[0]
        ? '<img loading="lazy" src="' + esc(p.images[0]) + '" alt="">'
        : esc(p.name.charAt(0))) + '</div>' +
      '<div class="body">' +
        '<div class="brand">' + esc(brandName(p.brand)) + '</div>' +
        '<div class="name">' + esc(p.name) + '</div>' +
        '<div class="meta">' + badgeHtml(p) + '</div>' +
        '<div class="meta">' + fromPrice(p) +
          '<span class="moq">MOQ ' + p.moq + '</span></div>' +
      '</div>';
    c.onclick = function () { openProduct(p); };
    grid.appendChild(c);
  });
}

function renderActiveChips() {
  var row = $('activeChips');
  row.innerHTML = '';
  var chips = [];
  if (S.cat) chips.push(['cat', S.cat]);
  if (S.sub) chips.push(['sub', S.sub]);
  if (S.stock) chips.push(['stock', S.stock === 'in' ? 'In stock' : 'Low stock']);
  if (S.budget) chips.push(['budget', '≤ ' + inr(S.budget)]);
  chips.forEach(function (ch) {
    var b = el('button', 'fchip', esc(ch[1]));
    b.onclick = function () {
      if (ch[0] === 'cat') { S.cat = ''; S.sub = ''; $('fCat').value = ''; syncSub(); }
      if (ch[0] === 'sub') { S.sub = ''; $('fSub').value = ''; }
      if (ch[0] === 'stock') { S.stock = ''; $('fStock').value = ''; }
      if (ch[0] === 'budget') { S.budget = ''; $('fBudget').value = ''; }
      render();
    };
    row.appendChild(b);
  });
}

function syncSub() {
  var sel = $('fSub');
  sel.innerHTML = '<option value="">All subcategories</option>';
  var cat = S.categories.filter(function (c) { return c.name === S.cat; })[0];
  if (!cat || !cat.subs.length) { sel.hidden = true; return; }
  cat.subs.forEach(function (s) {
    var o = document.createElement('option');
    o.value = s; o.textContent = s;
    sel.appendChild(o);
  });
  sel.hidden = false;
}

/* ---------- product modal ---------- */
function openProduct(p) {
  if (!S.viewed[p.sku]) { S.viewed[p.sku] = 1; track(p.sku, 'view'); }
  var qty = p.moq;
  var body = $('pBody');
  var imgs = p.images;
  body.innerHTML =
    '<div class="gallery">' +
      '<div class="main" id="gMain">' + (imgs[0]
        ? '<img src="' + esc(imgs[0]) + '" alt="">' : esc(p.name.charAt(0))) + '</div>' +
      (imgs.length > 1
        ? '<div class="thumbs">' + imgs.map(function (u, i) {
            return '<img src="' + esc(u) + '" data-i="' + i + '" class="' + (i ? '' : 'on') + '">';
          }).join('') + '</div>' : '') +
    '</div>' +
    '<div>' +
      '<div class="brand" style="font-size:12px;font-weight:700;color:var(--ink-3);text-transform:uppercase">' +
        esc(brandName(p.brand)) + ' · ' + esc(p.category) + '</div>' +
      '<h2>' + esc(p.name) + '</h2>' +
      '<div class="sku">SKU ' + esc(p.sku) + ' · ' + badgeHtml(p) +
        (p.lead_time ? ' · Lead time ' + esc(p.lead_time) : '') + '</div>' +
      '<p class="desc">' + esc(p.description) + '</p>' +
      (p.specs.length ? '<ul class="specs">' + p.specs.map(function (s) {
        var kv = s.split(':');
        return kv.length > 1
          ? '<li><b>' + esc(kv[0]) + '</b><span>' + esc(kv.slice(1).join(':')) + '</span></li>'
          : '<li>' + esc(s) + '</li>';
      }).join('') + '</ul>' : '') +
      (p.show_price && p.tiers.length
        ? '<table class="tiers" id="tierTable"><tr><th>Quantity</th><th>Unit price</th></tr>' +
          p.tiers.map(function (t, i) {
            var upTo = p.tiers[i + 1] ? '–' + (p.tiers[i + 1].min - 1) : '+';
            return '<tr data-min="' + t.min + '"><td>' + t.min + upTo + '</td><td>' + inr(t.price) + '</td></tr>';
          }).join('') + '</table>' : '') +
      '<div class="qty-row">' +
        '<div class="qty">' +
          '<button id="qMinus">−</button>' +
          '<input id="qInput" type="number" value="' + qty + '" min="' + p.moq + '">' +
          '<button id="qPlus">+</button>' +
        '</div>' +
        '<div class="line-est" id="lineEst"></div>' +
      '</div>' +
      '<div class="form-err" id="pErr"></div>' +
      '<button class="btn primary" id="addBtn" style="width:100%;justify-content:center">' +
        (p.stock_badge === 'out' ? 'Request (made to order)' : 'Add to request list') + '</button>' +
      '<p class="note">Prices are indicative and GST-exclusive. Final pricing is confirmed on your quotation. Stock is subject to prior sale until your order is confirmed.</p>' +
    '</div>';

  function refresh() {
    var q = Math.max(0, Math.floor(Number($('qInput').value) || 0));
    var price = tierFor(p, q);
    if (p.show_price && p.tiers.length) {
      $('lineEst').innerHTML = inr(price * q) + '<small>' + inr(price) + ' × ' + q + ' units</small>';
      var rows = body.querySelectorAll('#tierTable tr[data-min]');
      var active = null;
      rows.forEach(function (r) { r.classList.remove('on'); if (q >= Number(r.dataset.min)) active = r; });
      if (active) active.classList.add('on');
    } else {
      $('lineEst').innerHTML = '<small>Price on request</small>';
    }
    $('pErr').textContent = q && q < p.moq ? 'Minimum order quantity is ' + p.moq : '';
  }
  $('qInput').oninput = refresh;
  $('qMinus').onclick = function () { $('qInput').value = Math.max(p.moq, Number($('qInput').value) - p.moq); refresh(); };
  $('qPlus').onclick = function () { $('qInput').value = Number($('qInput').value) + p.moq; refresh(); };
  body.querySelectorAll('.thumbs img').forEach(function (t) {
    t.onclick = function () {
      $('gMain').innerHTML = '<img src="' + esc(imgs[Number(t.dataset.i)]) + '">';
      body.querySelectorAll('.thumbs img').forEach(function (x) { x.classList.remove('on'); });
      t.classList.add('on');
    };
  });
  $('addBtn').onclick = function () {
    var q = Math.floor(Number($('qInput').value) || 0);
    if (q < p.moq) { $('pErr').textContent = 'Minimum order quantity is ' + p.moq; return; }
    addToCart(p, q);
    closeProduct();
  };
  refresh();
  $('pOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeProduct() {
  $('pOverlay').hidden = true;
  document.body.style.overflow = '';
}

/* ---------- cart ---------- */
function addToCart(p, qty) {
  var existing = S.cart.filter(function (l) { return l.sku === p.sku; })[0];
  if (existing) existing.qty = qty;
  else S.cart.push({ sku: p.sku, name: p.name, qty: qty, image: p.images[0] || '', moq: p.moq, product: p });
  track(p.sku, 'click');
  saveCart();
  renderCart();
  toast(p.name + ' — ' + qty + ' units added');
}
function saveCart() {
  $('cartCount').textContent = S.cart.length || '';
  try {
    sessionStorage.setItem('mf_cart', JSON.stringify(S.cart.map(function (l) {
      return { sku: l.sku, qty: l.qty };
    })));
  } catch (e) {}
}
function restoreCart() {
  try {
    var raw = JSON.parse(sessionStorage.getItem('mf_cart') || '[]');
    raw.forEach(function (l) {
      var p = S.products.filter(function (x) { return x.sku === l.sku; })[0];
      if (p) S.cart.push({ sku: p.sku, name: p.name, qty: l.qty, image: p.images[0] || '', moq: p.moq, product: p });
    });
    saveCart();
  } catch (e) {}
}

function cartTotal() {
  return S.cart.reduce(function (s, l) {
    return s + (l.product.show_price ? tierFor(l.product, l.qty) * l.qty : 0);
  }, 0);
}

function renderCart() {
  var body = $('dBody'), foot = $('dFoot');
  if (!S.cart.length) {
    body.innerHTML = '<div class="empty">Nothing here yet.<br>Add products from the catalog.</div>';
    foot.innerHTML = '';
    return;
  }
  body.innerHTML = '';
  S.cart.forEach(function (l, i) {
    var row = el('div', 'cline');
    row.innerHTML =
      '<div class="thumb">' + (l.image ? '<img src="' + esc(l.image) + '">' : esc(l.name.charAt(0))) + '</div>' +
      '<div style="flex:1">' +
        '<div class="n">' + esc(l.name) + '</div>' +
        '<div class="s">' + esc(l.sku) + ' · ' +
          (l.product.show_price ? inr(tierFor(l.product, l.qty)) + '/unit' : 'price on request') + '</div>' +
        '<div class="qty" style="margin-top:6px;transform:scale(.85);transform-origin:left">' +
          '<button data-i="' + i + '" data-d="-1">−</button>' +
          '<input data-i="' + i + '" value="' + l.qty + '" type="number" min="' + l.moq + '">' +
          '<button data-i="' + i + '" data-d="1">+</button>' +
        '</div>' +
      '</div>' +
      '<button class="rm" data-i="' + i + '" title="Remove">✕</button>';
    body.appendChild(row);
  });
  body.querySelectorAll('.qty button').forEach(function (b) {
    b.onclick = function () {
      var l = S.cart[Number(b.dataset.i)];
      l.qty = Math.max(l.moq, l.qty + Number(b.dataset.d) * l.moq);
      saveCart(); renderCart();
    };
  });
  body.querySelectorAll('.qty input').forEach(function (inp) {
    inp.onchange = function () {
      var l = S.cart[Number(inp.dataset.i)];
      l.qty = Math.max(l.moq, Math.floor(Number(inp.value) || l.moq));
      saveCart(); renderCart();
    };
  });
  body.querySelectorAll('.rm').forEach(function (b) {
    b.onclick = function () { S.cart.splice(Number(b.dataset.i), 1); saveCart(); renderCart(); };
  });

  var total = cartTotal();
  foot.innerHTML =
    (total ? '<div class="total-row"><span>Estimated total<small>GST-exclusive, indicative</small></span><span>' + inr(total) + '</span></div>' : '') +
    '<button class="btn primary" id="checkoutBtn" style="width:100%;justify-content:center">Continue to request</button>';
  $('checkoutBtn').onclick = renderRequestForm;
}

function renderRequestForm() {
  var body = $('dBody'), foot = $('dFoot');
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem('mf_buyer') || '{}'); } catch (e) {}
  body.innerHTML =
    '<h3 style="margin:4px 0 14px">Your details</h3>' +
    '<div class="field"><label>Company *</label><input id="rCompany" value="' + esc(saved.company || (S.user ? S.user.company : '')) + '"></div>' +
    '<div class="f2">' +
      '<div class="field"><label>Contact person *</label><input id="rContact" value="' + esc(saved.contact || (S.user ? S.user.name : '')) + '"></div>' +
      '<div class="field"><label>Phone</label><input id="rPhone" value="' + esc(saved.phone || '') + '"></div>' +
    '</div>' +
    '<div class="field"><label>Work email *</label><input id="rEmail" type="email" value="' + esc(saved.email || (S.user ? S.user.email : '')) + '"></div>' +
    '<div class="field"><label>GSTIN (optional)</label><input id="rGstin" value="' + esc(saved.gstin || '') + '"></div>' +
    '<div class="field"><label>Notes — branding, deadline, delivery city…</label><textarea id="rNotes"></textarea></div>' +
    '<div class="form-err" id="rErr"></div>';
  foot.innerHTML =
    '<button class="btn" id="backBtn" style="width:100%;justify-content:center;margin-bottom:8px">Back to items</button>' +
    '<button class="btn primary" id="sendBtn" style="width:100%;justify-content:center">Send request</button>';
  $('backBtn').onclick = renderCart;
  $('sendBtn').onclick = submitRequest;
}

function submitRequest() {
  var payload = {
    company: $('rCompany').value.trim(),
    contact: $('rContact').value.trim(),
    email: $('rEmail').value.trim(),
    phone: $('rPhone').value.trim(),
    gstin: $('rGstin').value.trim(),
    notes: $('rNotes').value.trim(),
    user_email: S.user ? S.user.email : '',
    lines: S.cart.map(function (l) { return { sku: l.sku, qty: l.qty }; })
  };
  if (!payload.company || !payload.contact || !payload.email) {
    $('rErr').textContent = 'Company, contact person and email are required.';
    return;
  }
  $('sendBtn').disabled = true;
  $('sendBtn').textContent = 'Sending…';
  api('request', payload).then(function (res) {
    if (!res.ok) throw new Error(res.error);
    try {
      localStorage.setItem('mf_buyer', JSON.stringify({
        company: payload.company, contact: payload.contact,
        email: payload.email, phone: payload.phone, gstin: payload.gstin
      }));
    } catch (e) {}
    S.cart = [];
    saveCart();
    flushTrack();
    $('dBody').innerHTML =
      '<div class="success"><div class="big">✓</div>' +
      '<h3>Request sent</h3>' +
      '<p>Reference <b>' + esc(res.request_id) + '</b><br>' +
      'We will come back with a quotation on ' + esc(payload.email) + '.</p>' +
      '<button class="btn primary" id="doneBtn">Back to catalog</button></div>';
    $('dFoot').innerHTML = '';
    $('doneBtn').onclick = closeDrawer;
  }).catch(function (e) {
    $('rErr').textContent = e.message;
    $('sendBtn').disabled = false;
    $('sendBtn').textContent = 'Send request';
  });
}

function openDrawer() { renderCart(); $('drawer').classList.add('open'); }
function closeDrawer() { $('drawer').classList.remove('open'); }

/* ---------- login (gated mode) ---------- */
function doLogin() {
  $('lErr').textContent = '';
  $('lGo').disabled = true;
  api('login', { email: $('lEmail').value.trim(), password: $('lPass').value }).then(function (res) {
    $('lGo').disabled = false;
    if (!res.ok) { $('lErr').textContent = res.error; return; }
    S.session = res.session;
    S.user = res.user;
    try { sessionStorage.setItem('mf_session', res.session); } catch (e) {}
    $('loginOverlay').hidden = true;
    loadCatalog();
  }).catch(function (e) {
    $('lGo').disabled = false;
    $('lErr').textContent = e.message;
  });
}

/* ---------- wire up ---------- */
$('q').addEventListener('input', function () { S.q = this.value; render(); });
$('fCat').addEventListener('change', function () { S.cat = this.value; S.sub = ''; syncSub(); render(); });
$('fSub').addEventListener('change', function () { S.sub = this.value; render(); });
$('fStock').addEventListener('change', function () { S.stock = this.value; render(); });
$('fSort').addEventListener('change', function () { S.sort = this.value; render(); });
$('fBudget').addEventListener('input', function () { S.budget = this.value; render(); });
$('cartBtn').onclick = openDrawer;
$('dClose').onclick = closeDrawer;
$('pClose').onclick = closeProduct;
$('pOverlay').addEventListener('click', function (e) { if (e.target === this) closeProduct(); });
$('lGo').onclick = doLogin;
$('lPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { closeProduct(); closeDrawer(); }
});

boot();
