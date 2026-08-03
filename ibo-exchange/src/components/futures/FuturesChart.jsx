/**
 * FuturesChart — Delta-style chart tabs over TradingView (traded price)
 * plus simple Mark / Funding / Depth panels.
 */
import { useMemo, useState } from 'react';
import TVChart from '@/components/trading/TVChart';
import { useFutures } from '@/context/FuturesContext';

const TABS = [
  { id: 'traded', label: 'Traded Price' },
  { id: 'mark', label: 'Mark Price' },
  { id: 'funding', label: 'Funding' },
  { id: 'depth', label: 'Depth' },
];

function DepthPanel() {
  const { orderbook } = useFutures();
  const asks = (orderbook?.asks || []).slice(0, 24);
  const bids = (orderbook?.bids || []).slice(0, 24);
  const maxQ = Math.max(
    ...asks.map((l) => Number(l.qty || 0)),
    ...bids.map((l) => Number(l.qty || 0)),
    1,
  );

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden bg-[color:var(--ibo-bg)]">
      <p className="text-[12px] text-[color:var(--ibo-muted)] shrink-0">
        Live book depth — ask (top) / bid (bottom)
      </p>
      <div className="flex-1 min-h-0 grid grid-rows-2 gap-2">
        <div className="flex flex-col-reverse gap-0.5 overflow-hidden justify-end">
          {asks.map((lv, i) => {
            const q = Number(lv.qty || 0);
            const pct = Math.min(100, (q / maxQ) * 100);
            return (
              <div key={`a-${i}`} className="relative h-2.5 rounded-sm overflow-hidden bg-white/[0.03]">
                <div
                  className="absolute inset-y-0 right-0 bg-rose-500/35"
                  style={{ width: `${pct}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-0.5 overflow-hidden">
          {bids.map((lv, i) => {
            const q = Number(lv.qty || 0);
            const pct = Math.min(100, (q / maxQ) * 100);
            return (
              <div key={`b-${i}`} className="relative h-2.5 rounded-sm overflow-hidden bg-white/[0.03]">
                <div
                  className="absolute inset-y-0 left-0 bg-emerald-500/35"
                  style={{ width: `${pct}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FundingPanel({ funding }) {
  const { activeMark } = useFutures();
  const mark = Number(activeMark?.mark_price || 0);
  const idx = Number(activeMark?.index_price || 0);
  const basis = mark && idx ? ((mark - idx) / idx) * 100 : null;

  return (
    <div className="h-full flex items-center justify-center bg-[color:var(--ibo-bg)] p-8">
      <div className="w-full max-w-md space-y-4">
        <h3 className="text-[15px] font-bold text-[color:var(--ibo-ink)]">Funding</h3>
        <div className="rounded-xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] p-4 space-y-3">
          <div className="flex justify-between text-[13px]">
            <span className="text-[color:var(--ibo-muted)]">Current rate (8h)</span>
            <span className="font-mono font-semibold text-[#C5E35B]">
              {funding != null ? `${(funding * 100).toFixed(4)}%` : '—'}
            </span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-[color:var(--ibo-muted)]">Mark / Index basis</span>
            <span className="font-mono font-semibold">
              {basis == null ? '—' : `${basis >= 0 ? '+' : ''}${basis.toFixed(4)}%`}
            </span>
          </div>
          <p className="text-[11px] text-[color:var(--ibo-muted)] leading-relaxed pt-1 border-t border-[color:var(--ibo-border)]">
            Funding is exchanged between longs and shorts every 8 hours to keep the perpetual
            price anchored to the index.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function FuturesChart({ symbol, funding = null }) {
  const [tab, setTab] = useState('traded');
  const spot = useMemo(() => (symbol || '').replace(/-PERP$/i, '') || 'BTCUSDT', [symbol]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[color:var(--ibo-bg)]">
      <div className="flex items-center gap-0.5 px-2 shrink-0 border-b border-[color:var(--ibo-border)] bg-[color:var(--ibo-surface)]">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="relative px-3 py-2 text-[12px] font-semibold transition-colors"
              style={{ color: on ? '#C5E35B' : 'var(--ibo-muted)' }}
            >
              {t.label}
              {on ? (
                <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-[#C5E35B]" />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 relative">
        {(tab === 'traded' || tab === 'mark') && <TVChart symbol={spot} />}
        {tab === 'funding' && <FundingPanel funding={funding} />}
        {tab === 'depth' && <DepthPanel />}
      </div>
    </div>
  );
}
