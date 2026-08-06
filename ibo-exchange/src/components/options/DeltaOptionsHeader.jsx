/**
 * Delta Exchange–style options terminal header toolbar only.
 * (Chain / Chart · underlyings · expiries · tools)
 * Instrument strip lives above book+ticket — see OptionsInstrumentBar.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  RefreshCw,
} from 'lucide-react';
import OptionsColumnToggles from './OptionsColumnToggles';
import { COIN_ICONS } from '@/services/marketApi';
import { baseFromUsdt, formatExpiryTabLabel } from './deltaInstrumentUtils';

export { formatExpiryTabLabel, formatDeltaInstrumentId } from './deltaInstrumentUtils';

const UNDERLYING_ORDER = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];

function sortUnderlyings(list) {
  const mapped = (list || []).map((u) => {
    const symbol = String(u.symbol || u).toUpperCase();
    return { ...u, symbol };
  });
  return mapped.sort((a, b) => {
    const ia = UNDERLYING_ORDER.indexOf(a.symbol);
    const ib = UNDERLYING_ORDER.indexOf(b.symbol);
    if (ia === -1 && ib === -1) return a.symbol.localeCompare(b.symbol);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export default function DeltaOptionsHeader({
  optionsView,
  setOptionsView,
  underlyings = [],
  underlying,
  onSelectUnderlying,
  expiries = [],
  selectedExpiry,
  onSelectExpiry,
  cols,
  onChangeCols,
  onRefresh,
  loading,
  onStrategy,
}) {
  const ul = useMemo(() => sortUnderlyings(underlyings), [underlyings]);
  const expScrollRef = useRef(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const root = expScrollRef.current;
    if (!root || !selectedExpiry) return;
    const key = String(selectedExpiry).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const btn = root.querySelector(`[data-expiry="${key}"]`);
    if (btn && typeof btn.scrollIntoView === 'function') {
      btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [selectedExpiry, expiries]);

  const scrollExpiries = (dir) => {
    const el = expScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 160, behavior: 'smooth' });
  };

  return (
    <header className="doh doh--toolbar" aria-label="Options terminal header">
      <div className="doh__main doh__main--full">
        <div className="doh__row doh__row--top">
          <div className="doh__view-tabs" role="tablist" aria-label="Options view">
            <button
              type="button"
              role="tab"
              aria-selected={optionsView === 'chain'}
              className={`doh__view-tab ${optionsView === 'chain' ? 'is-on' : ''}`}
              onClick={() => setOptionsView('chain')}
            >
              Option Chain
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={optionsView === 'chart'}
              className={`doh__view-tab ${optionsView === 'chart' ? 'is-on' : ''}`}
              onClick={() => setOptionsView('chart')}
            >
              Chart
            </button>
          </div>

          <div className="doh__assets" role="tablist" aria-label="Underlying">
            {ul.map((u) => {
              const sym = String(u.symbol || u).toUpperCase();
              const b = baseFromUsdt(sym);
              const on = sym === String(underlying || '').toUpperCase();
              const ic = COIN_ICONS[b];
              const isNew = String(u.badge || '').toLowerCase() === 'new' || u.is_new;
              return (
                <button
                  key={sym}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={`doh__asset ${on ? 'is-on' : ''}`}
                  onClick={() => onSelectUnderlying?.(sym)}
                >
                  {ic ? <img src={ic} alt="" className="doh__asset-ic" /> : null}
                  <span>{b}</span>
                  {isNew ? <span className="doh__badge doh__badge--new">NEW</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="doh__row doh__row--exp">
          <div className="doh__expiries-wrap">
            <div className="doh__expiries" ref={expScrollRef} role="tablist" aria-label="Expiry">
              {expiries.map((ex) => {
                const on = (selectedExpiry || expiries[0]) === ex;
                return (
                  <button
                    key={ex}
                    type="button"
                    role="tab"
                    data-expiry={ex}
                    aria-selected={on}
                    className={`doh__exp ${on ? 'is-on' : ''}`}
                    onClick={() => onSelectExpiry?.(ex)}
                  >
                    {formatExpiryTabLabel(ex)}
                  </button>
                );
              })}
              {!expiries.length ? (
                <span className="doh__exp-empty">No expiries</span>
              ) : null}
            </div>
            <div className="doh__exp-nav">
              <button type="button" className="doh__icon-btn" aria-label="Previous expiries" onClick={() => scrollExpiries(-1)}>
                <ChevronLeft size={16} strokeWidth={2} />
              </button>
              <button type="button" className="doh__icon-btn" aria-label="Next expiries" onClick={() => scrollExpiries(1)}>
                <ChevronRight size={16} strokeWidth={2} />
              </button>
            </div>
          </div>

          <div className="doh__tools">
            <OptionsColumnToggles
              cols={cols}
              onChange={onChangeCols}
              variant="icon"
            />
            <div className="relative" ref={moreRef}>
              <button
                type="button"
                className={`doh__icon-btn ${moreOpen ? 'is-on' : ''}`}
                aria-label="More"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}
              >
                <MoreVertical size={16} strokeWidth={2} />
              </button>
              {moreOpen ? (
                <div className="doh__menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="doh__menu-item"
                    onClick={() => {
                      setMoreOpen(false);
                      onStrategy?.();
                    }}
                  >
                    Strategy Builder
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="doh__menu-item"
                    onClick={() => {
                      setMoreOpen(false);
                      onRefresh?.();
                    }}
                  >
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                    Refresh chain
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
