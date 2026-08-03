function num(v, d = 4) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

export default function IBOTicker({ ticker }) {
  const flash = Number(ticker?.change24h || 0) >= 0 ? 'up' : 'down';
  const cls =
    flash === 'up'
      ? 'text-green-500 bg-green-500/10 animate-pulse'
      : flash === 'down'
        ? 'text-red-500 bg-red-500/10 animate-pulse'
        : 'text-[color:var(--ibo-ink)]';

  return (
    <div className="flex flex-wrap items-center gap-6 px-4 py-3 border-b border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-surface)]">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[color:var(--ibo-muted)] font-bold">Price</div>
        <div key={String(ticker?.price ?? '')} className={`font-mono text-2xl font-extrabold px-2 py-1 rounded ${cls}`}>${num(ticker?.price, 6)}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[color:var(--ibo-muted)] font-bold">24h Change</div>
        <div className={`font-mono text-lg font-bold ${Number(ticker?.change24h || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          {Number(ticker?.change24h || 0) >= 0 ? '+' : ''}
          {num(ticker?.change24h, 3)}%
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[color:var(--ibo-muted)] font-bold">24h Volume</div>
        <div className="font-mono text-lg text-[color:var(--ibo-ink)] font-bold">{num(ticker?.volume24h, 2)}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[color:var(--ibo-muted)] font-bold">Market Cap</div>
        <div className="font-mono text-lg text-[color:var(--ibo-ink)] font-bold">${num(ticker?.marketCap, 0)}</div>
      </div>
    </div>
  );
}
