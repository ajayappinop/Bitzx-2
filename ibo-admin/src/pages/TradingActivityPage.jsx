import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import { getStoredToken, adminWebSocketUrl } from '@/lib/api';
import UserUidSuggestInput from '@/components/UserUidSuggestInput';
import CoinAvatar from '@/components/CoinAvatar';
import { useListSort } from '@/lib/useListSort';
import SortableTh from '@/components/SortableTh';
import { AdminDataTable } from '@/components/AdminPrimitives';

function toInputDate(d) {
  return d.toISOString().slice(0, 10);
}

function getWindowDateRange(windowValue) {
  const now = new Date();
  if (windowValue === '24h') {
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { from: toInputDate(from), to: toInputDate(now) };
  }
  if (windowValue === '7d') {
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from: toInputDate(from), to: toInputDate(now) };
  }
  return null;
}

export default function TradingActivityPage({ embedded = false }) {
  const [searchParams] = useSearchParams();
  const [symbol, setSymbol] = useState('');
  const [uid, setUid] = useState(searchParams.get('uid') || '');
  const [liquidity, setLiquidity] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [notionalTotal, setNotionalTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(40);
  const [loading, setLoading] = useState(true);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const wsRef = useRef(null);
  const { sortBy, sortDir, sortParams, toggleSort: _toggleSort } = useListSort('created_at', 'desc');
  const toggleSort = useCallback((key) => {
    setSkip(0);
    _toggleSort(key);
  }, [_toggleSort]);

  useEffect(() => {
    const windowValue = (searchParams.get('window') || '').toLowerCase();
    const range = getWindowDateRange(windowValue);
    if (!range) return;
    setSkip(0);
    setDateFrom(range.from);
    setDateTo(range.to);
  }, [searchParams]);

  useEffect(() => {
    setLoading(true);
    const token = getStoredToken();
    if (!token) {
      setItems([]);
      setTotal(0);
      setNotionalTotal(0);
      setLoading(false);
      return;
    }
    const qs = new URLSearchParams({ skip: String(skip), limit: String(limit) });
    if (symbol.trim()) qs.set('symbol', symbol.trim().toUpperCase());
    if (uid.trim()) qs.set('uid', uid.trim());
    if (liquidity !== 'all') qs.set('liquidity_source', liquidity);
    if (dateFrom) qs.set('date_from', `${dateFrom}T00:00:00`);
    if (dateTo) qs.set('date_to', `${dateTo}T23:59:59`);
    qs.set('sort_by', sortParams.sort_by);
    qs.set('sort_dir', sortParams.sort_dir);
    const url = adminWebSocketUrl(`/api/admin/ws/trades/recent?${qs.toString()}`);
    let closed = false;
    let reconnectTimer = null;
    const connect = () => {
      if (closed) return;
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (data.type === 'error' && data.detail) {
              setItems([]);
              setTotal(0);
              setNotionalTotal(0);
              setLoading(false);
              return;
            }
            if (data.type === 'recent_trades') {
              setItems(data.items || []);
              setTotal(data.total ?? 0);
              setNotionalTotal(Number(data.stats?.notional_usdt_total || 0));
              setLoading(false);
            }
          } catch {
            /* ignore */
          }
        };
        ws.onerror = () => {
          setItems([]);
          setTotal(0);
          setNotionalTotal(0);
          setLoading(false);
        };
        ws.onclose = () => {
          wsRef.current = null;
          if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
        };
      } catch {
        setItems([]);
        setTotal(0);
        setNotionalTotal(0);
        setLoading(false);
        if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
      }
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          /* ignore */
        }
        wsRef.current = null;
      }
    };
  }, [symbol, uid, liquidity, dateFrom, dateTo, skip, limit, sortParams]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(skip / limit) + 1;

  return (
    <div className="admin-page">
      {!embedded ? (
        <>
          <h1 className="admin-title mb-2 flex flex-wrap items-center gap-2">
            <Activity className="text-cyan-400 shrink-0" size={28} />
            Liquidity Activity
          </h1>
          <p className="admin-page-lead mb-6">Live feed of completed trades with liquidity source visibility (user vs user and SYSTEM treasury).</p>
        </>
      ) : null}

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          value={symbol}
          onChange={e => { setSkip(0); setSymbol(e.target.value); }}
          placeholder="Symbol (e.g. BTCUSDT)"
          className="flex-1 rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white placeholder:text-white/35 font-mono text-sm uppercase"
        />
        <UserUidSuggestInput
          value={uid}
          onChange={(v) => { setSkip(0); setUid(v); }}
          placeholder="User UID filter"
          containerClassName="flex-1"
          className="w-full rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white placeholder:text-white/35 font-mono text-sm"
        />
        <select
          value={liquidity}
          onChange={e => { setSkip(0); setLiquidity(e.target.value); }}
          className="rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white text-sm"
        >
          <option value="all">All liquidity</option>
          <option value="user">User vs user</option>
          <option value="system">SYSTEM liquidity</option>
          <option value="binance">Binance liquidity</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={e => { setSkip(0); setDateFrom(e.target.value); }}
          className="rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => { setSkip(0); setDateTo(e.target.value); }}
          className="rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white text-sm"
        />
        <button
          type="button"
          onClick={() => { setSkip(0); setSymbol(''); setUid(''); setLiquidity('all'); setDateFrom(''); setDateTo(''); }}
          className="rounded-xl border border-surface-border px-4 py-3 text-white/85 text-sm font-bold"
        >
          Clear
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4 text-sm text-white/65">
        <span>Total records: <strong className="text-white">{total}</strong></span>
        <span>Total amount (notional USDT): <strong className="text-cyan-300 font-mono">{notionalTotal.toFixed(4)}</strong></span>
      </div>

      <AdminDataTable>
            <thead>
              <tr>
                <SortableTh sortKey="created_at" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Time</SortableTh>
                <SortableTh sortKey="symbol" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Symbol</SortableTh>
                <SortableTh sortKey="price" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Price</SortableTh>
                <SortableTh sortKey="amount" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Amount</SortableTh>
                <th>Taker</th>
                <th>Maker</th>
                <th>Liquidity</th>
                <th>Counterparty trace</th>
                <th>Fees</th>
                <th className="text-right">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center text-white/50">Loading…</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center text-white/50">No trades match.</td>
                </tr>
              ) : (
                items.map((t, idx) => (
                  <tr key={t.id || `${t.created_at}-${t.symbol}-${idx}`} className="border-b border-surface-border/60 hover:bg-white/[.03]">
                    <td className="px-2 py-2 text-white/55 text-[11px] whitespace-normal break-words">
                      {t.created_at ? new Date(t.created_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-1.5 font-mono font-bold text-gold-light/90 break-all">
                        <CoinAvatar symbol={t.symbol} className="h-5 w-5 shrink-0" />
                        {t.symbol}
                      </span>
                    </td>
                    <td className="px-2 py-2 font-mono text-right whitespace-normal break-all">{Number(t.price).toFixed(8)}</td>
                    <td className="px-2 py-2 font-mono text-right whitespace-normal break-all">{Number(t.amount).toFixed(8)}</td>
                    <td className="px-2 py-2">
                      <Link to={`/users/${t.taker_uid}`} className="text-[11px] font-mono text-blue-300 hover:underline break-all">{t.taker_uid}</Link>
                      <span className="block text-white/40 text-[10px]">({t.taker_side})</span>
                    </td>
                    <td className="px-2 py-2">
                      {t.maker_uid === 'SYSTEM' ? (
                        <span className="text-[11px] font-mono text-white/40">SYSTEM</span>
                      ) : (
                        <Link to={`/users/${t.maker_uid}`} className="text-[11px] font-mono text-blue-300 hover:underline break-all">{t.maker_uid}</Link>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {resolveTradeLiquiditySource(t) === 'BINANCE' ? (
                        <span className="inline-flex items-center rounded-md bg-cyan-500/15 border border-cyan-500/30 px-1.5 py-0.5 text-[10px] font-bold text-cyan-200 uppercase">
                          Binance
                        </span>
                      ) : (resolveTradeLiquiditySource(t) === 'SYSTEM' ? (
                        <span className="inline-flex items-center rounded-md bg-gold/15 border border-gold/30 px-1.5 py-0.5 text-[10px] font-bold text-gold-light uppercase">
                          System fill
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-bold text-emerald-200 uppercase">
                          User matched
                        </span>
                      ))}
                    </td>
                    <td className="px-2 py-2 text-[11px] whitespace-normal break-words">
                      {resolveTradeLiquiditySource(t) === 'BINANCE' ? (
                        <span className="text-cyan-200">External Binance liquidity route</span>
                      ) : (resolveTradeLiquiditySource(t) === 'SYSTEM' ? (
                        <span className="text-white/55">SYSTEM treasury liquidity</span>
                      ) : (
                        <span className="text-white/75 break-all">
                          <Link to={`/users/${t.taker_uid}`} className="text-blue-300 hover:underline font-mono break-all">{t.taker_uid}</Link>
                          <span className="text-white/35 mx-1">vs</span>
                          <Link to={`/users/${t.maker_uid}`} className="text-blue-300 hover:underline font-mono break-all">{t.maker_uid}</Link>
                        </span>
                      ))}
                    </td>
                    <td className="px-2 py-2 text-[11px] font-mono text-white/60 whitespace-normal break-words">
                      T {Number(t.taker_fee || 0).toFixed(6)} {t.taker_fee_asset || ''}
                      <br />
                      M {Number(t.maker_fee || 0).toFixed(6)} {t.maker_fee_asset || ''}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedTrade(t)}
                        className="text-xs font-bold text-gold-light hover:underline"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
      </AdminDataTable>

      <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
          <p className="text-white/50 text-sm">{total} trades · page {page} / {pages}</p>
          <div className="flex items-center gap-2">
            <select
              value={String(limit)}
              onChange={e => { setSkip(0); setLimit(Number(e.target.value)); }}
              className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm font-semibold"
            >
              {[10, 25, 40, 50, 100].map(n => <option key={n} value={n}>{n}/page</option>)}
            </select>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={skip <= 0}
              onClick={() => setSkip(s => Math.max(0, s - limit))}
              className="flex items-center gap-1 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40"
            >
              <ChevronLeft size={18} /> Prev
            </button>
            <button
              type="button"
              disabled={skip + limit >= total}
              onClick={() => setSkip(s => s + limit)}
              className="flex items-center gap-1 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40"
            >
              Next <ChevronRight size={18} />
            </button>
          </div>
          </div>
        </div>

      {selectedTrade ? (
        <div
          className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm p-4 flex items-center justify-center"
          onClick={() => setSelectedTrade(null)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-surface-border bg-surface-card max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 sm:px-5 py-3 border-b border-surface-border flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-white">Trade Details</h3>
                <p className="text-xs text-white/60 font-mono">{selectedTrade.id || '—'}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTrade(null)}
                className="rounded-lg border border-surface-border px-3 py-1.5 text-xs font-bold text-white/80 hover:text-white"
              >
                Close
              </button>
            </div>
            <div className="p-4 sm:p-5 space-y-4 text-sm">
              <div className="grid sm:grid-cols-2 gap-3">
                <DetailItem label="Symbol" value={selectedTrade.symbol || '—'} mono />
                <DetailItem label="Time" value={selectedTrade.created_at ? new Date(selectedTrade.created_at).toLocaleString() : '—'} />
                <DetailItem label="Price" value={Number(selectedTrade.price || 0).toFixed(8)} mono />
                <DetailItem label="Amount" value={Number(selectedTrade.amount || 0).toFixed(8)} mono />
                <DetailItem label="Notional USDT" value={(Number(selectedTrade.price || 0) * Number(selectedTrade.amount || 0)).toFixed(8)} mono />
                <DetailItem
                  label="Liquidity Source"
                  value={resolveTradeLiquiditySource(selectedTrade)}
                />
              </div>

              <div className="rounded-xl border border-surface-border p-3">
                <p className="text-xs uppercase font-extrabold tracking-wide text-white/60 mb-2">Counterparty</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <DetailItem label="Taker UID" value={selectedTrade.taker_uid || '—'} mono />
                  <DetailItem label="Taker Side" value={selectedTrade.taker_side || '—'} />
                  <DetailItem label="Maker UID" value={selectedTrade.maker_uid || '—'} mono />
                  <DetailItem label="Maker Side" value={selectedTrade.maker_side || '—'} />
                  <DetailItem label="Taker Order ID" value={selectedTrade.taker_order_id || '—'} mono />
                  <DetailItem label="Maker Order ID" value={selectedTrade.maker_order_id || '—'} mono />
                </div>
              </div>

              <div className="rounded-xl border border-surface-border p-3">
                <p className="text-xs uppercase font-extrabold tracking-wide text-white/60 mb-2">Fees</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <DetailItem label="Taker Fee" value={`${Number(selectedTrade.taker_fee || 0).toFixed(8)} ${selectedTrade.taker_fee_asset || ''}`.trim()} mono />
                  <DetailItem label="Maker Fee" value={`${Number(selectedTrade.maker_fee || 0).toFixed(8)} ${selectedTrade.maker_fee_asset || ''}`.trim()} mono />
                </div>
              </div>

              <div className="rounded-xl border border-surface-border p-3">
                <p className="text-xs uppercase font-extrabold tracking-wide text-white/60 mb-2">System Fill Metadata</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <DetailItem label="System Fill Flag" value={selectedTrade.system_fill ? 'true' : 'false'} />
                  <DetailItem label="Spread (bps)" value={selectedTrade.spread_bps != null ? String(selectedTrade.spread_bps) : '—'} mono />
                  <DetailItem label="Mark Price" value={selectedTrade.mark_price != null ? String(selectedTrade.mark_price) : '—'} mono />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailItem({ label, value, mono = false }) {
  return (
    <div className="rounded-lg border border-surface-border/70 px-3 py-2 bg-surface-dark/40">
      <p className="text-[11px] uppercase font-extrabold tracking-wide text-white/50">{label}</p>
      <p className={`text-sm text-white mt-1 break-all ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function resolveTradeLiquiditySource(trade) {
  return String(
    trade?.liquidity_source
      || (trade?.maker_uid === 'SYSTEM' || trade?.system_fill ? 'SYSTEM' : 'USER'),
  ).toUpperCase();
}
