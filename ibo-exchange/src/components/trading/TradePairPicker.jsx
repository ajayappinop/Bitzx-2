import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ChevronDown, Globe, Search, Loader2, X } from 'lucide-react';
import { PAIRS, coinIconUrl, marketApi, parsePairFromApiSymbol } from '@/services/marketApi';

const ACCENT = '#0ea4ab';
const LIME = '#C5E35B';

const USDT_PAIRS = PAIRS.filter((p) => p.quote === 'USDT');
const STATIC_IBO_PAIRS = PAIRS.filter((p) => p.quote === 'IBO');

function normalizeListedUsdtPair(m) {
  if (!m?.symbol) return null;
  const sym = String(m.symbol).toUpperCase();
  const base = (m.base || sym.replace(/USDT$/, '')).toUpperCase();
  return {
    symbol: sym,
    base,
    quote: 'USDT',
    logo_url: m.logo_url,
    token_name: m.token_name,
    project_name: m.project_name,
    source: 'listed',
  };
}

function normalizeIboMarket(m) {
  if (!m?.symbol) return null;
  const sym = String(m.symbol).toUpperCase();
  const { base } = parsePairFromApiSymbol(sym);
  return {
    symbol: sym,
    base,
    quote: 'IBO',
    logo_url: m.logo_url,
    token_name: m.token_name,
    project_name: m.project_name,
  };
}

function filterPairs(pairs, q) {
  const needle = (q || '').trim().toUpperCase();
  if (!needle) return pairs;
  return pairs.filter((p) => {
    const sym = p.symbol.toUpperCase();
    const b = (p.base || '').toUpperCase();
    return sym.includes(needle) || b.includes(needle) || `${b}/${p.quote}`.includes(needle);
  });
}

