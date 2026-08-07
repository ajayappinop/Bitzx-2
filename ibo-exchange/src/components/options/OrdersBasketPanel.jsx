/**
 * Delta-style Orders Basket — right rail for Strategy Builder.
 * Visual language matches DeltaOptionsTicket (orange accent, field boxes, Buy/Sell chips).
 */
import { Link } from 'react-router-dom';
import { Trash2, X } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDeltaInstrumentId } from './deltaInstrumentUtils';
import {
  buildPayoffSeries,
  estimateBasketMargin,
  netGreeks,
  payoffStats,
} from '@/lib/optionsStrategy';

function fmt(n, d = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

function fmtSigned(n, d = 4) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
}

function PayoffMini({ legs, indexPx }) {
  const { maxProfit, maxLoss, breakevens } = payoffStats(legs, indexPx);
  const data = buildPayoffSeries(legs, indexPx, { points: 61, rangePct: 0.15 });

  if (!legs?.length) {
    return (
      <div className="flex h-36 items-center justify-center text-[12px] text-[color:var(--ibo-muted)]">
        Add legs to preview payoff
      </div>
    );
  }

  return (
    <div>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="basketPnl" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#26a69a" stopOpacity={0.35} />
                <stop offset="55%" stopColor="#fe6c02" stopOpacity={0.06} />
                <stop offset="100%" stopColor="#d14b4b" stopOpacity={0.28} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--ibo-border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="spot"
              tick={{ fill: 'var(--ibo-muted)', fontSize: 10 }}
              tickFormatter={(v) => fmt(v, 0)}
              axisLine={{ stroke: 'var(--ibo-border)' }}
            />
            <YAxis
              width={44}
              tick={{ fill: 'var(--ibo-muted)', fontSize: 10 }}
              tickFormatter={(v) => fmt(v, 1)}
              axisLine={{ stroke: 'var(--ibo-border)' }}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--ibo-surface, #fff)',
                border: '1px solid var(--ibo-border)',
                borderRadius: 6,
                fontSize: 11,
              }}
              labelFormatter={(v) => `Spot ${fmt(v, 2)}`}
              formatter={(v) => [fmtSigned(v, 4), 'P&L']}
            />
            {indexPx > 0 && (
              <ReferenceLine x={indexPx} stroke="#8b919a" strokeDasharray="4 3" />
            )}
            <ReferenceLine y={0} stroke="#c5c9ce" />
            <Area
              type="monotone"
              dataKey="pnl"
              stroke="#1a1d21"
              strokeWidth={1.4}
              fill="url(#basketPnl)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px]">
        <div className="rounded border border-[color:var(--ibo-border)] bg-[color:var(--ibo-elevated,#fafbfc)] px-1.5 py-1">
          <div className="text-[color:var(--ibo-muted)]">Max profit</div>
          <div className="font-bold text-[#26a69a] tabular-nums">{fmtSigned(maxProfit, 2)}</div>
        </div>
        <div className="rounded border border-[color:var(--ibo-border)] bg-[color:var(--ibo-elevated,#fafbfc)] px-1.5 py-1">
          <div className="text-[color:var(--ibo-muted)]">Max loss</div>
          <div className="font-bold text-[#d14b4b] tabular-nums">{fmtSigned(maxLoss, 2)}</div>
        </div>
        <div className="rounded border border-[color:var(--ibo-border)] bg-[color:var(--ibo-elevated,#fafbfc)] px-1.5 py-1">
          <div className="text-[color:var(--ibo-muted)]">Breakeven</div>
          <div className="truncate font-bold text-[color:var(--ibo-ink)] tabular-nums">
            {breakevens.length ? breakevens.map((b) => fmt(b, 0)).join(', ') : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OrdersBasketPanel({
  legs = [],
  underlying = 'BTCUSDT',
  indexPx = 0,
  orderType = 'limit',
  setOrderType,
  onUpdateLeg,
  onRemoveLeg,
  onClear,
  onPlace,
  placing = false,
  user = null,
  templates = [],
  templateId = 'custom',
  onTemplate,
}) {
  const greeks = netGreeks(legs);
  const margin = estimateBasketMargin(legs);
  const fieldBox =
    'flex items-center rounded border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated,#fafbfc)] px-2 h-8 focus-within:border-[#FE6C02]/55';

  return (
    <div className="delta-opt-ticket flex h-full min-h-0 flex-col overflow-hidden bg-[color:var(--ibo-surface,#fff)] text-[color:var(--ibo-ink)]">
      {/* Templates */}
      {templates?.length ? (
        <div className="shrink-0 border-b border-[color:var(--ibo-border)] px-3 py-2">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--ibo-muted)]">
            Strategies
          </div>
          <div className="flex flex-wrap gap-1">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.hint}
                onClick={() => onTemplate?.(t.id)}
                className={`rounded px-2 py-1 text-[11px] font-semibold transition ${
                  templateId === t.id
                    ? 'bg-[#fe6c02]/12 text-[#fe6c02] ring-1 ring-[#fe6c02]/35'
                    : 'bg-[color:var(--ibo-elevated,#fafbfc)] text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Order type */}
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="flex overflow-hidden rounded border border-[color:var(--ibo-border-solid)]">
          {['limit', 'market'].map((ot) => (
            <button
              key={ot}
              type="button"
              onClick={() => setOrderType?.(ot)}
              className={`flex-1 py-2 text-[12px] font-extrabold capitalize ${
                orderType === ot
                  ? 'bg-[#fe6c02] text-white'
                  : 'bg-transparent text-[color:var(--ibo-muted)] hover:bg-[color:var(--ibo-hover)]'
              }`}
            >
              {ot}
            </button>
          ))}
        </div>
      </div>

      {/* Legs */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold text-[color:var(--ibo-muted)]">
            Basket ({legs.length})
          </span>
          <button
            type="button"
            disabled={!legs.length}
            onClick={onClear}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--ibo-muted)] hover:text-[#d14b4b] disabled:opacity-40"
          >
            <Trash2 size={12} /> Clear
          </button>
        </div>

        {!legs.length ? (
          <div className="rounded-lg border border-dashed border-[color:var(--ibo-border-solid)] px-3 py-8 text-center text-[12px] text-[color:var(--ibo-muted)]">
            Click Bid / Ask or Mark on the chain to add Buy / Sell legs
          </div>
        ) : (
          <ul className="space-y-2">
            {legs.map((leg) => {
              const buy = String(leg.side).toLowerCase() === 'buy';
              return (
                <li
                  key={leg.id}
                  className="rounded-lg border border-[color:var(--ibo-border)] bg-[color:var(--ibo-elevated,#fafbfc)] p-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 font-mono text-[11px] font-bold text-[color:var(--ibo-ink)]">
                      {formatDeltaInstrumentId(leg.contract, underlying)}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveLeg?.(leg.id)}
                      className="shrink-0 text-[color:var(--ibo-muted)] hover:text-[#d14b4b]"
                      aria-label="Remove"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateLeg?.(leg.id, { side: buy ? 'sell' : 'buy' })
                      }
                      className={`rounded px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                        buy ? 'bg-[#26a69a] text-white' : 'bg-[#d14b4b] text-white'
                      }`}
                    >
                      {buy ? 'Buy' : 'Sell'}
                    </button>
                    <div className={`${fieldBox} w-[72px]`}>
                      <input
                        type="number"
                        min={1}
                        value={leg.qty}
                        onChange={(e) =>
                          onUpdateLeg?.(leg.id, {
                            qty: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                        className="w-full bg-transparent px-1 text-[12px] font-mono font-semibold outline-none tabular-nums"
                      />
                    </div>
                    <span className="text-[10px] text-[color:var(--ibo-muted)]">@</span>
                    <div className={`${fieldBox} w-[88px]`}>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={orderType === 'market'}
                        value={leg.premium ?? ''}
                        onChange={(e) =>
                          onUpdateLeg?.(leg.id, { premium: Number(e.target.value) })
                        }
                        className="w-full bg-transparent px-1 text-[12px] font-mono font-semibold outline-none tabular-nums disabled:opacity-50"
                      />
                      <span className="pr-1 text-[10px] font-bold text-[color:var(--ibo-muted)]">$</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Summary + CTA */}
      <div className="shrink-0 border-t border-[color:var(--ibo-border)] px-3 py-3">
        <div className="mb-2 grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <div className="text-[color:var(--ibo-muted)]">Net premium</div>
            <div
              className={`font-extrabold tabular-nums ${
                greeks.debit >= 0 ? 'text-[#d14b4b]' : 'text-[#26a69a]'
              }`}
            >
              {fmtSigned(greeks.debit, 2)}{' '}
              <span className="font-semibold text-[color:var(--ibo-muted)]">
                {greeks.debit >= 0 ? 'Debit' : 'Credit'}
              </span>
            </div>
          </div>
          <div>
            <div className="text-[color:var(--ibo-muted)]">Total order margin</div>
            <div className="font-extrabold tabular-nums text-[color:var(--ibo-ink)]">
              {fmt(margin, 2)} USDT
            </div>
          </div>
          <div>
            <div className="text-[color:var(--ibo-muted)]">Δ / Γ</div>
            <div className="font-bold tabular-nums">
              {fmtSigned(greeks.delta, 3)} / {fmtSigned(greeks.gamma, 4)}
            </div>
          </div>
          <div>
            <div className="text-[color:var(--ibo-muted)]">Θ / ν</div>
            <div className="font-bold tabular-nums">
              {fmtSigned(greeks.theta, 3)} / {fmtSigned(greeks.vega, 3)}
            </div>
          </div>
        </div>

        {!user ? (
          <div className="space-y-2 text-center">
            <Link
              to="/login"
              className="flex w-full items-center justify-center rounded bg-[#fe6c02] py-2.5 text-[13px] font-extrabold text-white hover:bg-[#e86100]"
            >
              Log In to Place Order
            </Link>
          </div>
        ) : (
          <button
            type="button"
            disabled={!legs.length || placing}
            onClick={onPlace}
            className="w-full rounded bg-[#fe6c02] py-2.5 text-[13px] font-extrabold text-white hover:bg-[#e86100] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {placing ? 'Placing…' : `Place Order${legs.length ? ` (${legs.length})` : ''}`}
          </button>
        )}
      </div>

      {/* Payoff */}
      <div className="shrink-0 border-t border-[color:var(--ibo-border)] px-3 py-2.5">
        <div className="mb-1 text-[11px] font-extrabold text-[color:var(--ibo-ink)]">
          Payoff at expiry
        </div>
        <PayoffMini legs={legs} indexPx={indexPx} />
      </div>
    </div>
  );
}
