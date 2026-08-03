import { iconUrlForAsset, iconUrlForSymbol } from '@/lib/coinIcons';

/**
 * Rounded coin image for an asset code (e.g. BTC) or pair symbol (e.g. BTCUSDT).
 */
export default function CoinAvatar({
  asset,
  symbol,
  className = 'w-7 h-7',
  title,
}) {
  const url = symbol ? iconUrlForSymbol(symbol) : iconUrlForAsset(asset);
  const label = title ?? symbol ?? asset ?? '';
  if (!url) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-extrabold text-white/50 ${className}`}
        title={label}
      >
        {(asset || symbol || '?').toString().slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className={`shrink-0 rounded-full object-cover ${className}`}
      title={label}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}
