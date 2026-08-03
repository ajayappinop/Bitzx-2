/**
 * Delta ↔ USDT instant swap + recent swap history (wallet tab).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownUp, ArrowRight, ChevronDown, ChevronUp,
  RefreshCw, Wallet, History, Info,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { COIN_ICONS, walletAssetLabel } from '@/services/marketApi';
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
  const label = walletAssetLabel(asset);
  return (
    <span className={`inline-flex items-center gap-2 rounded-xl border border-[#FE6C02]/30 bg-[#FE6C02]/10 shrink-0 ${large ? 'px-4 py-2' : 'px-3 py-1.5'}`}>
      {icon ? (
        <img src={icon} alt="" className={large ? 'h-8 w-8' : 'h-6 w-6'} />
      ) : (
        <span className={`flex items-center justify-center rounded-full bg-[#FE6C02]/25 font-bold text-[#FE6C02] ${large ? 'h-8 w-8 text-xs' : 'h-6 w-6 text-[10px]'}`}>
          {label.slice(0, 2)}
        </span>
      )}
      <span className={`font-bold text-[#FE6C02] ${large ? 'text-base' : 'text-sm'}`}>{label}</span>
    </span>
  );
}

function DetailRow({ label, value, accent }) {
  return (
    <div className="flex justify-between gap-3 py-2 border-b border-[color:var(--ibo-border-solid)] last:border-0">
      <span className="text-xs text-[color:var(--ibo-muted)]">{label}</span>
      <span className={`text-xs font-mono text-right ${accent || 'text-[color:var(--ibo-ink)]'}`}>{value}</span>
    </div>
  );
}

function BalanceTile({ asset, available, usdHint }) {
  const icon = COIN_ICONS[asset];
  const label = walletAssetLabel(asset);
  return (
    <div className="rounded-xl border border-[color:var(--ibo-border-solid)] px-4 py-3 flex items-center gap-3">
      {icon ? (
        <img src={icon} alt="" className="h-9 w-9 rounded-full object-contain" />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FE6C02]/15 text-sm font-bold text-[#FE6C02]">
          {label.slice(0, 2)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-[color:var(--ibo-muted)]">{label} available</p>
        <p className="text-lg font-bold text-[color:var(--ibo-ink)] font-mono tabular-nums truncate">
          {fmt(available, asset === 'USDT' ? 2 : 4)}
        </p>
        {usdHint ? <p className="text-[10px] text-[color:var(--ibo-muted)] mt-0.5">{usdHint}</p> : null}
      </div>
    </div>
  );
}

function swapRouteLabel(order) {
  const side = String(order.side || '').toLowerCase();
  return side === 'sell' ? 'Delta → USDT' : 'USDT → Delta';
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
      setError(`Need ~${fmt(feeTotal || quote?.fee_ibo_total, 4)} Delta for fees.`);
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
      ? `1 Delta = $${fmt(quote.price_usdt, 4)} USDT`
      : `1 Delta = $${fmt(quote.price_usdt, 4)} · 1 USDT ≈ ${fmt(1 / quote.price_usdt, 4)} Delta`
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
    <div className="w-full">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[color:var(--ibo-muted)] leading-relaxed max-w-xl">
            Convert Delta ↔ USDT at the live IBOUSDT market price. Fees charged in Delta.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchWallet()}
          disabled={walletLoading}
          className="wallet-action-ghost disabled:opacity-40"
        >
          <RefreshCw size={14} className={walletLoading ? 'animate-spin' : ''} />
          Refresh balances
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6">
        <div className="lg:col-span-7 space-y-4">
          <div className="wallet-surface overflow-hidden">
            <div className="p-5 sm:p-6 space-y-1">
              <div className="rounded-xl border border-[color:var(--ibo-border-solid)] p-4 sm:p-5">
                <div className="flex justify-between text-[10px] uppercase tracking-wider text-[color:var(--ibo-muted)] mb-3">
                  <span>You pay</span>
                  <span className="font-mono text-[#FE6C02] normal-case tracking-normal">
                    {fmt(payBalance, fromAsset === 'USDT' ? 2 : 4)} {fromAsset}
                  </span>
                </div>
                <div className="flex items-center gap-4 min-w-0">
                  <input
                    className="min-w-0 flex-1 bg-transparent font-mono text-3xl sm:text-4xl text-[color:var(--ibo-ink)] outline-none placeholder:text-[color:var(--ibo-muted)]/40"
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
                      className="rounded-lg border border-[color:var(--ibo-border-solid)] py-2.5 text-[11px] font-bold text-[color:var(--ibo-ink-secondary)] hover:border-[#FE6C02]/40 hover:text-[#FE6C02] transition-colors"
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
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] text-[#FE6C02] hover:border-[#FE6C02]/50 transition-colors"
                >
                  <ArrowDownUp size={20} strokeWidth={2.5} />
                </button>
              </div>

              <div className="rounded-xl border border-[#FE6C02]/20 bg-[#FE6C02]/5 p-4 sm:p-5">
                <div className="flex justify-between text-[10px] uppercase tracking-wider text-[color:var(--ibo-muted)] mb-3">
                  <span>You receive</span>
                  {quoteSyncing ? (
                    <span className="text-[#FE6C02] animate-pulse font-semibold normal-case">Updating…</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-4 min-w-0">
                  <span className="min-w-0 flex-1 font-mono text-3xl sm:text-4xl text-[#FE6C02] tabular-nums">{receiveVal}</span>
                  <AssetChip asset={toAsset} large />
                </div>
                <p className="mt-3 font-mono text-xs text-[color:var(--ibo-muted)]">{rateLine}</p>
              </div>
            </div>

            {error ? (
              <p className="mx-5 sm:mx-6 mb-2 text-sm text-[#F6465D] bg-[#F6465D]/10 border border-[#F6465D]/25 rounded-lg px-3 py-2">{error}</p>
            ) : null}
            {success ? (
              <p className="mx-5 sm:mx-6 mb-2 text-sm text-[#0ECB81] bg-[#0ECB81]/10 border border-[#0ECB81]/25 rounded-lg px-3 py-2">{success}</p>
            ) : null}

            <div className="px-5 sm:px-6 pb-5 sm:pb-6">
              <button
                type="button"
                disabled={swapping || !amount || !quote || !feeOk}
                onClick={onSwap}
                className="w-full rounded-xl bg-[#FE6C02] hover:bg-[#ff7a1a] py-3.5 text-base font-bold text-white disabled:opacity-50 transition-colors"
              >
                {swapping ? 'Swapping…' : direction === 'ibo_to_usdt' ? 'Swap Delta for USDT' : 'Swap USDT for Delta'}
              </button>
            </div>
          </div>

          <p className="text-[11px] text-[color:var(--ibo-muted)] flex items-start gap-2 px-1">
            <Info size={14} className="shrink-0 mt-0.5 opacity-60" />
            Swaps execute as market orders on IBOUSDT. Final fill may differ slightly from the quote.
          </p>
        </div>

        <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="wallet-surface p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-4">
              <Wallet size={15} className="text-[#FE6C02]" />
              <h3 className="text-sm font-bold text-[color:var(--ibo-ink)]">Balances</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5">
              <BalanceTile asset="IBO" available={iboBal} usdHint={iboUsd} />
              <BalanceTile asset="USDT" available={usdtBal} usdHint="Stablecoin" />
            </div>
          </div>

          <div className="wallet-surface p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <Info size={15} className="text-[#FE6C02]" />
              <h3 className="text-sm font-bold text-[color:var(--ibo-ink)]">Swap details</h3>
            </div>
            <DetailRow label="Route" value={`${fromAsset} → ${toAsset}`} />
            <DetailRow label="Market" value="IBOUSDT" />
            <DetailRow label="Price impact" value="~0% (market)" accent="text-[#0ECB81]" />
            <DetailRow label="Execution" value="Market order" />
            <DetailRow
              label="Minimum received"
              value={quote ? `${receiveVal} ${toAsset}` : '—'}
            />
            <DetailRow
              label="Swap platform fee"
              value={quote ? `≈ ${fmt(quote.fee_ibo_estimated, 4)} Delta` : (
                swapConfig
                  ? `${(num(swapConfig.swap_fee_rate) * 100).toFixed(2)}% + ${fmt(swapConfig.swap_fee_ibo_fixed, 4)} Delta`
                  : 'Set in admin'
              )}
            />
            {quote?.trading_fee_ibo_estimated > 0 ? (
              <DetailRow
                label="Market order fee"
                value={`≈ ${fmt(quote.trading_fee_ibo_estimated, 4)} Delta`}
              />
            ) : null}
            {quote && feeTotal > 0 ? (
              <DetailRow label="Total Delta required" value={`≈ ${fmt(feeTotal, 4)} Delta`} accent="text-[#FE6C02]" />
            ) : null}
            {quote?.min_from_amount != null ? (
              <DetailRow
                label="Minimum pay"
                value={`${fmt(quote.min_from_amount, fromAsset === 'USDT' ? 2 : 4)} ${fromAsset}`}
              />
            ) : null}
            {!feeOk && quote ? (
              <p className="text-xs text-[#FE6C02] mt-3 rounded-lg bg-[#FE6C02]/10 border border-[#FE6C02]/20 px-3 py-2">
                Add Delta for fees — need ~{fmt(feeTotal, 4)}, have {fmt(iboBal, 4)}.
              </p>
            ) : null}
          </div>

          <div className="wallet-surface p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <History size={15} className="text-[#FE6C02]" />
                <h3 className="text-sm font-bold text-[color:var(--ibo-ink)]">Recent swaps</h3>
              </div>
              <button
                type="button"
                onClick={() => loadHistory()}
                className="text-[color:var(--ibo-muted)] hover:text-[#FE6C02]"
                aria-label="Refresh swap history"
              >
                <RefreshCw size={14} className={historyLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {historyLoading ? (
              <p className="text-xs text-[color:var(--ibo-muted)] py-6 text-center">Loading history…</p>
            ) : history.length === 0 ? (
              <p className="text-xs text-[color:var(--ibo-muted)] py-4 text-center rounded-xl border border-dashed border-[color:var(--ibo-border-solid)]">
                No Delta/USDT swaps yet.
              </p>
            ) : (
              <ul className="space-y-2 max-h-[280px] overflow-y-auto scrollbar-hide pr-1">
                {history.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center justify-between rounded-xl border border-[color:var(--ibo-border-solid)] px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[color:var(--ibo-ink)]">{swapRouteLabel(o)}</p>
                      <p className="text-[11px] font-mono text-[color:var(--ibo-muted)] mt-0.5 truncate">
                        {fmt(o.filled ?? o.amount, 4)} · {String(o.status || '').replace('_', ' ')}
                      </p>
                    </div>
                    <span className="text-[10px] text-[color:var(--ibo-muted)] shrink-0 ml-2">{fmtDate(o.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              to="/dashboard"
              className="mt-4 flex items-center justify-center gap-1 text-xs font-semibold text-[#FE6C02] hover:underline"
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
