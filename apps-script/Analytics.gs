/**
 * Merchforce — admin analytics, RSM-style.
 * One call returns everything for a window: {days: 30|90|180|365}.
 */

function fnAdminAnalytics_(p) {
  var days = toNum_(p.days) || 90;
  if ([30, 90, 180, 365].indexOf(days) < 0) days = 90;
  var DAY = 24 * 60 * 60 * 1000;
  var nowMs = now_().getTime();
  var cutoff = nowMs - days * DAY;

  var products = readRows_('Products');
  var names = {}, catalogueSize = 0;
  products.forEach(function (r) {
    names[skuKey_(r.sku)] = r.name;
    if (isTrue_(r.visible)) catalogueSize++;
  });

  // ---------- requests in window ----------
  var all = readRows_('Requests');
  var inWin = all.filter(function (r) { return new Date(r.created).getTime() >= cutoff; });
  var byStatus = {}, value = 0;
  inWin.forEach(function (r) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    value += toNum_(r.total_est);
  });
  var count = inWin.length;

  // decision metrics
  var quoteHours = [], closeDays = [], awaiting = 0, awaitingOld = 0;
  var converted = 0, decided = 0;
  inWin.forEach(function (r) {
    var dates = safeJson_(r.status_dates);
    var createdMs = new Date(r.created).getTime();
    if (dates.Quoted) quoteHours.push((new Date(dates.Quoted).getTime() - createdMs) / 3600000);
    if (dates.Closed) closeDays.push((new Date(dates.Closed).getTime() - createdMs) / DAY);
    if (r.status === 'New' || r.status === 'Under Review') {
      awaiting++;
      if (nowMs - createdMs > 3 * DAY) awaitingOld++;
    }
    var conv = ['Confirmed', 'Dispatched', 'Closed'].indexOf(r.status) >= 0;
    var dead = ['Rejected', 'Expired'].indexOf(r.status) >= 0;
    if (conv) converted++;
    if (conv || dead) decided++;
  });

  // weekly trend
  var weeks = {};
  inWin.forEach(function (r) {
    var d = new Date(r.created);
    var monday = new Date(d.getTime() - ((d.getDay() + 6) % 7) * DAY);
    var key = Utilities.formatDate(monday, 'Asia/Kolkata', 'yyyy-MM-dd');
    weeks[key] = weeks[key] || { requests: 0, value: 0 };
    weeks[key].requests++;
    weeks[key].value += toNum_(r.total_est);
  });
  var trend = Object.keys(weeks).sort().map(function (k) {
    return {
      week: Utilities.formatDate(new Date(k), 'Asia/Kolkata', 'd MMM'),
      requests: weeks[k].requests, value: Math.round(weeks[k].value)
    };
  });

  // ---------- products ----------
  var reqTs = {};
  all.forEach(function (r) { reqTs[r.request_id] = new Date(r.created).getTime(); });
  var everRequested = {}, units = {}, lineValue = {};
  readRows_('RequestLines').forEach(function (l) {
    var k = skuKey_(l.sku);
    everRequested[k] = 1;
    var ts = reqTs[l.request_id];
    if (!ts || ts < cutoff) return;
    units[k] = (units[k] || 0) + toNum_(l.qty);
    lineValue[k] = (lineValue[k] || 0) + toNum_(l.line_total);
  });
  function top(obj, fmt) {
    return Object.keys(obj).map(function (sku) {
      return { sku: sku, name: names[sku] || sku, value: obj[sku] };
    }).sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
  }
  var neverRequested = products.filter(function (r) {
    return isTrue_(r.visible) && !everRequested[skuKey_(r.sku)];
  }).map(function (r) {
    return { sku: String(r.sku), name: r.name, category: r.category, moq: toNum_(r.moq) };
  });

  // ---------- traffic (Events) ----------
  var t = { views: 0, clicks: 0 };
  var viewed = {}, searches = {}, searchesNil = {};
  readRows_('Events').forEach(function (ev) {
    var ts = new Date(ev.date + 'T00:00:00+05:30').getTime();
    if (isNaN(ts) || ts < cutoff) return;
    var n = toNum_(ev.count);
    if (ev.type === 'view') { t.views += n; viewed[skuKey_(ev.sku)] = (viewed[skuKey_(ev.sku)] || 0) + n; }
    if (ev.type === 'click') t.clicks += n;
    if (ev.type === 'search') searches[ev.sku] = (searches[ev.sku] || 0) + n;
    if (ev.type === 'search_nil') searchesNil[ev.sku] = (searchesNil[ev.sku] || 0) + n;
  });
  function topKeys(obj) {
    return Object.keys(obj).map(function (k) { return { key: k, count: obj[k] }; })
      .sort(function (a, b) { return b.count - a.count; }).slice(0, 10);
  }

  return ok_({
    generated_at: Utilities.formatDate(now_(), 'Asia/Kolkata', 'd MMM yyyy, h:mm a'),
    days: days,
    requests: {
      count: count, value: Math.round(value),
      average: count ? Math.round(value / count) : 0,
      by_status: byStatus
    },
    decision: {
      conversion_rate: decided ? Math.round(converted / decided * 100) : null,
      median_hours_to_quote: median_(quoteHours),
      median_days_to_close: median_(closeDays),
      awaiting: awaiting, awaiting_over_3_days: awaitingOld
    },
    trend: trend,
    products: {
      top_by_units: top(units),
      top_by_value: top(lineValue),
      never_requested: neverRequested.slice(0, 25),
      never_requested_total: neverRequested.length,
      catalogue_size: catalogueSize
    },
    traffic: {
      product_views: t.views,
      add_to_list: t.clicks,
      requests_submitted: count,
      funnel: [
        { step: 'Product views', n: t.views },
        { step: 'Added to request list', n: t.clicks },
        { step: 'Requests submitted', n: count },
        { step: 'Confirmed', n: (byStatus.Confirmed || 0) + (byStatus.Dispatched || 0) + (byStatus.Closed || 0) }
      ],
      top_viewed: topKeys(viewed).map(function (r) {
        return { sku: r.key, name: names[r.key] || r.key, count: r.count };
      }),
      top_searches: topKeys(searches),
      searches_with_nothing: topKeys(searchesNil)
    }
  });
}

function median_(arr) {
  if (!arr.length) return null;
  arr.sort(function (a, b) { return a - b; });
  var mid = Math.floor(arr.length / 2);
  var m = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  return Math.round(m * 10) / 10;
}
