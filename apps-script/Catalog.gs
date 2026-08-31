/** Merchforce — public storefront endpoints */

/** Site bootstrap: settings the storefront may see + brand bar + categories. */
function fnSite_(p) {
  var s = getSettings_();
  var brands = readRows_('Brands')
    .filter(function (b) { return isTrue_(b.active); })
    .sort(function (a, b) { return toNum_(a.sort) - toNum_(b.sort); })
    .map(function (b) {
      return { id: b.brand_id, name: b.name, logo: b.logo_url, desc: b.description };
    });
  var cats = {};
  readRows_('Products').forEach(function (pr) {
    if (!isTrue_(pr.visible)) return;
    if (!cats[pr.category]) cats[pr.category] = {};
    if (pr.subcategory) cats[pr.category][pr.subcategory] = 1;
  });
  return ok_({
    site: {
      name: s.site_name, tagline: s.tagline, access_mode: s.access_mode,
      show_stock_numbers: s.show_stock_numbers, currency: s.currency,
      primary_color: s.primary_color
    },
    brands: brands,
    categories: Object.keys(cats).map(function (c) {
      return { name: c, subs: Object.keys(cats[c]) };
    })
  });
}

function publicProduct_(pr, tiersBySku, settings) {
  var atp = atp_(pr);
  var low = toNum_(settings.low_stock_threshold);
  var showPrice = isTrue_(pr.show_price);
  return {
    sku: pr.sku, name: pr.name, brand: pr.brand_id,
    category: pr.category, subcategory: pr.subcategory,
    description: pr.description,
    specs: String(pr.specs || '').split('|').filter(String),
    images: String(pr.image_urls || '').split('|').filter(String),
    moq: toNum_(pr.moq), gst: toNum_(pr.gst_rate), lead_time: pr.lead_time,
    mrp: toNum_(pr.mrp) || null,
    stock: settings.show_stock_numbers === 'exact' ? atp : null,
    stock_badge: atp <= 0 ? 'out' : (atp <= low ? 'low' : 'in'),
    show_price: showPrice,
    tiers: showPrice ? (tiersBySku[pr.sku] || []) : []
  };
}

function fnCatalog_(p) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('catalog_v1');
  if (hit && !p.fresh) return json_(JSON.parse(hit));

  var s = getSettings_();
  var tiers = {};
  readRows_('PriceTiers').forEach(function (t) {
    if (!tiers[t.sku]) tiers[t.sku] = [];
    tiers[t.sku].push({ min: toNum_(t.min_qty), price: toNum_(t.unit_price),
                        gst: t.gst === '' || t.gst === undefined ? null : toNum_(t.gst) });
  });
  Object.keys(tiers).forEach(function (k) {
    tiers[k].sort(function (a, b) { return a.min - b.min; });
  });

  var items = readRows_('Products')
    .filter(function (pr) { return isTrue_(pr.visible); })
    .map(function (pr) { return publicProduct_(pr, tiers, s); });

  var payload = { ok: true, products: items };
  try { cache.put('catalog_v1', JSON.stringify(payload), 300); } catch (e) { /* >100KB: skip cache */ }
  return json_(payload);
}

function fnProduct_(p) {
  var s = getSettings_();
  var row = readRows_('Products').filter(function (r) { return r.sku === p.sku; })[0];
  if (!row || !isTrue_(row.visible)) return err_('Not found');
  var tiers = {};
  tiers[p.sku] = readRows_('PriceTiers')
    .filter(function (t) { return t.sku === p.sku; })
    .map(function (t) { return { min: toNum_(t.min_qty), price: toNum_(t.unit_price),
                                 gst: t.gst === '' || t.gst === undefined ? null : toNum_(t.gst) }; })
    .sort(function (a, b) { return a.min - b.min; });
  return ok_({ product: publicProduct_(row, tiers, s) });
}

/**
 * Behaviour tracking, aggregated per (date, key, type) so Events stays small.
 * Body: {events: [{sku, type}]} — for search types, `sku` carries the term.
 */
var TRACK_TYPES = { view: 1, click: 1, request: 1, search: 1, search_nil: 1 };

function fnTrack_(p) {
  var events = (p.events || []).filter(function (ev) { return TRACK_TYPES[ev.type]; });
  if (!events.length) return ok_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var day = today_();
    var sh = sheet_('Events');
    var rows = readRows_('Events');
    var index = {};
    rows.forEach(function (r, i) { index[r.date + '|' + r.sku + '|' + r.type] = i + 2; });
    var counts = {};
    events.slice(0, 50).forEach(function (ev) {
      if (!ev.sku || !ev.type) return;
      var key = day + '|' + ev.sku + '|' + ev.type;
      counts[key] = (counts[key] || 0) + 1;
    });
    Object.keys(counts).forEach(function (key) {
      var parts = key.split('|');
      if (index[key]) {
        var cell = sh.getRange(index[key], 4);
        cell.setValue(toNum_(cell.getValue()) + counts[key]);
      } else {
        sh.appendRow([parts[0], parts[1], parts[2], counts[key]]);
      }
    });
  } finally {
    lock.releaseLock();
  }
  return ok_();
}
