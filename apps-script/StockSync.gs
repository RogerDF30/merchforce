/**
 * Merchforce — supplier sheet sync, per brand.
 * The supplier keeps managing their catalog in their OWN Google Sheets — one
 * workbook (or tab) per brand, like the Wenger stock sheet. Each brand gets a
 * mapping {brand, sheet, tab, sku_col, fields:[{col, field}], create_new};
 * any sheet column can feed any syncable product field. A mapping bound to a
 * brand only touches that brand's products.
 *
 * Mappings live in Settings.sync_maps as a JSON array; each carries its own
 * last-run summary. Legacy maps with stock_col are migrated on read.
 */

// Product fields the sheet is allowed to write. 'price' means the FIRST price
// tier's unit price (the base selling price); deeper tiers stay admin-owned,
// as do reserved / safety stock / visibility.
var SYNC_FIELDS = {
  on_hand:   { label: 'Stock (on hand)', numeric: true },
  price:     { label: 'Selling price (first tier)', numeric: true },
  mrp:       { label: 'MRP', numeric: true },
  moq:       { label: 'MOQ', numeric: true },
  gst_rate:  { label: 'GST %', numeric: true },
  name:      { label: 'Product name' },
  lead_time: { label: 'Lead time' },
  description: { label: 'Description' },
  category:  { label: 'Category' },
  subcategory: { label: 'Subcategory' }
};

/** Legacy {stock_col} maps become fields:[{col, field:'on_hand'}]. */
function mapFields_(map) {
  if (map.fields && map.fields.length) return map.fields;
  if (map.stock_col) return [{ col: map.stock_col, field: 'on_hand' }];
  return [];
}

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
  var mode = m.mode === 'push' ? 'push' : 'pull';
  m.sheet = sheetIdFrom_(m.sheet);
  var fields = (m.fields || []).filter(function (f) { return f.col && SYNC_FIELDS[f.field]; });
  if (mode === 'pull' && (!m.sheet || !m.sku_col || !fields.length)) {
    return err_('Sheet, SKU column and at least one field mapping are required');
  }
  // A push mapping may be saved before the supplier's first push, when the
  // columns are not known yet — the connector discovers them for us.
  if (mode === 'push' && !m.brand) {
    return err_('A push mapping must be bound to one brand');
  }
  var seen = {};
  for (var i = 0; i < fields.length; i++) {
    if (seen[fields[i].field]) return err_('Field "' + SYNC_FIELDS[fields[i].field].label + '" is mapped twice');
    seen[fields[i].field] = 1;
  }
  if (m.create_new && !m.brand) {
    return err_('To auto-create new products, the mapping must be bound to one brand');
  }
  var maps = getSyncMaps_();
  var idx = toNum_(p.index);
  var rec = { mode: mode, brand: m.brand || '', sheet: m.sheet, tab: m.tab || '',
              sku_col: m.sku_col || '', fields: fields, create_new: !!m.create_new,
              push_key: '', headers: null, sample: null, last: null };
  if (p.index !== undefined && maps[idx]) {
    rec.last = maps[idx].last;
    rec.push_key = maps[idx].push_key || '';
    rec.headers = maps[idx].headers || null;
    rec.sample = maps[idx].sample || null;
    maps[idx] = rec;
  } else {
    maps.push(rec);
  }
  if (mode === 'push' && !rec.push_key) rec.push_key = 'mfp_' + randomToken_(24);
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

function emptySummary_() {
  return { ts: String(now_()), matched: 0, updated: 0, unchanged: 0, created: 0,
           unknown: 0, off_brand: 0, unknown_skus: [], created_skus: [], error: null };
}

/** PULL mode: Merchforce opens the supplier's sheet (needs Viewer access). */
function runStockSync_(map, actor) {
  if (map.mode === 'push') {
    var s = emptySummary_();
    s.error = 'Push mapping — the supplier\'s sheet sends the data; nothing to pull here';
    return s;
  }
  var headers, data;
  try {
    var o = openSupplierSheet_(map.sheet, map.tab || '');
    var lastCol = o.sh.getLastColumn();
    var lastRow = o.sh.getLastRow();
    headers = o.sh.getRange(1, 1, 1, lastCol).getValues()[0];
    data = lastRow > 1 ? o.sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  } catch (e) {
    var f = emptySummary_();
    f.error = e.message || String(e);
    audit_(actor || 'sync', 'sheet_sync', (map.brand || 'all') + ':' + map.sheet, f.error);
    return f;
  }
  return applySyncRows_(map, headers, data, actor);
}

/**
 * Shared engine: apply sheet rows to the catalog. Used by pull mode and by
 * PUSH mode, where the connector on the supplier's own sheet POSTs the rows
 * and Merchforce never touches (or needs access to) their file.
 */
