import { useState, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { authFetch } from '@/context/AuthContext';
import { exchangeApiOrigin } from '@/lib/apiBase';
import { MIN_BASE_AMOUNT, MIN_CLOSE_ORDER_VALUE_USDT } from '@/lib/tradeRules';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

async function parseApiError(res) {
  try {
    const j = await res.json();
    if (typeof j.detail === 'string') return j.detail;
    if (Array.isArray(j.detail)) {
      return j.detail.map(e => (typeof e === 'string' ? e : e.msg || JSON.stringify(e))).join('; ');
    }
    return res.statusText || 'Request failed';
  } catch {
    return res.statusText || 'Request failed';
  }
}

export default function ClosePositionModal({ position, onDismiss, onSuccess }) {
  const [orderType, setOrderType] = useState('market');
  const [sizeMode, setSizeMode] = useState('full');
  const [fraction, setFraction] = useState(1);
  const [amountStr, setAmountStr] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const available = Number(position?.available ?? 0);
  const locked = Number(position?.locked ?? 0);
  const totalAmt = Number(position?.amount ?? 0);

  useEffect(() => {
    setOrderType('market');
    setSizeMode('full');
    setFraction(1);
    setAmountStr('');
    setLimitPrice(position?.current_price ? String(position.current_price) : '');
    setError(null);
  }, [position]);

  if (!position) return null;

  const markPx = Number(position?.current_price ?? 0);

  const buildBody = () => {
    const sym = String(position.symbol || '').replace(/\//g, '').toUpperCase();
    if (!sym) throw new Error('Missing trading pair');
    const ot = orderType;
    const body = { symbol: sym, order_type: ot };
    if (ot === 'limit') {
      const p = parseFloat(limitPrice);
      if (!Number.isFinite(p) || p <= 0) throw new Error('Enter a valid limit price');
      body.price = p;
    }
    if (sizeMode === 'full') {
      if (available < MIN_BASE_AMOUNT) {
        throw new Error(`Nothing to sell: need at least ${MIN_BASE_AMOUNT} available (excluding coins locked in open orders).`);
      }
      const refPx = ot === 'limit' ? parseFloat(limitPrice) : markPx;
      if (Number.isFinite(refPx) && refPx > 0 && available * refPx < MIN_CLOSE_ORDER_VALUE_USDT) {
        throw new Error(
          `Sell size is below minimum order value ($${MIN_CLOSE_ORDER_VALUE_USDT.toFixed(2)} USDT).`,
        );
      }
      return body;
    }
    if (sizeMode === 'fraction') {
      const f = Number(fraction);
      if (!Number.isFinite(f) || f <= 0 || f > 1) throw new Error('Fraction must be between 0 and 1');
      body.fraction = f;
      const estBase = available * f;
      if (estBase < MIN_BASE_AMOUNT) {
        throw new Error(`Resulting size must be at least ${MIN_BASE_AMOUNT} (try a larger fraction).`);
      }
      const refPx = ot === 'limit' ? parseFloat(limitPrice) : markPx;
      if (Number.isFinite(refPx) && refPx > 0 && estBase * refPx < MIN_CLOSE_ORDER_VALUE_USDT) {
        throw new Error(
          `Order value would be below $${MIN_CLOSE_ORDER_VALUE_USDT.toFixed(2)} USDT. Increase the fraction or wait for a better price.`,
        );
      }
      return body;
    }
    const amt = parseFloat(amountStr);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter a valid amount');
    if (amt < MIN_BASE_AMOUNT) throw new Error(`Minimum amount is ${MIN_BASE_AMOUNT}.`);
    const useAmt = Math.min(amt, available);
    const refPx = ot === 'limit' ? parseFloat(limitPrice) : markPx;
    if (Number.isFinite(refPx) && refPx > 0 && useAmt * refPx < MIN_CLOSE_ORDER_VALUE_USDT) {
      throw new Error(
        `Order value is below $${MIN_CLOSE_ORDER_VALUE_USDT.toFixed(2)} USDT. Enter a larger amount.`,
      );
    }
    body.amount = useAmt;
    return body;
  };

  const submit = async () => {
    setError(null);
    let body;
    try {
      body = buildBody();
    } catch (e) {
      setError(e.message);
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(`${API}/api/portfolio/close_position`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await parseApiError(res));
        return;
      }
      onDismiss();
      try {
        await onSuccess?.();
      } catch {
        /* refresh failed — position still closed server-side */
      }
    } catch (e) {
      setError(e.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-pos-title"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[color:var(--ibo-border-solid)] shadow-2xl overflow-hidden"
        style={{ background: 'var(--ibo-card)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--ibo-border-solid)]">
          <h2 id="close-pos-title" className="text-lg font-extrabold text-[color:var(--ibo-ink)]">
            Sell {position.asset}
          </h2>
          <button
            type="button"
            onClick={onDismiss}
            className="p-2 rounded-lg text-[color:var(--ibo-ink-secondary)] hover:text-[color:var(--ibo-ink)] hover:bg-[color:var(--ibo-hover)] transition-colors"
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 text-sm">
          <div className="flex justify-between gap-4 text-[color:var(--ibo-ink-secondary)]">
            <span>Total balance</span>
            <span className="font-mono font-bold text-[color:var(--ibo-ink)]">
              {totalAmt.toLocaleString(undefined, { maximumFractionDigits: 8 })} {position.asset}
            </span>
          </div>
          <div className="flex justify-between gap-4 text-[color:var(--ibo-ink-secondary)]">
            <span>Available to sell</span>
            <span className="font-mono font-bold text-[color:var(--ibo-ink)]">
              {available.toLocaleString(undefined, { maximumFractionDigits: 8 })} {position.asset}
            </span>
          </div>
          {locked > 1e-8 && (
            <div
              className="flex gap-2 items-start rounded-xl px-3 py-2.5 text-[#5BB8FF]/95"
              style={{ background: 'rgba(14,164,171,0.12)', border: '1px solid rgba(14,164,171,0.25)' }}
            >
              <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
              <span>
                {locked.toLocaleString(undefined, { maximumFractionDigits: 8 })} {position.asset} is locked in open
                orders. Cancel those orders first to sell the rest.
              </span>
            </div>
          )}

          <div>
            <span className="text-[11px] font-extrabold text-[color:var(--ibo-muted)] uppercase tracking-widest">Order type</span>
            <div className="flex gap-2 mt-2">
              {['market', 'limit'].map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setOrderType(t)}
                  className={`flex-1 py-2.5 rounded-xl font-bold capitalize transition-colors ${
                    orderType === t
                      ? 'bg-[rgba(91,184,255,0.15)] text-[#5BB8FF] border border-[rgba(91,184,255,0.4)]'
                      : 'bg-white/[.04] text-white border border-transparent hover:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {orderType === 'limit' && (
            <div>
              <label className="text-[11px] font-extrabold text-[color:var(--ibo-muted)] uppercase tracking-widest">Limit price (USDT)</label>
              <input
                type="text"
                inputMode="decimal"
                value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
                className="mt-1.5 w-full rounded-xl bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] px-4 py-3 font-mono text-[color:var(--ibo-ink)] focus:outline-none focus:border-[rgba(91,184,255,0.55)]"
                placeholder="0.00"
              />
            </div>
          )}

          <div>
            <span className="text-[11px] font-extrabold text-[color:var(--ibo-muted)] uppercase tracking-widest">Size</span>
            <div className="flex flex-wrap gap-2 mt-2">
              {[
                { id: 'full', label: '100%' },
                { id: 'fraction', label: 'Partial %' },
                { id: 'amount', label: 'Amount' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSizeMode(id)}
                  className={`px-3 py-2 rounded-lg text-xs font-extrabold uppercase tracking-wide ${
                    sizeMode === id
                      ? 'bg-[rgba(91,184,255,0.15)] text-[#5BB8FF] border border-[rgba(91,184,255,0.35)]'
                      : 'bg-white/[.04] text-white border border-transparent hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {sizeMode === 'fraction' && (
              <div className="flex flex-wrap gap-2 mt-3">
                {[0.25, 0.5, 0.75, 1].map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFraction(f)}
                    className={`px-3 py-2 rounded-lg text-xs font-bold ${
                      fraction === f ? 'bg-green-500/20 text-green-400' : 'bg-white/[.04] text-white'
                    }`}
                  >
                    {f * 100}%
                  </button>
                ))}
              </div>
            )}
            {sizeMode === 'amount' && (
              <input
                type="text"
                inputMode="decimal"
                value={amountStr}
                onChange={e => setAmountStr(e.target.value)}
                className="mt-2 w-full rounded-xl bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] px-4 py-3 font-mono text-[color:var(--ibo-ink)] focus:outline-none focus:border-[rgba(91,184,255,0.55)]"
                placeholder={`Max ${available}`}
              />
            )}
          </div>

          {error && (
            <p className="text-red-400 text-sm font-semibold leading-snug" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated)]">
          <button
            type="button"
            onClick={onDismiss}
            className="flex-1 py-3 rounded-xl font-bold text-[color:var(--ibo-ink)] bg-[color:var(--ibo-hover)] hover:brightness-95 transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || available < 1e-8}
            className="flex-1 py-3 rounded-xl font-extrabold text-surface-dark bg-logo-gradient hover:opacity-95 disabled:opacity-40 transition-opacity"
            title={available < 1e-8 ? `No ${position.asset} available to sell — cancel open sell orders to free up locked balance.` : undefined}
          >
            {submitting ? 'Submitting…' : orderType === 'market' ? 'Sell now' : 'Place limit sell'}
          </button>
        </div>
      </div>
    </div>
  );
}
