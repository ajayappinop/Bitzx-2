import { BRAND_LOGO_DARK, BRAND_LOGO_LIGHT } from '@/lib/brandAssets';

/**
 * Theme-aware brand wordmark with transparent PNG.
 * Swaps dark/light asset via document data-theme (no hook required).
 */
export default function BrandLogo({
  className = 'h-9 w-auto max-w-[220px]',
  alt = 'Exchange',
  style,
  ...imgProps
}) {
  const imgClass = `ibo-brand-logo ${className}`.trim();
  const shared = {
    alt,
    draggable: false,
    style: { background: 'transparent', ...style },
    ...imgProps,
  };

  return (
    <span className="ibo-brand-logo-wrap inline-flex items-center max-w-full">
      <img
        src={BRAND_LOGO_DARK}
        className={`${imgClass} ibo-brand-logo--dark`}
        {...shared}
      />
      <img
        src={BRAND_LOGO_LIGHT}
        className={`${imgClass} ibo-brand-logo--light`}
        aria-hidden
        alt=""
        draggable={false}
        style={{ background: 'transparent', ...style }}
      />
    </span>
  );
}
