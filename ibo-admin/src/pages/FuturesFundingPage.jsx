import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Play, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import ConfirmModal from '@/components/ConfirmModal';

const fmtPct = (n) => Number.isFinite(Number(n)) ? `${(Number(n) * 100).toFixed(4)}%` : '—';
const fmt = (v, dp = 4) => Number.isFinite(Number(v)) ? Number(v).toLocaleString(undefined, { maximumFractionDigits: dp }) : '—';

export default function FuturesFundingPage() {
  const [rates, setRates] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [symbols, setSymbols] = useState([]);
  const [symbolFilter, setSymbolFilter] = useState('');
  const [confirmSettle, setConfirmSettle] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [rRes, pRes, sRes] = await Promise.all([
        api.futures.listFundingRates({ symbol: symbolFilter, limit: 50 }),
        api.futures.listFundingPayments({ symbol: symbolFilter, limit: 100 }),
        api.futures.listSymbols(),
      ]);
      const r = await rRes.json(); const p = await pRes.json(); const s = await sRes.json();
      if (!rRes.ok) throw new Error(r.detail || 'rates load failed');
      if (!pRes.ok) throw new Error(p.detail || 'payments load failed');
      setRates(r.rates || []);
      setPayments(p.payments || []);
      setSymbols(s.symbols || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [symbolFilter]);

  useEffect(() => { load(); }, [load]);

  const settle = async (sym) => {
    setError(null);
    try {
      const res = await api.futures.settleFunding(sym);
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'settle failed');
      load();
    } catch (e) { setError(e.message); }
    setConfirmSettle(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <select value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)}
            className="bg-surface-card border border-surface-border rounded-lg px-3 py-1.5 text-sm">
            <option value="">All symbols</option>
            {symbols.map((s) => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}
          </select>
          <button onClick={load} className="text-white/60 hover:text-white">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 text-rose-300 px-4 py-2 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Manual settlement */}
      <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
        <div className="text-sm font-bold text-white mb-2">Manual settlement</div>
        <p className="text-[12px] text-white/50 mb-3">
          Trigger a funding settlement now (in addition to the scheduled 8h cycle). Uses the current cached mark price.
        </p>
        <div className="flex flex-wrap gap-2">
          {symbols.map((s) => (
            <button key={s.symbol} onClick={() => setConfirmSettle(s.symbol)}
              className="px-3 py-1.5 rounded-lg bg-gold-light/10 hover:bg-gold-light/20 text-gold-light border border-gold-light/30 text-sm font-bold flex items-center gap-1.5">
              <Play size={12} /> Settle {s.symbol}
            </button>
          ))}
        </div>
      </div>

      {/* Rates */}
      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 text-sm font-bold text-white">Recent rates</div>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-white/45">
            <tr className="border-b border-white/5">
              <th className="text-left px-3 py-2">Settled at</th>
              <th className="text-left px-3 py-2">Symbol</th>
              <th className="text-right px-3 py-2">Mark</th>
              <th className="text-right px-3 py-2">Rate</th>
              <th className="text-right px-3 py-2">Annualised</th>
            </tr>
          </thead>
          <tbody>
            {rates.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-white/40">No rates yet.</td></tr>}
            {rates.map((r) => {
              const annual = (Number(r.rate) || 0) * (3 * 365);
              return (
                <tr key={r.id} className="border-b border-white/5">
                  <td className="px-3 py-2 text-[12px] text-white/55 font-mono">{(r.settled_at || '').slice(0, 19).replace('T', ' ')}</td>
                  <td className="px-3 py-2 font-bold">{r.symbol}</td>
                  <td className="px-3 py-2 text-right font-mono">${fmt(r.mark_price, 2)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${Number(r.rate) >= 0 ? 'text-gold-light' : 'text-emerald-300'}`}>{fmtPct(r.rate)}</td>
                  <td className="px-3 py-2 text-right font-mono">{(annual * 100).toFixed(2)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Payments */}
      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 text-sm font-bold text-white">Recent payments</div>
        <table className="w-full text-sm min-w-[800px]">
          <thead className="text-[11px] uppercase tracking-wider text-white/45">
            <tr className="border-b border-white/5">
              <th className="text-left  px-3 py-2">Time</th>
              <th className="text-left  px-3 py-2">User</th>
              <th className="text-left  px-3 py-2">Symbol</th>
              <th className="text-right px-3 py-2">Position qty</th>
              <th className="text-right px-3 py-2">Rate</th>
              <th className="text-right px-3 py-2">Mark</th>
              <th className="text-right px-3 py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-white/40">No payments yet.</td></tr>}
            {payments.map((p) => {
              const amt = Number(p.amount || 0);
              return (
                <tr key={p.id} className="border-b border-white/5">
                  <td className="px-3 py-2 text-[12px] text-white/55 font-mono">{(p.settled_at || '').slice(0, 19).replace('T', ' ')}</td>
                  <td className="px-3 py-2 text-[12px] font-mono text-white/80">{p.uid}</td>
                  <td className="px-3 py-2 font-bold">{p.symbol}</td>
                  <td className={`px-3 py-2 text-right font-mono ${Number(p.qty) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{fmt(p.qty)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtPct(p.rate)}</td>
                  <td className="px-3 py-2 text-right font-mono">${fmt(p.mark_price, 2)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${amt >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {amt >= 0 ? '+' : ''}{fmt(amt, 4)} USDT
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        open={!!confirmSettle}
        title={`Settle funding for ${confirmSettle}?`}
        message="This forces an out-of-cycle funding settlement on every open position for this symbol. The next scheduled cycle still runs as normal."
        confirmText="Settle now"
        onConfirm={() => settle(confirmSettle)}
        onClose={() => setConfirmSettle(null)}
      />
    </div>
  );
}
