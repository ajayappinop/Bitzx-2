/**
 * Why IBO stacked cards — sticky pin + scroll-scrubbed stack.
 * Uses CSS sticky inside [data-ibo-scroll-root] (more reliable than manual fixed).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '@/context/ThemeContext';

const PEEK_Y = 22;
const SCALE_STEP = 0.015;
const EXIT_LIFT = 110;
const CARD_RADIUS = '1.55rem';
const PANEL_H = 480;
const STEP_PX = 420;
const STICKY_TOP = 88;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function getScrollRoot(node) {
  const marked = node?.closest?.('[data-ibo-scroll-root]');
  if (marked) return marked;
  let el = node?.parentElement;
  while (el && el !== document.body) {
    const oy = window.getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 1) {
      return el;
    }
    el = el.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function cardPose(rel, depth, isLight = false) {
  if (rel <= -1.1 || rel >= depth + 0.08) return null;

  if (rel >= 0) {
    return {
      y: -PEEK_Y * rel,
      scale: 1 - SCALE_STEP * rel,
      opacity: 1,
      z: Math.round(40 - rel * 3),
      shadow: isLight
        ? rel < 0.2
          ? '0 18px 44px rgba(12,25,34,0.1)'
          : `0 ${12 - rel}px ${28 - rel * 2}px rgba(12,25,34,${0.08 - rel * 0.02})`
        : rel < 0.2
          ? '0 28px 80px rgba(0,0,0,0.55)'
          : `0 ${16 - rel * 2}px ${40 - rel * 3}px rgba(0,0,0,${0.38 - rel * 0.05})`,
    };
  }

  const t = Math.min(1, -rel);
  return {
    y: -Math.sin(Math.PI * t) * EXIT_LIFT - PEEK_Y * Math.max(0, depth - 1) * t * 0.35,
    scale: 1 - 0.035 * t,
    opacity: 1 - 0.22 * t,
    z: Math.round(55 - t * 50),
    shadow: isLight
      ? `0 ${18 - t * 8}px ${40 - t * 14}px rgba(12,25,34,${0.1 - t * 0.05})`
      : `0 ${30 - t * 10}px ${80 - t * 24}px rgba(0,0,0,${0.55 - t * 0.25})`,
  };
}

function FeatureCardArt({ src, fit = 'default', glow }) {
  const sizeClass =
    fit === 'wide'
      ? 'w-full max-w-[480px] h-auto max-h-[360px]'
      : fit === 'tall'
        ? 'w-auto max-w-[min(100%,380px)] h-auto max-h-[min(100%,420px)] sm:max-h-[440px]'
        : fit === 'square'
          ? 'w-[min(100%,340px)] h-auto max-h-[320px]'
          : 'w-[min(100%,420px)] h-auto max-h-[360px]';

  const bloom = glow || 'rgba(14,164,171,0.45)';

  return (
    <div className="relative z-[2] flex h-full w-full min-h-0 items-center justify-center overflow-hidden p-3 sm:p-4">
      {/* Soft brand bloom behind icon */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] h-[75%] rounded-full blur-3xl opacity-70"
        style={{
          background: `radial-gradient(ellipse 70% 65% at 50% 45%, ${bloom} 0%, rgba(197,227,91,0.22) 38%, transparent 72%)`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 w-[55%] h-[48%] rounded-full blur-2xl opacity-80"
        style={{
          background: 'radial-gradient(circle, rgba(14,164,171,0.55) 0%, rgba(197,227,91,0.28) 45%, transparent 70%)',
        }}
      />
      <img
        src={src}
        alt=""
        className={`ibo-3d-icon ibo-3d-icon--glow relative z-[1] block object-contain object-center ${sizeClass}`}
        draggable={false}
        loading="eager"
        decoding="async"
      />
    </div>
  );
}

