import { useCallback, useEffect, useState } from 'react';

import { Link } from 'react-router-dom';

import { AnimatePresence, motion } from 'framer-motion';

import { X, Download, Smartphone, Sparkles, ChevronRight } from 'lucide-react';

import { useLandingPromo, promoAssetUrl } from '@/hooks/useLandingPromo';

import { mobileAppStoreHref, mobileAppLinkProps, isGooglePlayRelease } from '@/hooks/useMobileAppRelease';

import GooglePlayBadge from '@/components/ui/GooglePlayBadge';



import { BRAND_MARK } from '@/lib/brandAssets';



const LOGO = BRAND_MARK;



const CTA_CLASS =

  'group inline-flex w-full sm:w-fit items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-[#101013] shadow-lg transition-all font-ui';

const CTA_STYLE = {

  background: 'linear-gradient(135deg, #FE6C02, #FE9D55)',

  boxShadow: '0 8px 24px rgba(254, 108, 2,0.28)',

};



function PromoBrand({ label = 'Delta', centered = true }) {

  return (

    <div className={`flex items-center gap-2 font-ui ${centered ? 'justify-center' : ''}`}>

      <div className="relative shrink-0">

        <div

          className="absolute inset-0 rounded-full blur-md scale-150"

          style={{ background: 'rgba(254, 157, 85,0.28)' }}

        />

        <img src={LOGO} alt="" className="relative w-8 h-8 sm:w-10 sm:h-10 object-contain drop-shadow-md" />

      </div>

      <span className="text-[color:var(--ibo-ink)] font-extrabold tracking-[0.18em] text-xs sm:text-base">{label}</span>

    </div>

  );

}



const DEFAULT_COIN_IMG = '/hero/ibo-token-3d.png';



function CoinVisual({ imageUrl, brandLabel, compact }) {

  const img = promoAssetUrl(imageUrl) || DEFAULT_COIN_IMG;

  const isDefault = !promoAssetUrl(imageUrl);



  return (

    <div className={`promo-coin-stage ${compact ? 'promo-coin-stage--compact' : ''}`}>

      <div className="promo-coin-glow" aria-hidden />

      <div className="promo-coin-orbit" aria-hidden />

      <motion.div

        className="promo-coin-float"

        animate={{ y: [0, -7, 0] }}

        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}

      >

        <img

          src={img}

          alt=""

          className={`promo-coin-img ${isDefault ? 'promo-coin-img--masked' : ''}`}

        />

      </motion.div>

      <div className="promo-coin-base" aria-hidden />

      {brandLabel ? (

        <span className="promo-coin-caption">{brandLabel}</span>

      ) : null}

    </div>

  );

}



function AppVisual({ imageUrl, compact }) {

  const img = promoAssetUrl(imageUrl);

  const visualMin = compact ? 'min-h-[110px] max-h-[140px]' : 'min-h-[120px] max-h-[160px] sm:min-h-[180px] sm:max-h-[220px]';



  if (img) {

    return (

      <div className={`relative flex items-center justify-center w-full ${visualMin} px-3 shrink-0`}>

        <div

          className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none"

          style={{ background: 'radial-gradient(ellipse 85% 70% at 50% 100%, rgba(254, 157, 85,0.16), transparent 70%)' }}

        />

        <motion.img

          src={img}

          alt=""

          className="relative z-[1] max-h-full w-auto max-w-full object-contain"

          animate={{ y: [0, -5, 0] }}

          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}

        />

      </div>

    );

  }



  return (

    <div className={`relative flex flex-col items-center justify-center w-full ${visualMin} px-3 shrink-0`}>

      <div className="promo-app-glow-floor" />

      <div className="relative z-[2] flex gap-2 sm:gap-3 items-end mb-2 scale-90 sm:scale-100">

        {[0, 1].map((i) => (

          <motion.div

            key={i}

            className="promo-phone overflow-hidden shrink-0"

            style={{ transform: i === 0 ? 'rotate(-10deg) translateY(4px)' : 'rotate(10deg)' }}

            animate={{ y: i === 0 ? [4, -2, 4] : [0, -6, 0] }}

            transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.2 }}

          >

            <div className="h-4 sm:h-5 flex items-center justify-center" style={{ background: 'var(--ibo-elevated)' }}>

              <span className="w-6 sm:w-8 h-1 rounded-full" style={{ background: 'var(--ibo-border-solid)' }} />

            </div>

            <div className="p-1 sm:p-1.5 space-y-0.5 sm:space-y-1">

              <div

                className="h-10 sm:h-14 rounded-md border"

                style={{

                  background: 'linear-gradient(135deg, rgba(254, 108, 2,0.12), rgba(254, 157, 85,0.1))',

                  borderColor: 'rgba(254, 108, 2,0.25)',

                }}

              />

              <div className="h-1 rounded" style={{ background: 'var(--ibo-border-solid)' }} />

              <div className="h-1 rounded w-4/5" style={{ background: 'var(--ibo-border-solid)' }} />

            </div>

          </motion.div>

        ))}

      </div>

      <div className="promo-app-pedestal relative z-[2]" />

    </div>

  );

}