function applySyncRows_(map, rawHeaders, data, actor) {
  var summary = emptySummary_();
  try {
    var fields = mapFields_(map);
    if (!fields.length) throw new Error('No field mappings — edit the mapping');
    var headers = (rawHeaders || []).map(function (h) { return String(h).trim(); });
    data = data || [];
    var iSku = headers.indexOf(String(map.sku_col).trim());
    if (iSku < 0) throw new Error('SKU column not found — re-map the columns');
    var fIdx = fields.map(function (f) {
      var i = headers.indexOf(String(f.col).trim());
      if (i < 0) throw new Error('Column "' + f.col + '" not found — re-map the columns');
      return { i: i, field: f.field, numeric: !!SYNC_FIELDS[f.field].numeric };
    });
    var data = lastRow > 1 ? o.sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];

    var incoming = {}; // skuKey -> {sku, values:{field: value}} (last row wins)
    data.forEach(function (row) {
      var rawSku = String(row[iSku]).trim();
      if (!rawSku) return;
      var values = {};
      fIdx.forEach(function (f) {
        var v = row[f.i];
        if (f.numeric) {
          var n = Number(v);
          values[f.field] = isNaN(n) ? null : Math.max(0, f.field === 'gst_rate' ? n : Math.floor(n * 100) / 100);
          if (f.field === 'on_hand' || f.field === 'moq') values[f.field] = values[f.field] === null ? null : Math.floor(values[f.field]);
        } else {
          values[f.field] = String(v === undefined || v === null ? '' : v).trim();
        }
      });
      incoming[skuKey_(rawSku)] = { sku: rawSku, values: values };
    });

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var sh = sheet_('Products');
      var cols = SHEETS.Products;
      var iUpdated = cols.indexOf('updated') + 1;
      var rows = readRows_('Products');

      // first-tier price index for the 'price' field
      var tierRows = readRows_('PriceTiers');
      var firstTierRow = {}; // skuKey -> {rowNum, min, price}
      tierRows.forEach(function (t, i) {
        var k = skuKey_(t.sku);
        if (!firstTierRow[k] || toNum_(t.min_qty) < firstTierRow[k].min) {
          firstTierRow[k] = { rowNum: i + 2, min: toNum_(t.min_qty), price: toNum_(t.unit_price) };
        }
      });
      var shT = sheet_('PriceTiers');

      var known = {};
      rows.forEach(function (r, i) {
        var k = skuKey_(r.sku);
        known[k] = 1;
        var inc = incoming[k];
        if (!inc) return;
        if (map.brand && r.brand_id !== map.brand) { summary.off_brand++; return; }
        summary.matched++;
        var changed = false;
        Object.keys(inc.values).forEach(function (field) {
          var v = inc.values[field];
          if (v === null) return;
          if (field === 'price') {
            var ft = firstTierRow[k];
            if (ft) {
              if (ft.price !== v) { shT.getRange(ft.rowNum, 3).setValue(v); changed = true; }
            } else {
              appendRecord_('PriceTiers', { sku: String(r.sku), min_qty: toNum_(r.moq) || 1, unit_price: v, gst: '' });
              changed = true;
            }
            return;
          }
          var iCol = cols.indexOf(field) + 1;
          if (iCol < 1) return;
          var cur = SYNC_FIELDS[field].numeric ? toNum_(r[field]) : String(r[field] === undefined ? '' : r[field]);
          var next = SYNC_FIELDS[field].numeric ? v : String(v);
          if (cur === next) return;
          sh.getRange(i + 2, iCol).setValue(next);
          changed = true;
          if (field === 'on_hand') {
            appendRecord_('StockLog', { ts: now_(), sku: String(r.sku), delta: next - cur,
              reason: 'sheet sync' + (map.brand ? ' (' + map.brand + ')' : ''), actor: actor || 'sync' });
          }
        });
        if (changed) {
          sh.getRange(i + 2, iUpdated).setValue(now_());
          summary.updated++;
        } else {
          summary.unchanged++;
        }
      });

      // rows in the sheet that are not in the catalog
      Object.keys(incoming).forEach(function (k) {
        if (known[k]) return;
        var inc = incoming[k];
        if (map.create_new && map.brand) {
          var v = inc.values;
          var moq = v.moq || 1;
          appendRecord_('Products', {
            sku: String(inc.sku).toUpperCase(), name: v.name || String(inc.sku),
            brand_id: map.brand, category: v.category || '', subcategory: v.subcategory || '',
            description: v.description || '', specs: '', image_urls: '',
            moq: moq, gst_rate: v.gst_rate === undefined || v.gst_rate === null ? 18 : v.gst_rate,
            lead_time: v.lead_time || '', on_hand: v.on_hand || 0, reserved: 0,
            safety_stock: 0, reorder_point: 0,
            visible: 'FALSE', show_price: 'TRUE', created: now_(), updated: now_(),
            mrp: v.mrp || ''
          });
          if (v.price) {
            appendRecord_('PriceTiers', { sku: String(inc.sku).toUpperCase(), min_qty: moq, unit_price: v.price, gst: '' });
          }
          summary.created++;
          if (summary.created_skus.length < 20) summary.created_skus.push(String(inc.sku));
        } else {
          summary.unknown++;
          if (summary.unknown_skus.length < 20) summary.unknown_skus.push(String(inc.sku));
        }
      });
    } finally {
      lock.releaseLock();
    }
    CacheService.getScriptCache().remove('catalog_v1');
  } catch (e) {
    summary.error = e.message || String(e);
  }
  audit_(actor || 'sync', 'sheet_sync', (map.brand || 'all') + ':' + map.sheet,
    summary.error || (summary.updated + ' updated, ' + summary.created + ' created, ' + summary.unknown + ' unknown'));
  return summary;
}

