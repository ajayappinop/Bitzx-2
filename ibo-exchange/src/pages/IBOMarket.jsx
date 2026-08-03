import { useMemo, useState } from 'react';
import IBOChart from '@/components/IBOChart/IBOChart';
import OrderBook from '@/components/trading/OrderBook';
import IBOTicker from '@/components/IBOTicker/IBOTicker';
import TradeForm from '@/components/trading/TradeForm';
import { useIBOMarket } from '@/hooks/useIBOMarket';
import { displayBaseForApiSymbol } from '@/services/marketApi';

const SYMBOLS = ['IBOUSDT', 'BTCIBO', 'ETHIBO', 'SOLIBO'];

function baseFromSymbol(symbol) {
  if (symbol.endsWith('USDT')) return symbol.slice(0, -4);
  if (symbol.endsWith('IBO')) return symbol.slice(0, -3);
  return symbol;
}

export default function IBOMarket({ initialSymbol = 'IBOUSDT', embedded = false }) {
  const [symbol, setSymbol] = useState(
    SYMBOLS.includes(String(initialSymbol).toUpperCase()) ? String(initialSymbol).toUpperCase() : 'IBOUSDT',
  );
  const [interval, setInterval] = useState('1m');
  const { candles, orderbook, trades, ticker, connected, loading, error } = useIBOMarket({ symbol, interval });
  const base = useMemo(() => baseFromSymbol(symbol), [symbol]);
  
  const displayBase = displayBaseForApiSymbol(symbol);
  const livePrice = ticker?.price ?? null;

  return (
    <div className="bg-[color:var(--ibo-bg)] min-h-screen flex flex-col h-screen overflow-hidden text-[color:var(--ibo-ink)] font-ui">
      <div className="px-4 py-3 border-b border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-surface)] flex items-center gap-2 flex-wrap shrink-0">
        {SYMBOLS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSymbol(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
              s === symbol
                ? 'text-[#5BB8FF] border-[rgba(91,184,255,0.5)] bg-[rgba(91,184,255,0.1)]'
                : 'text-[color:var(--ibo-muted)] border-[color:var(--ibo-border-solid)] hover:text-[color:var(--ibo-ink)]'
            }`}
          >
            {s.replace('USDT', '/USDT').replace('IBO', '/IBO')}
          </button>
        ))}
        {error && <span className="ml-2 text-xs font-bold text-red-400">{error}</span>}
        <span className={`ml-auto text-xs font-bold ${connected ? 'text-green-500' : 'text-red-400'}`}>
          {connected ? 'LIVE' : 'DISCONNECTED'}
        </span>
      </div>

      <div className="shrink-0">
        <IBOTicker ticker={ticker} />
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 border-r border-[color:var(--ibo-border-solid)] relative">
          <IBOChart candles={candles} interval={interval} onIntervalChange={setInterval} fill loading={loading} />
        </div>

        <div className="flex flex-col w-[340px] shrink-0 border-r border-[color:var(--ibo-border-solid)] overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden">
            <OrderBook
              symbol={symbol}
              baseAsset={displayBase}
              lastPrice={livePrice}
              bookOverride={orderbook}
            />
          </div>
        </div>

        <div className="w-[420px] shrink-0 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            <TradeForm symbol={symbol} lastPrice={livePrice} />
          </div>
          {!embedded && (
            <div className="px-4 py-3 text-xs text-[color:var(--ibo-muted)] border-t border-[color:var(--ibo-border-solid)] shrink-0 bg-[color:var(--ibo-surface)]">
              Trading form executes through existing engine. This page only replaces IBO market visualization.
              {base ? ` Pair base: ${base}` : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
