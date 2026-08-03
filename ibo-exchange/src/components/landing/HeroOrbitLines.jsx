import { useReducedMotion } from 'framer-motion';

/**
 * Ordered semi-circle arcs along the hero top — max 4 clean lines.
 */
export default function HeroOrbitLines() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[42%] sm:h-[46%] overflow-hidden" aria-hidden>
      <div className="absolute left-1/2 top-0 w-[min(160vw,1200px)] aspect-[2/1] -translate-x-1/2 -translate-y-[18%]">
        <svg
          viewBox="0 0 400 200"
          className="h-full w-full"
          fill="none"
          preserveAspectRatio="xMidYMin meet"
        >
          <defs>
            <linearGradient id="hero-arc-a" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(14,164,171,0)" />
              <stop offset="25%" stopColor="rgba(14,164,171,0.55)" />
              <stop offset="55%" stopColor="rgba(77,138,255,0.45)" />
              <stop offset="100%" stopColor="rgba(197,227,91,0)" />
            </linearGradient>
            <linearGradient id="hero-arc-b" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(197,227,91,0)" />
              <stop offset="35%" stopColor="rgba(197,227,91,0.4)" />
              <stop offset="70%" stopColor="rgba(14,164,171,0.35)" />
              <stop offset="100%" stopColor="rgba(77,138,255,0)" />
            </linearGradient>
          </defs>

          {/* 1 — outermost (top) */}
          <path
            d="M 16 12 A 184 184 0 0 0 384 12"
            stroke="url(#hero-arc-a)"
            strokeWidth="0.45"
            strokeLinecap="round"
            opacity="0.8"
          />
          {/* 2 */}
          <path
            d="M 48 12 A 152 152 0 0 0 352 12"
            className="hero-orbit-dashed"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="0.35"
            strokeDasharray="3 6"
            strokeLinecap="round"
            opacity="0.85"
          />
          {/* 3 */}
          <path
            d="M 78 12 A 122 122 0 0 0 322 12"
            stroke="url(#hero-arc-b)"
            strokeWidth="0.4"
            strokeLinecap="round"
            opacity="0.75"
          />
          {/* 4 — innermost */}
          <path
            d="M 108 12 A 92 92 0 0 0 292 12"
            stroke="rgba(14,164,171,0.25)"
            strokeWidth="0.3"
            strokeDasharray="1.5 4"
            strokeLinecap="round"
          />

          {!reduceMotion ? (
            <>
              <circle r="1.4" fill="#C5E35B" className="hero-orbit-travel-spark">
                <animateMotion
                  dur="16s"
                  repeatCount="indefinite"
                  path="M 16 12 A 184 184 0 0 0 384 12"
                />
              </circle>
              <circle r="1.1" fill="#0ea4ab" className="hero-orbit-travel-spark" opacity="0.9">
                <animateMotion
                  dur="12s"
                  repeatCount="indefinite"
                  begin="-3s"
                  path="M 78 12 A 122 122 0 0 0 322 12"
                />
              </circle>
            </>
          ) : null}
        </svg>
      </div>
    </div>
  );
}
