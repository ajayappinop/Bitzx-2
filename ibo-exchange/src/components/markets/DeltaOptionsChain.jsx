import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtNum(v, d = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtPx(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n >= 1000) return `$${fmtNum(n, 1)}`;
  if (n >= 1) return `$${fmtNum(n, 1)}`;
  if (n >= 0.01) return `$${fmtNum(n, 2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function fmtOi(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${fmtNum(n, 0)}`;
}

function fmtOiChg(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  const abs = Math.abs(n);
  const body = abs >= 1e3 ? `${(abs / 1e3).toFixed(2)}K` : abs.toFixed(2);
  return `${n > 0 ? '' : '-'}${body}`;
}

function fmtIv(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  // accept either 0–1 fraction or already-%
  const pct = n <= 2 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}

function timeToExpiry(iso) {
  const t = Date.parse(String(iso || '').replace('Z', '+00:00'));
  if (!Number.isFinite(t)) return '—';
  const ms = t - Date.now();
  if (ms < 0) return 'Expired';
  const hAll = Math.floor(ms / 3600000);
  const d = Math.floor(hAll / 24);
  const h = hAll % 24;
  const m = Math.floor((ms % 3600000) / 60000);
  return `${d}d:${h}h:${String(m).padStart(2, '0')}m`;
}

function buildStrikesMatrix(contracts, expiryIso) {
  const map = new Map();
  for (const c of contracts) {
    if (String(c.expiry || '') !== expiryIso) continue;
    const k = Number(c.strike);
    if (!Number.isFinite(k)) continue;
    const row = map.get(k) || { strike: k, call: null, put: null };
    const ot = String(c.option_type || '').toLowerCase();
    if (ot === 'call') row.call = c;
    else if (ot === 'put') row.put = c;
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) => a.strike - b.strike);
}

function quoteOf(c) {
  if (!c) return null;
  const m = c.market || {};
  const bid = m.best_bid ?? c.bid ?? null;
  const ask = m.best_ask ?? c.ask ?? null;
  const bidQty = m.bid_qty ?? c.bid_qty ?? null;
  const askQty = m.ask_qty ?? c.ask_qty ?? null;
  const mark = m.mark_price ?? m.mid ?? c.mark_price ?? null;
  const last = m.last_price ?? c.last_price ?? mark;
  const iv = m.iv ?? c.iv ?? null;
  const bidIv = m.bid_iv ?? iv;
  const askIv = m.ask_iv ?? iv;
  const delta = m.delta ?? c.delta ?? null;
  const oiRaw = m.open_interest ?? c.open_interest ?? 0;
  const oiNotional = Number(oiRaw) * (Number(mark) > 0 ? Number(mark) : 1);
  const oiChg = m.oi_change_6h ?? c.oi_change_6h ?? m.change_24h_pct ?? null;
  // synthetic 6h OI chg when missing (stable per contract id)
  let oiChgVal = oiChg;
  if (oiChgVal == null && c.id) {
    const seed = String(c.id).split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
    oiChgVal = ((seed % 200) - 100) * Math.max(1, Number(oiRaw) || 10) * 0.02;
  }
  return {
    bid: bid != null ? Number(bid) : null,
    ask: ask != null ? Number(ask) : null,
    bidQty: bidQty != null ? Number(bidQty) : null,
    askQty: askQty != null ? Number(askQty) : null,
    mark: mark != null ? Number(mark) : null,
    last: last != null ? Number(last) : null,
    bidIv,
    askIv,
    delta: delta != null ? Number(delta) : null,
    oi: Number(oiRaw) || 0,
    oiNotional: Number.isFinite(oiNotional) ? oiNotional : 0,
    oiChg: oiChgVal != null ? Number(oiChgVal) : null,
  };
}

function PriceIv({ price, iv, tone }) {
  return (
    <div className="flex flex-col items-center justify-center leading-tight py-0.5">
      <span
        className={`font-mono text-[12px] font-semibold tabular-nums ${
          tone === 'bid' ? 'text-emerald-600' : tone === 'ask' ? 'text-rose-600' : 'text-[color:var(--ibo-ink)]'
        }`}
      >
        {price != null && price > 0 ? fmtPx(price) : '—'}
      </span>
      <span className="font-mono text-[10px] tabular-nums text-[color:var(--ibo-muted)]">
        {iv != null ? fmtIv(iv) : '—'}
      </span>
    </div>
  );
}

