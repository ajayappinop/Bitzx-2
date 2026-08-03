# Perpetual Futures Module

A self-contained, USDT-margined perpetual futures engine that lives
*alongside* the existing spot trading system. Spot data lives in
`wallets`/`orders`/`trades`; futures data lives in `futures_*`
collections with a separate matching engine and risk model.

## Folder structure

```
backend/futures/
├── __init__.py
├── api.py                   # REST router → /api/futures/...
├── ws.py                    # WebSocket router → /ws/futures/...
├── deps.py                  # JWT auth dependencies (mirrors server.py)
├── bootstrap.py             # ensure_indexes + start workers
├── constants.py             # symbols, tiers, fees, cadences
├── db.py                    # mongo collection helpers + indexes
├── models.py                # pydantic request/response shapes
├── services/
│   ├── ledger.py            # futures wallet ledger primitives
│   ├── wallet.py            # snapshot + spot↔futures transfer
│   ├── risk.py              # leverage tiers, IMR/MMR, liq price
│   ├── position.py          # open/increase/reduce/flip/force_close
│   ├── orders.py            # place/cancel/list + book aggregator
│   ├── matching.py          # price-time priority + synthetic fill
│   ├── mark_price.py        # binance index + local mid blend
│   ├── liquidation.py       # scan + force-close underwater positions
│   └── funding.py           # premium sample, rate, settle
└── workers/
    ├── mark_price_worker.py     # refresh mark, mark-to-market positions
    ├── liquidation_worker.py    # scan symbols on every tick
    └── funding_worker.py        # settle every FUNDING_INTERVAL_SEC
```

## How it talks to the rest of the app

* **DB**: Reuses `services.db.get_db()` so it shares the same Motor
  client. All collections are prefixed with `futures_`.
* **Auth**: `futures.deps.current_user` decodes the same JWT issued by
  `server.py`'s `/api/auth/*` endpoints. Existing user accounts work
  immediately.
* **Spot wallet**: Transfers go through `services.wallet_service` for
  the spot leg and `futures.services.ledger` for the futures leg, in a
  single Mongo transaction when supported.
* **Mark price**: Best-effort uses `services.hedger_service`'s Binance
  client when initialized; otherwise falls back to local order-book
  mid. Independent of whether the hedger is enabled.
* **Trading**: Completely independent matching engine and order book —
  spot orders cannot match futures orders and vice versa.

## REST endpoints (all under `/api/futures`)

Public:

| Method | Path                                  | Purpose                               |
| ------ | ------------------------------------- | ------------------------------------- |
| GET    | `/symbols`                            | Listed perps + leverage options       |
| GET    | `/mark-price?symbol=`                 | Latest mark/index snapshot            |
| GET    | `/orderbook?symbol=&depth=`           | Aggregated price-level depth          |
| GET    | `/trades?symbol=&limit=`              | Recent trades on the tape             |
| GET    | `/funding-rate?symbol=`               | Latest settled funding rate           |

Authenticated:

| Method | Path                          | Purpose                                              |
| ------ | ----------------------------- | ---------------------------------------------------- |
| GET    | `/wallet`                     | Margin balance + free margin + unrealized PnL        |
| POST   | `/wallet/transfer`            | Spot ↔ futures transfer (USDT)                       |
| GET    | `/wallet/txns`                | Paginated futures wallet ledger                      |
| GET    | `/settings?symbol=`           | Per-symbol leverage + margin mode                    |
| POST   | `/leverage`                   | Update preferred leverage                            |
| POST   | `/margin-mode`                | Switch isolated/cross (only when no open position)   |
| POST   | `/orders`                     | Place limit/market/stop_limit                        |
| DELETE | `/orders/{id}`                | Cancel an open order                                 |
| GET    | `/orders/open`                | User's open orders                                   |
| GET    | `/orders/history`             | User's filled/cancelled/rejected orders              |
| GET    | `/trades/me`                  | User's own trade history                             |
| GET    | `/positions`                  | Open positions w/ live PnL & liq price               |
| GET    | `/positions/history`          | Closed positions                                     |
| POST   | `/positions/close`            | Reduce / fully close a position via reduce-only mkt  |

## WebSockets

| Path                              | Auth        | Payload                                                                                |
| --------------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `/ws/futures/markets`             | none        | `{type, markets:[{symbol, mark_price, index_price, ts}], updated_at}`                  |
| `/ws/futures/orderbook?symbol=`   | none        | `{type, symbol, book:{bids,asks}, recent_trades, mark, updated_at}`                    |
| `/ws/futures/account?token=`      | user JWT    | `{type, wallet, positions, open_orders, order_history, user_trades, updated_at}`       |

