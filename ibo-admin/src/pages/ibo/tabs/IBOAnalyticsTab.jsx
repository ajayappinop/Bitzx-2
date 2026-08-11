import { useEffect, useState, useCallback } from 'react';
import { BarChart3, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { AdminDataTable } from '@/components/AdminPrimitives';

const WINDOWS = ['1h', '24h', '7d', '30d'];

const COIN_ICONS = {
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  BNB: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  SOL: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  XRP: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  DOGE:'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
};

function BarRow({ label, value, max, unit, icon }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-2">
      {icon && <img src={icon} alt={label} className="w-5 h-5 rounded-full flex-shrink-0" />}
      <span className="text-xs text-white/60 w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-white/8 rounded-full overflow-hidden">
        <div className="h-full bg-gold rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-white w-24 text-right font-mono">
        {Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} {unit}
      </span>
    </div>
  );
}

export default function IBOAnalyticsTab() {
  const [analytics, setAnalytics] = useState(null);
  const [logs, setLogs]           = useState([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage]   = useState(1);
  const [window, setWindow]       = useState('24h');
  const [loading, setLoading]     = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [err, setErr]             = useState(null);
  const [logsErr, setLogsErr]     = useState(null);
  const LOGS_LIMIT = 20;

  const loadAnalytics = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await api.ibo.getAnalytics({ window });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Failed');
      setAnalytics(d);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [window]);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsErr(null);
    try {
      const res = await api.ibo.getLogs({ page: logsPage, limit: LOGS_LIMIT });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Failed');
      setLogs(d.items || []);
      setLogsTotal(d.total || 0);
    } catch (e) {
      setLogs([]);
      setLogsTotal(0);
      setLogsErr(e.message || 'Could not load trade logs');
    } finally {
      setLogsLoading(false);
    }
  }, [logsPage]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);
  useEffect(() => { loadLogs(); }, [loadLogs]);

  const maxVol = analytics ? Math.max(...(analytics.pairs || []).map((p) => p.volume_ibo || 0), 1) : 1;
  const maxTrades = analytics ? Math.max(...(analytics.pairs || []).map((p) => p.trade_count || 0), 1) : 1;
  const logPages = Math.max(1, Math.ceil(logsTotal / LOGS_LIMIT));
  const fmtDate = (s) => s ? new Date(s).toLocaleString() : '—';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 p-1 rounded-lg bg-white/5 border border-white/8">
          {WINDOWS.map((w) => (
            <button key={w} onClick={() => setWindow(w)}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${window === w ? 'bg-gold/20 text-gold-light' : 'text-white/40 hover:text-white'}`}>
              {w}
            </button>
          ))}
        </div>
        <button onClick={loadAnalytics} className="flex items-center gap-1 text-xs text-white/40 hover:text-gold-light transition-colors">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {err && <div className="text-red-400 text-sm py-4 text-center">{err}</div>}

      {analytics && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Total Volume', value: `${Number(analytics.totals?.volume_ibo || 0).toLocaleString(undefined, {maximumFractionDigits:2})} Delta` },
            { label: 'Total Trades', value: Number(analytics.totals?.trade_count || 0).toLocaleString() },
            { label: 'Fee Revenue',  value: `${Number(analytics.totals?.fee_revenue || 0).toFixed(6)} Delta` },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-white/8 bg-white/2 p-4">
              <div className="text-xs text-white/40 uppercase tracking-wider mb-1">{c.label}</div>
              <div className="text-xl font-bold text-gold-light">{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {analytics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-white/8 bg-white/2 p-4">
            <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3 flex items-center gap-2"><BarChart3 size={12}/> Volume by Pair (Delta)</h3>
            {(analytics.pairs || []).map((p) => {
              const base = p.symbol?.replace('IBO', '') || p.base;
              return <BarRow key={p.symbol} label={`${base}/Delta`} value={p.volume_ibo} max={maxVol} unit="Delta" icon={COIN_ICONS[base]} />;
            })}
          </div>
          <div className="rounded-xl border border-white/8 bg-white/2 p-4">
            <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3 flex items-center gap-2"><BarChart3 size={12}/> Trade Count by Pair</h3>
            {(analytics.pairs || []).map((p) => {
              const base = p.symbol?.replace('IBO', '') || p.base;
              return <BarRow key={p.symbol} label={`${base}/Delta`} value={p.trade_count} max={maxTrades} unit="" icon={COIN_ICONS[base]} />;
            })}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider">Recent Delta Pair Trades</h3>
          <button onClick={loadLogs} className="flex items-center gap-1 text-xs text-white/40 hover:text-gold-light transition-colors">
            <RefreshCw size={12} /> Refresh logs
          </button>
        </div>
        {logsErr && <div className="text-red-400 text-sm py-2 mb-2">{logsErr}</div>}
        <AdminDataTable>
          <thead>
            <tr>
              {['Symbol','Side','Price','Amount','Fee','Date'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
              {logsLoading ? (
                <tr><td colSpan={6} className="text-white/30 text-sm text-center !py-6">Loading…</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="text-white/30 text-sm text-center !py-6">No trades yet</td></tr>
              ) : logs.map((t, i) => (
                <tr key={t.id || i}>
                  <td className="font-mono text-xs text-gold-light">{t.symbol}</td>
                  <td>
                    <span className={`text-xs font-semibold ${t.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>{t.side?.toUpperCase()}</span>
                  </td>
                  <td className="font-mono text-xs text-white">{Number(t.price || 0).toFixed(6)}</td>
                  <td className="font-mono text-xs text-white">{Number(t.amount || 0).toFixed(4)}</td>
                  <td className="font-mono text-xs text-white/40">{Number(t.fee_amount || 0).toFixed(6)}</td>
                  <td className="text-xs text-white/30">{fmtDate(t.created_at)}</td>
                </tr>
              ))}
          </tbody>
        </AdminDataTable>
        {logPages > 1 && (
          <div className="flex items-center gap-2 justify-end text-xs text-white/50 mt-2">
            <button onClick={() => setLogsPage((p) => Math.max(1, p - 1))} disabled={logsPage === 1} className="p-1 hover:text-white disabled:opacity-30"><ChevronLeft size={14}/></button>
            <span>Page {logsPage} of {logPages}</span>
            <button onClick={() => setLogsPage((p) => Math.min(logPages, p + 1))} disabled={logsPage === logPages} className="p-1 hover:text-white disabled:opacity-30"><ChevronRight size={14}/></button>
          </div>
        )}
      </div>
    </div>
  );
}