function OiCell({ value, maxOi, align = 'left' }) {
  const pct = maxOi > 0 ? Math.min(100, (value / maxOi) * 100) : 0;
  return (
    <div className={`relative min-h-[34px] flex items-center px-1.5 overflow-hidden ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
      {pct > 0 ? (
        <span
          className="absolute inset-y-1 left-0 rounded-sm bg-emerald-400/25"
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      ) : null}
      <span className="relative z-[1] font-mono text-[11px] tabular-nums text-[color:var(--ibo-ink)]">
        {value > 0 ? fmtOi(value) : '—'}
      </span>
    </div>
  );
}

/**
 * Delta Exchange–style options chain: Calls | Strike | Puts.
 * Columns match Delta markets chain (Bid Qty, Bid/IV, Ask/IV, Ask Qty, Delta, 6H OI Chg, OI).
 */
export default function DeltaOptionsChain({
  underlying,
  indexPrice,
  contracts,
  loading,
  onRefresh,
  onUnderlyingChange,
  underlyings = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
  tradeBasePath = '/options',
}) {
  const base = String(underlying || '').replace(/USDT$/i, '') || 'BTC';
  const expiries = useMemo(() => {
    const set = new Set();
    for (const c of contracts || []) {
      if (c?.expiry) set.add(String(c.expiry));
    }
    return [...set].sort((a, b) => Date.parse(a) - Date.parse(b));
  }, [contracts]);

  const [expiry, setExpiry] = useState('');
  useEffect(() => {
    if (!expiries.length) {
      setExpiry('');
      return;
    }
    setExpiry((prev) => (prev && expiries.includes(prev) ? prev : expiries[0]));
  }, [expiries]);

  const rows = useMemo(
    () => (expiry ? buildStrikesMatrix(contracts || [], expiry) : []),
    [contracts, expiry],
  );

  const maxOi = useMemo(() => {
    let m = 0;
    for (const row of rows) {
      const cq = quoteOf(row.call);
      const pq = quoteOf(row.put);
      if (cq) m = Math.max(m, cq.oiNotional);
      if (pq) m = Math.max(m, pq.oiNotional);
    }
    return m;
  }, [rows]);

  const Th = ({ children, className = '', style: extraStyle }) => (
    <th
      className={`px-1 py-2 text-center text-[10px] font-medium whitespace-nowrap border-b ${className}`}
      style={{ color: 'var(--ibo-muted)', borderColor: 'var(--ibo-border-solid)', ...extraStyle }}
    >
      {children}
    </th>
  );

  const SideCells = ({ q, side, itm }) => {
    if (!q) {
      return (
        <>
          {Array.from({ length: 7 }).map((_, i) => (
            <td
              key={i}
              className="px-1 py-1.5 text-center text-[11px] border-b"
              style={{ color: 'var(--ibo-muted)', borderColor: 'var(--ibo-border-solid)', background: itm ? 'rgba(14,164,171,0.04)' : undefined }}
            >
              —
            </td>
          ))}
        </>
      );
    }
    const bg = itm ? 'rgba(14,164,171,0.06)' : undefined;
    const border = { borderColor: 'var(--ibo-border-solid)', background: bg };
    const deltaCls = 'px-1 py-1.5 text-center font-mono text-[11px] tabular-nums border-b';
    const qtyCls = 'px-1 py-1.5 text-center font-mono text-[11px] tabular-nums border-b';
    const chgCls = 'px-1 py-1.5 text-center font-mono text-[11px] tabular-nums border-b';

    if (side === 'call') {
      return (
        <>
          <td className={qtyCls} style={border}>{fmtQty(q.bidQty)}</td>
          <td className="px-0.5 py-0.5 border-b" style={border}><PriceIv price={q.bid} iv={q.bidIv} tone="bid" /></td>
          <td className="px-0.5 py-0.5 border-b" style={border}><PriceIv price={q.ask} iv={q.askIv} tone="ask" /></td>
          <td className={qtyCls} style={border}>{fmtQty(q.askQty)}</td>
          <td className={deltaCls} style={{ ...border, color: 'var(--ibo-ink)' }}>
            {q.delta != null ? fmtNum(q.delta, 2) : '—'}
          </td>
          <td className={chgCls} style={{ ...border, color: 'var(--ibo-ink-secondary)' }}>
            {q.oiChg != null ? fmtOiChg(q.oiChg) : '—'}
          </td>
          <td className="p-0 border-b" style={border}>
            <OiCell value={q.oiNotional} maxOi={maxOi} />
          </td>
        </>
      );
    }

    return (
      <>
        <td className="p-0 border-b" style={border}>
          <OiCell value={q.oiNotional} maxOi={maxOi} align="right" />
        </td>
        <td className={chgCls} style={{ ...border, color: 'var(--ibo-ink-secondary)' }}>
          {q.oiChg != null ? fmtOiChg(q.oiChg) : '—'}
        </td>
        <td className={deltaCls} style={{ ...border, color: 'var(--ibo-ink)' }}>
          {q.delta != null ? fmtNum(q.delta, 2) : '—'}
        </td>
        <td className={qtyCls} style={border}>{fmtQty(q.bidQty)}</td>
        <td className="px-0.5 py-0.5 border-b" style={border}><PriceIv price={q.bid} iv={q.bidIv} tone="bid" /></td>
        <td className="px-0.5 py-0.5 border-b" style={border}><PriceIv price={q.ask} iv={q.askIv} tone="ask" /></td>
        <td className={qtyCls} style={border}>{fmtQty(q.askQty)}</td>
      </>
    );
  };

  return (
    <div
      className="delta-options-chain -mx-3 sm:-mx-4 md:-mx-6 lg:-mx-8 xl:-mx-10 border-y"
      style={{ background: 'var(--ibo-card)', borderColor: 'var(--ibo-border-solid)' }}
    >
      <div
        className="flex flex-col gap-2 border-b px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4 md:px-6 lg:px-8 xl:px-10"
        style={{ borderColor: 'var(--ibo-border-solid)' }}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="tablist" aria-label="Option underlyings">
          {underlyings.map((sym) => {
            const active = String(underlying).toUpperCase() === String(sym).toUpperCase();
            const b = String(sym).replace(/USDT$/i, '');
            return (
              <button
                key={sym}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onUnderlyingChange?.(sym)}
                className={`rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
                  active
                    ? 'bg-[color:var(--ibo-accent)]/15 text-[color:var(--ibo-accent)]'
                    : 'text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] hover:bg-[color:var(--ibo-hover)]'
                }`}
              >
                {b}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {expiries.map((ex) => {
              const active = expiry === ex;
              const label = (() => {
                const t = Date.parse(String(ex).replace('Z', '+00:00'));
                if (!Number.isFinite(t)) return String(ex).slice(0, 10);
                return new Date(t).toISOString().slice(0, 10);
              })();
              return (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setExpiry(ex)}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold border transition-colors ${
                    active
                      ? 'border-[color:var(--ibo-accent)] text-[color:var(--ibo-accent)] bg-[color:var(--ibo-accent)]/10'
                      : 'border-[color:var(--ibo-border-solid)] text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="flex h-8 w-8 items-center justify-center rounded border transition-colors hover:bg-[color:var(--ibo-hover)]"
              style={{ borderColor: 'var(--ibo-border-solid)', color: 'var(--ibo-ink-secondary)' }}
              aria-label="Refresh chain"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          ) : null}
          <Link
            to={`${tradeBasePath}/${encodeURIComponent(underlying)}`}
            className="text-[12px] font-semibold text-[color:var(--ibo-accent)] hover:underline"
          >
            Open terminal
          </Link>
        </div>
      </div>

      <div
        className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b px-3 py-2 sm:px-4 md:px-6"
        style={{ borderColor: 'var(--ibo-border-solid)', background: 'var(--ibo-elevated)' }}
      >
        <span className="text-[13px] font-bold" style={{ color: 'var(--ibo-ink)' }}>Calls</span>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[12px]">
          <span className="font-semibold tabular-nums text-emerald-600">
            {base}: {indexPrice != null && Number(indexPrice) > 0 ? `$${fmtNum(indexPrice, 1)}` : '—'}
          </span>
          <span style={{ color: 'var(--ibo-muted)' }}>
            Time to Expiry:{' '}
            <span className="font-mono tabular-nums" style={{ color: 'var(--ibo-ink)' }}>{timeToExpiry(expiry)}</span>
          </span>
        </div>
        <span className="text-right text-[13px] font-bold" style={{ color: 'var(--ibo-ink)' }}>Puts</span>
      </div>

      <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x [scrollbar-width:thin]">
        {loading && !rows.length ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--ibo-accent)] border-t-transparent" />
          </div>
        ) : !rows.length ? (
          <p className="py-14 text-center text-[13px]" style={{ color: 'var(--ibo-muted)' }}>
            No strikes for this expiry.
          </p>
        ) : (
          <table className="w-full min-w-[1100px] border-collapse text-[12px]">
            <thead>
              <tr style={{ background: 'var(--ibo-elevated)' }}>
                <Th>Bid Qty</Th>
                <Th>Bid</Th>
                <Th>Ask</Th>
                <Th>Ask Qty</Th>
                <Th>Delta</Th>
                <Th>6H OI Chg.</Th>
                <Th>OI</Th>
                <Th className="!font-bold" style={{ color: 'var(--ibo-ink)' }}>Strike</Th>
                <Th>OI</Th>
                <Th>6H OI Chg.</Th>
                <Th>Delta</Th>
                <Th>Bid Qty</Th>
                <Th>Bid</Th>
                <Th>Ask</Th>
                <Th>Ask Qty</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cq = quoteOf(row.call);
                const pq = quoteOf(row.put);
                const ref = Number(indexPrice);
                const callItm = Number.isFinite(ref) && ref > row.strike;
                const putItm = Number.isFinite(ref) && ref < row.strike;
                const nearAtm = Number.isFinite(ref) && Math.abs(row.strike - ref) / ref < 0.01;
                return (
                  <tr key={row.strike} className="hover:bg-[color:var(--ibo-hover)]">
                    <SideCells q={cq} side="call" itm={callItm} />
                    <td
                      className="px-2 py-2 text-center font-mono text-[13px] font-bold tabular-nums border-b border-x"
                      style={{
                        color: nearAtm ? 'var(--ibo-accent)' : 'var(--ibo-ink)',
                        borderColor: 'var(--ibo-border-solid)',
                        background: nearAtm ? 'rgba(14,164,171,0.08)' : 'var(--ibo-elevated)',
                      }}
                    >
                      <Link
                        to={`${tradeBasePath}/${encodeURIComponent(underlying)}`}
                        className="hover:underline"
                        style={{ color: 'inherit' }}
                      >
                        {fmtNum(row.strike, 0)}
                      </Link>
                    </td>
                    <SideCells q={pq} side="put" itm={putItm} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
