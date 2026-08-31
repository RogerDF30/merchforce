/**
 * Merchforce — supplier stock sync, per brand.
 * The supplier keeps managing stock in their OWN Google Sheets — typically one
 * workbook (or tab) per brand, like the Wenger stock sheet. Each brand gets a
 * mapping {brand, sheet, tab, sku_col, stock_col}; Merchforce pulls on-hand
 * from every mapping on demand or hourly. A mapping bound to a brand only
 * updates that brand's products, so one brand's sheet can never overwrite
 * another brand's stock.
 *
 * Mappings live in Settings.sync_maps as a JSON array; each carries its own
 * last-run summary.
 */

function sheetIdFrom_(v) {
  var m = String(v || '').match(/\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : String(v || '').trim();
}

function getSyncMaps_() {
  try { return JSON.parse(getSettings_().sync_maps || '[]'); } catch (e) { return []; }
}
function saveSyncMaps_(maps) {
  saveSettings_({ sync_maps: JSON.stringify(maps) });
}

function openSupplierSheet_(id, tab) {
  var ss;
  try {
    ss = SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Cannot open that sheet. Check the ID, and share it (Viewer) with ' + ownerEmail_());
  }
  var sh = tab ? ss.getSheetByName(tab) : ss.getSheets()[0];
  if (!sh) throw new Error('Tab "' + tab + '" not found in that sheet');
  return { ss: ss, sh: sh };
}

/** Open the supplier's sheet, return tabs + headers + a sample, for mapping. */
function fnAdminSyncPreview_(p) {
  var id = sheetIdFrom_(p.sheet);
  if (!id) return err_('Paste the supplier sheet link or ID');
  var o = openSupplierSheet_(id, p.tab || '');
  var lastCol = Math.min(o.sh.getLastColumn(), 30);
  var lastRow = o.sh.getLastRow();
  if (lastRow < 2 || lastCol < 1) return err_('That tab looks empty');
  var headers = o.sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var sample = o.sh.getRange(2, 1, Math.min(5, lastRow - 1), lastCol).getDisplayValues();
  return ok_({
    sheet_id: id,
    tabs: o.ss.getSheets().map(function (s) { return s.getName(); }),
    tab: o.sh.getName(),
    headers: headers,
    sample: sample,
    rows: lastRow - 1,
    owner_hint: ownerEmail_()
  });
}

/** Save (add or replace) one brand mapping. */
function fnAdminSyncMapSave_(p) {
  var m = p.map || {};
  m.sheet = sheetIdFrom_(m.sheet);
  if (!m.sheet || !m.sku_col || !m.stock_col) {
    return err_('Sheet, SKU column and stock column are all required');
  }
  var maps = getSyncMaps_();
  var idx = toNum_(p.index);
  var rec = { brand: m.brand || '', sheet: m.sheet, tab: m.tab || '',
              sku_col: m.sku_col, stock_col: m.stock_col, last: null };
  if (p.index !== undefined && maps[idx]) { rec.last = maps[idx].last; maps[idx] = rec; }
  else maps.push(rec);
  saveSyncMaps_(maps);
  audit_(p.actor || 'admin', 'sync_map_save', rec.brand || 'all', rec.sheet);
  return ok_({ maps: maps });
}

function fnAdminSyncMapDelete_(p) {
  var maps = getSyncMaps_();
  var idx = toNum_(p.index);
  if (!maps[idx]) return err_('Mapping not found');
  maps.splice(idx, 1);
  saveSyncMaps_(maps);
  return ok_({ maps: maps });
}

/** Run one mapping (index given) or every mapping. */
function fnAdminSyncRun_(p) {
  var maps = getSyncMaps_();
  if (!maps.length) return err_('No mappings yet — add one first');
  var toRun = (p.index !== undefined) ? [toNum_(p.index)] : maps.map(function (_, i) { return i; });
  var results = [];
  toRun.forEach(function (i) {
    if (!maps[i]) return;
    var summary = runStockSync_(maps[i], p.actor || 'admin');
    maps[i].last = summary;
    results.push({ index: i, brand: maps[i].brand, summary: summary });
  });
  saveSyncMaps_(maps);
  return ok_({ results: results, maps: maps });
}

function runStockSync_(map, actor) {
  var summary = { ts: String(now_()), matched: 0, updated: 0, unchanged: 0,
                  unknown: 0, off_brand: 0, unknown_skus: [], error: null };
  try {
    var o = openSupplierSheet_(map.sheet, map.tab || '');
    var lastCol = o.sh.getLastColumn();
    var lastRow = o.sh.getLastRow();
    var headers = o.sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    var iSku = headers.indexOf(String(map.sku_col).trim());
    var iStock = headers.indexOf(String(map.stock_col).trim());
    if (iSku < 0 || iStock < 0) throw new Error('Mapped column not found — re-map the columns');
    var data = lastRow > 1 ? o.sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];

    var incoming = {}; // sku -> stock (last row wins)
    data.forEach(function (row) {
      var sku = String(row[iSku]).trim().toUpperCase();
      if (!sku) return;
      var n = Number(row[iStock]);
      incoming[sku] = isNaN(n) ? 0 : Math.max(0, Math.floor(n));
    });

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var sh = sheet_('Products');
      var cols = SHEETS.Products;
      var iOnHand = cols.indexOf('on_hand') + 1;
      var iUpdated = cols.indexOf('updated') + 1;
      var rows = readRows_('Products');
      var known = {};
      rows.forEach(function (r, i) {
        var sku = String(r.sku).trim().toUpperCase();
        known[sku] = r.brand_id;
        if (!(sku in incoming)) return;
        if (map.brand && r.brand_id !== map.brand) { summary.off_brand++; return; }
        summary.matched++;
        var cur = toNum_(r.on_hand), next = incoming[sku];
        if (cur === next) { summary.unchanged++; return; }
        sh.getRange(i + 2, iOnHand).setValue(next);
        sh.getRange(i + 2, iUpdated).setValue(now_());
        appendRecord_('StockLog', { ts: now_(), sku: r.sku, delta: next - cur,
                                    reason: 'sheet sync' + (map.brand ? ' (' + map.brand + ')' : ''),
                                    actor: actor || 'sync' });
        summary.updated++;
      });
      Object.keys(incoming).forEach(function (sku) {
        if (!(sku in known)) {
          summary.unknown++;
          if (summary.unknown_skus.length < 20) summary.unknown_skus.push(sku);
        }
      });
    } finally {
      lock.releaseLock();
    }
    CacheService.getScriptCache().remove('catalog_v1');
  } catch (e) {
    summary.error = e.message || String(e);
  }
  audit_(actor || 'sync', 'stock_sync', (map.brand || 'all') + ':' + map.sheet,
    summary.error || (summary.updated + ' updated, ' + summary.unknown + ' unknown'));
  return summary;
}

