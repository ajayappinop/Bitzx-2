import { motion } from 'framer-motion';
import { Smartphone, Download, Clock, Shield, Sparkles } from 'lucide-react';
import { useMobileAppRelease } from '@/hooks/useMobileAppRelease';
import GooglePlayBadge from '@/components/ui/GooglePlayBadge';

function fmtBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  return `${(v / 1024).toFixed(0)} KB`;
}

function StoreAnchor({ linkProps, className, children }) {
  if (!linkProps) return null;
  return (
    <a {...linkProps} className={className}>
      {children}
    </a>
  );
}

/**
 * Mobile app download blocks for landing page.
 * variant: card | compact | banner | strip | pill | inline
 */
export default function MobileAppDownload({
  compact = false,
  variant,
  className = '',
  id,
  title,
  subtitle,
}) {
  const resolvedVariant = variant || (compact ? 'compact' : 'card');
  const {
    release,
    loaded,
    available,
    storeHref,
    isGooglePlay,
    linkProps,
  } = useMobileAppRelease();

  if (!loaded) {
    const h = resolvedVariant === 'pill' ? 'h-11' : resolvedVariant === 'strip' ? 'h-14' : 'h-24';
    return (
      <div
        id={id}
        className={`rounded-2xl border border-white/10 bg-white/[0.03] animate-pulse ${h} ${className}`}
      />
    );
  }

  const sizeLabel = fmtBytes(release?.file_size_bytes);
  const heading = title || (isGooglePlay ? 'IBO on Google Play' : 'Download IBO Mobile');
  const desc = subtitle || (available
    ? (isGooglePlay
      ? 'Install the official IBO app from Google Play — trade on Android anytime.'
      : `Trade on Android · v${release.version}${sizeLabel ? ` · ${sizeLabel}` : ''}`)
    : 'Native Android app launching shortly — use the web terminal today.');

  if (available && storeHref && linkProps) {
    if (resolvedVariant === 'pill') {
      if (isGooglePlay) {
        return (
          <motion.a
            id={id}
            {...linkProps}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`inline-flex items-center ibo-hover-scale ${className}`}
          >
            <GooglePlayBadge size="hero" />
          </motion.a>
        );
      }
      return (
        <motion.a
          id={id}
          {...linkProps}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`inline-flex items-center gap-2 rounded-full border border-emerald-400/35 bg-emerald-500/15 px-5 py-2.5 text-sm font-bold text-emerald-200 hover:bg-emerald-500/25 transition-colors ${className}`}
        >
          <Download size={16} />
          Android app · v{release.version}
        </motion.a>
      );
    }

    if (resolvedVariant === 'strip') {
      return (
        <motion.div
          id={id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.08] px-4 py-3 ${className}`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <Smartphone size={20} className="text-emerald-300 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{heading}</p>
              <p className="text-xs text-zinc-400 truncate">{desc}</p>
            </div>
          </div>
          {isGooglePlay ? (
            <StoreAnchor linkProps={linkProps}>
              <GooglePlayBadge size="md" />
            </StoreAnchor>
          ) : (
            <StoreAnchor
              linkProps={linkProps}
              className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#041008] font-bold px-4 py-2 text-sm transition-colors"
            >
              <Download size={15} />
              Download
            </StoreAnchor>
          )}
        </motion.div>
      );
    }

    if (resolvedVariant === 'banner') {
      return (
        <motion.div
          id={id}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className={`relative overflow-hidden rounded-2xl border border-emerald-500/25 ${className}`}
          style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.14) 0%, rgba(10,11,15,0.95) 55%, rgba(14,164,171,0.08) 100%)' }}
        >
          <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-emerald-400/10 blur-3xl pointer-events-none" />
          <div className="relative flex flex-col md:flex-row md:items-center gap-5 p-6 sm:p-8">
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <div className="shrink-0 p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-400/30">
                <Smartphone size={28} className="text-emerald-300" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-300/90 mb-1.5 flex items-center gap-1.5">
                  <Sparkles size={12} /> Android · Live now
                </p>
                <h3 className="text-xl sm:text-2xl font-bold text-white leading-snug">{heading}</h3>
                <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-xl">{desc}</p>
                <p className="text-[11px] text-zinc-500 mt-3 flex items-center gap-1.5">
                  <Shield size={11} className="shrink-0" />
                  {isGooglePlay
                    ? 'Official IBO app on Google Play'
                    : 'Official IBO APK · enable “Install unknown apps” if prompted'}
                </p>
              </div>
            </div>
            {isGooglePlay ? (
              <StoreAnchor linkProps={linkProps} className="shrink-0">
                <GooglePlayBadge />
              </StoreAnchor>
            ) : (
              <StoreAnchor
                linkProps={linkProps}
                className="shrink-0 inline-flex items-center justify-center gap-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#041008] font-bold px-8 py-3.5 text-[15px] shadow-lg shadow-emerald-500/25 transition-colors w-full md:w-auto"
              >
                <Download size={18} />
                Download APK
              </StoreAnchor>
            )}
          </div>
        </motion.div>
      );
    }

    if (resolvedVariant === 'inline') {
      if (isGooglePlay) return null;
      return (
        <a
          id={id}
          {...linkProps}
          className={`inline-flex items-center gap-1.5 text-emerald-300 hover:text-emerald-200 font-semibold text-sm underline underline-offset-4 ${className}`}
        >
          <Download size={14} />
          Download Android app (v{release.version})
        </a>
      );
    }

    const isCompact = resolvedVariant === 'compact';
    return (
      <motion.div
        id={id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.12] via-white/[0.04] to-transparent backdrop-blur-sm ${className}`}
      >
        <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-emerald-400/10 blur-2xl pointer-events-none" />
        <div className={`relative flex ${isCompact ? 'flex-col sm:flex-row' : 'flex-col lg:flex-row'} items-start lg:items-center gap-4 ${isCompact ? 'p-4 sm:p-5' : 'p-5 sm:p-6'}`}>
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="shrink-0 p-3 rounded-xl bg-emerald-500/15 border border-emerald-400/30">
              <Smartphone size={isCompact ? 22 : 26} className="text-emerald-300" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300/90 mb-1">
                Android app
              </p>
              <h3 className={`font-bold text-white ${isCompact ? 'text-base' : 'text-lg sm:text-xl'} leading-snug`}>
                {heading}
              </h3>
              <p className="text-sm text-zinc-400 mt-1 leading-relaxed">{desc}</p>
              <p className="text-[11px] text-zinc-500 mt-2 flex items-center gap-1.5">
                <Shield size={11} className="shrink-0" />
                {isGooglePlay ? 'Official app on Google Play' : 'Official APK from IBO'}
              </p>
            </div>
          </div>
          {isGooglePlay ? (
            <StoreAnchor linkProps={linkProps} className="shrink-0">
              <GooglePlayBadge size="md" />
            </StoreAnchor>
          ) : (
            <StoreAnchor
              linkProps={linkProps}
              className={`shrink-0 inline-flex items-center justify-center gap-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#041008] font-bold shadow-lg shadow-emerald-500/25 transition-colors ${isCompact ? 'w-full sm:w-auto px-6 py-3 text-sm' : 'px-8 py-3.5 text-[15px]'}`}
            >
              <Download size={18} />
              Download APK
            </StoreAnchor>
          )}
        </div>
      </motion.div>
    );
  }

  if (resolvedVariant === 'pill') {
    return (
      <span id={id} className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-zinc-500 ${className}`}>
        <Clock size={13} /> App coming soon
      </span>
    );
  }

  if (resolvedVariant === 'strip' || resolvedVariant === 'inline') return null;

  const isCompact = resolvedVariant === 'compact';
  const isBanner = resolvedVariant === 'banner';
  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-2xl border ${className}`}
      style={{
        borderColor: 'rgba(14,164,171,0.28)',
        background:
          'linear-gradient(145deg, rgba(14,164,171,0.12) 0%, color-mix(in srgb, var(--ibo-card) 94%, transparent) 48%, rgba(197,227,91,0.1) 100%)',
        boxShadow: '0 14px 36px rgba(14,164,171,0.08), var(--ibo-shadow)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(14,164,171,0.45), rgba(197,227,91,0.35), transparent)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-12 w-40 h-40 rounded-full blur-3xl opacity-60"
        style={{ background: 'radial-gradient(circle, rgba(14,164,171,0.28) 0%, transparent 70%)' }}
      />
      <div className={`relative flex items-start gap-3 ${isBanner || !isCompact ? 'p-5 sm:p-6' : 'p-4 sm:p-5'}`}>
        <div
          className="shrink-0 p-3 rounded-xl border"
          style={{
            background: 'linear-gradient(145deg, rgba(14,164,171,0.2) 0%, rgba(197,227,91,0.1) 100%)',
            borderColor: 'rgba(14,164,171,0.35)',
            color: 'var(--ibo-accent)',
            boxShadow: '0 8px 20px rgba(14,164,171,0.15)',
          }}
        >
          <Smartphone size={isCompact && !isBanner ? 22 : 26} />
        </div>
        <div>
          <p
            className="text-[11px] font-bold uppercase tracking-[0.18em] mb-1"
            style={{ color: 'var(--ibo-accent)' }}
          >
            Mobile app
          </p>
          <h3
            className={`font-bold ${isCompact && !isBanner ? 'text-base' : 'text-lg sm:text-xl'}`}
            style={{ color: 'var(--ibo-ink)' }}
          >
            Android app coming soon
          </h3>
          <p
            className="text-sm mt-1.5 flex items-center gap-2 leading-relaxed"
            style={{ color: 'var(--ibo-ink-secondary)' }}
          >
            <Clock size={14} className="shrink-0" style={{ color: 'var(--ibo-accent)' }} />
            {desc}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
