/** Official Google Play badge — PNG with crop so visible badge matches CTA button height. */
const BADGE_SRC = '/badges/google-play-badge.png';

/** Quick trade / create account buttons use py-3.5 + 15px text ≈ 52px tall. */
const SIZES = {
  hero: { height: 52, imageScale: 2.65 },
  md: { height: 52, imageScale: 2.65 },
  sm: { height: 44, imageScale: 2.5 },
};

export default function GooglePlayBadge({ className = '', size = 'md' }) {
  const cfg = SIZES[size] || SIZES.md;

  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden rounded-xl align-middle ibo-hover-scale ${className}`}
      style={{ height: cfg.height }}
    >
      <img
        src={BADGE_SRC}
        alt="Get it on Google Play"
        className="w-auto max-w-none select-none pointer-events-none"
        style={{
          height: cfg.height * cfg.imageScale,
          objectFit: 'cover',
          objectPosition: 'center',
        }}
        draggable={false}
      />
    </span>
  );
}