function FeatureCardContent({ card, ctaHref, ctaLabel, isLight }) {
  if (!card) return null;
  const tint = card.accentColor || 'rgba(14,164,171,0.35)';

  return (
    <div className="relative h-full w-full grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch overflow-hidden">
      {/* Soft logo-matched card wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: isLight
            ? `linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(238,248,249,0.92) 45%, rgba(245,250,232,0.88) 100%),
               radial-gradient(ellipse 55% 50% at 0% 0%, rgba(14,164,171,0.14) 0%, transparent 55%),
               radial-gradient(ellipse 50% 45% at 100% 100%, rgba(197,227,91,0.16) 0%, transparent 55%)`
            : `linear-gradient(145deg, rgba(12,18,28,0.55) 0%, rgba(8,14,22,0.2) 50%, rgba(10,20,18,0.45) 100%),
               radial-gradient(ellipse 60% 55% at 0% 0%, rgba(14,164,171,0.22) 0%, transparent 58%),
               radial-gradient(ellipse 55% 50% at 100% 100%, rgba(197,227,91,0.14) 0%, transparent 55%)`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(14,164,171,0.55), rgba(197,227,91,0.45), transparent)',
        }}
      />

      <div className="relative z-[2] flex flex-col justify-between px-7 sm:px-9 lg:px-10 py-8 sm:py-9 min-h-[240px] lg:min-h-0">
        <div>
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-display text-[1.45rem] sm:text-[1.7rem] lg:text-[1.85rem] font-bold tracking-tight text-white leading-[1.15] max-w-[16ch]">
              {card.title}
            </h3>
            <span
              className="shrink-0 mt-1 text-[10px] sm:text-[11px] font-bold tracking-[0.14em] uppercase px-2.5 py-1 rounded-full border"
              style={{
                color: isLight ? '#0a8f95' : '#C5E35B',
                borderColor: isLight ? 'rgba(14,164,171,0.35)' : 'rgba(197,227,91,0.35)',
                background: isLight ? 'rgba(14,164,171,0.08)' : 'rgba(197,227,91,0.1)',
              }}
            >
              {card.badge ?? 'Feature'}
            </span>
          </div>
          <p className="mt-4 sm:mt-5 text-zinc-400 text-[13px] sm:text-[15px] leading-relaxed max-w-[38ch]">
            {card.desc}
          </p>
        </div>
        <div className="mt-8 lg:mt-10">
          <Link
            to={card.ctaHref ?? ctaHref}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-[#050a1a] bg-logo-gradient shadow-[0_12px_36px_rgba(14,164,171,0.28)] hover:brightness-110 transition-[filter]"
          >
            {card.ctaLabel ?? ctaLabel}
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>

      <div className="relative h-full min-h-[200px] sm:min-h-[220px] lg:min-h-0 flex items-stretch justify-center px-4 sm:px-6 lg:px-8 pb-8 lg:pb-0 lg:pr-8">
        <div
          aria-hidden
          className="absolute inset-[8%] rounded-[2rem] blur-2xl opacity-60 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 70% 65% at 50% 50%, ${tint} 0%, rgba(197,227,91,0.2) 42%, transparent 72%)`,
          }}
        />
        {card.art ? <FeatureCardArt src={card.art} fit={card.artFit} glow={tint} /> : null}
      </div>
    </div>
  );
}

export default function StackedFeatureCards({
  cards = [],
  stackDepth = 5,
  ctaHref = '/markets',
  ctaLabel = 'Explore markets',
  ariaLabel = 'Why IBO stacked cards',
  eyebrow = 'Why IBO',
  title = 'Built for serious traders',
  lead = 'Everything you need to trade with confidence — from beginner to professional.',
}) {
  const { isLight } = useTheme();
  const safeCards = useMemo(() => cards.filter(Boolean), [cards]);
  const total = safeCards.length;
  const depth = Math.min(Math.max(4, stackDepth), Math.max(4, total || 4));

  const trackRef = useRef(null);
  const pinRef = useRef(null);
  const scrollerRef = useRef(null);
  const rafRef = useRef(0);

  const [progress, setProgress] = useState(0);
  const [pinH, setPinH] = useState(640);

  const activeIndex = clamp(Math.round(progress), 0, Math.max(0, total - 1));
  const frac = total > 1 ? progress - Math.floor(progress) : 0;
  const contentIndex =
    total <= 1 ? 0 : clamp(frac < 0.5 ? Math.floor(progress) : Math.ceil(progress), 0, total - 1);

  const scrollRange = Math.max(0, total - 1) * STEP_PX;
  const trackHeight = pinH + scrollRange;

  const sync = useCallback(() => {
    const track = trackRef.current;
    const pin = pinRef.current;
    if (!track || !pin || total <= 0) return;

    const nextH = pin.offsetHeight || 640;
    if (Math.abs(nextH - pinH) > 4) setPinH(nextH);

    const range = Math.max(1, scrollRange);
    // How far the sticky section has been scrolled through
    const top = track.getBoundingClientRect().top;
    const scrolled = STICKY_TOP - top;
    const p = clamp(scrolled / range, 0, 1) * Math.max(0, total - 1);
    setProgress(p);
  }, [pinH, scrollRange, total]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    scrollerRef.current = getScrollRoot(track);
    const scroller = scrollerRef.current;

    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(sync);
    };

    sync();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    const ro = new ResizeObserver(onScroll);
    ro.observe(track);
    if (pinRef.current) ro.observe(pinRef.current);

    return () => {
      cancelAnimationFrame(rafRef.current);
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      ro.disconnect();
    };
  }, [sync, total]);

  const scrollToIndex = useCallback(
    (index) => {
      const clamped = clamp(index, 0, total - 1);
      const track = trackRef.current;
      const scroller = scrollerRef.current;
      if (!track || !scroller) {
        setProgress(clamped);
        return;
      }

      const range = Math.max(1, scrollRange);
      const ratio = total <= 1 ? 0 : clamped / (total - 1);
      const sRect = scroller.getBoundingClientRect();
      const tRect = track.getBoundingClientRect();
      const trackTopInScroller = scroller.scrollTop + (tRect.top - sRect.top);
      const target = trackTopInScroller - STICKY_TOP + ratio * range;
      scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    },
    [scrollRange, total],
  );

  useEffect(() => {
    const el = pinRef.current;
    if (!el) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        scrollToIndex(activeIndex + 1);
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        scrollToIndex(activeIndex - 1);
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [activeIndex, scrollToIndex]);

  if (!total) return null;

  return (
    <div ref={trackRef} className="relative w-full" style={{ height: trackHeight }}>
      <div
        ref={pinRef}
        tabIndex={0}
        role="region"
        aria-label={ariaLabel}
        className="w-full outline-none sticky z-0"
        style={{
          top: STICKY_TOP,
          background: 'var(--ibo-bg)',
        }}
      >
        <div className="text-center mb-8 md:mb-10 max-w-2xl mx-auto px-1">
          <p className="ibo-eyebrow mb-4">{eyebrow}</p>
          <h2 className="ibo-title-lg mb-5">{title}</h2>
          <p className="ibo-lead-wide mx-auto text-zinc-400">{lead}</p>
        </div>

        <div
          className="relative mx-auto w-full"
          style={{
            height: PANEL_H,
            paddingTop: (depth - 1) * PEEK_Y + 10,
          }}
        >
          <div className="relative h-full w-full">
            {safeCards.map((card, i) => {
              const rel = i - progress;
              const pose = cardPose(rel, depth, isLight);
              if (!pose) return null;
              const showContent = i === contentIndex;

              return (
                <div
                  key={card.id ?? i}
                  className="absolute inset-0"
                  style={{
                    transform: `translate3d(0, ${pose.y.toFixed(2)}px, 0) scale(${pose.scale.toFixed(4)})`,
                    opacity: pose.opacity,
                    zIndex: pose.z,
                    transformOrigin: '50% 50%',
                    pointerEvents: showContent ? 'auto' : 'none',
                    willChange: 'transform, opacity',
                  }}
                >
                  <div
                    className="h-full w-full overflow-hidden border relative"
                    style={{
                      borderRadius: CARD_RADIUS,
                      background: showContent
                        ? isLight
                          ? 'linear-gradient(145deg, #ffffff 0%, #f3fafb 48%, #f7fbe9 100%)'
                          : 'linear-gradient(145deg, #101820 0%, #0c1219 45%, #0e1614 100%)'
                        : isLight
                          ? 'linear-gradient(145deg, #f6f9fb 0%, #eef3f6 100%)'
                          : 'linear-gradient(145deg, #0e141c 0%, #0a0f16 100%)',
                      borderColor: showContent
                        ? isLight
                          ? 'rgba(14,164,171,0.28)'
                          : 'rgba(14,164,171,0.35)'
                        : isLight
                          ? 'var(--ibo-border-solid)'
                          : 'rgba(255,255,255,0.08)',
                      boxShadow: showContent
                        ? isLight
                          ? `0 18px 48px rgba(14,164,171,0.12), 0 0 0 1px rgba(197,227,91,0.12), ${pose.shadow}`
                          : `0 24px 64px rgba(0,0,0,0.45), 0 0 40px rgba(14,164,171,0.12), ${pose.shadow}`
                        : pose.shadow,
                    }}
                  >
                    {showContent ? (
                      <FeatureCardContent
                        card={card}
                        ctaHref={ctaHref}
                        ctaLabel={ctaLabel}
                        isLight={isLight}
                      />
                    ) : (
                      <div
                        aria-hidden
                        className="h-12 border-b"
                        style={{
                          borderColor: isLight ? 'rgba(14,164,171,0.12)' : 'rgba(255,255,255,0.05)',
                          background: isLight
                            ? 'linear-gradient(90deg, rgba(14,164,171,0.1) 0%, rgba(197,227,91,0.08) 50%, transparent 100%)'
                            : 'linear-gradient(90deg, rgba(14,164,171,0.18) 0%, rgba(197,227,91,0.1) 45%, transparent 100%)',
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {total > 1 ? (
          <div className="mt-4 flex flex-col items-center gap-2.5 pb-4">
            <div className="flex items-center gap-1.5">
              {safeCards.map((card, i) => {
                const on = i === activeIndex;
                return (
                  <button
                    key={card.id ?? i}
                    type="button"
                    aria-label={`Go to ${card.title}`}
                    aria-current={on ? 'true' : undefined}
                    onClick={() => scrollToIndex(i)}
                    className="h-1.5 rounded-full transition-all duration-300"
                    style={{
                      width: on ? 22 : 8,
                      background: on
                        ? 'linear-gradient(90deg, #0ea4ab, #c5e35b)'
                        : isLight
                          ? 'rgba(12,28,38,0.18)'
                          : 'rgba(255,255,255,0.18)',
                    }}
                  />
                );
              })}
            </div>
            <p className={`text-[11px] ${isLight ? 'text-[color:var(--ibo-muted)]' : 'text-white/30'}`}>
              Scroll — cards flip in place
            </p>
            <span className="sr-only" aria-live="polite">
              {safeCards[contentIndex]?.title}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
