import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * Interactive 3D feature stage — floating art + soft bloom + pointer parallax.
 */
export default function PlatformFeatureVisual({
  src = '/hero/platform-coin-machine.png?v=11',
  alt = '',
  className = '',
}) {
  const reduceMotion = useReducedMotion();
  const stageRef = useRef(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (reduceMotion) return undefined;
    const el = stageRef.current;
    if (!el) return undefined;

    const onMove = (e) => {
      const rect = el.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      setTilt({
        x: Math.max(-1, Math.min(1, nx)),
        y: Math.max(-1, Math.min(1, ny)),
      });
    };

    const onLeave = () => setTilt({ x: 0, y: 0 });

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [reduceMotion]);

  const rotX = reduceMotion ? 0 : tilt.y * -5;
  const rotY = reduceMotion ? 0 : tilt.x * 7;

  return (
    <motion.div
      ref={stageRef}
      initial={{ opacity: 0, x: -24 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className={`relative flex items-center justify-center lg:justify-start ${className}`}
      style={{ perspective: 900 }}
    >
      <div
        className="relative w-[min(100%,420px)] sm:w-[460px] lg:w-[500px] aspect-[5/4]"
        style={{
          transform: `rotateX(${rotX}deg) rotateY(${rotY}deg)`,
          transformStyle: 'preserve-3d',
          transition: reduceMotion ? undefined : 'transform 0.35s ease-out',
        }}
      >
        <div
          aria-hidden
          className="absolute inset-[8%] rounded-[40%] blur-3xl opacity-70 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 50% 55%, rgba(197,227,91,0.28) 0%, rgba(14,164,171,0.18) 42%, transparent 72%)',
          }}
        />
        <div
          aria-hidden
          className="absolute left-1/2 top-[56%] h-[56%] w-[72%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[72px] opacity-60 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 50% 50%, rgba(249,179,43,0.22) 0%, rgba(132,204,22,0.2) 34%, rgba(14,164,171,0.12) 58%, transparent 78%)',
          }}
        />

        <div
          className={`absolute inset-0 z-[1] flex items-center justify-center ${
            reduceMotion ? '' : 'platform-visual-float-scene'
          }`}
        >
          <img
            src={src}
            alt={alt}
            width={1600}
            height={1320}
            className="ibo-3d-icon ibo-3d-icon--soft relative z-[1] w-full max-h-full h-auto object-contain"
            style={{
              maxWidth: '100%',
              transform: reduceMotion
                ? undefined
                : `translate3d(${tilt.x * 8}px, ${tilt.y * 6}px, 0)`,
              transition: reduceMotion ? undefined : 'transform 0.35s ease-out',
            }}
            draggable={false}
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
        </div>
      </div>
    </motion.div>
  );
}