/** Scheduled auto-pull of every mapping: off | live5 (every 5 min) | hourly | daily (~06:00 IST). */
function fnAdminSyncSchedule_(p) {
  var mode = ['live5', 'hourly', 'daily'].indexOf(p.mode) >= 0 ? p.mode : 'off';
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncTick') ScriptApp.deleteTrigger(t);
  });
  if (mode === 'live5') ScriptApp.newTrigger('syncTick').timeBased().everyMinutes(5).create();
  if (mode === 'hourly') ScriptApp.newTrigger('syncTick').timeBased().everyHours(1).create();
  if (mode === 'daily') ScriptApp.newTrigger('syncTick').timeBased().everyDays(1).atHour(6).create();
  saveSettings_({ sync_auto: mode });
  audit_(p.actor || 'admin', 'sync_schedule', '', mode);
  return ok_({ mode: mode });
}

/**
 * TRUE live sync: a tiny connector script installed on the SUPPLIER'S sheet
 * (see the Live sync panel in Admin → Settings) POSTs {action:'syncPing',
 * sheet:<id>} here the moment a cell is edited. We debounce per sheet (45s)
 * and pull just the mappings for that sheet. Public action — the token
 * authorises it and it can only trigger a pull that admins configured.
 */
function fnSyncPing_(p) {
  var id = sheetIdFrom_(p.sheet);
  if (!id) return err_('sheet required');
  var maps = getSyncMaps_();
  var mine = [];
  maps.forEach(function (m, i) { if (m.sheet === id) mine.push(i); });
  if (!mine.length) return ok_({ synced: 0, note: 'No mapping uses this sheet' });

  var cache = CacheService.getScriptCache();
  if (cache.get('ping_' + id)) return ok_({ synced: 0, throttled: true });
  cache.put('ping_' + id, '1', 45);

  var touched = 0;
  mine.forEach(function (i) {
    var summary = runStockSync_(maps[i], 'live-sync');
    maps[i].last = summary;
    touched += (summary.updated || 0) + (summary.created || 0);
  });
  saveSyncMaps_(maps);
  return ok_({ synced: mine.length, touched: touched });
}

function syncTick() {
  var maps = getSyncMaps_();
  maps.forEach(function (m) { m.last = runStockSync_(m, 'auto-sync'); });
  if (maps.length) saveSyncMaps_(maps);
}

/**
 * PUSH mode — for suppliers who will NOT share their sheet.
 * A connector installed on their own sheet (generated per mapping in the
 * admin console) reads the rows under THEIR account and POSTs them here with
 * the mapping's push_key. Merchforce never opens, and never needs access to,
 * their file: only the columns they mapped ever leave it.
 *
 * The first push also reports the sheet's headers, so the admin can map the
 * columns without ever seeing the sheet.
 */
function fnSyncPush_(p) {
  var key = String(p.push_key || '');
  if (!key) return err_('push_key required');
  var maps = getSyncMaps_();
  var idx = -1;
  maps.forEach(function (m, i) { if (m.push_key && m.push_key === key) idx = i; });
  if (idx < 0) return err_('Unknown push key — re-copy the connector from the admin console');

  var headers = (p.headers || []).map(function (h) { return String(h).trim(); });
  if (!headers.length) return err_('No headers received (is row 1 of that tab empty?)');
  var rows = (p.rows || []).slice(0, 5000);

  // Remember what the sheet looks like so the mapping UI can offer its columns.
  maps[idx].headers = headers.slice(0, 30);
  maps[idx].sample = rows.slice(0, 3).map(function (r) {
    return r.slice(0, 30).map(function (c) { return String(c === null || c === undefined ? '' : c).slice(0, 40); });
  });

  var summary;
  if (!mapFields_(maps[idx]).length) {
    summary = emptySummary_();
    summary.awaiting_mapping = true;
    summary.error = 'Connected — now map the columns in the admin console';
    saveSyncMaps_(maps);
    audit_('push-sync', 'sheet_push', maps[idx].brand || '', 'awaiting mapping, ' + rows.length + ' rows');
    return ok_({ awaiting_mapping: true, headers: headers, rows: rows.length });
  }

  summary = applySyncRows_(maps[idx], headers, rows, 'push-sync');
  maps[idx].last = summary;
  saveSyncMaps_(maps);
  return ok_({ summary: summary });
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
