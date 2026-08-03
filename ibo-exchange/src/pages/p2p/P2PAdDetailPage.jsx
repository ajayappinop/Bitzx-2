import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ShieldCheck, Loader2, AlertCircle, Clock,
  Info, CheckCircle2, Lock,
} from 'lucide-react';
import { p2pApi } from '@/services/p2pApi';
import { useAuth } from '@/context/AuthContext';

const fmtINR = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function StatCard({ label, value, accent }) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: 'var(--ibo-elevated)', border: '1px solid var(--ibo-border-solid)' }}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-white/35 mb-1">{label}</p>
      <p className={`text-sm font-extrabold tabular-nums ${accent ? 'text-[#5BB8FF]' : 'text-white'}`}>{value}</p>
    </div>
  );
}

export default function P2PAdDetailPage() {
  const { adId } = useParams();
  const { user } = useAuth();
  const nav      = useNavigate();

  const [ad, setAd]         = useState(null);
  const [myPms, setMyPms]   = useState([]);
  const [pmId, setPmId]     = useState('');
  const [fiatAmount, setFiatAmount] = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    p2pApi.adDetail(adId).then(async (data) => {
      setAd(data);
      if (data.side === 'sell') {
        if (data.payment_methods?.length) setPmId(data.payment_methods[0].pm_id);
      } else {
        try {
          const mine = await p2pApi.listPaymentMethods();
          const accepted = new Set((data.payment_methods || []).map((p) => p.type));
          const filtered = (mine.payment_methods || []).filter((p) => accepted.size === 0 || accepted.has(p.type));
          setMyPms(filtered);
          if (filtered.length) setPmId(filtered[0].pm_id);
        } catch {}
      }
    }).catch((e) => setError(e.message));
  }, [adId]);

  const openOrder = async () => {
    if (!user) { nav('/login'); return; }
    setBusy(true); setError('');
    try {
      const data = await p2pApi.openOrder({ ad_id: adId, fiat_amount: fiatAmount, payment_method_id: pmId });
      nav(`/p2p/orders/${data.order_id}`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (!ad && !error) return (
    <div className="ibo-page flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-[#0EA4AB]" />
    </div>
  );
  if (error && !ad) return (
    <div className="ibo-page flex items-center justify-center text-red-400 text-sm">
      <AlertCircle size={16} className="mr-2" />{error}
    </div>
  );

  const isBuyerView = ad.side === 'sell';
  const cryptoEst = fiatAmount && ad.price
    ? (Number(fiatAmount) / Number(ad.price)).toFixed(6) : '0';
  const canOrder = fiatAmount && pmId && (isBuyerView || myPms.length > 0);

  return (
    <div className="ibo-page font-ui">
      <div className="w-full px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-6 sm:py-8 pb-16">

        <Link to="/p2p" className="inline-flex items-center gap-1.5 text-white/50 hover:text-[#5BB8FF] text-sm mb-6 transition-colors">
          <ArrowLeft size={14} /> Back to marketplace
        </Link>

        <div className="grid lg:grid-cols-[1fr,380px] gap-6">

          {/* ── Left: Ad info ─────────────────────────────────────── */}
          <div className="space-y-4">

            {/* Maker card */}
            <div className="ibo-hover-lift ibo-hover-glow rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] p-6">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-extrabold shrink-0"
                  style={{ background: 'rgba(14,164,171,0.15)', color: '#5BB8FF', border: '2px solid rgba(14,164,171,0.25)' }}>
                  {(ad.maker?.nickname || 'T')[0].toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2 text-white font-bold text-lg">
                    {ad.maker?.nickname || 'Trader'}
                    {ad.maker?.is_merchant && (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase text-[#5BB8FF]"
                        style={{ background: 'rgba(14,164,171,0.12)', border: '1px solid rgba(14,164,171,0.25)' }}>
                        <ShieldCheck size={9} /> Merchant
                      </span>
                    )}
                  </div>
                  <p className="text-white/45 text-sm mt-0.5">
                    {ad.maker?.trades_total ?? 0} trades · {(ad.maker?.completion_rate_30d ?? 100).toFixed(0)}% completion rate
                    {ad.maker?.joined_at && <> · Joined {new Date(ad.maker.joined_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</>}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Price" value={`₹${fmtINR(ad.price)}`} accent />
                <StatCard label="Available" value={`${Number(ad.available_amount).toFixed(4)} ${ad.asset}`} />
                <StatCard label="Limits" value={`₹${fmtINR(ad.min_order_inr)} – ₹${fmtINR(ad.max_order_inr)}`} />
              </div>
            </div>

            {/* Payment methods */}
            <div className="rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/35 mb-3">Accepted Payment Methods</p>
              <div className="flex flex-wrap gap-2">
                {(ad.payment_methods || []).map((p) => (
                  <span key={p.pm_id} className="px-3 py-1.5 rounded-xl text-xs font-bold text-[#5BB8FF]"
                    style={{ background: 'rgba(14,164,171,0.1)', border: '1px solid rgba(14,164,171,0.22)' }}>
                    {p.type}
                  </span>
                ))}
              </div>
            </div>

            {/* Terms */}
            {ad.terms && (
              <div className="rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] p-5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/35 mb-2">Advertiser's Terms</p>
                <p className="text-sm text-white/75 whitespace-pre-wrap leading-relaxed">{ad.terms}</p>
              </div>
            )}

            {/* Payment window notice */}
            <div className="flex items-start gap-3 rounded-2xl p-4"
              style={{ background: 'rgba(14,164,171,0.06)', border: '1px solid rgba(14,164,171,0.18)' }}>
              <Clock size={15} className="text-[#5BB8FF] shrink-0 mt-0.5" />
              <p className="text-sm text-white/75 leading-relaxed">
                Payment window: <strong className="text-[#5BB8FF]">{ad.payment_window_min} minutes</strong>.
                Crypto is locked in escrow when you open an order and released only after the seller confirms your payment.
              </p>
            </div>
          </div>

          {/* ── Right: Order panel ────────────────────────────────── */}
          <div className="h-fit rounded-2xl p-6 space-y-5"
            style={{
              background: 'linear-gradient(160deg, var(--ibo-card) 0%, var(--ibo-elevated) 100%)',
              border: '1px solid rgba(14,164,171,0.2)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
            }}>

            {/* Shimmer top */}
            <div className="absolute -top-px left-6 right-6 h-px rounded-full"
              style={{ background: 'linear-gradient(90deg,transparent,rgba(14,164,171,0.5),transparent)' }} />

            <h3 className="font-extrabold text-white text-lg" style={{ fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif" }}>
              {isBuyerView ? `Buy ${ad.asset}` : `Sell ${ad.asset}`}
            </h3>

            {/* Amount input */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">
                {isBuyerView ? 'Amount you want to spend (₹)' : 'Amount you want to receive (₹)'}
              </label>
              <input type="number" value={fiatAmount} onChange={(e) => setFiatAmount(e.target.value)}
                placeholder={`Min ₹${fmtINR(ad.min_order_inr)}`}
                className="w-full rounded-xl px-3.5 py-3 text-[color:var(--ibo-ink)] text-sm placeholder:text-[color:var(--ibo-muted)] focus:outline-none transition-all"
                style={{ background: 'var(--ibo-elevated)', border: '1px solid var(--ibo-border-solid)', outline: 'none' }}
                onFocus={(e) => { e.target.style.borderColor = 'rgba(14,164,171,0.55)'; e.target.style.boxShadow = '0 0 0 3px rgba(14,164,171,0.1)'; }}
                onBlur={(e)  => { e.target.style.borderColor = 'var(--ibo-border-solid)'; e.target.style.boxShadow = 'none'; }}
              />
            </div>

            {/* Crypto estimate */}
            {fiatAmount && (
              <div className="flex items-center justify-between rounded-xl px-4 py-3"
                style={{ background: 'rgba(14,164,171,0.07)', border: '1px solid rgba(14,164,171,0.15)' }}>
                <span className="text-sm text-white/60">You will {isBuyerView ? 'receive' : 'send'}</span>
                <span className="text-[#5BB8FF] font-extrabold tabular-nums">{cryptoEst} {ad.asset}</span>
              </div>
            )}

            {/* Payment selector */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Payment Method</label>
              {isBuyerView ? (
                <select value={pmId} onChange={(e) => setPmId(e.target.value)}
                  className="w-full rounded-xl px-3.5 py-2.5 text-[color:var(--ibo-ink)] text-sm focus:outline-none transition-colors"
                  style={{ background: 'var(--ibo-elevated)', border: '1px solid var(--ibo-border-solid)' }}>
                  {(ad.payment_methods || []).map((p) => (
                    <option key={p.pm_id} value={p.pm_id}>{p.display_name} · {p.type}</option>
                  ))}
                </select>
              ) : myPms.length > 0 ? (
                <select value={pmId} onChange={(e) => setPmId(e.target.value)}
                  className="w-full rounded-xl px-3.5 py-2.5 text-[color:var(--ibo-ink)] text-sm focus:outline-none transition-colors"
                  style={{ background: 'var(--ibo-elevated)', border: '1px solid var(--ibo-border-solid)' }}>
                  {myPms.map((p) => (
                    <option key={p.pm_id} value={p.pm_id}>{p.display_name} · {p.type}</option>
                  ))}
                </select>
              ) : (
                <div className="flex items-start gap-2.5 rounded-xl p-3.5"
                  style={{ background: 'rgba(197,227,91,0.07)', border: '1px solid rgba(197,227,91,0.2)' }}>
                  <AlertCircle size={13} className="text-gold shrink-0 mt-0.5" />
                  <span className="text-sm text-white/70">No matching payment method.{' '}
                    <Link to="/p2p/payment-methods" className="text-[#5BB8FF] font-semibold hover:underline">Add one</Link> first.
                  </span>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl p-3.5 text-red-400 text-sm"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <AlertCircle size={13} className="shrink-0 mt-0.5" />{error}
              </div>
            )}

            {/* CTA button */}
            <button onClick={openOrder} disabled={busy || !canOrder}
              className="ibo-hover-scale w-full py-3.5 rounded-xl text-sm font-extrabold transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              style={!user || !canOrder ? {
                background: 'var(--ibo-card)', border: '1px solid var(--ibo-border-solid)', color: 'var(--ibo-muted)',
              } : isBuyerView ? {
                background: 'linear-gradient(135deg,rgba(74,222,128,0.25),rgba(74,222,128,0.12))',
                border: '1px solid rgba(74,222,128,0.35)', color: '#4ade80',
                boxShadow: '0 4px 20px rgba(74,222,128,0.15)',
              } : {
                background: 'linear-gradient(135deg,rgba(248,113,113,0.25),rgba(248,113,113,0.12))',
                border: '1px solid rgba(248,113,113,0.35)', color: '#f87171',
                boxShadow: '0 4px 20px rgba(248,113,113,0.15)',
              }}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {!user ? 'Sign in to trade' : isBuyerView ? `Open Buy Order` : `Open Sell Order`}
            </button>

            {/* Safety note */}
            <div className="flex items-start gap-2 rounded-xl p-3.5"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Info size={12} className="text-white/30 shrink-0 mt-0.5" />
              <p className="text-xs text-white/40 leading-relaxed">
                Funds are protected by platform escrow. Never trade off-platform or share personal details outside the order chat.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
