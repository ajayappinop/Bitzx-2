/**
 * IBO ↔ USDT instant swap + recent swap history (wallet tab).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownUp, ArrowRight, ChevronDown, ChevronUp,
  RefreshCw, Zap, Wallet, History, Info,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { COIN_ICONS } from '@/services/marketApi';
import {
  fetchSwapConfig,
  fetchSwapQuote,
  executeSwap,
  fetchSwapOrderHistory,
} from '@/services/walletSwapApi';
import { buildLocalSwapQuote } from '@/lib/swapEstimate';

const PCT = [0.25, 0.5, 0.75, 1];
const QUOTE_DEBOUNCE_MS = 160;

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt(v, dp = 4) {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dp });
}

function AssetChip({ asset, large }) {
  const icon = COIN_ICONS[asset];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border border-[rgba(91,184,255,0.35)] bg-[rgba(91,184,255,0.1)] shrink-0 ${large ? 'px-4 py-2' : 'px-3 py-1.5'}`}>
      {icon ? (
        <img src={icon} alt="" className={large ? 'h-8 w-8' : 'h-6 w-6'} />
      ) : (
        <span className={`flex items-center justify-center rounded-full bg-[rgba(91,184,255,0.25)] font-bold text-[#5BB8FF] ${large ? 'h-8 w-8 text-xs' : 'h-6 w-6 text-[10px]'}`}>
          {asset.slice(0, 2)}
        </span>
      )}
      <span className={`font-bold text-[#5BB8FF] ${large ? 'text-base' : 'text-sm'}`}>{asset}</span>
    </span>
  );
}

function DetailRow({ label, value, accent }) {
  return (
    <div className="flex justify-between gap-3 py-2 border-b border-white/[0.06] last:border-0">
      <span className="text-xs text-white/50">{label}</span>
      <span className={`text-xs font-mono text-right ${accent || 'text-white'}`}>{value}</span>
    </div>
  );
}

function BalanceTile({ asset, available, usdHint }) {
  const icon = COIN_ICONS[asset];
  return (
    <div className="rounded-xl border border-surface-border bg-white/[0.03] p-4 flex items-center gap-3">
      {icon ? (
        <img src={icon} alt="" className="h-10 w-10 rounded-full object-contain" />
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(91,184,255,0.2)] text-sm font-bold text-[#5BB8FF]">
          {asset.slice(0, 2)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-white/45">{asset} available</p>
        <p className="text-lg font-bold text-white font-mono truncate">
          {fmt(available, asset === 'USDT' ? 2 : 4)}
        </p>
        {usdHint ? <p className="text-[10px] text-white/40 mt-0.5">{usdHint}</p> : null}
      </div>
    </div>
  );
}

function swapRouteLabel(order) {
  const side = String(order.side || '').toLowerCase();
  return side === 'sell' ? 'IBO → USDT' : 'USDT → IBO';
}

export default function IboSwapPanel() {
  const { walletAssets, walletLoading, fetchWallet } = useAuth();

  const [direction, setDirection] = useState('ibo_to_usdt');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteSyncing, setQuoteSyncing] = useState(false);
  const quoteAbortRef = useRef(null);
  const quoteSeqRef = useRef(0);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [swapConfig, setSwapConfig] = useState(null);

  const fromAsset = direction === 'ibo_to_usdt' ? 'IBO' : 'USDT';
  const toAsset = direction === 'ibo_to_usdt' ? 'USDT' : 'IBO';

  const iboBal = useMemo(() => {
    const w = walletAssets.find((x) => x.asset === 'IBO');
    return w ? num(w.available) : 0;
  }, [walletAssets]);

  const usdtBal = useMemo(() => {
    const w = walletAssets.find((x) => x.asset === 'USDT');
    return w ? num(w.available) : 0;
  }, [walletAssets]);

  const payBalance = fromAsset === 'IBO' ? iboBal : usdtBal;

  const available = useMemo(() => {
    if (quote?.available_from != null) return num(quote.available_from);
    return payBalance;
  }, [payBalance, quote]);

  const feeTotal = useMemo(() => {
    if (!quote) return 0;
    if (quote.fee_ibo_total != null) return num(quote.fee_ibo_total);
    return num(quote.fee_ibo_estimated) + num(quote.trading_fee_ibo_estimated);
  }, [quote]);

  const feeOk = useMemo(() => {
    if (feeTotal <= 0) return true;
    return iboBal + 1e-9 >= feeTotal;
  }, [feeTotal, iboBal]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setHistory(await fetchSwapOrderHistory(12));
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    fetchSwapConfig()
      .then(setSwapConfig)
      .catch(() => setSwapConfig(null));
  }, []);

  const flip = () => {
    setDirection((d) => (d === 'ibo_to_usdt' ? 'usdt_to_ibo' : 'ibo_to_usdt'));
    setQuote(null);
    setError('');
    setSuccess('');
  };

  const applyLocalQuote = useCallback((n, dir) => {
    if (!swapConfig || !Number.isFinite(n) || n <= 0) {
      setQuote(null);
      return;
    }
    const px = num(swapConfig.ibo_price_usdt) || 0;
    if (px <= 0) return;
    const avail = dir === 'ibo_to_usdt' ? iboBal : usdtBal;
    setQuote(buildLocalSwapQuote(dir, n, px, swapConfig, avail));
  }, [swapConfig, iboBal, usdtBal]);

  useEffect(() => {
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setQuote(null);
      setQuoteSyncing(false);
      return;
    }
    applyLocalQuote(n, direction);
    const seq = ++quoteSeqRef.current;
    const t = setTimeout(async () => {
      quoteAbortRef.current?.abort?.();
      const ac = new AbortController();
      quoteAbortRef.current = ac;
      setQuoteSyncing(true);
      try {
        const q = await fetchSwapQuote(direction, n);
        if (seq !== quoteSeqRef.current) return;
        setQuote(q);
        setError('');
      } catch (e) {
        if (ac.signal.aborted || seq !== quoteSeqRef.current) return;
        setError(e.message || 'Could not load quote');
      } finally {
        if (seq === quoteSeqRef.current) setQuoteSyncing(false);
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      quoteAbortRef.current?.abort?.();
    };
  }, [amount, direction, applyLocalQuote, swapConfig]);

  const setPct = (p) => {
    if (available <= 0) return;
    const dp = fromAsset === 'USDT' ? 2 : 6;
    setAmount(fmt(available * p, dp).replace(/,/g, ''));
  };

  const onSwap = async () => {
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter an amount.');
      return;
    }
    if (n > available + 1e-9) {
      setError(`Insufficient ${fromAsset}.`);
      return;
    }
    if (!feeOk) {
      setError(`Need ~${fmt(feeTotal || quote?.fee_ibo_total, 4)} IBO for fees.`);
      return;
    }
    setSwapping(true);
    setError('');
    setSuccess('');
    try {
      await executeSwap(direction, n);
      setSuccess(`Swapped ${fmt(n, fromAsset === 'USDT' ? 2 : 4)} ${fromAsset}.`);
      setAmount('');
      setQuote(null);
      await Promise.all([fetchWallet(), loadHistory()]);
    } catch (e) {
      setError(e.message || 'Swap failed');
    } finally {
      setSwapping(false);
    }
  };

  const rateLine = quote?.price_usdt
    ? direction === 'ibo_to_usdt'
      ? `1 IBO = $${fmt(quote.price_usdt, 4)} USDT`
      : `1 IBO = $${fmt(quote.price_usdt, 4)} · 1 USDT ≈ ${fmt(1 / quote.price_usdt, 4)} IBO`
    : 'Enter an amount to load live rate';

  const receiveVal = quote
    ? fmt(quote.to_amount_estimated, toAsset === 'USDT' ? 2 : 4)
    : '0.0';

  const fmtDate = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      });
    } catch {
      return '';
    }
  };

  const iboUsd = quote?.price_usdt && iboBal > 0
    ? `≈ $${fmt(iboBal * quote.price_usdt, 2)}`
    : null;

  return (
    <div className="w-full max-w-6xl mx-auto">
      {/* Header — full width */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl font-extrabold text-white">Swap</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(91,184,255,0.2)] border border-[rgba(91,184,255,0.4)] px-2.5 py-0.5 text-[10px] font-bold uppercase text-[#5BB8FF]">
              <Zap size={11} /> Instant
            </span>
          </div>
          <p className="text-sm text-white/55 mt-1.5 max-w-xl">
            Convert IBO and USDT instantly at the live IBOUSDT market price. Fees are charged in IBO.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchWallet()}
          disabled={walletLoading}
          className="inline-flex items-center gap-2 text-xs font-bold text-[#5BB8FF] border border-[rgba(91,184,255,0.3)] px-4 py-2 rounded-xl hover:bg-[rgba(91,184,255,0.1)] disabled:opacity-40"
        >
          <RefreshCw size={14} className={walletLoading ? 'animate-spin' : ''} />
          Refresh balances
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
        {/* ── Left: swap form ── */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-2xl border border-surface-border bg-surface-DEFAULT overflow-hidden shadow-lg shadow-black/20">
            <div className="h-1 bg-gradient-to-r from-[rgba(91,184,255,0.8)] via-[#5BB8FF] to-[rgba(91,184,255,0.4)]" />

            <div className="p-5 sm:p-6 space-y-1">
              <div className="rounded-xl border border-surface-border bg-surface-dark/60 p-4 sm:p-5">
                <div className="flex justify-between text-[10px] uppercase tracking-wider text-white/50 mb-3">
                  <span>You pay</span>
                  <span className="font-mono text-[#5BB8FF]">
                    {fmt(payBalance, fromAsset === 'USDT' ? 2 : 4)} {fromAsset} available
                  </span>
                </div>
                <div className="flex items-center gap-4 min-w-0">
                  <input
                    className="min-w-0 flex-1 bg-transparent font-mono text-3xl sm:text-4xl text-white outline-none placeholder:text-white/20"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.0"
                  />
                  <AssetChip asset={fromAsset} large />
                </div>
                <div className="grid grid-cols-4 gap-2 mt-4">
                  {PCT.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPct(p)}
                      className="rounded-lg border border-surface-border bg-white/[0.04] py-2.5 text-[11px] font-bold text-white/70 hover:border-[rgba(91,184,255,0.4)] hover:bg-[rgba(91,184,255,0.1)] hover:text-[#5BB8FF] transition-colors"
                    >
                      {p === 1 ? 'MAX' : `${p * 100}%`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-center py-2 relative z-10">
                <button
                  type="button"
                  onClick={flip}
                  aria-label={`Swap direction: ${fromAsset} to ${toAsset}`}
                  className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-surface-DEFAULT bg-logo-gradient text-surface-dark shadow-xl shadow-[rgba(91,184,255,0.3)] hover:scale-105 active:scale-95 transition-transform"
                >
                  <ArrowDownUp size={24} strokeWidth={2.5} />
                </button>
              </div>

              <div className="rounded-xl border border-[rgba(91,184,255,0.2)] bg-[rgba(91,184,255,0.06)] p-4 sm:p-5">
                <div className="flex justify-between text-[10px] uppercase tracking-wider text-white/50 mb-3">
                  <span>You receive</span>
                  {quoteSyncing ? (
                    <span className="text-[#5BB8FF] animate-pulse font-semibold">Updating…</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-4 min-w-0">
                  <span className="min-w-0 flex-1 font-mono text-3xl sm:text-4xl text-[#5BB8FF]">{receiveVal}</span>
                  <AssetChip asset={toAsset} large />
                </div>
                <p className="mt-3 font-mono text-xs text-white/50">{rateLine}</p>
              </div>
            </div>

            {error ? (
              <p className="mx-5 sm:mx-6 mb-2 text-sm text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2">{error}</p>
            ) : null}
            {success ? (
              <p className="mx-5 sm:mx-6 mb-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2">{success}</p>
            ) : null}

            <div className="px-5 sm:px-6 pb-5 sm:pb-6">
              <button
                type="button"
                disabled={swapping || !amount || !quote || !feeOk}
                onClick={onSwap}
                className="w-full rounded-xl bg-logo-gradient py-4 text-base font-bold text-surface-dark disabled:opacity-50 hover:opacity-95 transition-opacity shadow-lg shadow-[rgba(91,184,255,0.2)]"
              >
                {swapping ? 'Swapping…' : direction === 'ibo_to_usdt' ? 'Swap IBO for USDT' : 'Swap USDT for IBO'}
              </button>
            </div>
          </div>

          <p className="text-[11px] text-white/40 flex items-start gap-2 px-1">
            <Info size={14} className="shrink-0 mt-0.5 text-white/30" />
            Swaps execute as market orders on IBOUSDT. Final fill may differ slightly from the quote.
          </p>
        </div>

        {/* ── Right: balances, details, history ── */}
        <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-surface-border bg-surface-DEFAULT p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-4">
              <Wallet size={16} className="text-[#5BB8FF]" />
              <h3 className="text-sm font-bold text-white">Wallet balances</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
              <BalanceTile asset="IBO" available={iboBal} usdHint={iboUsd} />
              <BalanceTile asset="USDT" available={usdtBal} usdHint="Stablecoin" />
            </div>
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-DEFAULT p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <Info size={16} className="text-[#5BB8FF]" />
              <h3 className="text-sm font-bold text-white">Swap details</h3>
            </div>
            <DetailRow label="Route" value={`${fromAsset} → ${toAsset}`} />
            <DetailRow label="Market" value="IBOUSDT" />
            <DetailRow label="Price impact" value="~0% (market)" accent="text-emerald-400" />
            <DetailRow label="Execution" value="Market order" />
            <DetailRow
              label="Minimum received"
              value={quote ? `${receiveVal} ${toAsset}` : '—'}
            />
            <DetailRow
              label="Swap platform fee"
              value={quote ? `≈ ${fmt(quote.fee_ibo_estimated, 4)} IBO` : (
                swapConfig
                  ? `${(num(swapConfig.swap_fee_rate) * 100).toFixed(2)}% + ${fmt(swapConfig.swap_fee_ibo_fixed, 4)} IBO`
                  : 'Set in admin'
              )}
            />
            {quote?.trading_fee_ibo_estimated > 0 ? (
              <DetailRow
                label="Market order fee"
                value={`≈ ${fmt(quote.trading_fee_ibo_estimated, 4)} IBO`}
              />
            ) : null}
            {quote && feeTotal > 0 ? (
              <DetailRow label="Total IBO required" value={`≈ ${fmt(feeTotal, 4)} IBO`} accent="text-[#5BB8FF]" />
            ) : null}
            {quote?.min_from_amount != null ? (
              <DetailRow
                label="Minimum pay"
                value={`${fmt(quote.min_from_amount, fromAsset === 'USDT' ? 2 : 4)} ${fromAsset}`}
              />
            ) : null}
            {!feeOk && quote ? (
              <p className="text-xs text-[#5BB8FF]/90 mt-3 rounded-lg bg-[rgba(91,184,255,0.1)] border border-[rgba(91,184,255,0.2)] px-3 py-2">
                Add IBO for fees — need ~{fmt(feeTotal, 4)}, have {fmt(iboBal, 4)}.
              </p>
            ) : null}
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-DEFAULT p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <History size={16} className="text-[#5BB8FF]" />
                <h3 className="text-sm font-bold text-white">Recent swaps</h3>
              </div>
              <button
                type="button"
                onClick={() => loadHistory()}
                className="text-white/40 hover:text-[#5BB8FF]"
                aria-label="Refresh swap history"
              >
                <RefreshCw size={14} className={historyLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {historyLoading ? (
              <p className="text-xs text-white/45 py-6 text-center">Loading history…</p>
            ) : history.length === 0 ? (
              <p className="text-xs text-white/45 py-4 text-center rounded-xl bg-white/[0.02] border border-dashed border-surface-border">
                No IBO/USDT swaps yet. Your executions will appear here.
              </p>
            ) : (
              <ul className="space-y-2 max-h-[280px] overflow-y-auto scrollbar-hide pr-1">
                {history.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center justify-between rounded-xl border border-surface-border bg-white/[0.02] px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{swapRouteLabel(o)}</p>
                      <p className="text-[11px] font-mono text-white/45 mt-0.5 truncate">
                        {fmt(o.filled ?? o.amount, 4)} · {String(o.status || '').replace('_', ' ')}
                      </p>
                    </div>
                    <span className="text-[10px] text-white/40 shrink-0 ml-2">{fmtDate(o.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              to="/dashboard"
              className="mt-4 flex items-center justify-center gap-1 text-xs font-semibold text-[#5BB8FF] hover:underline"
            >
              View all orders on Dashboard
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
