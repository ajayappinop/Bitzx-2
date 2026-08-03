/**

 * TradePage — Delta-style terminal (same shell as FuturesTradePage).

 *

 * Single viewport calc(100dvh - navbar):

 *   header → chart | order book | trade form → compact bottom dock (orders / trades)

 */

import { useState, useEffect, useCallback, useMemo } from 'react';

import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';

import {

  TrendingUp, TrendingDown,

  RefreshCw, X, Clock, CheckCircle, AlertCircle,

  BarChart2, DollarSign,

} from 'lucide-react';

import {

  COIN_ICONS,

  coinIconUrl,

  exchangeWsPath,

  INTERNAL_SPOT_SYMBOL,

  isIboMockMarketSymbol,

  marketApi,

  apiSymbolFromRouteParam,

  normalizeTradeRouteSymbol,

  tradePathForApiSymbol,

  tradeSymbolFromRouteParam,

  displayBaseForApiSymbol,

  displayPairSlash,

  parsePairFromApiSymbol,

  walletAssetLabel,

} from '@/services/marketApi';

import { useIBOMarket } from '@/hooks/useIBOMarket';

import IBOChart from '@/components/IBOChart/IBOChart';

import IBOTrades from '@/components/IBOTrades/IBOTrades';

import { useAuth, authFetch } from '@/context/AuthContext';

import { exchangeApiOrigin } from '@/lib/apiBase';

import { useToast, friendlyError } from '@/context/ToastContext';

import TradingChart    from '@/components/trading/TradingChart';

import TradePairPicker from '@/components/trading/TradePairPicker';

import OrderBook       from '@/components/trading/OrderBook';

import RecentTrades    from '@/components/trading/RecentTrades';

import TradeForm       from '@/components/trading/TradeForm';

import ClosePositionModal from '@/components/trading/ClosePositionModal';



const ACCENT = '#FE6C02';



// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtP = (v, base) => {

  const n = parseFloat(v); if (!n) return '—';

  if (base === 'BTC') return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })

       : n >= 1    ? n.toFixed(4)

                   : n.toFixed(6);

};

const fmtVol = v => {

  const n = parseFloat(v); if (!n) return '—';

  return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B'

       : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M'

       : n >= 1e3 ? (n / 1e3).toFixed(2) + 'K'

                  : n.toFixed(2);

};



function StatItem({ label, value, color }) {

  return (

    <div className="flex flex-col gap-0.5 px-3 first:pl-0 shrink-0 border-l border-[color:var(--ibo-border)] first:border-l-0">

      <span className="text-[10px] text-[color:var(--ibo-muted)] whitespace-nowrap leading-none">{label}</span>

      <span className={`text-[12px] font-mono font-semibold tabular-nums whitespace-nowrap leading-tight ${color ?? 'text-[color:var(--ibo-ink)]'}`}>{value}</span>

    </div>

  );

}



const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);



// ─── Date formatter ───────────────────────────────────────────────────────────

const ORDER_FMT = iso => new Date(iso).toLocaleString('en-US', {

  month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,

});

const fmtOrdP = v => {

  const n = parseFloat(v);

  return n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })

       : n >= 1    ? n.toFixed(4)

                   : n.toFixed(6);

};



async function parseApiError(res) {

  try {

    const j = await res.json();

    if (typeof j.detail === 'string') return j.detail;

    if (Array.isArray(j.detail)) {

      return j.detail.map(e => (typeof e === 'string' ? e : e.msg || JSON.stringify(e))).join('; ');

    }

    return res.statusText || 'Request failed';

  } catch {

    return res.statusText || 'Request failed';

  }

}



/** Short context line under tabs (Binance-style “what is this table”). */

function TabHint({ children }) {

  return (

    <div

      style={{

        padding: '10px 22px 12px',

        fontSize: 12,

        color: 'var(--ibo-ink)',

        lineHeight: 1.5,

        borderBottom: '1px solid var(--ibo-border)',

        background: 'var(--ibo-elevated)',

      }}

    >

      {children}

    </div>

  );

}



/** Two-line column header: title + plain-English hint. */

function Th({ main, sub, align, title: tip }) {

  const a = align === 'right' ? 'right' : 'left';

  return (

    <span

      title={tip}

      style={{

        textAlign: a,

        display: 'flex',

        flexDirection: 'column',

        gap: 4,

        fontSize: 11,

        color: 'var(--ibo-ink)',

        textTransform: 'uppercase',

        letterSpacing: '0.06em',

        fontWeight: 800,

      }}

    >

      <span>{main}</span>

      {sub ? (

        <span

          style={{

            fontSize: 10,

            fontWeight: 600,

            color: 'var(--ibo-ink)',

            textTransform: 'none',

            letterSpacing: '0.02em',

            lineHeight: 1.3,

            whiteSpace: 'normal',

          }}

        >

          {sub}

        </span>

      ) : null}

    </span>

  );

}



function shortOrderId(id) {

  if (!id || typeof id !== 'string') return '—';

  return id.length > 14 ? `${id.slice(0, 10)}…` : id;

}



// ─── Positions tab — live P&L (via AuthContext /ws/exchange/account) ─────────