function PairRow({ pr, active, onPick }) {
  const b = pr.base;
  const q = pr.symbol;
  const iconSrc = coinIconUrl(b, pr.logo_url);
  const isIbo = pr.quote === 'IBO';
  const isActive = q === active;
  const accent = isIbo ? LIME : ACCENT;

  return (
    <button
      type="button"
      onClick={() => onPick(q)}
      className={`w-full flex items-center gap-3 px-3 py-2 border-0 cursor-pointer transition-colors text-left
        ${isActive ? '' : 'hover:bg-[color:var(--ibo-elevated)]'}`}
      style={{
        background: isActive ? (isIbo ? 'rgba(197,227,91,0.12)' : 'rgba(14,164,171,0.12)') : 'transparent',
        color: isActive ? accent : 'var(--ibo-ink)',
      }}
    >
      {iconSrc ? (
        <img src={iconSrc} alt={b} className="w-6 h-6 rounded-full shrink-0 object-cover" loading="lazy" />
      ) : (
        <div
          className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold"
          style={{ background: 'var(--ibo-elevated)', color: 'var(--ibo-muted)' }}
        >
          {b.slice(0, 2)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[13px] truncate">
          {b}/{pr.quote}
        </div>
        <div className="text-[10px] truncate text-[color:var(--ibo-muted)]">
          {isIbo ? 'IBO market' : 'Spot'}
        </div>
      </div>
      {isActive ? (
        <span
          className="text-[9px] font-bold rounded px-1.5 py-0.5 shrink-0 uppercase tracking-wide"
          style={{ background: isIbo ? 'rgba(197,227,91,0.18)' : 'rgba(14,164,171,0.18)', color: accent }}
        >
          Active
        </span>
      ) : null}
    </button>
  );
}

/**
 * Searchable spot pair selector — themed for light/dark trade terminal.
 */
export default function TradePairPicker({ symbol, onSelect, displayBase, apiQuote, icon, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [allIbo, setAllIbo] = useState([]);
  const [listedUsdt, setListedUsdt] = useState([]);
  const [iboLoading, setIboLoading] = useState(false);

  const btnRef = useRef(null);
  const searchRef = useRef(null);

  const activeSym = String(symbol || '').toUpperCase();
  const { base: activeBase, quote: activeQuote } = parsePairFromApiSymbol(activeSym);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(query.trim()), 280);
    return () => window.clearTimeout(t);
  }, [query]);

  const loadListedUsdt = useCallback(() => {
    marketApi
      .getMarkets()
      .then((markets) => {
        const staticSyms = new Set(USDT_PAIRS.map((p) => p.symbol));
        const extra = (markets || [])
          .filter((m) => m?.symbol?.endsWith('USDT') && (m.is_listed || m.source === 'listed'))
          .map(normalizeListedUsdtPair)
          .filter((p) => p && !staticSyms.has(p.symbol));
        setListedUsdt(extra);
      })
      .catch(() => setListedUsdt([]));
  }, []);

  const loadAllIbo = useCallback(() => {
    setIboLoading(true);
    marketApi
      .fetchAllIboMarkets()
      .then((markets) => {
        const staticSyms = new Set(STATIC_IBO_PAIRS.map((p) => p.symbol));
        const extra = (markets || [])
          .map(normalizeIboMarket)
          .filter((p) => p && !staticSyms.has(p.symbol));
        setAllIbo(extra);
      })
      .catch(() => setAllIbo([]))
      .finally(() => setIboLoading(false));
  }, []);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    loadListedUsdt();
    loadAllIbo();
    window.setTimeout(() => searchRef.current?.focus(), 80);
  }, [open, loadAllIbo, loadListedUsdt]);

  useEffect(() => {
    loadListedUsdt();
  }, [loadListedUsdt]);

  const openPicker = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const mobile = window.innerWidth < 768;
      if (mobile) {
        setPos({ mobile: true });
      } else {
        const w = Math.min(340, window.innerWidth - 24);
        setPos({
          mobile: false,
          top: r.bottom + 4,
          left: Math.max(12, Math.min(r.left, window.innerWidth - w - 12)),
          width: w,
        });
      }
    }
    setOpen((v) => !v);
    if (!open) {
      setQuery('');
      setDebouncedQ('');
      setTab('all');
    }
  };

  const close = () => {
    setOpen(false);
    setQuery('');
    setDebouncedQ('');
  };

  const pick = (sym) => {
    onSelect(sym);
    close();
  };

  const usdtPairs = useMemo(() => {
    const seen = new Set(USDT_PAIRS.map((p) => p.symbol));
    const merged = [...USDT_PAIRS];
    for (const p of listedUsdt) {
      if (p?.symbol && !seen.has(p.symbol)) {
        seen.add(p.symbol);
        merged.push(p);
      }
    }
    if (activeQuote === 'USDT' && activeSym && !seen.has(activeSym)) {
      merged.unshift({ symbol: activeSym, base: activeBase, quote: 'USDT' });
    }
    return merged;
  }, [listedUsdt, activeSym, activeBase, activeQuote]);

  const usdtFiltered = useMemo(() => filterPairs(usdtPairs, debouncedQ), [usdtPairs, debouncedQ]);

  const iboList = useMemo(() => {
    const seen = new Set(STATIC_IBO_PAIRS.map((p) => p.symbol));
    const merged = [...STATIC_IBO_PAIRS];
    for (const p of allIbo) {
      if (p && !seen.has(p.symbol)) {
        seen.add(p.symbol);
        merged.push(p);
      }
    }
    if (activeQuote === 'IBO' && !seen.has(activeSym)) {
      merged.unshift({ symbol: activeSym, base: activeBase, quote: 'IBO' });
    }
    return filterPairs(merged, debouncedQ);
  }, [debouncedQ, allIbo, activeSym, activeBase, activeQuote]);

  const showUsdt = tab === 'all' || tab === 'usdt';
  const showIbo = tab === 'all' || tab === 'ibo';
  const empty =
    (showUsdt ? usdtFiltered.length : 0) + (showIbo ? iboList.length : 0) === 0;

  const panel = open && pos && (
    <>
      <div
        className="fixed inset-0 z-[9998] bg-black/40 md:bg-black/20"
        onClick={close}
        aria-hidden
      />
      <div
        className={`fixed z-[9999] flex flex-col overflow-hidden
          bg-[color:var(--ibo-card)] border border-[color:var(--ibo-border-solid)]
          shadow-[var(--ibo-shadow)] text-[color:var(--ibo-ink)]
          ${pos.mobile
            ? 'left-2 right-2 bottom-2 rounded-xl max-h-[min(78dvh,640px)]'
            : 'rounded-lg max-h-[min(70vh,520px)]'
          }`}
        style={
          pos.mobile
            ? undefined
            : { top: pos.top, left: pos.left, width: pos.width }
        }
        role="dialog"
        aria-label="Select trading pair"
      >
        <div className="shrink-0 p-2.5 border-b border-[color:var(--ibo-border)] space-y-2">
          <div className="flex items-center gap-2">
            <div
              className="flex-1 flex items-center gap-2 h-9 rounded-md px-2.5
                bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)]
                focus-within:border-[#0ea4ab]/50"
            >
              <Search size={14} className="text-[color:var(--ibo-muted)] shrink-0" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pair (e.g. BTC)"
                className="flex-1 min-w-0 bg-transparent text-[13px] outline-none
                  text-[color:var(--ibo-ink)] placeholder:text-[color:var(--ibo-muted)]"
                autoComplete="off"
                enterKeyHint="search"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] p-0.5"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={close}
              className="md:hidden shrink-0 h-9 w-9 rounded-md border border-[color:var(--ibo-border-solid)]
                text-[color:var(--ibo-muted)] flex items-center justify-center"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex gap-1">
            {[
              ['all', 'All'],
              ['usdt', 'USDT'],
              ['ibo', 'IBO'],
            ].map(([id, label]) => {
              const on = tab === id;
              const ibo = id === 'ibo';
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className="flex-1 h-7 text-[11px] font-semibold rounded-md border transition-colors"
                  style={
                    on
                      ? {
                          background: ibo ? 'rgba(197,227,91,0.15)' : 'rgba(14,164,171,0.15)',
                          borderColor: ibo ? 'rgba(197,227,91,0.4)' : 'rgba(14,164,171,0.4)',
                          color: ibo ? LIME : ACCENT,
                        }
                      : {
                          background: 'transparent',
                          borderColor: 'var(--ibo-border-solid)',
                          color: 'var(--ibo-muted)',
                        }
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          {iboLoading && showIbo ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-[color:var(--ibo-muted)]">
              <Loader2 size={16} className="animate-spin" /> Loading markets…
            </div>
          ) : null}

          {!iboLoading && empty ? (
            <p className="text-center text-[13px] text-[color:var(--ibo-muted)] py-10 px-4">
              No pairs match &ldquo;{debouncedQ}&rdquo;.
            </p>
          ) : null}

          {showUsdt && usdtFiltered.length > 0 ? (
            <section>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ibo-muted)]">
                USDT pairs
              </div>
              {usdtFiltered.map((pr) => (
                <PairRow key={pr.symbol} pr={pr} active={activeSym} onPick={pick} />
              ))}
            </section>
          ) : null}

          {showIbo && iboList.length > 0 ? (
            <section className={showUsdt && usdtFiltered.length ? 'border-t border-[color:var(--ibo-border)]' : ''}>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: LIME }}>
                IBO pairs ({iboList.length})
              </div>
              {iboList.map((pr) => (
                <PairRow key={pr.symbol} pr={pr} active={activeSym} onPick={pick} />
              ))}
            </section>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-[color:var(--ibo-border)] flex">
          <Link
            to="/markets"
            onClick={close}
            className="flex-1 flex items-center gap-2 px-3 py-2.5 text-[12px] font-medium
              text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] hover:bg-[color:var(--ibo-elevated)] no-underline"
          >
            <Globe size={14} /> Spot markets
          </Link>
          <Link
            to="/ibo-markets"
            onClick={close}
            className="flex-1 flex items-center gap-2 px-3 py-2.5 text-[12px] font-medium no-underline
              border-l border-[color:var(--ibo-border)] hover:bg-[color:var(--ibo-elevated)]"
            style={{ color: LIME }}
          >
            <Globe size={14} /> IBO markets
          </Link>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div ref={btnRef} className="relative shrink-0 max-w-[min(100%,200px)] sm:max-w-none">
        <button
          type="button"
          onClick={openPicker}
          className="ibo-chip flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-[7px] rounded-md
            bg-[color:var(--ibo-card)] cursor-pointer transition-[border-color] w-full sm:w-auto min-w-0
            border border-[color:var(--ibo-border-solid)] hover:border-[#0ea4ab]/40"
          style={{
            borderColor: open ? 'rgba(14,164,171,0.5)' : undefined,
          }}
        >
          {icon ? (
            <img src={icon} alt={displayBase} className="w-5 h-5 sm:w-6 sm:h-6 rounded-full shrink-0" />
          ) : null}
          <span className="text-sm sm:text-[14px] font-bold text-[color:var(--ibo-ink)] truncate shrink-0">
            {displayBase}
            <span
              className="text-xs sm:text-[12px] font-semibold"
              style={{ color: apiQuote === 'IBO' ? LIME : 'var(--ibo-muted)' }}
            >
              /{apiQuote}
            </span>
          </span>
          <ChevronDown
            size={13}
            className="shrink-0 ml-auto sm:ml-0 text-[color:var(--ibo-muted)] transition-transform"
            style={{ transform: open ? 'rotate(180deg)' : 'none' }}
          />
        </button>
      </div>
      {panel && createPortal(panel, document.body)}
    </>
  );
}
