/**
 * Contract instrument strip — sits above Order Book + Ticket (Delta layout).
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Star } from 'lucide-react';
import {
  formatDeltaInstrumentId,
} from './deltaInstrumentUtils';

const FAV_KEY = 'ibo_options_fav_contracts';

function baseFromUsdt(sym) {
  return String(sym || '').replace(/USDT$/i, '') || String(sym || '');
}

function fmtNum(v, d = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, {
    maximumFractionDigits: d,
    minimumFractionDigits: 0,
  });
}

function fmtPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return { text: '—', tone: 'muted' };
  const sign = n > 0 ? '+' : '';
  return {
    text: `${sign}${n.toFixed(2)}%`,
    tone: n > 0 ? 'up' : n < 0 ? 'down' : 'muted',
  };
}

function fmtVol(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPx(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (n >= 100) return n.toFixed(1);
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(4);
}

function loadFavs() {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? new Set(arr.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function saveFavs(set) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function Metric({ label, value, tone }) {
  let color = 'var(--ibo-ink, #1a1d21)';
  if (tone === 'up') color = '#26a69a';
  if (tone === 'down') color = '#d14b4b';
  if (tone === 'muted') color = 'var(--ibo-muted, #8b919a)';
  return (
    <div className="doh-metric">
      <span className="doh-metric__label">{label}</span>
      <span className="doh-metric__value" style={{ color }}>{value}</span>
    </div>
  );
}

export default function OptionsInstrumentBar({
  selected,
  underlying,
  referenceIndex,
}) {
  const [favs, setFavs] = useState(() => loadFavs());
  const [greeksOpen, setGreeksOpen] = useState(false);
  const [lotOpen, setLotOpen] = useState(false);
  const greeksRef = useRef(null);
  const lotRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (greeksRef.current && !greeksRef.current.contains(e.target)) setGreeksOpen(false);
      if (lotRef.current && !lotRef.current.contains(e.target)) setLotOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const instrId = formatDeltaInstrumentId(selected, underlying);
  const isFav = selected ? favs.has(String(selected.id)) : false;
  const toggleFav = () => {
    if (!selected?.id) return;
    setFavs((prev) => {
      const next = new Set(prev);
      const id = String(selected.id);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavs(next);
      return next;
    });
  };

  const m = selected?.market || {};
  const delta = m.delta ?? selected?.delta;
  const gamma = m.gamma ?? selected?.gamma;
  const theta = m.theta ?? selected?.theta;
  const vega = m.vega ?? selected?.vega;
  const markIv = m.iv ?? selected?.iv;
  const lastPx = m.last_price ?? selected?.last_price ?? m.mid ?? m.mark_price;
  const chg = fmtPct(m.change_24h_pct ?? selected?.change_24h_pct);
  const vol = m.volume_24h ?? selected?.volume_24h;
  const lot = selected?.lot_size ?? selected?.min_qty ?? 0.001;
  const base = baseFromUsdt(underlying);
  const ivPct = (() => {
    if (markIv == null || !Number.isFinite(Number(markIv))) return '—';
    const n = Number(markIv);
    return `${(n <= 2 ? n * 100 : n).toFixed(1)}%`;
  })();
  const deltaStr = delta != null && Number.isFinite(Number(delta))
    ? Number(delta).toFixed(2)
    : '—';

  return (
    <div className={`doh__instrument doh__instrument--panel ${selected ? 'has-contract' : ''}`}>
      <div className="doh__instr-top">
        <button
          type="button"
          className={`doh__star ${isFav ? 'is-on' : ''}`}
          aria-label={isFav ? 'Unfavorite' : 'Favorite'}
          disabled={!selected}
          onClick={toggleFav}
          title={selected ? 'Favorite contract' : 'Select a contract on the chain'}
        >
          <Star size={15} fill={isFav ? 'currentColor' : 'none'} strokeWidth={2} />
        </button>

        <span className="doh__instr-id" title={selected?.id || ''}>
          {selected ? instrId : 'Select a contract'}
        </span>

        <div className="doh__instr-pills">
          <div className="relative" ref={greeksRef}>
            <button
              type="button"
              className={`doh__pill ${greeksOpen ? 'is-on' : ''}`}
              disabled={!selected}
              onClick={() => setGreeksOpen((v) => !v)}
            >
              <span className="doh__pill-k">Delta</span>
              <span className="doh__pill-v tabular-nums">{selected ? deltaStr : '—'}</span>
              <ChevronDown size={13} className="doh__pill-chev" />
            </button>
            {greeksOpen && selected ? (
              <div className="doh__menu doh__menu--greeks" role="menu">
                <div className="doh__g-row"><span>Delta</span><b>{deltaStr}</b></div>
                <div className="doh__g-row"><span>Gamma</span><b>{gamma != null && Number.isFinite(Number(gamma)) ? Number(gamma).toFixed(5) : '—'}</b></div>
                <div className="doh__g-row"><span>Theta</span><b>{theta != null && Number.isFinite(Number(theta)) ? Number(theta).toFixed(4) : '—'}</b></div>
                <div className="doh__g-row"><span>Vega</span><b>{vega != null && Number.isFinite(Number(vega)) ? Number(vega).toFixed(4) : '—'}</b></div>
              </div>
            ) : null}
          </div>

          <div className="relative" ref={lotRef}>
            <button
              type="button"
              className={`doh__pill ${lotOpen ? 'is-on' : ''}`}
              disabled={!selected}
              onClick={() => setLotOpen((v) => !v)}
            >
              <span className="doh__pill-k">Lot Size</span>
              <span className="doh__pill-v tabular-nums">
                {selected ? `${fmtNum(lot, 4)} ${base}` : '—'}
              </span>
              <ChevronDown size={13} className="doh__pill-chev" />
            </button>
            {lotOpen && selected ? (
              <div className="doh__menu" role="menu">
                <div className="doh__menu-note">
                  Contract lot size from the series spec. Orders are submitted in lots of{' '}
                  <b>{fmtNum(lot, 4)} {base}</b>.
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="doh__instr-metrics">
        <Metric label="24h Change" value={selected ? chg.text : '—'} tone={selected ? chg.tone : 'muted'} />
        <Metric
          label="Price"
          value={selected ? (lastPx != null ? `$${fmtPx(lastPx)}` : '—') : '—'}
          tone={selected && lastPx != null ? 'up' : 'muted'}
        />
        <Metric
          label="Index Price"
          value={referenceIndex != null ? fmtNum(referenceIndex, 0) : '—'}
        />
        <Metric label="Mark IV" value={selected ? ivPct : '—'} />
        <Metric label="24h Vol." value={selected ? fmtVol(vol) : '—'} />
      </div>
    </div>
  );
}
