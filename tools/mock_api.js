/**
 * Merchforce local mock — serves the static site plus an in-memory /api
 * that mirrors the Apps Script contract. No Google account needed.
 *
 *   node tools/mock_api.js     → http://localhost:8900
 *   API token: mf-demo-token · Admin key: admin2026
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 8900;
const API_TOKEN = 'mf-demo-token';
const ADMIN_PASS = 'admin2026';

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed_products.json'), 'utf8'));

const db = {
  settings: {
    site_name: 'Merchforce', tagline: 'Bulk merchandise, direct from stock',
    access_mode: 'open', show_stock_numbers: 'badge', notify_email: '',
    low_stock_threshold: '25', currency: 'INR', primary_color: '#1a1f36'
  },
  brands: seed.brands.map(b => ({ brand_id: b.id, name: b.name, logo_url: '', description: '', active: 'TRUE', sort: b.sort })),
  products: seed.products.map(p => ({
    sku: p.sku, name: p.name, brand_id: p.brand_id, category: p.category,
    subcategory: p.sub || '', description: p.desc, specs: (p.specs || []).join('|'),
    image_urls: p.image || '', moq: p.moq, gst_rate: 18, lead_time: p.lead,
    on_hand: p.stock, reserved: 0, safety_stock: Math.round(p.stock * 0.03),
    reorder_point: Math.round(p.stock * 0.1), visible: 'TRUE', show_price: 'TRUE'
  })),
  tiers: seed.products.flatMap(p => (p.tiers || []).map(t => ({ sku: p.sku, min_qty: t[0], unit_price: t[1] }))),
  requests: [], lines: [], users: [], events: [], seq: 0
};

// a few demo requests so the admin pipeline isn't empty
(function demoRequests() {
  const mk = (daysAgo, status, company, contact, email, items) => {
    const id = 'MF-2026-' + String(++db.seq).padStart(4, '0');
    const created = new Date(Date.now() - daysAgo * 864e5);
    let total = 0;
    items.forEach(([sku, qty], i) => {
      const price = tierFor(sku, qty);
      total += price * qty;
      db.lines.push({ request_id: id, line: i + 1, sku, name: nameOf(sku), qty, unit_price: price, line_total: price * qty });
    });
    db.requests.push({
      request_id: id, created: created.toISOString(), status, company, contact, email,
      phone: '98' + String(10000000 + daysAgo * 137).slice(0, 8), gstin: '', notes: 'Need branding with our logo.',
      user_email: '', total_est: total, status_dates: JSON.stringify({ New: created.toISOString() }),
      admin_notes: '', updated: created.toISOString()
    });
    items.forEach(([sku]) => db.events.push({ date: dstr(created), sku, type: 'request', count: 1 }));
  };
  mk(2, 'New', 'Zenith Analytics', 'Priya Sharma', 'priya@zenith.example', [['URBAN-298', 200], ['1953184', 500]]);
  mk(5, 'Under Review', 'Cobalt Systems', 'Arjun Mehta', 'arjun@cobalt.example', [['B30906', 150]]);
  mk(9, 'Quoted', 'Nimbus Retail', 'Sara Ali', 'sara@nimbus.example', [['BT380BLK130', 300], ['CSUN-0276', 400]]);
  mk(14, 'Confirmed', 'Vertex Labs', 'Rahul Nair', 'rahul@vertex.example', [['UG 02', 250]]);
  mk(40, 'Closed', 'Origin Works', 'Dev Patel', 'dev@origin.example', [['DN3224', 500]]);
  mk(70, 'Rejected', 'Halo Fintech', 'Ishita Rao', 'ishita@halo.example', [['PARK-002', 100]]);
  // reserve stock for the confirmed one
  const conf = db.requests.find(r => r.status === 'Confirmed');
  db.lines.filter(l => l.request_id === conf.request_id).forEach(l => { prodOf(l.sku).reserved += l.qty; });
  // some view/click noise
  db.products.forEach((p, i) => {
    for (let d = 0; d < 80; d += 3 + (i % 5)) {
      db.events.push({ date: dstr(new Date(Date.now() - d * 864e5)), sku: p.sku, type: 'view', count: 1 + ((i * d) % 7) });
    }
  });
})();

function dstr(d) { return d.toISOString().slice(0, 10); }
function prodOf(sku) { return db.products.find(p => p.sku === sku); }
function nameOf(sku) { const p = prodOf(sku); return p ? p.name : sku; }
function tiersOf(sku) { return db.tiers.filter(t => t.sku === sku).map(t => ({ min: t.min_qty, price: t.unit_price })).sort((a, b) => a.min - b.min); }
function tierFor(sku, qty) { let price = 0; tiersOf(sku).forEach(t => { if (qty >= t.min) price = t.price; }); return price || (tiersOf(sku)[0] || {}).price || 0; }
function atp(p) { return Math.max(0, p.on_hand - p.reserved - p.safety_stock); }
function pub(p) {
  const a = atp(p), low = Number(db.settings.low_stock_threshold);
  return {
    sku: p.sku, name: p.name, brand: p.brand_id, category: p.category, subcategory: p.subcategory,
    description: p.description, specs: p.specs.split('|').filter(Boolean),
    images: p.image_urls.split('|').filter(Boolean), moq: p.moq, gst: p.gst_rate,
    lead_time: p.lead_time, stock: db.settings.show_stock_numbers === 'exact' ? a : null,
    stock_badge: a <= 0 ? 'out' : a <= low ? 'low' : 'in',
    show_price: p.show_price === 'TRUE', tiers: p.show_price === 'TRUE' ? tiersOf(p.sku) : []
  };
}

const ACTIONS = {
  site: () => ({
    ok: true,
    site: {
      name: db.settings.site_name, tagline: db.settings.tagline, access_mode: db.settings.access_mode,
      show_stock_numbers: db.settings.show_stock_numbers, currency: 'INR', primary_color: db.settings.primary_color
    },
    brands: db.brands.filter(b => b.active === 'TRUE').sort((a, b) => a.sort - b.sort)
      .map(b => ({ id: b.brand_id, name: b.name, logo: b.logo_url, desc: b.description })),
    categories: [...new Set(db.products.filter(p => p.visible === 'TRUE').map(p => p.category))]
      .map(c => ({ name: c, subs: [...new Set(db.products.filter(p => p.category === c && p.subcategory).map(p => p.subcategory))] }))
  }),
  catalog: () => ({ ok: true, products: db.products.filter(p => p.visible === 'TRUE').map(pub) }),
  product: b => { const p = prodOf(b.sku); return p ? { ok: true, product: pub(p) } : { ok: false, error: 'Not found' }; },
  track: b => {
    (b.events || []).forEach(ev => {
      const key = db.events.find(e => e.date === dstr(new Date()) && e.sku === ev.sku && e.type === ev.type);
      if (key) key.count++; else db.events.push({ date: dstr(new Date()), sku: ev.sku, type: ev.type, count: 1 });
    });
    return { ok: true };
  },
  login: b => (b.email && b.password === 'DemoPass2026!')
    ? { ok: true, session: 'mock-session', user: { email: b.email, name: 'Demo Buyer', company: 'Demo Co' } }
    : { ok: false, error: 'Invalid credentials (mock: any email + DemoPass2026!)' },
  request: b => {
    if (!b.company || !b.contact || !b.email) return { ok: false, error: 'Company, contact and email are required' };
    const id = 'MF-2026-' + String(++db.seq).padStart(4, '0');
    let total = 0;
    (b.lines || []).forEach((l, i) => {
      const p = prodOf(l.sku);
      if (!p) return;
      const price = tierFor(l.sku, l.qty);
      total += price * l.qty;
      db.lines.push({ request_id: id, line: i + 1, sku: l.sku, name: p.name, qty: l.qty, unit_price: price, line_total: price * l.qty });
    });
    db.requests.push({
      request_id: id, created: new Date().toISOString(), status: 'New', company: b.company,
      contact: b.contact, email: b.email, phone: b.phone || '', gstin: b.gstin || '',
      notes: b.notes || '', user_email: b.user_email || '', total_est: total,
      status_dates: JSON.stringify({ New: new Date().toISOString() }), admin_notes: '', updated: new Date().toISOString()
    });
    return { ok: true, request_id: id, total_est: total };
  },

  adminUnlock: () => ({ ok: true, settings: db.settings }),
  adminRequests: () => ({
    ok: true,
    requests: db.requests.map(r => ({
      id: r.request_id, created: r.created, status: r.status, company: r.company, contact: r.contact,
      email: r.email, phone: r.phone, gstin: r.gstin, notes: r.notes, admin_notes: r.admin_notes,
      total_est: r.total_est, status_dates: JSON.parse(r.status_dates),
      lines: db.lines.filter(l => l.request_id === r.request_id)
    })).reverse()
  }),
  adminRequestUpdate: b => {
    const r = db.requests.find(x => x.request_id === b.id);
    if (!r) return { ok: false, error: 'Request not found' };
    if (b.admin_notes !== undefined) r.admin_notes = b.admin_notes;
    if (b.status && b.status !== r.status) {
      const lines = db.lines.filter(l => l.request_id === b.id);
      if (b.status === 'Confirmed') {
        const short = lines.filter(l => atp(prodOf(l.sku)) < l.qty)
          .map(l => `${l.sku} (need ${l.qty}, ATP ${atp(prodOf(l.sku))})`);
        if (short.length) return { ok: false, error: 'Insufficient stock — offer partial/backorder or requote: ' + short.join(', ') };
        lines.forEach(l => { prodOf(l.sku).reserved += l.qty; });
      }
      if (r.status === 'Confirmed' && (b.status === 'Rejected' || b.status === 'Expired'))
        lines.forEach(l => { prodOf(l.sku).reserved = Math.max(0, prodOf(l.sku).reserved - l.qty); });
      if (b.status === 'Dispatched' && r.status === 'Confirmed')
        lines.forEach(l => { const p = prodOf(l.sku); p.on_hand -= l.qty; p.reserved = Math.max(0, p.reserved - l.qty); });
      const dates = JSON.parse(r.status_dates);
      dates[b.status] = new Date().toISOString();
      r.status_dates = JSON.stringify(dates);
      r.status = b.status;
    }
    return { ok: true, id: b.id, status: r.status };
  },
  adminCatalog: () => ({
    ok: true,
    products: db.products.map(p => ({
      sku: p.sku, name: p.name, brand_id: p.brand_id, category: p.category, subcategory: p.subcategory,
      description: p.description, specs: p.specs, images: p.image_urls.split('|').filter(Boolean),
      moq: p.moq, gst_rate: p.gst_rate, lead_time: p.lead_time, on_hand: p.on_hand, reserved: p.reserved,
      safety_stock: p.safety_stock, reorder_point: p.reorder_point, atp: atp(p),
      visible: p.visible === 'TRUE', show_price: p.show_price === 'TRUE', tiers: tiersOf(p.sku)
    })),
    brands: db.brands.map(b => ({ id: b.brand_id, name: b.name, logo: b.logo_url, desc: b.description, active: b.active === 'TRUE', sort: b.sort }))
  }),
  adminProductSave: b => {
    const d = b.product;
    if (!d.sku || !d.name) return { ok: false, error: 'SKU and name are required' };
    let p = prodOf(d.sku);
    if (!p) { p = { sku: d.sku, reserved: 0 }; db.products.push(p); }
    Object.assign(p, {
      name: d.name, brand_id: d.brand_id || '', category: d.category || '', subcategory: d.subcategory || '',
      description: d.description || '', specs: d.specs || '', image_urls: (d.images || []).join('|'),
      moq: d.moq || 1, gst_rate: d.gst_rate || 0, lead_time: d.lead_time || '', on_hand: d.on_hand || 0,
      safety_stock: d.safety_stock || 0, reorder_point: d.reorder_point || 0,
      visible: d.visible ? 'TRUE' : 'FALSE', show_price: d.show_price ? 'TRUE' : 'FALSE'
    });
    db.tiers = db.tiers.filter(t => t.sku !== d.sku)
      .concat((d.tiers || []).map(t => ({ sku: d.sku, min_qty: t.min, unit_price: t.price })));
    return { ok: true, sku: d.sku };
  },
  adminProductDelete: b => { const p = prodOf(b.sku); if (!p) return { ok: false, error: 'Not found' }; p.visible = 'FALSE'; return { ok: true }; },
  adminBrandSave: b => {
    const d = b.brand;
    if (!d.name) return { ok: false, error: 'Brand name required' };
    const id = d.id || 'BR-' + d.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    let br = db.brands.find(x => x.brand_id === id);
    if (!br) { br = { brand_id: id }; db.brands.push(br); }
    Object.assign(br, { name: d.name, logo_url: d.logo || '', description: d.desc || '', active: d.active === false ? 'FALSE' : 'TRUE', sort: d.sort || 0 });
    return { ok: true, id };
  },
  adminBrandDelete: b => {
    if (db.products.some(p => p.brand_id === b.id)) return { ok: false, error: 'Brand has products — reassign them first' };
    db.brands = db.brands.filter(x => x.brand_id !== b.id);
    return { ok: true };
  },
  adminImageUpload: b => ({ ok: true, url: 'https://placehold.co/600x600/eef1ff/2447f5?text=' + encodeURIComponent((b.filename || 'img').slice(0, 12)), file_id: 'mock' }),
  adminUsers: () => ({ ok: true, users: db.users }),
  adminUserSave: b => {
    const d = b.user;
    if (!d.email) return { ok: false, error: 'Email required' };
    let u = db.users.find(x => x.email === d.email.toLowerCase());
    if (!u) {
      if (!d.password || d.password.length < 10) return { ok: false, error: 'Password must be 10+ characters' };
      u = { email: d.email.toLowerCase(), created: new Date().toISOString(), last_login: '' };
      db.users.push(u);
    }
    Object.assign(u, { name: d.name || '', company: d.company || '', active: d.active !== false });
    return { ok: true, email: u.email };
  },
  adminAnalytics: () => {
    const wins = [30, 60, 90], DAY = 864e5, nowMs = Date.now();
    const names = Object.fromEntries(db.products.map(p => [p.sku, p.name]));
    const clicks = {}, demand = {};
    db.events.forEach(ev => {
      if (ev.type !== 'view' && ev.type !== 'click') return;
      const age = (nowMs - new Date(ev.date).getTime()) / DAY;
      wins.forEach(w => {
        if (age <= w) { clicks[ev.sku] = clicks[ev.sku] || { 30: 0, 60: 0, 90: 0 }; clicks[ev.sku][w] += ev.count; }
      });
    });
    db.lines.forEach(l => {
      const r = db.requests.find(x => x.request_id === l.request_id);
      if (!r) return;
      const age = (nowMs - new Date(r.created).getTime()) / DAY;
      wins.forEach(w => {
        if (age <= w) {
          demand[l.sku] = demand[l.sku] || { 30: { qty: 0, reqs: 0 }, 60: { qty: 0, reqs: 0 }, 90: { qty: 0, reqs: 0 } };
          demand[l.sku][w].qty += l.qty; demand[l.sku][w].reqs += 1;
        }
      });
    });
    const top = (obj, key, w) => Object.keys(obj)
      .map(sku => ({ sku, name: names[sku] || sku, value: key ? obj[sku][w][key] : obj[sku][w], reqs: key ? obj[sku][w].reqs : undefined }))
      .filter(x => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 15);
    const funnel = {};
    db.requests.forEach(r => { funnel[r.status] = (funnel[r.status] || 0) + 1; });
    return {
      ok: true,
      top_clicked: { 30: top(clicks, null, 30), 60: top(clicks, null, 60), 90: top(clicks, null, 90) },
      top_requested: { 30: top(demand, 'qty', 30), 60: top(demand, 'qty', 60), 90: top(demand, 'qty', 90) },
      funnel, requests_per_day: {}
    };
  },
  adminSettings: b => { if (b.save) Object.assign(db.settings, b.save); return { ok: true, settings: db.settings }; },
  adminExportCsv: b => ({ ok: true, filename: 'mock.csv', csv: 'sku,name\n' + db.products.map(p => p.sku + ',' + JSON.stringify(p.name)).join('\n') })
};

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };

http.createServer((req, res) => {
  if (req.url === '/api' && req.method === 'POST') {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      let out;
      try {
        const b = JSON.parse(raw);
        if (b.token !== API_TOKEN) out = { ok: false, error: 'Bad token' };
        else if (b.action && b.action.startsWith('admin') && b.adminKey !== ADMIN_PASS) out = { ok: false, error: 'Bad admin key' };
        else if (ACTIONS[b.action]) out = ACTIONS[b.action](b);
        else out = { ok: false, error: 'Unknown action: ' + b.action };
      } catch (e) { out = { ok: false, error: e.message }; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  let file = req.url.split('?')[0];
  if (file === '/') file = '/index.html';
  const fp = path.join(ROOT, file);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
}).listen(PORT, () => console.log(
  `Merchforce mock on http://localhost:${PORT}\n  storefront: /   admin: /admin.html (key: ${ADMIN_PASS})`
));
