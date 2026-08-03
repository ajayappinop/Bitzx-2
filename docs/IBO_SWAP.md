# IBO ↔ USDT Swap (Wallet)

Instant conversion using a **IBOUSDT market order** (same KYC, fees, and `trading_enabled` gate as spot).

## API

| Method | Path | Auth | Body / query |
|--------|------|------|----------------|
| GET | `/api/wallet/swap/config` | Public | Admin swap fee knobs (`swap_fee_rate`, `swap_fee_ibo_fixed`) |
| GET | `/api/wallet/swap/quote` | User JWT | `direction=ibo_to_usdt` or `usdt_to_ibo`, `amount` (source asset) |
| POST | `/api/wallet/swap` | User JWT | `{ "direction", "amount" }` |

Quote response includes `to_amount_estimated`, `price_usdt`, `fee_ibo_estimated` (platform swap fee in IBO), `trading_fee_ibo_estimated`, `fee_ibo_total`, `available_from`, `min_from_amount`.

**Admin:** Settings → **Limits & Risk** → **IBO ↔ USDT swap fees** — `swap_fee_rate` (% of USDT notional) and `swap_fee_ibo_fixed` (flat IBO per swap). Deducted on execute via `charge_ibo_fee`; market order may also charge taker fee in IBO.

Execute returns an `OrderOut` (market order on `IBOUSDT`).

Backend logic: `backend/services/ibo_swap.py` · routes in `backend/server.py`.

## Flow (verified)

1. **Quote** — validates min size, loads IBOUSDT price, estimates receive + IBO fee.
2. **Execute** — builds `sell` (IBO→USDT) or `buy` (USDT→IBO) market order via `_execute_place_order`.
3. **Requirements** — user must have enough **source** balance; enough **IBO** for the trading fee; KYC trading gate; `trading_enabled` platform flag.

Unit tests: `backend/tests/test_ibo_swap.py` (`pytest backend/tests/test_ibo_swap.py`).

## Mobile (wired)

| Entry | Path |
|-------|------|
| Wallet tab | **Wallet → Swap** |
| IBO row | **Spot balances → Swap** on IBO |
| Home | **Quick action → Swap** (opens wallet swap tab) |

Files: `IboSwapTab.tsx`, `wallet.api.ts`, `wallet.tabs.ts`.

## Web exchange (`ibo-exchange`)

**This repo snapshot does not include the full Vite exchange app** (no `package.json` / Wallet page). Only drop-in components are present:

| File | Role |
|------|------|
| `src/components/wallet/IboSwapPanel.jsx` | UI + segment + fee check |
| `src/components/wallet/WalletSwapHost.jsx` | Loads balances + renders panel |
| `src/lib/walletSwapApi.js` | `createAuthFetch`, quote, execute |

**Where to put it on web:** the logged-in **Wallet / Portfolio** page (typically route `/wallet`), above or beside spot balances.

```jsx
import WalletSwapHost from '@/components/wallet/WalletSwapHost';

<WalletSwapHost
  apiBase={import.meta.env.VITE_API_URL}
  getAccessToken={() => localStorage.getItem('access_token')}
  iboLogoUrl={tickerOrMarkets?.IBOUSDT?.logo_url}
/>
```

See `ibo-exchange/README.md`.

## Not on the marketing site

`frontend/` (port 3000) is the **token marketing site** only — no wallet swap UI there.
