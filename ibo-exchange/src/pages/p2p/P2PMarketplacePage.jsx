import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight, Plus, Loader2, AlertCircle, Search,
  RefreshCw, ShieldCheck, TrendingUp, Users, Zap,
} from 'lucide-react';
import { p2pApi } from '@/services/p2pApi';
import { useAuth } from '@/context/AuthContext';

const ASSETS = ['USDT', 'BTC', 'ETH', 'BNB', 'SOL', 'XRP'];
const PMS    = ['UPI', 'IMPS', 'BANK', 'PAYTM', 'PHONEPE', 'GPAY'];

const fmtINR = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/* ── small reusable pieces ─────────────────────────────────────────────── */
function SidePill({ side }) {
  return side === 'buy'
    ? <span className="inline-flex items-center rounded-full border border-green-400/30 bg-green-400/10 px-2 py-0.5 text-[10px] font-bold uppercase text-green-400">BUY</span>
    : <span className="inline-flex items-center rounded-full border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[10px] font-bold uppercase text-red-400">SELL</span>;
}

export default function P2PMarketplacePage() {
  const { user } = useAuth();
  const [side, setSide]     = useState('buy');
  const [asset, setAsset]   = useState('USDT');
  const [pm, setPm]         = useState('');
  const [amount, setAmount] = useState('');
  const [ads, setAds]       = useState(null);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const params = { side, asset, fiat: 'INR', limit: 40 };
      if (pm) params.payment_type = pm;
      if (amount) params.amount = amount;
      const data = await p2pApi.listAds(params);
      setAds(data.ads || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [side, asset, pm]); // eslint-disable-line

  return (
    <div className="ibo-page font-ui">
      <div className="w-full px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-6 sm:py-8 pb-16">

        {/* ── Hero header ──────────────────────────────────────────── */}
        <div
          className="relative overflow-hidden rounded-xl border border-[color:var(--ibo-border-solid)] mb-6 p-6 sm:p-8"
          style={{
            background:
              'radial-gradient(ellipse 70% 120% at 100% 0%, rgba(254, 108, 2, 0.12), transparent 55%), var(--ibo-bg)',
          }}
        >
          <div
            className="pointer-events-none absolute right-0 top-0 h-full w-1/3 opacity-20"
            style={{ background: 'radial-gradient(ellipse at right center,#FE6C02,transparent 70%)' }}
          />
          <div
            className="pointer-events-none absolute top-0 left-0 right-0 h-px"
            style={{ background: 'linear-gradient(90deg,transparent,rgba(254, 108, 2,0.4) 50%,transparent)' }}
          />

          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="ibo-eyebrow mb-2 flex items-center gap-2">
                <ArrowLeftRight size={12} /> P2P Trading
              </div>
              <h1
                className="text-2xl sm:text-3xl font-extrabold text-[color:var(--ibo-ink)] tracking-tight"
                style={{ fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif" }}
              >
                Peer-to-Peer Exchange
              </h1>
              <p className="mt-1 text-[color:var(--ibo-muted)] text-sm max-w-lg">
                Buy and sell crypto directly with verified users. Every order is secured by platform escrow.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { icon: ShieldCheck, text: 'Escrow protected' },
                  { icon: Zap,         text: 'Instant release' },
                  { icon: Users,       text: 'Verified traders' },
                ].map(({ icon: Icon, text }) => (
                  <span
                    key={text}
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold text-[color:var(--ibo-ink-secondary)] border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-hover)]"
                  >
                    <Icon size={11} className="text-[color:var(--ibo-accent)]" />
                    {text}
                  </span>
                ))}
              </div>
            </div>

            {user && (
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  to="/p2p/my-ads?action=create"
                  className="ibo-hover-scale inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-[#101013] shadow-lg"
                  style={{ background: 'linear-gradient(135deg,#FE6C02,#FE9D55)', boxShadow: '0 4px 20px rgba(254, 108, 2,0.35)' }}
                >
                  <Plus size={15} /> Post Ad
                </Link>
                <Link
                  to="/p2p/orders"
                  className="ibo-hover-border inline-flex items-center gap-2 rounded-xl border border-[color:var(--ibo-border-solid)] bg-transparent px-4 py-2.5 text-sm font-semibold text-[color:var(--ibo-ink)] hover:bg-[color:var(--ibo-hover)]"
                >
                  My Orders
                </Link>
                <Link
                  to="/p2p/my-ads"
                  className="ibo-hover-border inline-flex items-center gap-2 rounded-xl border border-[color:var(--ibo-border-solid)] bg-transparent px-4 py-2.5 text-sm font-semibold text-[color:var(--ibo-ink)] hover:bg-[color:var(--ibo-hover)]"
                >
                  My Ads
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* ── Buy / Sell toggle ─────────────────────────────────────── */}
        <div
          className="mb-5 grid w-full grid-cols-2 gap-1 rounded-xl p-1 bg-transparent"
          style={{ border: '1px solid var(--ibo-border-solid)' }}
        >
          {[['buy', 'Buy Crypto'], ['sell', 'Sell Crypto']].map(([k, lbl]) => {
            const on = side === k;
            const buy = k === 'buy';
            return (
              <button
                key={k}
                type="button"
                onClick={() => setSide(k)}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-bold transition-all duration-200"
                style={
                  on
                    ? buy
                      ? {
                          color: 'var(--ibo-positive)',
                          background: 'color-mix(in srgb, var(--ibo-positive) 16%, transparent)',
                          border: '1px solid color-mix(in srgb, var(--ibo-positive) 45%, transparent)',
                        }
                      : {
                          color: 'var(--ibo-negative)',
                          background: 'color-mix(in srgb, var(--ibo-negative) 16%, transparent)',
                          border: '1px solid color-mix(in srgb, var(--ibo-negative) 45%, transparent)',
                        }
                    : {
                        color: 'var(--ibo-muted)',
                        background: 'transparent',
                        border: '1px solid transparent',
                      }
                }
              >
                {lbl}
              </button>
            );
          })}
        </div>

        {/* ── Asset tabs ───────────────────────────────────────────── */}
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {ASSETS.map((a) => {
            const on = asset === a;
            return (
              <button
                key={a}
                type="button"
                onClick={() => setAsset(a)}
                className="w-full px-3 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all duration-200"
                style={
                  on
                    ? {
                        color: 'var(--ibo-accent)',
                        background: 'var(--ibo-accent-soft)',
                        border: '1px solid color-mix(in srgb, var(--ibo-accent) 50%, transparent)',
                      }
                    : {
                        color: 'var(--ibo-muted)',
                        background: 'transparent',
                        border: '1px solid var(--ibo-border-solid)',
                      }
                }
              >
                {a}
              </button>
            );
          })}
        </div>

        {/* ── Filter bar ───────────────────────────────────────────── */}
        <div className="rounded-xl border border-[color:var(--ibo-border-solid)] bg-transparent p-4 mb-5">
          <div className="grid sm:grid-cols-3 gap-3">
            <select
              value={pm}
              onChange={(e) => { setPm(e.target.value); }}
              className="ibo-select w-full rounded-lg border border-[color:var(--ibo-border-solid)] px-3.5 py-2.5 text-sm text-[color:var(--ibo-ink)] focus:outline-none focus:border-[rgba(254, 108, 2,0.55)] transition-colors"
            >
              <option value="">All payment methods</option>
              {PMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <div className="relative">
              <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--ibo-muted)] pointer-events-none" />
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Filter by amount (₹)"
                className="w-full rounded-lg bg-transparent border border-[color:var(--ibo-border-solid)] pl-9 pr-3.5 py-2.5 text-sm text-[color:var(--ibo-ink)] placeholder:text-[color:var(--ibo-muted)] focus:outline-none focus:border-[rgba(254, 108, 2,0.55)] transition-colors"
              />
            </div>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[color:var(--ibo-border-solid)] bg-transparent px-4 py-2.5 text-sm font-semibold text-[color:var(--ibo-ink-secondary)] hover:bg-[color:var(--ibo-hover)] hover:text-[color:var(--ibo-ink)] transition-colors disabled:opacity-40"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 p-3.5 text-red-400 text-sm mb-4">
            <AlertCircle size={14} className="shrink-0" />{error}
          </div>
        )}

        {/* ── Ads table ────────────────────────────────────────────── */}
        <div className="rounded-xl border border-[color:var(--ibo-border-solid)] bg-transparent overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ibo-border-solid)', background: 'transparent' }}>
                  {['Advertiser', 'Price / Unit', 'Available', 'Order Limits', 'Payment', 'Action'].map((h, i) => (
                    <th
                      key={h}
                      className={`px-5 py-3.5 text-[10px] font-bold uppercase tracking-widest text-[color:var(--ibo-muted)] ${i > 1 ? 'text-right' : 'text-left'}`}
                      style={i === 5 ? { textAlign: 'right' } : i >= 2 ? { textAlign: 'right' } : {}}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-20 text-center">
                      <Loader2 size={18} className="animate-spin inline text-[#FE9D55]" />
                      <p className="text-[color:var(--ibo-muted)] text-sm mt-2">Loading ads…</p>
                    </td>
                  </tr>
                ) : ads === null ? null
                : ads.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-20 text-center">
                      <TrendingUp size={32} className="text-[color:var(--ibo-muted)] opacity-30 mx-auto mb-3" />
                      <p className="text-[color:var(--ibo-ink-secondary)] text-sm font-semibold">No {side} ads available for {asset}</p>
                      <p className="text-[color:var(--ibo-muted)] text-xs mt-1">Try a different filter or be the first to post one.</p>
                      {user && (
                        <Link
                          to="/p2p/my-ads?action=create"
                          className="inline-flex items-center gap-1.5 mt-4 rounded-xl px-4 py-2 text-sm font-bold text-[#101013]"
                          style={{ background: 'linear-gradient(135deg,#FE6C02,#FE9D55)' }}
                        >
                          <Plus size={13} /> Post Ad
                        </Link>
                      )}
                    </td>
                  </tr>
                ) : ads.map((ad) => (
                  <tr key={ad.ad_id} className="ibo-hover-table-row" style={{ borderBottom: '1px solid var(--ibo-border-solid)' }}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-extrabold shrink-0"
                          style={{ background: 'rgba(254, 108, 2,0.15)', color: '#FE9D55', border: '1px solid rgba(254, 108, 2,0.2)' }}
                        >
                          {(ad.maker?.nickname || 'T')[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5 text-[color:var(--ibo-ink)] font-semibold text-sm">
                            {ad.maker?.nickname || 'Trader'}
                            {ad.maker?.is_merchant && <ShieldCheck size={12} className="text-[#FE9D55]" />}
                          </div>
                          <div className="text-[color:var(--ibo-muted)] text-xs mt-0.5">
                            {ad.maker?.trades_total ?? 0} trades · {(ad.maker?.completion_rate_30d ?? 100).toFixed(0)}% done
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-right">
                        <p className="text-[color:var(--ibo-ink)] font-extrabold text-base tabular-nums">₹{fmtINR(ad.price)}</p>
                        <p className="text-[color:var(--ibo-muted)] text-[10px] mt-0.5">per {ad.asset}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <p className="text-[color:var(--ibo-ink)] font-mono text-sm tabular-nums">{Number(ad.available_amount || 0).toFixed(4)}</p>
                      <p className="text-[color:var(--ibo-muted)] text-[10px]">{ad.asset}</p>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <p className="text-[color:var(--ibo-ink-secondary)] text-xs whitespace-nowrap">₹{fmtINR(ad.min_order_inr)}</p>
                      <p className="text-[color:var(--ibo-muted)] text-[10px]">– ₹{fmtINR(ad.max_order_inr)}</p>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1 justify-end">
                        {(ad.payment_methods || []).slice(0, 2).map((p) => (
                          <span
                            key={p.pm_id}
                            className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase text-[#FE9D55]"
                            style={{ background: 'rgba(254, 108, 2,0.1)', border: '1px solid rgba(254, 108, 2,0.2)' }}
                          >
                            {p.type}
                          </span>
                        ))}
                        {(ad.payment_methods?.length || 0) > 2 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] text-[color:var(--ibo-muted)] border border-[color:var(--ibo-border-solid)]">
                            +{ad.payment_methods.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        to={`/p2p/ads/${ad.ad_id}`}
                        className={`ibo-hover-scale inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                          side === 'buy'
                            ? 'border border-green-500/30 bg-green-500/15 text-green-400 hover:bg-green-500/25'
                            : 'border border-red-500/30 bg-red-500/15 text-red-400 hover:bg-red-500/25'
                        }`}
                      >
                        {side === 'buy' ? 'Buy' : 'Sell'} {ad.asset}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {user && (
          <div className="mt-5 flex items-center gap-4 text-sm text-[color:var(--ibo-muted)]">
            <Link to="/p2p/payment-methods" className="hover:text-[#FE9D55] transition-colors">Payment Methods</Link>
            <span className="opacity-40">·</span>
            <Link to="/p2p/merchant" className="hover:text-[#FE9D55] transition-colors">Merchant Program</Link>
          </div>
        )}
      </div>
    </div>
  );
}
