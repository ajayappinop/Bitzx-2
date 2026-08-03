import { useState, useEffect, useMemo } from 'react';

import { Link, Navigate } from 'react-router-dom';

import { motion } from 'framer-motion';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as PieTooltip, Legend } from 'recharts';

import {

  Wallet, TrendingUp, TrendingDown, ArrowUpRight, ArrowRight,

  BarChart2, Clock, CheckCircle, XCircle, Copy, Check,

} from 'lucide-react';

import { useAuth } from '@/context/AuthContext';

import { COIN_ICONS, exchangeWsPath, normalizeMarketsList } from '@/services/marketApi';

import HomeBannerCarousel from '@/components/dashboard/HomeBannerCarousel';



const PIE_COLORS = ['#FE6C02', '#3b82f6', '#FE6C02', '#10b981', '#FE6C02', '#ef4444', '#B44D01', '#ec4899', '#14b8a6', '#f97316'];



const TABS = ['Portfolio', 'Orders', 'History'];



function CopyBtn({ text }) {

  const [copied, setCopied] = useState(false);

  const copy = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (

    <button type="button" onClick={copy} className="text-white hover:text-gold-light transition-colors">

      {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}

    </button>

  );

}



function PortfolioTab({ walletAssets, priceByAsset, positions, liveLoading }) {

  const px = a => (a === 'USDT' ? 1 : (priceByAsset[a] ?? 0));

  const totalUSD = walletAssets.reduce((s, w) => s + (w.available + w.locked) * px(w.asset), 0);



  const { unrealized, invested, pct } = useMemo(() => {

    const u = positions.reduce((s, p) => s + (parseFloat(p.unrealized_pnl) || 0), 0);

    const inv = positions.reduce((s, p) => s + (parseFloat(p.total_invested) || 0), 0);

    const pc = inv > 1e-8 ? (u / inv) * 100 : 0;

    return { unrealized: u, invested: inv, pct: pc };

  }, [positions]);



  const allocationData = useMemo(() => {

    return walletAssets

      .map(w => {

        const qty = w.available + w.locked;

        const v = qty * px(w.asset);

        return { name: w.asset, value: v };

      })

      .filter(x => x.value > 1e-6)

      .sort((a, b) => b.value - a.value);

  }, [walletAssets, priceByAsset]);



  return (

    <div className="space-y-6">

      <div className="ibo-hover-lift ibo-hover-glow bg-surface-DEFAULT border border-surface-border rounded-2xl p-6">

        <p className="text-white text-sm mb-1">Total portfolio value (est.)</p>

        <p className="text-4xl font-extrabold text-white mb-1">

          ${totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}

        </p>

        {liveLoading ? (

          <p className="text-white/50 text-sm">Loading live prices…</p>

        ) : (

          <div className={`text-sm font-semibold flex flex-wrap items-center gap-1 ${unrealized >= 0 ? 'text-green-400' : 'text-red-400'}`}>

            {unrealized >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}

            <span>

              Unrealized P&amp;L (tracked positions): {unrealized >= 0 ? '+' : ''}

              ${unrealized.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}

              {invested > 1e-6 && (

                <span className="text-white/80 font-normal">

                  {' '}({pct >= 0 ? '+' : ''}{pct.toFixed(2)}% vs. average cost)

                </span>

              )}

            </span>

          </div>

        )}

        <p className="text-white/45 text-xs mt-2">

          USD values use live quotes from markets (Delta internal ticker, others via exchange feed).

        </p>

      </div>



      <div className="ibo-hover-lift ibo-hover-glow bg-surface-DEFAULT border border-surface-border rounded-2xl p-6">

        <p className="text-white font-bold mb-4">Allocation by value</p>

        {allocationData.length === 0 ? (

          <p className="text-white/60 text-sm py-8 text-center">No balances to chart yet.</p>

        ) : (

          <ResponsiveContainer width="100%" height={220}>

            <PieChart>

              <Pie

                data={allocationData}

                dataKey="value"

                nameKey="name"

                cx="50%"

                cy="50%"

                innerRadius={52}

                outerRadius={84}

                paddingAngle={2}

              >

                {allocationData.map((entry, i) => (

                  <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="rgba(0,0,0,0.2)" />

                ))}

              </Pie>

              <PieTooltip

                formatter={(v, _n, item) => [`$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, item.payload.name]}

                contentStyle={{ background: '#12141a', border: '1px solid #2a2d35', borderRadius: 8, fontSize: 12 }}

                labelStyle={{ color: '#ffffff' }}

              />

              <Legend wrapperStyle={{ fontSize: 12, color: '#e5e5e5' }} />

            </PieChart>

          </ResponsiveContainer>

        )}

      </div>



      <div className="ibo-hover-lift ibo-hover-border bg-surface-DEFAULT border border-surface-border rounded-2xl overflow-hidden">

        <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between">

          <p className="text-white font-bold">Your assets</p>

          <Link to="/wallet" className="text-xs text-gold-light hover:underline flex items-center gap-1">

            Manage <ArrowRight size={11} />

          </Link>

        </div>

        <div className="overflow-x-auto">

          <table className="w-full">

            <thead>

              <tr className="text-[11px] text-white uppercase tracking-wider border-b border-surface-border">

                <th className="px-5 py-2 text-left">Asset</th>

                <th className="px-5 py-2 text-right">Available</th>

                <th className="px-5 py-2 text-right">Locked</th>

                <th className="px-5 py-2 text-right">Value (USD)</th>

                <th className="px-5 py-2 text-right">Action</th>

              </tr>

            </thead>

            <tbody>

              {walletAssets.map(w => {

                const usd = (w.available + w.locked) * px(w.asset);

                const icon = COIN_ICONS[w.asset];

                return (

                  <tr key={w.asset} className="ibo-hover-table-row border-b border-surface-border/50">

                    <td className="px-5 py-3">

                      <div className="flex items-center gap-3">

                        {icon ? <img src={icon} alt={w.asset} className="w-8 h-8 rounded-full" />

                          : <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center text-gold-light text-xs font-bold">{w.asset.slice(0, 2)}</div>}

                        <span className="text-white font-bold">{w.asset}</span>

                      </div>

                    </td>

                    <td className="px-5 py-3 text-right text-green-400 font-mono font-semibold">

                      {w.available.toFixed(w.asset === 'USDT' ? 2 : 6)}

                    </td>

                    <td className="px-5 py-3 text-right text-gold-light font-mono">

                      {w.locked.toFixed(w.asset === 'USDT' ? 2 : 6)}

                    </td>

                    <td className="px-5 py-3 text-right text-white font-semibold">

                      ${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}

                    </td>

                    <td className="px-5 py-3 text-right">

                      {w.asset !== 'USDT' && (

                        <Link

                          to={`/trade/${w.asset}USDT`}

                          className="text-xs text-gold-light bg-gold/10 hover:bg-gold/20 border border-gold/20 px-3 py-1 rounded-lg transition-colors inline-flex items-center gap-1"

                        >

                          Trade <ArrowRight size={11} />

                        </Link>

                      )}

                    </td>

                  </tr>

                );

              })}

            </tbody>

          </table>

        </div>

      </div>

    </div>

  );

}



function OrdersTab({ orders }) {

  const fmt = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

  const fmtP = v => { const n = parseFloat(v); return n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(4) : n.toFixed(6); };

  return (

    <div className="bg-surface-DEFAULT border border-surface-border rounded-2xl overflow-hidden">

      <div className="px-5 py-3 border-b border-surface-border flex items-center justify-between">

        <p className="text-white font-bold">All orders</p>

        <span className="text-white text-xs">{orders.length} total</span>

      </div>

      {orders.length === 0 ? (

        <div className="flex flex-col items-center justify-center py-16 gap-3 text-white">

          <Clock size={32} />

          <p>No orders yet</p>

          <Link to="/trade/IBOUSDT" className="text-gold-light text-sm hover:underline">Start trading →</Link>

        </div>

      ) : (

        <div className="overflow-x-auto">

          <table className="w-full" style={{ minWidth: 560 }}>

            <thead className="border-b border-surface-border">

              <tr className="text-[11px] text-white uppercase tracking-wider">

                {['Date', 'Pair', 'Type', 'Side', 'Price', 'Amount / Filled', 'Status'].map(h => (

                  <th key={h} className="px-5 py-2 text-left">{h}</th>

                ))}

              </tr>

            </thead>

            <tbody>

              {orders.map(o => (

                <tr key={o.id} className="ibo-hover-table-row border-b border-surface-border/50">

                  <td className="px-5 py-2.5 text-xs text-white">{fmt(o.created_at)}</td>

                  <td className="px-5 py-2.5 text-sm text-white font-bold">{o.symbol}</td>

                  <td className="px-5 py-2.5 text-xs text-white capitalize">{o.type}</td>

                  <td className="px-5 py-2.5">

                    <span className={`text-xs font-bold ${o.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>{o.side?.toUpperCase()}</span>

                  </td>

                  <td className="px-5 py-2.5 text-sm text-white font-mono">

                    {o.type === 'market'

                      ? <span className="text-white">MKT</span>

                      : `$${fmtP(o.avg_price > 0 ? o.avg_price : o.price)}`}

                  </td>

                  <td className="px-5 py-2.5 text-sm text-white font-mono">

                    {o.filled > 0 ? `${o.filled.toFixed(4)} / ` : ''}{o.amount.toFixed(4)}

                  </td>

                  <td className="px-5 py-2.5">

                    <span className={`flex items-center gap-1 text-xs font-semibold capitalize ${

                      o.status === 'filled' ? 'text-green-400' : o.status === 'cancelled' ? 'text-red-400'

                        : o.status === 'partially_filled' ? 'text-blue-400' : 'text-white'

                    }`}>

                      {o.status === 'filled' ? <CheckCircle size={11} /> : o.status === 'cancelled' ? <XCircle size={11} /> : <Clock size={11} />}

                      {o.status.replace('_', ' ')}

                    </span>

                  </td>

                </tr>

              ))}

            </tbody>

          </table>

        </div>

      )}

    </div>

  );

}