/** Hourly auto-pull of every mapping. */
function fnAdminSyncSchedule_(p) {
  var mode = p.mode === 'hourly' ? 'hourly' : 'off';
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncTick') ScriptApp.deleteTrigger(t);
  });
  if (mode === 'hourly') {
    ScriptApp.newTrigger('syncTick').timeBased().everyHours(1).create();
  }
  saveSettings_({ sync_auto: mode });
  audit_(p.actor || 'admin', 'sync_schedule', '', mode);
  return ok_({ mode: mode });
}

function syncTick() {
  var maps = getSyncMaps_();
  maps.forEach(function (m) { m.last = runStockSync_(m, 'auto-sync'); });
  if (maps.length) saveSyncMaps_(maps);
}

/**
 * Generate the supplier stock template: one Google Sheet in the Merchforce
 * Drive folder, one tab per brand, in the supplier's own format
 * (Code | Product Name | MRP | Selling Price Excluding GST | Stock),
 * pre-filled from the live catalog. Link-shared for viewing; the supplier
 * copies it (File → Make a copy) and starts maintaining it.
 */
function fnAdminSyncTemplate_(p) {
  var root = DriveApp.getFolderById(props_().getProperty('FOLDER_ID'));
  var name = 'Merchforce Stock Template — ' + Utilities.formatDate(now_(), 'Asia/Kolkata', 'd MMM yyyy');
  var ss = SpreadsheetApp.create(name);
  DriveApp.getFileById(ss.getId()).moveTo(root);

  var brands = readRows_('Brands').sort(function (a, b) { return toNum_(a.sort) - toNum_(b.sort); });
  var products = readRows_('Products');
  var firstTier = {};
  readRows_('PriceTiers').forEach(function (t) {
    var cur = firstTier[t.sku];
    if (!cur || toNum_(t.min_qty) < cur.min) firstTier[t.sku] = { min: toNum_(t.min_qty), price: toNum_(t.unit_price) };
  });

  var HEADERS = ['Code', 'Product Name', 'MRP', 'Selling Price Excluding GST', 'Stock'];
  brands.forEach(function (b) {
    var rows = products.filter(function (pr) { return pr.brand_id === b.brand_id; })
      .map(function (pr) {
        return [pr.sku, pr.name, toNum_(pr.mrp) || '',
                firstTier[pr.sku] ? firstTier[pr.sku].price : '', toNum_(pr.on_hand)];
      });
    var sh = ss.insertSheet(b.name);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#eef1ff');
    sh.setFrozenRows(1);
    if (rows.length) sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
    sh.autoResizeColumns(1, HEADERS.length);
  });
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);

  DriveApp.getFileById(ss.getId()).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  audit_(p.actor || 'admin', 'sync_template', ss.getId(), brands.length + ' brand tabs');
  return ok_({ url: ss.getUrl(), sheet_id: ss.getId(), name: name });
}

/** getEffectiveUser needs the userinfo.email scope — fall back gracefully. */
function ownerEmail_() {
  try { return Session.getEffectiveUser().getEmail() || 'the Merchforce backend account'; }
  catch (e) { return 'the Merchforce backend account'; }
}
