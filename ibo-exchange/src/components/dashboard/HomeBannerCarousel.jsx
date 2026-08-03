/**
 * Admin-managed promo banner carousel.
 * - Full-width, CSS-transition slides (not scroll-based)
 * - Auto-advances every `auto_scroll_seconds` seconds
 * - Works as full-page-width ad on /dashboard and / (landing)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchHomeBanners, bannerImageUrl } from '@/services/homeBannersApi';

function handleBannerCta(navigate, banner) {
  const action = String(banner.cta_action || 'none').toLowerCase();
  const url = String(banner.cta_url || '').trim();
  switch (action) {
    case 'markets':      navigate('/markets'); break;
    case 'trade':        navigate('/trade/IBOUSDT'); break;
    case 'wallet':       navigate('/wallet'); break;
    case 'wallet_swap':  navigate('/wallet?tab=swap'); break;
    case 'futures':      navigate('/futures/BTCUSDT'); break;
    case 'external':
      if (url.startsWith('http')) window.open(url, '_blank', 'noopener,noreferrer');
      break;
    default: break;
  }
}

function BannerSlide({ banner, active, onActivate }) {
  const img = bannerImageUrl(banner.image_url);
  const start = banner.gradient_start || '#1a1408';
  const end   = banner.gradient_end   || '#4a3820';
  const op    = banner.overlay_opacity ?? 0.55;

  return (
    <button
      type="button"
      aria-label={banner.title || 'Promo banner'}
      onClick={() => onActivate(banner)}
      className="group absolute inset-0 w-full h-full text-left cursor-pointer"
      style={{
        opacity:    active ? 1 : 0,
        transition: 'opacity 0.65s ease',
        pointerEvents: active ? 'auto' : 'none',
      }}
    >
      {/* background */}
      {img ? (
        <img
          src={img}
          alt=""
          className="absolute inset-0 h-full w-full object-cover select-none"
          draggable={false}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(115deg, ${start} 0%, ${end} 100%)` }}
        />
      )}
      {/* overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(105deg,
            rgba(8,9,12,${op}) 0%,
            rgba(8,9,12,${op * 0.7}) 40%,
            rgba(8,9,12,0.15) 100%)`,
        }}
      />
      {/* text */}
      <div className="relative z-10 flex h-full flex-col justify-center px-6 sm:px-10 md:px-14 lg:px-20 max-w-3xl">
        {banner.badge ? (
          <span className="mb-3 inline-flex w-fit rounded-md border border-gold/40 bg-gold/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-gold-light">
            {banner.badge}
          </span>
        ) : null}
        {banner.title ? (
          <h3 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white leading-tight drop-shadow-lg">
            {banner.title}
          </h3>
        ) : null}
        {banner.subtitle ? (
          <p className="mt-2 text-sm sm:text-base text-white/80 line-clamp-2 max-w-lg">
            {banner.subtitle}
          </p>
        ) : null}
        {banner.cta_label ? (
          <span className="mt-5 inline-flex w-fit items-center gap-2 rounded-xl bg-logo-gradient px-5 py-2.5 text-sm font-bold text-surface-dark shadow-lg shadow-gold/25 group-hover:opacity-90 transition-opacity">
            {banner.cta_label}
            <ArrowRight size={16} />
          </span>
        ) : null}
      </div>
    </button>
  );
}

/**
 * Full-width banner carousel.
 * Props:
 *   height    — CSS height string, default '280px'
 *   className — extra wrapper classes
 */
export default function HomeBannerCarousel({ className = '', height = '280px' }) {
  const navigate = useNavigate();
  const [payload,  setPayload]  = useState(null);
  const [index,    setIndex]    = useState(0);
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setPayload(await fetchHomeBanners());
    } catch {
      setPayload({ enabled: false, auto_scroll_seconds: 5, banners: [] });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const banners     = payload?.enabled ? (payload.banners ?? []) : [];
  const intervalSec = Math.max(3, payload?.auto_scroll_seconds ?? 5);

  const goTo = useCallback((i) => {
    setIndex((i + banners.length) % banners.length);
  }, [banners.length]);

  /* auto-advance */
  useEffect(() => {
    if (banners.length < 2) return undefined;
    timerRef.current = setInterval(() => goTo(index + 1), intervalSec * 1000);
    return () => clearInterval(timerRef.current);
  }, [banners.length, index, intervalSec, goTo]);

  if (!banners.length) return null;

  return (
    <div className={`relative w-full overflow-hidden rounded-2xl border border-gold/20 shadow-xl shadow-black/30 ${className}`} style={{ height }}>
      {/* slides */}
      {banners.map((b, i) => (
        <BannerSlide
          key={b.id}
          banner={b}
          active={i === index}
          onActivate={(bn) => handleBannerCta(navigate, bn)}
        />
      ))}

      {/* prev / next arrows — only when multiple slides */}
      {banners.length > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous"
            onClick={() => goTo(index - 1)}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 border border-white/15 text-white hover:bg-black/65 transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={() => goTo(index + 1)}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 border border-white/15 text-white hover:bg-black/65 transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </>
      ) : null}

      {/* dot indicators */}
      {banners.length > 1 ? (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5">
          {banners.map((b, i) => (
            <button
              key={b.id}
              type="button"
              aria-label={`Slide ${i + 1}`}
              onClick={() => goTo(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === index ? 'w-7 bg-gold' : 'w-1.5 bg-white/40 hover:bg-white/70'
              }`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Landing page version — edge-to-edge (no border-radius on sides) */
export function LandingHomeBanners() {
  const navigate = useNavigate();
  const [payload,  setPayload]  = useState(null);
  const [index,    setIndex]    = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    fetchHomeBanners()
      .then(setPayload)
      .catch(() => setPayload({ enabled: false, banners: [] }));
  }, []);

  const banners     = payload?.enabled ? (payload.banners ?? []) : [];
  const intervalSec = Math.max(3, payload?.auto_scroll_seconds ?? 5);

  const goTo = useCallback((i) => {
    setIndex(((i % banners.length) + banners.length) % banners.length);
  }, [banners.length]);

  useEffect(() => {
    if (banners.length < 2) return undefined;
    timerRef.current = setInterval(() => setIndex((p) => (p + 1) % banners.length), intervalSec * 1000);
    return () => clearInterval(timerRef.current);
  }, [banners.length, intervalSec]);

  if (!banners.length) return null;

  return (
    <section className="relative z-[3] w-full">
      {/* full-bleed banner, fixed 340px tall on landing */}
      <div className="relative w-full overflow-hidden" style={{ height: '340px' }}>
        {banners.map((b, i) => (
          <BannerSlide
            key={b.id}
            banner={b}
            active={i === index}
            onActivate={(bn) => handleBannerCta(navigate, bn)}
          />
        ))}

        {banners.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous"
              onClick={() => goTo(index - 1)}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 border border-white/15 text-white hover:bg-black/65 transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={() => goTo(index + 1)}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 border border-white/15 text-white hover:bg-black/65 transition-colors"
            >
              <ChevronRight size={20} />
            </button>
          </>
        ) : null}

        {banners.length > 1 ? (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                aria-label={`Slide ${i + 1}`}
                onClick={() => goTo(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === index ? 'w-7 bg-gold' : 'w-1.5 bg-white/40 hover:bg-white/70'
                }`}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
