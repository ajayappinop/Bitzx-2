# IBO Admin Panel — Build Plan

This document is the blueprint for a **dedicated admin application** that manages users, money movement, compliance, and platform-level visibility. It aligns with the existing stack (**FastAPI + MongoDB**, **React + Vite + Tailwind**) and the **IBO exchange visual language** (dark surfaces, gold accents, high-contrast tables).

---

## 1. Goals & principles

| Goal | Approach |
|------|----------|
| Full operational control | Single pane for users, wallets, KYC, deposits/withdrawals, and read-only trading activity |
| User-level detail | Drill-down from global lists to one user: profile, KYC, balances, orders, trades, requests |
| Financial truth | Ledger-oriented views: inflows (deposits), outflows (withdrawals), fees collected (if modeled), optional “house” P&amp;L |
| Safe “login as user” | **Impersonation** with audit trail, banner in exchange UI, short-lived tokens, revocable sessions |
| UX parity | Reuse `ibo-exchange` tokens: `bg-surface-dark`, borders, `gold` / `gold-light`, dense tables, mobile horizontal scroll + stacked cards |
| Performance | Server-side pagination, filter/query params, debounced search; heavy exports async (future) |

**Non-goals for v1:** Replacing Binance connectivity, on-chain settlement automation, or a full matching-engine admin (beyond read-only monitoring if added later).

---

## 2. Architecture

### 2.1 Recommended layout

```
IBO-Exchange/
├── backend/ # FastAPI — extend with admin module├── ibo-exchange/          # End-user exchange (add impersonation banner)
└── ibo-admin/             # NEW: Vite + React + React Router + Tailwind
```

- **Why a separate app (`ibo-admin/`)?** Strong separation of admin JWT, routes, and CSP; avoids shipping admin bundles to retail users; easier to lock behind VPN / IP allowlist in production.
- **Alternative:** `/admin/*` inside `ibo-exchange` behind feature flag — acceptable for early demos; migrate to separate app before production hardening.

### 2.2 Authentication model (evolve from `X-Admin-Key`)

**Today:** `ADMIN_API_KEY` header on a few routes (KYC, deposits, withdrawals).

**Target:**

1. **`admin_users`** collection: `email`, `password_hash`, `role` (`superadmin`, `support`, `finance`), `is_active`, `created_at`, `last_login`.
2. **`POST /api/admin/auth/login`** → JWT with claims: `sub` = admin id, `typ: "admin"`, `role`.
3. **`Depends(get_current_admin)`** replaces raw key for all admin JSON APIs; keep **optional** `X-Admin-Key` only for emergency automation / CI with env flag.
4. **`admin_audit_logs`** collection: `admin_id`, `action`, `target_type`, `target_id`, `payload_snapshot`, `ip`, `created_at`.

### 2.3 Impersonation (“login as user”)

**Security requirements (mandatory):**

- Only roles **`superadmin`** (or explicit `impersonate` permission).
- **Short-lived JWT** (e.g. 15–30 min) with claims: `typ: "access"`, `sub` = **target user `uid`**, `impersonator` = admin id, `imp: true`.
- Exchange **`AuthContext`**: if token has `imp: true`, show persistent banner: “You are viewing as {user.email} — [Exit impersonation]”.
- **`POST /api/admin/impersonate/{uid}`** issues token; **`POST /api/admin/impersonate/end`** invalidates / client clears token.
- **Every** impersonation **logged** in `admin_audit_logs`.

**Implementation note:** Reuse existing `Authorization: Bearer` on exchange; decode `imp` in middleware or client to adjust UI. Admin panel never stores end-user passwords.

---

## 3. Backend: API surface (incremental)

### 3.1 Already present (wire to UI)

| Area | Endpoints (approx.) |
|------|---------------------|
| KYC | `POST /api/admin/kyc/{uid}/approve`, `.../reject` |
| Deposits | `POST /api/admin/deposits/{req_id}/approve|reject` |
| Withdrawals | `POST /api/admin/withdrawals/{req_id}/approve|reject` |

Normalize these to use **`Depends(get_current_admin)`** + audit logging.

### 3.2 New / expanded (planned)

**Users**

- `GET /api/admin/users` — pagination, `q` (email/name/uid), filters: `kyc_status`, `is_active`, date range.
- `GET /api/admin/users/{uid}` — full profile + aggregates (counts of orders, trades, deposits, withdrawals).
- `PATCH /api/admin/users/{uid}` — e.g. disable account, update notes (new field `admin_notes` on `users`).
- `GET /api/admin/users/{uid}/wallets` — mirror `/wallet/balances` for that uid.
- `GET /api/admin/users/{uid}/orders` — open + history (paginated).
- `GET /api/admin/users/{uid}/trades` — fills (paginated).
- `GET /api/admin/users/{uid}/deposits` / `.../withdrawals`.

**Queues (operations)**

- `GET /api/admin/deposits?status=pending` (list all users, sort, filter).
- `GET /api/admin/withdrawals?status=pending`.

**Analytics / treasury (read-only aggregates)**

