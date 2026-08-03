import { ChevronDown } from 'lucide-react';

export default function MarketsPagination({
  shown = 0,
  total = 0,
  pageSize = 50,
  onLoadMore,
  loading = false,
  className = '',
}) {
  if (total <= 0 || shown >= total) return null;
  const remaining = total - shown;
  const next = Math.min(pageSize, remaining);

  return (
    <div className={`flex flex-col sm:flex-row items-center justify-center gap-3 py-4 ${className}`}>
      <p className="text-[11px] sm:text-xs text-[color:var(--ibo-muted)] tabular-nums">
        Showing <span className="text-[color:var(--ibo-ink)] font-semibold">{shown}</span> of{' '}
        <span className="text-[color:var(--ibo-ink)] font-semibold">{total}</span> pairs
      </p>
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loading}
        className="font-ui inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[rgba(254, 157, 85,0.4)] bg-[rgba(254, 157, 85,0.1)] text-[#FE9D55] text-sm font-bold hover:bg-[rgba(254, 157, 85,0.18)] disabled:opacity-50 transition-colors"
      >
        {loading ? 'Loading…' : `Load ${next} more`}
        <ChevronDown size={16} />
      </button>
    </div>
  );
}
