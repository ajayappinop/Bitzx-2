/**
 * Transfer hub — Delta ↔ USDT convert + Spot ↔ Futures USDT wallet transfers.
 * Used at /account/transfer and the wallet Swap tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownUp,
  ArrowLeftRight,
  ArrowRight,
  History,
  Info,
  RefreshCw,
  Sparkles,
  Wallet,
  CheckCircle2,
  AlertTriangle,
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
import { futuresApi } from '@/services/futuresApi';
import { friendlyError } from '@/context/ToastContext';

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

function AssetMark({ asset, size = 28 }) {
  const icon = COIN_ICONS[asset];
  const label = walletAssetLabel(asset);
  const dim = size;
  if (icon) {
    return (
      <img
        src={icon}
        alt=""
        width={dim}
        height={dim}
        className="rounded-full object-contain shrink-0"
        style={{ width: dim, height: dim }}
      />
    );
  }
  return (
    <span
      className="flex items-center justify-center rounded-full bg-[rgba(254,108,2,0.15)] font-bold text-[#FE6C02] shrink-0"
      style={{ width: dim, height: dim, fontSize: dim * 0.32 }}
    >
      {label.slice(0, 2)}
    </span>
  );
}

function swapRouteLabel(order) {
  const side = String(order.side || '').toLowerCase();
  return side === 'sell' ? 'Delta → USDT' : 'USDT → Delta';
}

function ModeTabs({ mode, onChange }) {
  const tabs = [
    {
      id: 'convert',
      tone: 'orange',
      label: 'Convert assets',
      desc: 'Swap Delta and USDT at market rate',
      icon: ArrowDownUp,
      chips: ['Delta', 'USDT'],
    },
    {
      id: 'wallets',
      tone: 'teal',
      label: 'Move wallets',
      desc: 'Shift USDT between Spot and Futures',
      icon: ArrowLeftRight,
      chips: ['Spot', 'Futures'],
    },
  ];

  return (
    <div className="xfer-pick" role="tablist" aria-label="Transfer type">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = mode === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`xfer-pick__card xfer-pick__card--${t.tone}${active ? ' is-active' : ''}`}
          >
            <span className="xfer-pick__glow" aria-hidden />
            <span className="xfer-pick__top">
              <span className="xfer-pick__icon" aria-hidden>
                <Icon size={18} strokeWidth={2.25} />
              </span>
              {active ? (
                <span className="xfer-pick__badge">Selected</span>
              ) : (
                <span className="xfer-pick__badge is-idle">Select</span>
              )}
            </span>
            <span className="xfer-pick__title">{t.label}</span>
            <span className="xfer-pick__desc">{t.desc}</span>
            <span className="xfer-pick__chips" aria-hidden>
              <span className="xfer-pick__chip">{t.chips[0]}</span>
              <span className="xfer-pick__swap">⇄</span>
              <span className="xfer-pick__chip">{t.chips[1]}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WalletLane({ label, asset, amountDp, available, onMax, children, muted }) {
  return (
    <div className={`xfer-field${muted ? ' xfer-field--muted' : ''}`}>
      <div className="xfer-field__head">
        <span className="xfer-field__label">{label}</span>
        {onMax ? (
          <button type="button" className="xfer-field__avail" onClick={onMax}>
            Avail <span className="tabular-nums font-mono">{fmt(available, amountDp)}</span>{' '}
            {walletAssetLabel(asset)}
          </button>
        ) : (
          <span className="xfer-field__avail is-static">
            Avail <span className="tabular-nums font-mono">{fmt(available, amountDp)}</span>{' '}
            {walletAssetLabel(asset)}
          </span>
        )}
      </div>
      <div className="xfer-field__row">
        {children}
        <div className="xfer-field__asset">
          <AssetMark asset={asset} size={22} />
          <span>{walletAssetLabel(asset)}</span>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, accent }) {
  return (
    <div className="xfer-detail">
      <span>{label}</span>
      <span className={`font-mono tabular-nums text-right ${accent || ''}`}>{value}</span>
    </div>
  );
}

function BalanceCard({ asset, available, hint }) {
  return (
    <div className="xfer-bal">
      <AssetMark asset={asset} size={32} />
      <div className="min-w-0 flex-1">
        <p className="xfer-bal__label">{walletAssetLabel(asset)}</p>
        <p className="xfer-bal__value tabular-nums font-mono">
          {fmt(available, asset === 'USDT' ? 2 : 4)}
        </p>
        {hint ? <p className="xfer-bal__hint">{hint}</p> : null}
      </div>
    </div>
  );
}

// ── Convert: Delta ↔ USDT ───────────────────────────────────────────────────

function ConvertPanel() {
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
      setError(`Insufficient ${walletAssetLabel(fromAsset)}.`);
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
      setSuccess(`Swapped ${fmt(n, fromAsset === 'USDT' ? 2 : 4)} ${walletAssetLabel(fromAsset)}.`);
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
    : 'Enter an amount for a live rate';

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
    <div className="xfer-layout">
      <div className="xfer-main space-y-4">
        <div className="xfer-card">
          <div className="xfer-card__body space-y-1">
            <WalletLane
              label="You pay"
              asset={fromAsset}
              amountDp={fromAsset === 'USDT' ? 2 : 4}
              available={payBalance}
              onMax={() => setPct(1)}
            >
              <input
                className="xfer-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.0"
                aria-label="Amount to pay"
              />
            </WalletLane>

            <div className="xfer-flip">
              <button
                type="button"
                onClick={flip}
                aria-label={`Flip direction to ${toAsset} → ${fromAsset}`}
                className="xfer-flip__btn"
              >
                <ArrowDownUp size={18} strokeWidth={2.4} />
              </button>
            </div>

            <WalletLane
              label={quoteSyncing ? 'You receive · updating…' : 'You receive'}
              asset={toAsset}
              amountDp={toAsset === 'USDT' ? 2 : 4}
              available={toAsset === 'USDT' ? usdtBal : iboBal}
              onMax={undefined}
            >
              <span className="xfer-amount xfer-amount--out tabular-nums">{receiveVal}</span>
            </WalletLane>

            <div className="xfer-pct">
              {PCT.map((p) => (
                <button key={p} type="button" onClick={() => setPct(p)} className="xfer-pct__btn">
                  {p === 1 ? 'MAX' : `${p * 100}%`}
                </button>
              ))}
            </div>

            <p className="xfer-rate font-mono">{rateLine}</p>
          </div>

          {error ? (
            <div className="xfer-alert xfer-alert--err">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : null}
          {success ? (
            <div className="xfer-alert xfer-alert--ok">
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          ) : null}

          <div className="xfer-card__foot">
            <button
              type="button"
              disabled={swapping || !amount || !quote || !feeOk}
              onClick={onSwap}
              className="xfer-submit"
            >
              {swapping
                ? 'Converting…'
                : `Convert ${walletAssetLabel(fromAsset)} → ${walletAssetLabel(toAsset)}`}
            </button>
          </div>
        </div>

        <p className="xfer-note">
          <Info size={13} className="shrink-0 mt-0.5 opacity-70" />
          Converts execute as market orders on IBOUSDT. Final fill may differ slightly from the quote.
          Fees are charged in Delta.
        </p>
      </div>

      <aside className="xfer-side space-y-4">
        <div className="xfer-card">
          <div className="xfer-side__head">
            <Wallet size={15} className="text-[#FE6C02]" />
            <h3>Spot balances</h3>
            <button
              type="button"
              onClick={() => fetchWallet()}
              disabled={walletLoading}
              className="ml-auto text-[color:var(--ibo-muted)] hover:text-[#FE6C02] disabled:opacity-40"
              aria-label="Refresh balances"
            >
              <RefreshCw size={14} className={walletLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="space-y-2.5">
            <BalanceCard asset="IBO" available={iboBal} hint={iboUsd} />
            <BalanceCard asset="USDT" available={usdtBal} hint="Stablecoin" />
          </div>
        </div>

        <div className="xfer-card">
          <div className="xfer-side__head">
            <Sparkles size={15} className="text-[#FE6C02]" />
            <h3>Quote details</h3>
          </div>
          <DetailRow label="Route" value={`${walletAssetLabel(fromAsset)} → ${walletAssetLabel(toAsset)}`} />
          <DetailRow label="Market" value="IBOUSDT" />
          <DetailRow label="Price impact" value="~0% (market)" accent="text-[#0ECB81]" />
          <DetailRow
            label="You receive"
            value={quote ? `${receiveVal} ${walletAssetLabel(toAsset)}` : '—'}
          />
          <DetailRow
            label="Platform fee"
            value={quote ? `≈ ${fmt(quote.fee_ibo_estimated, 4)} Delta` : (
              swapConfig
                ? `${(num(swapConfig.swap_fee_rate) * 100).toFixed(2)}% + ${fmt(swapConfig.swap_fee_ibo_fixed, 4)} Delta`
                : '—'
            )}
          />
          {quote?.trading_fee_ibo_estimated > 0 ? (
            <DetailRow
              label="Order fee"
              value={`≈ ${fmt(quote.trading_fee_ibo_estimated, 4)} Delta`}
            />
          ) : null}
          {quote && feeTotal > 0 ? (
            <DetailRow label="Total Delta for fees" value={`≈ ${fmt(feeTotal, 4)}`} accent="text-[#FE6C02]" />
          ) : null}
          {!feeOk && quote ? (
            <p className="mt-3 text-xs text-[#FE6C02] rounded-lg bg-[rgba(254,108,2,0.1)] border border-[rgba(254,108,2,0.22)] px-3 py-2">
              Add Delta for fees — need ~{fmt(feeTotal, 4)}, have {fmt(iboBal, 4)}.
            </p>
          ) : null}
        </div>

        <div className="xfer-card">
          <div className="xfer-side__head">
            <History size={15} className="text-[#FE6C02]" />
            <h3>Recent converts</h3>
            <button
              type="button"
              onClick={() => loadHistory()}
              className="ml-auto text-[color:var(--ibo-muted)] hover:text-[#FE6C02]"
              aria-label="Refresh convert history"
            >
              <RefreshCw size={14} className={historyLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {historyLoading ? (
            <p className="text-xs text-[color:var(--ibo-muted)] py-8 text-center">Loading…</p>
          ) : history.length === 0 ? (
            <div className="xfer-empty">No converts yet. Swap Delta for USDT to get started.</div>
          ) : (
            <ul className="space-y-2 max-h-[260px] overflow-y-auto scrollbar-hide">
              {history.map((o) => (
                <li key={o.id} className="xfer-hist">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[color:var(--ibo-ink)]">{swapRouteLabel(o)}</p>
                    <p className="text-[11px] font-mono text-[color:var(--ibo-muted)] mt-0.5 truncate">
                      {fmt(o.filled ?? o.amount, 4)} · {String(o.status || '').replace('_', ' ')}
                    </p>
                  </div>
                  <span className="text-[10px] text-[color:var(--ibo-muted)] shrink-0 ml-2">{fmtDate(o.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/account/positions?tab=order-history" className="xfer-link">
            View order history <ArrowRight size={13} />
          </Link>
        </div>
      </aside>
    </div>
  );
}

// ── Between wallets: Spot ↔ Futures ─────────────────────────────────────────

function WalletTransferPanel() {
  const { balance, fetchWallet, walletLoading } = useAuth();
  const [direction, setDirection] = useState('spot_to_futures');
  const [amount, setAmount] = useState('');
  const [futAvail, setFutAvail] = useState(0);
  const [futLoading, setFutLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const spotAvail = num(balance?.USDT);

  const loadFutures = useCallback(async () => {
    setFutLoading(true);
    try {
      const w = await futuresApi.wallet();
      setFutAvail(num(w?.available ?? w?.wallet_balance));
    } catch {
      setFutAvail(0);
    } finally {
      setFutLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFutures();
  }, [loadFutures]);

  const isToFutures = direction === 'spot_to_futures';
  const max = isToFutures ? spotAvail : futAvail;
  const fromLabel = isToFutures ? 'Spot' : 'Futures';
  const toLabel = isToFutures ? 'Futures' : 'Spot';

  const setPct = (p) => {
    if (max <= 0) return;
    setAmount(fmt(max * p, 2).replace(/,/g, ''));
  };

  const flip = () => {
    setDirection((d) => (d === 'spot_to_futures' ? 'futures_to_spot' : 'spot_to_futures'));
    setErr('');
    setOk('');
  };

  const refreshAll = async () => {
    await Promise.all([fetchWallet(), loadFutures()]);
  };

  const submit = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setErr('Enter a positive USDT amount.');
      return;
    }
    if (n > max + 1e-9) {
      setErr(`Insufficient USDT in ${fromLabel}.`);
      return;
    }
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await futuresApi.transfer({ direction, asset: 'USDT', amount: n });
      setOk(`${fmt(n, 2)} USDT moved ${fromLabel} → ${toLabel}.`);
      setAmount('');
      await refreshAll();
    } catch (e) {
      setErr(friendlyError(e?.detail || e?.message) || 'Transfer failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="xfer-layout">
      <div className="xfer-main space-y-4">
        <div className="xfer-card">
          <div className="xfer-card__body space-y-1">
            <div className="xfer-wallet-toggle">
              <button
                type="button"
                onClick={() => setDirection('spot_to_futures')}
                className={`xfer-wallet-toggle__btn${isToFutures ? ' is-active' : ''}`}
              >
                Spot → Futures
              </button>
              <button
                type="button"
                onClick={() => setDirection('futures_to_spot')}
                className={`xfer-wallet-toggle__btn${!isToFutures ? ' is-active' : ''}`}
              >
                Futures → Spot
              </button>
            </div>

            <WalletLane
              label={`From ${fromLabel}`}
              asset="USDT"
              amountDp={2}
              available={max}
              onMax={() => setPct(1)}
            >
              <input
                className="xfer-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                aria-label="Transfer amount"
              />
            </WalletLane>

            <div className="xfer-flip">
              <button type="button" onClick={flip} className="xfer-flip__btn" aria-label="Flip wallets">
                <ArrowDownUp size={18} strokeWidth={2.4} />
              </button>
            </div>

            <WalletLane
              label={`To ${toLabel}`}
              asset="USDT"
              amountDp={2}
              available={isToFutures ? futAvail : spotAvail}
              muted
            >
              <span className="xfer-amount xfer-amount--out tabular-nums">
                {amount && Number(amount) > 0 ? fmt(Number(amount), 2) : '0.00'}
              </span>
            </WalletLane>

            <div className="xfer-pct">
              {PCT.map((p) => (
                <button key={p} type="button" onClick={() => setPct(p)} className="xfer-pct__btn">
                  {p === 1 ? 'MAX' : `${p * 100}%`}
                </button>
              ))}
            </div>
          </div>

          {err ? (
            <div className="xfer-alert xfer-alert--err">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{err}</span>
            </div>
          ) : null}
          {ok ? (
            <div className="xfer-alert xfer-alert--ok">
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              <span>{ok}</span>
            </div>
          ) : null}

          <div className="xfer-card__foot">
            <button
              type="button"
              disabled={busy || !amount || Number(amount) <= 0 || Number(amount) > max}
              onClick={submit}
              className="xfer-submit"
            >
              {busy ? 'Transferring…' : `Transfer to ${toLabel}`}
            </button>
          </div>
        </div>

        <p className="xfer-note">
          <Info size={13} className="shrink-0 mt-0.5 opacity-70" />
          Internal USDT moves between Spot and Futures are free and instant. Funds in Futures can only
          be used as margin for perpetual trading.
        </p>
      </div>

      <aside className="xfer-side space-y-4">
        <div className="xfer-card">
          <div className="xfer-side__head">
            <Wallet size={15} className="text-[#FE6C02]" />
            <h3>Wallet balances</h3>
            <button
              type="button"
              onClick={() => refreshAll()}
              disabled={walletLoading || futLoading}
              className="ml-auto text-[color:var(--ibo-muted)] hover:text-[#FE6C02] disabled:opacity-40"
              aria-label="Refresh wallets"
            >
              <RefreshCw size={14} className={walletLoading || futLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="space-y-2.5">
            <div className={`xfer-wallet-card${isToFutures ? ' is-source' : ' is-dest'}`}>
              <span className="xfer-wallet-card__tag">Spot</span>
              <p className="xfer-wallet-card__value font-mono tabular-nums">{fmt(spotAvail, 2)} <span>USDT</span></p>
              <p className="xfer-wallet-card__hint">Trading &amp; convert balance</p>
            </div>
            <div className={`xfer-wallet-card${!isToFutures ? ' is-source' : ' is-dest'}`}>
              <span className="xfer-wallet-card__tag">Futures</span>
              <p className="xfer-wallet-card__value font-mono tabular-nums">
                {futLoading ? '…' : fmt(futAvail, 2)} <span>USDT</span>
              </p>
              <p className="xfer-wallet-card__hint">Available margin</p>
            </div>
          </div>
        </div>

        <div className="xfer-card">
          <div className="xfer-side__head">
            <Info size={15} className="text-[#FE6C02]" />
            <h3>How it works</h3>
          </div>
          <ul className="xfer-steps">
            <li>Choose Spot → Futures to fund perpetual margin.</li>
            <li>Choose Futures → Spot to unlock USDT for convert or withdraw.</li>
            <li>Only available (unlocked) USDT can be transferred.</li>
          </ul>
          <Link to="/futures/BTCUSDT-PERP" className="xfer-link">
            Open futures trade <ArrowRight size={13} />
          </Link>
        </div>
      </aside>
    </div>
  );
}

// ── Hub shell ───────────────────────────────────────────────────────────────

export default function IboSwapPanel() {
  const [mode, setMode] = useState('convert');

  return (
    <div className="xfer-hub font-ui w-full">
      <div className="xfer-hub__intro">
        <p className="xfer-hub__lead">
          Move value instantly — convert Delta to USDT, or shift USDT between Spot and Futures.
        </p>
      </div>

      <ModeTabs mode={mode} onChange={setMode} />

      <div className="mt-5 sm:mt-6">
        {mode === 'convert' ? <ConvertPanel /> : <WalletTransferPanel />}
      </div>
    </div>
  );
}
