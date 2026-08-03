import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, ToggleLeft, ToggleRight,
  Loader2, AlertCircle, Info,
} from 'lucide-react';
import { p2pApi } from '@/services/p2pApi';
import P2PModal from './P2PModal';

const ASSETS = ['USDT', 'BTC', 'ETH', 'BNB', 'SOL', 'XRP'];

const STATUS_STYLE = {
  active:    'border-green-400/30 bg-green-400/10 text-green-400',
  paused:    'border-gold/30 bg-[rgba(91,184,255,0.1)] text-gold',
  suspended: 'border-red-400/30 bg-red-400/10 text-red-400',
};

function FF({ label, required, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40">
        {label}{required && <span className="text-red-400 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

const inp = 'w-full rounded-xl bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] px-3.5 py-2.5 text-[color:var(--ibo-ink)] text-sm placeholder:text-[color:var(--ibo-muted)] focus:outline-none focus:border-[rgba(91,184,255,0.55)] transition-colors';
const sel = 'w-full rounded-xl bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] px-3.5 py-2.5 text-[color:var(--ibo-ink)] text-sm focus:outline-none focus:border-[rgba(91,184,255,0.55)] transition-colors';

export default function P2PMyAdsPage() {
  const [searchParams] = useSearchParams();
  const [ads, setAds]           = useState(null);
  const [myPms, setMyPms]       = useState([]);
  const [showForm, setShowForm] = useState(searchParams.get('action') === 'create');
  const [editing, setEditing]   = useState(null);
  const [busy, setBusy]         = useState({});
  const [error, setError]       = useState('');
  const [formError, setFormError] = useState('');

  const blankForm = () => ({
    side: 'sell', asset: 'USDT',
    price_type: 'fixed', price: '', margin_pct: '0',
    total_amount: '', min_order_inr: '', max_order_inr: '',
    payment_window_min: '15', terms: '',
    selected_pms: [],
  });
  const [form, setForm] = useState(blankForm);

  const loadAds = async () => {
    try { const d = await p2pApi.listMyAds(); setAds(d.ads || []); }
    catch (e) { setError(e.message); }
  };
  const loadPms = async () => {
    try { const d = await p2pApi.listPaymentMethods(); setMyPms(d.payment_methods || []); }
    catch {}
  };
  useEffect(() => { loadAds(); loadPms(); }, []);

  const b  = (k) => busy[k];
  const sb = (k, v) => setBusy((s) => ({ ...s, [k]: v }));

  const openCreate = () => {
    setEditing(null); setForm(blankForm()); setFormError(''); setShowForm(true);
  };
  const openEdit = (ad) => {
    setEditing(ad);
    setForm({
      side: ad.side, asset: ad.asset,
      price_type: ad.price_type === 'floating' ? 'floating' : 'fixed',
      price: String(ad.price || ''), margin_pct: String(ad.margin_pct || '0'),
      total_amount: String(ad.total_amount || ''),
      min_order_inr: String(ad.min_order_inr || ''),
      max_order_inr: String(ad.max_order_inr || ''),
      payment_window_min: String(ad.payment_window_min || '15'),
      terms: ad.terms || '',
      selected_pms: (ad.payment_methods || []).map((p) => p.pm_id),
    });
    setFormError(''); setShowForm(true);
  };

  const validateAdForm = () => {
    if (form.price_type === 'fixed' && !form.price.trim()) return 'Price is required for fixed-price ads.';
    if (!form.total_amount.trim()) return 'Total quantity is required.';
    if (!form.min_order_inr.trim()) return 'Minimum order amount is required.';
    if (!form.max_order_inr.trim()) return 'Maximum order amount is required.';
    if (Number(form.min_order_inr) <= 0) return 'Minimum order must be greater than ₹0.';
    if (Number(form.max_order_inr) <= Number(form.min_order_inr)) return 'Maximum order must be greater than minimum order.';
    if (!form.selected_pms.length) return 'Select at least one payment method.';
    return null;
  };

  const submitAd = async () => {
    setFormError('');
    const err = validateAdForm();
    if (err) { setFormError(err); return; }
    sb('submit', true);
    try {
      const payload = {
        side: form.side, asset: form.asset, fiat: 'INR',
        price_type: form.price_type,
        price:      form.price_type === 'fixed' ? form.price.trim() : undefined,
        margin_pct: form.price_type === 'floating' ? form.margin_pct.trim() : undefined,
        total_amount:       form.total_amount.trim(),
        min_order_inr:      form.min_order_inr.trim(),
        max_order_inr:      form.max_order_inr.trim(),
        payment_window_min: parseInt(form.payment_window_min, 10),
        payment_method_ids: form.selected_pms,
        terms:              form.terms.trim() || undefined,
      };
      if (editing) await p2pApi.updateAd(editing.ad_id, payload);
      else         await p2pApi.createAd(payload);
      setShowForm(false); loadAds();
    } catch (e) {
      const detail = e.detail || e.message || 'Failed to save ad';
      setFormError(Array.isArray(detail) ? detail.map((d) => d.msg || JSON.stringify(d)).join(' · ') : String(detail));
    }
    finally { sb('submit', false); }
  };

  const toggleAd = async (ad) => {
    sb(ad.ad_id, true);
    try {
      if (ad.status === 'active') await p2pApi.pauseAd(ad.ad_id);
      else                        await p2pApi.resumeAd(ad.ad_id);
      loadAds();
    } catch (e) { alert(e.message); }
    finally { sb(ad.ad_id, false); }
  };

  const deleteAd = async (adId) => {
    if (!window.confirm('Cancel and remove this ad?')) return;
    sb(`del_${adId}`, true);
    try { await p2pApi.cancelAd(adId); loadAds(); }
    catch (e) { alert(e.message); }
    finally { sb(`del_${adId}`, false); }
  };

  return (
    <div className="ibo-page font-ui">
      <div className="w-full px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-6 sm:py-8 pb-16">

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[color:var(--ibo-ink)] tracking-tight" style={{ fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif" }}>
              My P2P Ads
            </h1>
            <p className="text-[color:var(--ibo-muted)] text-sm mt-1">Create and manage your buy / sell advertisements.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/p2p" className="ibo-hover-border inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] px-4 py-2.5 text-sm font-semibold text-[color:var(--ibo-ink-secondary)] hover:text-[color:var(--ibo-ink)] transition-colors">
              ← Marketplace
            </Link>
            <button onClick={openCreate}
              className="ibo-hover-scale inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-[#050a1a]"
              style={{ background: 'linear-gradient(135deg,#0EA4AB,#5BB8FF)', boxShadow: '0 4px 20px rgba(14,164,171,0.3)' }}>
              <Plus size={15} /> Post Ad
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 p-3.5 text-red-400 text-sm mb-4">
            <AlertCircle size={14} className="shrink-0" />{error}
          </div>
        )}

        {/* Ads table */}
        <div className="rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ibo-border-solid)', background: 'var(--ibo-elevated)' }}>
                  {['Type', 'Price', 'Available', 'Limits (₹)', 'Payment', 'Status', 'Actions'].map((h, i) => (
                    <th key={h} className={`px-5 py-3.5 text-[10px] font-bold uppercase tracking-widest text-white/35 ${i === 6 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ads === null ? (
                  <tr><td colSpan={7} className="px-5 py-16 text-center">
                    <Loader2 size={18} className="animate-spin inline text-[#5BB8FF]" />
                    <p className="text-white/40 text-xs mt-2">Loading…</p>
                  </td></tr>
                ) : ads.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-16 text-center">
                    <p className="text-white/50 font-semibold text-sm">No ads yet</p>
                    <p className="text-white/30 text-xs mt-1">Post your first ad to start trading.</p>
                    <button onClick={openCreate}
                      className="inline-flex items-center gap-1.5 mt-4 rounded-xl px-4 py-2 text-sm font-bold text-[#050a1a]"
                      style={{ background: 'linear-gradient(135deg,#0EA4AB,#5BB8FF)' }}>
                      <Plus size={13} /> Create Ad
                    </button>
                  </td></tr>
                ) : ads.map((ad) => (
                  <tr key={ad.ad_id} className="ibo-hover-table-row" style={{ borderBottom: '1px solid var(--ibo-border-solid)' }}>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                        ad.side === 'sell' ? 'border-red-400/30 bg-red-400/10 text-red-400' : 'border-green-400/30 bg-green-400/10 text-green-400'
                      }`}>
                        {ad.side} {ad.asset}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono text-sm text-white tabular-nums">
                      {ad.price_type === 'floating'
                        ? <span className="text-[#5BB8FF]">{Number(ad.margin_pct) > 0 ? '+' : ''}{ad.margin_pct}% float</span>
                        : `₹${Number(ad.price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
                      }
                    </td>
                    <td className="px-5 py-4 font-mono text-sm text-white/80 tabular-nums">{Number(ad.available_amount || 0).toFixed(4)}</td>
                    <td className="px-5 py-4 text-xs text-white/55">
                      ₹{Number(ad.min_order_inr).toLocaleString()} – ₹{Number(ad.max_order_inr).toLocaleString()}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1">
                        {(ad.payment_methods || []).slice(0, 2).map((p) => (
                          <span key={p.pm_id} className="px-2 py-0.5 rounded-full text-[10px] font-bold text-[#5BB8FF]"
                            style={{ background: 'rgba(14,164,171,0.1)', border: '1px solid rgba(14,164,171,0.2)' }}>
                            {p.type}
                          </span>
                        ))}
                        {(ad.payment_methods?.length || 0) > 2 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] text-white/35 border border-white/10 bg-white/5">+{ad.payment_methods.length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[ad.status] || 'border-white/15 bg-white/5 text-white/40'}`}>
                        {ad.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <ActionBtn title="Edit" onClick={() => openEdit(ad)}>
                          <Pencil size={12} />
                        </ActionBtn>
                        <ActionBtn title={ad.status === 'active' ? 'Pause' : 'Resume'} onClick={() => toggleAd(ad)} disabled={b(ad.ad_id)}>
                          {b(ad.ad_id) ? <Loader2 size={12} className="animate-spin" /> : ad.status === 'active' ? <ToggleRight size={12} className="text-green-400" /> : <ToggleLeft size={12} />}
                        </ActionBtn>
                        <ActionBtn title="Remove" onClick={() => deleteAd(ad.ad_id)} disabled={b(`del_${ad.ad_id}`)} danger>
                          {b(`del_${ad.ad_id}`) ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </ActionBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Ad form modal ─────────────────────────────────────────── */}
      {showForm && (
        <P2PModal title={editing ? 'Edit Ad' : 'Post New Ad'} size="lg" onClose={() => setShowForm(false)}>
          <P2PModal.Body>
            <div className="grid grid-cols-2 gap-3">
              <FF label="Side" required>
                <select value={form.side} onChange={(e) => setForm((f) => ({ ...f, side: e.target.value }))} className={sel}>
                  <option value="sell">Sell (I have crypto)</option>
                  <option value="buy">Buy (I want crypto)</option>
                </select>
              </FF>
              <FF label="Asset" required>
                <select value={form.asset} onChange={(e) => setForm((f) => ({ ...f, asset: e.target.value }))} className={sel}>
                  {ASSETS.map((a) => <option key={a}>{a}</option>)}
                </select>
              </FF>
            </div>

            <FF label="Price Type">
              <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--ibo-border-solid)' }}>
                {[['fixed', 'Fixed Price'], ['floating', 'Float (market %)']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setForm((f) => ({ ...f, price_type: k }))}
                    className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                      form.price_type === k ? 'text-[#5BB8FF]' : 'text-white/40 hover:text-white/70'
                    }`}
                    style={{ background: form.price_type === k ? 'rgba(14,164,171,0.12)' : 'var(--ibo-elevated)' }}>
                    {l}
                  </button>
                ))}
              </div>
            </FF>

            {form.price_type === 'fixed' ? (
              <FF label="Price (₹ per unit)" required>
                <input type="number" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} placeholder="e.g. 92.50" className={inp} />
              </FF>
            ) : (
              <FF label="Market margin % (e.g. 1 = +1%, -0.5 = −0.5%)">
                <input type="number" step="0.01" value={form.margin_pct} onChange={(e) => setForm((f) => ({ ...f, margin_pct: e.target.value }))} placeholder="0" className={inp} />
              </FF>
            )}

            <div className="grid grid-cols-3 gap-3">
              <FF label="Total Qty" required>
                <input type="number" min="0" value={form.total_amount} onChange={(e) => setForm((f) => ({ ...f, total_amount: e.target.value }))} placeholder="0.0" className={inp} />
              </FF>
              <FF label="Min Order (₹)" required>
                <input type="number" min="0" value={form.min_order_inr} onChange={(e) => setForm((f) => ({ ...f, min_order_inr: e.target.value }))} placeholder="100" className={inp} />
              </FF>
              <FF label="Max Order (₹)" required>
                <input type="number" min="0" value={form.max_order_inr} onChange={(e) => setForm((f) => ({ ...f, max_order_inr: e.target.value }))} placeholder="10000" className={inp} />
              </FF>
            </div>

            <FF label="Payment Window">
              <select value={form.payment_window_min} onChange={(e) => setForm((f) => ({ ...f, payment_window_min: e.target.value }))} className={sel}>
                {[10, 15, 20, 30, 45, 60].map((v) => <option key={v} value={v}>{v} minutes</option>)}
              </select>
            </FF>

            <FF label="Payment Methods" required>
              {myPms.length === 0 ? (
                <div className="flex items-start gap-2.5 rounded-xl p-3.5"
                  style={{ background: 'rgba(197,227,91,0.07)', border: '1px solid rgba(197,227,91,0.2)' }}>
                  <Info size={13} className="text-gold shrink-0 mt-0.5" />
                  <span className="text-sm text-white/65">Add methods in <Link to="/p2p/payment-methods" className="text-[#5BB8FF] font-semibold hover:underline">Payment Methods</Link> first.</span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {myPms.map((p) => {
                    const on = form.selected_pms.includes(p.pm_id);
                    return (
                      <button key={p.pm_id} type="button"
                        onClick={() => setForm((f) => ({
                          ...f,
                          selected_pms: on ? f.selected_pms.filter((id) => id !== p.pm_id) : [...f.selected_pms, p.pm_id],
                        }))}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                        style={on
                          ? { background: 'rgba(14,164,171,0.15)', border: '1px solid rgba(14,164,171,0.4)', color: '#5BB8FF' }
                          : { background: 'var(--ibo-elevated)', border: '1px solid var(--ibo-border-solid)', color: 'var(--ibo-muted)' }}>
                        {p.display_name} · {p.type}
                      </button>
                    );
                  })}
                </div>
              )}
            </FF>

            <FF label="Terms (optional)">
              <textarea rows={2} value={form.terms} onChange={(e) => setForm((f) => ({ ...f, terms: e.target.value }))}
                placeholder="Notes for counterparty…"
                className={`${inp} resize-none`} />
            </FF>

            {formError && (
              <div className="flex items-start gap-2.5 rounded-xl p-3.5 text-red-400 text-sm"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <AlertCircle size={13} className="shrink-0 mt-0.5" />{formError}
              </div>
            )}
          </P2PModal.Body>
          <P2PModal.Footer>
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white/50 hover:text-white transition-colors"
              style={{ border: '1px solid var(--ibo-border-solid)' }}>
              Cancel
            </button>
            <button type="button" onClick={submitAd} disabled={b('submit')}
              className="ibo-hover-scale inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-[#050a1a] disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#0EA4AB,#5BB8FF)' }}>
              {b('submit') && <Loader2 size={13} className="animate-spin" />}
              {editing ? 'Save Changes' : 'Post Ad'}
            </button>
          </P2PModal.Footer>
        </P2PModal>
      )}
    </div>
  );
}

function ActionBtn({ children, danger, ...props }) {
  return (
    <button
      className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${danger ? 'text-red-400/50 hover:text-red-400 hover:bg-red-500/10' : 'text-white/40 hover:text-white hover:bg-white/[.06]'}`}
      style={{ border: `1px solid ${danger ? 'rgba(239,68,68,0.2)' : 'var(--ibo-border-solid)'}` }}
      {...props}>
      {children}
    </button>
  );
}
