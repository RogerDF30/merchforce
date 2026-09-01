# Merchforce

Single-supplier B2B merchandise storefront + supplier console. Buyers browse in-stock products, filter by brand, check quantity-tier pricing and raise bulk requests. The supplier manages catalog, brands, users, requests and analytics from the admin console.

Future home: **merchforce.io** (Cloudflare Pages). Current architecture:

```
Buyers / Admin (static site: GitHub Pages / Cloudflare Pages)
        │ POST JSON {token, action, …}
        ▼
Google Apps Script /exec  (apps-script/, ANYONE_ANONYMOUS)
        ├── Google Sheet "Merchforce Backend"   (all data)
        └── Drive folder  "Merchforce"          (Images/, Exports/)
```

## Layout

| Path | What |
|---|---|
| `index.html` + `assets/js/app.js` | Buyer storefront (brand bar, filters, request cart, gated-mode login) |
| `admin.html` + `assets/js/admin.js` | Supplier console (requests, catalog, brands, users, analytics, settings) |
| `assets/css/style.css` | Shared styles |
| `apps-script/` | Backend (clasp project) |
| `tools/mock_api.js` | Local mock backend + static server |
| `tools/seed_products.json` | Demo seed (sample of the real catalog sheet) |

## Local development

```
node tools/mock_api.js
# storefront  http://localhost:8900/
# admin       http://localhost:8900/admin.html   (key: admin2026)
# mock login for gated mode: any email + DemoPass2026!
```

The frontends auto-target the mock (`/api`, token `mf-demo-token`) when served from localhost.

## Deploying the backend

1. `cd apps-script && clasp push --force`
2. First time: `clasp create-deployment` → note the deployment id; afterwards `clasp update-deployment <id> --description "vN what changed"`.
3. First time only: open the script in the editor once and authorize scopes, then run **setup**: edit `SETUP_KEY` in `Config.gs`, push, and either run `setupRun` in the editor or `POST {action:"setup", key:"<SETUP_KEY>"}` to the /exec URL. It creates the Drive folder + Sheet, generates `API_TOKEN` and `ADMIN_PASS`, seeds demo data, and returns all of them **once** — store them, then rotate `SETUP_KEY`.
4. Put the /exec URL and `API_TOKEN` into `CONFIG` at the top of `assets/js/app.js` and `assets/js/admin.js`, commit, push.

## Stock / order model (industry pattern)

- Buyers see **ATP** = on hand − reserved − safety stock, never raw on-hand.
- A request/quote never reserves stock; PIs are "subject to prior sale".
- **Confirmed** reserves stock after an atomic ATP re-check (first confirmed wins; shortfall → partial/backorder/requote). **Dispatched** consumes it. Rejecting/expiring a confirmed request releases it.
- Request lifecycle: `New → Under Review → Quoted → Confirmed → Dispatched → Closed`, with `Rejected` / `Expired` branches.

## Settings that matter

- `access_mode`: `open` (anyone can browse + request) or `gated` (buyer accounts required) — Admin → Settings.
- `show_stock_numbers`: badge only, or exact ATP (applies to the storefront immediately on save).
- `notify_email`: gets an email on every new request.

## Supplier stock sync

The supplier keeps managing stock in their own Google Sheet. In Admin → Settings → Stock sync: paste the sheet link, share the sheet (Viewer) with the backend account, Load sheet, map the SKU and stock columns from its headers, then Sync now — or tick hourly auto-sync (time-driven trigger). On-hand is the only field written; reservations and safety stock stay owned by the request lifecycle. Every change lands in StockLog.

## Tax fields

Each product carries `gst_rate` and `hsn` on the master. Both are snapshotted onto the request lines when a buyer raises a request, so the Quotation Builder opens pre-filled and the PI prints the HSN column without retyping. Orders raised before a SKU had an HSN fall back to the product master when the order is opened. HSN is also a mappable sheet-sync field and a column in the generated supplier template.

## Pricing model

Quantity price tiers per product, RSM-style: the first tier must start at the MOQ (use MOQ 1 for a flat price at any quantity). GST is held per tier, blank inherits the product rate — set it per tier only when volume pricing crosses a tax slab.
