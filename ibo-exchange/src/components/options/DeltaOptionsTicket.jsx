/**
 * Options order ticket — same visual language as spot TradeForm / futures form
 * (side toggle, orange type tabs, bordered field boxes, side-tinted CTA).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Plus } from 'lucide-react';

function fmt(n, d = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

function optTypeLabel(contract) {
  const t = String(contract?.option_type || '').toLowerCase();
  if (t === 'put') return 'Put';
  if (t === 'call') return 'Call';
  return 'Option';
}

export default function DeltaOptionsTicket({
  selected,
  underlying = 'BTCUSDT',
  referenceIndex: _referenceIndex = null,
  side,
  setSide,
  price,
  setPrice,
  qty,
  setQty,
  wallet,
  user,
  kyc,
  busy,
  usingDemoChain,
  onSubmit,
  onBestOffer,
  orderType = 'limit',
  setOrderType,
  makerOnly = false,
  setMakerOnly,
  reduceOnly = false,
  setReduceOnly,
  tif = 'GTC',
  setTif,
  bracketOn = false,
  setBracketOn,
  takeProfit = '',
  setTakeProfit,
  stopLoss = '',
  setStopLoss,
  stopTrigger = '',
  setStopTrigger,
}) {
  const [localType, setLocalType] = useState(orderType);
  const [localMaker, setLocalMaker] = useState(makerOnly);
  const [localReduce, setLocalReduce] = useState(reduceOnly);
  const [localTif, setLocalTif] = useState(tif);
  const [localBracket, setLocalBracket] = useState(bracketOn);
  const [localTp, setLocalTp] = useState(takeProfit);
  const [localSl, setLocalSl] = useState(stopLoss);
  const [localStop, setLocalStop] = useState(stopTrigger);

  const ot = setOrderType ? orderType : localType;
  const setOt = setOrderType || setLocalType;
  const maker = setMakerOnly ? makerOnly : localMaker;
  const setMaker = setMakerOnly || setLocalMaker;
  const reduce = setReduceOnly ? reduceOnly : localReduce;
  const setReduce = setReduceOnly || setLocalReduce;
  const timeInForce = setTif ? tif : localTif;
  const setTimeInForce = setTif || setLocalTif;
  const bracket = setBracketOn ? bracketOn : localBracket;
  const setBracket = setBracketOn || setLocalBracket;
  const tp = setTakeProfit ? takeProfit : localTp;
  const setTp = setTakeProfit || setLocalTp;
  const sl = setStopLoss ? stopLoss : localSl;
  const setSl = setStopLoss || setLocalSl;
  const stopPx = setStopTrigger ? stopTrigger : localStop;
  const setStopPx = setStopTrigger || setLocalStop;

  const isBuy = side === 'buy';
  const m = selected?.market || {};
  const base = String(selected?.underlying_symbol || underlying || '')
    .replace(/USDT$/i, '')
    .toUpperCase() || 'BTC';
  const kind = optTypeLabel(selected);
  const lot = Number(selected?.lot_size) || 0.001;
  const px = parseFloat(price) || 0;
  const q = parseFloat(qty) || 0;
  const funds = px > 0 && q > 0 ? px * q : 0;
  const avail = wallet?.available != null ? Number(wallet.available) : null;

  const fieldBox =
    'delta-opt-ticket__field flex items-center rounded border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated,#fafbfc)] px-3 h-10 focus-within:border-[#FE6C02]/55 transition-colors';
  const fieldInput =
    'flex-1 min-w-0 bg-transparent text-[13px] font-mono font-semibold outline-none text-[color:var(--ibo-ink)] placeholder:text-[color:var(--ibo-muted)] tabular-nums';
  const fieldUnit = 'ml-2 shrink-0 text-[12px] font-bold text-[color:var(--ibo-muted)]';
  const fieldLabel = 'block text-[11px] font-semibold text-[color:var(--ibo-muted)] mb-1';

  if (!user) {
    return (
      <div className="delta-opt-ticket delta-opt-ticket--guest flex flex-col h-full min-h-0 relative overflow-hidden">
        <div className="delta-opt-guest-bg" aria-hidden>
          <div className="delta-opt-guest-bg__row">
            <span>Leverage</span>
            <span className="delta-opt-guest-bg__chip">1x</span>
          </div>
          <div className="delta-opt-guest-bg__tabs">
            <span className="is-on">Limit</span>
            <span>Market</span>
            <span>Stop Limit</span>
          </div>
          <div className="delta-opt-guest-bg__field">
            <span>Price</span>
            <b>0.00</b>
          </div>
          <div className="delta-opt-guest-bg__field">
            <span>Quantity</span>
            <b>0.00</b>
          </div>
          <div className="delta-opt-guest-bg__btn" />
        </div>
        <div className="delta-opt-guest relative z-[1] flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
          <p className="delta-opt-guest__title">
            Want to get started? Create an account in just a few seconds.
          </p>
          <Link to="/register" className="delta-opt-guest__signup">
            Sign Up
          </Link>
          <div className="delta-opt-guest__or">OR</div>
          <Link to="/login" className="delta-opt-guest__login">
            Log In
          </Link>
          <Link to="/options/BTCUSDT" className="delta-opt-guest__demo">
            Try Demo Trading
            <span aria-hidden>↗</span>
          </Link>
        </div>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="delta-opt-ticket flex flex-col h-full min-h-0">
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <p className="text-[13px] font-medium" style={{ color: 'var(--ibo-muted)' }}>
            Select a Call or Put on the chain to trade
          </p>
        </div>
      </div>
    );
  }

  const ctaLabel = usingDemoChain
    ? 'Submit unavailable'
    : kyc?.status !== 'approved'
      ? 'Get Verified To Trade'
      : isBuy
        ? `Buy ${kind}`
        : `Sell ${kind}`;

  const typeTabs = [
    { id: 'limit', label: 'Limit' },
    { id: 'market', label: 'Market' },
    { id: 'stop_limit', label: 'Stop Limit' },
  ];

  const submitDisabled =
    busy
    || (Boolean(user) && (usingDemoChain || kyc?.status !== 'approved'));

  return (
    <div className="delta-opt-ticket font-ui flex flex-col h-full min-h-0 text-[color:var(--ibo-ink)] bg-transparent overflow-hidden">
      {/* Buy / Sell — same segmented control as spot TradeForm */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 shrink-0">
        <div className="flex flex-1 overflow-hidden rounded border border-[color:var(--ibo-border-solid)]">
          {['buy', 'sell'].map((s) => {
            const on = side === s;
            const buy = s === 'buy';
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`flex-1 py-2 text-[13px] font-bold transition-colors ${
                  on
                    ? buy
                      ? 'bg-[color:var(--ibo-positive)]/15 text-[color:var(--ibo-positive)] border-b-2 border-[color:var(--ibo-positive)]'
                      : 'bg-[color:var(--ibo-negative)]/15 text-[color:var(--ibo-negative)] border-b-2 border-[color:var(--ibo-negative)]'
                    : 'bg-transparent text-[color:var(--ibo-muted)] hover:bg-[rgba(254,108,2,0.08)] hover:text-[#FE6C02]'
                }`}
              >
                {buy ? `Buy ${kind}` : `Sell ${kind}`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Limit / Market / Stop — orange underline tabs */}
      <div className="flex items-center gap-0 px-3 border-b border-[color:var(--ibo-border)] shrink-0">
        {typeTabs.map((t) => {
          const on = ot === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setOt(t.id)}
              className="relative px-2.5 py-2 text-[12px] font-semibold transition-colors whitespace-nowrap"
              style={{ color: on ? '#FE6C02' : 'var(--ibo-muted)' }}
            >
              {t.label}
              {on ? (
                <span className="absolute left-1.5 right-1.5 bottom-0 h-0.5 rounded-full bg-[#FE6C02]" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3 scrollbar-hide">
        <p className="text-[11px] text-[color:var(--ibo-muted)] leading-relaxed">
          {ot === 'market'
            ? `Fills at the best available ${kind.toLowerCase()} prices. Size is in lots (${lot} ${base}).`
            : ot === 'stop_limit'
              ? 'Stop triggers the limit once the market reaches your stop price.'
              : 'Limit rests on the book until the market reaches your price.'}
        </p>

        {/* Available margin — wallet row like TradeForm */}
        <div className="flex items-center justify-between gap-2 text-[12px]">
          <span className="flex items-center gap-1.5 font-medium text-[color:var(--ibo-muted)]">
            <Wallet size={13} className="shrink-0" aria-hidden /> Available
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono font-bold text-[13px] tabular-nums text-[color:var(--ibo-ink)]">
              {avail != null ? `${fmt(avail, 2)} USD` : '—'}
            </span>
            <Link
              to="/wallet?tab=deposit"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#FE6C02]/35 bg-[#FE6C02]/10 text-[#FE6C02] hover:bg-[#FE6C02]/20 transition-colors"
              title="Deposit"
              aria-label="Deposit"
            >
              <Plus size={16} strokeWidth={2.5} className="shrink-0" aria-hidden />
            </Link>
          </div>
        </div>

        {ot === 'stop_limit' ? (
          <div>
            <label className={fieldLabel}>Stop trigger</label>
            <div className={fieldBox}>
              <input
                type="text"
                inputMode="decimal"
                value={stopPx}
                onChange={(e) => setStopPx(e.target.value)}
                className={fieldInput}
                placeholder="0.00"
                aria-label="Stop trigger USD"
              />
              <span className={fieldUnit}>USD</span>
            </div>
          </div>
        ) : null}

        {ot !== 'market' ? (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={fieldLabel + ' mb-0'}>Limit price</label>
              <button
                type="button"
                onClick={onBestOffer}
                className="text-[11px] font-semibold text-[#FE6C02] hover:underline"
              >
                Best Offer
              </button>
            </div>
            <p className="text-[10px] text-[color:var(--ibo-muted)] mb-1.5 leading-relaxed">
              USD per 1 lot
            </p>
            <div className={fieldBox}>
              <input
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={fieldInput}
                placeholder="0.00"
                aria-label="Limit price USD"
              />
              <span className={fieldUnit}>USD</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded border border-[color:var(--ibo-border-solid)] bg-transparent px-3 py-2.5">
            <span className="text-[11px] text-[color:var(--ibo-muted)]">Mark / last</span>
            <span className="text-[13px] font-mono font-bold tabular-nums text-[#FE6C02]">
              {m.mid ?? m.mark_price ?? m.last_price != null
                ? `$${fmt(m.mid ?? m.mark_price ?? m.last_price, 2)}`
                : '—'}
            </span>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={fieldLabel + ' mb-0'}>Quantity</label>
            <span className="text-[10px] text-[color:var(--ibo-muted)]">
              1 lot = {lot} {base}
            </span>
          </div>
          <div className={fieldBox}>
            <input
              type="text"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={fieldInput}
              placeholder="0"
              aria-label="Quantity lots"
            />
            <span className={fieldUnit}>Lots</span>
          </div>
          <div className="mt-2 flex gap-1">
            {[10, 25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => {
                  const availN = Number(wallet?.available) || 0;
                  const p = parseFloat(price) || Number(m.best_ask) || Number(m.mid) || 0;
                  if (!(p > 0) || !(availN > 0)) return;
                  const notional = availN * (pct / 100);
                  const contracts = Math.max(lot, Math.floor(notional / p / lot) * lot);
                  setQty(String(Number(contracts.toFixed(6))));
                }}
                className="flex-1 h-7 rounded border border-[color:var(--ibo-border-solid)] text-[10px] font-bold text-[color:var(--ibo-ink-secondary)] hover:border-[#FE6C02]/40 hover:text-[#FE6C02] hover:bg-[rgba(254,108,2,0.06)] transition-colors"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Bracket */}
        <div className="rounded border border-[color:var(--ibo-border-solid)] px-2.5 py-2 space-y-2 bg-[color:var(--ibo-elevated,#fafbfc)]">
          <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none font-medium text-[color:var(--ibo-ink)]">
            <input
              type="checkbox"
              checked={bracket}
              onChange={(e) => setBracket(e.target.checked)}
              className="rounded border-[color:var(--ibo-border-solid)] accent-[#FE6C02]"
            />
            <span>Bracket order</span>
            <span className="ml-auto text-[11px] font-semibold text-[#FE6C02]">
              {bracket ? 'TP / SL on' : '+ Add TP/SL'}
            </span>
          </label>
          {bracket ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={fieldLabel}>Take profit</label>
                <div className={fieldBox + ' h-9'}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={tp}
                    onChange={(e) => setTp(e.target.value)}
                    className={fieldInput + ' text-[12px]'}
                    placeholder="TP"
                  />
                </div>
              </div>
              <div>
                <label className={fieldLabel}>Stop loss</label>
                <div className={fieldBox + ' h-9'}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={sl}
                    onChange={(e) => setSl(e.target.value)}
                    className={fieldInput + ' text-[12px]'}
                    placeholder="SL"
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-start justify-between gap-3 text-[11px] leading-snug py-0.5">
          <span className="text-[color:var(--ibo-muted)]">
            Funds req.
            <br />
            <b className="text-[13px] font-mono font-bold tabular-nums text-[color:var(--ibo-ink)]">
              {fmt(funds, 2)} USD
            </b>
          </span>
          <span className="text-right text-[color:var(--ibo-muted)]">
            Available margin
            <br />
            <b className="text-[13px] font-mono font-bold tabular-nums text-[color:var(--ibo-ink)]">
              {avail != null ? `${fmt(avail, 2)} USD` : '—'}
            </b>
          </span>
        </div>

        <button
          type="button"
          disabled={submitDisabled}
          onClick={() => {
            if (!user) {
              window.location.href = '/login';
              return;
            }
            if (usingDemoChain || kyc?.status !== 'approved') return;
            onSubmit?.({
              orderType: ot,
              makerOnly: maker,
              reduceOnly: reduce || side === 'sell',
              tif: timeInForce,
              bracket: bracket
                ? { take_profit: tp || null, stop_loss: sl || null }
                : null,
              stopTrigger: ot === 'stop_limit' ? stopPx : null,
            });
          }}
          className={`w-full h-11 rounded font-bold text-[14px] transition-colors disabled:opacity-45 ${
            submitDisabled
              ? 'bg-[#FE6C02] text-white opacity-45'
              : isBuy
                ? 'bg-[color:var(--ibo-positive,#26a69a)] text-white hover:brightness-110'
                : 'bg-[color:var(--ibo-negative,#d14b4b)] text-white hover:brightness-110'
          }`}
        >
          {busy ? 'Submitting…' : ctaLabel}
        </button>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5 text-[11px] text-[color:var(--ibo-muted)]">
          <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium hover:text-[color:var(--ibo-ink)]">
            <input
              type="checkbox"
              checked={maker}
              onChange={(e) => {
                setMaker(e.target.checked);
                if (e.target.checked) setOt('limit');
              }}
              className="rounded accent-[#FE6C02]"
            />
            Maker only
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium hover:text-[color:var(--ibo-ink)]">
            <input
              type="checkbox"
              checked={reduce || side === 'sell'}
              onChange={(e) => setReduce(e.target.checked)}
              className="rounded accent-[#FE6C02]"
            />
            Reduce only
          </label>
          <select
            value={timeInForce}
            onChange={(e) => setTimeInForce(e.target.value)}
            className="ml-auto rounded border border-[color:var(--ibo-border-solid)] bg-transparent px-2 py-1 text-[11px] font-semibold text-[color:var(--ibo-ink)] outline-none focus:border-[#FE6C02]/55"
            aria-label="Time in force"
          >
            <option value="GTC">GTC</option>
            <option value="IOC">IOC</option>
            <option value="FOK">FOK</option>
          </select>
        </div>
      </div>
    </div>
  );
}
