/** Merchforce — admin analytics: clicks + request trends over 30/60/90 days */

function fnAdminAnalytics_(p) {
  var windowDays = [30, 60, 90];
  var nowMs = now_().getTime();
  var DAY = 24 * 60 * 60 * 1000;

  var names = {};
  readRows_('Products').forEach(function (r) { names[r.sku] = r.name; });

  // --- Engagement: Events tab (view/click), aggregated per day already ---
  var events = readRows_('Events');
  var clicks = {}; // sku -> {30: n, 60: n, 90: n}
  events.forEach(function (ev) {
    if (ev.type !== 'view' && ev.type !== 'click') return;
    var age = (nowMs - new Date(ev.date + 'T00:00:00+05:30').getTime()) / DAY;
    windowDays.forEach(function (w) {
      if (age <= w) {
        clicks[ev.sku] = clicks[ev.sku] || { 30: 0, 60: 0, 90: 0 };
        clicks[ev.sku][w] += toNum_(ev.count);
      }
    });
  });

  // --- Demand: requested qty per SKU from actual request lines ---
  var reqDates = {};
  readRows_('Requests').forEach(function (r) { reqDates[r.request_id] = new Date(r.created).getTime(); });
  var demand = {}; // sku -> {30:{qty,reqs}, ...}
  readRows_('RequestLines').forEach(function (l) {
    var ts = reqDates[l.request_id];
    if (!ts) return;
    var age = (nowMs - ts) / DAY;
    windowDays.forEach(function (w) {
      if (age <= w) {
        demand[l.sku] = demand[l.sku] || { 30: { qty: 0, reqs: 0 }, 60: { qty: 0, reqs: 0 }, 90: { qty: 0, reqs: 0 } };
        demand[l.sku][w].qty += toNum_(l.qty);
        demand[l.sku][w].reqs += 1;
      }
    });
  });

  // --- Funnel: request counts by status ---
  var funnel = {};
  readRows_('Requests').forEach(function (r) { funnel[r.status] = (funnel[r.status] || 0) + 1; });

  // --- Requests per day, last 90 (for the trend line) ---
  var perDay = {};
  Object.keys(reqDates).forEach(function (id) {
    var age = (nowMs - reqDates[id]) / DAY;
    if (age <= 90) {
      var d = Utilities.formatDate(new Date(reqDates[id]), 'Asia/Kolkata', 'yyyy-MM-dd');
      perDay[d] = (perDay[d] || 0) + 1;
    }
  });

  function top(obj, key, w) {
    return Object.keys(obj).map(function (sku) {
      var v = key ? obj[sku][w][key] : obj[sku][w];
      return { sku: sku, name: names[sku] || sku, value: v, reqs: key ? obj[sku][w].reqs : undefined };
    }).filter(function (x) { return x.value > 0; })
      .sort(function (a, b) { return b.value - a.value; })
      .slice(0, 15);
  }

  return ok_({
    top_clicked: { 30: top(clicks, null, 30), 60: top(clicks, null, 60), 90: top(clicks, null, 90) },
    top_requested: { 30: top(demand, 'qty', 30), 60: top(demand, 'qty', 60), 90: top(demand, 'qty', 90) },
    funnel: funnel,
    requests_per_day: perDay
  });
}