## Database collections

| Collection                  | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| `futures_wallets`           | One row per `(uid, asset)`; tracks `available` and `locked` margin     |
| `futures_wallet_txns`       | Append-only ledger (transfers, margin lock/unlock, fees, PnL, funding) |
| `futures_orders`            | Live + historical orders (status: open/partially_filled/filled/…)      |
| `futures_trades`            | Tape of fills (taker/maker UIDs, price, qty, synthetic flag)           |
| `futures_positions`         | One row per `(uid, symbol)`; `status` ∈ {open, closed, settings}        |
| `futures_liquidations`      | Audit trail of every force-closed position                             |
| `futures_funding_rates`     | One row per `(symbol, settled_at)`                                     |
| `futures_funding_payments`  | Per-position settlement of each funding window                          |
| `futures_mark_prices`       | TTL-bounded history of mark snapshots (used by chart & liq scanner)    |

## Risk model

* **Leverage tiers** in `constants.LEVERAGE_TIERS`; effective IMR is
  `max(1/leverage, tier_imr)`.
* **Maintenance margin rate** comes from the same tier ladder.
* **Liquidation price** computed once at fill and refreshed when the
  position is increased (`risk.liquidation_price`).
* **Insurance haircut** + `LIQUIDATION_FEE_RATE` in the formula give the
  liquidation engine a small cushion before the position is
  mathematically bankrupt.
* **Reduce-only** orders never lock new margin and never flip side.
* **Funding cap** at ±0.75% per period.

## Frontend

```
ibo-exchange/src/
├── pages/FuturesTradePage.jsx
├── context/FuturesContext.jsx       # global state + WS wiring
├── services/futuresApi.js           # REST + WS helpers
└── components/futures/
    ├── FuturesChart.jsx             # adapter over TVChart
    ├── FuturesOrderBook.jsx
    ├── FuturesRecentTrades.jsx
    ├── FuturesTradeForm.jsx         # buy/sell + leverage + reduce-only
    ├── FuturesPositions.jsx         # 50% / close buttons
    ├── FuturesOpenOrders.jsx
    ├── FuturesOrderHistory.jsx
    ├── FuturesWalletPanel.jsx
    ├── TransferModal.jsx
    └── LeverageSelector.jsx
```

Routes added to `App.jsx`:

* `/futures` and `/futures/:symbol` → `FuturesTradePage`

A "Futures" link is present in the desktop and mobile navbars.

## Configuration

Environment variables (already used by `server.py`):

* `JWT_SECRET_KEY`, `JWT_ALGORITHM` — re-read by `futures.deps`.
* `BINANCE_API_KEY` / `BINANCE_TESTNET_API_KEY` — when set, the existing
  `services.hedger_service` client is used to source the index price for
  mark-price calculation. Without these the engine falls back to the
  local order-book mid and the last trade.

To plug in a different mark feed, replace `_binance_index()` in
`services/mark_price.py`.

## Running

The futures bootstrap is invoked automatically from
`backend/server.py` on startup; nothing additional is required. The
following are added/modified in `server.py`:

```python
# imports
from futures.api import router as futures_router
from futures.ws  import router as futures_ws_router
from futures.bootstrap import bootstrap_futures, shutdown_futures

# startup
await bootstrap_futures()

# router include (after existing api_router include)
app.include_router(futures_router)
app.include_router(futures_ws_router)

# shutdown
await shutdown_futures()
```

That's it — the engine is live as soon as you restart the API server.

## Production notes / next steps

* The matching engine uses a single `asyncio.Lock` for safety during
  initial rollout. For higher throughput, switch to a per-symbol lock or
  an in-memory order book sharded by symbol with an event-sourced
  Mongo replay path.
* The WS feeds use a 1s polling cadence as a simple starting point.
  Replace with an event bus (Redis pub/sub or Mongo change streams) and
  emit on every fill / position update for true push-style updates.
* Funding interest rate is hard-coded to 1bp/day; surface as a
  `platform_controls` knob if your treasury wants finer control.
* Insurance fund: the engine currently absorbs underwater closes
  silently. Add an `insurance_fund` collection + funding inflows to
  formalise it.
* Conditional orders (`stop_limit`, `stop_market`, `take_profit`) are
  inserted with `triggered` semantics but the trigger scanner is left as
  a TODO — wire it into `liquidation_worker` (it already runs every 1s
  and has access to mark prices).
* Hedge integration: SYSTEM (synthetic) fills mirror the spot engine's
  pattern; route their net exposure through `services.hedger_service`
  the same way `treasury_service` does for spot.