function CoinSlide({ data, onClose }) {

  const ctaInternal = data.cta_url?.startsWith('/');



  return (

    <div className="flex flex-col font-ui">

      <div className="flex flex-col sm:grid sm:grid-cols-[1.05fr_0.95fr]">

        <div className="relative z-[2] flex flex-col px-4 sm:pl-7 sm:pr-4 pt-12 sm:pt-12 pb-2 sm:pb-4 text-left">

          <div className="mb-3 sm:mb-5">

            <PromoBrand label={data.brand_label || 'Delta'} centered={false} />

          </div>

          <h2 className="promo-title-shimmer text-xl sm:text-[1.85rem] font-extrabold leading-[1.08] tracking-tight mb-2 sm:mb-3 uppercase break-words">

            {data.title}

          </h2>

          <p className="promo-tagline-gold text-[10px] sm:text-xs font-extrabold uppercase tracking-[0.1em] leading-snug mb-1.5 sm:mb-2">

            {data.tagline_1}

          </p>

          <p className="promo-tagline-gold text-[9px] sm:text-[11px] font-bold uppercase tracking-[0.06em] leading-snug mb-3 sm:mb-4 opacity-90">

            {data.tagline_2}

          </p>

          <p className="text-[color:var(--ibo-ink)] font-semibold text-sm mb-0.5">{data.status_line}</p>

          <p className="text-[#FE6C02] font-bold text-xs sm:text-sm mb-4 leading-snug">{data.event_line}</p>

          {data.cta_url && data.cta_label ? (

            ctaInternal ? (

              <Link to={data.cta_url} onClick={onClose} className={CTA_CLASS} style={CTA_STYLE}>

                {data.cta_label}

                <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />

              </Link>

            ) : (

              <a href={data.cta_url} target="_blank" rel="noopener noreferrer" className={CTA_CLASS} style={CTA_STYLE}>

                {data.cta_label}

                <ChevronRight size={16} />

              </a>

            )

          ) : null}

        </div>

        <div className="relative flex items-end justify-center sm:justify-end sm:pr-2 px-2 pb-3 sm:pb-4 shrink-0">

          <CoinVisual imageUrl={data.image_url} brandLabel={data.brand_label || 'Delta'} compact />

        </div>

      </div>

    </div>

  );

}



