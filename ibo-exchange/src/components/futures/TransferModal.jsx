import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useFutures } from '@/context/FuturesContext';
import { useToast, friendlyError } from '@/context/ToastContext';

export default function TransferModal({ open, onClose }) {
  const { balance } = useAuth();
  const { wallet, transfer } = useFutures();
  const toast = useToast();
  const [direction, setDirection] = useState('spot_to_futures');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  if (!open) return null;

  const spotAvail   = Number(balance?.USDT || 0);
  const futAvail    = Number(wallet?.available || 0);
  const max         = direction === 'spot_to_futures' ? spotAvail : futAvail;
  const isToFutures = direction === 'spot_to_futures';

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      await transfer({ direction, asset: 'USDT', amount: Number(amount) });
      toast.success(
        'Transfer complete',
        isToFutures
          ? `${Number(amount).toFixed(2)} USDT moved to your Futures wallet.`
          : `${Number(amount).toFixed(2)} USDT returned to your Funding wallet.`,
      );
      setAmount('');
      onClose();
    } catch (e) {
      setErr(friendlyError(e?.detail || e?.message));
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4 bg-black/60"
      style={{ backdropFilter: 'blur(4px)' }}
      onClick={onClose}
      role="presentation"
    >
      {/* Solid panel: --ibo-card is transparent inside .delta-trade */}
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 p-5 space-y-4 shadow-2xl"
        style={{ background: '#18181c' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-modal-title"
      >
        <div className="flex items-center justify-between">
          <h3 id="transfer-modal-title" className="text-base font-semibold text-[color:var(--ibo-ink)]">
            Transfer USDT
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDirection('spot_to_futures')}
            className={`py-2 rounded text-xs font-medium border ${
              direction === 'spot_to_futures'
                ? 'bg-[#FE6C02]/15 text-[#FE6C02] border-[#FE6C02]/40'
                : 'bg-white/[0.04] text-[color:var(--ibo-ink-secondary)] border-transparent hover:bg-white/[0.07]'
            }`}
          >
            Funding → Futures
          </button>
          <button
            type="button"
            onClick={() => setDirection('futures_to_spot')}
            className={`py-2 rounded text-xs font-medium border ${
              direction === 'futures_to_spot'
                ? 'bg-[#FE6C02]/15 text-[#FE6C02] border-[#FE6C02]/40'
                : 'bg-white/[0.04] text-[color:var(--ibo-ink-secondary)] border-transparent hover:bg-white/[0.07]'
            }`}
          >
            Futures → Funding
          </button>
        </div>

        <div className="text-xs text-[color:var(--ibo-muted)] flex justify-between">
          <span>Available to transfer</span>
          <span className="font-mono text-[color:var(--ibo-ink)]">{max.toFixed(2)} USDT</span>
        </div>

        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-[color:var(--ibo-muted)]">Amount (USDT)</span>
          <div className="flex gap-2 mt-1">
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 rounded-lg border border-white/10 bg-[#101013] px-3 py-2 text-sm font-mono text-[color:var(--ibo-ink)] outline-none focus:border-[#FE6C02]/50"
            />
            <button
              type="button"
              onClick={() => setAmount(String(max))}
              className="px-3 py-2 rounded bg-white/[0.06] text-[color:var(--ibo-ink-secondary)] text-xs hover:bg-white/[0.1]"
            >
              Max
            </button>
          </div>
        </label>

        {err && (
          <div className="text-xs text-[#F6465D] rounded border border-[#F6465D]/25 bg-[#F6465D]/10 px-3 py-2">
            {err}
          </div>
        )}

        <button
          type="button"
          disabled={busy || !amount || Number(amount) <= 0 || Number(amount) > max}
          onClick={submit}
          className="w-full py-2.5 rounded-lg bg-[#FE6C02] hover:bg-[#ff7a1a] text-white text-sm font-semibold disabled:opacity-40"
        >
          {busy ? 'Transferring…' : 'Transfer'}
        </button>
      </div>
    </div>
  );
}
