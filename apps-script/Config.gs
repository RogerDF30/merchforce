/**
 * Merchforce — Config
 * Single-supplier storefront + admin. GAS backend, Sheet database, Drive assets.
 * Hourglass Essentials Pvt Ltd · CompanyStore.IO
 */

// One-time bootstrap key. Rotate/blank after running setup (see Setup.gs).
var SETUP_KEY = 'b967ce577d2cb1e4c23e00d6';

var APP_NAME = 'Merchforce';

// Sheet tab schemas. Column order is the contract — append, never reorder.
var SHEETS = {
  Settings:     ['key', 'value'],
  Brands:       ['brand_id', 'name', 'logo_url', 'description', 'active', 'sort'],
  Products:     ['sku', 'name', 'brand_id', 'category', 'subcategory', 'description',
                 'specs', 'image_urls', 'moq', 'gst_rate', 'lead_time',
                 'on_hand', 'reserved', 'safety_stock', 'reorder_point',
                 'visible', 'show_price', 'created', 'updated'],
  PriceTiers:   ['sku', 'min_qty', 'unit_price'],
  Requests:     ['request_id', 'created', 'status', 'company', 'contact', 'email',
                 'phone', 'gstin', 'notes', 'user_email', 'total_est',
                 'status_dates', 'admin_notes', 'updated'],
  RequestLines: ['request_id', 'line', 'sku', 'name', 'qty', 'unit_price', 'line_total'],
  Users:        ['email', 'name', 'company', 'pass_hash', 'salt', 'active',
                 'created', 'last_login'],
  Events:       ['date', 'sku', 'type', 'count'],
  StockLog:     ['ts', 'sku', 'delta', 'reason', 'actor'],
  AuditLog:     ['ts', 'actor', 'action', 'ref', 'detail']
};

// Forward-only request lifecycle (industry standard enquiry→confirm flow).
// Rejected/Expired are terminal branches; Confirmed reserves stock,
// Rejected/Expired/Closed release it (see Requests.gs).
var STATUSES = ['New', 'Under Review', 'Quoted', 'Confirmed', 'Dispatched', 'Closed'];
var TERMINAL  = ['Rejected', 'Expired'];

var DEFAULT_SETTINGS = {
  site_name: 'Merchforce',
  tagline: 'Bulk merchandise, direct from stock',
  access_mode: 'open',          // open | gated
  show_stock_numbers: 'badge',  // badge | exact
  notify_email: '',             // supplier email for new-request pings
  low_stock_threshold: '25',
  currency: 'INR',
  primary_color: '#1a1f36'
};

function props_() { return PropertiesService.getScriptProperties(); }

function db_() {
  var id = props_().getProperty('SHEET_ID');
  if (!id) throw new Error('Not set up: SHEET_ID missing. Run setup first.');
  return SpreadsheetApp.openById(id);
}

function getSettings_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('settings');
  if (hit) return JSON.parse(hit);
  var out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  readRows_('Settings').forEach(function (r) { if (r.key) out[r.key] = String(r.value); });
  cache.put('settings', JSON.stringify(out), 300);
  return out;
}

function saveSettings_(patch) {
  var sh = sheet_('Settings');
  var rows = readRows_('Settings');
  Object.keys(patch).forEach(function (k) {
    if (!(k in DEFAULT_SETTINGS)) return;
    var idx = -1;
    rows.forEach(function (r, i) { if (r.key === k) idx = i; });
    if (idx >= 0) sh.getRange(idx + 2, 2).setValue(String(patch[k]));
    else sh.appendRow([k, String(patch[k])]);
  });
  CacheService.getScriptCache().remove('settings');
}