function AppSlide({ data, apk }) {

  const storeHref = mobileAppStoreHref(apk);

  const linkProps = mobileAppLinkProps(apk);

  const isGooglePlay = isGooglePlayRelease(apk);

  const available = apk?.available === true && storeHref && linkProps;

  const features = (data.features || 'Fast | Secure | Real-Time').split('|').map((s) => s.trim()).filter(Boolean);



  return (

    <div className="flex flex-col font-ui">

      <div className="px-4 sm:px-8 pt-12 sm:pt-11 pb-2 sm:pb-3 text-center">

        <div className="mb-3 sm:mb-4">

          <PromoBrand label="Delta" />

        </div>

        <h2 className="text-base sm:text-xl font-bold text-[color:var(--ibo-ink)] mb-2 leading-snug tracking-tight px-1">

          {data.headline}

        </h2>

        <p className="text-xs sm:text-[13px] text-[color:var(--ibo-muted)] leading-relaxed max-w-[340px] mx-auto mb-2 sm:mb-3">

          {data.description}

        </p>

        <p className="text-sm sm:text-lg font-bold text-[color:var(--ibo-ink)] mb-1.5 sm:mb-2">{data.subheadline}</p>

        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs sm:text-sm font-bold">

          {features.map((f, i) => (

            <span key={f} className="inline-flex items-center gap-2">

              {i > 0 ? <span className="text-[#FE6C02]/50 font-normal">|</span> : null}

              <span className="promo-tagline-gold">{f}</span>

            </span>

          ))}

        </div>

      </div>



      <AppVisual imageUrl={data.image_url} compact />



      <div className="promo-download-bar px-4 sm:px-6 py-3 sm:py-4 text-center shrink-0">

        {available ? (

          isGooglePlay ? (

            <a

              {...linkProps}

              className="group flex items-center justify-center w-full sm:w-auto mx-auto rounded-xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] active:bg-[color:var(--ibo-hover)] px-4 py-3 sm:py-3.5 transition-all"

            >

              <GooglePlayBadge size="md" />

            </a>

          ) : (

            <a

              {...linkProps}

              className="group flex flex-col sm:inline-flex sm:flex-row sm:items-center justify-center gap-1 sm:gap-3 w-full sm:w-auto mx-auto rounded-xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] active:bg-[color:var(--ibo-hover)] px-4 py-3 sm:py-3.5 transition-all"

            >

              <span className="inline-flex items-center justify-center gap-2 text-[color:var(--ibo-ink)] font-semibold text-sm sm:text-base">

                <Download size={17} className="text-[#FE6C02] shrink-0" />

                <span className="underline underline-offset-4 decoration-[#FE6C02]/50">

                  {data.cta_label || 'Click here to download'}

                </span>

              </span>

              {apk.version ? (

                <span className="text-[11px] sm:text-xs text-[color:var(--ibo-muted)] font-medium">Android APK · v{apk.version}</span>

              ) : null}

            </a>

          )

        ) : (

          <p className="inline-flex items-center justify-center gap-2 text-[color:var(--ibo-muted)] text-sm">

            <Smartphone size={16} className="text-[color:var(--ibo-muted)] shrink-0" />

            <Sparkles size={13} className="text-[#FE9D55] shrink-0" />

            Android app coming soon

          </p>

        )}

      </div>

    </div>

  );

}



