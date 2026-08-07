import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, RotateCcw, Trash2, Clock3, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import { AdminPageHeader, AdminPanel, GradientStatCard } from '@/components/AdminPrimitives';

const STATUS_FILTERS = ['all', 'pending', 'processing', 'retry_scheduled', 'resolved', 'dead_letter'];

function fmtTs(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

export default function LiquidityOpsPage() {
  const { admin } = useAdminAuth();
  const canExecute = hasPermission(admin, 'execute_hedger');
  const canViewUsers = hasPermission(admin, 'view_users');
  const canViewOrders = hasPermission(admin, 'view_orders');
  const canViewTrades = hasPermission(admin, 'view_trades');
  const canViewHedger = hasPermission(admin, 'view_hedger');
  const [status, setStatus] = useState('all');
  const [queue, setQueue] = useState([]);
  const [deadLetters, setDeadLetters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState(null);
  const [detailKey, setDetailKey] = useState('');
  const [health, setHealth] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [qRes, dRes] = await Promise.all([
        api.liquidityRetryQueue(status === 'all' ? {} : { status }),
        api.liquidityDeadLetters({ limit: 200 }),
      ]);
      const hRes = await api.liquidityHealth();
      const [qBody, dBody, hBody] = await Promise.all([qRes.json(), dRes.json(), hRes.json()]);
      if (!qRes.ok) throw new Error(qBody?.detail || 'Failed to load retry queue');
      if (!dRes.ok) throw new Error(dBody?.detail || 'Failed to load dead letters');
      if (!hRes.ok) throw new Error(hBody?.detail || 'Failed to load liquidity health');
      setQueue(Array.isArray(qBody.items) ? qBody.items : []);
      setDeadLetters(Array.isArray(dBody.items) ? dBody.items : []);
      setHealth(hBody || null);
    } catch (e) {
      setError(e?.message || 'Failed to load liquidity operations');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const s = { pending: 0, processing: 0, retry: 0, dead: deadLetters.length };
    for (const item of queue) {
      const st = String(item.status || '');
      if (st === 'pending') s.pending += 1;
      else if (st === 'processing') s.processing += 1;
      else if (st === 'retry_scheduled') s.retry += 1;
    }
    return s;
  }, [queue, deadLetters]);

  async function retryQueueItem(id) {
    if (!id) return;
    setBusyId(id);
    setError('');
    try {
      const res = await api.retryLiquidityQueueItem(id);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Retry failed');
      await load();
    } catch (e) {
      setError(e?.message || 'Retry failed');
    } finally {
      setBusyId('');
    }
  }

  async function retryDeadLetter(id) {
    if (!id) return;
    setBusyId(id);
    setError('');
    try {
      const res = await api.retryLiquidityDeadLetter(id);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Dead-letter retry failed');
      await load();
    } catch (e) {
      setError(e?.message || 'Dead-letter retry failed');
    } finally {
      setBusyId('');
    }
  }

  async function openDetail(executionKey) {
    if (!executionKey) return;
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailData(null);
    setDetailKey(executionKey);
    try {
      const res = await api.liquidityExecutionDetail(executionKey);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Failed to load execution detail');
      setDetailData(body);
    } catch (e) {
      setError(e?.message || 'Failed to load execution detail');
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon={Clock3}
        title="Liquidity Operations"
        subtitle="Monitor Binance liquidity retry queue, dead letters, and trigger manual recovery."
        actions={(
          <button type="button" onClick={load} className="admin-btn-secondary inline-flex items-center gap-2" disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <GradientStatCard label="Pending" value={stats.pending} tone="amber" />
        <GradientStatCard label="Processing" value={stats.processing} tone="cyan" />
        <GradientStatCard label="Retry Scheduled" value={stats.retry} tone="violet" />
        <GradientStatCard label="Dead Letters" value={stats.dead} tone="rose" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="admin-section p-3">
          <p className="text-[11px] uppercase text-white/50">Circuit Breaker</p>
          <p className={`text-sm font-bold ${health?.circuit_breaker?.open ? 'text-rose-300' : 'text-emerald-300'}`}>
            {health?.circuit_breaker?.open ? 'OPEN' : 'CLOSED'}
          </p>
          <p className="text-xs text-white/60 mt-1">Failures: {health?.metrics?.consecutive_failures ?? 0}</p>
        </div>
        <div className="admin-section p-3">
          <p className="text-[11px] uppercase text-white/50">Latency P95</p>
          <p className="text-sm font-bold text-white">{health?.metrics?.latency_p95_ms ?? '—'} ms</p>
          <p className="text-xs text-white/60 mt-1">Threshold: {health?.thresholds?.latency_ms ?? '—'} ms</p>
        </div>
        <div className="admin-section p-3">
          <p className="text-[11px] uppercase text-white/50">Last Error</p>
          <p className="text-xs text-rose-300 break-all">{health?.metrics?.last_error || 'None'}</p>
        </div>
      </div>

      {error ? <div className="admin-section p-3 text-rose-300">{error}</div> : null}

      <AdminPanel
        title="Retry Queue"
        subtitle="Items are auto-processed by the retry worker; use manual retry for urgent recovery."
        right={(
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatus(f)}
                className={`admin-tab-btn ${status === f ? 'active' : ''}`}
              >
                {f.replace('_', ' ')}
              </button>
            ))}
          </div>
        )}
      >
        <div className="overflow-x-auto rounded-xl border border-surface-border">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-[11px] uppercase">
              <tr>
                <th className="text-left px-3 py-2">Queue ID</th>
                <th className="text-left px-3 py-2">Execution Key</th>
                <th className="text-left px-3 py-2">Symbol</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Attempt</th>
                <th className="text-left px-3 py-2">Next Retry</th>
                <th className="text-left px-3 py-2">Last Error</th>
                <th className="text-left px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && !queue.length ? (
                <tr><td className="px-3 py-4 text-center text-white/55" colSpan={8}>No queue items.</td></tr>
              ) : null}
              {queue.map((q) => (
                <tr key={q.id} className="border-t border-white/5">
                  <td className="px-3 py-2 font-mono text-xs text-cyan-200">{q.id}</td>
                  <td className="px-3 py-2 font-mono text-xs text-white/75">{q.execution_key}</td>
                  <td className="px-3 py-2 text-white">{q.symbol || '—'}</td>
                  <td className="px-3 py-2"><span className="admin-pill border-white/15 bg-white/10 text-white/85">{q.status}</span></td>
                  <td className="px-3 py-2 text-right font-mono">{q.attempt ?? 0} / {q.max_attempts ?? 0}</td>
                  <td className="px-3 py-2 text-white/70">{fmtTs(q.next_retry_at)}</td>
                  <td className="px-3 py-2 text-rose-300 text-xs">{q.last_error || '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openDetail(q.execution_key)}
                        className="admin-btn-secondary inline-flex items-center gap-1"
                      >
                        <Info size={12} /> Details
                      </button>
                      <button
                        type="button"
                        onClick={() => retryQueueItem(q.id)}
                        disabled={!canExecute || busyId === q.id}
                        className="admin-btn-secondary inline-flex items-center gap-1 disabled:opacity-40"
                      >
                        <RotateCcw size={12} /> Retry now
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminPanel>

      <AdminPanel title="Dead Letters" subtitle="Exhausted retry items. Use retry to requeue for processing.">
        <div className="overflow-x-auto rounded-xl border border-surface-border">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-[11px] uppercase">
              <tr>
                <th className="text-left px-3 py-2">Dead ID</th>
                <th className="text-left px-3 py-2">Execution Key</th>
                <th className="text-left px-3 py-2">Reason</th>
                <th className="text-left px-3 py-2">Created</th>
                <th className="text-left px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && !deadLetters.length ? (
                <tr><td className="px-3 py-4 text-center text-white/55" colSpan={5}>No dead-letter items.</td></tr>
              ) : null}
              {deadLetters.map((d) => (
                <tr key={d.id} className="border-t border-white/5">
                  <td className="px-3 py-2 font-mono text-xs text-gold-light">{d.id}</td>
                  <td className="px-3 py-2 font-mono text-xs text-white/75">{d.execution_key}</td>
                  <td className="px-3 py-2 text-rose-300">{d.reason || '—'}</td>
                  <td className="px-3 py-2 text-white/70">{fmtTs(d.created_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openDetail(d.execution_key)}
                        className="admin-btn-secondary inline-flex items-center gap-1"
                      >
                        <Info size={12} /> Details
                      </button>
                      <button
                        type="button"
                        onClick={() => retryDeadLetter(d.id)}
                        disabled={!canExecute || busyId === d.id}
                        className="admin-btn-secondary inline-flex items-center gap-1 disabled:opacity-40"
                      >
                        <Trash2 size={12} /> Requeue
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminPanel>

      {detailOpen ? (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm p-4 flex items-start justify-center overflow-auto">
          <div className="w-full max-w-5xl rounded-2xl border border-surface-border bg-surface-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-extrabold">Execution Detail</h3>
              <button type="button" className="admin-btn-secondary" onClick={() => setDetailOpen(false)}>Close</button>
            </div>
            <p className="text-xs text-white/55 font-mono">{detailKey}</p>
            {detailLoading ? <p className="text-white/70">Loading…</p> : null}
            {!detailLoading && detailData ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Section title="Intent" data={detailData.intent} />
                <Section title="Latest Queue Item" data={detailData.queue_items?.[0]} />
                <Section title="Latest Dead Letter" data={detailData.dead_letters?.[0]} />
                <Section title="Latest Routing Log" data={detailData.routing_logs?.[0]} />
                <LinkedRecords
                  detailData={detailData}
                  canViewUsers={canViewUsers}
                  canViewOrders={canViewOrders}
                  canViewTrades={canViewTrades}
                  canViewHedger={canViewHedger}
                />
                <ListSection title="State Transitions" items={detailData.transitions || []} />
                <ListSection title="Queue History" items={detailData.queue_items || []} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-1.5">
      <span className="text-white/45 text-xs">{k}</span>
      <span className="text-white/85 text-xs font-mono text-right break-all">{String(v ?? '—')}</span>
    </div>
  );
}

function Section({ title, data }) {
  const rows = Object.entries(data || {});
  return (
    <div className="rounded-xl border border-surface-border bg-surface-dark p-3">
      <h4 className="text-sm font-bold text-white mb-2">{title}</h4>
      {!rows.length ? <p className="text-xs text-white/50">No data</p> : rows.slice(0, 20).map(([k, v]) => <KV key={k} k={k} v={typeof v === 'object' ? JSON.stringify(v) : v} />)}
    </div>
  );
}

function LinkedRecords({
  detailData,
  canViewUsers,
  canViewOrders,
  canViewTrades,
  canViewHedger,
}) {
  const links = useMemo(() => {
    const bucket = [
      detailData?.intent || {},
      detailData?.queue_items?.[0] || {},
      detailData?.dead_letters?.[0] || {},
      detailData?.routing_logs?.[0] || {},
      ...(Array.isArray(detailData?.routing_logs) ? detailData.routing_logs : []),
    ];

    const out = {
      uid: '',
      orderId: '',
      symbol: '',
      hedgeTradeIds: [],
      binanceOrderIds: [],
    };
    const hedgeIds = new Set();
    const binanceIds = new Set();

    for (const row of bucket) {
      const uid = row?.uid || row?.payload?.uid;
      const orderId = row?.order_id || row?.payload?.order_id;
      const symbol = row?.symbol || row?.payload?.symbol;
      const hedgeOne = row?.hedge_trade_id || row?.payload?.hedge_trade_id;
      const hedgeMany = row?.hedge_trade_ids || row?.payload?.hedge_trade_ids;
      const binanceOne = row?.binance_order_id || row?.payload?.binance_order_id;
      const binanceMany = row?.binance_order_ids || row?.payload?.binance_order_ids;
      if (!out.uid && uid) out.uid = String(uid);
      if (!out.orderId && orderId) out.orderId = String(orderId);
      if (!out.symbol && symbol) out.symbol = String(symbol);
      if (hedgeOne) hedgeIds.add(String(hedgeOne));
      if (Array.isArray(hedgeMany)) hedgeMany.forEach((id) => hedgeIds.add(String(id)));
      if (binanceOne) binanceIds.add(String(binanceOne));
      if (Array.isArray(binanceMany)) binanceMany.forEach((id) => binanceIds.add(String(id)));
    }
    out.hedgeTradeIds = Array.from(hedgeIds);
    out.binanceOrderIds = Array.from(binanceIds);
    return out;
  }, [detailData]);

  return (
    <div className="rounded-xl border border-surface-border bg-surface-dark p-3">
      <h4 className="text-sm font-bold text-white mb-2">Linked Records</h4>
      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-white/55">User</span>
          {links.uid ? (
            canViewUsers ? (
              <Link to={`/users/${encodeURIComponent(links.uid)}`} className="admin-btn-secondary text-[11px]">
                Open user {links.uid}
              </Link>
            ) : (
              <span className="font-mono text-white/75">{links.uid}</span>
            )
          ) : <span className="text-white/40">—</span>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-white/55">Order</span>
          {links.orderId ? (
            canViewOrders ? (
              <Link to={`/trading?tab=orders&search=${encodeURIComponent(links.orderId)}`} className="admin-btn-secondary text-[11px]">
                Find order {links.orderId}
              </Link>
            ) : (
              <span className="font-mono text-white/75">{links.orderId}</span>
            )
          ) : <span className="text-white/40">—</span>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-white/55">Symbol</span>
          {links.symbol ? (
            canViewTrades ? (
              <Link to={`/trading-activity?symbol=${encodeURIComponent(links.symbol)}`} className="admin-btn-secondary text-[11px]">
                View {links.symbol} activity
              </Link>
            ) : (
              <span className="font-mono text-white/75">{links.symbol}</span>
            )
          ) : <span className="text-white/40">—</span>}
        </div>
        <div className="pt-1 border-t border-white/5">
          <p className="text-white/55 mb-1">Hedge trades</p>
          {!links.hedgeTradeIds.length ? <p className="text-white/40">—</p> : (
            <div className="flex flex-wrap gap-1.5">
              {links.hedgeTradeIds.slice(0, 8).map((id) => (
                canViewHedger ? (
                  <Link key={id} to={`/hedger?trade_id=${encodeURIComponent(id)}`} className="admin-btn-secondary text-[11px]">
                    {id}
                  </Link>
                ) : (
                  <span key={id} className="admin-pill border-white/15 bg-white/10 text-white/85 font-mono">{id}</span>
                )
              ))}
            </div>
          )}
        </div>
        <div className="pt-1 border-t border-white/5">
          <p className="text-white/55 mb-1">Binance orders</p>
          {!links.binanceOrderIds.length ? <p className="text-white/40">—</p> : (
            <div className="flex flex-wrap gap-1.5">
              {links.binanceOrderIds.slice(0, 8).map((id) => (
                <span key={id} className="admin-pill border-white/15 bg-white/10 text-white/85 font-mono">{id}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ListSection({ title, items }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-dark p-3 lg:col-span-2">
      <h4 className="text-sm font-bold text-white mb-2">{title}</h4>
      {!items.length ? <p className="text-xs text-white/50">No rows</p> : (
        <div className="space-y-2 max-h-[260px] overflow-auto pr-1">
          {items.map((it, idx) => (
            <pre key={idx} className="text-[11px] leading-5 whitespace-pre-wrap bg-surface-dark rounded-lg border border-white/5 p-2 text-white/80">
              {JSON.stringify(it, null, 2)}
            </pre>
          ))}
        </div>
      )}
    </div>
  );
}