export default function DashboardPage() {

  const { user, walletAssets, balance, openOrders, orderHistory, liveSpotPositions } = useAuth();

  const [tab, setTab] = useState('Portfolio');

  const [priceByAsset, setPriceByAsset] = useState({ USDT: 1 });



  const positions = liveSpotPositions ?? [];

  const liveLoading = Boolean(user && liveSpotPositions == null);



  useEffect(() => {

    if (!user) return undefined;

    let closed = false;

    let rm = null;

    let wsM = null;

    const applyMarkets = (rows) => {

      const m = { USDT: 1 };

      for (const row of rows || []) {

        const b = row.base || row.symbol?.replace('USDT', '');

        if (b) m[b] = parseFloat(row.price) || 0;

      }

      setPriceByAsset(m);

    };

    const connectMarkets = () => {

      if (closed) return;

      wsM = new WebSocket(exchangeWsPath('/api/ws/exchange/markets'));

      wsM.onmessage = (ev) => {

        try {

          const j = JSON.parse(ev.data);

          if (j.type === 'exchange_markets' && Array.isArray(j.markets)) {

            applyMarkets(normalizeMarketsList(j.markets));

          }

        } catch {

          /* ignore */

        }

      };

      wsM.onclose = () => {

        wsM = null;

        if (!closed) rm = window.setTimeout(connectMarkets, 3000);

      };

    };

    connectMarkets();

    return () => {

      closed = true;

      if (rm) window.clearTimeout(rm);

      if (wsM) {

        try {

          wsM.close();

        } catch {

          /* ignore */

        }

      }

    };

  }, [user]);



  if (!user) return <Navigate to="/login" replace />;



  return (

    <div className="ibo-page">

      <div className="w-full px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-8 sm:py-10">

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">

          <div className="flex flex-wrap items-start sm:items-center justify-between gap-4">

            <div>

              <p className="ibo-eyebrow mb-1">Dashboard</p>

              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">

                Welcome back, {user.name}

              </h1>

              <p className="text-zinc-400 text-xs mt-1.5 flex items-center gap-1.5">

                {user.email}

                <CopyBtn text={user.email} />

              </p>

            </div>

            <div className="flex items-center gap-3 flex-wrap">

              <Link

                to="/wallet"

                className="ibo-hover-border flex items-center gap-2 border border-surface-border text-white font-semibold px-4 py-2.5 rounded-xl text-sm"

              >

                <Wallet size={15} /> Wallet

              </Link>

              <Link

                to="/trade/IBOUSDT"

                className="ibo-hover-scale flex items-center gap-2 bg-logo-gradient text-surface-dark font-bold px-5 py-2.5 rounded-xl text-sm shadow-md shadow-black/25"

              >

                <BarChart2 size={16} /> Trade now

              </Link>

            </div>

          </div>

        </motion.div>



        <HomeBannerCarousel className="mb-8" height="300px" />



        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">

          {[

            { icon: Wallet, label: 'USDT balance', value: `$${(balance?.USDT || 0).toFixed(2)}`, color: 'text-gold-light' },

            { icon: TrendingUp, label: 'Delta holdings', value: `${(walletAssets.find(w => w.asset === 'IBO')?.available || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} Delta`, color: 'text-blue-400' },

            { icon: ArrowUpRight, label: 'Open orders', value: `${openOrders.length}`, color: 'text-green-400' },

            { icon: CheckCircle, label: 'Filled orders', value: `${orderHistory.filter(o => o.status === 'filled').length}`, color: 'text-green-400' },

          ].map((s, i) => (

            <motion.div

              key={s.label}

              initial={{ opacity: 0, y: 16 }}

              animate={{ opacity: 1, y: 0 }}

              transition={{ delay: i * 0.08 }}

              className="ibo-hover-lift ibo-hover-border bg-surface-DEFAULT border border-surface-border rounded-xl p-4"

            >

              <div className="flex items-center gap-2 mb-2">

                <s.icon size={15} className={s.color} />

                <span className="text-white text-xs">{s.label}</span>

              </div>

              <p className="text-white font-bold text-lg">{s.value}</p>

            </motion.div>

          ))}

        </div>



        <div className="flex gap-1 border-b border-surface-border mb-6 overflow-x-auto scrollbar-hide">

          {TABS.map(t => (

            <button

              key={t}

              type="button"

              onClick={() => setTab(t)}

              className={`px-5 py-2.5 text-sm font-bold border-b-2 transition-colors ${

                tab === t ? 'border-gold text-gold-light' : 'border-transparent text-white hover:text-white'

              }`}

            >

              {t}

            </button>

          ))}

        </div>



        {tab === 'Portfolio' && (

          <PortfolioTab

            walletAssets={walletAssets}

            priceByAsset={priceByAsset}

            positions={positions}

            liveLoading={liveLoading}

          />

        )}

        {tab === 'Orders' && <OrdersTab orders={openOrders} />}

        {tab === 'History' && <OrdersTab orders={orderHistory} />}

      </div>

    </div>

  );

}

