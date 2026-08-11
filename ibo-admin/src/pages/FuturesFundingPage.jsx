import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Play, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import ConfirmModal from '@/components/ConfirmModal';
import { AdminDataTable } from '@/components/AdminPrimitives';

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
      <div>
        <div className="px-4 py-3 text-sm font-bold text-white">Recent rates</div>
        <AdminDataTable>
          <thead>
            <tr>
              <th>Settled at</th>
              <th>Symbol</th>
              <th className="text-right">Mark</th>
              <th className="text-right">Rate</th>
              <th className="text-right">Annualised</th>
            </tr>
          </thead>
          <tbody>
            {rates.length === 0 && <tr><td colSpan={5} className="text-center text-white/40">No rates yet.</td></tr>}
            {rates.map((r) => {
              const annual = (Number(r.rate) || 0) * (3 * 365);
              return (
                <tr key={r.id}>
                  <td className="text-[12px] text-white/55 font-mono">{(r.settled_at || '').slice(0, 19).replace('T', ' ')}</td>
                  <td className="font-bold">{r.symbol}</td>
                  <td className="text-right font-mono">${fmt(r.mark_price, 2)}</td>
                  <td className={`text-right font-mono ${Number(r.rate) >= 0 ? 'text-gold-light' : 'text-emerald-300'}`}>{fmtPct(r.rate)}</td>
                  <td className="text-right font-mono">{(annual * 100).toFixed(2)}%</td>
                </tr>
              );
            })}
          </tbody>
        </AdminDataTable>
      </div>

      {/* Payments */}
      <div>
        <div className="px-4 py-3 text-sm font-bold text-white">Recent payments</div>
        <AdminDataTable minWidth="800px">
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Symbol</th>
              <th className="text-right">Position qty</th>
              <th className="text-right">Rate</th>
              <th className="text-right">Mark</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && <tr><td colSpan={7} className="text-center text-white/40">No payments yet.</td></tr>}
            {payments.map((p) => {
              const amt = Number(p.amount || 0);
              return (
                <tr key={p.id}>
                  <td className="text-[12px] text-white/55 font-mono">{(p.settled_at || '').slice(0, 19).replace('T', ' ')}</td>
                  <td className="text-[12px] font-mono text-white/80">{p.uid}</td>
                  <td className="font-bold">{p.symbol}</td>
                  <td className={`text-right font-mono ${Number(p.qty) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{fmt(p.qty)}</td>
                  <td className="text-right font-mono">{fmtPct(p.rate)}</td>
                  <td className="text-right font-mono">${fmt(p.mark_price, 2)}</td>
                  <td className={`text-right font-mono ${amt >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {amt >= 0 ? '+' : ''}{fmt(amt, 4)} USDT
                  </td>
                </tr>
              );
            })}
          </tbody>
        </AdminDataTable>
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
