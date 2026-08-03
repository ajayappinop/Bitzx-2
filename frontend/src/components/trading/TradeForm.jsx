import { useState } from 'react';
import { Info } from 'lucide-react';

const SLIPPAGE_OPTS = ['0.1', '0.5', '1.0', 'Custom'];

export default function TradeForm({ symbol, currentPrice, onOrderPlaced }) {
  const base  = symbol.replace('USDT', '');

  const [side,      setSide]      = useState('buy');   // 'buy' | 'sell'
  const [orderType, setOrderType] = useState('limit'); // 'limit' | 'market'
  const [price,     setPrice]     = useState(currentPrice || '');
  const [amount,    setAmount]    = useState('');
  const [slippage,  setSlippage]  = useState('0.5');
  const [placing,   setPlacing]   = useState(false);
  const [lastOrder, setLastOrder] = useState(null);

  const isBuy  = side === 'buy';
  const isMarket = orderType === 'market';

  const effectivePrice = isMarket
    ? parseFloat(currentPrice || 0)
    : parseFloat(price || 0);

  const total = (effectivePrice * parseFloat(amount || 0)).toFixed(4);

  const handleSubmit = e => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;
    if (!isMarket && (!price || parseFloat(price) <= 0)) return;

    setPlacing(true);
    // Simulate order placement latency
    setTimeout(() => {
      const order = {
        id:       Date.now(),
        symbol,
        side,
        type:     orderType,
        price:    isMarket ? currentPrice : price,
        amount,
        total,
        status:   'open',
        time:     new Date().toISOString(),
      };
      setLastOrder(order);
      onOrderPlaced?.(order);
      setAmount('');
      if (!isMarket) setPrice('');
      setPlacing(false);
    }, 600);
  };

  return (
    <div className="flex flex-col h-full bg-surface-elevated">
      {/* Buy / Sell tabs */}
      <div className="flex flex-shrink-0 border-b border-line">
        {['buy', 'sell'].map(s => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`flex-1 py-2.5 text-sm font-bold capitalize transition-colors ${
              side === s
                ? s === 'buy'
                  ? 'bg-green-500/10 text-green-400 border-b-2 border-green-400'
                  : 'bg-red-500/10 text-red-400 border-b-2 border-red-400'
                : 'text-[#4A4B50] hover:text-ink-muted'
            }`}
          >
            {s === 'buy' ? `Buy ${base}` : `Sell ${base}`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {/* Order type */}
        <div className="flex gap-1 bg-surface-card rounded-lg p-1">
          {['limit', 'market'].map(t => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              className={`flex-1 py-1 text-xs capitalize rounded-md font-semibold transition-colors ${
                orderType === t
                  ? 'bg-[#1a2748] text-ink'
                  : 'text-[#4A4B50] hover:text-ink-muted'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Price (hidden for market) */}
          {!isMarket && (
            <div>
              <label className="block text-[10px] text-[#4A4B50] mb-1 uppercase tracking-wider">Price (USDT)</label>
              <div className="flex items-center bg-surface-card border border-line rounded-lg px-3 py-2 focus-within:border-[#0EA4AB]">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  placeholder={currentPrice || '0.0000'}
                  className="flex-1 bg-transparent text-sm text-ink outline-none font-mono"
                />
                <span className="text-xs text-[#4A4B50]">USDT</span>
              </div>
            </div>
          )}

          {isMarket && (
            <div className="bg-surface-card border border-line rounded-lg px-3 py-2 text-xs text-ink-muted flex justify-between">
              <span>Market Price</span>
              <span className="text-ink font-mono">{currentPrice || '—'}</span>
            </div>
          )}

          {/* Amount */}
          <div>
            <label className="block text-[10px] text-[#4A4B50] mb-1 uppercase tracking-wider">
              Amount ({base})
            </label>
            <div className="flex items-center bg-surface-card border border-line rounded-lg px-3 py-2 focus-within:border-[#0EA4AB]">
              <input
                type="number"
                step="any"
                min="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 bg-transparent text-sm text-ink outline-none font-mono"
              />
              <span className="text-xs text-[#4A4B50]">{base}</span>
            </div>
          </div>

          {/* Total */}
          <div className="flex items-center justify-between bg-surface-card border border-line rounded-lg px-3 py-2">
            <span className="text-xs text-[#4A4B50]">Total</span>
            <span className="text-sm text-ink font-mono">{total} USDT</span>
          </div>

          {/* Slippage (market only) */}
          {isMarket && (
            <div>
              <label className="block text-[10px] text-[#4A4B50] mb-1 flex items-center gap-1 uppercase tracking-wider">
                Slippage <Info size={10} />
              </label>
              <div className="flex gap-1">
                {SLIPPAGE_OPTS.slice(0, 3).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSlippage(s)}
                    className={`flex-1 py-1 text-[10px] rounded transition-colors ${
                      slippage === s
                        ? 'bg-[#0EA4AB]/30 text-ink-accent border border-[#0EA4AB]/50'
                        : 'bg-[#1a2748] text-ink-muted'
                    }`}
                  >
                    {s}%
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={placing || !amount}
            className={`w-full py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 ${
              isBuy
                ? 'bg-green-500 hover:bg-green-400 text-ink'
                : 'bg-red-500 hover:bg-red-400 text-ink'
            }`}
          >
            {placing
              ? 'Placing order…'
              : isBuy
                ? `Buy ${base}`
                : `Sell ${base}`}
          </button>
        </form>

        {/* Last order confirmation */}
        {lastOrder && (
          <div className="bg-surface-card border border-green-500/20 rounded-lg p-3 text-xs space-y-1">
            <p className="text-green-400 font-semibold">Order placed ✓</p>
            <div className="flex justify-between text-ink-muted">
              <span>{lastOrder.side.toUpperCase()} {lastOrder.type}</span>
              <span>{lastOrder.amount} {base} @ {lastOrder.price}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
