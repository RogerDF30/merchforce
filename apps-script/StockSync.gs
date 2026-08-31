/**
 * Merchforce — supplier stock sync.
 * The supplier keeps managing stock in their OWN Google Sheet. They share it
 * (Viewer is enough) with this script's owner, paste the sheet link/ID in
 * Admin → Settings → Stock sync, map the SKU and stock columns, and Merchforce
 * pulls on demand or hourly. On-hand is the only thing written; reservations
 * and safety stock stay lifecycle-owned here.
 */

function sheetIdFrom_(v) {
  var m = String(v || '').match(/\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : String(v || '').trim();
}

function openSupplierSheet_(id, tab) {
  var ss;
  try {
    ss = SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Cannot open that sheet. Check the ID, and share it (Viewer) with ' +
      Session.getEffectiveUser().getEmail());
  }
  var sh = tab ? ss.getSheetByName(tab) : ss.getSheets()[0];
  if (!sh) throw new Error('Tab "' + tab + '" not found in that sheet');
  return { ss: ss, sh: sh };
}

/** Step 1: open the supplier's sheet, return tabs + headers + a sample. */
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
    owner_hint: Session.getEffectiveUser().getEmail()
  });
}

/** Step 2: save the mapping and pull stock now. */
function fnAdminSyncRun_(p) {
  var s = getSettings_();
  var conf = {
    sheet: sheetIdFrom_(p.sheet !== undefined ? p.sheet : s.sync_sheet_id),
    tab: p.tab !== undefined ? p.tab : s.sync_tab,
    skuCol: p.sku_col !== undefined ? p.sku_col : s.sync_sku_col,
    stockCol: p.stock_col !== undefined ? p.stock_col : s.sync_stock_col
  };
  if (!conf.sheet || !conf.skuCol || !conf.stockCol) {
    return err_('Sheet, SKU column and stock column are all required');
  }
  saveSettings_({ sync_sheet_id: conf.sheet, sync_tab: conf.tab || '',
                  sync_sku_col: conf.skuCol, sync_stock_col: conf.stockCol });
  var summary = runStockSync_(conf, p.actor || 'admin');
  return summary.error ? err_(summary.error) : ok_(summary);
}

function runStockSync_(conf, actor) {
  var summary = { ts: String(now_()), matched: 0, updated: 0, unchanged: 0,
                  unknown: 0, unknown_skus: [], error: null };
  try {
    var o = openSupplierSheet_(conf.sheet, conf.tab || '');
    var lastCol = o.sh.getLastColumn();
    var lastRow = o.sh.getLastRow();
    var headers = o.sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    var iSku = headers.indexOf(String(conf.skuCol).trim());
    var iStock = headers.indexOf(String(conf.stockCol).trim());
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
        known[sku] = 1;
        if (!(sku in incoming)) return;
        summary.matched++;
        var cur = toNum_(r.on_hand), next = incoming[sku];
        if (cur === next) { summary.unchanged++; return; }
        sh.getRange(i + 2, iOnHand).setValue(next);
        sh.getRange(i + 2, iUpdated).setValue(now_());
        appendRecord_('StockLog', { ts: now_(), sku: r.sku, delta: next - cur,
                                    reason: 'sheet sync', actor: actor || 'sync' });
        summary.updated++;
      });
      Object.keys(incoming).forEach(function (sku) {
        if (!known[sku]) {
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
  saveSettings_({ sync_last: JSON.stringify(summary) });
  audit_(actor || 'sync', 'stock_sync', conf.sheet,
    summary.error || (summary.updated + ' updated, ' + summary.unknown + ' unknown'));
  return summary;
}

/** Step 3 (optional): hourly auto-pull. */
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
  var s = getSettings_();
  if (!s.sync_sheet_id || !s.sync_sku_col || !s.sync_stock_col) return;
  runStockSync_({ sheet: s.sync_sheet_id, tab: s.sync_tab,
                  skuCol: s.sync_sku_col, stockCol: s.sync_stock_col }, 'auto-sync');
}