function PositionsTab({ activePair }) {

  const { user, fetchWallet, fetchOrders, liveSpotPositions, fetchLiveSpotPositions } = useAuth();

  const [posRefreshing, setPosRefreshing] = useState(false);

  const [closeTarget, setCloseTarget] = useState(null);



  const positions = liveSpotPositions ?? [];

  const prices = useMemo(() => {

    const priceMap = {};

    for (const pos of positions) {

      priceMap[pos.asset] = Number(pos.current_price ?? 0);

    }

    return priceMap;

  }, [positions]);



  const loading = Boolean(user && liveSpotPositions == null);



  const handleRefreshPositions = useCallback(async () => {

    setPosRefreshing(true);

    try {

      await fetchLiveSpotPositions();

    } finally {

      setPosRefreshing(false);

    }

  }, [fetchLiveSpotPositions]);



  if (!user) return (

    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 10, color: 'var(--ibo-ink)' }}>

      <BarChart2 size={28} />

      <span style={{ fontSize: 14 }}>Please log in to view positions</span>

      <Link to="/login" style={{ color: '#FE9D55', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Sign in →</Link>

    </div>

  );



  if (loading && positions.length === 0) return (

    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 8, color: 'var(--ibo-ink)', fontSize: 14 }}>

      <RefreshCw size={16} className="animate-spin" /> Loading positions…

    </div>

  );



  if (positions.length === 0) return (

    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 10, color: 'var(--ibo-ink)', textAlign: 'center', maxWidth: 360, margin: '0 auto' }}>

      <DollarSign size={28} />

      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ibo-ink)' }}>No spot assets</span>

      <span style={{ fontSize: 12, lineHeight: 1.45 }}>

        Buy crypto on the right to build a balance. Like Binance / Coinbase spot, each coin is one row with size and unrealized P&amp;L (USDT).

      </span>

    </div>

  );



  // Portfolio summary. ``totalValue`` shows everything (deposited + bought) at

  // mark — that's the user's actual worth. ``totalInvested`` and ``totalPnl``

  // intentionally cover ONLY the bought slice (``bought_amount`` × mark vs

  // ``total_invested``), so deposit-origin coins don't get reported as

  // 100% profit. ``totalDeposited`` is shown separately so the user can see

  // the value of holdings we have no acquisition price for.

  let totalInvested = 0, totalValue = 0, boughtValue = 0, depositValue = 0;

  positions.forEach(p => {

    const cur = prices[p.asset] ?? 0;

    totalInvested += p.total_invested ?? 0;

    totalValue    += cur * (p.amount ?? 0);

    boughtValue   += cur * (p.bought_amount ?? 0);

    depositValue  += cur * (p.deposit_amount ?? 0);

  });

  const totalPnl    = boughtValue - totalInvested;

  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  const hasAnyCostBasis = totalInvested > 1e-10;



  return (

    <div style={{ flex: 1 }}>

      {/* Portfolio summary — USDT, labels match typical exchange “assets” strip */}

      <div style={{

        display: 'flex', gap: 28, padding: '14px 20px',

        background: 'var(--ibo-elevated)',

        borderBottom: '1px solid var(--ibo-border)',

        alignItems: 'flex-start', flexWrap: 'wrap', overflowX: 'auto',

      }} className="scrollbar-hide">

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>

          <span style={{ color: 'var(--ibo-ink)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Total value</span>

          <span style={{ color: 'var(--ibo-ink)', fontSize: 11 }}>Est. worth at mark price</span>

          <span style={{ color: 'var(--ibo-ink)', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontWeight: 900, fontSize: 20 }}>

            ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}

            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ibo-ink)' }}>USDT</span>

          </span>

        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>

          <span style={{ color: 'var(--ibo-ink)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Cost basis</span>

          <span style={{ color: 'var(--ibo-ink)', fontSize: 11 }}>Avg. buy cost × bought size</span>

          <span style={{ color: 'var(--ibo-ink)', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontWeight: 800, fontSize: 18 }}>

            ${totalInvested.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}

            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ibo-ink)' }}>USDT</span>

          </span>

        </div>

        {depositValue > 1e-8 && (

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>

            <span style={{ color: 'var(--ibo-ink)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Deposited</span>

            <span style={{ color: 'var(--ibo-ink)', fontSize: 11 }}>No cost basis (excluded from P&amp;L)</span>

            <span style={{ color: 'var(--ibo-ink)', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontWeight: 800, fontSize: 18 }}>

              ${depositValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}

              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ibo-ink)' }}>USDT</span>

            </span>

          </div>

        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>

          <span style={{ color: 'var(--ibo-ink)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Unrealized P&amp;L</span>

          <span style={{ color: 'var(--ibo-ink)', fontSize: 11 }}>

            {hasAnyCostBasis ? 'Not sold yet — vs cost basis' : 'Buy to enable P&L tracking'}

          </span>

          {hasAnyCostBasis ? (

            <span style={{

              fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontWeight: 900, fontSize: 20,

              color: totalPnl >= 0 ? '#22c55e' : '#ef4444',

            }}>

              {totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}

              <span style={{ fontSize: 14, fontWeight: 800, opacity: 0.9 }}>

                ({totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%)

              </span>

            </span>

          ) : (

            <span style={{ fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontWeight: 900, fontSize: 20, color: 'var(--ibo-ink)' }}>—</span>

          )}

        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>

          <Link

            to="/portfolio"

            style={{ fontSize: 12, fontWeight: 800, color: '#FE9D55', textDecoration: 'none', whiteSpace: 'nowrap' }}

            className="hover:underline"

          >

            P&amp;L analysis →

          </Link>

          <button onClick={handleRefreshPositions} disabled={loading || posRefreshing}

            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ibo-ink)', opacity: loading || posRefreshing ? 0.4 : 1 }}

            className="hover:text-white transition-colors">

            <RefreshCw size={16} className={loading || posRefreshing ? 'animate-spin' : ''} />

          </button>

        </div>

      </div>



      {/* Spot assets table — similar to exchange “assets / wallet” breakdown */}

      <div style={{ overflowX: 'auto' }}>

        <div style={{

          display: 'grid',

          gridTemplateColumns: 'minmax(120px,1.05fr) 0.85fr 0.9fr 0.9fr 0.9fr 0.9fr minmax(132px,1fr) 1.12fr minmax(88px,0.75fr)',

          gap: 10, padding: '12px 20px', minWidth: 1080,

          borderBottom: '1px solid var(--ibo-elevated)',

          background: 'var(--ibo-elevated)',

          alignItems: 'end',

        }}>

        <Th main="Coin" sub="Spot pair" title="Asset you hold" />

        <Th main="Size" sub="Total balance" align="right" title="Total coins in wallet (incl. locked in orders)" />

        <Th main="Available" sub="Free to sell" align="right" title="Balance not locked in open sell orders" />

        <Th main="Avg. buy price" sub="USDT per coin" align="right" title="Average buy price from your trade history. — for deposit-only holdings." />

        <Th main="Mark" sub="Last / index" align="right" title="Current market price in USDT" />

        <Th main="Value" sub="USDT" align="right" title="Size × mark price (everything you hold)" />

        <Th main="Last fill" sub="Buy or sell" align="right" title="Most recent execution on this pair (spot)" />

        <Th main="Unrealized P&amp;L" sub="On bought slice only" align="right" title="Bought-size × mark − cost basis. Hidden for deposit-only holdings (we have no acquisition price)." />

        <Th main="Action" sub="Sell available" align="right" />

      </div>



      {/* Rows */}

      {positions.map(pos => {

        const currentPrice = prices[pos.asset] ?? 0;

        const currentValue = currentPrice * pos.amount;

        // P&L is meaningful only on coins we actually bought. Deposit-origin

        // coins have ``has_cost_basis === false`` (or source === "deposit"),

        // and the backend already returns ``unrealized_pnl: 0`` for them.

        // The UI must NOT compute its own P&L from price × amount; that's

        // exactly the bug we're fixing.

        const hasCost = Boolean(pos.has_cost_basis ?? ((pos.total_invested ?? 0) > 1e-10));

        const pnl     = hasCost ? Number(pos.unrealized_pnl ?? 0)     : 0;

        const pnlPct  = hasCost ? Number(pos.unrealized_pnl_pct ?? 0) : 0;

        const isUp    = pnl >= 0;

        const icon    = COIN_ICONS[pos.asset] ?? COIN_ICONS[walletAssetLabel(pos.asset)];

        const isActivePair = activePair && pos.symbol === String(activePair).toUpperCase();

        const source = pos.source || (hasCost ? 'bought' : 'deposit');



        const available = Number(pos.available ?? 0);

        const locked    = Number(pos.locked ?? 0);

        const canSell   = available >= 1e-8;

        return (

          <div key={pos.asset}

            style={{

              display: 'grid',

              gridTemplateColumns: 'minmax(120px,1.05fr) 0.85fr 0.9fr 0.9fr 0.9fr 0.9fr minmax(132px,1fr) 1.12fr minmax(88px,0.75fr)',

              gap: 10, padding: '14px 20px', alignItems: 'center', minWidth: 1080,

              borderBottom: '1px solid var(--ibo-elevated)',

              borderLeft: isActivePair ? '3px solid rgba(254, 157, 85,0.65)' : '3px solid transparent',

              transition: 'background 0.15s',

            }}

            className="hover:bg-[color:var(--ibo-hover)]">



            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>

              {icon && <img src={icon} alt={walletAssetLabel(pos.asset)} style={{ width: 28, height: 28, borderRadius: '50%' }} />}

              <div>

                <div style={{ color: 'var(--ibo-ink)', fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>

                  {walletAssetLabel(pos.asset)}

                  {source === 'deposit' && (

                    <span

                      title="Deposited from another wallet — no on-platform buy price, so P&L can't be calculated."

                      style={{

                        fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',

                        color: '#7dd3fc', background: 'rgba(125,211,252,0.12)',

                        border: '1px solid rgba(125,211,252,0.35)',

                        padding: '1px 6px', borderRadius: 999, textTransform: 'uppercase',

                      }}

                    >

                      Deposited

                    </span>

                  )}

                  {source === 'mixed' && (

                    <span

                      title="Holdings include both deposits and on-platform buys. P&L only counts the bought slice."

                      style={{

                        fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',

                        color: '#fcd34d', background: 'rgba(252,211,77,0.12)',

                        border: '1px solid rgba(252,211,77,0.35)',

                        padding: '1px 6px', borderRadius: 999, textTransform: 'uppercase',

                      }}

                    >

                      Mixed

                    </span>

                  )}

                </div>

                <div style={{ color: 'var(--ibo-ink)', fontSize: 11, fontWeight: 600 }}>{pos.symbol ? displayPairSlash(pos.symbol) : `${walletAssetLabel(pos.asset)}/USDT`}</div>

              </div>

            </div>



            <span style={{ textAlign: 'right', color: 'var(--ibo-ink)', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 700 }}>

              {pos.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}{' '}

              <span style={{ color: 'var(--ibo-ink)', fontSize: 11 }}>{walletAssetLabel(pos.asset)}</span>

            </span>



            <span style={{ textAlign: 'right', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontSize: 13 }}>

              <span style={{ color: 'var(--ibo-ink)', fontWeight: 700 }}>{Number(pos.available ?? 0).toLocaleString(undefined, { maximumFractionDigits: 8 })}</span>

              {locked > 1e-10 && (

                <span style={{ display: 'block', fontSize: 10, color: 'var(--ibo-ink)', marginTop: 2 }}>

                  {locked.toLocaleString(undefined, { maximumFractionDigits: 6 })} locked

                </span>

              )}

            </span>



            <span

              style={{ textAlign: 'right', color: 'var(--ibo-ink)', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 600 }}

              title={hasCost ? undefined : 'No cost basis: this asset was deposited (or its bought slice was already sold).'}

            >

              {hasCost ? `$${fmtOrdP(pos.avg_cost)}` : '—'}

            </span>



            <span style={{ textAlign: 'right', color: 'var(--ibo-ink)', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 800 }}>

              {currentPrice ? `$${fmtOrdP(currentPrice)}` : <span style={{ color: 'var(--ibo-ink)' }}>—</span>}

            </span>



            <span style={{ textAlign: 'right', color: 'var(--ibo-ink)', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontWeight: 800, fontSize: 14 }}>

              ${currentValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}

            </span>



            <div style={{ textAlign: 'right', fontSize: 11 }}>

              {pos.last_fill_side ? (

                <>

                  <span style={{

                    fontWeight: 900,

                    color: String(pos.last_fill_side).toLowerCase() === 'buy' ? '#22c55e' : '#ef4444',

                    textTransform: 'uppercase',

                    letterSpacing: '0.04em',

                  }}>

                    {String(pos.last_fill_side).toLowerCase() === 'buy' ? 'Buy' : 'Sell'}

                  </span>

                  <div style={{ color: 'var(--ibo-ink)', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', marginTop: 4, fontWeight: 600 }}>

                    {Number(pos.last_fill_amount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} @ ${fmtOrdP(pos.last_fill_price)}

                  </div>

                  <div style={{ color: 'var(--ibo-ink)', fontSize: 10, marginTop: 2 }}>

                    {pos.last_fill_at ? new Date(pos.last_fill_at).toLocaleString() : ''}

                  </div>

                  <div style={{ color: 'var(--ibo-ink)', fontSize: 10, marginTop: 4 }} title="Lifetime base volume from your fills">

                    Σ buy {Number(pos.lifetime_buy_qty ?? 0).toFixed(4)} · Σ sell {Number(pos.lifetime_sell_qty ?? 0).toFixed(4)}

                  </div>

                </>

              ) : (

                <span style={{ color: 'var(--ibo-ink)' }}>—</span>

              )}

            </div>



            <div

              style={{ textAlign: 'right', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif' }}

              title={hasCost ? undefined : 'P&L is hidden because this holding has no cost basis (deposited).'}

            >

              {hasCost ? (

                <>

                  <span style={{ fontWeight: 900, fontSize: 14, color: isUp ? '#22c55e' : '#ef4444' }}>

                    {isUp ? '+' : ''}${pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}

                  </span>

                  <span

                    style={{

                      display: 'inline-block',

                      marginLeft: 8,

                      fontSize: 12,

                      fontWeight: 800,

                      padding: '2px 8px',

                      borderRadius: 6,

                      background: isUp ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',

                      color: isUp ? '#22c55e' : '#ef4444',

                    }}

                  >

                    {isUp ? '+' : ''}{pnlPct.toFixed(2)}%

                  </span>

                </>

              ) : (

                <span style={{ color: 'var(--ibo-ink)', fontWeight: 700, fontSize: 14 }}>—</span>

              )}

            </div>



            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>

              <button

                type="button"

                disabled={!canSell}

                onClick={() => setCloseTarget({

                  ...pos,

                  symbol: String(pos.symbol || '').replace(/\//g, '').toUpperCase(),

                  current_price: pos.current_price ?? currentPrice,

                })}

                title={

                  canSell

                    ? `Sell ${walletAssetLabel(pos.asset)} at market or set a limit`

                    : (locked > 1e-8

                        ? `All ${walletAssetLabel(pos.asset)} is locked in open sell orders. Cancel them first to sell.`

                        : `No ${walletAssetLabel(pos.asset)} available to sell.`)

                }

                style={{

                  padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 800,

                  color: canSell ? '#FE9D55' : 'var(--ibo-muted)',

                  background: canSell ? 'rgba(254, 157, 85,0.12)' : 'var(--ibo-elevated)',

                  border: `1px solid ${canSell ? 'rgba(254, 157, 85,0.35)' : 'var(--ibo-border)'}`,

                  cursor: canSell ? 'pointer' : 'not-allowed',

                  opacity: canSell ? 1 : 0.5,

                }}

                className={canSell ? 'hover:bg-gold/20 transition-colors' : ''}

              >

                Sell

              </button>

            </div>

          </div>

        );

      })}

      </div>{/* end overflow-x-auto */}



      {closeTarget && (

        <ClosePositionModal

          position={closeTarget}

          onDismiss={() => setCloseTarget(null)}

          onSuccess={async () => {

            await Promise.all([fetchLiveSpotPositions(), fetchWallet(), fetchOrders()]);

          }}

        />

      )}

    </div>

  );

}



// ─── Map order id → sum of realized P&L (USDT) from sell fills ───────────────

function buildOrderRealizedPnlMap(trades) {

  const m = new Map();

  if (!Array.isArray(trades)) return m;

  for (const t of trades) {

    const oid = t.order_id;

    if (!oid) continue;

    const sd = String(t.side || '').toLowerCase();

    if (sd !== 'sell') continue;

    const rp = t.realized_pnl;

    if (rp == null || Number.isNaN(Number(rp))) continue;

    m.set(oid, (m.get(oid) || 0) + Number(rp));

  }

  return m;

}



// ─── ZONE 2: Unified bottom panel ─────────────────────────────────────────────

function BottomPanel({ symbol, isIboMock = false, iboTrades = [], iboLoading = false }) {

  const {

    user,

    openOrders,

    orderHistory,

    ordersLoading,

    fetchOrders,

    fetchWallet,

    fetchLiveSpotPositions,

    userTrades,

    userTradesLoading,

    fetchUserTrades,

  } = useAuth();

  const toast = useToast();

  const [tab,         setTab]         = useState('orders');

  const [orderFilter, setOrderFilter] = useState('all');

  const [cancelling, setCancelling] = useState(null);



  useEffect(() => {

    if (tab !== 'orders') setOrderFilter('all');

  }, [tab]);



  const orderPnlById = useMemo(() => buildOrderRealizedPnlMap(userTrades), [userTrades]);



  const historyTotalRealizedPnl = useMemo(() => {

    let s = 0;

    for (const o of orderHistory) {

      if (String(o.side || '').toLowerCase() !== 'sell') continue;

      if ((o.filled ?? 0) < 1e-10) continue;

      const v = orderPnlById.get(o.id);

      if (v != null && !Number.isNaN(v)) s += v;

    }

    return s;

  }, [orderHistory, orderPnlById]);



  const handleCancel = async id => {

    if (!window.confirm('Cancel this open order? Any funds locked by this order will be returned to your wallet.')) return;

    setCancelling(id);

    try {

      const res = await authFetch(`${API}/api/orders/${id}`, { method: 'DELETE' });

      if (res.ok) {

        toast.success('Order cancelled', 'Your order has been removed and funds returned.');

        await Promise.all([fetchOrders(), fetchWallet(), fetchLiveSpotPositions()]);

      } else {

        toast.error('Could not cancel order', friendlyError(await parseApiError(res)));

      }

    } catch (e) {

      toast.error('Could not cancel order', friendlyError(e.message));

    } finally {

      setCancelling(null);

    }

  };



  const statusColor = s =>

    s === 'filled'           ? '#22c55e' :

    s === 'partially_filled' ? '#60a5fa' :

    s === 'cancelled'        ? '#ef4444' : 'var(--ibo-ink)';



  const statusIcon = s =>

    s === 'filled'    ? <CheckCircle size={11} /> :

    s === 'cancelled' ? <AlertCircle size={11} />

                      : <Clock size={11} />;



  const TABS = [

    { id: 'positions', label: 'Positions', badge: null },

    { id: 'orders',    label: 'Open Orders', badge: openOrders.length || null },

    { id: 'history',   label: 'Order History', badge: null },

    { id: 'trades',    label: 'Market Trades', badge: null },

  ];



  return (

    <div className="flex flex-col min-h-[300px] bg-transparent">



      {/* Tab bar — futures-style lime */}

      <div

        className="flex items-center shrink-0 overflow-x-auto scrollbar-hide border-b border-[color:var(--ibo-border)] px-1 h-[40px]"

        style={{ position: 'sticky', top: 0, zIndex: 90, background: 'var(--ibo-bg)' }}

      >

        {TABS.map(t => {

          const on = tab === t.id;

          return (

          <button key={t.id} type="button" onClick={() => setTab(t.id)}

            className="relative h-full px-3.5 text-[12px] font-semibold whitespace-nowrap transition-colors"

            style={{

              color: on ? ACCENT : 'var(--ibo-muted)',

              background: 'transparent', border: 'none',

              cursor: 'pointer',

              display: 'flex', alignItems: 'center', gap: 8,

            }}>

            {t.label}

            {t.badge > 0 && (

              <span style={{ fontSize: 10, background: 'rgba(254, 108, 2,0.15)', color: ACCENT, padding: '2px 8px', borderRadius: 6, fontWeight: 800 }}>

                {t.badge}

              </span>

            )}

            {on ? (

              <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full" style={{ background: ACCENT }} />

            ) : null}

          </button>

          );

        })}



        {(tab === 'orders' || tab === 'history' || tab === 'positions') && (

          <button

            type="button"

            onClick={async () => {

              if (tab === 'orders' || tab === 'history') {

                await fetchOrders();

                if (tab === 'history') await fetchUserTrades();

              }

              if (tab === 'positions') await fetchLiveSpotPositions();

            }}

            disabled={

              tab === 'positions'

                ? false

                : ordersLoading || (tab === 'history' && userTradesLoading)

            }

            style={{ marginLeft: 'auto', padding: 7, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ibo-ink)', opacity: (tab !== 'positions' && (ordersLoading || (tab === 'history' && userTradesLoading))) ? 0.4 : 1 }}

            className="hover:text-white transition-colors"

            title="Refresh"

          >

            <RefreshCw size={14} className={(tab !== 'positions' && (ordersLoading || (tab === 'history' && userTradesLoading))) ? 'animate-spin' : ''} />

          </button>

        )}

        <div className={`hidden sm:flex items-center gap-1.5 text-[11px] text-[color:var(--ibo-muted)] pr-2 ${tab === 'trades' ? 'ml-auto' : 'ml-2'}`}>

          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />

          Connected

        </div>

      </div>



      <div className="min-h-[260px] flex flex-col">

      {tab === 'positions' && (

        <TabHint>

          <strong style={{ color: 'var(--ibo-ink)' }}>Spot assets</strong> — coins you own. Limit orders waiting on the book are under <strong style={{ color: ACCENT }}>Working orders</strong>.

        </TabHint>

      )}

      {tab === 'orders' && (

        <TabHint>

          <strong style={{ color: 'var(--ibo-ink)' }}>Working orders</strong> — limits still on the book. Fully filled/cancelled move to history.

        </TabHint>

      )}

      {tab === 'history' && (

        <TabHint>

          <strong style={{ color: 'var(--ibo-ink)' }}>Completed orders</strong> — filled or cancelled. Per-fill detail: <Link to="/portfolio" style={{ color: ACCENT, fontWeight: 700 }}>P&amp;L</Link>.

        </TabHint>

      )}

      {tab === 'trades' && (

        <TabHint>

          <strong style={{ color: 'var(--ibo-ink)' }}>Recent trades</strong> — latest public fills for this market.

        </TabHint>

      )}



      {/* Positions */}

      {tab === 'positions' && <PositionsTab activePair={symbol} />}



      {/* Market recent trades */}

      {tab === 'trades' && (

        <div className="flex-1 min-h-[min(360px,50vh)] overflow-hidden">

          {isIboMock

            ? <IBOTrades trades={iboTrades} loading={iboLoading} hideHeader />

            : <RecentTrades symbol={symbol} hideHeader />}

        </div>

      )}



      {/* Working orders / Order history */}

      {(tab === 'orders' || tab === 'history') && (() => {

        const rawOpen = tab === 'orders' ? openOrders : orderHistory;

        const rows =

          tab === 'orders' && orderFilter === 'limit'

            ? rawOpen.filter(o => String(o.type || '').toLowerCase() === 'limit')

            : rawOpen;

        const histPnl = tab === 'history';

        const gridCols = histPnl

          ? '1.22fr 0.78fr 0.48fr 0.48fr 0.88fr 0.88fr 1.05fr 1.02fr 0.88fr 0.62fr'

          : '1.38fr 0.85fr 0.5fr 0.5fr 0.92fr 0.88fr 0.88fr 0.88fr 0.9fr';

        const minW = histPnl ? 980 : 840;

        return (

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowX: 'auto' }}>

            {tab === 'orders' && user && (

              <div

                style={{

                  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,

                  padding: '10px 20px 12px',

                  borderBottom: '1px solid var(--ibo-elevated)',

                }}

              >

                <span style={{ fontSize: 11, color: 'var(--ibo-ink)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>

                  Show

                </span>

                {[

                  { id: 'all', label: 'All working', sub: `${openOrders.length} on book` },

                  { id: 'limit', label: 'Limits only', sub: `${openOrders.filter(o => String(o.type || '').toLowerCase() === 'limit').length} limits` },

                ].map(f => (

                  <button

                    key={f.id}

                    type="button"

                    onClick={() => setOrderFilter(f.id)}

                    style={{

                      border: `1px solid ${orderFilter === f.id ? 'rgba(254, 108, 2,0.45)' : 'var(--ibo-border)'}`,

                      background: orderFilter === f.id ? 'rgba(254, 108, 2,0.14)' : 'var(--ibo-elevated)',

                      color: orderFilter === f.id ? ACCENT : 'var(--ibo-ink)',

                      cursor: 'pointer',

                      transition: 'background 0.15s, border-color 0.15s',

                      borderRadius: 6,

                      fontSize: 12,

                      fontWeight: 700,

                      padding: '5px 12px',

                    }}

                  >

                    {f.label}

                    <span style={{ opacity: 0.75, fontWeight: 600, fontSize: 11, marginLeft: 6 }}>({f.sub})</span>

                  </button>

                ))}

              </div>

            )}

            {histPnl && user && rows.length > 0 && (

              <div

                style={{

                  margin: '10px 16px 0',

                  padding: '10px 14px',

                  borderRadius: 10,

                  background: 'var(--ibo-elevated)',

                  border: '1px solid var(--ibo-border)',

                  display: 'flex',

                  flexWrap: 'wrap',

                  alignItems: 'center',

                  gap: 12,

                  fontSize: 13,

                }}

              >

                <span style={{ color: 'var(--ibo-ink)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>

                  Total realized P&amp;L (USDT)

                </span>

                <span

                  style={{

                    fontFamily: 'Inter, Plus Jakarta Sans, sans-serif',

                    fontWeight: 900,

                    fontSize: 16,

                    color: historyTotalRealizedPnl >= 0 ? '#22c55e' : '#ef4444',

                  }}

                >

                  {historyTotalRealizedPnl >= 0 ? '+' : ''}

                  ${historyTotalRealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}

                </span>

                <span style={{ color: 'var(--ibo-ink)', fontSize: 12, maxWidth: 480, lineHeight: 1.45 }}>

                  Sum of the <strong style={{ color: 'var(--ibo-ink)' }}>Realized P&amp;L</strong> column below (only rows where you <strong style={{ color: 'var(--ibo-ink)' }}>sold</strong> and the order executed). Same average-cost method as major spot exchanges. Per-fill detail:{' '}

                  <Link to="/portfolio" style={{ color: '#FE9D55', fontWeight: 700, textDecoration: 'none' }} className="hover:underline">

                    P&amp;L &amp; fills

                  </Link>

                  .

                </span>

              </div>

            )}

            <div style={{

              display: 'grid',

              gridTemplateColumns: gridCols,

              gap: 10, padding: '12px 20px', minWidth: minW,

              borderBottom: '1px solid var(--ibo-elevated)', flexShrink: 0,

              background: 'var(--ibo-elevated)',

              alignItems: 'end',

            }}>

              <Th main="Time" sub="Order placed" title="When you submitted the order" />

              <Th main="Pair" sub="Market" />

              <Th main="Type" sub="Limit / market" />

              <Th main="Side" sub="Buy or sell" />

              <Th main="Order price" sub="Limit or MKT" align="right" title="Limit: your price. Market: executes at book." />

              {histPnl && (

                <Th main="Avg. fill" sub="Execution" align="right" title="Volume-weighted average price of filled size (USDT)" />

              )}

              <Th main={histPnl ? 'Executed' : 'Order qty'} sub={histPnl ? 'Filled / total' : 'Requested size'} align="right" />

              {!histPnl && <Th main="Filled" sub="So far" align="right" title="Amount already matched" />}

              {!histPnl && <Th main="Remain" sub="On book" align="right" title="Unfilled quantity still working" />}

              {histPnl && (

                <Th main="Realized P&amp;L" sub="USDT · sells" align="right" title="Profit or loss on sold size for this order (avg. cost)" />

              )}

              <Th main={tab === 'orders' ? 'Action' : 'Status'} sub={tab === 'orders' ? 'Cancel' : 'Final state'} align="right" />

              {histPnl && <Th main="Order ID" sub="Reference" title="Internal order id — support may ask for this" />}

            </div>



            {/* Rows */}

            <div style={{ flex: 1 }}>

              {ordersLoading && rows.length === 0 ? (

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 10, color: 'var(--ibo-ink)', fontSize: 15 }}>

                  <RefreshCw size={18} className="animate-spin" /> Loading…

                </div>

              ) : !user ? (

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12, color: 'var(--ibo-ink)' }}>

                  <Clock size={32} />

                  <span style={{ fontSize: 16, fontWeight: 600 }}>Please log in to view orders</span>

                  <Link to="/login" style={{ color: '#FE9D55', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>Sign in →</Link>

                </div>

              ) : rows.length === 0 ? (

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 56, gap: 10, color: 'var(--ibo-ink)', textAlign: 'center', maxWidth: 440, margin: '0 auto' }}>

                  <Clock size={32} />

                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ibo-ink)' }}>

                    {tab === 'orders'

                      ? (openOrders.length === 0

                        ? 'No working orders'

                        : orderFilter === 'limit'

                          ? 'No limit orders in this filter'

                          : 'No rows to show')

                      : 'No order history yet'}

                  </span>

                  <span style={{ fontSize: 12, lineHeight: 1.45 }}>

                    {tab === 'orders'

                      ? (openOrders.length === 0

                        ? 'Limit orders appear here as soon as you place them — before they execute. Filled or cancelled orders move to Order history. Spot balances are under Spot assets.'

                        : 'Switch to “All working” to see every open order, or place a new limit from the form above.')

                      : 'Filled and cancelled orders only — still-working limits stay under Working orders.'}

                  </span>

                </div>

              ) : rows.map(o => {

                const sellSide = String(o.side || '').toLowerCase() === 'sell';

                const hasFill = (o.filled ?? 0) > 1e-10;

                const rowPnl = histPnl && sellSide && hasFill ? orderPnlById.get(o.id) : null;

                const showRowPnl = rowPnl != null && !Number.isNaN(Number(rowPnl));

                const baseSym = o.symbol ? displayBaseForApiSymbol(o.symbol) : '';

                const avgFill = hasFill && (o.avg_price ?? 0) > 0 ? o.avg_price : null;

                return (

                <div key={o.id}

                  style={{

                    display: 'grid',

                    gridTemplateColumns: gridCols,

                    gap: 10, padding: '14px 20px', alignItems: 'center', minWidth: minW,

                    borderBottom: '1px solid var(--ibo-elevated)',

                    transition: 'background 0.15s',

                  }}

                  className="hover:bg-[color:var(--ibo-hover)]">

                  <span style={{ color: 'var(--ibo-ink)', fontSize: 12, fontFamily: 'Inter, Plus Jakarta Sans, sans-serif' }}>{ORDER_FMT(o.created_at)}</span>

                  <span style={{ color: 'var(--ibo-ink)', fontWeight: 800, fontSize: 14 }}>{displayPairSlash(o.symbol)}</span>

                  <span style={{ color: 'var(--ibo-ink)', textTransform: 'capitalize', fontSize: 13, fontWeight: 600 }}>{o.type}</span>

                  <span style={{

                    color: o.side === 'buy' ? '#22c55e' : '#ef4444',

                    fontWeight: 800, textTransform: 'uppercase', fontSize: 13,

                    background: o.side === 'buy' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',

                    padding: '2px 8px', borderRadius: 6, display: 'inline-block',

                  }}>

                    {o.side}

                  </span>

                  <span style={{ textAlign: 'right', color: 'var(--ibo-ink)', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 700 }}>

                    {o.type === 'market' ? <span style={{ color: 'var(--ibo-ink)', fontWeight: 800 }}>Market</span> : `$${fmtOrdP(o.price)}`}

                  </span>

                  {histPnl && (

                    <span style={{ textAlign: 'right', color: 'var(--ibo-ink)', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 700 }}>

                      {avgFill != null ? `$${fmtOrdP(avgFill)}` : <span style={{ color: 'var(--ibo-ink)' }}>—</span>}

                    </span>

                  )}

                  {histPnl ? (

                    <span style={{ textAlign: 'right', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontSize: 13, color: 'var(--ibo-ink)' }}>

                      <span style={{ color: o.filled > 0 ? 'var(--ibo-ink)' : 'var(--ibo-muted)', fontWeight: 700 }}>{Number(o.filled).toFixed(6)}</span>

                      <span style={{ color: 'var(--ibo-ink)', margin: '0 4px' }}>/</span>

                      <span style={{ fontWeight: 600 }}>{Number(o.amount).toFixed(6)}</span>

                      {o.amount > 0 && (

                        <span style={{ display: 'block', fontSize: 10, color: 'var(--ibo-ink)', marginTop: 2 }}>

                          {((o.filled / o.amount) * 100).toFixed(0)}% {baseSym}

                        </span>

                      )}

                    </span>

                  ) : (

                    <>

                      <span style={{ textAlign: 'right', color: 'var(--ibo-ink)', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 700 }}>

                        {Number(o.amount).toFixed(6)} <span style={{ color: 'var(--ibo-ink)', fontSize: 11 }}>{baseSym}</span>

                      </span>

                      <span style={{ textAlign: 'right', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontSize: 13 }}>

                        <span style={{ color: o.filled > 0 ? 'var(--ibo-ink)' : 'var(--ibo-muted)', fontWeight: 700 }}>{Number(o.filled).toFixed(6)}</span>

                        {o.amount > 0 && (

                          <span style={{ color: 'var(--ibo-ink)', fontSize: 11, marginLeft: 4 }}>

                            ({((o.filled / o.amount) * 100).toFixed(0)}%)

                          </span>

                        )}

                      </span>

                      <span style={{ textAlign: 'right', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#FE9D55', fontWeight: 700 }}>

                        {(o.remaining != null ? o.remaining : Math.max(0, o.amount - o.filled)).toFixed(6)}

                      </span>

                    </>

                  )}

                  {histPnl && (

                    <span

                      style={{

                        textAlign: 'right',

                        fontFamily: 'Inter, Plus Jakarta Sans, sans-serif',

                        fontSize: 13,

                        fontWeight: 800,

                        color: showRowPnl ? (rowPnl >= 0 ? '#22c55e' : '#ef4444') : 'var(--ibo-ink)',

                      }}

                    >

                      {showRowPnl ? (

                        <>{rowPnl >= 0 ? '+' : ''}${Number(rowPnl).toLocaleString(undefined, { maximumFractionDigits: 2 })}</>

                      ) : (

                        '—'

                      )}

                    </span>

                  )}

                  {tab === 'orders' ? (

                    <div style={{ textAlign: 'right' }}>

                      <button onClick={() => handleCancel(o.id)} disabled={cancelling === o.id}

                        style={{

                          display: 'inline-flex', alignItems: 'center', gap: 5,

                          color: '#ef4444', background: 'rgba(239,68,68,0.08)',

                          border: '1px solid rgba(239,68,68,0.2)',

                          borderRadius: 8, padding: '4px 10px',

                          cursor: 'pointer', fontSize: 13, fontWeight: 700,

                          opacity: cancelling === o.id ? 0.4 : 1,

                        }}>

                        {cancelling === o.id ? <RefreshCw size={12} className="animate-spin" /> : <><X size={12} /> Cancel</>}

                      </button>

                    </div>

                  ) : (

                    <div style={{

                      display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 5,

                      color: statusColor(o.status), fontSize: 13, fontWeight: 700, textTransform: 'capitalize',

                    }}>

                      {statusIcon(o.status)} {o.status.replace('_', ' ')}

                    </div>

                  )}

                  {histPnl && (

                    <span style={{ textAlign: 'right', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontSize: 11, color: 'var(--ibo-ink)' }} title={o.id}>

                      {shortOrderId(o.id)}

                    </span>

                  )}

                </div>

                );

              })}

            </div>

          </div>

        );

      })()}



      <div style={{ height: 16, flexShrink: 0 }} />

      </div>

    </div>

  );

}



// ─── Main page ────────────────────────────────────────────────────────────────

export default function TradePage() {

  const { symbol: routeParam } = useParams();

  const navigate = useNavigate();

  const [searchParams] = useSearchParams();

  const sideQ = searchParams.get('side');

  const formInitialSide = sideQ === 'sell' ? 'sell' : sideQ === 'buy' ? 'buy' : undefined;



  // URL is the source of truth so deep links from Markets/Landing show the right chart immediately.

  const symbol = useMemo(

    () => tradeSymbolFromRouteParam(routeParam) ?? INTERNAL_SPOT_SYMBOL,

    [routeParam],

  );

  const isIboMock = isIboMockMarketSymbol(symbol);

  const [iboInterval, setIboInterval] = useState('1m');

  const { candles: iboCandles, orderbook: iboOrderbook, trades: iboTrades, ticker: iboTicker, loading: iboLoading } = useIBOMarket({

    symbol,

    interval: iboInterval,

    enabled: isIboMock,

  });

  const [ticker,        setTicker]        = useState(null);

  const [pairOpen,      setPairOpen]      = useState(false);

  const [formPrice,     setFormPrice]     = useState('');

  const [mobilePanelTab, setMobilePanelTab] = useState('trade'); // 'trade' | 'book'



  const { base: apiBase, quote: apiQuote } = parsePairFromApiSymbol(symbol);

  const displayBase = apiBase;

  const [iboLogoUrl, setIboLogoUrl] = useState(null);



  useEffect(() => {

    if (apiQuote !== 'IBO') {

      setIboLogoUrl(null);

      return undefined;

    }

    let cancelled = false;

    marketApi

      .getIBOMarkets({ tier: 'all', q: displayBase, limit: 40 })

      .then((data) => {

        if (cancelled) return;

        const hit = (data?.markets || []).find((m) => String(m.symbol).toUpperCase() === symbol);

        setIboLogoUrl(hit?.logo_url || null);

      })

      .catch(() => {

        if (!cancelled) setIboLogoUrl(null);

      });

    return () => {

      cancelled = true;

    };

  }, [symbol, displayBase, apiQuote]);



  const icon = coinIconUrl(displayBase, apiQuote === 'IBO' ? iboLogoUrl : null)

    ?? coinIconUrl(apiBase, null);



  const iboHl = useMemo(() => {

    if (!isIboMock || !iboCandles?.length) return null;

    let high = 0;

    let low = Infinity;

    for (const c of iboCandles) {

      const h = Number(c.high);

      const l = Number(c.low);

      if (Number.isFinite(h)) high = Math.max(high, h);

      if (Number.isFinite(l)) low = Math.min(low, l);

    }

    if (!Number.isFinite(low) || low === Infinity) return null;

    return { high, low };

  }, [isIboMock, iboCandles]);



  const activeTicker = useMemo(() => {

    if (!isIboMock) return ticker;

    if (!iboTicker) return null;

    const px = Number(iboTicker.price ?? 0);

    return {

      price: px,

      priceChangePercent: Number(iboTicker.change24h ?? 0),

      volume: Number(iboTicker.volume24h ?? 0),

      quoteVolume: Number(iboTicker.volume24h ?? 0),

      highPrice: iboHl?.high ?? px,

      lowPrice: iboHl?.low ?? px,

    };

  }, [isIboMock, ticker, iboTicker, iboHl]);



  useEffect(() => {

    if (isIboMock) return undefined;

    setTicker(null);

    const qs = new URLSearchParams({ symbol });

    const url = exchangeWsPath(`/api/ws/exchange/ticker?${qs.toString()}`);

    let closed = false;

    let reconnectTimer = null;

    let ws = null;

    const connect = () => {

      if (closed) return;

      ws = new WebSocket(url);

      ws.onmessage = (ev) => {

        try {

          const j = JSON.parse(ev.data);

          if (j.type === 'exchange_ticker' && j.ticker) setTicker(j.ticker);

        } catch {

          /* ignore */

        }

      };

      ws.onclose = () => {

        ws = null;

        if (!closed) reconnectTimer = window.setTimeout(connect, 3000);

      };

    };

    connect();

    return () => {

      closed = true;

      if (reconnectTimer) window.clearTimeout(reconnectTimer);

      if (ws) {

        try {

          ws.close();

        } catch {

          /* ignore */

        }

      }

    };

  }, [symbol, isIboMock]);



  useEffect(() => {

    const resolved = tradeSymbolFromRouteParam(routeParam);

    if (!routeParam || !resolved) {

      navigate(`/trade/${INTERNAL_SPOT_SYMBOL}`, { replace: true });

      return;

    }

    const canonical = normalizeTradeRouteSymbol(routeParam);

    if (canonical && canonical !== apiSymbolFromRouteParam(routeParam)) {

      navigate(`/trade/${canonical}`, { replace: true });

    }

  }, [routeParam, navigate]);



  useEffect(() => {

    setFormPrice('');

  }, [symbol]);



  const switchPair = useCallback((sym) => {

    navigate(`/trade/${tradePathForApiSymbol(sym)}`, { replace: true });

    setFormPrice('');

  }, [navigate]);



  const onOrderBookPrice = useCallback(pr => { setFormPrice(pr); }, []);

  const onOrderBookPriceMobile = useCallback(pr => {

    setFormPrice(pr);

    setMobilePanelTab('trade');

  }, []);



  const pct       = parseFloat(activeTicker?.priceChangePercent ?? 0);

  const isUp      = pct >= 0;

  const livePrice = activeTicker?.price ?? null;



  const pairPicker = (

    <TradePairPicker

      symbol={symbol}

      onSelect={switchPair}

      displayBase={displayBase}

      apiQuote={apiQuote}

      icon={icon}

      onOpenChange={setPairOpen}

    />

  );



  return (

    <div className="delta-trade" style={{ background: 'var(--ibo-bg)' }}>



      {/* ═════════ MOBILE ═════════ */}

      <div className="flex flex-col md:hidden min-h-[calc(100vh-70px)]">



        <div style={{

          padding: '8px 12px',

          borderBottom: '1px solid var(--ibo-border)',

          background: 'var(--ibo-bg)', position: 'relative', zIndex: 200,

        }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflowX: 'auto' }}

            className="scrollbar-hide">

            {pairPicker}



            {activeTicker ? (

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>

                <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', color: isUp ? '#22c55e' : '#ef4444', letterSpacing: '-0.5px', flexShrink: 0 }}>

                  ${fmtP(livePrice, apiBase)}

                </span>

                <span style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 6, background: isUp ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: isUp ? '#22c55e' : '#ef4444', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>

                  {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}

                  {isUp ? '+' : ''}{pct.toFixed(2)}%

                </span>

              </div>

            ) : (

              <div style={{ flex: 1 }}>

                <div style={{ height: 24, width: 120, background: 'var(--ibo-hover)', borderRadius: 6 }} className="animate-pulse" />

              </div>

            )}

          </div>

        </div>



        <div style={{ height: 320, position: 'relative', overflow: 'hidden', pointerEvents: pairOpen ? 'none' : 'auto' }}>

          {isIboMock ? (

            <IBOChart

              candles={iboCandles}

              interval={iboInterval}

              onIntervalChange={setIboInterval}

              fill

            />

          ) : (

            <TradingChart key={symbol} symbol={symbol} />

          )}

        </div>



        <div style={{

          display: 'flex', background: 'var(--ibo-bg)',

          borderBottom: '1px solid var(--ibo-border)',

          position: 'sticky', top: 0, zIndex: 100,

        }}>

          {[['trade', 'Trade'], ['book', 'Book']].map(([id, label]) => (

            <button key={id} type="button" onClick={() => setMobilePanelTab(id)}

              style={{

                flex: 1, padding: '10px 0', fontSize: 12, fontWeight: 700,

                color: mobilePanelTab === id ? ACCENT : 'var(--ibo-muted)',

                background: 'transparent', border: 'none', cursor: 'pointer',

                borderBottom: `2px solid ${mobilePanelTab === id ? ACCENT : 'transparent'}`,

              }}>

              {label}

            </button>

          ))}

        </div>



        <div style={{ background: 'var(--ibo-bg)', minHeight: 480 }}>

          {mobilePanelTab === 'trade'

            ? <TradeForm symbol={symbol} lastPrice={livePrice} limitPriceSeed={formPrice} initialSide={formInitialSide} />

            : (

              <div className="h-[520px] min-h-0 overflow-hidden flex flex-col">
                <div className="flex-[1.15] min-h-0 overflow-hidden">
                  <OrderBook
                    symbol={symbol}
                    baseAsset={apiBase}
                    lastPrice={livePrice}
                    onPriceClick={onOrderBookPriceMobile}
                    bookOverride={isIboMock ? iboOrderbook : null}
                  />
                </div>
                <div className="h-[40%] min-h-[160px] border-t border-[color:var(--ibo-border)] overflow-hidden">
                  {isIboMock ? (
                    <IBOTrades trades={iboTrades} loading={iboLoading} />
                  ) : (
                    <RecentTrades symbol={symbol} />
                  )}
                </div>
              </div>

            )}

        </div>



        <div className="min-h-[20vh] border-t border-[color:var(--ibo-border)]">

          <BottomPanel

            symbol={symbol}

            isIboMock={isIboMock}

            iboTrades={iboTrades}

            iboLoading={iboLoading}

          />

        </div>

      </div>



      {/* ═════════ DESKTOP — chart-first; compact orders dock on laptop ═════════ */}

      <div

        className="hidden md:flex flex-col"

        style={{ minHeight: 'calc(100dvh - 4rem)' }}

      >



        <div style={{

          display: 'flex', alignItems: 'center', gap: 12,

          padding: '6px 12px',

          borderBottom: '1px solid var(--ibo-border)',

          background: 'var(--ibo-bg)', flexShrink: 0,

          position: 'relative', zIndex: 200,

          overflowX: 'auto',

        }} className="scrollbar-hide">

          {pairPicker}



          {activeTicker ? (

            <>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, minWidth: '7.5rem' }}>

                <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', color: isUp ? '#22c55e' : '#ef4444', letterSpacing: '-0.3px' }}>

                  ${fmtP(livePrice, apiBase)}

                </span>

                <span style={{ fontSize: 11, fontWeight: 700, color: isUp ? '#22c55e' : '#ef4444' }}>

                  {isUp ? '▲' : '▼'} {isUp ? '+' : ''}{pct.toFixed(2)}%

                </span>

              </div>

              <div className="hidden lg:flex items-center">

                <StatItem label="24h High"   value={`$${fmtP(activeTicker.highPrice, apiBase)}`}  color="text-emerald-400" />

                <StatItem label="24h Low"    value={`$${fmtP(activeTicker.lowPrice, apiBase)}`}   color="text-rose-400" />

                <StatItem label="24h Volume" value={`${fmtVol(activeTicker.volume)} ${displayBase}`} />

                <StatItem label="Quote Vol"  value={apiQuote === 'IBO' ? `${fmtVol(activeTicker.quoteVolume)} Delta` : `$${fmtVol(activeTicker.quoteVolume)}`} />

              </div>

            </>

          ) : (

            <div style={{ height: 24, width: 180, background: 'var(--ibo-hover)', borderRadius: 6 }} className="animate-pulse" />

          )}

        </div>



        <div className="flex min-h-[480px] h-[min(62vh,720px)] shrink-0">

          <div className="flex-1 min-w-0 min-h-0 relative overflow-hidden border-r border-[color:var(--ibo-border)]"

            style={{ pointerEvents: pairOpen ? 'none' : 'auto' }}>

            {isIboMock ? (

              <IBOChart

                candles={iboCandles}

                interval={iboInterval}

                onIntervalChange={setIboInterval}

                fill

              />

            ) : (

              <TradingChart key={symbol} symbol={symbol} />

            )}

          </div>



          {/* Order book (top) + market trades (bottom) — Delta center column */}
          <div className="delta-trade-col delta-trade-book flex flex-col shrink-0 border-r border-[color:var(--ibo-border)] min-h-0 bg-transparent">
            <div className="flex-[1.2] min-h-0 overflow-hidden">
              <OrderBook
                symbol={symbol}
                baseAsset={apiBase}
                lastPrice={livePrice}
                onPriceClick={onOrderBookPrice}
                bookOverride={isIboMock ? iboOrderbook : null}
              />
            </div>
            <div className="flex-[0.85] min-h-[160px] max-h-[280px] border-t border-[color:var(--ibo-border)] overflow-hidden">
              {isIboMock ? (
                <IBOTrades trades={iboTrades} loading={iboLoading} />
              ) : (
                <RecentTrades symbol={symbol} />
              )}
            </div>
          </div>

          {/* Order ticket */}
          <div className="delta-trade-col delta-trade-ticket flex flex-col shrink-0 overflow-hidden bg-transparent">
            <div className="flex-1 overflow-y-auto scrollbar-hide">
              <TradeForm symbol={symbol} lastPrice={livePrice} limitPriceSeed={formPrice} initialSide={formInitialSide} />
            </div>
          </div>

        </div>



        <div className="min-h-[300px] border-t border-[color:var(--ibo-border)]">

          <BottomPanel

            symbol={symbol}

            isIboMock={isIboMock}

            iboTrades={iboTrades}

            iboLoading={iboLoading}

          />

        </div>

      </div>



    </div>

  );

}

