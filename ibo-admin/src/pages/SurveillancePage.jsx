import { useCallback, useEffect, useState } from 'react';
import { Radar, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

export default function SurveillancePage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [threshold, setThreshold] = useState('100000');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [runningAlerts, setRunningAlerts] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await api.tradesSurveillance({
        date_from: dateFrom ? `${dateFrom}T00:00:00` : undefined,
        date_to: dateTo ? `${dateTo}T23:59:59` : undefined,
        large_notional_usdt: threshold,
        limit: '200',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || 'Failed to load surveillance data');
      setData(body);
    } catch (e) {
      setErr(e.message || 'Failed to load surveillance data');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, threshold]);

  async function runWithAlerts() {
    setRunningAlerts(true);
    setErr('');
    setOk('');
    try {
      const res = await api.tradesSurveillance({
        date_from: dateFrom ? `${dateFrom}T00:00:00` : undefined,
        date_to: dateTo ? `${dateTo}T23:59:59` : undefined,
        large_notional_usdt: threshold,
        emit_alerts: 'true',
        limit: '200',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || 'Surveillance run failed');
      setData(body);
      setOk(`Surveillance completed. Large trades: ${body?.counts?.large || 0}, self trades: ${body?.counts?.self || 0}.`);
    } catch (e) {
      setErr(e.message || 'Surveillance run failed');
    } finally {
      setRunningAlerts(false);
    }
  }

  useEffect(() => { load(); }, [load]);

  const large = data?.large_trades || [];
  const selfTrades = data?.self_trades || [];

  return (
    <div className="admin-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="admin-title mb-2 flex items-center gap-2">
            <Radar className="text-cyan-300" size={26} /> Risk & Alerts
          </h1>
          <p className="admin-page-lead">Detect unusual trading behavior, self-match patterns, and notional spikes for escalation.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={runWithAlerts} disabled={runningAlerts} className="inline-flex items-center gap-2 rounded-xl border border-rose-500/30 px-3 py-2 text-rose-200 text-sm font-bold disabled:opacity-40">
            {runningAlerts ? 'Running…' : 'Run surveillance'}
          </button>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-surface-border px-3 py-2 text-white/80 text-sm font-bold disabled:opacity-40">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-sm text-white" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-sm text-white" />
        <input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Large trade threshold (USDT)" className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-sm text-white font-mono" />
      </div>

      {err ? <p className="text-red-400 text-sm">{err}</p> : null}
      {ok ? <p className="text-emerald-300 text-sm">{ok}</p> : null}

      <div className="grid sm:grid-cols-2 gap-3">
        <Stat title="Large notional trades" value={data?.counts?.large ?? 0} tone="yellow" />
        <Stat title="Potential self-match trades" value={data?.counts?.self ?? 0} tone="rose" />
      </div>

      <LogTable title="Large notional trades" rows={large} />
      <LogTable title="Potential self-match trades" rows={selfTrades} />
    </div>
  );
}

function Stat({ title, value, tone = 'blue' }) {
  const tones = {
    blue: 'bg-gradient-to-br from-[#3B82F6]/18 to-transparent border-[#3B82F6]/28',
    yellow: 'bg-gradient-to-br from-[#0EA4AB]/18 to-transparent border-[#0EA4AB]/28',
    rose: 'bg-gradient-to-br from-[#F6465D]/18 to-transparent border-[#F6465D]/28',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone] || tones.blue}`}>
      <p className="text-sm font-semibold text-white/80">{title}</p>
      <p className="text-2xl font-extrabold text-white mt-1">{value}</p>
    </div>
  );
}

function LogTable({ title, rows }) {
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-border text-xs font-bold text-white/55 uppercase">{title}</div>
      <div className="adm-table-x">
        <table className="w-full text-sm min-w-[850px]">
          <thead>
            <tr className="text-left text-[11px] text-white/45 border-b border-surface-border">
              <th className="px-4 py-3">Time</th><th className="px-4 py-3">Trade</th><th className="px-4 py-3">Symbol</th><th className="px-4 py-3">Taker</th><th className="px-4 py-3">Maker</th><th className="px-4 py-3 text-right">Notional</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-white/45">No rows.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-b border-surface-border/50">
                <td className="px-4 py-3 text-xs text-white/60">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                <td className="px-4 py-3 text-xs font-mono text-gold-light/90">{r.id}</td>
                <td className="px-4 py-3 text-xs font-mono">{r.symbol}</td>
                <td className="px-4 py-3 text-xs font-mono">{r.taker_uid}</td>
                <td className="px-4 py-3 text-xs font-mono">{r.maker_uid}</td>
                <td className="px-4 py-3 text-right text-xs font-mono">{(Number(r.price || 0) * Number(r.amount || 0)).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