- `GET /api/admin/stats/overview` — user count, pending KYC, pending deposit/withdraw counts, optional signups per day.
- `GET /api/admin/stats/flows` — sum deposits approved / withdrawals approved by day (from `deposit_requests`, `withdrawal_requests` + `wallets` deltas if you add ledger later).
- **Platform “profit/loss”:** v1 = **fee revenue** if you persist fees in a `platform_fees` collection or aggregate from `trades`; v2 = full **ledger** table for every balance change.

**Impersonation**

- `POST /api/admin/impersonate/{uid}` → `{ access_token, expires_in, user_summary }`
- `POST /api/admin/impersonate/revoke` (optional blacklist jti)

**Search / typeahead**

- `GET /api/admin/search/users?q=` — returns top N `{ uid, email, name }` for autocomplete (indexed email).

---

## 4. Admin panel UI — information architecture

### 4.1 Global shell

- **Sidebar / bottom nav (mobile):** Dashboard, Users, KYC, Deposits, Withdrawals, Trading activity (read-only), Reports, Settings (admins), Audit log.
- **Top bar:** global search (users), admin profile, logout, environment badge (`staging` / `prod`).
- **Theme:** copy `tailwind.config.js` color extensions from `ibo-exchange` (surface, gold, borders).

### 4.2 Screen-by-screen

| Screen | Primary widgets |
|--------|-----------------|
| **Dashboard** | KPI cards; pending deposit/withdraw counts; recent signups; quick links |
| **Users** | Data table: email, name, uid, KYC, active, created; filters; **row → User detail** |
| **User detail** | Tabs: Overview, Wallets, Orders, Trades, Deposits, Withdrawals, KYC docs (metadata), **Actions** (disable user, impersonate, approve KYC link) |
| **KYC queue** | Table of pending submissions; open detail → approve/reject with reason |
| **Deposits / Withdrawals** | Tabular queues; filters by asset, status, date; approve/reject with notes |
| **Trading (read-only)** | Optional: recent trades across users, symbol volume — powered by `trades` collection |
| **Treasury / P&amp;L** | Charts: net flow by day; table of fee income; export CSV (phase 2) |
| **Audit log** | Filter by admin, action, date; immutable list |

### 4.3 Table UX (your requirements)

- **Desktop:** sticky header, sortable columns where indexed, row actions dropdown.
- **Mobile:** card list per entity with key fields + “View”; horizontal scroll table as fallback.
- **Filters:** multi-select (KYC, status, asset), date range, amount range (deposits).
- **Search:** debounced input; **autocomplete** via `GET /api/admin/search/users`; highlight active filter chips with clear-all.

### 4.4 User context on “every screen”

- Optional **sticky “Selected user” bar** when navigated from user detail (store `uid` in URL `?user=...` or session store) so queues can deep-link “show only this user’s deposits”.

---

## 5. Data & “admin wallet / platform P&amp;L”

**Current reality:** Balances are per-user in `wallets`; there is no single “house wallet” document yet.

**v1 platform view:**

- **Inflow:** sum of approved `deposit_requests.amount` by asset / time.
- **Outflow:** sum of approved `withdrawal_requests.amount`.
- **Fees:** aggregate `taker_fee` / `maker_fee` from `trades` into USDT equivalent (respect `fee_asset`).
- **Net platform exposure:** heuristic = fees − (manual adjustments) — document assumptions in UI disclaimer.

**v2 (recommended later):** `ledger_entries` collection: every balance mutation writes one row (`uid`, `asset`, `delta`, `reason`, `ref_id`) for true reconciliation and admin “trial balance.”

---

## 6. Security & compliance checklist

- [ ] Admin app on **separate origin** or path; **CORS** restricted to admin origin only.
- [ ] **Rate limit** admin login and impersonation endpoints.
- [ ] **2FA** for admin accounts (phase 2).
- [ ] **IP allowlist** in production (reverse proxy or middleware).
- [ ] **Impersonation** heavily audited; consider requiring re-auth for impersonate.
- [ ] **GDPR / privacy:** restrict export roles; log data access.

---

## 7. Implementation phases

| Phase | Scope | Outcome |
|-------|--------|---------|
| **P0** | Admin JWT auth, `admin_users`, `get_current_admin`, audit log stub | Secure baseline |
| **P1** | Users list + detail + search API + Tailwind admin shell | Usable ops |
| **P2** | Deposit/withdraw queues in UI wired to existing approve/reject | Money movement |
| **P3** | KYC queue UI + user disable + notes | Compliance |
| **P4** | Impersonation + exchange banner + revoke | “Login as user” |
| **P5** | Overview stats + flows + fee rollup | Treasury view |
| **P6** | Ledger (optional), CSV exports, 2FA | Scale |

---

## 8. Handoff

- **Design tokens:** import from `ibo-exchange/tailwind.config.js` and `index.css` variables where possible.
- **Testing:** Playwright smoke for admin login + approve deposit; unit tests for audit middleware.
- **Docs:** Update root `README` with `ibo-admin` run instructions and env vars (`VITE_BACKEND_URL`, `ADMIN_*`).

This plan is the single source of truth for scope and sequencing; implement backend contracts before building each admin screen to avoid UI rework.
