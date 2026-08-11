import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AdminPanel, GradientStatCard, AdminDataTable } from '@/components/AdminPrimitives';
import { RefreshCw, Activity, Zap, Radio } from 'lucide-react';

const CHAIN_LABELS = {
  btc: 'Bitcoin',
  eth: 'Ethereum',
  bsc: 'BNB Chain',
  tron: 'Tron',
  solana: 'Solana',
  unknown: 'Unknown host',
};

function fmt(n, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function RpcUsagePanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const res = await api.rpcUsage(2);
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Failed to load RPC usage');
      setData(json);
    } catch (e) {
      setErr(e.message || 'Load failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const cur = data?.current_hour;
  const rates = data?.rates_current_hour || {};

  return (
    <AdminPanel
      title="QuickNode RPC usage"
      subtitle="In-process counters since last API restart. No extra QuickNode calls to load this panel."
      className="mb-6"
      right={(
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-surface-border text-sm font-bold"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      )}
    >
      {err ? (
        <p className="text-rose-300 text-sm mb-4">{err}</p>
      ) : null}

      {loading && !data ? (
        <p className="text-white/50 text-sm">Loading usage…</p>
      ) : null}

      {data ? (
        <>
          <p className="text-xs text-white/45 mb-4 font-mono">
            UTC hour: {data.current_hour_iso || '—'} · retained {data.hours_retained}h
          </p>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <GradientStatCard
              label="RPC calls (this hour)"
              value={fmt(cur?.rpc_calls_total, 0)}
              hint={`~${fmt(rates.rpc_per_minute)}/min · ${fmt(rates.rpc_per_second, 2)}/s`}
              tone="cyan"
            />
            <GradientStatCard
              label="Credits est. (this hour)"
              value={fmt(cur?.credits_est_total, 0)}
              hint={`~${fmt(rates.credits_est_per_minute)}/min · ${fmt(rates.credits_est_per_second, 1)}/s`}
              tone="amber"
            />
            <GradientStatCard
              label="WS newHeads"
              value={fmt(cur?.ws_heads_total, 0)}
              hint="ETH + BSC block notifications"
              tone="violet"
            />
            <GradientStatCard
              label="Deposit poller"
              value={fmt(cur?.poller_ticks, 0)}
              hint={`${fmt(cur?.poller_idle_ticks, 0)} idle (no addresses)`}
              tone="emerald"
            />
          </div>

          <div className="mb-4">
            <div className="px-4 py-2.5 flex items-center gap-2">
              <Activity size={16} className="text-cyan-300" />
              <span className="text-sm font-bold text-white">By chain (current hour)</span>
            </div>
            <AdminDataTable minWidth="520px">
                <thead>
                  <tr>
                    <th>Chain</th>
                    <th className="text-right">HTTP RPC</th>
                    <th className="text-right">WS heads</th>
                    <th className="text-right">Credits est.</th>
                    <th>Top methods</th>
                  </tr>
                </thead>
                <tbody>
                  {['eth', 'bsc', 'btc', 'tron', 'solana', 'unknown'].map((cid) => {
                    const ch = cur?.chains?.[cid];
                    const ws = cur?.ws_heads?.[cid] || 0;
                    if (!ch && !ws) return null;
                    const methods = ch?.methods
                      ? Object.entries(ch.methods)
                          .slice(0, 4)
                          .map(([m, c]) => `${m}×${c}`)
                          .join(', ')
                      : '—';
                    return (
                      <tr key={cid}>
                        <td className="font-semibold">{CHAIN_LABELS[cid] || cid}</td>
                        <td className="text-right font-mono">{fmt(ch?.rpc_calls, 0)}</td>
                        <td className="text-right font-mono">{fmt(ws, 0)}</td>
                        <td className="text-right font-mono text-gold-light/90">{fmt(ch?.credits_est, 0)}</td>
                        <td className="text-xs font-mono text-white/55 max-w-[280px] truncate" title={methods}>
                          {methods}
                        </td>
                      </tr>
                    );
                  })}
                  {!cur?.chains || Object.keys(cur.chains).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center text-white/45 text-sm py-6">
                        No HTTP RPC recorded this hour yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
            </AdminDataTable>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-white/50">
            <span className="inline-flex items-center gap-1">
              <Zap size={12} className="text-gold-light" />
              Throttle: concurrency {data.throttle?.rpc_max_concurrency} · gap {data.throttle?.rpc_min_interval_ms}ms
            </span>
            <span className="inline-flex items-center gap-1">
              <Radio size={12} />
              Auto-refresh 30s
            </span>
          </div>

          {data.notes?.length ? (
            <ul className="mt-3 text-xs text-white/45 space-y-1 list-disc pl-5">
              {data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </AdminPanel>
  );
}
