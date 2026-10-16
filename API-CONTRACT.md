# API Contract — Laravel backend (shared by website + mobile app)

Base URL: `EXPO_PUBLIC_API_URL` in the app, `NEXT_PUBLIC_API_URL` on the web
(e.g. `http://localhost:8001/api`). JSON only.

**Every request needs a client key.** Public endpoints answer `401` without the
`X-Client-Key` header (see `backend/config/clients.php`). The app sends
`EXPO_PUBLIC_API_CLIENT_KEY`, which must match `API_CLIENT_KEY_MOBILE` in
`backend/.env` — never the web key, so a leaked mobile key can be revoked on
its own. It ships inside the binary and is extractable: it buys attribution and
per-client rate limiting, not secrecy. Real authorisation is the per-user
Sanctum bearer token.
All prices are **integer Naira**: `220000` renders as `₦220,000`.

## GET /products
Query: `category` (wigs|bundles|frontals|closures|coloured), `q` (free-text
search), `sort` (featured|price_asc|price_desc|newest|rating), `min`/`max`
(whole ₦), `length`/`grade`/`lace`/`texture` (COMMA-JOINED multi-select),
`page`, `per_page`.

Use `meta.total` for a result count — `data.length` is one page.
```json
{
  "data": [{
    "id": 1, "slug": "brazilian-body-wave",
    "name": "Brazilian Body Wave", "category": "wigs",
    "spec": "16\" · glueless", "price": 220000, "compare_at": 270000,
    "rating": 4.9, "reviews_count": 212, "sold_count": 1400,
    "image": null, "badge": "SALE", "code_prefix": "LX"
  }],
  "meta": { "current_page": 1, "last_page": 21, "total": 248 }
}
```

## GET /products/{slug}
Everything above plus:
```json
{
  "description": "…",
  "lengths": ["12\"","14\"","16\"","18\"","20\"","22\""],
  "colours": [{ "name": "Natural Black", "hex": "#1A1420" }],
  "densities": ["150%","180%","200%"],
  "specs": { "Hair type": "100% raw virgin human hair", "Grade": "12A double-drawn",
             "Texture": "Body Wave", "Lace / cap material": "HD Swiss lace",
             "Cap construction": "Glueless — 4×4 closure", "Density": "180% (150–200%)",
             "Lengths": "12\"–22\"", "Weight": "~280g", "Lifespan": "2+ years",
             "Origin": "Ethically sourced" },
  "images": [],
  "reviews": [{ "author": "Ama M.", "location": "Accra", "rating": 5,
                "body": "…", "variant": "14\"", "date": "2026-06-18", "verified": true }]
}
```

## GET /preparation-options
The "Preparation & delivery" selector (website PDP; add to app product screen when asked).
`surcharge` in Naira; 0 renders as "Included".
```json
[
  { "id": "bundles", "title": "Deliver in bundles", "caption": "Raw sealed bundles, exactly as supplied", "surcharge": 0, "default": true },
  { "id": "wigging", "title": "Hair wigging", "caption": "Machine-wefted into a full wig unit", "surcharge": 35000 },
  { "id": "rtw-closure", "title": "Ready-to-wear · 4×4 / 5×5 closure", "caption": "Constructed, plucked & styled", "surcharge": 45000 },
  { "id": "rtw-frontal", "title": "Ready-to-wear · 13×4 frontal", "caption": "Constructed, plucked & styled", "surcharge": 60000 }
]
```
Lead-time note: wigging & styling add 2–3 working days.

## POST /orders  (auth — MEMBERS ONLY)
Guest checkout is not supported: the backend requires a bearer token, because
"every order must belong to an account (contactable customer, real order
history, wallet eligibility)" (routes/api.php). The app gates its checkout
screen on sign-in rather than letting someone fill the form and meet a 401.

```json
{
  "customer": { "first_name": "", "last_name": "", "email": "", "phone": "" },
  "delivery": { "address": "", "city": "", "state": "", "country": "NG", "method": "standard" },
  "packaging": "standard",
  "lines": [{ "product_id": 1, "length": "16\"", "colour": "Natural Black",
              "density": "180%", "preparation": "wigging", "qty": 1,
              "unit_price": 220000, "surcharge": 35000 }],
  "totals": { "subtotal": 255000, "delivery": 0, "total": 255000 },
  "payment": { "method": "paystack" }
}
```
→ `201 { "order_id": "LX-10294", "status": "pending_payment", "payment_url": "…" }`
(Paystack init happens Laravel-side; the app opens `payment_url` in a browser sheet.)

## GET /products/facets
The filter sheet's options, from the live catalogue, each with a count. Groups:
`categories`, `wig_types`, `lengths`, `grades`, `laces`, `textures`, `caps`,
`thicknesses`, `sources`, plus `price: { min, max }`.
```json
{ "grades": [{ "value": "12A", "count": 41 }], "price": { "min": 29000, "max": 353000 } }
```

## GET /wallet  (auth)
Store credit. **No mock fallback** — a balance is money, so the screen shows
nothing rather than a guess when this is unavailable.
```json
{
  "balance": 17000,
  "welcome": { "amount": 17000, "enabled": true, "claimed": false, "eligible": false },
  "withdrawable": 0, "income_earned": 0,
  "withdrawal_min": 5000, "withdrawals_enabled": true,
  "transactions": [{ "id": 1, "amount": 17000, "type": "welcome", "label": "Welcome credit", "at": "2026-09-03T…" }]
}
```
`POST /wallet/welcome/claim` claims the welcome credit (server-guarded against
a double claim).

## Auth
`POST /auth/login`, `POST /auth/register` → `{ token, user }`. The API answers a
wrong email and a wrong password identically — deliberate anti-enumeration; do
not try to be more specific in the UI.

## POST /newsletter
`{ "email": "…" }` → `201`.

## Later milestones (designed, don't build yet)
Auth (Sanctum tokens), wallet & store credit, Thrift listings + ownership trace by
unique code, pre-order deposits (20%), referrals.
