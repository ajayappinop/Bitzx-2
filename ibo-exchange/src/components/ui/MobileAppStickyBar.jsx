import { Download, Smartphone, X } from 'lucide-react';
import { useState } from 'react';
import { useMobileAppRelease } from '@/hooks/useMobileAppRelease';
import GooglePlayBadge from '@/components/ui/GooglePlayBadge';

/** Sticky bottom bar when the mobile app CTA is available (landing page). */
export default function MobileAppStickyBar() {
  const { loaded, available, storeHref, release, isGooglePlay, linkProps } = useMobileAppRelease();
  const [hidden, setHidden] = useState(false);

  if (!loaded || !available || !storeHref || !linkProps || hidden) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[90] px-3 pb-3 sm:px-4 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-3xl flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-[#0a0f0c]/95 backdrop-blur-md shadow-xl shadow-black/40 px-4 py-3">
        <Smartphone size={20} className="text-emerald-300 shrink-0 hidden sm:block" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">Delta Android app is live</p>
          <p className="text-xs text-zinc-400 truncate">
            {isGooglePlay
              ? 'Available on Google Play'
              : `v${release.version} · Tap to download the official APK`}
          </p>
        </div>
        {isGooglePlay ? (
          <a {...linkProps} className="shrink-0">
            <GooglePlayBadge size="sm" />
          </a>
        ) : (
          <a
            {...linkProps}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#041008] font-bold px-4 py-2 text-sm transition-colors"
          >
            <Download size={15} />
            <span className="hidden xs:inline">Download</span>
          </a>
        )}
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="shrink-0 p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