export default function LandingPromoModal() {

  const { promo, loaded, slides, shouldShow } = useLandingPromo();

  const [open, setOpen] = useState(false);

  const [index, setIndex] = useState(0);

  const [paused, setPaused] = useState(false);

  const [progressKey, setProgressKey] = useState(0);

  const intervalSec = promo?.auto_scroll_seconds ?? 4;



  useEffect(() => {

    if (loaded && shouldShow) setOpen(true);

  }, [loaded, shouldShow]);



  useEffect(() => {

    if (!open) return undefined;

    const prev = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    return () => {

      document.body.style.overflow = prev;

    };

  }, [open]);



  useEffect(() => {

    if (!open || slides.length <= 1 || paused) return undefined;

    setProgressKey((k) => k + 1);

    const id = window.setInterval(() => {

      setIndex((i) => (i + 1) % slides.length);

      setProgressKey((k) => k + 1);

    }, intervalSec * 1000);

    return () => window.clearInterval(id);

  }, [open, slides.length, intervalSec, paused, index]);



  const close = useCallback(() => {

    setOpen(false);

  }, []);



  if (!loaded || !shouldShow) return null;



  const slide = slides[index];



  return (

    <AnimatePresence>

      {open && slide ? (

        <motion.div

          initial={{ opacity: 0 }}

          animate={{ opacity: 1 }}

          exit={{ opacity: 0 }}

          transition={{ duration: 0.35 }}

          className="fixed inset-0 z-[200] flex items-center justify-center p-2 sm:p-6"

          style={{

            paddingTop: 'max(0.5rem, env(safe-area-inset-top))',

            paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',

            paddingLeft: 'max(0.5rem, env(safe-area-inset-left))',

            paddingRight: 'max(0.5rem, env(safe-area-inset-right))',

          }}

          role="dialog"

          aria-modal="true"

          aria-label="Promotional offer"

        >

          <motion.button

            type="button"

            initial={{ opacity: 0 }}

            animate={{ opacity: 1 }}

            className="promo-backdrop absolute inset-0 bg-black/80 backdrop-blur-md touch-none"

            aria-label="Close"

            onClick={close}

          />



          <motion.div

            initial={{ opacity: 0, scale: 0.94, y: 16 }}

            animate={{ opacity: 1, scale: 1, y: 0 }}

            exit={{ opacity: 0, scale: 0.96, y: 10 }}

            transition={{ type: 'spring', damping: 28, stiffness: 340 }}

            className="promo-modal-shell relative z-10 w-full max-w-[420px] sm:max-w-[520px]"

            onMouseEnter={() => setPaused(true)}

            onMouseLeave={() => setPaused(false)}

            onTouchStart={() => setPaused(true)}

            onTouchEnd={() => setPaused(false)}

          >

            <div

              className="promo-modal-watermark"

              style={{ backgroundImage: `url(${LOGO})` }}

            />



            <button

              type="button"

              onClick={close}

              className="absolute top-2.5 right-2.5 sm:top-3.5 sm:right-3.5 z-30 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center active:scale-95 transition-all"

              style={{

                background: 'var(--ibo-card)',

                color: 'var(--ibo-ink)',

                border: '1px solid var(--ibo-border-solid)',

                boxShadow: 'var(--ibo-shadow)',

              }}

              aria-label="Close popup"

            >

              <X size={17} strokeWidth={2.5} className="sm:w-[18px] sm:h-[18px]" />

            </button>



            <div className="promo-modal-scroll relative z-10">

              <AnimatePresence mode="wait">

                <motion.div

                  key={slide.key}

                  initial={{ opacity: 0, x: 20 }}

                  animate={{ opacity: 1, x: 0 }}

                  exit={{ opacity: 0, x: -16 }}

                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}

                >

                  {slide.type === 'coin' ? (

                    <CoinSlide data={slide.data} onClose={close} />

                  ) : (

                    <AppSlide data={slide.data} apk={slide.apk} />

                  )}

                </motion.div>

              </AnimatePresence>

            </div>



            {slides.length > 1 ? (

              <div className="promo-modal-footer relative z-20">

                <div className="promo-progress-track">

                  <div

                    key={`${index}-${progressKey}-${paused}`}

                    className="promo-progress-fill"

                    style={{

                      animationDuration: paused ? '0s' : `${intervalSec}s`,

                      animationPlayState: paused ? 'paused' : 'running',

                    }}

                  />

                </div>

                <div className="flex justify-center gap-2 py-2.5 sm:py-3">

                  {slides.map((s, i) => (

                    <button

                      key={s.key}

                      type="button"

                      aria-label={s.type === 'coin' ? 'Delta coin slide' : 'Mobile app slide'}

                      aria-current={i === index ? 'true' : undefined}

                      onClick={() => {

                        setIndex(i);

                        setProgressKey((k) => k + 1);

                      }}

                      className={`rounded-full transition-all duration-300 ${

                        i === index

                          ? 'w-7 h-2 shadow-[0_0_12px_rgba(254, 157, 85,0.45)]'

                          : 'w-2 h-2'

                      }`}

                      style={

                        i === index

                          ? { background: 'linear-gradient(90deg, #FE6C02, #FE9D55)' }

                          : { background: 'var(--ibo-border-solid)' }

                      }

                    />

                  ))}

                </div>

              </div>

            ) : null}

          </motion.div>

        </motion.div>

      ) : null}

    </AnimatePresence>

  );

}

