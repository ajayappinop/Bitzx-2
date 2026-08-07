import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, Save } from 'lucide-react';

// Must mirror backend/futures/constants.py ALLOWED_LEVERAGE
const ALLOWED_LEVERAGE = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125];
import { api } from '@/lib/api';

const fmt = (v) => Number.isFinite(Number(v)) ? Number(v).toLocaleString() : '—';

function Row({ s, onSave, busy }) {
  const [draft, setDraft] = useState(() => ({
    tick_size: s.tick_size, lot_size: s.lot_size,
    min_qty: s.min_qty, max_qty: s.max_qty,
    max_leverage: s.max_leverage,
    listed: !!s.listed, trading_enabled: !!s.trading_enabled,
  }));

  useEffect(() => {
    setDraft({
      tick_size: s.tick_size, lot_size: s.lot_size,
      min_qty: s.min_qty, max_qty: s.max_qty,
      max_leverage: s.max_leverage,
      listed: !!s.listed, trading_enabled: !!s.trading_enabled,
    });
  }, [s]);

  const dirty = Object.keys(draft).some((k) => draft[k] !== s[k]);

  return (
    <tr className="border-b border-white/5 hover:bg-white/[.02]">
      <td className="px-3 py-2 font-bold text-white">{s.symbol}</td>
      <td className="px-3 py-2 text-[12px] text-white/55">{s.binance_symbol}</td>
      {[
        ['tick_size', 0.0001], ['lot_size', 0.0001],
        ['min_qty', 0.0001], ['max_qty', 1],
      ].map(([k, step]) => (
        <td key={k} className="px-2 py-2">
          <input type="number" step={step} value={draft[k] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value === '' ? null : Number(e.target.value) }))}
            className="w-24 bg-surface-dark border border-white/10 rounded px-2 py-1 text-sm font-mono text-white" />
        </td>
      ))}
      {/* max_leverage must be one of ALLOWED_LEVERAGE — use a dropdown to prevent invalid input */}
      <td className="px-2 py-2">
        <select value={draft.max_leverage ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, max_leverage: e.target.value === '' ? null : Number(e.target.value) }))}
          className="w-24 bg-surface-dark border border-white/10 rounded px-2 py-1 text-sm font-mono text-white">
          {ALLOWED_LEVERAGE.map((lv) => (
            <option key={lv} value={lv}>{lv}×</option>
          ))}
        </select>
      </td>
      {['listed', 'trading_enabled'].map((k) => (
        <td key={k} className="px-3 py-2 text-center">
          <input type="checkbox" checked={!!draft[k]}
            onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.checked }))} />
        </td>
      ))}
      <td className="px-3 py-2 text-right pr-4">
        <button disabled={!dirty || busy} onClick={() => onSave(s.symbol, draft)}
          className="px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-400/30 hover:bg-emerald-500/25 disabled:opacity-30 text-[12px] font-bold inline-flex items-center gap-1">
          <Save size={12} /> Save
        </button>
      </td>
    </tr>
  );
}

export default function FuturesSymbolsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedSym, setSavedSym] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.futures.listSymbols();
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'load failed');
      setRows(j.symbols || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSave = async (symbol, body) => {
    setBusy(true); setError(null);
    try {
      const res = await api.futures.patchSymbol(symbol, body);
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'save failed');
      setRows((rs) => rs.map((r) => r.symbol === symbol ? j : r));
      setSavedSym(symbol);
      setTimeout(() => setSavedSym(null), 1500);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-white/50">Listed perpetuals, tick/lot, leverage caps, and trading toggles.</p>
        <div className="flex items-center gap-3 text-[12px] text-white/40">
          {savedSym && <span className="text-emerald-300">{savedSym} saved</span>}
          <button onClick={load} className="text-white/60 hover:text-white">
            <RefreshCw size={16} className={loading || busy ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 text-rose-300 px-4 py-2 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-x-auto">
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="text-[11px] uppercase tracking-wider text-white/45">
            <tr className="border-b border-white/5">
              <th className="text-left px-3 py-2">Symbol</th>
              <th className="text-left px-3 py-2">Index</th>
              <th className="text-left px-2 py-2">Tick size</th>
              <th className="text-left px-2 py-2">Lot size</th>
              <th className="text-left px-2 py-2">Min qty</th>
              <th className="text-left px-2 py-2">Max qty</th>
              <th className="text-left px-2 py-2">Max lev</th>
              <th className="text-center px-3 py-2">Listed</th>
              <th className="text-center px-3 py-2">Trading</th>
              <th className="text-right px-3 py-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => <Row key={s.symbol} s={s} onSave={onSave} busy={busy} />)}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-white/40">
        Defaults come from <code>backend/futures/constants.py</code>. Overrides are stored in the
        <code className="mx-1">futures_symbol_config</code> Mongo collection and applied at runtime
        on every <code>POST /api/futures/orders</code>.
      </p>
    </div>
  );
}
